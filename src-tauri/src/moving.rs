//! Moving the library to another cloud service, or keeping a copy there, on
//! its own thread. Like sync, the library is only locked while it is read or
//! written, never while waiting on either service, so TBV stays usable while
//! a big library goes across. The page hears how it's going through
//! `move-changed`.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tbv_core::sync::moving::{self, Destination, MoveMode, MoveProgress, MoveReport, MoveRun, MoveScope};
use tbv_core::sync::supabase::{self, Supabase};
use tbv_core::sync::{self as core_sync, Cloud, Provider, ProviderView, Remote, Session, SupabaseProject};
use tbv_core::{Error, Library};

use crate::sync::{self, SyncWorker};

/// How a move or backup stands, for Preferences › Sync.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveStatus {
    pub running: bool,
    pub mode: Option<MoveMode>,
    pub scope: MoveScope,
    /// Where the library syncs now, and where it's going.
    pub from: Option<ProviderView>,
    pub to: Option<ProviderView>,
    pub progress: MoveProgress,
    pub report: Option<MoveReport>,
    /// A migration that passed its check: sync now goes through the new place.
    pub switched: bool,
    pub error: Option<String>,
    /// Whether "Audio only" can be chosen yet.
    pub audio_ready: bool,
    /// Signed in to a Supabase project to move to, as this email.
    pub supabase_account: Option<String>,
}

#[derive(Default)]
pub struct Mover {
    status: Mutex<MoveStatus>,
    cancel: Arc<AtomicBool>,
    /// A sign-in made for moving to Supabase. The one sync uses is untouched
    /// until a migration switches over.
    supabase: Mutex<Option<(SupabaseProject, Session)>>,
    /// What was last asked for, to try again.
    last: Mutex<Option<(MoveMode, MoveScope, Provider)>>,
    told: Mutex<Option<Instant>>,
}

const TELL_EVERY: Duration = Duration::from_millis(250);

fn unavailable() -> Error {
    Error::Unsuitable("the library is unavailable".into())
}

impl Mover {
    pub fn status(&self) -> MoveStatus {
        let mut status = self.status.lock().map(|s| s.clone()).unwrap_or_default();
        status.audio_ready = moving::audio_ready();
        status.supabase_account = self.supabase.lock().ok().and_then(|s| s.as_ref().map(|(_, s)| s.email.clone()));
        status
    }

    /// Signs in to a Supabase project to move to. False means Supabase
    /// emailed a link to confirm the address first.
    pub fn sign_in(&self, project: SupabaseProject, email: &str, password: &str, create: bool) -> tbv_core::Result<bool> {
        let session = if create {
            match supabase::sign_up(&project, email.trim(), password)? {
                Some(session) => session,
                None => return Ok(false),
            }
        } else {
            supabase::sign_in(&project, email.trim(), password)?
        };
        if let Ok(mut saved) = self.supabase.lock() {
            *saved = Some((project, session));
        }
        Ok(true)
    }

    pub fn sign_out(&self) {
        if let Ok(mut saved) = self.supabase.lock() {
            *saved = None;
        }
    }

    /// Where the library is going. Supabase uses the sign-in made for the
    /// move, or the one already saved here if sync isn't using it.
    fn destination(&self, library: &Library, to: &Provider) -> tbv_core::Result<Destination> {
        match to {
            Provider::Off => Err(Error::Unsuitable("Choose where to copy your library.".into())),
            Provider::Supabase => {
                if let Some((project, session)) = self.supabase.lock().ok().and_then(|s| s.clone()) {
                    return Ok(Destination::Supabase { project, session });
                }
                match (library.sync_provider()?, library.supabase_project()?, library.sync_session()?) {
                    (current, Some(project), Some(session)) if current != Provider::Supabase => Ok(Destination::Supabase { project, session }),
                    _ => Err(Error::Unsuitable("Sign in to the Supabase project you're moving to first.".into())),
                }
            }
            other => Ok(Destination::Files(other.clone())),
        }
    }

    /// Starts copying the library in the background.
    pub fn start(
        self: &Arc<Self>,
        app: &AppHandle,
        library: &Arc<Mutex<Library>>,
        worker: &Arc<SyncWorker>,
        mode: MoveMode,
        scope: MoveScope,
        to: Provider,
    ) -> tbv_core::Result<()> {
        let (destination, from) = {
            let l = library.lock().map_err(|_| unavailable())?;
            let destination = self.destination(&l, &to)?;
            if destination.is_current(&l)? {
                return Err(Error::Unsuitable("Your library already syncs there. Choose another service.".into()));
            }
            (destination, l.sync_provider()?)
        };
        {
            let mut status = self.status.lock().map_err(|_| unavailable())?;
            if status.running {
                return Err(Error::Unsuitable("Your library is already on its way. Wait for it to finish, or stop it first.".into()));
            }
            *status = MoveStatus {
                running: true,
                mode: Some(mode),
                scope,
                from: (from != Provider::Off).then(|| from.view()),
                to: Some(to.view()),
                ..Default::default()
            };
        }
        if let Ok(mut last) = self.last.lock() {
            *last = Some((mode, scope, to));
        }
        self.cancel.store(false, Ordering::Relaxed);
        self.tell(app, true);
        let (mover, app, library, worker) = (self.clone(), app.clone(), library.clone(), worker.clone());
        thread::spawn(move || {
            let outcome = mover.run(&app, &library, mode, scope, destination, from);
            let mut switched = false;
            if let Ok(mut status) = mover.status.lock() {
                status.running = false;
                match outcome {
                    Ok((report, moved)) => {
                        switched = moved;
                        status.switched = moved;
                        status.report = Some(report);
                    }
                    Err(e) => status.error = Some(e.to_string()),
                }
            }
            if switched {
                if let Ok(l) = library.lock() {
                    let _ = app.emit("sync-status", sync::status(&l, false));
                }
                worker.sync_now();
            }
            mover.tell(&app, true);
        });
        Ok(())
    }

    /// Runs the last move again. Only what's still missing is copied.
    pub fn again(self: &Arc<Self>, app: &AppHandle, library: &Arc<Mutex<Library>>, worker: &Arc<SyncWorker>) -> tbv_core::Result<()> {
        let last = self.last.lock().ok().and_then(|l| l.clone());
        let Some((mode, scope, to)) = last else {
            return Err(Error::Unsuitable("There's nothing to try again.".into()));
        };
        self.start(app, library, worker, mode, scope, to)
    }

    pub fn cancel(&self) {
        self.cancel.store(true, Ordering::Relaxed);
    }

    /// Puts away a finished move's result.
    pub fn clear(&self, app: &AppHandle) {
        if let Ok(mut status) = self.status.lock() {
            if !status.running {
                *status = MoveStatus::default();
            }
        }
        self.tell(app, true);
    }

    /// The copy itself. True alongside the report when sync switched over.
    fn run(
        &self,
        app: &AppHandle,
        library: &Arc<Mutex<Library>>,
        mode: MoveMode,
        scope: MoveScope,
        destination: Destination,
        from_provider: Provider,
    ) -> tbv_core::Result<(MoveReport, bool)> {
        let device = library.lock().map_err(|_| unavailable())?.device_id()?;
        // The old place, opened outside the lock (a folder or server can be slow).
        let mut from: Option<Cloud> = match &from_provider {
            Provider::Supabase | Provider::Off => {
                let l = library.lock().map_err(|_| unavailable())?;
                sync::connect(library, &l)?
            }
            other => Some(Cloud::Files(core_sync::open_files(other, device.clone())?.0)),
        };
        // The new place. A folder is read back as a device that never wrote
        // there would read it, so this device's own changes count too.
        let (mut to, mut check): (Box<dyn Remote>, Option<Box<dyn Remote>>) = match &destination {
            Destination::Supabase { project, session } => (Box::new(Supabase::new(project.clone(), session.clone(), device.clone())), None),
            Destination::Files(provider) => (
                Box::new(core_sync::open_files(provider, device.clone())?.0),
                Some(Box::new(core_sync::open_files(provider, format!("{device}-check"))?.0)),
            ),
        };
        let run = MoveRun {
            scope,
            from: from.as_mut().map(|f| f as &mut dyn Remote),
            to: to.as_mut(),
            check: check.as_mut().map(|c| c.as_mut() as &mut dyn Remote),
            cancel: &self.cancel,
            progress: &mut |p| {
                if let Ok(mut status) = self.status.lock() {
                    status.progress = p.clone();
                }
                self.tell(app, false);
            },
        };
        let outcome = moving::copy_library(library, run);
        if let (Some(from), Ok(l)) = (&from, library.lock()) {
            sync::keep_session(&l, from, &outcome);
        }
        let report = outcome?;
        let passed = report.check.as_ref().is_some_and(|c| c.passed()) && !report.cancelled;
        if mode != MoveMode::Migrate || !passed {
            return Ok((report, false));
        }
        let mut l = library.lock().map_err(|_| unavailable())?;
        // Someone chose another service meanwhile: leave their choice be.
        if l.sync_provider()? != from_provider {
            return Err(Error::Unsuitable(
                "Everything was copied, but sync was changed while it went, so TBV didn't switch over. Choose the new service above to sync there."
                    .into(),
            ));
        }
        l.adopt_move(&destination, report.check.as_ref().expect("checked"), scope)?;
        drop(l);
        if let Destination::Supabase { .. } = destination {
            self.sign_out();
        }
        Ok((report, true))
    }

    fn tell(&self, app: &AppHandle, always: bool) {
        let Ok(mut told) = self.told.lock() else { return };
        if !always && told.is_some_and(|at| at.elapsed() < TELL_EVERY) {
            return;
        }
        *told = Some(Instant::now());
        drop(told);
        let _ = app.emit("move-changed", self.status());
    }
}

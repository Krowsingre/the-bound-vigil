//! Looks out for other devices' changes in the cloud services TBV signs in
//! to (Supabase, Dropbox, Google Drive, OneDrive, WebDAV) while TBV is open,
//! so they arrive within moments instead of at the next scheduled check.
//! Each service is asked in the cheapest way it offers:
//!
//! - Supabase tells TBV the moment a change is saved, over a live
//!   connection, and is also asked once a minute in one small question.
//! - Dropbox holds a question open until something changes.
//! - Google Drive keeps a list of changes, looked at once a minute.
//! - OneDrive and WebDAV folders are looked at once a minute.
//!
//! Folders kept by a cloud app are watched on disk instead (folder_watch.rs,
//! and iCloud on iPhone). Only other devices' changes count, and sync is
//! only set off when it runs by itself (Automatic).

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use tbv_core::sync::supabase::{self, Hung};
use tbv_core::sync::{self as core_sync, Cloud, Frequency, Provider};
use tbv_core::{Error, Library};

use crate::sync::SyncWorker;

/// How often a service without a way to wait for changes is asked.
const CHECK_EVERY: Duration = Duration::from_secs(60);
/// The fewest seconds between syncs these checks set off.
const AT_MOST_EVERY: Duration = Duration::from_secs(20);
/// After trouble (offline, say), the wait before asking again.
const AFTER_TROUBLE: Duration = Duration::from_secs(2 * 60);
/// A project without live updates turned on is tried again after this.
const NOT_SET_UP_WAIT: Duration = Duration::from_secs(30 * 60);

#[derive(Clone, Copy, PartialEq)]
enum Lane {
    Main,
    Also,
}

/// What this lane syncs with now, when it's a service these checks are for
/// and sync runs by itself.
fn watched(library: &Mutex<Library>, lane: Lane) -> Option<Provider> {
    let l = library.lock().ok()?;
    if l.sync_options().ok()?.frequency != Frequency::Automatic {
        return None;
    }
    let provider = match lane {
        Lane::Main => l.sync_provider().ok()?,
        Lane::Also => l.sync_also().ok()??,
    };
    match provider {
        Provider::Supabase | Provider::Cloud(_) | Provider::WebDav(_) => Some(provider),
        Provider::Folder { .. } | Provider::Off => None,
    }
}

/// Sets off a sync, at most once every AT_MOST_EVERY across all the checks.
/// News heard sooner isn't dropped: it sets off one more sync once the wait
/// is over, since the check that heard it won't report it again.
struct Nudger {
    worker: Arc<SyncWorker>,
    /// When the last sync was set off, and whether one more is waiting.
    last: Mutex<(Option<Instant>, bool)>,
}

impl Nudger {
    fn nudge(self: &Arc<Self>) {
        let Ok(mut last) = self.last.lock() else { return };
        let wait = last.0.and_then(|at| AT_MOST_EVERY.checked_sub(at.elapsed()));
        match wait {
            None => {
                *last = (Some(Instant::now()), false);
                self.worker.nudge();
            }
            Some(_) if last.1 => {}
            Some(wait) => {
                last.1 = true;
                let me = self.clone();
                thread::spawn(move || {
                    thread::sleep(wait);
                    if let Ok(mut last) = me.last.lock() {
                        *last = (Some(Instant::now()), false);
                    }
                    me.worker.nudge();
                });
            }
        }
    }
}

pub fn start(library: Arc<Mutex<Library>>, worker: Arc<SyncWorker>) {
    let nudger = Arc::new(Nudger { worker, last: Mutex::new((None, false)) });
    for lane in [Lane::Main, Lane::Also] {
        let (library, nudger) = (library.clone(), nudger.clone());
        thread::spawn(move || watch_lane(&library, lane, &nudger));
    }
}

/// Sleeps for `wait`, a second at a time, coming back early if the lane's
/// service changes meanwhile.
fn rest(library: &Mutex<Library>, lane: Lane, wait: Duration, provider: &Option<Provider>) -> bool {
    let until = Instant::now() + wait;
    let mut seconds = 0u32;
    while Instant::now() < until {
        thread::sleep(Duration::from_secs(1));
        seconds += 1;
        if seconds.is_multiple_of(10) && watched(library, lane) != *provider {
            return false;
        }
    }
    true
}

fn watch_lane(library: &Arc<Mutex<Library>>, lane: Lane, nudger: &Arc<Nudger>) {
    loop {
        let provider = watched(library, lane);
        let Some(chosen) = provider.clone() else {
            thread::sleep(Duration::from_secs(10));
            continue;
        };
        let outcome = match &chosen {
            Provider::Supabase => watch_supabase(library, lane, &provider, nudger),
            other => watch_store(library, lane, other, &provider, nudger),
        };
        // Not signed in yet (a first run, say) counts as trouble too, so
        // asking again waits; and even a clean end never loops at once.
        let wait = if outcome.is_err() { AFTER_TROUBLE } else { Duration::from_secs(2) };
        rest(library, lane, wait, &provider);
    }
}

fn mine(library: &Mutex<Library>) -> tbv_core::Result<String> {
    library.lock().map_err(|_| Error::Unsuitable("the library is unavailable".into()))?.device_id()
}

/// Dropbox, Google Drive, OneDrive or WebDAV, until its choice changes.
fn watch_store(library: &Mutex<Library>, lane: Lane, chosen: &Provider, provider: &Option<Provider>, nudger: &Arc<Nudger>) -> tbv_core::Result<()> {
    let device = mine(library)?;
    let mut store = core_sync::open_store(chosen)?;
    let waits = matches!(chosen, Provider::Cloud(a) if a.service == core_sync::cloud::Service::Dropbox);
    loop {
        match store.news(&device)? {
            Some(true) => nudger.nudge(),
            Some(false) => {}
            None => return Ok(()),
        }
        // Dropbox's question waits for a change itself.
        let pause = if waits { Duration::from_secs(1) } else { CHECK_EVERY };
        if !rest(library, lane, pause, provider) || watched(library, lane) != *provider {
            return Ok(());
        }
    }
}

/// Supabase: a live connection, with a small question once a minute as well
/// (which also keeps the sign-in renewed for the live connection).
fn watch_supabase(library: &Arc<Mutex<Library>>, lane: Lane, provider: &Option<Provider>, nudger: &Arc<Nudger>) -> tbv_core::Result<()> {
    let device = mine(library)?;
    let client = {
        let l = library.lock().map_err(|_| Error::Unsuitable("the library is unavailable".into()))?;
        match lane {
            Lane::Main => crate::sync::connect(library, &l)?,
            Lane::Also => crate::sync::connect_also(library, &l)?,
        }
    };
    // The sign-in it renews along the way is saved as it goes.
    let Some(Cloud::Supabase(mut client)) = client else {
        return Err(Error::Unsuitable("not signed in to Supabase yet".into()));
    };
    let project = library.lock().ok().and_then(|l| l.supabase_project().ok().flatten());

    // The live connection runs beside the questions, until this choice ends.
    let run = Arc::new(AtomicU64::new(1));
    if let Some(project) = project {
        let (library, nudger, run, provider, device) = (library.clone(), nudger.clone(), run.clone(), provider.clone(), device.clone());
        thread::spawn(move || loop {
            let token = || library.lock().ok().and_then(|l| l.sync_session().ok().flatten()).map(|s| s.access_token);
            let stop = || run.load(Ordering::Relaxed) == 0;
            let hung = supabase::listen(&project, &device, &token, &mut || nudger.nudge(), &stop);
            if stop() {
                return;
            }
            let wait = match hung {
                Ok(Hung::Stopped) => return,
                Ok(Hung::NotSetUp) => NOT_SET_UP_WAIT,
                Ok(Hung::Dropped) => Duration::from_secs(15),
                Err(_) => AFTER_TROUBLE,
            };
            if !rest(&library, lane, wait, &provider) {
                return;
            }
        });
    }

    let mut seen = None;
    let outcome = loop {
        match client.news(&mut seen) {
            Ok(true) => nudger.nudge(),
            Ok(false) => {}
            Err(e) => break Err(e),
        }
        if !rest(library, lane, CHECK_EVERY, provider) || watched(library, lane) != *provider {
            break Ok(());
        }
    };
    run.store(0, Ordering::Relaxed);
    outcome
}

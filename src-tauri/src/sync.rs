//! Runs sync in the background: when TBV opens, on the schedule the user
//! picked, when asked, and once more on the way out. The library is only
//! locked while it is read or written, never while waiting on the network.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter};
use tbv_core::model::{SyncState, SyncStatus};
use tbv_core::sync::supabase::{self, Supabase};
use tbv_core::sync::{self as core_sync, Frequency};
use tbv_core::{Error, Library};

enum Wake {
    Now,
    /// Sync one last time (if the user wants that), then say so.
    Closing(mpsc::Sender<()>),
}

/// The sync worker: its thread runs every sync, one at a time.
pub struct SyncWorker {
    wake: Mutex<mpsc::Sender<Wake>>,
    busy: Arc<AtomicBool>,
}

/// How long automatic sync waits after the last pull before checking the
/// cloud again when nothing changed here.
const QUIET_PULL: Duration = Duration::from_secs(5 * 60);
const AUTOMATIC_TICK: Duration = Duration::from_secs(60);

impl SyncWorker {
    pub fn start(app: AppHandle, library: Arc<Mutex<Library>>) -> Self {
        let (tx, rx) = mpsc::channel();
        let busy = Arc::new(AtomicBool::new(false));
        let worker_busy = busy.clone();
        thread::spawn(move || {
            let startup = library.lock().ok().and_then(|l| l.sync_options().ok()).is_some_and(|o| o.on_startup);
            let mut last_run = if startup { None } else { Some(Instant::now()) };
            loop {
                let options = library.lock().ok().and_then(|l| l.sync_options().ok()).unwrap_or_default();
                let due = match last_run {
                    None => true,
                    Some(at) => match options.frequency {
                        Frequency::Automatic => at.elapsed() >= QUIET_PULL || has_changes(&library),
                        Frequency::Every15Minutes => at.elapsed() >= Duration::from_secs(15 * 60),
                        Frequency::Hourly => at.elapsed() >= Duration::from_secs(60 * 60),
                        Frequency::Manual => false,
                    },
                };
                if due {
                    run(&app, &library, &worker_busy);
                    last_run = Some(Instant::now());
                }
                match rx.recv_timeout(AUTOMATIC_TICK) {
                    Ok(Wake::Now) => last_run = None,
                    Ok(Wake::Closing(done)) => {
                        if options.on_close {
                            run(&app, &library, &worker_busy);
                        }
                        let _ = done.send(());
                        return;
                    }
                    Err(RecvTimeoutError::Timeout) => {}
                    Err(RecvTimeoutError::Disconnected) => return,
                }
            }
        });
        Self { wake: Mutex::new(tx), busy }
    }

    /// Asks for a sync as soon as the worker is free.
    pub fn sync_now(&self) {
        if let Ok(tx) = self.wake.lock() {
            let _ = tx.send(Wake::Now);
        }
    }

    pub fn is_busy(&self) -> bool {
        self.busy.load(Ordering::Relaxed)
    }

    /// Lets a last sync finish before the app quits, up to `limit`.
    pub fn finish(&self, limit: Duration) {
        let (done_tx, done_rx) = mpsc::channel();
        let sent = self.wake.lock().map(|tx| tx.send(Wake::Closing(done_tx)).is_ok()).unwrap_or(false);
        if sent {
            let _ = done_rx.recv_timeout(limit);
        }
    }
}

fn has_changes(library: &Mutex<Library>) -> bool {
    library.lock().ok().and_then(|l| l.sync_overview().ok()).is_some_and(|o| o.waiting_to_send > 0)
}

/// A connection to the user's Supabase project, if they've set one up and signed in.
pub fn connect(library: &Library) -> tbv_core::Result<Option<Supabase>> {
    let (Some(project), Some(session)) = (library.supabase_project()?, library.sync_session()?) else {
        return Ok(None);
    };
    Ok(Some(Supabase::new(project, session, library.device_id()?)))
}

/// Saves a renewed sign-in, or forgets one that was withdrawn.
pub fn keep_session(library: &Library, client: &Supabase, outcome: &tbv_core::Result<impl Sized>) {
    if matches!(outcome, Err(Error::SignedOut)) {
        let _ = library.set_sync_session(None);
    } else if client.renewed() {
        let _ = library.set_sync_session(Some(client.session()));
    }
}

pub fn status(library: &Library, busy: bool) -> SyncStatus {
    let mut status = library.sync_status().unwrap_or(SyncStatus { state: SyncState::Error, last_success_at: None });
    if busy && status.state != SyncState::Disabled {
        status.state = SyncState::Syncing;
    }
    status
}

fn emit_status(app: &AppHandle, library: &Mutex<Library>, busy: bool) {
    if let Ok(library) = library.lock() {
        let _ = app.emit("sync-status", status(&library, busy));
    }
}

fn run(app: &AppHandle, library: &Arc<Mutex<Library>>, busy: &AtomicBool) {
    let client = match library.lock().map(|l| connect(&l)) {
        Ok(Ok(Some(client))) => client,
        _ => return,
    };
    let mut client = client;
    busy.store(true, Ordering::Relaxed);
    emit_status(app, library, true);
    let outcome = core_sync::sync_once(library, &mut client);
    if let Ok(library) = library.lock() {
        keep_session(&library, &client, &outcome);
    }
    busy.store(false, Ordering::Relaxed);
    emit_status(app, library, false);
    if let Ok(report) = &outcome {
        if report.received > 0 || report.files_received > 0 {
            let _ = app.emit("library-changed", ());
        }
    }
}

/// Signs in, and starts over with the cloud if it's a different account.
pub fn sign_in(library: &Mutex<Library>, email: &str, password: &str, create: bool) -> tbv_core::Result<bool> {
    let project = library
        .lock()
        .map_err(|_| Error::Unsuitable("the library is unavailable".into()))?
        .supabase_project()?
        .ok_or_else(|| Error::Unsuitable("Set up your Supabase project first.".into()))?;
    let session = if create {
        match supabase::sign_up(&project, email.trim(), password)? {
            Some(session) => session,
            None => return Ok(false),
        }
    } else {
        supabase::sign_in(&project, email.trim(), password)?
    };
    let library = library.lock().map_err(|_| Error::Unsuitable("the library is unavailable".into()))?;
    let before = library.sync_session()?.map(|s| s.user_id);
    if before.as_deref() != Some(session.user_id.as_str()) {
        library.reset_sync()?;
    }
    library.set_sync_session(Some(&session))?;
    Ok(true)
}

pub fn sign_out(library: &Mutex<Library>) -> tbv_core::Result<()> {
    let (project, session) = {
        let library = library.lock().map_err(|_| Error::Unsuitable("the library is unavailable".into()))?;
        let out = (library.supabase_project()?, library.sync_session()?);
        library.set_sync_session(None)?;
        library.reset_sync()?;
        out
    };
    if let (Some(project), Some(session)) = (project, session) {
        supabase::sign_out(&project, &session);
    }
    Ok(())
}

/// Fetches a book that's only in the cloud. Errors say what to do.
pub fn download(library: &Mutex<Library>, book_id: &str) -> tbv_core::Result<()> {
    let client = connect(&*library.lock().map_err(|_| Error::Unsuitable("the library is unavailable".into()))?)?;
    let Some(mut client) = client else {
        return Err(Error::Unsuitable(
            "This book's file is on another device. Sign in to sync (Settings › Sync) to download it here.".into(),
        ));
    };
    let outcome = core_sync::download_book(library, &mut client, book_id);
    if let Ok(library) = library.lock() {
        keep_session(&library, &client, &outcome);
    }
    outcome
}

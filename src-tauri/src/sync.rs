//! Runs sync in the background: when TBV opens, on the schedule the user
//! picked, when asked, and once more on the way out. The library is only
//! locked while it is read or written, never while waiting on the network.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter};
use tbv_core::model::{SyncState, SyncStatus};
use tbv_core::sync::supabase;
use tbv_core::sync::{self as core_sync, Cloud, Frequency, Lane, Provider, Session};
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

/// Saves a renewed Supabase sign-in, or forgets one that was withdrawn.
/// A connection only forgets the sign-in it was using, never a newer one.
pub fn keep_session(library: &Library, cloud: &Cloud, outcome: &tbv_core::Result<impl Sized>) {
    let Cloud::Supabase(client) = cloud else { return };
    let saved = library.sync_session().ok().flatten();
    let still_mine = saved.as_ref().is_some_and(|s| s.refresh_token == client.session().refresh_token);
    if matches!(outcome, Err(Error::SignedOut)) {
        if still_mine {
            let _ = library.set_sync_session(None);
        }
    } else if client.renewed() && (still_mine || saved.as_ref().is_some_and(|s| s.user_id == client.session().user_id)) {
        let _ = library.set_sync_session(Some(client.session()));
    }
}

/// Saves a renewed sign-in the moment it arrives, so quitting mid-sync
/// (or a second connection) never leaves an already-used one saved.
struct LibraryKeeper(Arc<Mutex<Library>>);

impl supabase::SessionKeeper for LibraryKeeper {
    fn latest(&self) -> Option<Session> {
        self.0.lock().ok()?.sync_session().ok().flatten()
    }

    fn save(&self, session: &Session) {
        if let Ok(library) = self.0.lock() {
            // Not if the person signed out (or in as someone else) meanwhile.
            if library.sync_session().ok().flatten().is_some_and(|s| s.user_id == session.user_id) {
                let _ = library.set_sync_session(Some(session));
            }
        }
    }
}

/// The chosen service's connection, with a Supabase sign-in kept up to date.
pub fn connect(library: &Arc<Mutex<Library>>, l: &Library) -> tbv_core::Result<Option<Cloud>> {
    keep(library, l.connect()?)
}

/// As `connect`, for the second place.
pub fn connect_also(library: &Arc<Mutex<Library>>, l: &Library) -> tbv_core::Result<Option<Cloud>> {
    keep(library, l.connect_also()?)
}

fn keep(library: &Arc<Mutex<Library>>, mut cloud: Option<Cloud>) -> tbv_core::Result<Option<Cloud>> {
    if let Some(Cloud::Supabase(client)) = &mut cloud {
        client.keep_session_with(Arc::new(LibraryKeeper(library.clone())));
    }
    Ok(cloud)
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
    let ready = library.lock().ok().and_then(|l| l.sync_status().ok()).is_some_and(|s| s.state != SyncState::Disabled);
    if !ready {
        return;
    }
    busy.store(true, Ordering::Relaxed);
    emit_status(app, library, true);
    // A folder is opened (and a WebDAV server reached) outside the lock.
    // The epoch is read with the choice, so a switch while connecting stops this run.
    let connected = library.lock().map_err(|_| Error::Unsuitable("the library is unavailable".into())).and_then(|l| {
        let provider = l.sync_provider()?;
        let device = l.device_id()?;
        let epoch = l.sync_epoch();
        Ok(match provider {
            Provider::Supabase | Provider::Off => connect(library, &l)?.map(|c| (c, epoch)),
            other => {
                drop(l);
                Some((Cloud::Files(core_sync::open_files(&other, device)?.0), epoch))
            }
        })
    });
    let also = if matches!(connected, Ok(Some(_))) { connect_second(library) } else { None };
    let (mut client, epoch) = match connected {
        Ok(Some((client, epoch))) => (client, epoch),
        Ok(None) => {
            busy.store(false, Ordering::Relaxed);
            emit_status(app, library, false);
            return;
        }
        Err(e) => {
            if let Ok(l) = library.lock() {
                let _ = l.note_sync_failure(&e);
            }
            busy.store(false, Ordering::Relaxed);
            emit_status(app, library, false);
            return;
        }
    };
    let (outcome, also) = match also {
        Some(mut second) => {
            let outcome = core_sync::sync_both_since(library, &mut client, Some(&mut second), epoch);
            (outcome, Some(second))
        }
        None => (core_sync::sync_once_since(library, &mut client, epoch), None),
    };
    if let Ok(library) = library.lock() {
        keep_session(&library, &client, &outcome);
        if let Some(second) = &also {
            keep_session(&library, second, &outcome);
        }
    }
    busy.store(false, Ordering::Relaxed);
    emit_status(app, library, false);
    if let Ok(report) = &outcome {
        if report.received > 0 || report.files_received > 0 {
            let _ = app.emit("library-changed", ());
        }
    }
}

/// The second place's connection, if there is one. Trouble reaching it is
/// noted for Settings, and the first place syncs on its own.
fn connect_second(library: &Arc<Mutex<Library>>) -> Option<Cloud> {
    let l = library.lock().ok()?;
    let provider = l.sync_also().ok()??;
    let outcome = match provider {
        Provider::Supabase | Provider::Off => connect_also(library, &l),
        other => {
            let device = l.device_id().ok()?;
            drop(l);
            core_sync::open_files(&other, device).map(|(files, _)| Some(Cloud::Files(files)))
        }
    };
    match outcome {
        Ok(cloud) => cloud,
        Err(e) => {
            if let Ok(l) = library.lock() {
                let _ = l.note_lane_failure(&e, Lane::Also);
            }
            None
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
    let mut library = library.lock().map_err(|_| Error::Unsuitable("the library is unavailable".into()))?;
    let before = library.sync_session()?.map(|s| s.user_id);
    let also_supabase = library.sync_also()? == Some(Provider::Supabase);
    if before.as_deref() != Some(session.user_id.as_str()) {
        if also_supabase {
            library.reset_also_sync()?;
        } else {
            library.reset_sync()?;
        }
    }
    library.set_sync_session(Some(&session))?;
    // Signing in only switches the main sync to Supabase when nothing else
    // has it: with a folder in use, Supabase can be the second place instead.
    let main = library.sync_provider()?;
    if !also_supabase && matches!(main, Provider::Supabase | Provider::Off) {
        library.set_sync_provider(&Provider::Supabase)?;
    }
    Ok(true)
}

pub fn sign_out(library: &Mutex<Library>) -> tbv_core::Result<()> {
    let (project, session) = {
        let mut library = library.lock().map_err(|_| Error::Unsuitable("the library is unavailable".into()))?;
        let out = (library.supabase_project()?, library.sync_session()?);
        library.set_sync_session(None)?;
        if library.sync_provider()? == Provider::Supabase {
            library.reset_sync()?;
        }
        if library.sync_also()? == Some(Provider::Supabase) {
            library.reset_also_sync()?;
        }
        out
    };
    if let (Some(project), Some(session)) = (project, session) {
        supabase::sign_out(&project, &session);
    }
    Ok(())
}

/// Chooses where the library is kept. A folder or WebDAV server is checked
/// first; the answer says whether it already held a library to join.
pub fn choose(library: &Mutex<Library>, provider: Provider) -> tbv_core::Result<bool> {
    let device = library.lock().map_err(|_| Error::Unsuitable("the library is unavailable".into()))?.device_id()?;
    let existing = match &provider {
        Provider::Supabase | Provider::Off => false,
        other => core_sync::open_files(other, device)?.1,
    };
    library.lock().map_err(|_| Error::Unsuitable("the library is unavailable".into()))?.set_sync_provider(&provider)?;
    Ok(existing)
}

/// Chooses (or, with `None`, stops) the second place. As with the first, a
/// folder or server is checked first and the answer says whether it already
/// held a library.
pub fn choose_also(library: &Mutex<Library>, provider: Option<Provider>) -> tbv_core::Result<bool> {
    let lock = || library.lock().map_err(|_| Error::Unsuitable("the library is unavailable".into()));
    let device = lock()?.device_id()?;
    let existing = match &provider {
        Some(Provider::Supabase) => {
            let l = lock()?;
            if l.supabase_project()?.is_none() || l.sync_session()?.is_none() {
                return Err(Error::Unsuitable("Set up Supabase and sign in on its card first.".into()));
            }
            false
        }
        Some(Provider::Off) | None => false,
        Some(other) => core_sync::open_files(other, device)?.1,
    };
    lock()?.set_sync_also(provider.as_ref())?;
    Ok(existing)
}

/// Fetches a book that's only in the cloud. Errors say what to do.
pub fn download(library: &Arc<Mutex<Library>>, book_id: &str) -> tbv_core::Result<()> {
    let client = {
        let l = library.lock().map_err(|_| Error::Unsuitable("the library is unavailable".into()))?;
        connect(library, &l)?
    };
    let second = connect_second(library);
    if client.is_none() && second.is_none() {
        return Err(Error::Unsuitable(
            "This book's file is on another device. Set up sync (Settings › Sync) to download it here.".into(),
        ));
    }
    // The first place, then the second if the first hasn't got it.
    for (cloud, lane) in [(client, Lane::Main), (second, Lane::Also)] {
        let Some(mut cloud) = cloud else { continue };
        let outcome = core_sync::download_book_from(library, &mut cloud, book_id, lane);
        if let Ok(library) = library.lock() {
            keep_session(&library, &cloud, &outcome);
        }
        if outcome? {
            return Ok(());
        }
    }
    Err(core_sync::not_in_cloud())
}

/// Where each cloud app usually keeps its folder on Windows. Only a folder
/// that's really there is suggested.
pub fn likely_folder(service: &str) -> Option<PathBuf> {
    let home = PathBuf::from(std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME"))?);
    let candidates: Vec<PathBuf> = match service {
        "icloud" => vec![home.join("iCloudDrive"), home.join("iCloud Drive")],
        "dropbox" => vec![home.join("Dropbox")],
        "onedrive" => {
            let mut found: Vec<PathBuf> = std::env::var_os("OneDrive").map(PathBuf::from).into_iter().collect();
            found.push(home.join("OneDrive"));
            found
        }
        "gdrive" => {
            let mut found: Vec<PathBuf> = ('D'..='Z').map(|d| PathBuf::from(format!("{d}:\\My Drive"))).collect();
            found.push(home.join("Google Drive").join("My Drive"));
            found.push(home.join("Google Drive"));
            found
        }
        "mega" => vec![home.join("MEGA"), home.join("MEGAsync"), home.join("Documents").join("MEGAsync")],
        _ => Vec::new(),
    };
    candidates.into_iter().find(|p| p.is_dir())
}

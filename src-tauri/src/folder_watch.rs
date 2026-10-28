//! Watches the synced folders a cloud app keeps (iCloud, Dropbox, OneDrive,
//! MEGA…) so another device's changes are read the moment the cloud app
//! brings them down, not at the next scheduled check. Only other devices'
//! change files count; TBV's own writes never set it off.

use std::path::PathBuf;
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use notify::{RecursiveMode, Watcher};
use tbv_core::Library;

use crate::sync::SyncWorker;

/// How long to wait after the last change, so a cloud app that writes
/// several files in a row sets off one sync, not one each.
const SETTLE: Duration = Duration::from_secs(3);
/// The fewest seconds between syncs the folder sets off.
const AT_MOST_EVERY: Duration = Duration::from_secs(20);
/// How often to look whether the synced folders changed (a new place chosen,
/// or a cloud app's folder appearing after it starts).
const RECHECK: Duration = Duration::from_secs(30);

pub fn start(library: Arc<Mutex<Library>>, worker: Arc<SyncWorker>) {
    thread::spawn(move || {
        let (tx, rx) = mpsc::channel::<PathBuf>();
        let mut watcher = match notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
            if let Ok(event) = event {
                for path in event.paths {
                    let _ = tx.send(path);
                }
            }
        }) {
            Ok(watcher) => watcher,
            Err(_) => return,
        };
        let mut watching: Vec<PathBuf> = Vec::new();
        let mut checked = Instant::now() - RECHECK;
        let mut pending: Option<Instant> = None;
        let mut last_sync = Instant::now() - AT_MOST_EVERY;
        let mut mine = String::new();
        loop {
            if checked.elapsed() >= RECHECK {
                checked = Instant::now();
                let (folders, device) = match library.lock() {
                    Ok(l) => (l.synced_folders(), l.device_id().unwrap_or_default()),
                    Err(_) => return,
                };
                mine = device;
                if folders != watching {
                    for old in &watching {
                        let _ = watcher.unwatch(old);
                    }
                    watching = folders.into_iter().filter(|f| watcher.watch(f, RecursiveMode::Recursive).is_ok()).collect();
                }
            }
            match rx.recv_timeout(Duration::from_secs(1)) {
                Ok(path) => {
                    if !mine.is_empty() && tbv_core::sync::files::is_news_from_elsewhere(&path, &mine) {
                        pending = Some(Instant::now());
                    }
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => return,
            }
            if pending.is_some_and(|at| at.elapsed() >= SETTLE) && last_sync.elapsed() >= AT_MOST_EVERY {
                pending = None;
                last_sync = Instant::now();
                worker.nudge();
            }
        }
    });
}

//! Syncing while TBV is closed, on iPhone and iPad. iOS wakes TBV in the
//! background now and then (Background App Refresh: how often is up to
//! iOS, which learns when TBV gets used), and TBV syncs once, so it's
//! already caught up the next time it opens. The waking is booked in the
//! iOS plugin (BackgroundWork.swift); this answers it.

use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};

use crate::sync::SyncWorker;

static WORKER: OnceLock<Arc<SyncWorker>> = OnceLock::new();

/// iOS gives a background refresh about 30 seconds in all.
const OPENING_AT_MOST: Duration = Duration::from_secs(8);
const SYNC_AT_MOST: Duration = Duration::from_secs(20);

/// The sync worker has started.
pub fn ready(worker: Arc<SyncWorker>) {
    let _ = WORKER.set(worker);
}

/// Called by the iOS plugin when iOS wakes TBV to sync. `done` is told
/// whether the sync finished in time.
#[no_mangle]
pub extern "C" fn tbv_background_sync(done: extern "C" fn(bool)) {
    std::thread::spawn(move || {
        // Woken from closed, TBV may still be opening.
        let began = Instant::now();
        let worker = loop {
            if let Some(worker) = WORKER.get() {
                break Some(worker);
            }
            if began.elapsed() > OPENING_AT_MOST {
                break None;
            }
            std::thread::sleep(Duration::from_millis(100));
        };
        done(worker.is_some_and(|w| w.sync_in_background(SYNC_AT_MOST)));
    });
}

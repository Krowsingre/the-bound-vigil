//! On iPhone and iPad: what to do when TBV comes back on screen (read the
//! cloud's news and anything shared to TBV meanwhile) and when iCloud brings
//! another device's changes into the synced folder.

use std::sync::Arc;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager};

use crate::sync::SyncWorker;
use crate::AppLibrary;

/// The fewest seconds between syncs iCloud's changes set off.
const AT_MOST_EVERY: Duration = Duration::from_secs(20);

pub fn listen(app: AppHandle) {
    std::thread::spawn(move || {
        let mut last_sync = Instant::now() - AT_MOST_EVERY;
        while let Some(event) = tauri_plugin_tbv_ios::cloud_event() {
            let Some(worker) = app.try_state::<Arc<SyncWorker>>() else { continue };
            if event.came_back {
                crate::shared::check(&app);
            } else {
                let mine = app.try_state::<AppLibrary>().and_then(|l| l.0.lock().ok().and_then(|l| l.device_id().ok()));
                let Some(mine) = mine else { continue };
                if !event.paths.iter().any(|p| tbv_core::sync::files::is_news_from_elsewhere(p, &mine)) {
                    continue;
                }
                // Changes arriving meanwhile gather on the Swift side, for the next one.
                if let Some(wait) = AT_MOST_EVERY.checked_sub(last_sync.elapsed()) {
                    std::thread::sleep(wait);
                }
            }
            last_sync = Instant::now();
            worker.sync_now();
        }
    });
}

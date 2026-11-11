// Both Windows close entry points hide TBV right away, then keep the webview
// alive long enough to save reading, listening and writing progress.
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager, Window};

use crate::{hardcover, sync};

static REQUESTED: AtomicBool = AtomicBool::new(false);
static FINISHING: AtomicBool = AtomicBool::new(false);

fn hide(app: &AppHandle) {
    for window in app.webview_windows().values() {
        let _ = window.hide();
    }
}

pub(super) fn request(window: &Window) {
    if REQUESTED.swap(true, Ordering::AcqRel) {
        return;
    }
    let app = window.app_handle().clone();
    hide(&app);
    let _ = window.emit("tbv://quit-requested", ());
    // The page normally acknowledges after flushing. If it hasn't loaded
    // or has stopped responding, quit once the save window has passed.
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(2));
        finish(app);
    });
}

pub(super) fn finish(app: AppHandle) {
    if FINISHING.swap(true, Ordering::AcqRel) {
        return;
    }
    if !REQUESTED.swap(true, Ordering::AcqRel) {
        hide(&app);
    }
    std::thread::spawn(move || {
        let sends = app.try_state::<Arc<hardcover::Sends>>().map(|s| s.inner().clone());
        let ratings = sends.map(|sends| std::thread::spawn(move || sends.finish(Duration::from_secs(5))));
        if let Some(worker) = app.try_state::<Arc<sync::SyncWorker>>() {
            worker.finish(Duration::from_secs(8));
        }
        if let Some(ratings) = ratings {
            let _ = ratings.join();
        }
        app.exit(0);
    });
}

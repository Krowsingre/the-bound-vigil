//! The Stop buttons on downloads (cloud books, Nexus's own downloads, Libram
//! and Audiobookshelf). Each download runs under a name; Stop sets its flag,
//! its next write fails (see `tbv_core::stop`), and the partial file goes.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use tbv_core::stop::STOPPED;

static RUNNING: Mutex<Option<HashMap<String, Arc<AtomicBool>>>> = Mutex::new(None);

/// Runs a download under `name` so it can be stopped. A stopped download
/// ends with "Stopped.", whatever went wrong as it ended; one that finished
/// just as Stop was pressed counts as finished.
pub fn run<T>(name: &str, work: impl FnOnce() -> tbv_core::Result<T>) -> tbv_core::Result<T> {
    let flag = Arc::new(AtomicBool::new(false));
    if let Ok(mut running) = RUNNING.lock() {
        running.get_or_insert_with(HashMap::new).insert(name.to_string(), flag.clone());
    }
    let out = tbv_core::stop::watching(flag.clone(), work);
    if let Ok(mut running) = RUNNING.lock() {
        if let Some(running) = running.as_mut() {
            if running.get(name).is_some_and(|f| Arc::ptr_eq(f, &flag)) {
                running.remove(name);
            }
        }
    }
    match out {
        Err(_) if flag.load(Ordering::Relaxed) => Err(tbv_core::stop::error()),
        other => other,
    }
}

/// Whether an error is a download that was stopped.
pub fn was_stopped(error: &str) -> bool {
    error == STOPPED
}

/// Stops one download. False if it isn't running (it may have just finished).
pub fn stop(name: &str) -> bool {
    RUNNING.lock().ok().and_then(|r| r.as_ref().and_then(|r| r.get(name).cloned())).is_some_and(|flag| {
        flag.store(true, Ordering::Relaxed);
        true
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn a_stopped_download_ends_stopped_and_leaves_the_list() {
        let (started, go) = (std::sync::mpsc::channel(), std::sync::mpsc::channel::<()>());
        let (tell, wait) = (started.0, go.1);
        let worker = std::thread::spawn(move || {
            run("book:one", || {
                tell.send(()).unwrap();
                wait.recv().unwrap();
                let mut sink = tbv_core::stop::watched(Vec::new());
                sink.write_all(b"more").map_err(tbv_core::Error::from)
            })
        });
        started.1.recv().unwrap();
        assert!(stop("book:one"));
        go.0.send(()).unwrap();
        let ended = worker.join().unwrap();
        assert!(matches!(&ended, Err(e) if was_stopped(&e.to_string())));
        assert!(!stop("book:one"), "it's off the list once it ends");
    }
}

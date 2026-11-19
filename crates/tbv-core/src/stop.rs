//! Stopping a download part-way. The command that starts a download hands
//! its thread a flag (`watching`); everything that writes a download's bytes
//! writes through `Watched`, which fails once the flag is set. The transfer
//! ends where it is, and the code around it deletes the partial file, as it
//! does for any failed download.

use std::cell::RefCell;
use std::io::{self, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

/// What a stopped download says.
pub const STOPPED: &str = "Stopped.";

thread_local! {
    static FLAG: RefCell<Option<Arc<AtomicBool>>> = const { RefCell::new(None) };
}

/// Runs `work` on this thread with `flag` as its stop button.
pub fn watching<T>(flag: Arc<AtomicBool>, work: impl FnOnce() -> T) -> T {
    let before = FLAG.with(|f| f.replace(Some(flag)));
    let out = work();
    FLAG.with(|f| *f.borrow_mut() = before);
    out
}

/// Whether the download on this thread has been stopped.
pub fn stopped() -> bool {
    FLAG.with(|f| f.borrow().as_ref().is_some_and(|f| f.load(Ordering::Relaxed)))
}

/// Runs `work`, something that only waits (like iCloud bringing a file
/// down), on a thread of its own, and stops waiting for it as soon as this
/// thread's download is stopped: None then. The work carries on by itself
/// until it ends; nothing is written by it. Runs `work` here when nothing is
/// watching this thread.
pub fn unless_stopped<T: Send + 'static>(work: impl FnOnce() -> T + Send + 'static) -> Option<T> {
    use std::sync::mpsc::{channel, RecvTimeoutError};
    let Some(flag) = FLAG.with(|f| f.borrow().clone()) else {
        return Some(work());
    };
    if flag.load(Ordering::Relaxed) {
        return None;
    }
    let (done, answer) = channel();
    std::thread::spawn(move || {
        let _ = done.send(work());
    });
    loop {
        match answer.recv_timeout(std::time::Duration::from_millis(200)) {
            Ok(out) => return Some(out),
            Err(RecvTimeoutError::Timeout) if !flag.load(Ordering::Relaxed) => {}
            Err(_) => return None,
        }
    }
}

/// The error a stopped download ends with.
pub fn error() -> crate::Error {
    crate::Error::Unsuitable(STOPPED.into())
}

/// A file being written by a download: each write fails once it's stopped.
pub struct Watched<W>(pub W);

impl<W: Write> Write for Watched<W> {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        if stopped() {
            // Not `Interrupted`: `io::copy` would simply try again.
            return Err(io::Error::other(STOPPED));
        }
        self.0.write(buf)
    }

    fn flush(&mut self) -> io::Result<()> {
        self.0.flush()
    }
}

/// Wraps what a download writes to.
pub fn watched<W: Write>(out: W) -> Watched<W> {
    Watched(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_fail_once_stopped_and_only_on_that_thread() {
        let flag = Arc::new(AtomicBool::new(false));
        let mut out = Vec::new();
        watching(flag.clone(), || {
            let mut w = watched(&mut out);
            assert!(w.write_all(b"one").is_ok());
            flag.store(true, Ordering::Relaxed);
            assert!(w.write_all(b"two").is_err());
            // Another thread isn't watching this flag.
            std::thread::spawn(|| assert!(!stopped())).join().unwrap();
        });
        assert_eq!(out, b"one");
        // Once the work is done, nothing's watched.
        assert!(!stopped());
        assert!(watched(Vec::new()).write_all(b"three").is_ok());
    }

    #[test]
    fn waiting_ends_when_stopped() {
        // Nothing watching: the work runs and answers.
        assert_eq!(unless_stopped(|| 1), Some(1));
        let flag = Arc::new(AtomicBool::new(false));
        watching(flag.clone(), || {
            assert_eq!(unless_stopped(|| 2), Some(2));
            let stopper = flag.clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(100));
                stopper.store(true, Ordering::Relaxed);
            });
            let started = std::time::Instant::now();
            // Would wait a minute; Stop ends the wait.
            assert_eq!(unless_stopped(|| std::thread::sleep(std::time::Duration::from_secs(60))), None);
            assert!(started.elapsed() < std::time::Duration::from_secs(5));
        });
    }
}

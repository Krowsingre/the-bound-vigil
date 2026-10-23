//! LocalSend in the app (Preferences › Servers): while it's on, TBV shows up in
//! LocalSend on phones and computers on the same Wi-Fi. Each offer is put to
//! the person first; the books they accept go into the import queue, and the
//! received files are deleted once they're in. Books can be sent the other
//! way too, to any device nearby with LocalSend open.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tbv_core::localsend::{self, FileState, Host, Identity, Nearby, Offer, Receiver, SentFile, ToSend, Tls};
use tbv_core::Library;

use crate::imports::{Hold, Imports};

const ENABLED_KEY: &str = "localsend.enabled";
const CERT_KEY: &str = "localsend.cert";
const CERT_KEY_KEY: &str = "localsend.key";

type Answer = Box<dyn FnOnce(bool) + Send>;

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalSendStatus {
    pub enabled: bool,
    pub running: bool,
    /// How TBV shows in LocalSend's list.
    pub alias: String,
    pub problem: Option<String>,
}

/// The most rows the Imports page keeps for LocalSend.
const MAX_ROWS: usize = 1000;

/// Every file sent this run, newest delivery first, for the Imports page.
type Rows = Arc<Mutex<Vec<SentFile>>>;

#[derive(Default)]
pub struct LocalSend {
    receiver: Mutex<Option<Receiver>>,
    problem: Mutex<Option<String>>,
    answers: Arc<Mutex<HashMap<String, Answer>>>,
    rows: Rows,
    /// Set to stop what's being sent.
    stop_sending: Mutex<Arc<AtomicBool>>,
}

/// How sending is going, for the person to follow.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Sending {
    /// Which book, counting from 1, of how many.
    pub book: usize,
    pub books: usize,
    pub title: String,
    pub bytes: u64,
    pub size: u64,
}

/// Received files, deleted once their book is in, along with their
/// delivery's folder when that's empty.
struct Inbox(PathBuf);

impl Drop for Inbox {
    fn drop(&mut self) {
        if self.0.is_dir() {
            let _ = std::fs::remove_dir_all(&self.0);
        } else {
            let _ = std::fs::remove_file(&self.0);
        }
        if let Some(parent) = self.0.parent() {
            let _ = std::fs::remove_dir(parent);
        }
    }
}

struct AppHost {
    app: AppHandle,
    library: Arc<Mutex<Library>>,
    imports: Arc<Imports>,
    answers: Arc<Mutex<HashMap<String, Answer>>>,
    rows: Rows,
}

impl AppHost {
    fn import(&self, sources: Vec<PathBuf>) {
        let sources = sources.into_iter().map(|f| (f.clone(), Some(Arc::new(Inbox(f)) as Hold))).collect();
        self.imports.queue_sources(&self.app, &self.library, sources);
    }
}

impl Host for AppHost {
    fn ask(&self, offer: Offer, answer: Answer) {
        if let Ok(mut answers) = self.answers.lock() {
            answers.insert(offer.session.clone(), answer);
        }
        let _ = self.app.emit("localsend-offer", offer);
    }

    fn file(&self, file: &SentFile) {
        if let Ok(mut rows) = self.rows.lock() {
            match rows.iter_mut().find(|r| r.session == file.session && r.id == file.id) {
                Some(row) => *row = file.clone(),
                None => {
                    // A new delivery goes above older ones, its files in order.
                    let at = rows.iter().rposition(|r| r.session == file.session).map_or(0, |p| p + 1);
                    rows.insert(at, file.clone());
                    rows.truncate(MAX_ROWS);
                }
            }
        }
        let _ = self.app.emit("localsend-changed", ());
    }

    fn arrived(&self, path: PathBuf) {
        self.import(vec![path]);
    }

    fn finished(&self, folder: PathBuf, audio: Vec<PathBuf>) {
        if audio.is_empty() {
            // Empty once its books are in; until then they remove it.
            let _ = std::fs::remove_dir(&folder);
            return;
        }
        // The parts move to a folder of their own, so they're found as
        // audiobooks without picking up the delivery's other books again.
        let parts = folder.join("Audiobooks");
        if std::fs::create_dir_all(&parts).is_err() {
            return;
        }
        for part in &audio {
            if let Some(name) = part.file_name() {
                let _ = std::fs::rename(part, parts.join(name));
            }
        }
        let books_dir = self.library.lock().map(|l| l.books_dir().to_path_buf()).unwrap_or_default();
        let found = tbv_core::library::find_book_files(std::slice::from_ref(&parts), &books_dir);
        let hold: Hold = Arc::new(Inbox(parts));
        let sources = found.into_iter().map(|f| (f, Some(hold.clone()))).collect();
        self.imports.queue_sources(&self.app, &self.library, sources);
    }
}

/// This device's name, for Grimoire's list (and LocalSend's).
fn alias(library: &Mutex<Library>) -> String {
    library.lock().ok().and_then(|l| l.device_name().ok()).unwrap_or_else(|| "The Bound Vigil".into())
}

impl LocalSend {
    pub fn status(&self, library: &Mutex<Library>) -> LocalSendStatus {
        LocalSendStatus {
            enabled: enabled(library),
            running: self.receiver.lock().is_ok_and(|r| r.is_some()),
            alias: alias(library),
            problem: self.problem.lock().ok().and_then(|p| p.clone()),
        }
    }

    /// Starts or stops receiving, and remembers the choice.
    pub fn set(&self, app: &AppHandle, library: &Arc<Mutex<Library>>, imports: &Arc<Imports>, inbox: PathBuf, on: bool) -> tbv_core::Result<()> {
        library.lock().map_err(|_| tbv_core::Error::Unsuitable("the library is unavailable".into()))?.set_setting(ENABLED_KEY, if on { "1" } else { "0" })?;
        if on {
            self.start(app, library, imports, inbox);
        } else if let Ok(mut receiver) = self.receiver.lock() {
            *receiver = None;
        }
        Ok(())
    }

    /// Starts receiving again, if it's on (under a new name, say).
    pub fn restart(&self, app: &AppHandle, library: &Arc<Mutex<Library>>, imports: &Arc<Imports>, inbox: PathBuf) {
        let was = self.receiver.lock().ok().and_then(|mut r| r.take());
        if was.is_some() {
            drop(was);
            // The old listener lets go of the port once it notices.
            std::thread::sleep(Duration::from_millis(400));
        }
        self.start(app, library, imports, inbox);
    }

    /// Starts receiving if it's switched on. Leftovers from last time go first.
    pub fn start(&self, app: &AppHandle, library: &Arc<Mutex<Library>>, imports: &Arc<Imports>, inbox: PathBuf) {
        if !enabled(library) {
            return;
        }
        let Ok(mut receiver) = self.receiver.lock() else { return };
        if receiver.is_some() {
            return;
        }
        let host = Arc::new(AppHost {
            app: app.clone(),
            library: library.clone(),
            imports: imports.clone(),
            answers: self.answers.clone(),
            rows: self.rows.clone(),
        });
        host.leftovers(&inbox);
        let Some((fingerprint, tls)) = credentials(library) else { return };
        let started = localsend::start(Identity { alias: alias(library), fingerprint, port: localsend::PORT, tls: Some(tls) }, &inbox, host, true);
        let problem = match started {
            Ok(r) => {
                *receiver = Some(r);
                None
            }
            Err(e) => Some(e.to_string()),
        };
        if let Ok(mut p) = self.problem.lock() {
            *p = problem;
        }
    }

    /// How TBV shows itself when sending: the same as when receiving.
    fn identity(&self, library: &Mutex<Library>) -> tbv_core::Result<Identity> {
        let (fingerprint, tls) = credentials(library).ok_or_else(|| tbv_core::Error::Unsuitable("TBV couldn't set itself up for Grimoire".into()))?;
        let port = self.receiver.lock().ok().and_then(|r| r.as_ref().map(Receiver::port)).unwrap_or(localsend::PORT);
        Ok(Identity { alias: alias(library), fingerprint, port, tls: Some(tls) })
    }

    /// Devices nearby with LocalSend open.
    pub fn nearby(&self, library: &Mutex<Library>) -> tbv_core::Result<Vec<Nearby>> {
        Ok(localsend::find_nearby(&self.identity(library)?, Duration::from_secs(3)))
    }

    /// The device at an address typed in.
    pub fn device_at(&self, address: &str) -> tbv_core::Result<Nearby> {
        localsend::device_at(address)
    }

    /// Sends books' files to a device nearby, telling the window how it goes.
    pub fn send(&self, app: &AppHandle, library: &Mutex<Library>, to: &Nearby, books: &[(String, ToSend)]) -> tbv_core::Result<usize> {
        let me = self.identity(library)?;
        // A fresh flag each time: an earlier send that's still winding down keeps its own.
        let stop = Arc::new(AtomicBool::new(false));
        if let Ok(mut current) = self.stop_sending.lock() {
            *current = stop.clone();
        }
        let files: Vec<ToSend> = books.iter().map(|(_, f)| f.clone()).collect();
        let mut last = Instant::now() - Duration::from_secs(1);
        localsend::send(&me, to, &files, &stop, |i, bytes| {
            let size = files[i].size;
            if bytes < size && last.elapsed() < Duration::from_millis(150) {
                return;
            }
            last = Instant::now();
            let _ = app.emit("localsend-sending", Sending { book: i + 1, books: files.len(), title: books[i].0.clone(), bytes, size });
        })
    }

    /// Stops what's being sent.
    pub fn stop_sending(&self) {
        if let Ok(current) = self.stop_sending.lock() {
            current.store(true, Ordering::SeqCst);
        }
    }

    /// Every file sent this run, newest delivery first.
    pub fn rows(&self) -> Vec<SentFile> {
        self.rows.lock().map(|r| r.clone()).unwrap_or_default()
    }

    /// Clears the rows of deliveries that are over.
    pub fn clear_finished(&self, app: &AppHandle) {
        if let Ok(mut rows) = self.rows.lock() {
            let live: Vec<String> =
                rows.iter().filter(|r| matches!(r.state, FileState::Waiting | FileState::Arriving)).map(|r| r.session.clone()).collect();
            rows.retain(|r| live.contains(&r.session));
        }
        let _ = app.emit("localsend-changed", ());
    }

    /// The person's answer to an offer.
    pub fn answer(&self, session: &str, accept: bool) {
        if let Some(answer) = self.answers.lock().ok().and_then(|mut a| a.remove(session)) {
            answer(accept);
        }
    }
}

impl AppHost {
    /// Books that arrived last time but weren't in the library when TBV
    /// closed are added now; files cut off part way are dropped.
    fn leftovers(&self, inbox: &std::path::Path) {
        let Ok(deliveries) = std::fs::read_dir(inbox) else { return };
        let books_dir = self.library.lock().map(|l| l.books_dir().to_path_buf()).unwrap_or_default();
        for delivery in deliveries.flatten().map(|e| e.path()).filter(|p| p.is_dir()) {
            for file in std::fs::read_dir(&delivery).into_iter().flatten().flatten().map(|e| e.path()) {
                if file.extension().is_some_and(|e| e == "part") {
                    let _ = std::fs::remove_file(&file);
                }
            }
            let found = tbv_core::library::find_book_files(std::slice::from_ref(&delivery), &books_dir);
            if found.is_empty() {
                let _ = std::fs::remove_dir_all(&delivery);
                continue;
            }
            let hold: Hold = Arc::new(Inbox(delivery));
            let sources = found.into_iter().map(|f| (f, Some(hold.clone()))).collect();
            self.imports.queue_sources(&self.app, &self.library, sources);
        }
    }
}

/// TBV's LocalSend certificate, made once and kept on this device, and the
/// fingerprint LocalSend knows TBV by, which comes from it.
fn credentials(library: &Mutex<Library>) -> Option<(String, Tls)> {
    let l = library.lock().ok()?;
    let saved = match (l.setting(CERT_KEY).ok().flatten(), l.setting(CERT_KEY_KEY).ok().flatten()) {
        (Some(cert), Some(key)) => Some(Tls { cert, key }),
        _ => None,
    };
    let tls = match saved.filter(|t| t.fingerprint().is_ok()) {
        Some(tls) => tls,
        None => {
            let tls = Tls::make().ok()?;
            l.set_setting(CERT_KEY, &tls.cert).ok()?;
            l.set_setting(CERT_KEY_KEY, &tls.key).ok()?;
            tls
        }
    };
    Some((tls.fingerprint().ok()?, tls))
}

fn enabled(library: &Mutex<Library>) -> bool {
    library.lock().ok().and_then(|l| l.setting(ENABLED_KEY).ok().flatten()).is_some_and(|v| v == "1")
}

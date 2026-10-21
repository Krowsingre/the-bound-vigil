//! LocalSend in the app (Settings › Servers): while it's on, TBV shows up in
//! LocalSend on phones and computers on the same Wi-Fi. Each offer is put to
//! the person first; the books they accept go into the import queue, and the
//! received files are deleted once they're in.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tbv_core::localsend::{self, Host, Identity, Offer, Receiver};
use tbv_core::Library;

use crate::imports::{Hold, Imports};

const ENABLED_KEY: &str = "localsend.enabled";
const FINGERPRINT_KEY: &str = "localsend.fingerprint";

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

#[derive(Default)]
pub struct LocalSend {
    receiver: Mutex<Option<Receiver>>,
    problem: Mutex<Option<String>>,
    answers: Arc<Mutex<HashMap<String, Answer>>>,
}

/// A received session's folder, deleted once its books are in.
struct Inbox(PathBuf);

impl Drop for Inbox {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

struct AppHost {
    app: AppHandle,
    library: Arc<Mutex<Library>>,
    imports: Arc<Imports>,
    answers: Arc<Mutex<HashMap<String, Answer>>>,
}

impl Host for AppHost {
    fn ask(&self, offer: Offer, answer: Answer) {
        if let Ok(mut answers) = self.answers.lock() {
            answers.insert(offer.session.clone(), answer);
        }
        let _ = self.app.emit("localsend-offer", offer);
    }

    fn progress(&self, session: &str, received: usize, of: usize) {
        let _ = self.app.emit("localsend-progress", serde_json::json!({ "session": session, "received": received, "of": of }));
    }

    fn received(&self, _session: &str, folder: PathBuf, _files: Vec<PathBuf>) {
        let hold: Arc<Inbox> = Arc::new(Inbox(folder.clone()));
        // Through the folder, so a phone's audiobook parts stay one book.
        let books_dir = self.library.lock().map(|l| l.books_dir().to_path_buf()).unwrap_or_default();
        let found = tbv_core::library::find_book_files(std::slice::from_ref(&folder), &books_dir);
        let count = self.imports.queue_sources(&self.app, &self.library, found.into_iter().map(|f| (f, Some(hold.clone() as Hold))).collect());
        let _ = self.app.emit("localsend-received", count);
    }
}

/// The computer's name, for LocalSend's list.
fn alias() -> String {
    let name = std::env::var("COMPUTERNAME").or_else(|_| std::env::var("HOSTNAME")).unwrap_or_default();
    if name.trim().is_empty() {
        "The Bound Vigil".into()
    } else {
        format!("The Bound Vigil on {}", name.trim())
    }
}

impl LocalSend {
    pub fn status(&self, library: &Mutex<Library>) -> LocalSendStatus {
        LocalSendStatus {
            enabled: enabled(library),
            running: self.receiver.lock().is_ok_and(|r| r.is_some()),
            alias: alias(),
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

    /// Starts receiving if it's switched on. Leftovers from last time go first.
    pub fn start(&self, app: &AppHandle, library: &Arc<Mutex<Library>>, imports: &Arc<Imports>, inbox: PathBuf) {
        if !enabled(library) {
            return;
        }
        let Ok(mut receiver) = self.receiver.lock() else { return };
        if receiver.is_some() {
            return;
        }
        let _ = std::fs::remove_dir_all(&inbox);
        let fingerprint = {
            let Ok(l) = library.lock() else { return };
            match l.setting(FINGERPRINT_KEY).ok().flatten() {
                Some(f) => f,
                None => {
                    let f = tbv_core::ids::new_record_id();
                    let _ = l.set_setting(FINGERPRINT_KEY, &f);
                    f
                }
            }
        };
        let host = Arc::new(AppHost { app: app.clone(), library: library.clone(), imports: imports.clone(), answers: self.answers.clone() });
        let started = localsend::start(Identity { alias: alias(), fingerprint, port: localsend::PORT }, &inbox, host, true);
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

    /// The person's answer to an offer.
    pub fn answer(&self, session: &str, accept: bool) {
        if let Some(answer) = self.answers.lock().ok().and_then(|mut a| a.remove(session)) {
            answer(accept);
        }
    }
}

fn enabled(library: &Mutex<Library>) -> bool {
    library.lock().ok().and_then(|l| l.setting(ENABLED_KEY).ok().flatten()).is_some_and(|v| v == "1")
}

//! Hardcover sign-in and rating sends. The library is only locked while it
//! is read or written, never while waiting on Hardcover or the browser.

use std::net::TcpListener;
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tbv_core::hardcover::{self, HardcoverStatus, Http, SendAllReport, Sent};
use tbv_core::{Error, Library};

fn lock(library: &Mutex<Library>) -> tbv_core::Result<MutexGuard<'_, Library>> {
    library.lock().map_err(|_| Error::Unsuitable("the library is unavailable".into()))
}

/// Opens Hardcover in the browser and waits for the person to approve.
pub fn sign_in(library: &Mutex<Library>) -> tbv_core::Result<HardcoverStatus> {
    let listener = TcpListener::bind("127.0.0.1:0")?;
    let pending = hardcover::begin_sign_in(listener.local_addr()?.port())?;
    tauri_plugin_opener::open_url(&pending.url, None::<&str>).map_err(|e| Error::Unsuitable(format!("The browser couldn't be opened: {e}")))?;
    let answer = hardcover::wait_for_callback(&listener, Duration::from_secs(300))?;
    let account = hardcover::finish_sign_in(&Http, &pending, &answer)?;
    let library = lock(library)?;
    library.save_hardcover_account(Some(&account))?;
    library.hardcover_status()
}

pub fn sign_out(library: &Mutex<Library>) -> tbv_core::Result<HardcoverStatus> {
    let account = lock(library)?.hardcover_account()?;
    if let Some(account) = account {
        hardcover::revoke(&Http, &account);
    }
    let library = lock(library)?;
    library.save_hardcover_account(None)?;
    library.hardcover_status()
}

/// Sends one book's rating, if sending is on. A sign-in Hardcover no longer
/// accepts is forgotten, so Settings shows it signed out.
pub fn send_one(library: &Mutex<Library>, book_id: &str) -> tbv_core::Result<(Sent, String)> {
    let (account, facts, known) = {
        let library = lock(library)?;
        (library.hardcover_account()?, library.book_facts(book_id)?, library.hardcover_match(book_id)?)
    };
    let Some(facts) = facts else { return Ok((Sent::Off, String::new())) };
    let label = match facts.authors.first() {
        Some(author) => format!("{} by {author}", facts.title),
        None => facts.title.clone(),
    };
    let account = match hardcover::usable_account(&Http, account) {
        Ok(Some(account)) => account,
        Ok(None) => return Ok((Sent::Off, label)),
        Err(Error::SignedOut) => {
            lock(library)?.save_hardcover_account(None)?;
            return Err(Error::Unsuitable("Hardcover signed TBV out. Sign in again in Settings › Sync & Accounts.".into()));
        }
        Err(e) => return Err(e),
    };
    lock(library)?.save_hardcover_account(Some(&account))?;
    match hardcover::send_rating(&Http, &account.access_token, &facts, known) {
        Ok((sent, found)) => {
            if let (Some(found), None) = (found, known) {
                lock(library)?.remember_hardcover_match(book_id, found)?;
            }
            Ok((sent, label))
        }
        Err(Error::SignedOut) => {
            lock(library)?.save_hardcover_account(None)?;
            Err(Error::Unsuitable("Hardcover signed TBV out. Sign in again in Settings › Sync & Accounts.".into()))
        }
        Err(e) => Err(e),
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Notice {
    message: String,
}

/// After a rating changes here: send it in the background, and only speak
/// up if something needs the person's attention.
pub fn send_in_background(library: Arc<Mutex<Library>>, app: AppHandle, book_id: String) {
    thread::spawn(move || {
        let message = match send_one(&library, &book_id) {
            Ok((Sent::NotFound, label)) => format!("Hardcover doesn't seem to have {label}, so its rating stays in TBV."),
            Ok(_) => return,
            Err(e) => format!("Your rating couldn't reach Hardcover: {e}"),
        };
        let _ = app.emit("hardcover-notice", Notice { message });
    });
}

/// Sends every rating, gently: Hardcover allows about 60 requests a minute,
/// and each book takes up to four.
pub fn send_all(library: &Mutex<Library>) -> tbv_core::Result<SendAllReport> {
    let ids = lock(library)?.rated_book_ids()?;
    let mut report = SendAllReport::default();
    for (i, id) in ids.iter().enumerate() {
        if i > 0 {
            thread::sleep(Duration::from_secs(4));
        }
        match send_one(library, id)? {
            (Sent::Sent, _) => report.sent += 1,
            (Sent::NotFound, label) => report.not_found.push(label),
            (Sent::Off, _) => return Err(Error::Unsuitable("Turn on sending ratings to Hardcover first.".into())),
        }
    }
    Ok(report)
}

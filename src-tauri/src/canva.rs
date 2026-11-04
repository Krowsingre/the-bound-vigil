//! Canva sign-in and designs. The library is only locked while the account
//! is read or saved, never while waiting on Canva or the browser.

use std::net::TcpListener;
use std::sync::Mutex;
use std::time::Duration;

use tbv_core::canva::{self, Account, CanvaStatus, Design, Format, Http};
use tbv_core::{Error, Library};

use crate::hardcover::lock;

/// Opens Canva in the browser and waits for the person to allow TBV.
pub fn sign_in(library: &Mutex<Library>) -> tbv_core::Result<CanvaStatus> {
    if !canva::available() {
        return Err(Error::Unsuitable("Canva isn't set up in this copy of TBV.".into()));
    }
    // Canva only sends people back to the address registered for TBV.
    let listener = TcpListener::bind(("127.0.0.1", canva::PORT))
        .map_err(|_| Error::Unsuitable("Another sign-in is still waiting. Finish or close it, then try again.".into()))?;
    let pending = canva::begin_sign_in();
    browse(&pending.url)?;
    let answer = tbv_core::oauth::wait_for_callback(&listener, Duration::from_secs(300))?;
    let account = canva::finish_sign_in(&Http, &pending, &answer)?;
    let library = lock(library)?;
    library.save_canva_account(Some(&account))?;
    library.canva_status()
}

pub fn sign_out(library: &Mutex<Library>) -> tbv_core::Result<CanvaStatus> {
    let account = lock(library)?.canva_account()?;
    if let Some(account) = account {
        canva::revoke(&Http, &account);
    }
    let library = lock(library)?;
    library.save_canva_account(None)?;
    library.canva_status()
}

/// The signed-in account with a usable token. Canva's refresh tokens work
/// once, so the refreshed account is saved straight away.
fn account(library: &Mutex<Library>) -> tbv_core::Result<Account> {
    let saved = lock(library)?.canva_account()?.ok_or_else(|| Error::Unsuitable("Connect Canva first, in Preferences › Scribe.".into()))?;
    match canva::fresh(&Http, &saved) {
        Ok(account) => {
            if account.access_token != saved.access_token {
                lock(library)?.save_canva_account(Some(&account))?;
            }
            Ok(account)
        }
        Err(Error::SignedOut) => {
            lock(library)?.save_canva_account(None)?;
            Err(Error::Unsuitable("Canva signed TBV out. Connect it again in Preferences › Scribe.".into()))
        }
        Err(e) => Err(e),
    }
}

/// Runs `work` with a usable token, and forgets an account Canva no longer accepts.
fn with_token<T>(library: &Mutex<Library>, work: impl FnOnce(&str) -> tbv_core::Result<T>) -> tbv_core::Result<T> {
    let account = account(library)?;
    match work(&account.access_token) {
        Err(Error::SignedOut) => {
            lock(library)?.save_canva_account(None)?;
            Err(Error::Unsuitable("Canva signed TBV out. Connect it again in Preferences › Scribe.".into()))
        }
        other => other,
    }
}

pub fn new_design(library: &Mutex<Library>, title: &str, width: u32, height: u32) -> tbv_core::Result<Design> {
    with_token(library, |token| canva::new_design(&Http, token, title, width, height))
}

/// The design's editing address, which Canva renews each time it's asked. None when the design is gone.
pub fn design(library: &Mutex<Library>, id: &str) -> tbv_core::Result<Option<Design>> {
    with_token(library, |token| canva::design(&Http, token, id))
}

/// Sends a file (the book's pages as a PDF, or a picture) to Canva as a new design.
pub fn import(library: &Mutex<Library>, title: &str, mime: &str, bytes: Vec<u8>) -> tbv_core::Result<Design> {
    with_token(library, |token| canva::import(&Http, token, title, mime, bytes))
}

pub fn export(library: &Mutex<Library>, id: &str, format: Format) -> tbv_core::Result<Vec<u8>> {
    with_token(library, |token| canva::export(&Http, token, id, format))
}

/// Opens a Canva design in the browser.
pub fn open(url: &str) -> tbv_core::Result<()> {
    if !url.starts_with("https://www.canva.com/") && !url.starts_with("https://canva.com/") {
        return Err(Error::Unsuitable("That isn't a Canva address.".into()));
    }
    browse(url)
}

/// Canva is on computers only for now.
#[cfg(desktop)]
fn browse(url: &str) -> tbv_core::Result<()> {
    tauri_plugin_opener::open_url(url, None::<&str>).map_err(|e| Error::Unsuitable(format!("The browser couldn't be opened: {e}")))
}

#[cfg(mobile)]
fn browse(_url: &str) -> tbv_core::Result<()> {
    Err(Error::Unsuitable("Canva works on your computer for now.".into()))
}

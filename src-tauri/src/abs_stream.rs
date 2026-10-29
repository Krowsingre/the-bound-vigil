//! Audiobooks played straight from an Audiobookshelf server, without
//! bringing them down: the player asks for ranges through the same
//! `tbvaudio://` address as any audiobook (see audio.rs), and these come
//! from the server. The place you're up to is kept on the server, so it's
//! there in Audiobookshelf's own apps too. Such a book isn't in the library.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, LazyLock, Mutex};

use tauri::{AppHandle, Manager, State};
use tbv_core::audiobookshelf::{self, RemoteBook, Server};
use tbv_core::Library;

use crate::AppLibrary;

pub struct Playing {
    pub server: Server,
    pub book: RemoteBook,
}

/// Books played from servers this time TBV is open, by stream id.
static PLAYING: LazyLock<Mutex<HashMap<String, Arc<Mutex<Playing>>>>> = LazyLock::new(Default::default);

fn unavailable() -> tbv_core::Error {
    tbv_core::Error::Unsuitable("the library is unavailable".into())
}

fn server_for(library: &Mutex<Library>, catalog: &str) -> tbv_core::Result<Server> {
    library
        .lock()
        .map_err(|_| unavailable())?
        .abs_servers()?
        .into_iter()
        .find(|s| s.id == catalog)
        .ok_or_else(|| tbv_core::Error::Unsuitable("That Audiobookshelf server is no longer in your catalogues.".into()))
}

/// Asks the server about the book afresh (for where you're up to) and keeps it for playing.
fn open(library: &Mutex<Library>, covers: Option<PathBuf>, id: &str) -> tbv_core::Result<Arc<Mutex<Playing>>> {
    let (catalog, item) = audiobookshelf::parse_stream_id(id).ok_or_else(|| tbv_core::Error::Unsuitable("That isn't a book on a server.".into()))?;
    let mut server = server_for(library, &catalog)?;
    let mut book = server.remote_book(&catalog, &item)?;
    if let Some(dir) = covers {
        let stem: String = format!("{catalog}-{item}").chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_').collect();
        let path = dir.join(format!("{stem}.jpg"));
        if !path.exists() {
            if let Ok(bytes) = server.cover(&item) {
                let _ = std::fs::create_dir_all(&dir).and_then(|_| std::fs::write(&path, bytes));
            }
        }
        if path.exists() {
            book.audiobook.book.cover_path = Some(path.to_string_lossy().into_owned());
        }
    }
    let playing = Arc::new(Mutex::new(Playing { server, book }));
    if let Ok(mut all) = PLAYING.lock() {
        all.insert(id.to_string(), playing.clone());
    }
    Ok(playing)
}

/// The book for playing, from this time TBV is open or asked for again.
pub fn find(library: &Mutex<Library>, id: &str) -> tbv_core::Result<Arc<Mutex<Playing>>> {
    if let Some(found) = PLAYING.lock().ok().and_then(|all| all.get(id).cloned()) {
        return Ok(found);
    }
    open(library, None, id)
}

fn covers_dir(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_cache_dir().ok().map(|d| d.join("Server covers"))
}

/// An audiobook on a server, as the player shows it.
#[tauri::command]
pub async fn server_audiobook(app: AppHandle, state: State<'_, AppLibrary>, book_id: String) -> Result<tbv_core::audio::Audiobook, String> {
    let library = state.0.clone();
    let covers = covers_dir(&app);
    tauri::async_runtime::spawn_blocking(move || {
        let playing = open(&library, covers, &book_id)?;
        let book = playing.lock().map_err(|_| unavailable())?.book.audiobook.clone();
        Ok::<_, tbv_core::Error>(book)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

/// Keeps where you are in a book played from a server, on the server.
#[tauri::command]
pub async fn server_listening(state: State<'_, AppLibrary>, book_id: String, position_ms: u64) -> Result<(), String> {
    let library = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let playing = find(&library, &book_id)?;
        let mut playing = playing.lock().map_err(|_| unavailable())?;
        let (item, duration) = (playing.book.item.clone(), playing.book.audiobook.duration_ms);
        playing.server.keep_place(&item, position_ms, duration)?;
        playing.book.audiobook.position_ms = position_ms;
        Ok::<_, tbv_core::Error>(())
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

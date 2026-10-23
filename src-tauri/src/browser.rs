//! Browse: the Browser tab's web pages, books brought down from any web
//! address (the Bible tab), and bookmarks.
//!
//! Pages show in a web view of their own laid over the Browser tab's space.
//! Sites there are never TBV's own pages, so they can't call TBV's commands
//! or reach the library. On the computer it's a second view in TBV's
//! window; on iPhone and iPad it's Apple's web view, from the Swift plugin.
//! Either way the page tells TBV where it is and what it brought down
//! through the "browser-page" and "browser-download" events.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{Emitter, EventTarget, Manager, State};
use tbv_core::bookmarks::Bookmark;
use tbv_core::servers::TempFolder;

use crate::{imports, with_library, AppLibrary, CommandResult};

/// Where the browser's downloads wait to be added or kept.
fn downloads_dir(app: &tauri::AppHandle) -> CommandResult<PathBuf> {
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join("Browser downloads"))
}

/// The space the Browser tab keeps for pages, in the window's points.
#[derive(Debug, Clone, Copy, Deserialize)]
pub struct Frame {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PageEvent {
    pub url: String,
    pub title: Option<String>,
    pub loading: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DownloadEvent {
    pub path: String,
    pub name: String,
    pub ok: bool,
}

pub(crate) fn tell_page(app: &tauri::AppHandle, page: PageEvent) {
    let _ = app.emit_to(EventTarget::webview("main"), "browser-page", page);
}

pub(crate) fn tell_download(app: &tauri::AppHandle, download: DownloadEvent) {
    let _ = app.emit_to(EventTarget::webview("main"), "browser-download", download);
}

/// Only web pages open in the browser.
fn web_url(url: &str) -> CommandResult<tauri::Url> {
    let parsed = tauri::Url::parse(url.trim()).map_err(|_| "That isn't a web address.".to_string())?;
    match parsed.scheme() {
        "http" | "https" => Ok(parsed),
        _ => Err("Only web addresses (http or https) open in the browser.".into()),
    }
}

#[cfg(desktop)]
mod view {
    use std::collections::HashMap;
    use std::sync::Mutex;

    use tauri::webview::{DownloadEvent as Download, NewWindowResponse, PageLoadEvent, WebviewBuilder};
    use tauri::{LogicalPosition, LogicalSize, Manager, WebviewUrl};

    use super::{downloads_dir, tell_download, tell_page, DownloadEvent, Frame, PageEvent};
    use crate::CommandResult;

    const LABEL: &str = "browser";

    /// Where each download in progress is being saved, by its address.
    static SAVING: Mutex<Option<HashMap<String, std::path::PathBuf>>> = Mutex::new(None);

    pub fn show(app: &tauri::AppHandle, url: Option<tauri::Url>, frame: Frame) -> CommandResult<()> {
        let (at, size) = (LogicalPosition::new(frame.x, frame.y), LogicalSize::new(frame.width.max(1.0), frame.height.max(1.0)));
        if let Some(view) = app.get_webview(LABEL) {
            view.set_position(at).map_err(|e| e.to_string())?;
            view.set_size(size).map_err(|e| e.to_string())?;
            view.show().map_err(|e| e.to_string())?;
            if let Some(url) = url {
                view.navigate(url).map_err(|e| e.to_string())?;
            }
            return Ok(());
        }
        let start = url.unwrap_or_else(|| tauri::Url::parse("about:blank").expect("a fixed address"));
        let window = app.get_window("main").ok_or("TBV's window isn't open.")?;
        let data = data_dir(app)?;
        let (pages, titles, windows, downloads) = (app.clone(), app.clone(), app.clone(), app.clone());
        let saves = downloads_dir(app)?;
        let builder = WebviewBuilder::new(LABEL, WebviewUrl::External(start))
            // Its own cookies and storage, so clearing them leaves TBV's alone.
            .data_directory(data)
            .on_page_load(move |_, payload| {
                tell_page(&pages, PageEvent { url: payload.url().to_string(), title: None, loading: matches!(payload.event(), PageLoadEvent::Started) });
            })
            .on_document_title_changed(move |view, title| {
                let url = view.url().map(|u| u.to_string()).unwrap_or_default();
                tell_page(&titles, PageEvent { url, title: Some(title), loading: false });
            })
            // Mail and other links that aren't web pages go to the computer's own apps.
            .on_navigation(|url| {
                let web = matches!(url.scheme(), "http" | "https" | "about" | "blob" | "data");
                if !web {
                    let _ = tauri_plugin_opener::open_url(url.as_str(), None::<&str>);
                }
                web
            })
            // A link that opens a new window opens here instead.
            .on_new_window(move |url, _| {
                if let Some(view) = windows.get_webview(LABEL) {
                    let _ = view.navigate(url);
                }
                NewWindowResponse::Deny
            })
            .on_download(move |_, event| {
                match event {
                    Download::Requested { url, destination } => {
                        let name = destination
                            .file_name()
                            .map(|n| n.to_string_lossy().into_owned())
                            .filter(|n| !n.is_empty())
                            .or_else(|| url.path_segments().and_then(|mut s| s.next_back()).map(str::to_string).filter(|n| !n.is_empty()))
                            .unwrap_or_else(|| "download".into());
                        let folder = saves.join(tbv_core::ids::new_record_id());
                        if std::fs::create_dir_all(&folder).is_err() {
                            return false;
                        }
                        *destination = folder.join(name);
                        if let Ok(mut saving) = SAVING.lock() {
                            saving.get_or_insert_with(HashMap::new).insert(url.to_string(), destination.clone());
                        }
                    }
                    Download::Finished { url, path, success } => {
                        let kept = SAVING.lock().ok().and_then(|mut s| s.as_mut().and_then(|s| s.remove(url.as_str())));
                        if let Some(path) = path.or(kept) {
                            let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
                            tell_download(&downloads, DownloadEvent { path: path.to_string_lossy().into_owned(), name, ok: success });
                        }
                    }
                    _ => {}
                }
                true
            });
        window.add_child(builder, at, size).map_err(|e| e.to_string())?;
        // With a second view in it, TBV's own page has to be told to keep filling the window.
        if let Some(main) = app.get_webview("main") {
            let _ = main.set_auto_resize(true);
        }
        Ok(())
    }

    pub fn place(app: &tauri::AppHandle, frame: Frame) -> CommandResult<()> {
        if let Some(view) = app.get_webview(LABEL) {
            view.set_position(LogicalPosition::new(frame.x, frame.y)).map_err(|e| e.to_string())?;
            view.set_size(LogicalSize::new(frame.width.max(1.0), frame.height.max(1.0))).map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub fn hide(app: &tauri::AppHandle) -> CommandResult<()> {
        if let Some(view) = app.get_webview(LABEL) {
            view.hide().map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    /// The browser's own cookies and storage, kept apart from TBV's.
    fn data_dir(app: &tauri::AppHandle) -> CommandResult<std::path::PathBuf> {
        Ok(app.path().app_local_data_dir().map_err(|e| e.to_string())?.join("Browser"))
    }

    pub fn act(app: &tauri::AppHandle, action: &str, url: Option<tauri::Url>) -> CommandResult<()> {
        let Some(view) = app.get_webview(LABEL) else {
            // Cleared from Preferences before the browser was opened: its folder can simply go.
            if action == "clear" {
                let data = data_dir(app)?;
                if data.exists() {
                    std::fs::remove_dir_all(&data).map_err(|e| e.to_string())?;
                }
                return Ok(());
            }
            return Err("The browser isn't open.".into());
        };
        match (action, url) {
            ("go", Some(url)) => view.navigate(url),
            ("back", _) => view.eval("history.back()"),
            ("forward", _) => view.eval("history.forward()"),
            ("reload", _) => view.reload(),
            ("stop", _) => view.eval("window.stop()"),
            ("clear", _) => view.clear_all_browsing_data(),
            _ => return Err("The browser can't do that.".into()),
        }
        .map_err(|e| e.to_string())
    }
}

#[cfg(mobile)]
mod view {
    use super::Frame;
    use crate::CommandResult;

    fn ask(action: &str, url: Option<&str>, frame: Option<Frame>) -> CommandResult<()> {
        let frame = frame.map(|f| (f.x, f.y, f.width, f.height));
        tauri_plugin_tbv_ios::browser(action, url, frame)
    }

    pub fn show(_app: &tauri::AppHandle, url: Option<tauri::Url>, frame: Frame) -> CommandResult<()> {
        ask("show", url.as_ref().map(|u| u.as_str()), Some(frame))
    }

    pub fn place(_app: &tauri::AppHandle, frame: Frame) -> CommandResult<()> {
        ask("place", None, Some(frame))
    }

    pub fn hide(_app: &tauri::AppHandle) -> CommandResult<()> {
        ask("hide", None, None)
    }

    pub fn act(_app: &tauri::AppHandle, action: &str, url: Option<tauri::Url>) -> CommandResult<()> {
        ask(action, url.as_ref().map(|u| u.as_str()), None)
    }
}

/// On iPhone and iPad: hears what Apple's web view did and passes it on to
/// TBV's page, as the computer's view does by itself.
#[cfg(mobile)]
pub fn listen(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        loop {
            match tauri_plugin_tbv_ios::browser_event() {
                Some(tauri_plugin_tbv_ios::BrowserEvent::Page { url, title, loading }) => tell_page(&app, PageEvent { url, title, loading }),
                Some(tauri_plugin_tbv_ios::BrowserEvent::Download { path, name, ok }) => tell_download(&app, DownloadEvent { path, name, ok }),
                // Not ready yet, or nothing happened: ask again shortly.
                None => std::thread::sleep(std::time::Duration::from_millis(500)),
            }
        }
    });
}

/// Shows the browser in `frame`, at `url` when there is one (or where it was).
#[tauri::command]
pub async fn browser_show(app: tauri::AppHandle, url: Option<String>, frame: Frame) -> CommandResult<()> {
    let url = url.as_deref().map(web_url).transpose()?;
    view::show(&app, url, frame)
}

/// Moves the browser when the space for it moves or changes size.
#[tauri::command]
pub async fn browser_place(app: tauri::AppHandle, frame: Frame) -> CommandResult<()> {
    view::place(&app, frame)
}

/// Hides the browser (another page or tab is showing, or a dialog is open). It keeps its place.
#[tauri::command]
pub async fn browser_hide(app: tauri::AppHandle) -> CommandResult<()> {
    view::hide(&app)
}

/// `go` (to `url`), `back`, `forward`, `reload`, `stop`, or `clear` (every site's cookies and storage).
#[tauri::command]
pub async fn browser_act(app: tauri::AppHandle, action: String, url: Option<String>) -> CommandResult<()> {
    let url = url.as_deref().map(web_url).transpose()?;
    view::act(&app, &action, url)
}

/// A file the browser brought down: added to the library, or let go.
fn in_downloads(app: &tauri::AppHandle, path: &str) -> CommandResult<PathBuf> {
    let path = PathBuf::from(path);
    let ours = downloads_dir(app)?;
    #[cfg(target_os = "ios")]
    let ours = tauri_plugin_tbv_ios::browser_downloads_dir().unwrap_or(ours);
    let real = path.canonicalize().map_err(|_| "That download is gone.".to_string())?;
    let ours = ours.canonicalize().unwrap_or(ours);
    if !real.starts_with(&ours) {
        return Err("That isn't one of the browser's downloads.".into());
    }
    Ok(real)
}

/// Adds a file the browser brought down to the library, through the import queue.
#[tauri::command]
pub async fn browser_add_download(
    app: tauri::AppHandle,
    state: State<'_, AppLibrary>,
    imports: State<'_, Arc<imports::Imports>>,
    path: String,
) -> CommandResult<()> {
    let path = in_downloads(&app, &path)?;
    let folder = path.parent().map(Path::to_path_buf).ok_or("That download is gone.")?;
    let (library, imports) = (state.0.clone(), imports.inner().clone());
    tauri::async_runtime::spawn_blocking(move || {
        let holding = Arc::new(TempFolder::adopt(folder));
        imports.add_holding(&app, &library, vec![path], Some(holding));
    })
    .await
    .map_err(|e| e.to_string())
}

/// Moves a download to the computer's Downloads folder; answers where it went.
#[tauri::command]
pub async fn browser_keep_download(app: tauri::AppHandle, path: String) -> CommandResult<String> {
    let path = in_downloads(&app, &path)?;
    let downloads = app.path().download_dir().map_err(|_| "This device has no Downloads folder.".to_string())?;
    let name = path.file_name().ok_or("That download is gone.")?.to_owned();
    let mut target = downloads.join(&name);
    let stem = Path::new(&name).file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let extension = Path::new(&name).extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
    let mut n = 2;
    while target.exists() {
        target = downloads.join(format!("{stem} ({n}){extension}"));
        n += 1;
    }
    if std::fs::rename(&path, &target).is_err() {
        std::fs::copy(&path, &target).map_err(|e| e.to_string())?;
    }
    if let Some(folder) = path.parent() {
        let _ = std::fs::remove_dir_all(folder);
    }
    Ok(target.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn browser_discard_download(app: tauri::AppHandle, path: String) -> CommandResult<()> {
    let path = in_downloads(&app, &path)?;
    if let Some(folder) = path.parent() {
        let _ = std::fs::remove_dir_all(folder);
    }
    Ok(())
}

/// Brings a book down from a web address (a Bible from the Bible tab, or
/// the book a browser page shows) and adds it through the import queue.
#[tauri::command]
pub async fn download_web_book(
    app: tauri::AppHandle,
    state: State<'_, AppLibrary>,
    imports: State<'_, Arc<imports::Imports>>,
    url: String,
    title: String,
) -> CommandResult<()> {
    let url = web_url(&url)?.to_string();
    let downloads = crate::writing::downloads_dir(&app.path().app_data_dir().map_err(|e| e.to_string())?);
    let (library, imports) = (state.0.clone(), imports.inner().clone());
    tauri::async_runtime::spawn_blocking(move || {
        let folder = Arc::new(TempFolder::new(&downloads).map_err(|e| e.to_string())?);
        let path = tbv_core::opds::download_book(&url, &title, folder.path()).map_err(|e| e.to_string())?;
        imports.add_holding(&app, &library, vec![path], Some(folder));
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn bookmarks(state: State<'_, AppLibrary>) -> CommandResult<Vec<Bookmark>> {
    with_library(state, |library| library.bookmarks()).await
}

#[tauri::command]
pub async fn add_bookmark(state: State<'_, AppLibrary>, title: String, url: String) -> CommandResult<Bookmark> {
    with_library(state, move |library| library.add_bookmark(&title, &url)).await
}

#[tauri::command]
pub async fn rename_bookmark(state: State<'_, AppLibrary>, id: String, title: String) -> CommandResult<()> {
    with_library(state, move |library| library.rename_bookmark(&id, &title)).await
}

#[tauri::command]
pub async fn remove_bookmark(state: State<'_, AppLibrary>, id: String) -> CommandResult<()> {
    with_library(state, move |library| library.remove_bookmark(&id)).await
}

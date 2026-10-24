//! Discover: the browser's web pages in tabs, books brought down from any
//! web address (the Bible), and bookmarks.
//!
//! Each tab's page shows in a web view of its own laid over Discover's
//! space; only the tab in front is shown. Sites there are never TBV's own
//! pages, so they can't call TBV's commands or reach the library. On the
//! computer each tab is a view in TBV's window; on iPhone and iPad it's
//! Apple's web view, from the Swift plugin. Either way what the pages do
//! (where they are, what they bring down, a link that wants a new tab)
//! reaches TBV's page as "browser-event".

use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{Emitter, EventTarget, Manager, State};
use tbv_core::bookmarks::Bookmark;
use tbv_core::browser_history::HistoryEntry;
use tbv_core::quick_links::QuickLink;
use tbv_core::servers::TempFolder;

use crate::protection::Protection;
use crate::{imports, with_library, AppLibrary, CommandResult};

/// Where the browser's downloads wait to be added or kept.
fn downloads_dir(app: &tauri::AppHandle) -> CommandResult<PathBuf> {
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join("Browser downloads"))
}

/// The space Discover keeps for pages, in the window's points.
#[derive(Debug, Clone, Copy, Deserialize)]
pub struct Frame {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

/// Something a tab did, for TBV's page.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[cfg_attr(mobile, allow(dead_code))]
pub(crate) enum Event {
    /// The page it's on, and whether it's still loading.
    #[serde(rename_all = "camelCase")]
    Page { tab: String, url: String, title: Option<String>, loading: bool },
    /// A file started coming down.
    #[serde(rename_all = "camelCase")]
    DownloadStart { tab: String, id: String, name: String, url: String },
    /// A file finished coming down (or failed, or was cancelled).
    #[serde(rename_all = "camelCase")]
    Download { tab: String, id: String, path: String, name: String, ok: bool },
    /// A link that opens a new window: it opens in a new tab instead.
    #[serde(rename_all = "camelCase")]
    NewTab { url: String, from: String },
    /// The page closed itself (window.close()). Told by Windows' web view.
    #[serde(rename_all = "camelCase")]
    #[cfg_attr(not(windows), allow(dead_code))]
    Closed { tab: String },
    /// The page couldn't open (no connection, no such site, a bad
    /// certificate): TBV shows its own page saying why, with Try again.
    #[serde(rename_all = "camelCase")]
    #[cfg_attr(not(windows), allow(dead_code))]
    Failed { tab: String, url: String, reason: String },
    /// A link for another app (mail, a phone number, an app's own link):
    /// TBV's page asks first, if chosen, then opens it with `browser_open_app`.
    #[serde(rename_all = "camelCase")]
    External { tab: String, url: String },
    /// Chosen from a link's own menu (right-click, or holding it): `newTab`
    /// (open it in a new tab) or `addBook` (bring the book it links to into the library).
    #[serde(rename_all = "camelCase")]
    #[cfg_attr(not(windows), allow(dead_code))]
    Menu { tab: String, action: String, url: String },
}

/// A page the tab went through, for the Back and Forward buttons' menus.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Visited {
    pub title: String,
    pub url: String,
}

/// The pages behind and ahead of the one a tab shows, nearest first.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Travelled {
    pub back: Vec<Visited>,
    pub forward: Vec<Visited>,
}

/// TBV's own items for a link's menu: a new tab, and the library for a book file.
#[cfg_attr(not(windows), allow(dead_code))]
fn link_menu(url: &str) -> Vec<(&'static str, &'static str)> {
    let mut items = vec![("Open link in new tab", "newTab")];
    let path = tauri::Url::parse(url).map(|u| u.path().to_ascii_lowercase()).unwrap_or_default();
    let book = ["epub", "kepub", "pdf", "mobi", "azw", "azw3", "fb2", "cbz", "cbr", "djvu", "m4b", "mp3"];
    if path.rsplit_once('.').is_some_and(|(_, ext)| book.contains(&ext)) {
        items.push(("Add to TBV library", "addBook"));
    }
    items
}

#[cfg_attr(mobile, allow(dead_code))]
pub(crate) fn tell(app: &tauri::AppHandle, event: Event) {
    let _ = app.emit_to(EventTarget::webview("main"), "browser-event", event);
}

/// Only web pages open in the browser.
fn web_url(url: &str) -> CommandResult<tauri::Url> {
    let parsed = tauri::Url::parse(url.trim()).map_err(|_| "That isn't a web address.".to_string())?;
    match parsed.scheme() {
        "http" | "https" => Ok(parsed),
        _ => Err("Only web addresses (http or https) open in the browser.".into()),
    }
}

/// A tab's name, from TBV's page: letters, digits and dashes only.
fn tab_name(tab: &str) -> CommandResult<String> {
    if tab.is_empty() || tab.len() > 40 || !tab.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err("That isn't one of the browser's tabs.".into());
    }
    Ok(tab.to_string())
}

#[cfg(desktop)]
mod view {
    use std::collections::{HashMap, HashSet};
    use std::sync::Mutex;
    use std::time::{Duration, Instant};

    use tauri::webview::{DownloadEvent as Download, NewWindowResponse, PageLoadEvent, WebviewBuilder};
    use tauri::{LogicalPosition, LogicalSize, Manager, WebviewUrl};

    use super::{downloads_dir, tell, Event, Frame};
    use crate::protection::Protection;
    use crate::CommandResult;

    const PREFIX: &str = "browser-";

    /// The level chosen in Preferences, and the sites it's lowered for.
    static PROTECTION: Mutex<Option<Protection>> = Mutex::new(None);
    /// The host of the page each tab shows, so a site's own requests aren't blocked.
    static SITES: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);
    /// The tab in front.
    static ACTIVE: Mutex<Option<String>> = Mutex::new(None);
    /// Downloads under way, by address: their id, where they're saved, and the tab.
    static SAVING: Mutex<Option<HashMap<String, Saving>>> = Mutex::new(None);
    /// When each address last started downloading, so a page asking again and
    /// again (as one waiting for a sign-in can) brings it down once.
    static RECENT: Mutex<Option<HashMap<String, Instant>>> = Mutex::new(None);
    /// Downloads cancelled before they finished; what arrives is thrown away.
    static CANCELLED: Mutex<Option<HashSet<String>>> = Mutex::new(None);

    /// A download's id, where it's being saved, and its tab.
    type Saving = (String, std::path::PathBuf, String);

    const AGAIN_AFTER: Duration = Duration::from_secs(30);

    #[cfg_attr(not(windows), allow(dead_code))]
    pub(super) fn protection() -> Protection {
        PROTECTION.lock().ok().and_then(|p| p.clone()).unwrap_or_default()
    }

    #[cfg_attr(not(windows), allow(dead_code))]
    pub(super) fn site_of(tab: &str) -> String {
        SITES.lock().ok().and_then(|s| s.as_ref().and_then(|s| s.get(tab).cloned())).unwrap_or_default()
    }

    fn set_site(tab: &str, url: &tauri::Url) {
        if let (Ok(mut sites), Some(host)) = (SITES.lock(), url.host_str()) {
            sites.get_or_insert_with(HashMap::new).insert(tab.to_string(), host.to_ascii_lowercase());
        }
    }

    /// Windows' own tracking prevention is one setting shared by every tab, so
    /// it follows the tab in front: off while that tab's site has protection lowered.
    fn follow_front(app: &tauri::AppHandle) {
        #[cfg(windows)]
        if let Some(tab) = ACTIVE.lock().ok().and_then(|a| a.clone()) {
            if let Some(view) = app.get_webview(&label(&tab)) {
                super::windows::tracking(&view, protection().level_for(&site_of(&tab)));
            }
        }
        let _ = app;
    }

    fn label(tab: &str) -> String {
        format!("{PREFIX}{tab}")
    }

    fn tabs(app: &tauri::AppHandle) -> Vec<tauri::Webview> {
        app.webviews().into_iter().filter(|(l, _)| l.starts_with(PREFIX) && !l.starts_with("browser-popup-")).map(|(_, v)| v).collect()
    }

    pub fn show(app: &tauri::AppHandle, tab: &str, url: Option<tauri::Url>, frame: Frame, protection: Option<Protection>, private: bool) -> CommandResult<()> {
        if let Some(p) = protection {
            set_protection(app, p);
        }
        let (at, size) = (LogicalPosition::new(frame.x, frame.y), LogicalSize::new(frame.width.max(1.0), frame.height.max(1.0)));
        if let Ok(mut active) = ACTIVE.lock() {
            *active = Some(tab.to_string());
        }
        for other in tabs(app).into_iter().filter(|v| v.label() != label(tab)) {
            let _ = other.hide();
        }
        if let Some(view) = app.get_webview(&label(tab)) {
            view.set_position(at).map_err(|e| e.to_string())?;
            view.set_size(size).map_err(|e| e.to_string())?;
            view.show().map_err(|e| e.to_string())?;
            if let Some(url) = url {
                set_site(tab, &url);
                view.navigate(url).map_err(|e| e.to_string())?;
            }
            follow_front(app);
            return Ok(());
        }
        let start = url.unwrap_or_else(|| tauri::Url::parse("about:blank").expect("a fixed address"));
        set_site(tab, &start);
        let window = app.get_window("main").ok_or("TBV's window isn't open.")?;
        let data = data_dir(app)?;
        let (pages, titles, windows, downloads, others) = (app.clone(), app.clone(), app.clone(), app.clone(), app.clone());
        let (page_tab, title_tab, window_tab, download_tab, other_tab) = (tab.to_string(), tab.to_string(), tab.to_string(), tab.to_string(), tab.to_string());
        let saves = downloads_dir(app)?;
        let builder = WebviewBuilder::new(label(tab), WebviewUrl::External(start))
            // Its own cookies, saved logins and storage, so clearing them leaves TBV's alone.
            .data_directory(data)
            // A private tab keeps nothing once it's closed.
            .incognito(private)
            .on_page_load(move |_, payload| {
                if matches!(payload.event(), PageLoadEvent::Started) {
                    set_site(&page_tab, payload.url());
                    follow_front(&pages);
                }
                tell(
                    &pages,
                    Event::Page { tab: page_tab.clone(), url: payload.url().to_string(), title: None, loading: matches!(payload.event(), PageLoadEvent::Started) },
                );
            })
            .on_document_title_changed(move |view, title| {
                let url = view.url().map(|u| u.to_string()).unwrap_or_default();
                tell(&titles, Event::Page { tab: title_tab.clone(), url, title: Some(title), loading: false });
            })
            // Mail and other links that aren't web pages go to the computer's own
            // apps, once TBV's page has asked (if chosen).
            .on_navigation(move |url| {
                let web = matches!(url.scheme(), "http" | "https" | "about" | "blob" | "data");
                if !web && super::app_link(url.as_str()) {
                    tell(&others, Event::External { tab: other_tab.clone(), url: url.to_string() });
                }
                web
            })
            .on_new_window(move |url, features| {
                // A window the page sized itself is a pop-up (usually a sign-in): it opens
                // as a small window of its own, still joined to the page, and closes when done.
                if features.size().is_some() {
                    let popup = tauri::WebviewWindowBuilder::new(
                        &windows,
                        format!("browser-popup-{}", tbv_core::ids::new_record_id()),
                        WebviewUrl::External(tauri::Url::parse("about:blank").expect("a fixed address")),
                    )
                    .window_features(features)
                    .incognito(private)
                    .title(url.host_str().unwrap_or("Sign in"))
                    .on_document_title_changed(|window, title| {
                        let _ = window.set_title(&title);
                    })
                    .build();
                    if let Ok(window) = popup {
                        #[cfg(windows)]
                        super::windows::popup(&window);
                        return NewWindowResponse::Create { window };
                    }
                }
                // Any other link that wants a new window opens in a new tab.
                tell(&windows, Event::NewTab { url: url.to_string(), from: window_tab.clone() });
                NewWindowResponse::Deny
            })
            .on_download(move |_, event| {
                match event {
                    Download::Requested { url, destination } => {
                        let address = url.to_string();
                        // Asked for again while it's coming down, or just after: once is enough.
                        let now = Instant::now();
                        if let Ok(mut recent) = RECENT.lock() {
                            let recent = recent.get_or_insert_with(HashMap::new);
                            recent.retain(|_, at| now.duration_since(*at) < AGAIN_AFTER);
                            let busy = SAVING.lock().ok().is_some_and(|s| s.as_ref().is_some_and(|s| s.contains_key(&address)));
                            if busy || recent.contains_key(&address) {
                                return false;
                            }
                            recent.insert(address.clone(), now);
                        }
                        let name = destination
                            .file_name()
                            .map(|n| n.to_string_lossy().into_owned())
                            .filter(|n| !n.is_empty())
                            .or_else(|| url.path_segments().and_then(|mut s| s.next_back()).map(str::to_string).filter(|n| !n.is_empty()))
                            .unwrap_or_else(|| "download".into());
                        let id = tbv_core::ids::new_record_id();
                        let folder = saves.join(&id);
                        if std::fs::create_dir_all(&folder).is_err() {
                            return false;
                        }
                        *destination = folder.join(&name);
                        if let Ok(mut saving) = SAVING.lock() {
                            saving.get_or_insert_with(HashMap::new).insert(address.clone(), (id.clone(), destination.clone(), download_tab.clone()));
                        }
                        tell(&downloads, Event::DownloadStart { tab: download_tab.clone(), id, name, url: address });
                    }
                    Download::Finished { url, path, success } => {
                        let kept = SAVING.lock().ok().and_then(|mut s| s.as_mut().and_then(|s| s.remove(url.as_str())));
                        // One that failed can be tried again straight away.
                        if !success {
                            if let Ok(mut recent) = RECENT.lock() {
                                recent.get_or_insert_with(HashMap::new).remove(url.as_str());
                            }
                        }
                        if let Some((id, saved, tab)) = kept {
                            let path = path.unwrap_or(saved);
                            let cancelled = CANCELLED.lock().ok().is_some_and(|mut c| c.as_mut().is_some_and(|c| c.remove(&id)));
                            if cancelled {
                                if let Some(folder) = path.parent() {
                                    let _ = std::fs::remove_dir_all(folder);
                                }
                                return true;
                            }
                            let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
                            tell(&downloads, Event::Download { tab, id, path: path.to_string_lossy().into_owned(), name, ok: success });
                        }
                    }
                    _ => {}
                }
                true
            });
        let view = window.add_child(builder, at, size).map_err(|e| e.to_string())?;
        #[cfg(windows)]
        super::windows::tab(&view, app.clone(), tab.to_string());
        let _ = view;
        follow_front(app);
        // With a second view in it, TBV's own page has to be told to keep filling the window.
        if let Some(main) = app.get_webview("main") {
            let _ = main.set_auto_resize(true);
        }
        Ok(())
    }

    pub fn place(app: &tauri::AppHandle, frame: Frame) -> CommandResult<()> {
        let Some(tab) = ACTIVE.lock().ok().and_then(|a| a.clone()) else { return Ok(()) };
        if let Some(view) = app.get_webview(&label(&tab)) {
            view.set_position(LogicalPosition::new(frame.x, frame.y)).map_err(|e| e.to_string())?;
            view.set_size(LogicalSize::new(frame.width.max(1.0), frame.height.max(1.0))).map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub fn hide(app: &tauri::AppHandle) -> CommandResult<()> {
        for view in tabs(app) {
            view.hide().map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    /// The browser's own cookies and storage, kept apart from TBV's.
    fn data_dir(app: &tauri::AppHandle) -> CommandResult<std::path::PathBuf> {
        Ok(app.path().app_local_data_dir().map_err(|e| e.to_string())?.join("Browser"))
    }

    pub fn clear(app: &tauri::AppHandle) -> CommandResult<()> {
        let open = tabs(app);
        let Some(view) = open.first() else {
            // Cleared from Preferences before the browser was opened: its folder can simply go.
            let data = data_dir(app)?;
            if data.exists() {
                std::fs::remove_dir_all(&data).map_err(|e| e.to_string())?;
            }
            return Ok(());
        };
        // Every tab shares the one store, so clearing it once clears them all.
        view.clear_all_browsing_data().map_err(|e| e.to_string())
    }

    pub fn act(app: &tauri::AppHandle, tab: &str, action: &str, url: Option<tauri::Url>) -> CommandResult<()> {
        let Some(view) = app.get_webview(&label(tab)) else {
            return if action == "close" { Ok(()) } else { Err("That tab isn't open.".into()) };
        };
        match (action, url) {
            ("go", Some(url)) => {
                set_site(tab, &url);
                view.navigate(url)
            }
            ("back", _) => view.eval("history.back()"),
            ("forward", _) => view.eval("history.forward()"),
            ("reload", _) => view.reload(),
            ("stop", _) => view.eval("window.stop()"),
            ("close", _) => {
                if let Ok(mut sites) = SITES.lock() {
                    sites.get_or_insert_with(HashMap::new).remove(tab);
                }
                view.close()
            }
            _ => return Err("The browser can't do that.".into()),
        }
        .map_err(|e| e.to_string())
    }

    pub fn find(app: &tauri::AppHandle, tab: &str, text: &str, backwards: bool) -> CommandResult<()> {
        let view = app.get_webview(&label(tab)).ok_or("That tab isn't open.")?;
        let text = serde_json::to_string(text).map_err(|e| e.to_string())?;
        view.eval(format!("window.find({text}, false, {backwards}, true)")).map_err(|e| e.to_string())
    }

    pub fn set_protection(app: &tauri::AppHandle, protection: Protection) {
        if let Ok(mut p) = PROTECTION.lock() {
            *p = Some(protection);
        }
        follow_front(app);
    }

    /// Runs `script` in the tab and answers what it returned (as JSON).
    pub fn run(app: &tauri::AppHandle, tab: &str, script: &str) -> CommandResult<serde_json::Value> {
        let view = app.get_webview(&label(tab)).ok_or("That tab isn't open.")?;
        let (send, receive) = std::sync::mpsc::channel();
        view.eval_with_callback(script.to_string(), move |answer| {
            let _ = send.send(answer);
        })
        .map_err(|e| e.to_string())?;
        let answer = receive.recv_timeout(Duration::from_secs(20)).map_err(|_| "The page took too long to answer.".to_string())?;
        // The page answers with JSON text, which comes back as JSON once more.
        let value: serde_json::Value = serde_json::from_str(&answer).unwrap_or(serde_json::Value::Null);
        Ok(match value {
            serde_json::Value::String(text) => serde_json::from_str(&text).unwrap_or(serde_json::Value::Null),
            other => other,
        })
    }

    pub fn cancel(app: &tauri::AppHandle, id: &str) -> CommandResult<()> {
        let found = SAVING.lock().ok().and_then(|s| s.as_ref().and_then(|s| s.iter().find(|(_, (i, _, _))| i == id).map(|(url, (_, _, tab))| (url.clone(), tab.clone()))));
        let Some((url, tab)) = found else { return Ok(()) };
        if let Ok(mut cancelled) = CANCELLED.lock() {
            cancelled.get_or_insert_with(HashSet::new).insert(id.to_string());
        }
        #[cfg(windows)]
        if let Some(view) = app.get_webview(&label(&tab)) {
            super::windows::cancel(&view, url);
        }
        #[cfg(not(windows))]
        let _ = (app, url, tab);
        Ok(())
    }

    /// How large the tab's page is drawn: 1 is the site's own size.
    pub fn zoom(app: &tauri::AppHandle, tab: &str, zoom: f64) -> CommandResult<()> {
        let view = app.get_webview(&label(tab)).ok_or("That tab isn't open.")?;
        view.set_zoom(zoom).map_err(|e| e.to_string())
    }

    /// Computers are always given a site's desktop version.
    pub fn desktop_sites(_app: &tauri::AppHandle, _hosts: Vec<String>) -> CommandResult<()> {
        Ok(())
    }

    /// Clears one site's cookies and storage. Every tab shares the one store,
    /// so any open tab can do it.
    pub fn clear_site(app: &tauri::AppHandle, host: &str) -> CommandResult<()> {
        let open = tabs(app);
        let Some(view) = open.first() else { return Ok(()) };
        #[cfg(windows)]
        super::windows::clear_site(view, host.to_string());
        #[cfg(not(windows))]
        let _ = (view, host);
        Ok(())
    }

    pub fn share(app: &tauri::AppHandle, url: &str, title: &str, _anchor: Option<Frame>) -> CommandResult<()> {
        #[cfg(windows)]
        return super::windows::share(app, url.to_string(), title.to_string());
        #[cfg(not(windows))]
        {
            let _ = (app, url, title);
            Err("Sharing isn't available on this computer. Copy the link instead.".into())
        }
    }

    pub fn open_app(_app: &tauri::AppHandle, url: &str) -> CommandResult<()> {
        tauri_plugin_opener::open_url(url, None::<&str>).map_err(|_| "No app on this computer opens that link.".to_string())
    }

    pub fn travelled(app: &tauri::AppHandle, tab: &str) -> CommandResult<super::Travelled> {
        let view = app.get_webview(&label(tab)).ok_or("That tab isn't open.")?;
        #[cfg(windows)]
        return super::windows::travelled(&view);
        #[cfg(not(windows))]
        {
            let _ = view;
            Ok(super::Travelled::default())
        }
    }
}

/// The parts that need Windows' own web view (WebView2): tracking prevention,
/// blocking by the protection level, saved logins, pages closing themselves,
/// and cancelling a download.
#[cfg(windows)]
mod windows {
    use std::cell::RefCell;
    use std::collections::HashMap;

    use webview2_com::Microsoft::Web::WebView2::Win32::*;
    use webview2_com::{
        take_pwstr, CallDevToolsProtocolMethodCompletedHandler, ContextMenuRequestedEventHandler, CustomItemSelectedEventHandler, DownloadStartingEventHandler,
        NavigationCompletedEventHandler, WebResourceRequestedEventHandler, WindowCloseRequestedEventHandler,
    };
    use windows_core::{Interface, BOOL, HSTRING, PWSTR};

    use super::{tell, view, Event};
    use crate::protection::Level;

    thread_local! {
        /// Downloads under way, by address, so one can be cancelled. Kept on
        /// the window's own thread, where the web view lives.
        static OPERATIONS: RefCell<HashMap<String, ICoreWebView2DownloadOperation>> = RefCell::new(HashMap::new());
    }

    fn level(level: Level) -> COREWEBVIEW2_TRACKING_PREVENTION_LEVEL {
        match level {
            Level::Strict => COREWEBVIEW2_TRACKING_PREVENTION_LEVEL_STRICT,
            Level::Balanced => COREWEBVIEW2_TRACKING_PREVENTION_LEVEL_BALANCED,
            Level::Off => COREWEBVIEW2_TRACKING_PREVENTION_LEVEL_NONE,
        }
    }

    unsafe fn set_tracking(core: &ICoreWebView2, chosen: Level) -> windows_core::Result<()> {
        let profile = core.cast::<ICoreWebView2_13>()?.Profile()?;
        profile.cast::<ICoreWebView2Profile3>()?.SetPreferredTrackingPreventionLevel(level(chosen))
    }

    pub fn tracking(view: &tauri::Webview, chosen: Level) {
        let _ = view.with_webview(move |platform| unsafe {
            if let Ok(core) = platform.controller().CoreWebView2() {
                let _ = set_tracking(&core, chosen);
            }
        });
    }

    /// A tab: everything above.
    pub fn tab(view: &tauri::Webview, app: tauri::AppHandle, tab: String) {
        let _ = view.with_webview(move |platform| unsafe {
            let _ = set_up(&platform, app, tab);
        });
    }

    unsafe fn set_up(platform: &tauri::webview::PlatformWebview, app: tauri::AppHandle, tab: String) -> windows_core::Result<()> {
        let core = platform.controller().CoreWebView2()?;
        let environment = platform.environment();
        // Logins and forms are remembered, in the browser's own store on this computer.
        if let Ok(settings) = core.Settings()?.cast::<ICoreWebView2Settings4>() {
            let _ = settings.SetIsPasswordAutosaveEnabled(true);
            let _ = settings.SetIsGeneralAutofillEnabled(true);
        }
        let _ = set_tracking(&core, view::protection().level);
        let mut token = 0i64;
        let _ = context_menu(&core, environment.clone(), app.clone(), tab.clone());
        let (failed_app, failing) = (app.clone(), tab.clone());
        // A page that couldn't open: TBV says why on a page of its own.
        core.add_NavigationCompleted(
            &NavigationCompletedEventHandler::create(Box::new(move |sender, args| {
                let Some(args) = args else { return Ok(()) };
                let mut ok = BOOL::default();
                args.IsSuccess(&mut ok)?;
                if ok.as_bool() {
                    return Ok(());
                }
                let mut status = COREWEBVIEW2_WEB_ERROR_STATUS::default();
                args.WebErrorStatus(&mut status)?;
                let Some(reason) = failure(status) else { return Ok(()) };
                let url = sender
                    .and_then(|core| {
                        let mut uri = PWSTR::null();
                        core.Source(&mut uri).ok()?;
                        Some(take_pwstr(uri))
                    })
                    .unwrap_or_default();
                tell(&failed_app, Event::Failed { tab: failing.clone(), url, reason: reason.into() });
                Ok(())
            })),
            &mut token,
        )?;
        let closing = tab.clone();
        core.add_WindowCloseRequested(
            &WindowCloseRequestedEventHandler::create(Box::new(move |_, _| {
                tell(&app, Event::Closed { tab: closing.clone() });
                Ok(())
            })),
            &mut token,
        )?;
        // Every request passes the protection level; a refused one gets an empty answer.
        core.AddWebResourceRequestedFilter(windows_core::w!("*"), COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL)?;
        core.add_WebResourceRequested(
            &WebResourceRequestedEventHandler::create(Box::new(move |_, args| {
                let Some(args) = args else { return Ok(()) };
                let mut uri = PWSTR::null();
                args.Request()?.Uri(&mut uri)?;
                let uri = take_pwstr(uri);
                if view::protection().blocks(&uri, &view::site_of(&tab)) {
                    let refused = environment.CreateWebResourceResponse(None, 403, &HSTRING::from("Blocked"), &HSTRING::new())?;
                    args.SetResponse(&refused)?;
                }
                Ok(())
            })),
            &mut token,
        )?;
        if let Ok(core4) = core.cast::<ICoreWebView2_4>() {
            core4.add_DownloadStarting(
                &DownloadStartingEventHandler::create(Box::new(|_, args| {
                    if let Some(operation) = args.and_then(|a| a.DownloadOperation().ok()) {
                        let mut uri = PWSTR::null();
                        if operation.Uri(&mut uri).is_ok() {
                            let uri = take_pwstr(uri);
                            OPERATIONS.with(|o| o.borrow_mut().insert(uri, operation));
                        }
                    }
                    Ok(())
                })),
                &mut token,
            )?;
        }
        Ok(())
    }

    /// A link's right-click menu gets TBV's own items at the top.
    unsafe fn context_menu(core: &ICoreWebView2, environment: ICoreWebView2Environment, app: tauri::AppHandle, tab: String) -> windows_core::Result<()> {
        let core = core.cast::<ICoreWebView2_11>()?;
        let environment = environment.cast::<ICoreWebView2Environment9>()?;
        let mut token = 0i64;
        core.add_ContextMenuRequested(
            &ContextMenuRequestedEventHandler::create(Box::new(move |_, args| {
                let Some(args) = args else { return Ok(()) };
                let target = args.ContextMenuTarget()?;
                let mut has = BOOL::default();
                target.HasLinkUri(&mut has)?;
                if !has.as_bool() {
                    return Ok(());
                }
                let mut uri = PWSTR::null();
                target.LinkUri(&mut uri)?;
                let link = take_pwstr(uri);
                if !(link.starts_with("https://") || link.starts_with("http://")) {
                    return Ok(());
                }
                let items = args.MenuItems()?;
                // WebView2's own "Open link in new window" would open a tab anyway; TBV's says so.
                let mut count = 0u32;
                items.Count(&mut count)?;
                for i in (0..count).rev() {
                    let mut name = PWSTR::null();
                    items.GetValueAtIndex(i)?.Name(&mut name)?;
                    if take_pwstr(name) == "openLinkInNewWindow" {
                        items.RemoveValueAtIndex(i)?;
                    }
                }
                for (at, (label, action)) in super::link_menu(&link).into_iter().enumerate() {
                    let item = environment.CreateContextMenuItem(&HSTRING::from(label), None::<&windows::Win32::System::Com::IStream>, COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_COMMAND)?;
                    let (app, tab, link) = (app.clone(), tab.clone(), link.clone());
                    let mut chosen = 0i64;
                    item.add_CustomItemSelected(
                        &CustomItemSelectedEventHandler::create(Box::new(move |_, _| {
                            tell(&app, Event::Menu { tab: tab.clone(), action: action.into(), url: link.clone() });
                            Ok(())
                        })),
                        &mut chosen,
                    )?;
                    items.InsertValueAtIndex(at as u32, &item)?;
                }
                Ok(())
            })),
            &mut token,
        )
    }

    /// The pages behind and ahead, from the web view's own history.
    pub fn travelled(view: &tauri::Webview) -> crate::CommandResult<super::Travelled> {
        let (send, receive) = std::sync::mpsc::channel::<String>();
        view.with_webview(move |platform| unsafe {
            let Ok(core) = platform.controller().CoreWebView2() else { return };
            let done = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(move |_, answer| {
                let _ = send.send(answer);
                Ok(())
            }));
            let _ = core.CallDevToolsProtocolMethod(windows_core::w!("Page.getNavigationHistory"), windows_core::w!("{}"), &done);
        })
        .map_err(|e| e.to_string())?;
        let answer = receive.recv_timeout(std::time::Duration::from_secs(5)).map_err(|_| "The page took too long to answer.".to_string())?;
        #[derive(serde::Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct History {
            current_index: usize,
            entries: Vec<super::Visited>,
        }
        let history: History = serde_json::from_str(&answer).map_err(|e| e.to_string())?;
        let at = history.current_index.min(history.entries.len());
        let web = |v: &super::Visited| v.url.starts_with("http");
        Ok(super::Travelled {
            back: history.entries[..at].iter().rev().filter(|v| web(v)).cloned().collect(),
            forward: history.entries.iter().skip(at + 1).filter(|v| web(v)).cloned().collect(),
        })
    }

    /// Why a page couldn't open, for TBV's page; None for what isn't a real
    /// failure (stopped, or a link that became a download).
    fn failure(status: COREWEBVIEW2_WEB_ERROR_STATUS) -> Option<&'static str> {
        Some(match status {
            COREWEBVIEW2_WEB_ERROR_STATUS_DISCONNECTED => "You're not connected to the internet.",
            COREWEBVIEW2_WEB_ERROR_STATUS_HOST_NAME_NOT_RESOLVED => "TBV couldn't find this site. Check the address, or your internet connection.",
            COREWEBVIEW2_WEB_ERROR_STATUS_TIMEOUT => "The site took too long to answer.",
            COREWEBVIEW2_WEB_ERROR_STATUS_CANNOT_CONNECT | COREWEBVIEW2_WEB_ERROR_STATUS_SERVER_UNREACHABLE | COREWEBVIEW2_WEB_ERROR_STATUS_CONNECTION_RESET => {
                "TBV couldn't reach this site. It may be down, or your connection may have dropped."
            }
            COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_EXPIRED | COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_IS_INVALID | COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_REVOKED => {
                "This site's security certificate isn't valid, so TBV didn't open it. Someone could be pretending to be the site."
            }
            COREWEBVIEW2_WEB_ERROR_STATUS_REDIRECT_FAILED => "The site kept sending TBV somewhere else, so it stopped.",
            _ => return None,
        })
    }

    /// Clears one site's cookies and storage, at its secure and plain addresses.
    pub fn clear_site(view: &tauri::Webview, host: String) {
        let _ = view.with_webview(move |platform| unsafe {
            let Ok(core) = platform.controller().CoreWebView2() else { return };
            let bare = host.strip_prefix("www.").unwrap_or(&host).to_string();
            let mut hosts = vec![host.clone()];
            if bare != host {
                hosts.push(bare.clone());
            } else {
                hosts.push(format!("www.{host}"));
            }
            for host in hosts {
                for scheme in ["https", "http"] {
                    let params = serde_json::json!({ "origin": format!("{scheme}://{host}"), "storageTypes": "all" }).to_string();
                    let done = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(|_, _| Ok(())));
                    let _ = core.CallDevToolsProtocolMethod(windows_core::w!("Storage.clearDataForOrigin"), &HSTRING::from(params), &done);
                }
            }
        });
    }

    thread_local! {
        /// What the last Share asked for, taken away before the next one.
        static SHARING: std::cell::Cell<Option<i64>> = const { std::cell::Cell::new(None) };
    }

    /// Windows' own Share panel, for the page in front.
    pub fn share(app: &tauri::AppHandle, url: String, title: String) -> crate::CommandResult<()> {
        use tauri::Manager;
        let window = app.get_window("main").ok_or("TBV's window isn't open.")?;
        let hwnd = window.hwnd().map_err(|e| e.to_string())?.0 as isize;
        let (send, receive) = std::sync::mpsc::channel();
        app.run_on_main_thread(move || {
            let _ = send.send(unsafe { show_share(hwnd, url, title) }.map_err(|e| e.message()));
        })
        .map_err(|e| e.to_string())?;
        receive
            .recv_timeout(std::time::Duration::from_secs(10))
            .map_err(|_| "Windows didn't open its Share panel.".to_string())?
            .map_err(|_| "Windows couldn't open its Share panel. Copy the link instead.".to_string())
    }

    unsafe fn show_share(hwnd: isize, url: String, title: String) -> windows_core::Result<()> {
        use windows::ApplicationModel::DataTransfer::{DataRequestedEventArgs, DataTransferManager};
        use windows::Foundation::{TypedEventHandler, Uri};
        use windows::Win32::Foundation::HWND;
        use windows::Win32::UI::Shell::IDataTransferManagerInterop;
        let hwnd = HWND(hwnd as _);
        let interop = windows_core::factory::<DataTransferManager, IDataTransferManagerInterop>()?;
        let manager: DataTransferManager = interop.GetForWindow(hwnd)?;
        if let Some(token) = SHARING.with(|s| s.take()) {
            let _ = manager.RemoveDataRequested(token);
        }
        let token = manager.DataRequested(&TypedEventHandler::<DataTransferManager, DataRequestedEventArgs>::new(move |_, args| {
            if let Some(args) = args.as_ref() {
                let data = args.Request()?.Data()?;
                data.Properties()?.SetTitle(&HSTRING::from(title.as_str()))?;
                data.SetWebLink(&Uri::CreateUri(&HSTRING::from(url.as_str()))?)?;
            }
            Ok(())
        }))?;
        SHARING.with(|s| s.set(Some(token)));
        interop.ShowShareUIForWindow(hwnd)
    }

    /// A sign-in pop-up: it closes itself when the site is done with it.
    pub fn popup(window: &tauri::WebviewWindow) {
        let closing = window.clone();
        let _ = window.with_webview(move |platform| unsafe {
            if let Ok(core) = platform.controller().CoreWebView2() {
                let mut token = 0i64;
                let _ = core.add_WindowCloseRequested(
                    &WindowCloseRequestedEventHandler::create(Box::new(move |_, _| {
                        let _ = closing.close();
                        Ok(())
                    })),
                    &mut token,
                );
            }
        });
    }

    pub fn cancel(view: &tauri::Webview, url: String) {
        let _ = view.with_webview(move |_| {
            if let Some(operation) = OPERATIONS.with(|o| o.borrow_mut().remove(&url)) {
                unsafe {
                    let _ = operation.Cancel();
                }
            }
        });
    }
}

#[cfg(mobile)]
mod view {
    use super::Frame;
    use crate::protection::Protection;
    use crate::CommandResult;

    fn ask(args: serde_json::Value) -> CommandResult<serde_json::Value> {
        tauri_plugin_tbv_ios::browser(args)
    }

    fn frame_of(frame: Frame) -> serde_json::Value {
        serde_json::json!({ "x": frame.x, "y": frame.y, "width": frame.width, "height": frame.height })
    }

    fn rules(protection: &Protection) -> serde_json::Value {
        serde_json::json!({ "level": protection.level_name(), "rules": protection.apple_rules() })
    }

    pub fn show(_app: &tauri::AppHandle, tab: &str, url: Option<tauri::Url>, frame: Frame, protection: Option<Protection>, private: bool) -> CommandResult<()> {
        let mut args = serde_json::json!({ "action": "show", "tab": tab, "url": url.map(|u| u.to_string()), "frame": frame_of(frame), "incognito": private });
        if let Some(p) = protection {
            args["protection"] = rules(&p);
        }
        ask(args).map(|_| ())
    }

    pub fn place(_app: &tauri::AppHandle, frame: Frame) -> CommandResult<()> {
        ask(serde_json::json!({ "action": "place", "frame": frame_of(frame) })).map(|_| ())
    }

    pub fn hide(_app: &tauri::AppHandle) -> CommandResult<()> {
        ask(serde_json::json!({ "action": "hide" })).map(|_| ())
    }

    pub fn clear(_app: &tauri::AppHandle) -> CommandResult<()> {
        ask(serde_json::json!({ "action": "clear" })).map(|_| ())
    }

    pub fn act(_app: &tauri::AppHandle, tab: &str, action: &str, url: Option<tauri::Url>) -> CommandResult<()> {
        ask(serde_json::json!({ "action": action, "tab": tab, "url": url.map(|u| u.to_string()) })).map(|_| ())
    }

    pub fn find(_app: &tauri::AppHandle, tab: &str, text: &str, backwards: bool) -> CommandResult<()> {
        ask(serde_json::json!({ "action": "find", "tab": tab, "text": text, "backwards": backwards })).map(|_| ())
    }

    pub fn set_protection(_app: &tauri::AppHandle, protection: Protection) {
        let _ = ask(serde_json::json!({ "action": "protect", "protection": rules(&protection) }));
    }

    pub fn run(_app: &tauri::AppHandle, tab: &str, script: &str) -> CommandResult<serde_json::Value> {
        let answer = ask(serde_json::json!({ "action": "run", "tab": tab, "script": script }))?;
        let text = answer.get("result").and_then(|r| r.as_str()).unwrap_or("null");
        Ok(serde_json::from_str(text).unwrap_or(serde_json::Value::Null))
    }

    pub fn cancel(_app: &tauri::AppHandle, id: &str) -> CommandResult<()> {
        ask(serde_json::json!({ "action": "cancel", "id": id })).map(|_| ())
    }

    pub fn zoom(_app: &tauri::AppHandle, tab: &str, zoom: f64) -> CommandResult<()> {
        ask(serde_json::json!({ "action": "zoom", "tab": tab, "zoom": zoom })).map(|_| ())
    }

    /// The sites shown as on a computer, not their phone version.
    pub fn desktop_sites(_app: &tauri::AppHandle, hosts: Vec<String>) -> CommandResult<()> {
        ask(serde_json::json!({ "action": "desktopSites", "text": hosts.join("\n") })).map(|_| ())
    }

    pub fn clear_site(_app: &tauri::AppHandle, host: &str) -> CommandResult<()> {
        ask(serde_json::json!({ "action": "clearSite", "text": host })).map(|_| ())
    }

    pub fn share(_app: &tauri::AppHandle, url: &str, title: &str, anchor: Option<Frame>) -> CommandResult<()> {
        ask(serde_json::json!({ "action": "share", "url": url, "text": title, "frame": anchor.map(frame_of) })).map(|_| ())
    }

    pub fn open_app(_app: &tauri::AppHandle, url: &str) -> CommandResult<()> {
        ask(serde_json::json!({ "action": "openApp", "url": url })).map(|_| ())
    }

    pub fn travelled(_app: &tauri::AppHandle, tab: &str) -> CommandResult<super::Travelled> {
        let answer = ask(serde_json::json!({ "action": "history", "tab": tab }))?;
        Ok(serde_json::from_value(answer).unwrap_or_default())
    }
}

/// A link for another app that TBV may open: never the computer's own files or a page's script.
fn app_link(url: &str) -> bool {
    let scheme = url.split(':').next().unwrap_or_default().to_ascii_lowercase();
    !scheme.is_empty() && !matches!(scheme.as_str(), "http" | "https" | "about" | "blob" | "data" | "file" | "javascript" | "vbscript" | "tauri" | "ipc" | "asset")
}

/// On iPhone and iPad: hears what Apple's web views did and passes it on to
/// TBV's page, as the computer's views do by themselves.
#[cfg(mobile)]
pub fn listen(app: tauri::AppHandle) {
    std::thread::spawn(move || loop {
        match tauri_plugin_tbv_ios::browser_event() {
            Some(event) => {
                let _ = app.emit_to(EventTarget::webview("main"), "browser-event", event);
            }
            // Not ready yet, or nothing happened: ask again shortly.
            None => std::thread::sleep(std::time::Duration::from_millis(500)),
        }
    });
}

/// Shows tab `tab` in `frame` (making it, at `url`, if it's new) and hides
/// the others. A new `private` tab keeps no cookies, storage or history.
#[tauri::command]
pub async fn browser_show(app: tauri::AppHandle, tab: String, url: Option<String>, frame: Frame, protection: Option<Protection>, private: Option<bool>) -> CommandResult<()> {
    let tab = tab_name(&tab)?;
    let url = url.as_deref().map(web_url).transpose()?;
    view::show(&app, &tab, url, frame, protection, private.unwrap_or(false))
}

/// Moves the tab in front when the space for it moves or changes size.
#[tauri::command]
pub async fn browser_place(app: tauri::AppHandle, frame: Frame) -> CommandResult<()> {
    view::place(&app, frame)
}

/// Hides every tab (another page is showing, or a dialog is open). They keep their pages.
#[tauri::command]
pub async fn browser_hide(app: tauri::AppHandle) -> CommandResult<()> {
    view::hide(&app)
}

/// `go` (to `url`), `back`, `forward`, `reload`, `stop` or `close`, in tab `tab`.
#[tauri::command]
pub async fn browser_act(app: tauri::AppHandle, tab: String, action: String, url: Option<String>) -> CommandResult<()> {
    let tab = tab_name(&tab)?;
    let url = url.as_deref().map(web_url).transpose()?;
    view::act(&app, &tab, &action, url)
}

/// Clears every site's cookies, saved logins and storage.
#[tauri::command]
pub async fn browser_clear(app: tauri::AppHandle) -> CommandResult<()> {
    view::clear(&app)
}

/// Finds `text` on the tab's page, the next one each time (or the one before).
#[tauri::command]
pub async fn browser_find(app: tauri::AppHandle, tab: String, text: String, backwards: bool) -> CommandResult<()> {
    let tab = tab_name(&tab)?;
    view::find(&app, &tab, &text, backwards)
}

/// The protection level changed, or a site's was lowered.
#[tauri::command]
pub async fn browser_protect(app: tauri::AppHandle, protection: Protection) -> CommandResult<()> {
    view::set_protection(&app, protection);
    Ok(())
}

/// Reader mode: runs TBV's article finder (Readability, sent by TBV's page)
/// on the tab's page and answers the article, or null when there's none.
#[tauri::command]
pub async fn browser_read(app: tauri::AppHandle, tab: String, script: String) -> CommandResult<serde_json::Value> {
    let tab = tab_name(&tab)?;
    tauri::async_runtime::spawn_blocking(move || view::run(&app, &tab, &script)).await.map_err(|e| e.to_string())?
}

/// Stops a download that's coming down; nothing of it is kept.
#[tauri::command]
pub async fn browser_cancel_download(app: tauri::AppHandle, id: String) -> CommandResult<()> {
    view::cancel(&app, &id)
}

/// How large the tab's page is drawn, from 0.3 to 3 (1 is the site's own size).
#[tauri::command]
pub async fn browser_zoom(app: tauri::AppHandle, tab: String, zoom: f64) -> CommandResult<()> {
    let tab = tab_name(&tab)?;
    if !zoom.is_finite() {
        return Err("That isn't a size.".into());
    }
    view::zoom(&app, &tab, zoom.clamp(0.3, 3.0))
}

/// iPhone and iPad: the sites given their computer version (Request desktop site).
#[tauri::command]
pub async fn browser_desktop_sites(app: tauri::AppHandle, hosts: Vec<String>) -> CommandResult<()> {
    view::desktop_sites(&app, hosts.into_iter().filter(|h| site_name(h).is_ok()).collect())
}

/// A site's name from TBV's page, such as "www.example.com".
fn site_name(host: &str) -> CommandResult<String> {
    let host = host.trim().to_ascii_lowercase();
    if host.is_empty() || host.len() > 253 || !host.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | ':' | '[' | ']')) {
        return Err("That isn't a site's name.".into());
    }
    Ok(host)
}

/// Clears one site's cookies and stored data (signing it out); other sites keep theirs.
#[tauri::command]
pub async fn browser_clear_site(app: tauri::AppHandle, site: String) -> CommandResult<()> {
    let site = site_name(&site)?;
    view::clear_site(&app, &site)
}

/// The system's Share panel for a page. `anchor` is the button it opens from (for iPad).
#[tauri::command]
pub async fn browser_share(app: tauri::AppHandle, url: String, title: String, anchor: Option<Frame>) -> CommandResult<()> {
    let url = web_url(&url)?;
    view::share(&app, url.as_str(), title.trim(), anchor)
}

/// Opens a link for another app (mail, a phone number), told by `External`.
#[tauri::command]
pub async fn browser_open_app(app: tauri::AppHandle, url: String) -> CommandResult<()> {
    let url = url.trim();
    if !app_link(url) || tauri::Url::parse(url).is_err() {
        return Err("TBV doesn't open that kind of link.".into());
    }
    view::open_app(&app, url)
}

/// The pages behind and ahead of the tab's page, for the Back and Forward buttons' menus.
#[tauri::command]
pub async fn browser_travelled(app: tauri::AppHandle, tab: String) -> CommandResult<Travelled> {
    let tab = tab_name(&tab)?;
    tauri::async_runtime::spawn_blocking(move || view::travelled(&app, &tab)).await.map_err(|e| e.to_string())?
}

/// A picture from a web page, for an article saved from reader mode. At most 10 MB.
#[tauri::command]
pub async fn browser_fetch_picture(url: String) -> CommandResult<tauri::ipc::Response> {
    let url = web_url(&url)?.to_string();
    let bytes = tauri::async_runtime::spawn_blocking(move || tbv_core::opds::fetch_picture(&url).map_err(|e| e.to_string()))
        .await
        .map_err(|e| e.to_string())??;
    Ok(tauri::ipc::Response::new(bytes))
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

/// Adds a file the browser brought down to the library, through the import
/// queue, and answers the id the book will have.
#[tauri::command]
pub async fn browser_add_download(
    app: tauri::AppHandle,
    state: State<'_, AppLibrary>,
    imports: State<'_, Arc<imports::Imports>>,
    path: String,
) -> CommandResult<String> {
    let path = in_downloads(&app, &path)?;
    let folder = path.parent().map(Path::to_path_buf).ok_or("That download is gone.")?;
    let (library, imports) = (state.0.clone(), imports.inner().clone());
    tauri::async_runtime::spawn_blocking(move || {
        // The id the book will have, so Read now can open it once it's in.
        let id = tbv_core::ids::book_id_for_file(&path).map_err(|e| e.to_string())?;
        let holding = Arc::new(TempFolder::adopt(folder));
        imports.add_holding(&app, &library, vec![path], Some(holding));
        Ok(id)
    })
    .await
    .map_err(|e| e.to_string())?
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

#[tauri::command]
pub async fn quick_links(state: State<'_, AppLibrary>) -> CommandResult<Vec<QuickLink>> {
    with_library(state, |library| library.quick_links()).await
}

#[tauri::command]
pub async fn add_quick_link(state: State<'_, AppLibrary>, title: String, url: String, picture: String) -> CommandResult<QuickLink> {
    with_library(state, move |library| library.add_quick_link(&title, &url, &picture)).await
}

#[tauri::command]
pub async fn update_quick_link(state: State<'_, AppLibrary>, id: String, title: String, url: String, picture: String) -> CommandResult<()> {
    with_library(state, move |library| library.update_quick_link(&id, &title, &url, &picture)).await
}

#[tauri::command]
pub async fn remove_quick_link(state: State<'_, AppLibrary>, id: String) -> CommandResult<()> {
    with_library(state, move |library| library.remove_quick_link(&id)).await
}

#[tauri::command]
pub async fn move_quick_link(state: State<'_, AppLibrary>, id: String, to: usize) -> CommandResult<()> {
    with_library(state, move |library| library.move_quick_link(&id, to)).await
}

/// A website's own small icon, as a data address, for the start page.
#[tauri::command]
pub async fn site_icon(url: String) -> CommandResult<String> {
    let url = web_url(&url)?.to_string();
    tauri::async_runtime::spawn_blocking(move || tbv_core::site_icon::site_icon(&url).map_err(|e| e.to_string()))
        .await
        .map_err(|e| e.to_string())?
}

/// Discover's history, newest first.
#[tauri::command]
pub async fn browser_history(state: State<'_, AppLibrary>) -> CommandResult<Vec<HistoryEntry>> {
    with_library(state, |library| library.browser_history()).await
}

#[tauri::command]
pub async fn put_browser_history(state: State<'_, AppLibrary>, entries: Vec<HistoryEntry>) -> CommandResult<()> {
    with_library(state, move |library| library.put_browser_history(&entries)).await
}

#[tauri::command]
pub async fn remove_browser_history(state: State<'_, AppLibrary>, ids: Vec<String>) -> CommandResult<()> {
    with_library(state, move |library| library.remove_browser_history(&ids)).await
}

/// Clears what's from `since` (milliseconds since 1970) on, or everything.
#[tauri::command]
pub async fn clear_browser_history(state: State<'_, AppLibrary>, since: Option<i64>) -> CommandResult<()> {
    with_library(state, move |library| library.clear_browser_history(since)).await
}

/// Lets go of what's older than `before` on this device only.
#[tauri::command]
pub async fn trim_browser_history(state: State<'_, AppLibrary>, before: i64) -> CommandResult<()> {
    with_library(state, move |library| library.trim_browser_history(before)).await
}

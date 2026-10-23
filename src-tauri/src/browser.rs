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

    fn label(tab: &str) -> String {
        format!("{PREFIX}{tab}")
    }

    fn tabs(app: &tauri::AppHandle) -> Vec<tauri::Webview> {
        app.webviews().into_iter().filter(|(l, _)| l.starts_with(PREFIX) && !l.starts_with("browser-popup-")).map(|(_, v)| v).collect()
    }

    pub fn show(app: &tauri::AppHandle, tab: &str, url: Option<tauri::Url>, frame: Frame, protection: Option<Protection>) -> CommandResult<()> {
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
            return Ok(());
        }
        let start = url.unwrap_or_else(|| tauri::Url::parse("about:blank").expect("a fixed address"));
        set_site(tab, &start);
        let window = app.get_window("main").ok_or("TBV's window isn't open.")?;
        let data = data_dir(app)?;
        let (pages, titles, windows, downloads) = (app.clone(), app.clone(), app.clone(), app.clone());
        let (page_tab, title_tab, window_tab, download_tab) = (tab.to_string(), tab.to_string(), tab.to_string(), tab.to_string());
        let saves = downloads_dir(app)?;
        let builder = WebviewBuilder::new(label(tab), WebviewUrl::External(start))
            // Its own cookies, saved logins and storage, so clearing them leaves TBV's alone.
            .data_directory(data)
            .on_page_load(move |_, payload| {
                if matches!(payload.event(), PageLoadEvent::Started) {
                    set_site(&page_tab, payload.url());
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
            // Mail and other links that aren't web pages go to the computer's own apps.
            .on_navigation(|url| {
                let web = matches!(url.scheme(), "http" | "https" | "about" | "blob" | "data");
                if !web {
                    let _ = tauri_plugin_opener::open_url(url.as_str(), None::<&str>);
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
        #[cfg(windows)]
        let level = protection.level;
        if let Ok(mut p) = PROTECTION.lock() {
            *p = Some(protection);
        }
        #[cfg(windows)]
        for view in tabs(app) {
            super::windows::tracking(&view, level);
        }
        let _ = app;
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
}

/// The parts that need Windows' own web view (WebView2): tracking prevention,
/// blocking by the protection level, saved logins, pages closing themselves,
/// and cancelling a download.
#[cfg(windows)]
mod windows {
    use std::cell::RefCell;
    use std::collections::HashMap;

    use webview2_com::Microsoft::Web::WebView2::Win32::*;
    use webview2_com::{take_pwstr, DownloadStartingEventHandler, WebResourceRequestedEventHandler, WindowCloseRequestedEventHandler};
    use windows_core::{Interface, HSTRING, PWSTR};

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

    pub fn show(_app: &tauri::AppHandle, tab: &str, url: Option<tauri::Url>, frame: Frame, protection: Option<Protection>) -> CommandResult<()> {
        let mut args = serde_json::json!({ "action": "show", "tab": tab, "url": url.map(|u| u.to_string()), "frame": frame_of(frame) });
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

/// Shows tab `tab` in `frame` (making it, at `url`, if it's new) and hides the others.
#[tauri::command]
pub async fn browser_show(app: tauri::AppHandle, tab: String, url: Option<String>, frame: Frame, protection: Option<Protection>) -> CommandResult<()> {
    let tab = tab_name(&tab)?;
    let url = url.as_deref().map(web_url).transpose()?;
    view::show(&app, &tab, url, frame, protection)
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

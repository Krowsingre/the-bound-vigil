//! Nexus's menus as their own small windows (embre, 19 November).
//!
//! A website in Nexus is a separate web view laid over TBV's window, so TBV's
//! own menus can't draw on top of it, and the page used to go blank while one
//! was open. On the computer, Nexus's menus open instead in a little window of
//! their own floating over the page, as other browsers' menus do. TBV's page
//! asks for one with the menu's items and where its button is; the window
//! (menu.html) draws them, fits itself, and says which was chosen, which goes
//! back to TBV's page as `tbv://menu-popup-chosen`.

use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder};

const LABEL: &str = "menu-popup";

/// What the menu window is showing, for it to read when it opens.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    /// Which ask this is, so a late answer to an earlier menu is ignored.
    pub id: u64,
    /// The menu's name, its items and the look of TBV's page (drawn by menu.html).
    pub menu: Value,
    /// The button (or the point right-clicked), in TBV's page, in its own pixels.
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    /// "end": the menu's right edge lines up with the button's; "start": its left; "point": a right-click.
    pub align: String,
}

/// TBV's window. Not `get_webview_window`: while Nexus shows a website the
/// window holds the sites' views too, and then that finds nothing, which is
/// what left every Nexus menu doing nothing in 0.145.
fn main_window(app: &AppHandle) -> Result<tauri::Window, String> {
    app.get_window("main").ok_or_else(|| "TBV's window isn't open.".to_string())
}

#[derive(Default)]
pub struct Showing(Mutex<Option<Request>>);

/// Opens the menu window (making it the first time) with a new menu. Async:
/// making a window in a command that isn't would freeze Windows.
#[tauri::command]
pub async fn menu_popup_open(app: AppHandle, request: Request) -> Result<(), String> {
    let state = app.state::<Showing>();
    // A menu still open is closed first, unchosen.
    if let Some(old) = state.0.lock().map_err(|e| e.to_string())?.replace(request.clone()) {
        let _ = app.emit_to("main", "tbv://menu-popup-chosen", Chosen { id: old.id, path: None });
    }
    if let Some(window) = app.get_webview_window(LABEL) {
        window.emit("tbv://menu-popup-request", &request).map_err(|e| e.to_string())?;
        return Ok(());
    }
    let main = main_window(&app)?;
    let window = WebviewWindowBuilder::new(&app, LABEL, WebviewUrl::App("menu.html".into()))
        .title("Menu")
        .decorations(false)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .skip_taskbar(true)
        .shadow(false)
        .visible(false)
        .focused(false)
        .inner_size(240.0, 40.0);
    // Kept above TBV's window and hidden with it.
    #[cfg(windows)]
    let window = window.owner_raw(main.hwnd().map_err(|e| e.to_string())?);
    #[cfg(not(windows))]
    let _ = &main;
    #[cfg(not(target_os = "macos"))]
    let window = window.transparent(true);
    let window = window.build().map_err(|e| e.to_string())?;
    let closer = app.clone();
    window.on_window_event(move |event| {
        // Clicking anywhere else closes it, as other menus do.
        if let tauri::WindowEvent::Focused(false) = event {
            close(&closer, None, false);
        }
    });
    Ok(())
}

/// The menu being shown, for the menu window when it first opens.
#[tauri::command]
pub fn menu_popup_request(app: AppHandle) -> Option<Request> {
    app.state::<Showing>().0.lock().ok()?.clone()
}

/// The menu window has drawn the menu: it's this size (its own pixels), so
/// it goes by the button, below it if there's room on the screen, else above.
#[tauri::command]
pub fn menu_popup_fit(app: AppHandle, id: u64, width: f64, height: f64) -> Result<(), String> {
    let Some(request) = app.state::<Showing>().0.lock().map_err(|e| e.to_string())?.clone() else { return Ok(()) };
    if request.id != id {
        return Ok(());
    }
    let main = main_window(&app)?;
    let window = app.get_webview_window(LABEL).ok_or("The menu window isn't open.")?;
    let scale = main.scale_factor().map_err(|e| e.to_string())?;
    let origin = main.inner_position().map_err(|e| e.to_string())?;
    let (w, h) = (width * scale, height * scale);
    let gap = if request.align == "point" { 0.0 } else { 6.0 * scale };
    let left = origin.x as f64 + request.x * scale;
    let right = left + request.width * scale;
    let top = origin.y as f64 + request.y * scale;
    let bottom = top + request.height * scale;
    // The screen it's on, so it never runs off the edge.
    let screen = main
        .available_monitors()
        .ok()
        .and_then(|monitors| {
            monitors.into_iter().find(|m| {
                let (p, s) = (m.position(), m.size());
                left >= p.x as f64 && left < p.x as f64 + s.width as f64 && top >= p.y as f64 && top < p.y as f64 + s.height as f64
            })
        })
        .or_else(|| main.current_monitor().ok().flatten());
    let (sx, sy, sw, sh) = screen
        .map(|m| (m.position().x as f64, m.position().y as f64, m.size().width as f64, m.size().height as f64))
        .unwrap_or((f64::MIN / 4.0, f64::MIN / 4.0, f64::MAX / 2.0, f64::MAX / 2.0));
    let mut x = match request.align.as_str() {
        "end" => right - w,
        _ => left,
    };
    x = x.min(sx + sw - w).max(sx);
    let below = bottom + gap;
    let mut y = if below + h <= sy + sh || top - gap - h < sy { below } else { top - gap - h };
    y = y.min(sy + sh - h).max(sy);
    window.set_size(tauri::LogicalSize::new(width, height)).map_err(|e| e.to_string())?;
    window.set_position(PhysicalPosition::new(x.round() as i32, y.round() as i32)).map_err(|e| e.to_string())?;
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Clone, Serialize)]
struct Chosen {
    id: u64,
    /// Which item, as its place in the menu and then in its submenu; none when closed unchosen.
    path: Option<Vec<usize>>,
}

/// The menu window's answer: an item, or closed with nothing chosen.
#[tauri::command]
pub fn menu_popup_choose(app: AppHandle, id: u64, path: Option<Vec<usize>>) {
    let showing = app.state::<Showing>().0.lock().ok().and_then(|s| s.as_ref().map(|r| r.id));
    if showing == Some(id) {
        close(&app, path, true);
    }
}

/// Hides the menu window and tells TBV's page what was chosen. Clicking
/// another app leaves the focus there; anything else gives it back to TBV.
fn close(app: &AppHandle, path: Option<Vec<usize>>, refocus: bool) {
    let Some(request) = app.state::<Showing>().0.lock().ok().and_then(|mut s| s.take()) else { return };
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.hide();
    }
    let _ = app.emit_to("main", "tbv://menu-popup-chosen", Chosen { id: request.id, path });
    // Back to TBV's window, so keys go where they were going.
    if refocus {
        if let Ok(main) = main_window(app) {
            let _ = main.set_focus();
        }
    }
}

//! Opening TBV on a computer: a small card with the splash shows at once,
//! while the main window gets ready out of sight. The page says how far it
//! has got (the card's bar) and when its first screen is drawn; then the
//! main window shows behind the card, already finished, and once it has
//! drawn itself on screen the card breaks up into specks (or fades, with
//! Reduce motion on). The card's window is bigger than the card, with clear
//! room round it, so the specks can drift off it before they fade.
//!
//! The hidden window is made the size of the screen from the start, so the
//! page lays itself out once, at its real size. (Made at its normal size and
//! maximised when shown, Windows stretched the smaller picture into place
//! and the page redrew, which looked like a blur settling.) Windows' own
//! opening animation is turned off for it too.

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, EventTarget, Manager};

const LABEL: &str = "splash";
/// The main window shows by itself after this long, whatever the page says.
#[cfg(desktop)]
const AT_MOST: Duration = Duration::from_secs(25);

static SHOWN: AtomicBool = AtomicBool::new(false);
static REVEALED: AtomicBool = AtomicBool::new(false);
/// The card goes after this long once the main window shows, if the page never says it has drawn.
#[cfg(desktop)]
const DRAWN_AT_MOST: Duration = Duration::from_millis(1500);
/// The card's size, and the clear room round it for its specks to drift into.
#[cfg(desktop)]
const CARD: (f64, f64) = (420.0, 630.0);
#[cfg(desktop)]
const ROOM: f64 = 130.0;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Splash {
    progress: f64,
    label: Option<String>,
    done: bool,
    /// Fade instead of breaking up (Reduce motion).
    still: bool,
}

/// Makes the main window, hidden on a computer behind the splash card.
pub fn open(app: &tauri::App) -> tauri::Result<()> {
    let config = app.config().app.windows.iter().find(|w| w.label == "main").cloned().ok_or(tauri::Error::WindowNotFound)?;
    #[cfg(desktop)]
    {
        // As much room round the card as the screen allows.
        let (width, height) = app
            .primary_monitor()
            .ok()
            .flatten()
            .map(|m| m.work_area().size.to_logical::<f64>(m.scale_factor()))
            .map(|area| ((CARD.0 + 2.0 * ROOM).min(area.width), (CARD.1 + 2.0 * ROOM).min(area.height)))
            .unwrap_or((CARD.0 + 36.0, CARD.1 + 36.0));
        let card = tauri::WebviewWindowBuilder::new(app, LABEL, tauri::WebviewUrl::App("splash.html".into()))
            .title("The Bound Vigil")
            .inner_size(width, height)
            .center()
            .resizable(false)
            .maximizable(false)
            .decorations(false)
            .shadow(false);
        #[cfg(not(target_os = "macos"))]
        let card = card.transparent(true);
        let card = card.build()?;
        let main = tauri::WebviewWindowBuilder::from_config(app.handle(), &config)?.visible(false);
        // The Mac keeps its own window buttons, over the top of the sidebar.
        #[cfg(target_os = "macos")]
        let main = main
            .decorations(true)
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .hidden_title(true)
            .traffic_light_position(tauri::LogicalPosition::new(14.0, 20.0));
        // The screen's working area (without the taskbar), where the window will fill.
        let area = card.current_monitor().ok().flatten().or_else(|| app.primary_monitor().ok().flatten()).map(|m| {
            let scale = m.scale_factor();
            let area = m.work_area();
            (area.position.to_logical::<f64>(scale), area.size.to_logical::<f64>(scale))
        });
        let main = match area {
            Some((at, size)) if config.maximized => main.position(at.x, at.y).inner_size(size.width, size.height),
            _ => main,
        };
        let main = main.build()?;
        #[cfg(windows)]
        transitions(&main, false);
        #[cfg(not(windows))]
        let _ = main;
        let handle = app.handle().clone();
        std::thread::spawn(move || {
            std::thread::sleep(AT_MOST);
            show_main(&handle);
        });
    }
    #[cfg(mobile)]
    tauri::WebviewWindowBuilder::from_config(app.handle(), &config)?.build()?;
    Ok(())
}

/// How far opening has got, for the card's bar.
#[tauri::command]
pub fn startup_progress(app: AppHandle, progress: f64, label: Option<String>) {
    let _ = app.emit_to(EventTarget::webview_window(LABEL), "tbv://splash", Splash { progress, label, done: false, still: false });
}

/// The first screen is ready: show it behind the card.
#[tauri::command]
pub fn startup_done(app: AppHandle) {
    show_main(&app);
}

/// The main window has drawn itself on screen: let the card go, breaking
/// up unless `still` (Reduce motion).
#[tauri::command]
pub fn startup_painted(app: AppHandle, still: Option<bool>) {
    reveal(&app, still.unwrap_or(false));
}

fn show_main(app: &AppHandle) {
    if SHOWN.swap(true, Ordering::SeqCst) {
        return;
    }
    // The card stays in front while the window behind it draws.
    #[cfg(desktop)]
    if let Some(card) = app.get_webview_window(LABEL) {
        let _ = card.set_always_on_top(true);
    }
    if let Some(main) = app.get_webview_window("main") {
        // It opens filling the screen; a window made hidden doesn't always keep that.
        #[cfg(desktop)]
        let fills = app.config().app.windows.iter().any(|w| w.label == "main" && w.maximized);
        #[cfg(desktop)]
        if fills && !main.is_maximized().unwrap_or(false) {
            let _ = main.maximize();
        }
        let _ = main.show();
    }
    #[cfg(desktop)]
    {
        let app = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(DRAWN_AT_MOST);
            reveal(&app, true);
        });
    }
}

fn reveal(app: &AppHandle, still: bool) {
    if !SHOWN.load(Ordering::SeqCst) || REVEALED.swap(true, Ordering::SeqCst) {
        return;
    }
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.set_focus();
    }
    let _ = app.emit_to(EventTarget::webview_window(LABEL), "tbv://splash", Splash { progress: 1.0, label: None, done: true, still });
    let app = app.clone();
    std::thread::spawn(move || {
        // The card's fade, or its specks drifting off.
        std::thread::sleep(Duration::from_millis(if still { 400 } else { 1400 }));
        if let Some(card) = app.get_webview_window(LABEL) {
            let _ = card.destroy();
        }
        // Minimising and restoring animate as usual from now on.
        #[cfg(windows)]
        if let Some(main) = app.get_webview_window("main") {
            transitions(&main, true);
        }
    });
}

/// Turns Windows' own animations for showing, hiding and resizing a window off or back on.
#[cfg(windows)]
fn transitions(window: &tauri::WebviewWindow, on: bool) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_TRANSITIONS_FORCEDISABLED};
    let Ok(hwnd) = window.hwnd() else { return };
    let disabled: i32 = if on { 0 } else { 1 };
    // SAFETY: the window handle is alive (the window is), and the value is the
    // 4-byte BOOL this attribute takes.
    unsafe {
        let _ = DwmSetWindowAttribute(
            HWND(hwnd.0 as _),
            DWMWA_TRANSITIONS_FORCEDISABLED,
            (&disabled as *const i32).cast(),
            std::mem::size_of::<i32>() as u32,
        );
    }
}

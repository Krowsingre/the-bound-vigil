//! Opening TBV on a computer: a small card with the splash shows at once,
//! while the main window gets ready out of sight. The page says how far it
//! has got (the card's bar) and when its first screen is drawn; then the
//! main window shows behind the card, already finished, and once it has
//! drawn itself on screen the card turns into the side bar's emblem, name and
//! tagline: the main window draws a copy of the card at the card's own spot
//! (the card says where it sits, and this turns that into the main window's
//! terms), the card's window goes, and the copy glides (glide.ts). With
//! Reduce motion on the card simply fades. The card's window is bigger than
//! the card, with clear room round it for its shadow.
//!
//! The hidden window is made the size of the screen from the start, so the
//! page lays itself out once, at its real size. (Made at its normal size and
//! maximised when shown, Windows stretched the smaller picture into place
//! and the page redrew, which looked like a blur settling.) Windows' own
//! opening animation is turned off for it too.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
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
/// The card's size, and the clear room round it for its shadow.
#[cfg(desktop)]
const CARD: (f64, f64) = (420.0, 630.0);
#[cfg(desktop)]
const ROOM: f64 = 130.0;

/// Where the card sits in its window (in its own points), and its painting.
#[derive(Clone, Deserialize, Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Card {
    left: f64,
    top: f64,
    width: f64,
    height: f64,
    painting: Option<String>,
}

static CARD_SPOT: Mutex<Option<Card>> = Mutex::new(None);
/// The glide's copy has to say it's drawn within this long, or the card goes anyway.
#[cfg(desktop)]
const HAND_OVER_AT_MOST: Duration = Duration::from_millis(2500);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Splash {
    progress: f64,
    label: Option<String>,
    done: bool,
    /// Fade instead of settling (Reduce motion).
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
        let card = build_card(app.handle(), width, height)?;
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

/// The splash card's window, the size given (with room round it for its shadow).
#[cfg(desktop)]
fn build_card(app: &AppHandle, width: f64, height: f64) -> tauri::Result<tauri::WebviewWindow> {
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
    // A see-through window needs Apple's private API, which the Mac App Store
    // refuses, so on a Mac the window is the card itself, dark to its edges.
    #[cfg(target_os = "macos")]
    let card = {
        let _ = (width, height);
        card.inner_size(CARD.0, CARD.1).center().background_color(tauri::window::Color(11, 12, 14, 255))
    };
    card.build()
}

/// Updating: the splash card comes back in place of the window, and says how
/// the download is going, so updating happens inside it (Windows' installer
/// runs out of sight). True when the card was made for this, rather than
/// still up from opening.
#[cfg(desktop)]
pub fn show_for_update(app: &AppHandle) -> bool {
    if app.get_webview_window(LABEL).is_some() {
        return false;
    }
    let made = build_card(app, CARD.0 + 36.0, CARD.1 + 36.0).is_ok();
    if made {
        if let Some(main) = app.get_webview_window("main") {
            let _ = main.hide();
        }
    }
    made
}

/// The update's progress on the card.
#[cfg(desktop)]
pub fn say(app: &AppHandle, progress: f64, label: &str) {
    let _ = app.emit_to(EventTarget::webview_window(LABEL), "tbv://splash", Splash { progress, label: Some(label.into()), done: false, still: false });
}

/// The update didn't go ahead: the window comes back and the card goes.
#[cfg(desktop)]
pub fn end_update(app: &AppHandle) {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
        let _ = main.set_focus();
    }
    if let Some(card) = app.get_webview_window(LABEL) {
        let _ = card.destroy();
    }
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

/// The main window has drawn itself on screen: let the card go, settling
/// away unless `still` (Reduce motion).
#[tauri::command]
pub fn startup_painted(app: AppHandle, still: Option<bool>) {
    reveal(&app, still.unwrap_or(false));
}

/// The card says where it sits and which painting it shows, for the glide.
#[tauri::command]
pub fn splash_card(card: Card) {
    if let Ok(mut spot) = CARD_SPOT.lock() {
        *spot = Some(card);
    }
}

/// The main window's copy of the card is drawn: the card's window goes.
#[tauri::command]
pub fn splash_handed_over(app: AppHandle) {
    close_card(&app);
}

/// The card's spot in the main window's points, from both windows' places on
/// screen (in pixels) and their scales.
pub fn in_main(card: &Card, card_at: (f64, f64), card_scale: f64, main_at: (f64, f64), main_scale: f64) -> Card {
    let x = |v: f64, at: f64, main: f64| (at + v * card_scale - main) / main_scale;
    Card {
        left: x(card.left, card_at.0, main_at.0),
        top: x(card.top, card_at.1, main_at.1),
        width: card.width * card_scale / main_scale,
        height: card.height * card_scale / main_scale,
        painting: card.painting.clone(),
    }
}

/// Tells the main window where to draw its copy of the card, if both windows
/// and the card's spot are known.
#[cfg(desktop)]
fn start_glide(app: &AppHandle) -> bool {
    let Some(spot) = CARD_SPOT.lock().ok().and_then(|s| s.clone()) else { return false };
    let (Some(card), Some(main)) = (app.get_webview_window(LABEL), app.get_webview_window("main")) else { return false };
    let (Ok(card_at), Ok(card_scale), Ok(main_at), Ok(main_scale)) =
        (card.inner_position(), card.scale_factor(), main.inner_position(), main.scale_factor())
    else {
        return false;
    };
    let from = in_main(&spot, (card_at.x as f64, card_at.y as f64), card_scale, (main_at.x as f64, main_at.y as f64), main_scale);
    app.emit_to(EventTarget::webview_window("main"), "tbv://glide", from).is_ok()
}

/// The card's window goes, and Windows animates the main window as usual again.
fn close_card(app: &AppHandle) {
    if let Some(card) = app.get_webview_window(LABEL) {
        let _ = card.destroy();
    }
    #[cfg(windows)]
    if let Some(main) = app.get_webview_window("main") {
        transitions(&main, true);
    }
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
    // The glide: the main window takes over from the card and says when (splash_handed_over).
    #[cfg(desktop)]
    if !still && start_glide(app) {
        let app = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(HAND_OVER_AT_MOST);
            close_card(&app);
        });
        return;
    }
    let _ = app.emit_to(EventTarget::webview_window(LABEL), "tbv://splash", Splash { progress: 1.0, label: None, done: true, still });
    let app = app.clone();
    std::thread::spawn(move || {
        // The card's fade, or its settle (settle.ts, about half a second).
        std::thread::sleep(Duration::from_millis(if still { 400 } else { 700 }));
        close_card(&app);
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_card_spot_lands_in_the_main_windows_points() {
        let card = Card { left: 130.0, top: 130.0, width: 420.0, height: 630.0, painting: Some("p.webp".into()) };
        // Both at 150%: the card window at (600, 150) px, the main window at (0, 0) px.
        let at = in_main(&card, (600.0, 150.0), 1.5, (0.0, 0.0), 1.5);
        assert_eq!((at.left, at.top, at.width, at.height), (530.0, 230.0, 420.0, 630.0));
        assert_eq!(at.painting.as_deref(), Some("p.webp"));
        // The card on a 100% screen, the main window at 200% further along.
        let at = in_main(&card, (100.0, 0.0), 1.0, (40.0, 20.0), 2.0);
        assert_eq!((at.left, at.top, at.width, at.height), (95.0, 55.0, 210.0, 315.0));
    }
}

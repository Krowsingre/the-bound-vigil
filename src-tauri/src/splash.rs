//! Opening TBV on a computer: a small card with the splash shows at once,
//! while the main window gets ready out of sight. The page says how far it
//! has got (the card's bar) and when its first screen is drawn; then the
//! main window shows, already finished, and the card fades away.

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, EventTarget, Manager};

const LABEL: &str = "splash";
/// The main window shows by itself after this long, whatever the page says.
#[cfg(desktop)]
const AT_MOST: Duration = Duration::from_secs(25);

static SHOWN: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Splash {
    progress: f64,
    label: Option<String>,
    done: bool,
}

/// Makes the main window, hidden on a computer behind the splash card.
pub fn open(app: &tauri::App) -> tauri::Result<()> {
    let config = app.config().app.windows.iter().find(|w| w.label == "main").cloned().ok_or(tauri::Error::WindowNotFound)?;
    #[cfg(desktop)]
    {
        let card = tauri::WebviewWindowBuilder::new(app, LABEL, tauri::WebviewUrl::App("splash.html".into()))
            .title("The Bound Vigil")
            // The card is 420 × 630, with room round it for its shadow.
            .inner_size(456.0, 666.0)
            .center()
            .resizable(false)
            .maximizable(false)
            .decorations(false)
            .shadow(false);
        #[cfg(not(target_os = "macos"))]
        let card = card.transparent(true);
        card.build()?;
        tauri::WebviewWindowBuilder::from_config(app.handle(), &config)?.visible(false).build()?;
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
    let _ = app.emit_to(EventTarget::webview_window(LABEL), "tbv://splash", Splash { progress, label, done: false });
}

/// The first screen is drawn: show it, and let the card go.
#[tauri::command]
pub fn startup_done(app: AppHandle) {
    show_main(&app);
}

fn show_main(app: &AppHandle) {
    if SHOWN.swap(true, Ordering::SeqCst) {
        return;
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
        let _ = main.set_focus();
    }
    let _ = app.emit_to(EventTarget::webview_window(LABEL), "tbv://splash", Splash { progress: 1.0, label: None, done: true });
    let app = app.clone();
    std::thread::spawn(move || {
        // The card's fade.
        std::thread::sleep(Duration::from_millis(400));
        if let Some(card) = app.get_webview_window(LABEL) {
            let _ = card.destroy();
        }
    });
}

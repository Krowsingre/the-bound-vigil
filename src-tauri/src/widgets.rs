//! The iPhone's Home Screen and Lock Screen widgets. TBV writes what they
//! show into the App Group folder (see tbv_core::widget) and tells iOS to
//! redraw them; a tap on a widget opens TBV with a `theboundvigil://` link,
//! which waits here until the app's pages take it.
#[cfg(target_os = "ios")]
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, State};
use tbv_core::widget::WidgetAudio;

use crate::{AppLibrary, CommandResult};

/// The scheme widget taps open TBV with.
#[cfg_attr(not(target_os = "ios"), allow(dead_code))]
pub const SCHEME: &str = "theboundvigil";
/// Where the last audiobook is remembered, so the widget still shows it
/// after TBV is closed and opened again.
#[cfg(target_os = "ios")]
const AUDIO: &str = "widget.audio";

/// Links from widget taps the pages haven't taken yet.
static LINKS: Mutex<Vec<String>> = Mutex::new(Vec::new());
/// Whether this run has written the widgets yet. Nothing is playing when
/// TBV has only just started, whatever was saved.
#[cfg(target_os = "ios")]
static STARTED: AtomicBool = AtomicBool::new(false);

/// Keeps widget links from what iOS opened TBV with and tells the pages.
/// Returns whether any were found.
#[cfg_attr(not(target_os = "ios"), allow(dead_code))]
pub fn opened(app: &AppHandle, urls: &[tauri::Url]) -> bool {
    let links: Vec<String> = urls.iter().filter(|u| u.scheme() == SCHEME).map(|u| u.to_string()).collect();
    if links.is_empty() {
        return false;
    }
    if let Ok(mut waiting) = LINKS.lock() {
        waiting.extend(links);
    }
    let _ = app.emit("tbv://widget-link", ());
    true
}

/// The widget links waiting, oldest first; each is handed over once.
#[tauri::command]
pub fn widget_links() -> Vec<String> {
    LINKS.lock().map(|mut l| std::mem::take(&mut *l)).unwrap_or_default()
}

/// Rewrites what the widgets show. `today` is the local date
/// (`YYYY-MM-DD`). `audio`, when given, is the player's latest state and is
/// remembered; otherwise the remembered one is used. Does nothing off iOS.
#[tauri::command]
pub async fn widget_refresh(state: State<'_, AppLibrary>, today: String, audio: Option<WidgetAudio>) -> CommandResult<()> {
    #[cfg(not(target_os = "ios"))]
    {
        let _ = (state, today, audio);
        Ok(())
    }
    #[cfg(target_os = "ios")]
    write(state, today, audio).await
}

#[cfg(target_os = "ios")]
async fn write(state: State<'_, AppLibrary>, today: String, audio: Option<WidgetAudio>) -> CommandResult<()> {
    let folder = tauri_plugin_tbv_ios::widget_folder()?;
    let library = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let snapshot = {
            let library = library.lock().map_err(|_| "library is unavailable".to_string())?;
            let first = !STARTED.swap(true, Ordering::SeqCst);
            let audio = match audio {
                Some(a) => {
                    let _ = library.set_setting(AUDIO, &serde_json::to_string(&a).unwrap_or_default());
                    Some(a)
                }
                None => library.setting(AUDIO).ok().flatten().and_then(|s| serde_json::from_str::<WidgetAudio>(&s).ok()).map(|mut a| {
                    if first {
                        a.playing = false;
                    }
                    a
                }),
            };
            library.widget_snapshot(&today, audio).map_err(|e| e.to_string())?
        };
        tbv_core::widget::write_widget_snapshot(&folder, snapshot).map_err(|e| e.to_string())?;
        tauri_plugin_tbv_ios::reload_widgets();
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

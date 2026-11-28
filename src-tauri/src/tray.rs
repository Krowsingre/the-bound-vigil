//! Attunement › Accessibility › Windows (embre, 28 November): starting TBV with Windows, and
//! closing to the system tray. Started with Windows, TBV goes through its splash and then waits
//! minimized (see splash.rs). With Close to system tray on, closing the window hides it, and the
//! tray icon brings it back (Open TBV) or ends it (Quit).

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::AppHandle;
#[cfg(desktop)]
use tauri::Manager;

/// What Windows passes when it starts TBV at sign-in.
pub const MINIMIZED_ARG: &str = "--minimized";

static CLOSE_TO_TRAY: AtomicBool = AtomicBool::new(false);
/// Quit from the tray: the close that follows really ends TBV.
static QUITTING: AtomicBool = AtomicBool::new(false);

#[cfg(desktop)]
const TRAY_ID: &str = "tbv-tray";

/// Whether closing the main window should hide it in the tray instead of ending TBV.
pub fn hides_on_close() -> bool {
    CLOSE_TO_TRAY.load(Ordering::SeqCst) && !QUITTING.load(Ordering::SeqCst)
}

/// Close to system tray, on or off: the page says so as it opens, and whenever it changes.
#[tauri::command]
pub fn set_close_to_tray(app: AppHandle, on: bool) -> Result<(), String> {
    CLOSE_TO_TRAY.store(on, Ordering::SeqCst);
    #[cfg(desktop)]
    {
        if on {
            if app.tray_by_id(TRAY_ID).is_none() {
                build_tray(&app).map_err(|e| e.to_string())?;
            }
        } else {
            let _ = app.remove_tray_by_id(TRAY_ID);
        }
    }
    #[cfg(not(desktop))]
    let _ = app;
    Ok(())
}

#[cfg(desktop)]
fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
    let open_item = MenuItem::with_id(app, "tbv-tray-open", "Open TBV", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "tbv-tray-quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open_item, &quit_item])?;
    let mut tray = TrayIconBuilder::with_id(TRAY_ID).tooltip("The Bound Vigil").menu(&menu).show_menu_on_left_click(false);
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.on_menu_event(|app, event| match event.id().as_ref() {
        "tbv-tray-open" => show(app),
        "tbv-tray-quit" => quit(app),
        _ => {}
    })
    .on_tray_icon_event(|tray, event| {
        if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
            show(tray.app_handle());
        }
    })
    .build(app)?;
    Ok(())
}

/// Brings the main window back from the tray (or from minimized).
#[cfg(desktop)]
fn show(app: &AppHandle) {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
        let _ = main.unminimize();
        let _ = main.set_focus();
    }
}

/// Quit from the tray: closes the main window the usual way, so reading places are saved first.
#[cfg(desktop)]
fn quit(app: &AppHandle) {
    QUITTING.store(true, Ordering::SeqCst);
    match app.get_webview_window("main") {
        Some(main) => {
            let _ = main.show();
            let _ = main.close();
        }
        None => app.exit(0),
    }
}

/// Start with Windows, on or off: TBV's entry in Windows' list of apps that start at sign-in.
#[tauri::command]
pub fn set_start_with_windows(on: bool) -> Result<(), String> {
    #[cfg(windows)]
    return run_key::set(on);
    #[cfg(not(windows))]
    {
        let _ = on;
        Err("Starting with the computer works on Windows.".into())
    }
}

/// Whether TBV starts with Windows now.
#[tauri::command]
pub fn start_with_windows() -> bool {
    #[cfg(windows)]
    return run_key::is_on();
    #[cfg(not(windows))]
    false
}

#[cfg(windows)]
mod run_key {
    use windows::core::{w, PCWSTR};
    use windows::Win32::Foundation::ERROR_FILE_NOT_FOUND;
    use windows::Win32::System::Registry::{
        RegCloseKey, RegCreateKeyExW, RegDeleteValueW, RegGetValueW, RegSetValueExW, HKEY, HKEY_CURRENT_USER, KEY_SET_VALUE, REG_OPTION_NON_VOLATILE, REG_SZ,
        RRF_RT_REG_SZ,
    };

    const KEY: PCWSTR = w!("Software\\Microsoft\\Windows\\CurrentVersion\\Run");
    const NAME: PCWSTR = w!("The Bound Vigil");

    pub fn set(on: bool) -> Result<(), String> {
        let mut key = HKEY::default();
        // SAFETY: the key and value names are static wide strings, and `key` is closed below.
        unsafe {
            RegCreateKeyExW(HKEY_CURRENT_USER, KEY, None, PCWSTR::null(), REG_OPTION_NON_VOLATILE, KEY_SET_VALUE, None, &mut key, None)
                .ok()
                .map_err(|e| e.to_string())?;
        }
        let result = if on {
            let exe = std::env::current_exe().map_err(|e| e.to_string())?;
            let value = format!("\"{}\" {}", exe.display(), super::MINIMIZED_ARG);
            let wide: Vec<u16> = value.encode_utf16().chain(std::iter::once(0)).collect();
            let bytes: Vec<u8> = wide.iter().flat_map(|c| c.to_le_bytes()).collect();
            // SAFETY: `key` is open for writing, and the data is a NUL-ended UTF-16 string.
            unsafe { RegSetValueExW(key, NAME, None, REG_SZ, Some(&bytes)) }
        } else {
            // SAFETY: `key` is open for writing.
            let removed = unsafe { RegDeleteValueW(key, NAME) };
            if removed == ERROR_FILE_NOT_FOUND { Default::default() } else { removed }
        };
        // SAFETY: `key` was opened above.
        unsafe {
            let _ = RegCloseKey(key);
        }
        result.ok().map_err(|e| e.to_string())
    }

    pub fn is_on() -> bool {
        // SAFETY: static wide strings; nothing is read back but whether the value is there.
        unsafe { RegGetValueW(HKEY_CURRENT_USER, KEY, NAME, RRF_RT_REG_SZ, None, None, None).is_ok() }
    }
}

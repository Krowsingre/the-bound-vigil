//! The reader's Define and Translate. iPhone, iPad and Mac show Apple's own
//! dictionary and translation over TBV; Windows and Android answer from the
//! offline dictionary in tbv-core, and translate in Discover instead.

use serde::{Deserialize, Serialize};
use tbv_core::dictionary::Definition;

/// Where the selected words are on screen, in the page's own units (used by Apple's).
#[cfg_attr(not(any(target_os = "ios", target_os = "macos")), allow(dead_code))]
#[derive(Debug, Clone, Copy, Deserialize, Default)]
pub struct Spot {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LookedUp {
    /// The system showed its own dictionary; there's nothing more to show.
    shown: bool,
    definitions: Vec<Definition>,
}

#[tauri::command]
pub async fn look_up_word(text: String, spot: Spot) -> Result<LookedUp, String> {
    let text = text.trim().to_string();
    if text.is_empty() {
        return Ok(LookedUp { shown: false, definitions: Vec::new() });
    }
    #[cfg(target_os = "ios")]
    {
        let shown = tauri::async_runtime::spawn_blocking(move || tauri_plugin_tbv_ios::look_up(&text, spot.x, spot.y, spot.width, spot.height))
            .await
            .map_err(|e| e.to_string())??;
        return Ok(LookedUp { shown, definitions: Vec::new() });
    }
    #[cfg(target_os = "macos")]
    {
        mac::look_up(&text, spot);
        return Ok(LookedUp { shown: true, definitions: Vec::new() });
    }
    #[cfg(not(any(target_os = "ios", target_os = "macos")))]
    {
        let _ = spot;
        let definitions = tauri::async_runtime::spawn_blocking(move || tbv_core::dictionary::define(&text)).await.map_err(|e| e.to_string())?;
        Ok(LookedUp { shown: false, definitions })
    }
}

/// True when Apple's translation was shown; false where it isn't there
/// (Windows, Android, and older iPhones and Macs), so TBV translates in Discover.
#[tauri::command]
pub async fn translate_text(text: String, spot: Spot) -> Result<bool, String> {
    let text = text.trim().to_string();
    if text.is_empty() {
        return Ok(false);
    }
    #[cfg(target_os = "ios")]
    {
        return tauri::async_runtime::spawn_blocking(move || tauri_plugin_tbv_ios::translate(&text, spot.x, spot.y, spot.width, spot.height))
            .await
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        return Ok(mac::translate(&text, spot));
    }
    #[cfg(not(any(target_os = "ios", target_os = "macos")))]
    {
        let _ = spot;
        Ok(false)
    }
}

/// The Mac app's own Swift (src-tauri/mac, LookUp.swift).
#[cfg(target_os = "macos")]
mod mac {
    use std::ffi::{c_char, CString};

    use super::Spot;

    extern "C" {
        fn tbv_mac_look_up(text: *const c_char, x: f64, y: f64, width: f64, height: f64);
        fn tbv_mac_translate(text: *const c_char, x: f64, y: f64, width: f64, height: f64) -> bool;
    }

    pub fn look_up(text: &str, spot: Spot) {
        let Ok(text) = CString::new(text) else { return };
        unsafe { tbv_mac_look_up(text.as_ptr(), spot.x, spot.y, spot.width, spot.height) }
    }

    pub fn translate(text: &str, spot: Spot) -> bool {
        let Ok(text) = CString::new(text) else { return false };
        unsafe { tbv_mac_translate(text.as_ptr(), spot.x, spot.y, spot.width, spot.height) }
    }
}

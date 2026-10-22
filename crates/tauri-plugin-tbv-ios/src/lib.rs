//! The iPhone app's own pieces, written in Swift (ios/Sources): a folder
//! chosen in Files that TBV can open again after a restart, iCloud files
//! brought down when TBV reads them, and audio that keeps playing with the
//! screen locked. Elsewhere these do nothing.

use std::path::Path;

use tauri::plugin::{Builder, TauriPlugin};
use tauri::Wry;

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_tbv);

#[cfg(target_os = "ios")]
static SWIFT: std::sync::OnceLock<tauri::plugin::PluginHandle<Wry>> = std::sync::OnceLock::new();

pub fn init() -> TauriPlugin<Wry> {
    Builder::new("tbv-ios")
        .setup(|_app, _api| {
            #[cfg(target_os = "ios")]
            {
                let handle = _api.register_ios_plugin(init_plugin_tbv)?;
                let _ = SWIFT.set(handle);
            }
            Ok(())
        })
        .build()
}

#[cfg(target_os = "ios")]
#[derive(serde::Serialize)]
struct PathArgs<'a> {
    path: &'a str,
}

/// Asks for a folder in Files and waits for the answer: its path, or None
/// when cancelled. Must not be called on the main thread.
pub fn pick_folder() -> Result<Option<String>, String> {
    #[cfg(target_os = "ios")]
    {
        let swift = SWIFT.get().ok_or("The Files picker isn't ready.")?;
        let answer: serde_json::Value = swift.run_mobile_plugin("pickFolder", ()).map_err(|e| e.to_string())?;
        Ok(answer.get("path").and_then(|p| p.as_str()).map(str::to_string))
    }
    #[cfg(not(target_os = "ios"))]
    Err("Choosing a folder this way only works on iPhone.".into())
}

#[cfg(target_os = "ios")]
#[derive(serde::Serialize)]
struct UrlArgs<'a> {
    url: &'a str,
}

/// Shows a sign-in page over TBV (Hardcover's), so TBV stays awake to hear
/// the answer. `close_sign_in` takes it away again.
pub fn open_sign_in(url: &str) -> Result<(), String> {
    #[cfg(target_os = "ios")]
    {
        let swift = SWIFT.get().ok_or("The sign-in page isn't ready.")?;
        swift.run_mobile_plugin::<serde_json::Value>("openSignIn", UrlArgs { url }).map(|_| ()).map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = url;
        Err("This sign-in page only opens on iPhone.".into())
    }
}

/// Takes the sign-in page away once its answer is in (or it timed out).
pub fn close_sign_in() {
    #[cfg(target_os = "ios")]
    if let Some(swift) = SWIFT.get() {
        let _ = swift.run_mobile_plugin::<serde_json::Value>("closeSignIn", ());
    }
}

/// Asks iCloud for the latest of a folder or file, so new change files
/// from other devices show up.
pub fn refresh(path: &Path) {
    #[cfg(target_os = "ios")]
    if let Some(swift) = SWIFT.get() {
        let path = path.to_string_lossy();
        let _ = swift.run_mobile_plugin::<serde_json::Value>("refreshItem", PathArgs { path: &path });
    }
    #[cfg(not(target_os = "ios"))]
    let _ = path;
}

/// Brings down a file iCloud hasn't kept on the phone, waiting until it
/// arrives. True once it's here.
pub fn fetch(path: &Path) -> bool {
    #[cfg(target_os = "ios")]
    {
        let Some(swift) = SWIFT.get() else { return false };
        let path = path.to_string_lossy();
        swift
            .run_mobile_plugin::<serde_json::Value>("fetchFile", PathArgs { path: &path })
            .ok()
            .and_then(|a| a.get("ok").and_then(|ok| ok.as_bool()))
            .unwrap_or(false)
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = path;
        false
    }
}

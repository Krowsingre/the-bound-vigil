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

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

/// Asks for files in Files, copied into TBV's own folder (iCloud brings
/// them down first), and waits for their paths. Empty when cancelled. Must
/// not be called on the main thread.
/// `keep` puts them where nothing clears them, for a file used again later.
pub fn pick_files(keep: bool) -> Result<Vec<String>, String> {
    #[cfg(target_os = "ios")]
    {
        let swift = SWIFT.get().ok_or("The Files picker isn't ready.")?;
        let answer: serde_json::Value = swift.run_mobile_plugin("pickFiles", serde_json::json!({ "keep": keep })).map_err(|e| e.to_string())?;
        Ok(answer
            .get("paths")
            .and_then(|p| p.as_array())
            .map(|list| list.iter().filter_map(|p| p.as_str().map(str::to_string)).collect())
            .unwrap_or_default())
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = keep;
        Err("Choosing files this way only works on iPhone.".into())
    }
}

/// Asks for a picture from Photos and waits: its path (a JPEG in TBV's own
/// folder), or None when cancelled. Must not be called on the main thread.
pub fn pick_photo() -> Result<Option<String>, String> {
    #[cfg(target_os = "ios")]
    {
        let swift = SWIFT.get().ok_or("Photos isn't ready.")?;
        let answer: serde_json::Value = swift.run_mobile_plugin("pickPhoto", ()).map_err(|e| e.to_string())?;
        Ok(answer.get("path").and_then(|p| p.as_str()).map(str::to_string))
    }
    #[cfg(not(target_os = "ios"))]
    Err("Choosing from Photos only works on iPhone and iPad.".into())
}

/// Discover's browser: `show`, `place`, `hide`, `go`, `back`, `forward`,
/// `reload`, `stop`, `close`, `clear`, `find`, `protect`, `run` or `cancel`,
/// with what each needs (the tab, an address, the space it takes…). Answers
/// what Apple's web view answered.
pub fn browser(args: serde_json::Value) -> Result<serde_json::Value, String> {
    #[cfg(target_os = "ios")]
    {
        let swift = SWIFT.get().ok_or("The browser isn't ready.")?;
        swift.run_mobile_plugin::<serde_json::Value>("browser", args).map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = args;
        Err("This browser is the iPhone's.".into())
    }
}

/// Waits for the browser's next event (a page, a download, a new tab…),
/// passed on as it came. None now and then, when there was nothing to tell
/// (or the browser isn't ready yet).
pub fn browser_event() -> Option<serde_json::Value> {
    #[cfg(target_os = "ios")]
    {
        let answer: serde_json::Value = SWIFT.get()?.run_mobile_plugin("browserEvent", ()).ok()?;
        match answer.get("kind").and_then(|k| k.as_str()) {
            None | Some("none") => None,
            Some(_) => Some(answer),
        }
    }
    #[cfg(not(target_os = "ios"))]
    None
}

/// Where the browser's downloads wait on the phone.
pub fn browser_downloads_dir() -> Option<std::path::PathBuf> {
    #[cfg(target_os = "ios")]
    {
        let answer: serde_json::Value = SWIFT.get()?.run_mobile_plugin("browserDownloads", ()).ok()?;
        answer.get("path").and_then(|p| p.as_str()).map(std::path::PathBuf::from)
    }
    #[cfg(not(target_os = "ios"))]
    None
}

/// "iPhone" or "iPad", from the device itself.
pub fn device_kind() -> Option<String> {
    #[cfg(target_os = "ios")]
    {
        let answer: serde_json::Value = SWIFT.get()?.run_mobile_plugin("deviceKind", ()).ok()?;
        answer.get("kind").and_then(|k| k.as_str()).map(str::to_string)
    }
    #[cfg(not(target_os = "ios"))]
    None
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

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

/// Published, complete batches in the Share Extension's App Group inbox.
pub fn pending_shares() -> Result<Vec<std::path::PathBuf>, String> {
    #[cfg(target_os = "ios")]
    {
        let swift = SWIFT.get().ok_or("The iOS share bridge isn't ready.")?;
        let answer: serde_json::Value = swift
            .run_mobile_plugin("pendingShares", ())
            .map_err(|e| e.to_string())?;
        Ok(answer.get("paths").and_then(|v| v.as_array())
            .into_iter().flatten()
            .filter_map(|v| v.as_str().map(std::path::PathBuf::from))
            .collect())
    }
    #[cfg(not(target_os = "ios"))]
    {
        Ok(Vec::new())
    }
}

/// What happened in the cloud or to the app, from `cloud_event`.
#[derive(Debug, Default)]
pub struct CloudEvent {
    /// TBV came back on screen.
    pub came_back: bool,
    /// Files iCloud added or changed in a folder chosen in Files.
    pub paths: Vec<std::path::PathBuf>,
}

/// Waits for the next cloud event. None when there's no way to hear them
/// (not an iPhone or iPad). Must not be called on the main thread.
pub fn cloud_event() -> Option<CloudEvent> {
    #[cfg(target_os = "ios")]
    {
        let answer: serde_json::Value = SWIFT.get()?.run_mobile_plugin("cloudEvent", ()).ok()?;
        Some(CloudEvent {
            came_back: answer.get("cameBack").and_then(|v| v.as_bool()).unwrap_or(false),
            paths: answer
                .get("paths")
                .and_then(|v| v.as_array())
                .into_iter()
                .flatten()
                .filter_map(|v| v.as_str().map(std::path::PathBuf::from))
                .collect(),
        })
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

#[derive(serde::Serialize)]
struct AuthArgs<'a> {
    url: &'a str,
    scheme: &'a str,
}

#[derive(serde::Deserialize)]
struct AuthAnswer {
    url: String,
}

/// Shows a sign-in page over TBV that answers to TBV's own address
/// (`scheme:`), as Google's does on iPhone, and gives that answer.
pub fn authenticate(url: &str, scheme: &str) -> Result<String, String> {
    #[cfg(target_os = "ios")]
    {
        let swift = SWIFT.get().ok_or("The sign-in page isn't ready.")?;
        swift.run_mobile_plugin::<AuthAnswer>("authenticate", AuthArgs { url, scheme }).map(|a| a.url).map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = (url, scheme, AuthArgs { url, scheme }, |a: AuthAnswer| a.url);
        Err("This sign-in page only opens on iPhone.".into())
    }
}

#[derive(serde::Serialize)]
struct ProductArgs<'a> {
    product: &'a str,
    /// The yearly plan (a subscription), asked about alongside the lifetime unlock.
    #[serde(skip_serializing_if = "Option::is_none")]
    yearly: Option<&'a str>,
}

/// What the App Store says about TBV's two plans.
#[derive(Debug, Clone, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoreStatus {
    /// The lifetime unlock was bought.
    pub lifetime: bool,
    /// The yearly plan is running (its free month included).
    pub yearly: bool,
    pub price: Option<String>,
    pub yearly_price: Option<String>,
    /// This person would get the yearly plan's free first month.
    pub free_month: bool,
    /// The running plan is shared by someone in their family, who pays for it.
    #[serde(default)]
    pub shared: bool,
}

/// Asks the App Store about the lifetime unlock and the yearly plan.
pub fn store_status(lifetime: &str, yearly: &str) -> Result<StoreStatus, String> {
    #[cfg(target_os = "ios")]
    {
        let swift = SWIFT.get().ok_or("The App Store isn't ready.")?;
        swift.run_mobile_plugin::<StoreStatus>("storeStatus", ProductArgs { product: lifetime, yearly: Some(yearly) }).map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = ProductArgs { product: lifetime, yearly: Some(yearly) };
        Err("The App Store is only on iPhone and iPad.".into())
    }
}

/// Shows the App Store's sheet for buying the unlock.
pub fn store_buy(product: &str) -> Result<(), String> {
    #[cfg(target_os = "ios")]
    {
        let swift = SWIFT.get().ok_or("The App Store isn't ready.")?;
        swift.run_mobile_plugin::<serde_json::Value>("storeBuy", ProductArgs { product, yearly: None }).map(|_| ()).map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = product;
        Err("The App Store is only on iPhone and iPad.".into())
    }
}

/// Asks the App Store again for purchases made before.
pub fn store_restore() -> Result<(), String> {
    #[cfg(target_os = "ios")]
    {
        let swift = SWIFT.get().ok_or("The App Store isn't ready.")?;
        swift.run_mobile_plugin::<serde_json::Value>("storeRestore", ()).map(|_| ()).map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "ios"))]
    Err("The App Store is only on iPhone and iPad.".into())
}

/// Books iOS background time for lining up read-along and syncing, and
/// signs up for silent pushes. Called before the app opens, as iOS asks;
/// elsewhere it does nothing.
pub fn register_background_tasks() {
    #[cfg(target_os = "ios")]
    {
        extern "C" {
            fn tbv_register_background_tasks();
        }
        // Safety: a Swift function taking and giving nothing, in this plugin.
        unsafe { tbv_register_background_tasks() };
    }
}

#[cfg(target_os = "ios")]
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct BackgroundWorkArgs {
    busy: bool,
    needs_power: bool,
}

/// Tells the iPhone app whether lining up read-along has work to carry on
/// with in the background, and whether to wait for a charger for it.
pub fn background_work(busy: bool, needs_power: bool) {
    #[cfg(target_os = "ios")]
    if let Some(swift) = SWIFT.get() {
        let _ = swift.run_mobile_plugin::<serde_json::Value>("backgroundWork", BackgroundWorkArgs { busy, needs_power });
    }
    #[cfg(not(target_os = "ios"))]
    let _ = (busy, needs_power);
}

/// How warm the device is, as iOS says: 0 normal, 1 fair, 2 serious,
/// 3 critical. Elsewhere it's always 0.
pub fn thermal_state() -> u8 {
    #[cfg(target_os = "ios")]
    {
        extern "C" {
            fn tbv_thermal_state() -> i32;
        }
        // Safety: a Swift function taking nothing and giving a number, in this plugin.
        unsafe { tbv_thermal_state().clamp(0, 3) as u8 }
    }
    #[cfg(not(target_os = "ios"))]
    0
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

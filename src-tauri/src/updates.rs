//! TBV updating itself on a computer: it asks GitHub whether there's a newer
//! version, and with a yes, downloads it, checks it was signed by TBV's own
//! key, installs it and starts again. Phones update from their app store.

use serde::Serialize;

/// What Preferences › About shows.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    /// False where updates come from somewhere else (an app store).
    pub can_update: bool,
    pub current: String,
    /// The newer version, if there is one.
    pub version: Option<String>,
    pub notes: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress {
    downloaded: u64,
    total: Option<u64>,
}

/// A copy from the Microsoft Store is updated by the Store.
const STORE_BUILD: bool = option_env!("TBV_STORE_BUILD").is_some();

#[cfg(not(any(target_os = "ios", target_os = "android")))]
mod desktop {
    use super::*;
    use std::sync::Mutex;
    use tauri::{AppHandle, Emitter, Manager};
    use tauri_plugin_updater::{Update, UpdaterExt};

    /// The update found by the last check, ready to install.
    #[derive(Default)]
    pub struct Found(pub Mutex<Option<Update>>);

    pub async fn check(app: &AppHandle) -> Result<UpdateInfo, String> {
        let current = app.package_info().version.to_string();
        if STORE_BUILD {
            return Ok(UpdateInfo { can_update: false, current, ..Default::default() });
        }
        let found = app
            .updater()
            .map_err(|e| e.to_string())?
            .check()
            .await
            .map_err(|e| format!("TBV couldn't check for updates ({e})."))?;
        let info = UpdateInfo {
            can_update: true,
            current,
            version: found.as_ref().map(|u| u.version.clone()),
            notes: found.as_ref().and_then(|u| u.body.clone()).filter(|b| !b.trim().is_empty()),
        };
        if let Some(state) = app.try_state::<Found>() {
            *state.0.lock().map_err(|e| e.to_string())? = found;
        }
        Ok(info)
    }

    pub async fn install(app: AppHandle) -> Result<(), String> {
        let update = app.try_state::<Found>().and_then(|s| s.0.lock().ok()?.take());
        let update = match update {
            Some(u) => u,
            None => {
                check(&app).await?;
                app.try_state::<Found>().and_then(|s| s.0.lock().ok()?.take()).ok_or("TBV is already up to date.")?
            }
        };
        let mut downloaded = 0u64;
        let progress = app.clone();
        update
            .download_and_install(
                move |chunk, total| {
                    downloaded += chunk as u64;
                    let _ = progress.emit("update-progress", Progress { downloaded, total });
                },
                || {},
            )
            .await
            .map_err(|e| format!("The update couldn't be installed ({e})."))?;
        app.restart();
    }
}

#[cfg(not(any(target_os = "ios", target_os = "android")))]
pub use desktop::Found;

#[tauri::command]
pub async fn update_check(app: tauri::AppHandle) -> Result<UpdateInfo, String> {
    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    return desktop::check(&app).await;
    #[cfg(any(target_os = "ios", target_os = "android"))]
    Ok(UpdateInfo { can_update: false, current: app.package_info().version.to_string(), ..Default::default() })
}

#[tauri::command]
pub async fn update_install(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    return desktop::install(app).await;
    #[cfg(any(target_os = "ios", target_os = "android"))]
    {
        let _ = app;
        Err("This copy of TBV is updated by the App Store.".into())
    }
}

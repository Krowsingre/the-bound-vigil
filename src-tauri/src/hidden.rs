//! Hidden books and the Hidden collection's lock (tbv-core's hidden.rs), with
//! Face ID, Touch ID or Windows Hello as a shortcut to its password.

use tauri::State;

use crate::{with_library, AppLibrary, CommandResult};

#[tauri::command]
pub async fn set_hidden(state: State<'_, AppLibrary>, book_ids: Vec<String>, hidden: bool) -> CommandResult<u32> {
    with_library(state, move |library| library.set_hidden(&book_ids, hidden)).await
}

#[tauri::command]
pub async fn hidden_count(state: State<'_, AppLibrary>) -> CommandResult<u32> {
    with_library(state, move |library| library.hidden_count()).await
}

#[tauri::command]
pub async fn hidden_lock(state: State<'_, AppLibrary>) -> CommandResult<Option<tbv_core::hidden::HiddenLock>> {
    with_library(state, move |library| library.hidden_lock()).await
}

#[tauri::command]
pub async fn set_hidden_lock(state: State<'_, AppLibrary>, lock: tbv_core::hidden::HiddenLock) -> CommandResult<()> {
    with_library(state, move |library| library.set_hidden_lock(&lock)).await
}

/// What the device can open the Hidden collection with besides the password:
/// "faceId", "touchId", "opticId" or "windowsHello", or nothing.
#[tauri::command]
pub async fn device_unlock_kind() -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(kind).await.map_err(|e| e.to_string())
}

/// Asks for the face, finger or Windows Hello PIN; true when the person passed.
#[tauri::command]
pub async fn device_unlock(app: tauri::AppHandle, reason: String) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || unlock(&app, &reason)).await.map_err(|e| e.to_string())?
}

#[cfg(target_os = "ios")]
fn kind() -> Option<String> {
    tauri_plugin_tbv_ios::device_unlock_kind()
}

#[cfg(target_os = "ios")]
fn unlock(_app: &tauri::AppHandle, reason: &str) -> Result<bool, String> {
    tauri_plugin_tbv_ios::device_unlock(reason)
}

#[cfg(windows)]
fn kind() -> Option<String> {
    use windows::Security::Credentials::UI::{UserConsentVerifier, UserConsentVerifierAvailability};
    let available = UserConsentVerifier::CheckAvailabilityAsync().and_then(|asking| asking.join()).ok()?;
    (available == UserConsentVerifierAvailability::Available).then(|| "windowsHello".to_string())
}

#[cfg(windows)]
fn unlock(app: &tauri::AppHandle, reason: &str) -> Result<bool, String> {
    use tauri::Manager;
    use windows::core::HSTRING;
    use windows::Security::Credentials::UI::{UserConsentVerificationResult, UserConsentVerifier};
    use windows::Win32::System::WinRT::IUserConsentVerifierInterop;
    let window = app.get_window("main").ok_or("TBV's window isn't open.")?;
    let hwnd = window.hwnd().map_err(|e| e.to_string())?;
    let interop = windows::core::factory::<UserConsentVerifier, IUserConsentVerifierInterop>().map_err(|e| e.to_string())?;
    // Over TBV's own window, so Windows Hello doesn't open behind it.
    let asking: windows_future::IAsyncOperation<UserConsentVerificationResult> =
        unsafe { interop.RequestVerificationForWindowAsync(windows::Win32::Foundation::HWND(hwnd.0 as _), &HSTRING::from(reason)) }
            .map_err(|e| e.to_string())?;
    Ok(asking.join().map_err(|e| e.to_string())? == UserConsentVerificationResult::Verified)
}

#[cfg(not(any(windows, target_os = "ios")))]
fn kind() -> Option<String> {
    None
}

#[cfg(not(any(windows, target_os = "ios")))]
fn unlock(_app: &tauri::AppHandle, _reason: &str) -> Result<bool, String> {
    Ok(false)
}

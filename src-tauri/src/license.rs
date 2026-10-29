//! Buying TBV: the Microsoft Store on a computer, the App Store on iPhone
//! and iPad. A copy from outside a store (a test build) can be tried for the
//! 30 days, but not bought in.

use std::sync::Mutex;

use tauri::{AppHandle, Manager};
use tbv_core::license::{LicenseView, Shop, StoreAnswer};
use tbv_core::Library;

/// The unlock's name in both stores (its product ID).
#[cfg(any(windows, target_os = "ios"))]
const PRODUCT: &str = if cfg!(target_os = "ios") { "com.krowsingre.theboundvigil.unlock" } else { "full_unlock" };

fn now() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

/// A note of when the trial started, kept outside the library, so starting
/// a fresh library doesn't start a fresh trial.
fn outside_note(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_local_data_dir().ok().map(|d| d.join("trial"))
}

fn outside_start(app: &AppHandle) -> Option<i64> {
    std::fs::read_to_string(outside_note(app)?).ok()?.trim().parse().ok()
}

fn keep_outside(app: &AppHandle, start: i64) {
    if let Some(path) = outside_note(app) {
        if outside_start(app) != Some(start) {
            let _ = path.parent().map(std::fs::create_dir_all);
            let _ = std::fs::write(path, start.to_string());
        }
    }
}

/// Which store this copy came from.
fn shop() -> Shop {
    #[cfg(target_os = "ios")]
    return Shop::Apple;
    #[cfg(windows)]
    return if store::packaged() { Shop::Microsoft } else { Shop::None };
    #[cfg(not(any(windows, target_os = "ios")))]
    Shop::None
}

/// What the store says, or None when it can't be asked.
fn ask_store(app: &AppHandle) -> Option<StoreAnswer> {
    #[cfg(target_os = "ios")]
    {
        let _ = app;
        return tauri_plugin_tbv_ios::store_status(PRODUCT).ok().map(|(owned, price)| StoreAnswer { owned, price });
    }
    #[cfg(windows)]
    return store::status(app).ok();
    #[cfg(not(any(windows, target_os = "ios")))]
    {
        let _ = app;
        None
    }
}

pub fn status(app: &AppHandle, library: &Mutex<Library>) -> tbv_core::Result<LicenseView> {
    let answer = ask_store(app);
    let view = library
        .lock()
        .map_err(|_| tbv_core::Error::Unsuitable("the library is unavailable".into()))?
        .license(now(), outside_start(app), shop(), answer.as_ref())?;
    keep_outside(app, view.trial_ends - tbv_core::license::trial_days(shop()) * 86_400);
    Ok(view)
}

/// Opens the store's purchase sheet. The status afterwards says whether it went through.
pub fn buy(app: &AppHandle, library: &Mutex<Library>) -> tbv_core::Result<LicenseView> {
    #[cfg(target_os = "ios")]
    tauri_plugin_tbv_ios::store_buy(PRODUCT).map_err(tbv_core::Error::Unsuitable)?;
    #[cfg(windows)]
    store::buy(app).map_err(tbv_core::Error::Unsuitable)?;
    #[cfg(not(any(windows, target_os = "ios")))]
    {
        let _ = (app, library);
        Err(tbv_core::Error::Unsuitable("This copy of TBV can't be bought in. Get The Bound Vigil from the Microsoft Store or the App Store.".into()))
    }
    #[cfg(any(windows, target_os = "ios"))]
    status(app, library)
}

/// Unlocks with the owner's code. Nothing back if it's wrong.
pub fn unlock(app: &AppHandle, library: &Mutex<Library>, code: &str) -> tbv_core::Result<Option<LicenseView>> {
    let right = library.lock().map_err(|_| tbv_core::Error::Unsuitable("the library is unavailable".into()))?.unlock_with_code(code)?;
    if !right {
        return Ok(None);
    }
    status(app, library).map(Some)
}

/// Asks the store again for a purchase made before (on another device, say).
pub fn restore(app: &AppHandle, library: &Mutex<Library>) -> tbv_core::Result<LicenseView> {
    #[cfg(target_os = "ios")]
    tauri_plugin_tbv_ios::store_restore().map_err(tbv_core::Error::Unsuitable)?;
    status(app, library)
}

#[cfg(windows)]
mod store {
    use tauri::{AppHandle, Manager};
    use tbv_core::license::StoreAnswer;
    use windows::core::{Interface, HSTRING};
    use windows_collections::IIterable;
    use windows::Services::Store::{StoreContext, StorePurchaseStatus};
    use windows::Win32::UI::Shell::IInitializeWithWindow;

    /// Whether TBV was installed from the Store (it has a package identity).
    pub fn packaged() -> bool {
        windows::ApplicationModel::Package::Current().is_ok()
    }

    fn context(app: &AppHandle) -> windows::core::Result<StoreContext> {
        let context = StoreContext::GetDefault()?;
        // A desktop app shows the Store's sheets over its own window.
        if let Some(window) = app.get_webview_window("main") {
            if let Ok(hwnd) = window.hwnd() {
                let init: IInitializeWithWindow = context.cast()?;
                unsafe { init.Initialize(windows::Win32::Foundation::HWND(hwnd.0 as _))? };
            }
        }
        Ok(context)
    }

    fn kinds() -> windows::core::Result<IIterable<HSTRING>> {
        let kinds: Vec<HSTRING> = vec![HSTRING::from("Durable")];
        Ok(IIterable::<HSTRING>::from(kinds))
    }

    pub fn status(app: &AppHandle) -> Result<StoreAnswer, String> {
        if !packaged() {
            return Err("not from the Store".into());
        }
        let context = context(app).map_err(|e| e.to_string())?;
        let license = context.GetAppLicenseAsync().map_err(|e| e.to_string())?.join().map_err(|e| e.to_string())?;
        let mut owned = false;
        for pair in license.AddOnLicenses().map_err(|e| e.to_string())? {
            let l = pair.Value().map_err(|e| e.to_string())?;
            if l.InAppOfferToken().map(|t| t == super::PRODUCT).unwrap_or(false) && l.IsActive().unwrap_or(false) {
                owned = true;
            }
        }
        let price = product(&context).ok().flatten().and_then(|p| p.Price().ok()?.FormattedPrice().ok()).map(|p| p.to_string());
        Ok(StoreAnswer { owned, price })
    }

    fn product(context: &StoreContext) -> windows::core::Result<Option<windows::Services::Store::StoreProduct>> {
        let found = context.GetAssociatedStoreProductsAsync(&kinds()?)?.join()?;
        for pair in found.Products()? {
            let p = pair.Value()?;
            if p.InAppOfferToken()? == super::PRODUCT {
                return Ok(Some(p));
            }
        }
        Ok(None)
    }

    pub fn buy(app: &AppHandle) -> Result<(), String> {
        if !packaged() {
            return Err("This copy of TBV wasn't installed from the Microsoft Store, so it can't be bought in. Get The Bound Vigil from the Store.".into());
        }
        let context = context(app).map_err(|e| e.to_string())?;
        let product = product(&context).map_err(|e| e.to_string())?.ok_or("The Store isn't offering the unlock yet.")?;
        let result = product.RequestPurchaseAsync().map_err(|e| e.to_string())?.join().map_err(|e| e.to_string())?;
        match result.Status().map_err(|e| e.to_string())? {
            StorePurchaseStatus::Succeeded | StorePurchaseStatus::AlreadyPurchased => Ok(()),
            StorePurchaseStatus::NotPurchased => Ok(()),
            StorePurchaseStatus::NetworkError => Err("The Store couldn't be reached. Check the internet connection and try again.".into()),
            _ => Err("The Store couldn't finish the purchase.".into()),
        }
    }
}

//! Buying TBV: the Microsoft Store on a PC, the App Store on iPhone, iPad
//! and Mac (one purchase covers all three). There are two levels, TBV and
//! TBV Publisher, each yearly or for life, and an upgrade to Publisher for
//! lifetime owners. In the App Store both yearly plans belong to one
//! subscription group, so moving up from TBV yearly to Publisher yearly is
//! Apple's own upgrade, charged for the difference. A copy from outside a
//! store (a test build) can be tried for the 30 days, but not bought in.

use std::sync::Mutex;

use tauri::{AppHandle, Manager};
use tbv_core::license::{LicenseView, Shop, StoreAnswer};
use tbv_core::Library;

/// The lifetime unlock's name in both stores (its product ID).
#[cfg(any(windows, target_os = "ios", target_os = "macos"))]
const PRODUCT: &str = if cfg!(windows) { "full_unlock" } else { "com.krowsingre.theboundvigil.unlock" };
/// The yearly plan's name in both stores (a subscription).
#[cfg(any(windows, target_os = "ios", target_os = "macos"))]
const YEARLY: &str = if cfg!(windows) { "yearly" } else { "com.krowsingre.theboundvigil.yearly" };
/// TBV Publisher for life.
#[cfg(any(windows, target_os = "ios", target_os = "macos"))]
const PUBLISHER: &str = if cfg!(windows) { "publisher" } else { "com.krowsingre.theboundvigil.publisher" };
/// TBV Publisher yearly (in the App Store, the same subscription group as `YEARLY`).
#[cfg(any(windows, target_os = "ios", target_os = "macos"))]
const PUBLISHER_YEARLY: &str = if cfg!(windows) { "publisher_yearly" } else { "com.krowsingre.theboundvigil.publisher.yearly" };
/// Publisher for someone who owns TBV for life, priced at the difference.
#[cfg(any(windows, target_os = "ios", target_os = "macos"))]
const UPGRADE: &str = if cfg!(windows) { "publisher_upgrade" } else { "com.krowsingre.theboundvigil.publisher.upgrade" };

/// Which plan to buy.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Plan {
    Yearly,
    Lifetime,
    PublisherYearly,
    PublisherLifetime,
    /// Publisher for a lifetime owner of TBV.
    PublisherUpgrade,
}

#[cfg(any(windows, target_os = "ios", target_os = "macos"))]
fn product_of(plan: Plan) -> &'static str {
    match plan {
        Plan::Yearly => YEARLY,
        Plan::Lifetime => PRODUCT,
        Plan::PublisherYearly => PUBLISHER_YEARLY,
        Plan::PublisherLifetime => PUBLISHER,
        Plan::PublisherUpgrade => UPGRADE,
    }
}

/// What the App Store says about one pair of products (a lifetime one and a
/// yearly one), as both Apple sides answer it.
#[cfg(any(target_os = "ios", target_os = "macos"))]
struct ApplePair {
    lifetime: bool,
    yearly: bool,
    price: Option<String>,
    yearly_price: Option<String>,
    free_month: bool,
}

/// Puts the three App Store questions (TBV, Publisher, the upgrade) together.
#[cfg(any(target_os = "ios", target_os = "macos"))]
fn apple_answer(ask: impl Fn(&str, &str) -> Result<ApplePair, String>) -> Option<StoreAnswer> {
    let base = ask(PRODUCT, YEARLY).ok()?;
    let publisher = ask(PUBLISHER, PUBLISHER_YEARLY).ok();
    let upgrade = ask(UPGRADE, PUBLISHER_YEARLY).ok();
    let publisher_owned = publisher.as_ref().is_some_and(|p| p.lifetime || p.yearly);
    // The upgrade only counts on top of TBV for life.
    let upgraded = base.lifetime && upgrade.as_ref().is_some_and(|u| u.lifetime);
    let lifetime = base.lifetime || publisher.as_ref().is_some_and(|p| p.lifetime);
    let owned = base.lifetime || base.yearly || publisher_owned;
    Some(StoreAnswer {
        owned,
        price: base.price,
        yearly_price: base.yearly_price,
        free_month: base.free_month,
        plan: if lifetime { Some("lifetime".into()) } else if owned { Some("yearly".into()) } else { None },
        publisher: publisher_owned || upgraded,
        publisher_price: publisher.as_ref().and_then(|p| p.price.clone()),
        publisher_yearly_price: publisher.as_ref().and_then(|p| p.yearly_price.clone()),
        upgrade_price: upgrade.and_then(|u| u.price),
    })
}

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
    #[cfg(any(target_os = "ios", target_os = "macos"))]
    return Shop::Apple;
    #[cfg(windows)]
    return if store::packaged() { Shop::Microsoft } else { Shop::None };
    #[cfg(not(any(windows, target_os = "ios", target_os = "macos")))]
    Shop::None
}

/// What the store says, or None when it can't be asked.
fn ask_store(app: &AppHandle) -> Option<StoreAnswer> {
    #[cfg(target_os = "ios")]
    {
        let _ = app;
        return apple_answer(|lifetime, yearly| {
            tauri_plugin_tbv_ios::store_status(lifetime, yearly).map(|s| ApplePair {
                lifetime: s.lifetime,
                yearly: s.yearly,
                price: s.price,
                yearly_price: s.yearly_price,
                free_month: s.free_month,
            })
        });
    }
    #[cfg(target_os = "macos")]
    {
        let _ = app;
        return apple_answer(|lifetime, yearly| {
            mac_store::status(lifetime, yearly).map(|s| ApplePair {
                lifetime: s.lifetime,
                yearly: s.yearly,
                price: s.price,
                yearly_price: s.yearly_price,
                free_month: s.free_month,
            })
        });
    }
    #[cfg(windows)]
    return store::status(app).ok();
    #[cfg(not(any(windows, target_os = "ios", target_os = "macos")))]
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

/// Opens the store's purchase sheet for a plan. The status afterwards says whether it went through.
pub fn buy(app: &AppHandle, library: &Mutex<Library>, plan: Plan) -> tbv_core::Result<LicenseView> {
    #[cfg(target_os = "ios")]
    tauri_plugin_tbv_ios::store_buy(product_of(plan)).map_err(tbv_core::Error::Unsuitable)?;
    #[cfg(target_os = "macos")]
    mac_store::buy(product_of(plan)).map_err(tbv_core::Error::Unsuitable)?;
    #[cfg(windows)]
    store::buy(app, product_of(plan)).map_err(tbv_core::Error::Unsuitable)?;
    #[cfg(not(any(windows, target_os = "ios", target_os = "macos")))]
    {
        let _ = (app, library, plan);
        Err(tbv_core::Error::Unsuitable("This copy of TBV can't be bought in. Get The Bound Vigil from the Microsoft Store or the App Store.".into()))
    }
    #[cfg(any(windows, target_os = "ios", target_os = "macos"))]
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
    #[cfg(target_os = "macos")]
    mac_store::restore().map_err(tbv_core::Error::Unsuitable)?;
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
        let (mut lifetime, mut yearly) = (false, false);
        let (mut publisher, mut publisher_yearly, mut upgrade) = (false, false, false);
        for pair in license.AddOnLicenses().map_err(|e| e.to_string())? {
            let l = pair.Value().map_err(|e| e.to_string())?;
            if !l.IsActive().unwrap_or(false) {
                continue;
            }
            match l.InAppOfferToken().map(|t| t.to_string()).unwrap_or_default().as_str() {
                t if t == super::PRODUCT => lifetime = true,
                t if t == super::YEARLY => yearly = true,
                t if t == super::PUBLISHER => publisher = true,
                t if t == super::PUBLISHER_YEARLY => publisher_yearly = true,
                t if t == super::UPGRADE => upgrade = true,
                _ => {}
            }
        }
        // One look at the Store's add-ons gives every price.
        let mut prices = std::collections::HashMap::new();
        if let Ok(found) = kinds().and_then(|k| context.GetAssociatedStoreProductsAsync(&k)?.join()).and_then(|f| f.Products()) {
            for pair in found {
                let Ok(p) = pair.Value() else { continue };
                if let (Ok(token), Some(price)) = (p.InAppOfferToken(), p.Price().ok().and_then(|p| p.FormattedPrice().ok())) {
                    prices.insert(token.to_string(), price.to_string());
                }
            }
        }
        let price_of = |token: &str| prices.get(token).cloned();
        let owned = lifetime || yearly || publisher || publisher_yearly;
        let for_life = lifetime || publisher;
        Ok(StoreAnswer {
            owned,
            price: price_of(super::PRODUCT),
            yearly_price: price_of(super::YEARLY),
            free_month: false,
            plan: if for_life { Some("lifetime".into()) } else if owned { Some("yearly".into()) } else { None },
            // The upgrade only counts on top of TBV for life.
            publisher: publisher || publisher_yearly || (upgrade && lifetime),
            publisher_price: price_of(super::PUBLISHER),
            publisher_yearly_price: price_of(super::PUBLISHER_YEARLY),
            upgrade_price: price_of(super::UPGRADE),
        })
    }

    fn product(context: &StoreContext, token: &str) -> windows::core::Result<Option<windows::Services::Store::StoreProduct>> {
        let found = context.GetAssociatedStoreProductsAsync(&kinds()?)?.join()?;
        for pair in found.Products()? {
            let p = pair.Value()?;
            if p.InAppOfferToken()? == token {
                return Ok(Some(p));
            }
        }
        Ok(None)
    }

    pub fn buy(app: &AppHandle, token: &str) -> Result<(), String> {
        if !packaged() {
            return Err("This copy of TBV wasn't installed from the Microsoft Store, so it can't be bought in. Get The Bound Vigil from the Store.".into());
        }
        let context = context(app).map_err(|e| e.to_string())?;
        let product = product(&context, token).map_err(|e| e.to_string())?.ok_or("The Store isn't offering that plan yet.")?;
        let result = product.RequestPurchaseAsync().map_err(|e| e.to_string())?.join().map_err(|e| e.to_string())?;
        match result.Status().map_err(|e| e.to_string())? {
            StorePurchaseStatus::Succeeded | StorePurchaseStatus::AlreadyPurchased => Ok(()),
            StorePurchaseStatus::NotPurchased => Ok(()),
            StorePurchaseStatus::NetworkError => Err("The Store couldn't be reached. Check the internet connection and try again.".into()),
            _ => Err("The Store couldn't finish the purchase.".into()),
        }
    }
}

/// The Mac App Store, through the Mac app's own Swift (src-tauri/mac).
#[cfg(target_os = "macos")]
mod mac_store {
    use std::ffi::{c_char, c_void, CStr, CString};

    extern "C" {
        fn tbv_mac_store_status(lifetime: *const c_char, yearly: *const c_char) -> *mut c_char;
        fn tbv_mac_store_buy(product: *const c_char) -> *mut c_char;
        fn tbv_mac_store_restore() -> *mut c_char;
        fn free(pointer: *mut c_void);
    }

    #[derive(serde::Deserialize, Default)]
    #[serde(rename_all = "camelCase", default)]
    pub struct Status {
        pub lifetime: bool,
        pub yearly: bool,
        pub price: Option<String>,
        pub yearly_price: Option<String>,
        pub free_month: bool,
    }

    #[derive(serde::Deserialize, Default)]
    #[serde(default)]
    struct Done {
        error: Option<String>,
    }

    /// Takes the Swift side's JSON answer, and frees it.
    fn read(answer: *mut c_char) -> Result<serde_json::Value, String> {
        if answer.is_null() {
            return Err("The App Store didn't answer.".into());
        }
        // SAFETY: a NUL-terminated string from strdup, freed here once read.
        let text = unsafe { CStr::from_ptr(answer) }.to_string_lossy().into_owned();
        unsafe { free(answer.cast()) };
        serde_json::from_str(&text).map_err(|e| e.to_string())
    }

    fn done(answer: *mut c_char) -> Result<(), String> {
        let done: Done = serde_json::from_value(read(answer)?).unwrap_or_default();
        done.error.map_or(Ok(()), Err)
    }

    pub fn status(lifetime: &str, yearly: &str) -> Result<Status, String> {
        let (lifetime, yearly) = (CString::new(lifetime).map_err(|e| e.to_string())?, CString::new(yearly).map_err(|e| e.to_string())?);
        // SAFETY: both strings live for the call.
        let answer = unsafe { tbv_mac_store_status(lifetime.as_ptr(), yearly.as_ptr()) };
        serde_json::from_value(read(answer)?).map_err(|e| e.to_string())
    }

    pub fn buy(product: &str) -> Result<(), String> {
        let product = CString::new(product).map_err(|e| e.to_string())?;
        // SAFETY: the string lives for the call.
        done(unsafe { tbv_mac_store_buy(product.as_ptr()) })
    }

    pub fn restore() -> Result<(), String> {
        // SAFETY: takes nothing.
        done(unsafe { tbv_mac_store_restore() })
    }
}

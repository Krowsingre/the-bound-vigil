//! Signing in to Dropbox, Google Drive and OneDrive. The sign-in page opens
//! in the browser (on iPhone, over TBV) and comes back to TBV on this
//! device; the library isn't locked while it waits.

use std::net::TcpListener;
use std::time::Duration;

use tbv_core::sync::cloud::{self, Return, Service};
use tbv_core::sync::Provider;
use tbv_core::Error;

/// Signs in and gives the place to sync with, for Settings to choose.
pub fn sign_in(service: Service) -> tbv_core::Result<Provider> {
    let (pending, answer) = match cloud::return_for(service) {
        Return::Loopback { port, localhost } => {
            let first = TcpListener::bind(("127.0.0.1", port.unwrap_or(0))).map_err(|e| {
                Error::Unsuitable(format!("TBV couldn't get ready for the {} sign-in ({e}). Close any other sign-in that's open and try again.", service.name()))
            })?;
            let port = first.local_addr()?.port();
            let mut listeners = vec![first];
            // "localhost" may reach either loopback address.
            if localhost {
                if let Ok(second) = TcpListener::bind(("::1", port)) {
                    listeners.push(second);
                }
            }
            let pending = cloud::begin_sign_in(service, port)?;
            #[cfg(target_os = "ios")]
            tauri_plugin_tbv_ios::open_sign_in(&pending.url).map_err(Error::Unsuitable)?;
            #[cfg(not(target_os = "ios"))]
            tauri_plugin_opener::open_url(&pending.url, None::<&str>).map_err(|e| Error::Unsuitable(format!("The browser couldn't be opened: {e}")))?;
            let heard = tbv_core::oauth::wait_for_any(&listeners, Duration::from_secs(300));
            #[cfg(target_os = "ios")]
            tauri_plugin_tbv_ios::close_sign_in();
            (pending, heard?)
        }
        Return::AppScheme { scheme } => {
            let pending = cloud::begin_sign_in(service, 0)?;
            let url = to_app(&pending.url, &scheme)?;
            (pending, tbv_core::oauth::answer_from_url(&url))
        }
    };
    let account = cloud::finish_sign_in(&cloud::Http, &pending, &answer)?;
    Ok(Provider::Cloud(account))
}

/// A sign-in page whose answer comes to TBV's own address (on iPhone).
#[cfg(target_os = "ios")]
fn to_app(url: &str, scheme: &str) -> tbv_core::Result<String> {
    tauri_plugin_tbv_ios::authenticate(url, scheme).map_err(Error::Unsuitable)
}

#[cfg(not(target_os = "ios"))]
fn to_app(_url: &str, _scheme: &str) -> tbv_core::Result<String> {
    Err(Error::Unsuitable("This sign-in only opens on iPhone.".into()))
}

/// Tells the service to forget a sign-in no longer used, in the background.
pub fn forget(provider: Provider) {
    if let Provider::Cloud(account) = provider {
        std::thread::spawn(move || cloud::sign_out(&account));
    }
}

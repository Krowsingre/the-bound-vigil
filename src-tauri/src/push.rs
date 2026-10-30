//! Waking the library's other devices. After this device sends changes it
//! asks TBV's push server (push/ in the repo) to wake the iPhones and iPads
//! that share the library, which then sync straight away instead of
//! waiting for iOS to let them check. The server only ever learns the
//! library's wake-up name (see `Remote::wake_key`) and the phones' push
//! addresses, nothing about the books.

use std::collections::HashSet;
use std::sync::Mutex;
use std::time::Duration;

const SERVER: &str = "https://tbv-push.krowsingre.workers.dev";

/// This phone's push address, and whether it's Apple's test service (a debug build).
static TOKEN: Mutex<Option<(String, bool)>> = Mutex::new(None);
/// The wake-up names of the places this library syncs with, as of the last sync.
static KEYS: Mutex<Vec<String>> = Mutex::new(Vec::new());
/// Wake-up names this phone has signed up under since TBV opened.
static SIGNED_UP: Mutex<Option<HashSet<(String, String)>>> = Mutex::new(None);

fn agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(15)))
        .user_agent(concat!("The Bound Vigil/", env!("CARGO_PKG_VERSION")))
        .build()
        .into()
}

fn post(path: &str, body: serde_json::Value) -> bool {
    agent().post(format!("{SERVER}{path}")).header("content-type", "application/json").send(body.to_string()).is_ok()
}

/// After a sync: signs this phone up for wake-ups, and wakes the other
/// devices if this one sent anything. Runs on its own thread, so a slow or
/// missing push server never holds up sync.
pub fn after_sync(keys: Vec<String>, sent: bool) {
    if keys.is_empty() {
        return;
    }
    if let Ok(mut known) = KEYS.lock() {
        known.clone_from(&keys);
    }
    std::thread::spawn(move || {
        sign_up(&keys);
        if sent {
            let me = TOKEN.lock().ok().and_then(|t| t.as_ref().map(|(token, _)| token.clone()));
            for key in &keys {
                post("/wake", serde_json::json!({ "key": key, "except": me }));
            }
        }
    });
}

fn sign_up(keys: &[String]) {
    let Some((token, sandbox)) = TOKEN.lock().ok().and_then(|t| t.clone()) else { return };
    for key in keys {
        let pair = (key.clone(), token.clone());
        if SIGNED_UP.lock().ok().is_some_and(|s| s.as_ref().is_some_and(|s| s.contains(&pair))) {
            continue;
        }
        if post("/register", serde_json::json!({ "key": key, "token": token, "sandbox": sandbox })) {
            if let Ok(mut signed) = SIGNED_UP.lock() {
                signed.get_or_insert_with(HashSet::new).insert(pair);
            }
        }
    }
}

/// Called by the iOS plugin with this phone's push address, once iOS gives it.
#[cfg(target_os = "ios")]
#[no_mangle]
pub extern "C" fn tbv_push_token(token: *const std::os::raw::c_char, sandbox: bool) {
    if token.is_null() {
        return;
    }
    // SAFETY: the plugin passes a NUL-terminated string that lives for this call.
    let token = unsafe { std::ffi::CStr::from_ptr(token) }.to_string_lossy().into_owned();
    if let Ok(mut mine) = TOKEN.lock() {
        *mine = Some((token, sandbox));
    }
    let keys = KEYS.lock().map(|k| k.clone()).unwrap_or_default();
    if !keys.is_empty() {
        std::thread::spawn(move || sign_up(&keys));
    }
}

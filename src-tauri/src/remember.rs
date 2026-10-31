//! Keeps what this device remembers (tbv-core's remember.rs) somewhere that
//! outlives TBV being deleted: the Keychain on iPhones, iPads and Macs, and
//! Credential Manager on Windows. A new install that finds it there picks up
//! where the old one was, with the same place in sync, name and sign-ins.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use tbv_core::library::Library;

/// Puts back what an earlier install remembered, if this library is brand new.
pub fn bring_back(library: &Library) -> bool {
    match store::read() {
        Some(kept) => library.bring_back(&kept).unwrap_or(false),
        None => false,
    }
}

/// Keeps what's remembered up to date while TBV runs: sign-ins renew and
/// settings change, so it's looked at again every minute and kept when it differs.
pub fn keep(library: Arc<Mutex<Library>>) {
    std::thread::spawn(move || {
        let mut last: Option<String> = None;
        loop {
            let now = library.lock().ok().and_then(|l| l.remembered().ok().flatten());
            if let Some(now) = now {
                if last.as_ref() != Some(&now) && store::write(&now) {
                    last = Some(now);
                }
            }
            std::thread::sleep(Duration::from_secs(60));
        }
    });
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
mod store {
    use security_framework::passwords::{get_generic_password, set_generic_password};

    const SERVICE: &str = "com.krowsingre.theboundvigil";
    const ACCOUNT: &str = "device-memory";

    pub fn read() -> Option<String> {
        get_generic_password(SERVICE, ACCOUNT).ok().and_then(|b| String::from_utf8(b).ok())
    }

    pub fn write(value: &str) -> bool {
        set_generic_password(SERVICE, ACCOUNT, value.as_bytes()).is_ok()
    }
}

#[cfg(windows)]
mod store {
    use windows::core::{HSTRING, PWSTR};
    use windows::Win32::Security::Credentials::{
        CredDeleteW, CredFree, CredReadW, CredWriteW, CREDENTIALW, CRED_FLAGS, CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC,
    };

    /// Credential Manager keeps at most 2,560 bytes in one entry, so longer
    /// words are kept in numbered pieces.
    const PIECE: usize = 2000;

    fn name(i: usize) -> HSTRING {
        HSTRING::from(format!("The Bound Vigil/device memory/{i}"))
    }

    fn piece(i: usize) -> Option<Vec<u8>> {
        let mut found: *mut CREDENTIALW = std::ptr::null_mut();
        // SAFETY: CredReadW fills `found` with a block we read, then free with CredFree.
        unsafe {
            CredReadW(&name(i), CRED_TYPE_GENERIC, None, &mut found).ok()?;
            let c = &*found;
            let bytes = std::slice::from_raw_parts(c.CredentialBlob, c.CredentialBlobSize as usize).to_vec();
            CredFree(found as *const _);
            Some(bytes)
        }
    }

    pub fn read() -> Option<String> {
        let mut all = Vec::new();
        for i in 0.. {
            match piece(i) {
                Some(bytes) => all.extend(bytes),
                None if i == 0 => return None,
                None => break,
            }
        }
        String::from_utf8(all).ok()
    }

    pub fn write(value: &str) -> bool {
        let pieces: Vec<&[u8]> = value.as_bytes().chunks(PIECE).collect();
        for (i, bytes) in pieces.iter().enumerate() {
            let target = name(i);
            let mut user: Vec<u16> = "The Bound Vigil".encode_utf16().chain([0]).collect();
            let mut blob = bytes.to_vec();
            let credential = CREDENTIALW {
                Flags: CRED_FLAGS(0),
                Type: CRED_TYPE_GENERIC,
                TargetName: PWSTR(target.as_ptr() as *mut u16),
                CredentialBlobSize: blob.len() as u32,
                CredentialBlob: blob.as_mut_ptr(),
                Persist: CRED_PERSIST_LOCAL_MACHINE,
                UserName: PWSTR(user.as_mut_ptr()),
                ..Default::default()
            };
            // SAFETY: every pointer in `credential` lives until the call returns.
            if unsafe { CredWriteW(&credential, 0) }.is_err() {
                return false;
            }
        }
        // Pieces left over from longer words before.
        for i in pieces.len()..pieces.len() + 8 {
            // SAFETY: deleting by name; a missing piece is just an error.
            if unsafe { CredDeleteW(&name(i), CRED_TYPE_GENERIC, None) }.is_err() {
                break;
            }
        }
        true
    }
}

#[cfg(not(any(target_os = "macos", target_os = "ios", windows)))]
mod store {
    pub fn read() -> Option<String> {
        None
    }

    pub fn write(_value: &str) -> bool {
        false
    }
}

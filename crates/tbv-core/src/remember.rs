//! What this device remembers outside the library, so deleting TBV and
//! installing it again picks up where it was: the same device in sync, its
//! name, and its way into the cloud. The app keeps the remembered words
//! somewhere that outlives TBV being removed (the Keychain on Apple devices,
//! Credential Manager on Windows); this says what goes in and how it comes back.

use std::collections::BTreeMap;

use crate::error::Result;
use crate::library::Library;

/// The settings remembered: this device's place in sync and its name, where
/// the library syncs and the sign-ins for it, and the trial's start.
const REMEMBERED: [&str; 12] = [
    "sync.device_id",
    crate::profile::DEVICE_NAME_KEY,
    crate::sync::PROVIDER,
    crate::sync::ALSO,
    "sync.supabase",
    "sync.session",
    crate::hardcover::ACCOUNT_KEY,
    crate::ereaders::email::SETTINGS_KEY,
    crate::servers::SETTINGS_KEY,
    crate::opds::SETTINGS_KEY,
    crate::license::STARTED,
    crate::license::CODE,
];

impl Library {
    /// What to remember, as JSON. None until this device has a place in sync
    /// (a library that has never synced has nothing worth bringing back).
    pub fn remembered(&self) -> Result<Option<String>> {
        let mut kept = BTreeMap::new();
        for key in REMEMBERED {
            if let Some(value) = self.setting(key)? {
                kept.insert(key, value);
            }
        }
        if !kept.contains_key("sync.device_id") {
            return Ok(None);
        }
        Ok(Some(serde_json::to_string(&kept)?))
    }

    /// Puts back what an earlier install remembered, but only into a library
    /// that's brand new: no place in sync yet and no books. True when it did.
    pub fn bring_back(&self, remembered: &str) -> Result<bool> {
        let books: i64 = self.conn.query_row("SELECT COUNT(*) FROM books", [], |r| r.get(0))?;
        if books > 0 || self.setting("sync.device_id")?.is_some() {
            return Ok(false);
        }
        let Ok(kept) = serde_json::from_str::<BTreeMap<String, String>>(remembered) else {
            return Ok(false);
        };
        if !kept.contains_key("sync.device_id") {
            return Ok(false);
        }
        for (key, value) in kept {
            if REMEMBERED.contains(&key.as_str()) {
                self.set_setting(&key, &value)?;
            }
        }
        Ok(true)
    }
}

#[cfg(test)]
mod tests {
    use crate::library::tests::open_temp_library;

    #[test]
    fn nothing_to_remember_before_sync() {
        let (_dir, library) = open_temp_library();
        assert_eq!(library.remembered().unwrap(), None);
    }

    #[test]
    fn a_new_install_picks_up_where_the_old_one_was() {
        let (_old_dir, old) = open_temp_library();
        let id = old.device_id().unwrap();
        old.set_setting("device.name", "Kitchen iPad").unwrap();
        old.set_setting("sync.provider", "{\"kind\":\"folder\"}").unwrap();
        old.set_setting("reader", "{\"size\":20}").unwrap();
        let kept = old.remembered().unwrap().unwrap();
        assert!(!kept.contains("reader"));

        let (_dir, fresh) = open_temp_library();
        assert!(fresh.bring_back(&kept).unwrap());
        assert_eq!(fresh.device_id().unwrap(), id);
        assert_eq!(fresh.setting("device.name").unwrap().as_deref(), Some("Kitchen iPad"));
        assert_eq!(fresh.setting("sync.provider").unwrap().as_deref(), Some("{\"kind\":\"folder\"}"));
        assert_eq!(fresh.setting("reader").unwrap(), None);
    }

    #[test]
    fn a_library_in_use_is_left_alone() {
        let (_old_dir, old) = open_temp_library();
        old.device_id().unwrap();
        let kept = old.remembered().unwrap().unwrap();
        let (_dir, used) = open_temp_library();
        let mine = used.device_id().unwrap();
        assert!(!used.bring_back(&kept).unwrap());
        assert_eq!(used.device_id().unwrap(), mine);
        assert!(!used.bring_back("not json").unwrap());
    }
}

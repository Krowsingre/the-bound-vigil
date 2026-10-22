//! The profile picture, shown inside the sync circle. It syncs like the
//! rest of the library, so every device signed in to the same library shows
//! the same picture. TBV keeps its own copy of the image; the cloud has it
//! under `pictures/`, next to collection pictures.

use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::{params, OptionalExtension};

use crate::error::{Error, Result};
use crate::ids::new_record_id;
use crate::library::Library;
use crate::model::Profile;
use crate::time::now_utc;

pub const AVATAR_FORMATS: &[&str] = &["png", "jpg", "jpeg", "webp", "gif"];
const MAX_AVATAR_BYTES: u64 = 10 * 1024 * 1024;
/// Where early versions kept this device's own picture.
const AVATAR_KEY: &str = "avatar_path";
const ME: &str = "me";

const DEVICE_NAME_KEY: &str = "device.name";

/// What kind of device this is ("iPad"), when the app knows better than the
/// system does. Set once at startup.
static DEVICE_KIND: std::sync::OnceLock<String> = std::sync::OnceLock::new();

pub fn set_device_kind(kind: &str) {
    if !kind.trim().is_empty() {
        let _ = DEVICE_KIND.set(kind.trim().to_string());
    }
}

/// A computer's own name, else what kind of device it is.
fn default_device_name() -> String {
    let computer = std::env::var("COMPUTERNAME").or_else(|_| std::env::var("HOSTNAME")).unwrap_or_default();
    let computer = computer.trim();
    if !computer.is_empty() && !cfg!(target_os = "ios") {
        return computer.to_string();
    }
    DEVICE_KIND.get().cloned().unwrap_or_else(|| crate::sync::device_label().to_string())
}

/// A name as typed, kept to one line of sensible length; None when empty.
fn tidy_name(name: &str) -> Option<String> {
    let name = name.split_whitespace().collect::<Vec<_>>().join(" ");
    (!name.is_empty()).then(|| name.chars().take(60).collect())
}

/// A name TBV gave a picture, safe to use as a file name.
fn is_avatar_name(name: &str) -> bool {
    name.starts_with("avatar-") && !name.contains(['/', '\\']) && !name.contains("..")
}

impl Library {
    /// The picture's file name, if there is one.
    pub(crate) fn avatar_name(&self) -> Result<Option<String>> {
        let name: Option<Option<String>> =
            self.conn.query_row("SELECT avatar FROM profile WHERE id = ?1", params![ME], |r| r.get(0)).optional()?;
        Ok(name.flatten().filter(|n| is_avatar_name(n)))
    }

    fn save_avatar_name(&self, name: Option<&str>) -> Result<()> {
        self.conn.execute(
            "INSERT INTO profile (id, avatar, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(id) DO UPDATE SET avatar = excluded.avatar, updated_at = excluded.updated_at",
            params![ME, name, now_utc()],
        )?;
        Ok(())
    }

    /// Makes a picture chosen before pictures synced the library's own.
    pub(crate) fn adopt_device_avatar(&self) -> Result<()> {
        let old: Option<String> =
            self.conn.query_row("SELECT value FROM device_settings WHERE key = ?1", params![AVATAR_KEY], |r| r.get(0)).optional()?;
        let Some(old) = old else { return Ok(()) };
        let name = Path::new(&old).file_name().map(|n| n.to_string_lossy().to_string());
        if let Some(name) = name.filter(|n| is_avatar_name(n) && Path::new(&old).exists()) {
            if self.avatar_name()?.is_none() {
                self.save_avatar_name(Some(&name))?;
            }
        }
        self.conn.execute("DELETE FROM device_settings WHERE key = ?1", params![AVATAR_KEY])?;
        Ok(())
    }

    pub fn profile(&self) -> Result<Profile> {
        let path = self.avatar_name()?.map(|n| self.paths.profile_dir.join(n)).filter(|p| p.exists());
        Ok(Profile { avatar_path: path.map(|p| p.display().to_string()), name: self.account_name()?, device_name: self.device_name()? })
    }

    fn account_name(&self) -> Result<Option<String>> {
        let name: Option<Option<String>> = self.conn.query_row("SELECT name FROM profile WHERE id = ?1", params![ME], |r| r.get(0)).optional()?;
        Ok(name.flatten().map(|n| n.trim().to_string()).filter(|n| !n.is_empty()))
    }

    /// The account's name, the same on every device. Empty takes it away.
    pub fn set_account_name(&self, name: &str) -> Result<Profile> {
        let name = tidy_name(name);
        self.conn.execute(
            "INSERT INTO profile (id, name, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at",
            params![ME, name, now_utc()],
        )?;
        self.profile()
    }

    /// What this device is called. Until it's named: the computer's own name,
    /// or what kind of device it is.
    pub fn device_name(&self) -> Result<String> {
        if let Some(name) = self.setting(DEVICE_NAME_KEY)?.map(|n| n.trim().to_string()).filter(|n| !n.is_empty()) {
            return Ok(name);
        }
        Ok(default_device_name())
    }

    /// Names this device; empty goes back to the name it started with.
    pub fn set_device_name(&self, name: &str) -> Result<Profile> {
        self.set_setting(DEVICE_NAME_KEY, &tidy_name(name).unwrap_or_default())?;
        self.profile()
    }

    /// Copies the picture into TBV's profile folder and uses it from now on.
    pub fn set_avatar(&self, source: &Path) -> Result<Profile> {
        let extension = source
            .extension()
            .map(|e| e.to_string_lossy().to_ascii_lowercase())
            .filter(|e| AVATAR_FORMATS.contains(&e.as_str()))
            .ok_or_else(|| Error::Unsuitable("choose a PNG, JPEG, WebP or GIF picture".into()))?;
        if fs::metadata(source)?.len() > MAX_AVATAR_BYTES {
            return Err(Error::Unsuitable("that picture is over 10 MB".into()));
        }
        fs::create_dir_all(&self.paths.profile_dir)?;
        // A fresh name each time, so the window never shows a stale cached
        // image, and other devices know to fetch the new one.
        let name = format!("avatar-{}.{extension}", new_record_id());
        fs::copy(source, self.paths.profile_dir.join(&name))?;
        self.save_avatar_name(Some(&name))?;
        self.tidy_avatars()?;
        self.profile()
    }

    pub fn clear_avatar(&self) -> Result<Profile> {
        self.save_avatar_name(None)?;
        self.tidy_avatars()?;
        self.profile()
    }

    /// The picture, as (cloud path, file), when another device chose it and it isn't here yet.
    pub(crate) fn avatar_to_fetch(&self) -> Result<Option<(String, PathBuf)>> {
        Ok(self
            .avatar_name()?
            .map(|name| (format!("pictures/{name}"), self.paths.profile_dir.join(name)))
            .filter(|(_, file)| !file.exists()))
    }

    /// Removes pictures no longer in use.
    pub(crate) fn tidy_avatars(&self) -> Result<()> {
        let current = self.avatar_name()?;
        let Ok(entries) = fs::read_dir(&self.paths.profile_dir) else { return Ok(()) };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if is_avatar_name(&name) && current.as_deref() != Some(name.as_str()) {
                let _ = fs::remove_file(entry.path());
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use crate::library::tests::open_temp_library;
    use std::fs;

    #[test]
    fn the_account_and_device_have_names() {
        let (_dir, library) = open_temp_library();
        let start = library.profile().unwrap();
        assert_eq!(start.name, None);
        assert!(!start.device_name.is_empty(), "a device always has a name");
        assert_eq!(library.set_account_name("  embre   K ").unwrap().name.as_deref(), Some("embre K"));
        assert_eq!(library.set_device_name("embre's iPad").unwrap().device_name, "embre's iPad");
        assert_eq!(library.set_device_name(" ").unwrap().device_name, start.device_name);
        assert_eq!(library.set_account_name("").unwrap().name, None);
        // The picture and the name are kept apart.
        let picture = _dir.path().join("me.png");
        fs::write(&picture, b"png").unwrap();
        library.set_account_name("embre").unwrap();
        assert_eq!(library.set_avatar(&picture).unwrap().name.as_deref(), Some("embre"));
    }

    #[test]
    fn avatar_is_copied_replaced_and_cleared() {
        let (dir, library) = open_temp_library();
        assert_eq!(library.profile().unwrap().avatar_path, None);

        let first = dir.path().join("me.PNG");
        fs::write(&first, b"png bytes").unwrap();
        let set = library.set_avatar(&first).unwrap().avatar_path.unwrap();
        assert!(set.starts_with(library.paths().profile_dir.to_str().unwrap()));
        assert!(set.ends_with(".png"));
        assert!(first.exists(), "the original picture is left alone");

        let second = dir.path().join("me2.jpg");
        fs::write(&second, b"jpg bytes").unwrap();
        let replaced = library.set_avatar(&second).unwrap().avatar_path.unwrap();
        assert!(
            !std::path::Path::new(&set).exists(),
            "the old copy is removed"
        );
        assert_eq!(fs::read(&replaced).unwrap(), b"jpg bytes");

        assert_eq!(library.clear_avatar().unwrap().avatar_path, None);
        assert!(!std::path::Path::new(&replaced).exists());
    }

    #[test]
    fn rejects_files_that_are_not_pictures() {
        let (dir, library) = open_temp_library();
        let text = dir.path().join("notes.txt");
        fs::write(&text, b"hi").unwrap();
        assert!(library.set_avatar(&text).is_err());
        assert_eq!(library.profile().unwrap().avatar_path, None);
    }
}

//! This device's profile picture, shown inside the sync circle. It is a
//! device setting, not synced, and TBV keeps its own copy of the image.

use std::fs;
use std::path::Path;

use rusqlite::{params, OptionalExtension};

use crate::error::{Error, Result};
use crate::ids::new_record_id;
use crate::library::Library;
use crate::model::Profile;

pub const AVATAR_FORMATS: &[&str] = &["png", "jpg", "jpeg", "webp", "gif"];
const MAX_AVATAR_BYTES: u64 = 10 * 1024 * 1024;
const AVATAR_KEY: &str = "avatar_path";

impl Library {
    pub fn profile(&self) -> Result<Profile> {
        let avatar_path: Option<String> = self
            .conn
            .query_row(
                "SELECT value FROM device_settings WHERE key = ?1",
                params![AVATAR_KEY],
                |r| r.get(0),
            )
            .optional()?;
        Ok(Profile {
            avatar_path: avatar_path.filter(|p| Path::new(p).exists()),
        })
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
        // A fresh name each time, so the window never shows a stale cached image.
        let target = self
            .paths
            .profile_dir
            .join(format!("avatar-{}.{extension}", new_record_id()));
        fs::copy(source, &target)?;
        let previous = self.profile()?.avatar_path;
        self.conn.execute(
            "INSERT INTO device_settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![AVATAR_KEY, target.display().to_string()],
        )?;
        if let Some(old) = previous {
            let _ = fs::remove_file(old);
        }
        self.profile()
    }

    pub fn clear_avatar(&self) -> Result<Profile> {
        if let Some(old) = self.profile()?.avatar_path {
            let _ = fs::remove_file(old);
        }
        self.conn.execute(
            "DELETE FROM device_settings WHERE key = ?1",
            params![AVATAR_KEY],
        )?;
        self.profile()
    }
}

#[cfg(test)]
mod tests {
    use crate::library::tests::open_temp_library;
    use std::fs;

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

//! Hidden books (embre, 21 November): chosen books leave the Archive, Sanctum,
//! Resonance, search, compendiums, series and counts, and wait in a locked
//! Hidden collection. Hiding only: the files aren't scrambled. Hiding and the
//! collection's password are synced, so every device hides the same books and
//! opens them with the same password.
//!
//! The password is never kept: only a salted PBKDF2-SHA256 of it, made and
//! checked by the app (src/library/hiddenLock.ts) so every platform, the web
//! version too, works it out the same way.

use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::time::now_utc;
use crate::{Error, Library, Result};

/// The Hidden collection's password, as a salted hash.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HiddenLock {
    /// Hex.
    pub salt: String,
    /// Hex.
    pub hash: String,
    pub rounds: u32,
}

fn hex(value: &str, what: &str) -> Result<String> {
    let v = value.trim().to_ascii_lowercase();
    if v.len() >= 32 && v.len() <= 256 && v.len().is_multiple_of(2) && v.chars().all(|c| c.is_ascii_hexdigit()) {
        Ok(v)
    } else {
        Err(Error::Unsuitable(format!("the Hidden password's {what} isn't right")))
    }
}

impl Library {
    /// Hides books, or brings them back. Only real changes are written, so syncing sends nothing that didn't move.
    pub fn set_hidden(&self, book_ids: &[String], hidden: bool) -> Result<u32> {
        let tx = self.conn.unchecked_transaction()?;
        let mut changed = 0;
        let at = now_utc();
        for id in book_ids {
            changed += if hidden {
                tx.execute("UPDATE books SET hidden_at = ?2 WHERE id = ?1 AND hidden_at IS NULL AND deleted_at IS NULL", params![id, at])?
            } else {
                tx.execute("UPDATE books SET hidden_at = NULL WHERE id = ?1 AND hidden_at IS NOT NULL", params![id])?
            };
        }
        tx.commit()?;
        Ok(changed as u32)
    }

    /// How many books are hidden (shown on the locked Hidden card only once it's open).
    pub fn hidden_count(&self) -> Result<u32> {
        Ok(self.conn.query_row(
            "SELECT COUNT(*) FROM books WHERE hidden_at IS NOT NULL AND deleted_at IS NULL AND same_as IS NULL",
            [],
            |r| r.get(0),
        )?)
    }

    /// The password's hash, once one is set.
    pub fn hidden_lock(&self) -> Result<Option<HiddenLock>> {
        Ok(self
            .conn
            .query_row("SELECT salt, hash, rounds FROM hidden_lock WHERE id = 'hidden'", [], |r| {
                Ok(HiddenLock { salt: r.get(0)?, hash: r.get(1)?, rounds: r.get(2)? })
            })
            .optional()?)
    }

    /// Sets (or changes) the password's hash.
    pub fn set_hidden_lock(&self, lock: &HiddenLock) -> Result<()> {
        if !(100_000..=10_000_000).contains(&lock.rounds) {
            return Err(Error::Unsuitable("the Hidden password needs more rounds".into()));
        }
        self.conn.execute(
            "INSERT INTO hidden_lock (id, salt, hash, rounds, updated_at) VALUES ('hidden', ?1, ?2, ?3, ?4)
             ON CONFLICT(id) DO UPDATE SET salt = excluded.salt, hash = excluded.hash, rounds = excluded.rounds, updated_at = excluded.updated_at",
            params![hex(&lock.salt, "salt")?, hex(&lock.hash, "hash")?, lock.rounds, now_utc()],
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use crate::epub::tests::write_test_epub_with;
    use crate::library::tests::open_temp_library;
    use crate::model::{ImportResult, LibraryQuery};

    #[test]
    fn hidden_books_leave_every_list_and_count_but_open_from_hidden() {
        let (dir, mut library) = open_temp_library();
        let mut ids = Vec::new();
        for title in ["Shown", "Kept Away"] {
            let path = dir.path().join(format!("{title}.epub"));
            write_test_epub_with(&path, title, "X", false, "");
            match &library.import_files(&[path])[0] {
                ImportResult::Imported { book_id, .. } => ids.push(book_id.clone()),
                other => panic!("{other:?}"),
            }
        }
        library.set_hidden(&ids[1..], true).unwrap();
        let shown = library.library_page(&LibraryQuery::default()).unwrap();
        assert_eq!(shown.books.iter().map(|b| b.title.as_str()).collect::<Vec<_>>(), ["Shown"]);
        assert_eq!(shown.total, 1);
        assert_eq!(library.shelf_counts().unwrap().all, 1);
        let home = library.home().unwrap();
        assert_eq!(home.library_counts.total, 1);
        assert!(home.recently_added.iter().all(|b| b.title != "Kept Away"));
        let found = library.library_page(&LibraryQuery { search: Some("Kept".into()), ..Default::default() }).unwrap();
        assert!(found.books.is_empty());

        let hidden = library.library_page(&LibraryQuery { hidden: true, ..Default::default() }).unwrap();
        assert_eq!(hidden.books.iter().map(|b| b.title.as_str()).collect::<Vec<_>>(), ["Kept Away"]);
        assert!(library.book(&ids[1]).unwrap().is_some());
        assert_eq!(library.hidden_count().unwrap(), 1);

        library.set_hidden(&ids[1..], false).unwrap();
        assert_eq!(library.library_page(&LibraryQuery::default()).unwrap().total, 2);
    }

    #[test]
    fn the_password_is_kept_only_as_a_hash() {
        let (_dir, library) = open_temp_library();
        assert_eq!(library.hidden_lock().unwrap(), None);
        let weak = super::HiddenLock { salt: "ab".repeat(16), hash: "cd".repeat(32), rounds: 10 };
        assert!(library.set_hidden_lock(&weak).is_err());
        let not_hex = super::HiddenLock { salt: "my password".into(), hash: "cd".repeat(32), rounds: 210_000 };
        assert!(library.set_hidden_lock(&not_hex).is_err());
    }
}

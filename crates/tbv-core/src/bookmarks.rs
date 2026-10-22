//! Websites saved in Browse › Browser, synced so every device has them.

use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::ids::new_record_id;
use crate::time::now_utc;
use crate::{Error, Library, Result};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Bookmark {
    pub id: String,
    pub title: String,
    pub url: String,
}

/// Only web pages are saved: an address someone typed is checked first.
fn web_address(url: &str) -> Result<String> {
    let url = url.trim();
    let lower = url.to_ascii_lowercase();
    if !(lower.starts_with("https://") || lower.starts_with("http://")) || url.len() < 10 {
        return Err(Error::Unsuitable("Only web addresses (http or https) can be bookmarked.".into()));
    }
    Ok(url.to_string())
}

impl Library {
    /// Bookmarks in the order they were saved (or put in).
    pub fn bookmarks(&self) -> Result<Vec<Bookmark>> {
        let mut statement = self.conn.prepare("SELECT id, title, url FROM bookmarks WHERE deleted_at IS NULL ORDER BY position, created_at")?;
        let rows = statement.query_map([], |r| Ok(Bookmark { id: r.get(0)?, title: r.get(1)?, url: r.get(2)? }))?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    /// Saves a page at the end of the list. Saving one that's there already
    /// only renames it.
    pub fn add_bookmark(&self, title: &str, url: &str) -> Result<Bookmark> {
        let url = web_address(url)?;
        let title = title.trim();
        let title = if title.is_empty() { url.clone() } else { title.chars().take(200).collect() };
        let now = now_utc();
        let existing: Option<String> = self
            .conn
            .query_row("SELECT id FROM bookmarks WHERE url = ?1 AND deleted_at IS NULL", params![url], |r| r.get(0))
            .optional()?;
        let id = match existing {
            Some(id) => {
                self.conn.execute("UPDATE bookmarks SET title = ?2, updated_at = ?3 WHERE id = ?1", params![id, title, now])?;
                id
            }
            None => {
                let id = new_record_id();
                let last: f64 = self.conn.query_row("SELECT COALESCE(MAX(position), 0) FROM bookmarks", [], |r| r.get(0))?;
                self.conn.execute(
                    "INSERT INTO bookmarks (id, title, url, position, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
                    params![id, title, url, last + 1.0, now],
                )?;
                id
            }
        };
        Ok(Bookmark { id, title, url })
    }

    pub fn rename_bookmark(&self, id: &str, title: &str) -> Result<()> {
        let title = title.trim();
        if title.is_empty() {
            return Err(Error::Unsuitable("A bookmark needs a name.".into()));
        }
        self.conn.execute("UPDATE bookmarks SET title = ?2, updated_at = ?3 WHERE id = ?1", params![id, title, now_utc()])?;
        Ok(())
    }

    /// Kept as removed, so other devices take it off too.
    pub fn remove_bookmark(&self, id: &str) -> Result<()> {
        let now = now_utc();
        self.conn.execute("UPDATE bookmarks SET deleted_at = ?2, updated_at = ?2 WHERE id = ?1", params![id, now])?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use crate::library::tests::open_temp_library;

    #[test]
    fn bookmarks_are_kept_once_each_and_in_order() {
        let (_dir, library) = open_temp_library();
        library.add_bookmark("Gutenberg", "https://www.gutenberg.org/").unwrap();
        let archive = library.add_bookmark("", "https://archive.org/").unwrap();
        assert_eq!(archive.title, "https://archive.org/");
        library.add_bookmark("Internet Archive", "https://archive.org/").unwrap();
        let list = library.bookmarks().unwrap();
        assert_eq!(list.iter().map(|b| b.title.as_str()).collect::<Vec<_>>(), ["Gutenberg", "Internet Archive"]);
        library.remove_bookmark(&list[0].id).unwrap();
        assert_eq!(library.bookmarks().unwrap().len(), 1);
        assert!(library.add_bookmark("Files", "file:///C:/").is_err());
        assert!(library.add_bookmark("Script", "javascript:alert(1)").is_err());
    }
}

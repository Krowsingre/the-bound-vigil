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
    pub folder: Option<String>,
}

/// Only web pages are saved: an address someone typed is checked first.
pub(crate) fn web_address(url: &str) -> Result<String> {
    let url = url.trim();
    let lower = url.to_ascii_lowercase();
    if !(lower.starts_with("https://") || lower.starts_with("http://")) || url.len() < 10 {
        return Err(Error::Unsuitable("Only web addresses (http or https) can be bookmarked.".into()));
    }
    Ok(url.to_string())
}

fn bookmark_folder(folder: Option<&str>) -> Option<String> {
    folder.map(str::trim).filter(|name| !name.is_empty()).map(|name| name.chars().take(120).collect())
}

impl Library {
    /// Bookmarks in the order they were saved (or put in).
    pub fn bookmarks(&self) -> Result<Vec<Bookmark>> {
        let mut statement = self.conn.prepare("SELECT id, title, url, folder FROM bookmarks WHERE deleted_at IS NULL ORDER BY position, created_at, id")?;
        let rows = statement.query_map([], |r| Ok(Bookmark { id: r.get(0)?, title: r.get(1)?, url: r.get(2)?, folder: r.get(3)? }))?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    /// Saves a page at the end of the list. Saving one that's there already
    /// only renames it.
    pub fn add_bookmark(&self, title: &str, url: &str) -> Result<Bookmark> {
        self.add_bookmark_in(title, url, None)
    }

    pub fn add_bookmark_in(&self, title: &str, url: &str, folder: Option<&str>) -> Result<Bookmark> {
        let folder = bookmark_folder(folder);
        let url = web_address(url)?;
        let title = title.trim();
        let title = if title.is_empty() { url.clone() } else { title.chars().take(200).collect() };
        let now = now_utc();
        let existing: Option<(String, Option<String>)> = self
            .conn
            .query_row("SELECT id, folder FROM bookmarks WHERE url = ?1 AND deleted_at IS NULL", params![url], |r| Ok((r.get(0)?, r.get(1)?)))
            .optional()?;
        let (id, folder) = match existing {
            Some((id, folder)) => {
                self.conn.execute("UPDATE bookmarks SET title = ?2, updated_at = ?3 WHERE id = ?1", params![id, title, now])?;
                (id, folder)
            }
            None => {
                let id = new_record_id();
                let last: f64 = self.conn.query_row("SELECT COALESCE(MAX(position), 0) FROM bookmarks", [], |r| r.get(0))?;
                self.conn.execute(
                    "INSERT INTO bookmarks (id, title, url, position, created_at, updated_at, folder) VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?6)",
                    params![id, title, url, last + 1.0, now, folder],
                )?;
                (id, folder)
            }
        };
        Ok(Bookmark { id, title, url, folder })
    }

    pub fn edit_bookmark(&self, id: &str, title: &str, url: &str, folder: Option<&str>) -> Result<()> {
        let url = web_address(url)?;
        let title: String = title.trim().chars().take(200).collect();
        if title.is_empty() {
            return Err(Error::Unsuitable("A bookmark needs a name.".into()));
        }
        let duplicate: bool = self.conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM bookmarks WHERE url = ?1 AND id != ?2 AND deleted_at IS NULL)",
            params![url, id],
            |r| r.get(0),
        )?;
        if duplicate {
            return Err(Error::Unsuitable("That address is already bookmarked.".into()));
        }
        self.conn.execute(
            "UPDATE bookmarks SET title = ?2, url = ?3, folder = ?4, updated_at = ?5 WHERE id = ?1 AND deleted_at IS NULL",
            params![id, title, url, bookmark_folder(folder), now_utc()],
        )?;
        Ok(())
    }

    pub fn move_bookmark(&self, id: &str, direction: i32) -> Result<()> {
        let tx = self.conn.unchecked_transaction()?;
        let mut marks = self.bookmarks()?;
        let Some(index) = marks.iter().position(|mark| mark.id == id) else { return Ok(()) };
        let folder = &marks[index].folder;
        let neighbor = match direction {
            -1 => (0..index).rfind(|&i| &marks[i].folder == folder),
            1 => (index + 1..marks.len()).find(|&i| &marks[i].folder == folder),
            _ => None,
        };
        let Some(neighbor) = neighbor else { return Ok(()) };
        marks.swap(index, neighbor);
        let now = now_utc();
        for (position, mark) in marks.iter().enumerate() {
            tx.execute(
                "UPDATE bookmarks SET position = ?2, updated_at = ?3 WHERE id = ?1 AND position != ?2",
                params![mark.id, position as f64 + 1.0, now],
            )?;
        }
        tx.commit()?;
        Ok(())
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
    fn bookmarks_can_be_edited_and_moved_within_a_folder() {
        let (_dir, library) = open_temp_library();
        let first = library.add_bookmark_in("First", "https://first.test/", Some(" Books ")).unwrap();
        let other = library.add_bookmark("Other", "https://other.test/").unwrap();
        let last = library.add_bookmark("Last", "https://last.test/").unwrap();
        library.edit_bookmark(&last.id, "Updated", "https://updated.test/", Some("Books")).unwrap();
        library.move_bookmark(&last.id, -1).unwrap();
        let marks = library.bookmarks().unwrap();
        assert_eq!(marks.iter().map(|mark| mark.id.as_str()).collect::<Vec<_>>(), [&last.id[..], &other.id[..], &first.id[..]]);
        assert_eq!(marks[0].url, "https://updated.test/");
        assert_eq!(marks[0].folder.as_deref(), Some("Books"));
        assert!(library.edit_bookmark(&last.id, "Duplicate", &other.url, None).is_err());
    }

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

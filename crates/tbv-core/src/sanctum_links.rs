//! Sanctum's Quick Links: shortcuts to almost anything in TBV, kept apart
//! from Discover's websites and synced so every device has the same ones.
//!
//! A link's `target` says where it goes:
//! - `tbv:discover`, `tbv:bookmarks`, `tbv:downloads`, `tbv:reading` or
//!   `tbv:history`: Discover, or one of its panels;
//! - `page:<route>`: one of TBV's pages, such as `page:collections`;
//! - `book:<id>`: a book or audiobook, opened at your place;
//! - `collection:<id>`: a Compendium collection;
//! - an http or https address: a website, opened in Discover.

use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::bookmarks::web_address;
use crate::ids::new_record_id;
use crate::time::now_utc;
use crate::{Error, Library, Result};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SanctumLink {
    pub id: String,
    pub title: String,
    pub target: String,
    /// One of TBV's icons, by name; empty for the kind's own.
    pub icon: String,
}

/// The ones a library starts with, as in embre's picture. Their ids are
/// fixed, so two devices that each start with them have the same records.
const STARTERS: [(&str, &str, &str, &str); 5] = [
    ("sl:discover", "Discover", "tbv:discover", "compass"),
    ("sl:bookmarks", "Bookmarks", "tbv:bookmarks", "bookOpen"),
    ("sl:downloads", "Downloads", "tbv:downloads", "download"),
    ("sl:reading", "Reading List", "tbv:reading", "file"),
    ("sl:history", "History", "tbv:history", "clock"),
];

const PANELS: [&str; 5] = ["tbv:discover", "tbv:bookmarks", "tbv:downloads", "tbv:reading", "tbv:history"];

/// The target as kept, or why it can't be one.
fn link_target(target: &str) -> Result<String> {
    let target = target.trim();
    if PANELS.contains(&target) {
        return Ok(target.to_string());
    }
    for prefix in ["page:", "book:", "collection:"] {
        if let Some(rest) = target.strip_prefix(prefix) {
            if !rest.trim().is_empty() {
                return Ok(target.to_string());
            }
        }
    }
    web_address(target).map_err(|_| Error::Unsuitable("A Sanctum link goes to a website, a page of TBV, a book or a collection.".into()))
}

fn tidy_title(title: &str, target: &str) -> String {
    let title = title.trim();
    if title.is_empty() {
        target.to_string()
    } else {
        title.chars().take(60).collect()
    }
}

impl Library {
    /// Sanctum's links in their order. A library that never changed them
    /// shows TBV's five, kept only once one is changed, so a new device that
    /// hasn't synced yet can't bring back ones taken off elsewhere.
    pub fn sanctum_links(&self) -> Result<Vec<SanctumLink>> {
        if !self.any_sanctum_links()? {
            return Ok(STARTERS.iter().map(|(id, title, target, icon)| SanctumLink { id: id.to_string(), title: title.to_string(), target: target.to_string(), icon: icon.to_string() }).collect());
        }
        let mut statement = self.conn.prepare("SELECT id, title, target, icon FROM sanctum_links WHERE deleted_at IS NULL ORDER BY position, created_at")?;
        let rows = statement.query_map([], |r| Ok(SanctumLink { id: r.get(0)?, title: r.get(1)?, target: r.get(2)?, icon: r.get(3)? }))?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    fn any_sanctum_links(&self) -> Result<bool> {
        Ok(self.conn.query_row("SELECT EXISTS (SELECT 1 FROM sanctum_links)", [], |r| r.get(0))?)
    }

    /// Keeps the starters, before the first change to them.
    fn keep_sanctum_starters(&self) -> Result<()> {
        if self.any_sanctum_links()? {
            return Ok(());
        }
        let now = now_utc();
        for (i, (id, title, target, icon)) in STARTERS.iter().enumerate() {
            self.conn.execute(
                "INSERT OR IGNORE INTO sanctum_links (id, title, target, icon, position, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
                params![id, title, target, icon, (i + 1) as f64, now],
            )?;
        }
        Ok(())
    }

    /// Adds one at the end.
    pub fn add_sanctum_link(&self, title: &str, target: &str, icon: &str) -> Result<SanctumLink> {
        let target = link_target(target)?;
        let title = tidy_title(title, &target);
        self.keep_sanctum_starters()?;
        let id = new_record_id();
        let last: f64 = self.conn.query_row("SELECT COALESCE(MAX(position), 0) FROM sanctum_links", [], |r| r.get(0))?;
        self.conn.execute(
            "INSERT INTO sanctum_links (id, title, target, icon, position, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
            params![id, title, target, icon, last + 1.0, now_utc()],
        )?;
        Ok(SanctumLink { id, title, target, icon: icon.to_string() })
    }

    /// Changes one's name, target or icon.
    pub fn update_sanctum_link(&self, id: &str, title: &str, target: &str, icon: &str) -> Result<()> {
        let target = link_target(target)?;
        let title = tidy_title(title, &target);
        self.keep_sanctum_starters()?;
        self.conn.execute(
            "UPDATE sanctum_links SET title = ?2, target = ?3, icon = ?4, updated_at = ?5 WHERE id = ?1",
            params![id, title, target, icon, now_utc()],
        )?;
        Ok(())
    }

    /// Kept as removed, so other devices take it off too.
    pub fn remove_sanctum_link(&self, id: &str) -> Result<()> {
        self.keep_sanctum_starters()?;
        let now = now_utc();
        self.conn.execute("UPDATE sanctum_links SET deleted_at = ?2, updated_at = ?2 WHERE id = ?1", params![id, now])?;
        Ok(())
    }

    /// Moves one to a new place (zero-based) among the ones showing.
    pub fn move_sanctum_link(&self, id: &str, to: usize) -> Result<()> {
        self.keep_sanctum_starters()?;
        let mut list = self.sanctum_links()?;
        let Some(from) = list.iter().position(|l| l.id == id) else { return Ok(()) };
        let link = list.remove(from);
        list.insert(to.min(list.len()), link);
        let now = now_utc();
        for (i, l) in list.iter().enumerate() {
            let at: Option<f64> = self.conn.query_row("SELECT position FROM sanctum_links WHERE id = ?1", [&l.id], |r| r.get(0)).optional()?;
            if at != Some((i + 1) as f64) {
                self.conn.execute("UPDATE sanctum_links SET position = ?2, updated_at = ?3 WHERE id = ?1", params![l.id, (i + 1) as f64, now])?;
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use crate::library::tests::open_temp_library;

    #[test]
    fn sanctum_links_start_with_five_and_hold_pages_books_and_sites() {
        let (_dir, library) = open_temp_library();
        let start = library.sanctum_links().unwrap();
        assert_eq!(start.iter().map(|l| l.title.as_str()).collect::<Vec<_>>(), ["Discover", "Bookmarks", "Downloads", "Reading List", "History"]);
        // Discover's own links are a separate list.
        assert_eq!(library.quick_links().unwrap()[0].title, "Project Gutenberg");
        let book = library.add_sanctum_link("Dune", "book:sha256:abc", "").unwrap();
        let site = library.add_sanctum_link("", "https://standardebooks.org/", "globe").unwrap();
        assert_eq!(site.title, "https://standardebooks.org/");
        library.add_sanctum_link("Compendium", "page:collections", "layers").unwrap();
        library.move_sanctum_link(&book.id, 0).unwrap();
        library.remove_sanctum_link("sl:history").unwrap();
        let list = library.sanctum_links().unwrap();
        assert_eq!((list[0].title.as_str(), list.len()), ("Dune", 7));
        assert!(!list.iter().any(|l| l.id == "sl:history"));
        assert!(library.add_sanctum_link("Files", "file:///C:/", "").is_err());
        assert!(library.add_sanctum_link("Nothing", "book:", "").is_err());
    }
}

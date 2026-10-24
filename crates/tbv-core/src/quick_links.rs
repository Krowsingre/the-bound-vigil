//! Quick Links on Discover's start page: favourite websites, each on one of
//! TBV's gallery paintings, synced so every device has the same ones.

use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::bookmarks::web_address;
use crate::ids::new_record_id;
use crate::time::now_utc;
use crate::{Error, Library, Result};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickLink {
    pub id: String,
    pub title: String,
    pub url: String,
    /// The gallery painting behind it, by name.
    pub picture: String,
}

/// The ones a library starts with. Their ids are fixed, so two devices that
/// each start with them have the same records, not two of each.
const STARTERS: [(&str, &str, &str, &str); 6] = [
    ("ql:gutenberg", "Project Gutenberg", "https://www.gutenberg.org/", "vintage-herbarium"),
    ("ql:archive", "Internet Archive", "https://archive.org/", "ancient-halls"),
    ("ql:wikipedia", "Wikipedia", "https://www.wikipedia.org/", "snowbound-peaks"),
    ("ql:youtube", "YouTube", "https://www.youtube.com/", "alien-desert"),
    ("ql:google", "Google", "https://www.google.com/", "stormbound-harbor"),
    ("ql:reddit", "Reddit", "https://www.reddit.com/", "colossal-planet"),
];

fn link_address(url: &str) -> Result<String> {
    web_address(url).map_err(|_| Error::Unsuitable("A Quick Link needs a web address (http or https).".into()))
}

fn tidy_title(title: &str, url: &str) -> String {
    let title = title.trim();
    if title.is_empty() {
        url.to_string()
    } else {
        title.chars().take(80).collect()
    }
}

impl Library {
    /// Quick Links in their order. A library that never had any shows TBV's
    /// six, kept only once one is changed, so a new device that hasn't synced
    /// yet can't bring back ones taken off elsewhere.
    pub fn quick_links(&self) -> Result<Vec<QuickLink>> {
        if !self.any_quick_links()? {
            return Ok(STARTERS.iter().map(|(id, title, url, picture)| QuickLink { id: id.to_string(), title: title.to_string(), url: url.to_string(), picture: picture.to_string() }).collect());
        }
        let mut statement = self.conn.prepare("SELECT id, title, url, picture FROM quick_links WHERE deleted_at IS NULL ORDER BY position, created_at")?;
        let rows = statement.query_map([], |r| Ok(QuickLink { id: r.get(0)?, title: r.get(1)?, url: r.get(2)?, picture: r.get(3)? }))?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    fn any_quick_links(&self) -> Result<bool> {
        Ok(self.conn.query_row("SELECT EXISTS (SELECT 1 FROM quick_links)", [], |r| r.get(0))?)
    }

    /// Keeps the six starters, before the first change to them.
    fn keep_starters(&self) -> Result<()> {
        if self.any_quick_links()? {
            return Ok(());
        }
        let now = now_utc();
        for (i, (id, title, url, picture)) in STARTERS.iter().enumerate() {
            self.conn.execute(
                "INSERT OR IGNORE INTO quick_links (id, title, url, picture, position, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
                params![id, title, url, picture, (i + 1) as f64, now],
            )?;
        }
        Ok(())
    }

    /// Adds one at the end.
    pub fn add_quick_link(&self, title: &str, url: &str, picture: &str) -> Result<QuickLink> {
        let url = link_address(url)?;
        let title = tidy_title(title, &url);
        // The starters first, so adding one to a new library doesn't lose them.
        self.keep_starters()?;
        let id = new_record_id();
        let last: f64 = self.conn.query_row("SELECT COALESCE(MAX(position), 0) FROM quick_links", [], |r| r.get(0))?;
        self.conn.execute(
            "INSERT INTO quick_links (id, title, url, picture, position, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
            params![id, title, url, picture, last + 1.0, now_utc()],
        )?;
        Ok(QuickLink { id, title, url, picture: picture.to_string() })
    }

    /// Changes one's name, address or painting.
    pub fn update_quick_link(&self, id: &str, title: &str, url: &str, picture: &str) -> Result<()> {
        let url = link_address(url)?;
        let title = tidy_title(title, &url);
        self.keep_starters()?;
        self.conn.execute(
            "UPDATE quick_links SET title = ?2, url = ?3, picture = ?4, updated_at = ?5 WHERE id = ?1",
            params![id, title, url, picture, now_utc()],
        )?;
        Ok(())
    }

    /// Kept as removed, so other devices take it off too.
    pub fn remove_quick_link(&self, id: &str) -> Result<()> {
        self.keep_starters()?;
        let now = now_utc();
        self.conn.execute("UPDATE quick_links SET deleted_at = ?2, updated_at = ?2 WHERE id = ?1", params![id, now])?;
        Ok(())
    }

    /// Moves one to a new place (zero-based) among the ones showing.
    pub fn move_quick_link(&self, id: &str, to: usize) -> Result<()> {
        self.keep_starters()?;
        let mut list = self.quick_links()?;
        let Some(from) = list.iter().position(|l| l.id == id) else { return Ok(()) };
        let link = list.remove(from);
        list.insert(to.min(list.len()), link);
        let now = now_utc();
        for (i, l) in list.iter().enumerate() {
            let at: Option<f64> = self.conn.query_row("SELECT position FROM quick_links WHERE id = ?1", [&l.id], |r| r.get(0)).optional()?;
            if at != Some((i + 1) as f64) {
                self.conn.execute("UPDATE quick_links SET position = ?2, updated_at = ?3 WHERE id = ?1", params![l.id, (i + 1) as f64, now])?;
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use crate::library::tests::open_temp_library;

    #[test]
    fn quick_links_start_with_six_and_keep_changes() {
        let (_dir, library) = open_temp_library();
        let start = library.quick_links().unwrap();
        assert_eq!(start.len(), 6);
        // Only shown until something changes.
        assert_eq!(library.conn.query_row("SELECT COUNT(*) FROM quick_links", [], |r| r.get::<_, i64>(0)).unwrap(), 0);
        assert_eq!(start[0].title, "Project Gutenberg");
        let added = library.add_quick_link("", "https://standardebooks.org/", "silent-library").unwrap();
        assert_eq!(added.title, "https://standardebooks.org/");
        library.update_quick_link(&added.id, "Standard Ebooks", &added.url, "moonlit-towers").unwrap();
        library.move_quick_link(&added.id, 0).unwrap();
        let list = library.quick_links().unwrap();
        assert_eq!((list[0].title.as_str(), list[0].picture.as_str(), list.len()), ("Standard Ebooks", "moonlit-towers", 7));
        // Taking them all off doesn't bring the starters back.
        for l in &list {
            library.remove_quick_link(&l.id).unwrap();
        }
        assert!(library.quick_links().unwrap().is_empty());
        assert!(library.add_quick_link("Files", "file:///C:/", "").is_err());
    }
}

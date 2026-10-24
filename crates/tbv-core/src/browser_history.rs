//! Discover's history: pages visited and words searched for. Kept on every
//! device; sent to the others only when "Sync Discover history" is on
//! (Category::History). TBV's page keeps a quick copy of it to read from.

use rusqlite::params;
use serde::{Deserialize, Serialize};

use crate::bookmarks::web_address;
use crate::time::now_utc;
use crate::{Error, Library, Result};

/// The most kept; past this the oldest go.
pub const MOST_HISTORY: i64 = 5000;
/// How long a cleared visit is kept as a marker, so every device hears it was cleared.
pub const KEEP_CLEARED_DAYS: i64 = 180;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub id: String,
    /// "page" or "search".
    pub kind: String,
    pub url: String,
    pub title: Option<String>,
    /// When, as milliseconds since 1970.
    pub at: i64,
}

fn checked(entry: &HistoryEntry) -> Result<()> {
    if entry.id.is_empty() || entry.id.len() > 40 || !entry.id.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err(Error::Unsuitable("That isn't a history entry.".into()));
    }
    if entry.kind != "page" && entry.kind != "search" {
        return Err(Error::Unsuitable("That isn't a history entry.".into()));
    }
    web_address(&entry.url)?;
    Ok(())
}

impl Library {
    /// Newest first.
    pub fn browser_history(&self) -> Result<Vec<HistoryEntry>> {
        let mut statement = self
            .conn
            .prepare("SELECT id, kind, url, title, at FROM browser_history WHERE deleted_at IS NULL ORDER BY at DESC LIMIT ?1")?;
        let rows = statement.query_map(params![MOST_HISTORY], |r| {
            Ok(HistoryEntry { id: r.get(0)?, kind: r.get(1)?, url: r.get(2)?, title: r.get(3)?, at: r.get(4)? })
        })?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    /// Adds entries, or updates ones already there (a page's title arriving).
    pub fn put_browser_history(&self, entries: &[HistoryEntry]) -> Result<()> {
        let now = now_utc();
        let tx = self.conn.unchecked_transaction()?;
        for e in entries {
            checked(e)?;
            let title = e.title.as_deref().map(|t| t.chars().take(300).collect::<String>());
            tx.execute(
                "INSERT INTO browser_history (id, kind, url, title, at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                 ON CONFLICT(id) DO UPDATE SET url = excluded.url, title = excluded.title, at = excluded.at, updated_at = excluded.updated_at, deleted_at = NULL",
                params![e.id, e.kind, e.url.trim(), title, e.at, now],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    /// Kept as removed, so other devices take them off too.
    pub fn remove_browser_history(&self, ids: &[String]) -> Result<()> {
        let now = now_utc();
        let tx = self.conn.unchecked_transaction()?;
        for id in ids {
            tx.execute("UPDATE browser_history SET deleted_at = ?2, updated_at = ?2 WHERE id = ?1 AND deleted_at IS NULL", params![id, now])?;
        }
        tx.commit()?;
        Ok(())
    }

    /// Clears what's from `since` (milliseconds since 1970) on, or everything.
    pub fn clear_browser_history(&self, since: Option<i64>) -> Result<()> {
        let now = now_utc();
        self.conn.execute(
            "UPDATE browser_history SET deleted_at = ?1, updated_at = ?1 WHERE deleted_at IS NULL AND at >= ?2",
            params![now, since.unwrap_or(i64::MIN)],
        )?;
        Ok(())
    }

    /// Lets go of what's older than `before` here only: each device keeps
    /// history for as long as it was told to, so this isn't sent.
    pub fn trim_browser_history(&self, before: i64) -> Result<()> {
        use std::sync::atomic::Ordering;
        self.sync_live.store(false, Ordering::Relaxed);
        let done = (|| -> Result<()> {
            // Cleared visits stay as markers a while, so other devices still
            // hear that they were cleared even if this one syncs late.
            self.conn.execute("DELETE FROM browser_history WHERE at < ?1 AND deleted_at IS NULL", params![before])?;
            self.conn.execute(
                "DELETE FROM browser_history WHERE deleted_at IS NOT NULL AND deleted_at < ?1",
                params![(chrono::Utc::now() - chrono::Duration::days(KEEP_CLEARED_DAYS)).to_rfc3339_opts(chrono::SecondsFormat::Millis, true)],
            )?;
            // And past the most kept, the oldest.
            self.conn.execute(
                "DELETE FROM browser_history WHERE id IN (SELECT id FROM browser_history WHERE deleted_at IS NULL ORDER BY at DESC LIMIT -1 OFFSET ?1)",
                params![MOST_HISTORY],
            )?;
            self.conn.execute(
                "DELETE FROM sync_clock WHERE kind = 'browser_history' AND key NOT IN (SELECT json_array(id) FROM browser_history)",
                [],
            )?;
            Ok(())
        })();
        self.sync_live.store(true, Ordering::Relaxed);
        done
    }
}

#[cfg(test)]
mod tests {
    use super::HistoryEntry;
    use crate::library::tests::open_temp_library;

    fn entry(id: &str, at: i64) -> HistoryEntry {
        HistoryEntry { id: id.into(), kind: "page".into(), url: format!("https://example.org/{id}"), title: None, at }
    }

    #[test]
    fn history_is_kept_newest_first_and_cleared() {
        let (_dir, library) = open_temp_library();
        library.put_browser_history(&[entry("a", 1), entry("b", 3), entry("c", 2)]).unwrap();
        let ids = |l: &crate::Library| l.browser_history().unwrap().into_iter().map(|e| e.id).collect::<Vec<_>>();
        assert_eq!(ids(&library), ["b", "c", "a"]);
        library.put_browser_history(&[HistoryEntry { title: Some("Titled".into()), at: 4, ..entry("a", 4) }]).unwrap();
        assert_eq!(library.browser_history().unwrap()[0].title.as_deref(), Some("Titled"));
        library.remove_browser_history(&["b".into()]).unwrap();
        assert_eq!(ids(&library), ["a", "c"]);
        library.clear_browser_history(Some(3)).unwrap();
        assert_eq!(ids(&library), ["c"]);
        library.trim_browser_history(3).unwrap();
        assert!(ids(&library).is_empty());
        // Cleared visits stay as markers, so the clearing still reaches other devices.
        let markers: i64 = library.conn.query_row("SELECT COUNT(*) FROM browser_history WHERE deleted_at IS NOT NULL", [], |r| r.get(0)).unwrap();
        assert_eq!(markers, 2);
        assert!(library.put_browser_history(&[HistoryEntry { url: "javascript:alert(1)".into(), ..entry("d", 1) }]).is_err());
    }
}

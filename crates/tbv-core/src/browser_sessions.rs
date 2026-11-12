//! Discover's saved sessions: sets of tabs saved under a name to open again
//! later. Synced so every device has them; each remembers the device it was
//! first saved on, so the list can show them by device.

use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::bookmarks::web_address;
use crate::time::now_utc;
use crate::{Error, Library, Result};

/// The most tabs a session keeps.
const MOST_TABS: usize = 200;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionTab {
    pub url: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub pinned: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserSession {
    pub id: String,
    pub name: String,
    pub tabs: Vec<SessionTab>,
    /// Which tab was showing.
    #[serde(default)]
    pub active: i64,
    /// The device it was first saved on, and its name when that's another
    /// device (none for this one). Not taken from TBV's page.
    #[serde(default, skip_deserializing)]
    pub device_id: String,
    #[serde(default, skip_deserializing, skip_serializing_if = "Option::is_none")]
    pub device: Option<String>,
    /// When it was last saved.
    #[serde(default, skip_deserializing)]
    pub updated_at: String,
}

fn checked(session: &BrowserSession) -> Result<(String, Vec<SessionTab>)> {
    let not = || Error::Unsuitable("That isn't a Discover session.".into());
    if session.id.is_empty() || session.id.len() > 40 || !session.id.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err(not());
    }
    let name: String = session.name.trim().chars().take(120).collect();
    if name.is_empty() {
        return Err(Error::Unsuitable("A session needs a name.".into()));
    }
    let mut tabs = Vec::new();
    for tab in session.tabs.iter().take(MOST_TABS) {
        let url = if tab.url.trim() == "tbv:start" { "tbv:start".to_string() } else { web_address(&tab.url)? };
        tabs.push(SessionTab { url, title: tab.title.as_deref().map(|t| t.chars().take(300).collect()), pinned: tab.pinned });
    }
    if tabs.is_empty() {
        return Err(not());
    }
    Ok((name, tabs))
}

impl Library {
    /// Every saved session, oldest first.
    pub fn browser_sessions(&self) -> Result<Vec<BrowserSession>> {
        let here = self.device_id()?;
        let mut statement = self.conn.prepare(
            "SELECT s.id, s.name, s.tabs, s.active, COALESCE(s.device_id, ''), d.name, s.updated_at
             FROM browser_sessions s LEFT JOIN devices d ON d.device_id = s.device_id
             WHERE s.deleted_at IS NULL ORDER BY s.created_at, s.id",
        )?;
        let rows = statement.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, i64>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, Option<String>>(5)?,
                r.get::<_, String>(6)?,
            ))
        })?;
        let mut out = Vec::new();
        for row in rows {
            let (id, name, tabs, active, device_id, device_name, updated_at) = row?;
            let tabs: Vec<SessionTab> = serde_json::from_str(&tabs).unwrap_or_default();
            if tabs.is_empty() {
                continue;
            }
            // Sessions saved before devices were noted count as this device's.
            let device_id = if device_id.is_empty() { here.clone() } else { device_id };
            let device = (device_id != here).then(|| device_name.unwrap_or_else(|| "Another device".into()));
            out.push(BrowserSession { id, name, tabs, active, device_id, device, updated_at });
        }
        Ok(out)
    }

    /// Saves a session, or saves over one with the same id. One saved over
    /// stays listed under the device it was first saved on.
    pub fn put_browser_session(&self, session: &BrowserSession) -> Result<()> {
        let (name, tabs) = checked(session)?;
        let active = session.active.clamp(0, tabs.len() as i64 - 1);
        let tabs = serde_json::to_string(&tabs)?;
        let now = now_utc();
        let existing: Option<String> =
            self.conn.query_row("SELECT id FROM browser_sessions WHERE id = ?1", params![session.id], |r| r.get(0)).optional()?;
        if existing.is_some() {
            self.conn.execute(
                "UPDATE browser_sessions SET name = ?2, tabs = ?3, active = ?4, updated_at = ?5, deleted_at = NULL WHERE id = ?1",
                params![session.id, name, tabs, active, now],
            )?;
        } else {
            self.conn.execute(
                "INSERT INTO browser_sessions (id, name, tabs, active, device_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
                params![session.id, name, tabs, active, self.device_id()?, now],
            )?;
        }
        Ok(())
    }

    pub fn remove_browser_session(&self, id: &str) -> Result<()> {
        let now = now_utc();
        self.conn.execute(
            "UPDATE browser_sessions SET deleted_at = ?2, updated_at = ?2 WHERE id = ?1 AND deleted_at IS NULL",
            params![id, now],
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::library::tests::open_temp_library;

    fn session(id: &str, name: &str, urls: &[&str]) -> BrowserSession {
        BrowserSession {
            id: id.into(),
            name: name.into(),
            tabs: urls.iter().map(|u| SessionTab { url: (*u).into(), title: None, pinned: false }).collect(),
            active: 0,
            device_id: String::new(),
            device: None,
            updated_at: String::new(),
        }
    }

    #[test]
    fn sessions_are_saved_over_and_say_which_device_they_are_from() {
        let (_dir, library) = open_temp_library();
        library.put_browser_session(&session("a", " Work ", &["https://example.org/", "tbv:start"])).unwrap();
        let got = library.browser_sessions().unwrap();
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].name, "Work");
        assert_eq!(got[0].device, None);

        // Saving over keeps it under the device it was first saved on.
        library.conn.execute("INSERT INTO devices (device_id, name, kind, updated_at) VALUES ('other', 'Phone', 'phone', 'x')", []).unwrap();
        library.conn.execute("UPDATE browser_sessions SET device_id = 'other'", []).unwrap();
        library.put_browser_session(&session("a", "Work", &["https://example.com/"])).unwrap();
        let got = library.browser_sessions().unwrap();
        assert_eq!(got[0].device.as_deref(), Some("Phone"));
        assert_eq!(got[0].tabs.len(), 1);
        assert_eq!(got[0].tabs[0].url, "https://example.com/");

        library.remove_browser_session("a").unwrap();
        assert!(library.browser_sessions().unwrap().is_empty());
        // Only web pages and the start page.
        assert!(library.put_browser_session(&session("b", "Bad", &["javascript:alert(1)"])).is_err());
        assert!(library.put_browser_session(&session("c", "", &["https://example.org/"])).is_err());
    }
}

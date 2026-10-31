//! Where each book is downloaded. Every device notes which books it has the
//! file of, and which ones it knows its sync places hold, in `book_holders`;
//! those rows travel like any other change, so each device can say where a
//! book is (Book details), and tidying keeps what a phone has.
//!
//! A phone also keeps two lists of its own: books it fetched just to open
//! them (`phone_visits`), removed again after a while unless kept, and covers
//! it fetched when they were shown (`cover_cache`), the oldest let go once
//! they take up more than a set size.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;
use std::sync::Mutex;

use rusqlite::{params, OptionalExtension};
use serde::Serialize;

use super::{fetch, Lane, Provider, Remote};
use crate::error::{Error, Result};
use crate::ids::book_id_hex;
use crate::library::Library;
use crate::time::now_utc;

/// How much room covers fetched on a phone may take: about 200 MB.
pub const COVER_CACHE_BYTES: u64 = 200 * 1024 * 1024;

/// Whether this device fetches covers only when they're shown, rather than
/// every cover at each sync: a phone, where room is short.
pub fn covers_on_view() -> bool {
    cfg!(any(target_os = "ios", target_os = "android"))
}

/// What kind of device this is, as other devices list it.
pub fn device_kind() -> &'static str {
    if cfg!(any(target_os = "ios", target_os = "android")) {
        "phone"
    } else {
        "computer"
    }
}

/// A place a book's file is.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookLocation {
    /// "Embre's iPhone", "iCloud Drive".
    pub name: String,
    /// "computer", "phone" or "place" (a sync place).
    pub kind: String,
    /// This device.
    pub here: bool,
    /// Fetched here only to open it, so removed again after a while unless kept.
    pub temporary: bool,
}

/// A sync place as `book_holders` names it, with its name for people.
fn place_of(provider: &Provider) -> Option<(String, String)> {
    let (key, name) = match provider {
        Provider::Supabase => ("supabase".to_string(), "Supabase".to_string()),
        Provider::Folder { service, .. } => {
            let name = match service.as_str() {
                "icloud" => "iCloud Drive",
                "dropbox" => "Dropbox",
                "gdrive" | "google" => "Google Drive",
                "onedrive" => "OneDrive",
                "mega" => "MEGA",
                _ => "Your synced folder",
            };
            (service.clone(), name.to_string())
        }
        Provider::WebDav(_) => ("webdav".to_string(), "Your WebDAV server".to_string()),
        Provider::Cloud(account) => {
            let key = account.service.key();
            let name = match key {
                "dropbox" => "Dropbox",
                "google" => "Google Drive",
                _ => "OneDrive",
            };
            // The same service as a synced folder of it.
            (if key == "google" { "gdrive".to_string() } else { key.to_string() }, name.to_string())
        }
        Provider::Off => return None,
    };
    Some((format!("place:{key}"), name))
}

impl Library {
    /// This device's sync places, with the place each one is.
    fn places(&self) -> Result<Vec<(Lane, String, String)>> {
        let mut out = Vec::new();
        for (lane, provider) in [(Lane::Main, Some(self.sync_provider()?)), (Lane::Also, self.sync_also()?)] {
            if let Some((id, name)) = provider.as_ref().and_then(place_of) {
                out.push((lane, id, name));
            }
        }
        Ok(out)
    }

    fn name_holder(&self, id: &str, name: &str, kind: &str) -> Result<()> {
        self.conn.execute(
            "INSERT INTO devices (device_id, name, kind, updated_at) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT (device_id) DO UPDATE SET name = excluded.name, kind = excluded.kind, updated_at = excluded.updated_at
             WHERE name != excluded.name OR kind != excluded.kind",
            params![id, name, kind, now_utc()],
        )?;
        Ok(())
    }

    /// Notes which books this device has the file of, and which ones its
    /// sync places are known to hold, for the other devices. Only rows that
    /// changed are written, so syncing sends just those. A place is only
    /// ever marked as holding a book here: it's marked as not holding one
    /// when tidying takes the copy away (`place_dropped`), since another
    /// device may have sent it there.
    pub fn note_book_holdings(&self) -> Result<()> {
        let me = self.device_id()?;
        self.name_holder(&me, &self.device_name()?, device_kind())?;
        let files: Vec<(String, String)> = self
            .conn
            .prepare(
                "SELECT lf.book_id, lf.path FROM local_files lf JOIN books b ON b.id = lf.book_id
                 WHERE lf.path IS NOT NULL AND b.deleted_at IS NULL",
            )?
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<rusqlite::Result<_>>()?;
        let here: HashSet<String> = files.into_iter().filter(|(_, path)| Path::new(path).exists()).map(|(id, _)| id).collect();
        let before: HashMap<String, bool> = self
            .conn
            .prepare("SELECT book_id, held FROM book_holders WHERE device_id = ?1")?
            .query_map(params![me], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<rusqlite::Result<_>>()?;
        let now = now_utc();
        let tx = self.conn.unchecked_transaction()?;
        for id in here.iter().filter(|id| before.get(*id) != Some(&true)) {
            tx.execute(
                "INSERT INTO book_holders (device_id, book_id, held, updated_at) VALUES (?1, ?2, 1, ?3)
                 ON CONFLICT (device_id, book_id) DO UPDATE SET held = 1, updated_at = excluded.updated_at",
                params![me, id, now],
            )?;
        }
        for (id, _) in before.iter().filter(|(id, held)| **held && !here.contains(*id)) {
            tx.execute("UPDATE book_holders SET held = 0, updated_at = ?3 WHERE device_id = ?1 AND book_id = ?2", params![me, id, now])?;
        }
        tx.commit()?;
        for (lane, id, name) in self.places()? {
            self.conn.execute(
                &format!(
                    "INSERT INTO book_holders (device_id, book_id, held, updated_at)
                     SELECT ?1, b.id, 1, ?2 FROM books b
                     WHERE b.deleted_at IS NULL AND EXISTS (SELECT 1 FROM {} sf WHERE sf.uploaded_at IS NOT NULL
                       AND sf.path = 'books/' || substr(b.id, 8) || '.' || b.format)
                     ON CONFLICT (device_id, book_id) DO UPDATE SET held = 1, updated_at = excluded.updated_at WHERE held != 1",
                    lane.files_table()
                ),
                params![id, now],
            )?;
            // A place is named once it's known to hold something.
            let holds: bool = self.conn.query_row("SELECT EXISTS (SELECT 1 FROM book_holders WHERE device_id = ?1)", params![id], |r| r.get(0))?;
            if holds {
                self.name_holder(&id, &name, "place")?;
            }
        }
        Ok(())
    }

    /// Tidying took these copies out of the place synced as `lane`.
    pub(crate) fn place_dropped(&self, paths: &[String], lane: Lane) -> Result<()> {
        let Some((_, id, _)) = self.places()?.into_iter().find(|(l, ..)| *l == lane) else { return Ok(()) };
        let now = now_utc();
        for path in paths.iter().filter(|p| p.starts_with("books/")) {
            self.conn.execute(
                "UPDATE book_holders SET held = 0, updated_at = ?3 WHERE device_id = ?1 AND held = 1
                 AND book_id IN (SELECT id FROM books WHERE 'books/' || substr(id, 8) || '.' || format = ?2)",
                params![id, path, now],
            )?;
        }
        Ok(())
    }

    /// The hashes of books a phone has downloaded.
    pub(crate) fn books_on_phones(&self) -> Result<HashSet<String>> {
        Ok(self
            .conn
            .prepare(
                "SELECT h.book_id FROM book_holders h JOIN devices d ON d.device_id = h.device_id
                 WHERE h.held = 1 AND d.kind = 'phone'",
            )?
            .query_map([], |r| r.get::<_, String>(0))?
            .map(|id| id.map(|id| book_id_hex(&id).to_string()))
            .collect::<rusqlite::Result<_>>()?)
    }

    /// Everywhere a book's file is, this device first, then other devices,
    /// then sync places.
    pub fn book_locations(&self, book_id: &str) -> Result<Vec<BookLocation>> {
        let me = self.device_id()?;
        let mut out = Vec::new();
        if self.has_local_file(&book_id.to_string())? {
            let temporary: bool = self.conn.query_row("SELECT EXISTS (SELECT 1 FROM phone_visits WHERE book_id = ?1)", params![book_id], |r| r.get(0))?;
            out.push(BookLocation { name: self.device_name()?, kind: device_kind().into(), here: true, temporary });
        }
        let others: Vec<(String, String)> = self
            .conn
            .prepare(
                "SELECT d.name, d.kind FROM book_holders h JOIN devices d ON d.device_id = h.device_id
                 WHERE h.book_id = ?1 AND h.held = 1 AND h.device_id != ?2
                 ORDER BY d.kind = 'place', d.name COLLATE NOCASE",
            )?
            .query_map(params![book_id, me], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<rusqlite::Result<_>>()?;
        for (name, kind) in others {
            out.push(BookLocation { name, kind, here: false, temporary: false });
        }
        // What this device knows of its own places, before any row says so.
        if let Some(path) = self.cloud_book_path(book_id)? {
            for (lane, _, name) in self.places()? {
                let sent: bool = self.conn.query_row(
                    &format!("SELECT EXISTS (SELECT 1 FROM {} WHERE path = ?1 AND uploaded_at IS NOT NULL)", lane.files_table()),
                    params![path],
                    |r| r.get(0),
                )?;
                if sent && !out.iter().any(|l| l.kind == "place" && l.name == name) {
                    out.push(BookLocation { name, kind: "place".into(), here: false, temporary: false });
                }
            }
        }
        Ok(out)
    }

    /// The cover this device has for a book, if any.
    pub fn cover_here(&self, book_id: &str) -> Result<Option<String>> {
        self.cover_of(&book_id.to_string())
    }

    /// This phone fetched a book just to open it.
    pub fn note_visit(&self, book_id: &str) -> Result<()> {
        self.conn.execute(
            "INSERT INTO phone_visits (book_id, fetched_at) VALUES (?1, ?2) ON CONFLICT (book_id) DO NOTHING",
            params![book_id, now_utc()],
        )?;
        Ok(())
    }

    /// Keeps a downloaded book on this device for good, or lets it be
    /// removed again after a while like a book fetched just to open it.
    pub fn keep_download(&self, book_id: &str, keep: bool) -> Result<()> {
        if keep {
            self.conn.execute("DELETE FROM phone_visits WHERE book_id = ?1", params![book_id])?;
            Ok(())
        } else {
            self.note_visit(book_id)
        }
    }

    /// Removes the books this phone fetched just to open, once they've gone
    /// unopened for `days`. Their files stay in the cloud. Returns how many.
    pub fn drop_old_visits(&self, days: u32) -> Result<u32> {
        let cutoff = (chrono::Utc::now() - chrono::Duration::days(days.into())).to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let old: Vec<String> = self
            .conn
            .prepare(
                "SELECT v.book_id FROM phone_visits v LEFT JOIN books b ON b.id = v.book_id
                 WHERE MAX(v.fetched_at, COALESCE(b.last_opened_at, '')) < ?1",
            )?
            .query_map(params![cutoff], |r| r.get(0))?
            .collect::<rusqlite::Result<_>>()?;
        let mut dropped = 0;
        for book_id in old {
            // One whose cloud copy isn't known stays; the rest go.
            if self.remove_download(&book_id).is_ok() {
                dropped += 1;
            }
            self.conn.execute("DELETE FROM phone_visits WHERE book_id = ?1", params![book_id])?;
        }
        Ok(dropped)
    }

    /// A cover fetched when it was shown, kept until covers fill their room.
    pub(crate) fn cover_cached(&self, book_id: &str, bytes: u64) -> Result<()> {
        self.conn.execute(
            "INSERT OR REPLACE INTO cover_cache (book_id, bytes, fetched_at) VALUES (?1, ?2, ?3)",
            params![book_id, bytes as i64, now_utc()],
        )?;
        Ok(())
    }

    /// Lets the oldest fetched covers go until they fit in `limit` bytes.
    /// They come back when they're shown again.
    pub(crate) fn trim_cover_cache(&self, limit: u64) -> Result<u32> {
        let cached: Vec<(String, i64)> = self
            .conn
            .prepare("SELECT book_id, bytes FROM cover_cache ORDER BY fetched_at DESC")?
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<rusqlite::Result<_>>()?;
        let mut total = 0u64;
        let mut dropped = 0;
        for (book_id, bytes) in cached {
            total += bytes.max(0) as u64;
            if total <= limit {
                continue;
            }
            let cover: Option<String> =
                self.conn.query_row("SELECT cover_path FROM local_files WHERE book_id = ?1", params![book_id], |r| r.get(0)).optional()?.flatten();
            if let Some(cover) = cover {
                let _ = fs::remove_file(cover);
            }
            self.conn.execute("UPDATE local_files SET cover_path = NULL WHERE book_id = ?1", params![book_id])?;
            self.conn.execute("DELETE FROM cover_cache WHERE book_id = ?1", params![book_id])?;
            dropped += 1;
        }
        Ok(dropped)
    }

    /// Once, on a phone: counts the covers it already copied from the cloud
    /// as fetched, so they share the room with the rest. A cover only this
    /// phone has (a book added on it, not sent yet) is never counted.
    pub fn adopt_cover_cache(&self) -> Result<()> {
        const DONE: &str = "covers.cache_adopted";
        if self.setting(DONE)?.is_some() {
            return Ok(());
        }
        let rows: Vec<(String, String)> = self
            .conn
            .prepare(
                "SELECT lf.book_id, lf.cover_path FROM local_files lf
                 WHERE lf.cover_path IS NOT NULL
                   AND NOT EXISTS (SELECT 1 FROM cover_cache c WHERE c.book_id = lf.book_id)
                   AND EXISTS (SELECT 1 FROM (SELECT path, uploaded_at FROM sync_files UNION ALL SELECT path, uploaded_at FROM sync_files_also) sf
                     WHERE sf.uploaded_at IS NOT NULL AND sf.path LIKE 'covers/' || substr(lf.book_id, 8) || '.%')",
            )?
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<rusqlite::Result<_>>()?;
        for (book_id, cover) in rows {
            let Ok(meta) = fs::metadata(&cover) else { continue };
            let at = meta.modified().ok().map(|m| chrono::DateTime::<chrono::Utc>::from(m).to_rfc3339_opts(chrono::SecondsFormat::Millis, true)).unwrap_or_else(now_utc);
            self.conn.execute(
                "INSERT OR IGNORE INTO cover_cache (book_id, bytes, fetched_at) VALUES (?1, ?2, ?3)",
                params![book_id, meta.len() as i64, at],
            )?;
        }
        self.trim_cover_cache(COVER_CACHE_BYTES)?;
        self.put_setting(DONE, Some("1"))
    }
}

impl Library {
    /// On a phone, a cover another device replaced is let go, to come down
    /// afresh when it's next shown.
    pub(crate) fn drop_stale_covers(&self) -> Result<()> {
        for (_, book_id, cover) in self.stale_covers()? {
            let _ = fs::remove_file(cover);
            self.conn.execute("UPDATE local_files SET cover_path = NULL WHERE book_id = ?1", params![book_id])?;
            self.conn.execute("DELETE FROM cover_cache WHERE book_id = ?1", params![book_id])?;
            self.cover_stale(&book_id, false)?;
        }
        Ok(())
    }
}

/// Fetches a book's cover from the place synced as `lane` because it's
/// being shown, and keeps it with the other covers fetched that way.
/// `in_cloud` is what's in the place's covers/ folder. None if the place
/// hasn't got one.
pub fn cover_on_view(library: &Mutex<Library>, remote: &mut dyn Remote, lane: Lane, in_cloud: &[String], book_id: &str) -> Result<Option<String>> {
    let lock = || library.lock().map_err(|_| Error::Unsuitable("the library is unavailable".into()));
    let dir = {
        let library = lock()?;
        if let Some(cover) = library.cover_of(&book_id.to_string())? {
            return Ok(Some(cover));
        }
        library.paths.covers_dir.clone()
    };
    let hex = book_id_hex(book_id);
    let Some(name) = in_cloud.iter().find(|n| Path::new(n).file_stem().is_some_and(|s| s == hex)) else { return Ok(None) };
    let path = format!("covers/{name}");
    let local = dir.join(name);
    if !fetch(remote, &path, &local)? {
        return Ok(None);
    }
    let bytes = fs::metadata(&local).map(|m| m.len()).unwrap_or(0);
    let library = lock()?;
    library.lane_file_sent(&path, None, lane)?;
    library.set_cover(book_id, &local)?;
    library.cover_cached(book_id, bytes)?;
    library.trim_cover_cache(COVER_CACHE_BYTES)?;
    Ok(Some(local.display().to_string()))
}

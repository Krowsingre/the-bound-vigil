//! Websites saved in Discover, synced so every device has them. Bookmarks
//! live in folders, and folders can hold folders.
//!
//! Older TBVs only knew a folder as a name on each bookmark (`folder`). That
//! name is still written (the folder's own name), and a bookmark that has a
//! name but no folder yet is put in a folder of that name when read, so
//! bookmarks saved on an older device find their place too.

use std::collections::{HashMap, HashSet};

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
    /// The folder's name, for older TBVs and for showing.
    pub folder: Option<String>,
    pub folder_id: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BookmarkFolder {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub created_at: String,
}

/// Where something was before a change, so the change can be undone.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BookmarkPlace {
    pub id: String,
    pub folder: bool,
    pub parent_id: Option<String>,
    pub position: f64,
}

/// What a change did, handed back so Undo can put it back.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BookmarkUndo {
    pub places: Vec<BookmarkPlace>,
    pub removed_bookmarks: Vec<String>,
    pub removed_folders: Vec<String>,
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

fn folder_name(name: &str) -> Result<String> {
    let name: String = name.trim().chars().take(120).collect();
    if name.is_empty() {
        return Err(Error::Unsuitable("A folder needs a name.".into()));
    }
    Ok(name)
}

/// The same name gives the same folder on every device, so two devices
/// tidying the same old names don't make two folders.
fn label_folder_id(name: &str) -> String {
    format!("label:{}", name.to_lowercase())
}

/// Live folders: id → (name, parent). A parent that's gone, or a loop of
/// folders inside each other (two devices moving at once), is treated as
/// the top level.
fn tidy_parents(raw: &HashMap<String, (String, Option<String>)>) -> HashMap<String, Option<String>> {
    let mut parents = HashMap::new();
    for (id, (_, parent)) in raw {
        let mut seen = HashSet::from([id.as_str()]);
        let mut at = parent.as_deref();
        let mut good = true;
        while let Some(p) = at {
            if !raw.contains_key(p) {
                break;
            }
            if !seen.insert(p) {
                good = false;
                break;
            }
            at = raw[p].1.as_deref();
        }
        let parent = parent.clone().filter(|p| good && raw.contains_key(p));
        parents.insert(id.clone(), parent);
    }
    parents
}

/// A live folder: id, name, when it was made.
type FolderRow = (String, String, String);
/// Each folder's folder (none = the top level).
type Parents = HashMap<String, Option<String>>;

impl Library {
    /// Puts bookmarks that only carry a folder name (from an older TBV, or
    /// from before folders were real) into a folder of that name.
    fn adopt_bookmark_labels(&self) -> Result<()> {
        let names: Vec<String> = self
            .conn
            .prepare("SELECT DISTINCT folder FROM bookmarks WHERE deleted_at IS NULL AND folder_id IS NULL AND trim(COALESCE(folder, '')) != ''")?
            .query_map([], |r| r.get(0))?
            .collect::<rusqlite::Result<_>>()?;
        if names.is_empty() {
            return Ok(());
        }
        // No transaction of its own: this can run inside another change's.
        let tx = &self.conn;
        let now = now_utc();
        for label in names {
            let name = folder_name(&label)?;
            let existing: Option<String> = tx
                .query_row(
                    "SELECT id FROM bookmark_folders WHERE deleted_at IS NULL AND parent_id IS NULL AND tbv_fold(name) = tbv_fold(?1) ORDER BY position, created_at, id LIMIT 1",
                    params![name],
                    |r| r.get(0),
                )
                .optional()?;
            let id = match existing {
                Some(id) => id,
                None => {
                    // The usual id, unless a folder already has it (renamed or
                    // moved since): then that folder is left alone.
                    let usual = label_folder_id(&name);
                    let taken: bool = tx.query_row(
                        "SELECT EXISTS(SELECT 1 FROM bookmark_folders WHERE id = ?1 AND deleted_at IS NULL)",
                        params![usual],
                        |r| r.get(0),
                    )?;
                    let id = if taken { new_record_id() } else { usual };
                    let last: f64 = tx.query_row("SELECT COALESCE(MAX(position), 0) FROM bookmark_folders WHERE parent_id IS NULL", [], |r| r.get(0))?;
                    tx.execute(
                        "INSERT INTO bookmark_folders (id, name, parent_id, position, created_at, updated_at) VALUES (?1, ?2, NULL, ?3, ?4, ?4)
                         ON CONFLICT(id) DO UPDATE SET name = excluded.name, parent_id = NULL, deleted_at = NULL, updated_at = excluded.updated_at",
                        params![id, name, last + 1.0, now],
                    )?;
                    id
                }
            };
            tx.execute(
                "UPDATE bookmarks SET folder_id = ?1, folder = ?2 WHERE folder = ?3 AND folder_id IS NULL AND deleted_at IS NULL",
                params![id, name, label],
            )?;
        }
        Ok(())
    }

    fn live_folders(&self) -> Result<(Vec<FolderRow>, Parents)> {
        let mut statement = self
            .conn
            .prepare("SELECT id, name, parent_id, created_at FROM bookmark_folders WHERE deleted_at IS NULL ORDER BY position, created_at, id")?;
        let rows: Vec<(String, String, Option<String>, String)> =
            statement.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?.collect::<rusqlite::Result<_>>()?;
        let raw: HashMap<String, (String, Option<String>)> = rows.iter().map(|(id, name, parent, _)| (id.clone(), (name.clone(), parent.clone()))).collect();
        let parents = tidy_parents(&raw);
        Ok((rows.into_iter().map(|(id, name, _, created)| (id, name, created)).collect(), parents))
    }

    /// Folders in their order, each with the folder it's in (none = top level).
    pub fn bookmark_folders(&self) -> Result<Vec<BookmarkFolder>> {
        self.adopt_bookmark_labels()?;
        let (rows, parents) = self.live_folders()?;
        Ok(rows
            .into_iter()
            .map(|(id, name, created_at)| BookmarkFolder { parent_id: parents[&id].clone(), id, name, created_at })
            .collect())
    }

    /// Bookmarks in the order they were saved (or put in).
    pub fn bookmarks(&self) -> Result<Vec<Bookmark>> {
        self.adopt_bookmark_labels()?;
        let (folders, _) = self.live_folders()?;
        let names: HashMap<String, String> = folders.into_iter().map(|(id, name, _)| (id, name)).collect();
        let mut statement = self
            .conn
            .prepare("SELECT id, title, url, folder_id, created_at FROM bookmarks WHERE deleted_at IS NULL ORDER BY position, created_at, id")?;
        let rows = statement.query_map([], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, Option<String>>(3)?, r.get::<_, String>(4)?))
        })?;
        let mut marks = Vec::new();
        for row in rows {
            let (id, title, url, folder_id, created_at) = row?;
            // A folder another device took away shows its bookmarks at the top level.
            let folder_id = folder_id.filter(|f| names.contains_key(f));
            let folder = folder_id.as_ref().map(|f| names[f].clone());
            marks.push(Bookmark { id, title, url, folder, folder_id, created_at });
        }
        Ok(marks)
    }

    fn live_folder(&self, id: Option<&str>) -> Result<Option<(String, String)>> {
        let Some(id) = id.filter(|id| !id.is_empty()) else { return Ok(None) };
        let name: Option<String> = self
            .conn
            .query_row("SELECT name FROM bookmark_folders WHERE id = ?1 AND deleted_at IS NULL", params![id], |r| r.get(0))
            .optional()?;
        match name {
            Some(name) => Ok(Some((id.to_string(), name))),
            None => Err(Error::Unsuitable("That folder isn't there any more.".into())),
        }
    }

    fn next_bookmark_position(&self, folder: Option<&str>) -> Result<f64> {
        Ok(self.conn.query_row(
            "SELECT COALESCE(MAX(position), 0) + 1 FROM bookmarks WHERE deleted_at IS NULL AND folder_id IS ?1",
            params![folder],
            |r| r.get(0),
        )?)
    }

    /// Saves a page at the end of the top level.
    pub fn add_bookmark(&self, title: &str, url: &str) -> Result<Bookmark> {
        self.add_bookmark_to(title, url, None)
    }

    /// Saves a page at the end of a folder. Saving one that's there already
    /// renames it, and moves it into the folder when one is given.
    pub fn add_bookmark_to(&self, title: &str, url: &str, folder_id: Option<&str>) -> Result<Bookmark> {
        let folder = self.live_folder(folder_id)?;
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
                if folder.is_some() {
                    self.move_bookmarks(std::slice::from_ref(&id), folder_id, None)?;
                }
                id
            }
            None => {
                let id = new_record_id();
                let (folder_id, name) = folder.unzip();
                self.conn.execute(
                    "INSERT INTO bookmarks (id, title, url, position, created_at, updated_at, folder, folder_id) VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?6, ?7)",
                    params![id, title, url, self.next_bookmark_position(folder_id.as_deref())?, now, name, folder_id],
                )?;
                id
            }
        };
        self.bookmarks()?
            .into_iter()
            .find(|mark| mark.id == id)
            .ok_or_else(|| Error::Unsuitable("That bookmark couldn't be saved.".into()))
    }

    pub fn edit_bookmark(&self, id: &str, title: &str, url: &str, folder_id: Option<&str>) -> Result<()> {
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
        let folder = self.live_folder(folder_id)?;
        let now_in: Option<String> = self.conn.query_row("SELECT folder_id FROM bookmarks WHERE id = ?1", params![id], |r| r.get(0)).optional()?.flatten();
        self.conn.execute(
            "UPDATE bookmarks SET title = ?2, url = ?3, updated_at = ?4 WHERE id = ?1 AND deleted_at IS NULL",
            params![id, title, url, now_utc()],
        )?;
        if now_in.as_deref() != folder.as_ref().map(|(f, _)| f.as_str()) {
            self.move_bookmarks(&[id.to_string()], folder_id, None)?;
        }
        Ok(())
    }

    /// The bookmarks in a folder (none = the top level), in order.
    fn marks_in(&self, folder: Option<&str>) -> Result<Vec<Bookmark>> {
        Ok(self.bookmarks()?.into_iter().filter(|m| m.folder_id.as_deref() == folder).collect())
    }

    fn folders_in(&self, parent: Option<&str>) -> Result<Vec<BookmarkFolder>> {
        Ok(self.bookmark_folders()?.into_iter().filter(|f| f.parent_id.as_deref() == parent).collect())
    }

    /// Where everything in these folders is now, for Undo.
    fn places_in(&self, parents: &[Option<String>]) -> Result<Vec<BookmarkPlace>> {
        let mut places = Vec::new();
        let mut seen = HashSet::new();
        for parent in parents {
            if !seen.insert(parent.clone()) {
                continue;
            }
            let p = parent.as_deref();
            let position = |table: &str, id: &str| -> Result<f64> {
                Ok(self.conn.query_row(&format!("SELECT position FROM {table} WHERE id = ?1"), params![id], |r| r.get(0))?)
            };
            for f in self.folders_in(p)? {
                places.push(BookmarkPlace { position: position("bookmark_folders", &f.id)?, id: f.id, folder: true, parent_id: parent.clone() });
            }
            for m in self.marks_in(p)? {
                places.push(BookmarkPlace { position: position("bookmarks", &m.id)?, id: m.id, folder: false, parent_id: parent.clone() });
            }
        }
        Ok(places)
    }

    /// Writes an order: each item's folder and a position counting up.
    fn place_in_order(&self, parent: Option<&str>, name: Option<&str>, marks: &[String], folders: &[String]) -> Result<()> {
        let now = now_utc();
        for (i, id) in marks.iter().enumerate() {
            self.conn.execute(
                "UPDATE bookmarks SET folder_id = ?2, folder = ?3, position = ?4, updated_at = ?5
                 WHERE id = ?1 AND (folder_id IS NOT ?2 OR folder IS NOT ?3 OR position != ?4)",
                params![id, parent, name, i as f64 + 1.0, now],
            )?;
        }
        for (i, id) in folders.iter().enumerate() {
            self.conn.execute(
                "UPDATE bookmark_folders SET parent_id = ?2, position = ?3, updated_at = ?4 WHERE id = ?1 AND (parent_id IS NOT ?2 OR position != ?3)",
                params![id, parent, i as f64 + 1.0, now],
            )?;
        }
        Ok(())
    }

    /// Moves bookmarks into a folder (none = the top level), before another
    /// bookmark there or at the end, keeping the order they were in.
    pub fn move_bookmarks(&self, ids: &[String], folder_id: Option<&str>, before: Option<&str>) -> Result<BookmarkUndo> {
        let folder = self.live_folder(folder_id)?;
        let target = folder.as_ref().map(|(id, _)| id.clone());
        let all = self.bookmarks()?;
        let moving: HashSet<&str> = ids.iter().map(String::as_str).collect();
        let moved: Vec<&Bookmark> = all.iter().filter(|m| moving.contains(m.id.as_str())).collect();
        if moved.is_empty() {
            return Ok(BookmarkUndo::default());
        }
        let mut parents: Vec<Option<String>> = moved.iter().map(|m| m.folder_id.clone()).collect();
        parents.push(target.clone());
        let undo = BookmarkUndo { places: self.places_in(&parents)?, ..Default::default() };
        let tx = self.conn.unchecked_transaction()?;
        let mut order: Vec<String> = all.iter().filter(|m| m.folder_id == target && !moving.contains(m.id.as_str())).map(|m| m.id.clone()).collect();
        let at = before.and_then(|b| order.iter().position(|id| id == b)).unwrap_or(order.len());
        order.splice(at..at, moved.iter().map(|m| m.id.clone()));
        self.place_in_order(target.as_deref(), folder.as_ref().map(|(_, n)| n.as_str()), &order, &[])?;
        tx.commit()?;
        Ok(undo)
    }

    /// Moves a bookmark one place up (-1) or down (1) within its folder.
    pub fn move_bookmark(&self, id: &str, direction: i32) -> Result<()> {
        let Some(mark) = self.bookmarks()?.into_iter().find(|m| m.id == id) else { return Ok(()) };
        let marks = self.marks_in(mark.folder_id.as_deref())?;
        let Some(index) = marks.iter().position(|m| m.id == id) else { return Ok(()) };
        let before = match direction {
            -1 if index > 0 => Some(marks[index - 1].id.clone()),
            1 if index + 2 < marks.len() => Some(marks[index + 2].id.clone()),
            1 if index + 1 < marks.len() => None,
            _ => return Ok(()),
        };
        self.move_bookmarks(&[id.to_string()], mark.folder_id.as_deref(), before.as_deref())?;
        Ok(())
    }

    pub fn create_bookmark_folder(&self, name: &str, parent_id: Option<&str>) -> Result<BookmarkFolder> {
        let name = folder_name(name)?;
        let parent = self.live_folder(parent_id)?.map(|(id, _)| id);
        let id = new_record_id();
        let now = now_utc();
        let last: f64 = self.conn.query_row(
            "SELECT COALESCE(MAX(position), 0) FROM bookmark_folders WHERE deleted_at IS NULL AND parent_id IS ?1",
            params![parent],
            |r| r.get(0),
        )?;
        self.conn.execute(
            "INSERT INTO bookmark_folders (id, name, parent_id, position, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
            params![id, name, parent, last + 1.0, now],
        )?;
        Ok(BookmarkFolder { id, name, parent_id: parent, created_at: now.to_string() })
    }

    pub fn rename_bookmark_folder(&self, id: &str, name: &str) -> Result<()> {
        let name = folder_name(name)?;
        let tx = self.conn.unchecked_transaction()?;
        let now = now_utc();
        tx.execute("UPDATE bookmark_folders SET name = ?2, updated_at = ?3 WHERE id = ?1 AND deleted_at IS NULL", params![id, name, now])?;
        // Older TBVs show the name each bookmark carries.
        tx.execute(
            "UPDATE bookmarks SET folder = ?2, updated_at = ?3 WHERE folder_id = ?1 AND deleted_at IS NULL AND folder IS NOT ?2",
            params![id, name, now],
        )?;
        tx.commit()?;
        Ok(())
    }

    /// This folder and every folder inside it.
    fn folder_and_inside(&self, id: &str) -> Result<Vec<String>> {
        let folders = self.bookmark_folders()?;
        let mut found = vec![id.to_string()];
        let mut i = 0;
        while i < found.len() {
            let at = found[i].clone();
            found.extend(folders.iter().filter(|f| f.parent_id.as_deref() == Some(at.as_str())).map(|f| f.id.clone()));
            i += 1;
        }
        Ok(found)
    }

    /// Moves a folder into another (none = the top level), before a folder
    /// there or at the end.
    pub fn move_bookmark_folder(&self, id: &str, parent_id: Option<&str>, before: Option<&str>) -> Result<BookmarkUndo> {
        let Some(folder) = self.bookmark_folders()?.into_iter().find(|f| f.id == id) else { return Ok(BookmarkUndo::default()) };
        let parent = self.live_folder(parent_id)?.map(|(id, _)| id);
        if let Some(p) = &parent {
            if self.folder_and_inside(id)?.contains(p) {
                return Err(Error::Unsuitable("A folder can't go inside itself.".into()));
            }
        }
        let undo = BookmarkUndo { places: self.places_in(&[folder.parent_id.clone(), parent.clone()])?, ..Default::default() };
        let tx = self.conn.unchecked_transaction()?;
        let mut order: Vec<String> = self.folders_in(parent.as_deref())?.into_iter().map(|f| f.id).filter(|f| f != id).collect();
        let at = before.and_then(|b| order.iter().position(|f| f == b)).unwrap_or(order.len());
        order.insert(at, id.to_string());
        self.place_in_order(parent.as_deref(), None, &[], &order)?;
        tx.commit()?;
        Ok(undo)
    }

    /// Takes a folder away. Its contents go with it, or move up a level
    /// (to the end of the folder it was in) when `keep_contents`.
    pub fn delete_bookmark_folder(&self, id: &str, keep_contents: bool) -> Result<BookmarkUndo> {
        let Some(folder) = self.bookmark_folders()?.into_iter().find(|f| f.id == id) else { return Ok(BookmarkUndo::default()) };
        let up = folder.parent_id.clone();
        let mut undo = BookmarkUndo { places: self.places_in(&[up.clone(), Some(id.to_string())])?, ..Default::default() };
        let tx = self.conn.unchecked_transaction()?;
        let now = now_utc();
        let gone: Vec<String> = if keep_contents {
            let name = self.live_folder(up.as_deref())?.map(|(_, n)| n);
            let mut marks: Vec<String> = self.marks_in(up.as_deref())?.into_iter().map(|m| m.id).collect();
            marks.extend(self.marks_in(Some(id))?.into_iter().map(|m| m.id));
            let mut folders: Vec<String> = self.folders_in(up.as_deref())?.into_iter().map(|f| f.id).filter(|f| f != id).collect();
            folders.extend(self.folders_in(Some(id))?.into_iter().map(|f| f.id));
            self.place_in_order(up.as_deref(), name.as_deref(), &marks, &folders)?;
            vec![id.to_string()]
        } else {
            self.folder_and_inside(id)?
        };
        if !keep_contents {
            let inside: HashSet<&str> = gone.iter().map(String::as_str).collect();
            let marks: Vec<String> = self.bookmarks()?.into_iter().filter(|m| m.folder_id.as_deref().is_some_and(|f| inside.contains(f))).map(|m| m.id).collect();
            for mark in &marks {
                tx.execute("UPDATE bookmarks SET deleted_at = ?2, updated_at = ?2 WHERE id = ?1", params![mark, now])?;
            }
            undo.removed_bookmarks = marks;
        }
        for f in &gone {
            tx.execute("UPDATE bookmark_folders SET deleted_at = ?2, updated_at = ?2 WHERE id = ?1 AND deleted_at IS NULL", params![f, now])?;
        }
        undo.removed_folders = gone;
        tx.commit()?;
        Ok(undo)
    }

    /// Puts a folder's contents in order once: by name, or newest first.
    /// Folders come before bookmarks either way.
    pub fn sort_bookmark_folder(&self, folder_id: Option<&str>, by: &str) -> Result<BookmarkUndo> {
        let folder = self.live_folder(folder_id)?;
        let target = folder.as_ref().map(|(id, _)| id.clone());
        let undo = BookmarkUndo { places: self.places_in(std::slice::from_ref(&target))?, ..Default::default() };
        let mut marks = self.marks_in(target.as_deref())?;
        let mut folders = self.folders_in(target.as_deref())?;
        if by == "added" {
            marks.sort_by(|a, b| b.created_at.cmp(&a.created_at));
            folders.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        } else {
            marks.sort_by_cached_key(|m| m.title.to_lowercase());
            folders.sort_by_cached_key(|f| f.name.to_lowercase());
        }
        let tx = self.conn.unchecked_transaction()?;
        let marks: Vec<String> = marks.into_iter().map(|m| m.id).collect();
        let folders: Vec<String> = folders.into_iter().map(|f| f.id).collect();
        self.place_in_order(target.as_deref(), folder.as_ref().map(|(_, n)| n.as_str()), &marks, &folders)?;
        tx.commit()?;
        Ok(undo)
    }

    /// Puts back what a change did.
    pub fn undo_bookmarks(&self, undo: &BookmarkUndo) -> Result<()> {
        let tx = self.conn.unchecked_transaction()?;
        let now = now_utc();
        for id in &undo.removed_folders {
            tx.execute("UPDATE bookmark_folders SET deleted_at = NULL, updated_at = ?2 WHERE id = ?1", params![id, now])?;
        }
        for id in &undo.removed_bookmarks {
            tx.execute("UPDATE bookmarks SET deleted_at = NULL, updated_at = ?2 WHERE id = ?1", params![id, now])?;
        }
        let names: HashMap<String, String> =
            self.bookmark_folders()?.into_iter().map(|f| (f.id, f.name)).collect();
        for place in &undo.places {
            if place.folder {
                tx.execute(
                    "UPDATE bookmark_folders SET parent_id = ?2, position = ?3, updated_at = ?4 WHERE id = ?1 AND (parent_id IS NOT ?2 OR position != ?3)",
                    params![place.id, place.parent_id, place.position, now],
                )?;
            } else {
                let name = place.parent_id.as_ref().and_then(|p| names.get(p));
                tx.execute(
                    "UPDATE bookmarks SET folder_id = ?2, folder = ?3, position = ?4, updated_at = ?5
                     WHERE id = ?1 AND (folder_id IS NOT ?2 OR folder IS NOT ?3 OR position != ?4)",
                    params![place.id, place.parent_id, name, place.position, now],
                )?;
            }
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
        self.remove_bookmarks(&[id.to_string()])?;
        Ok(())
    }

    pub fn remove_bookmarks(&self, ids: &[String]) -> Result<BookmarkUndo> {
        let tx = self.conn.unchecked_transaction()?;
        let now = now_utc();
        let mut removed = Vec::new();
        for id in ids {
            if tx.execute("UPDATE bookmarks SET deleted_at = ?2, updated_at = ?2 WHERE id = ?1 AND deleted_at IS NULL", params![id, now])? > 0 {
                removed.push(id.clone());
            }
        }
        tx.commit()?;
        Ok(BookmarkUndo { removed_bookmarks: removed, ..Default::default() })
    }
}

#[cfg(test)]
mod tests {
    use crate::library::tests::open_temp_library;
    use rusqlite::params;

    fn titles(library: &crate::Library, folder: Option<&str>) -> Vec<String> {
        library.bookmarks().unwrap().into_iter().filter(|m| m.folder_id.as_deref() == folder).map(|m| m.title).collect()
    }

    #[test]
    fn bookmarks_can_be_edited_and_moved_within_a_folder() {
        let (_dir, library) = open_temp_library();
        let books = library.create_bookmark_folder(" Books ", None).unwrap();
        assert_eq!(books.name, "Books");
        let first = library.add_bookmark_to("First", "https://first.test/", Some(&books.id)).unwrap();
        let other = library.add_bookmark("Other", "https://other.test/").unwrap();
        let last = library.add_bookmark("Last", "https://last.test/").unwrap();
        library.edit_bookmark(&last.id, "Updated", "https://updated.test/", Some(&books.id)).unwrap();
        library.move_bookmark(&last.id, -1).unwrap();
        let marks = library.bookmarks().unwrap();
        let updated = marks.iter().find(|m| m.id == last.id).unwrap();
        assert_eq!(updated.url, "https://updated.test/");
        assert_eq!(updated.folder.as_deref(), Some("Books"));
        assert_eq!(titles(&library, Some(&books.id)), ["Updated", "First"]);
        assert_eq!(first.folder_id.as_deref(), Some(books.id.as_str()));
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

    #[test]
    fn folder_names_from_older_devices_become_folders() {
        let (_dir, library) = open_temp_library();
        let mark = library.add_bookmark("Old", "https://old.test/").unwrap();
        // An older TBV only sets the name.
        library.conn.execute("UPDATE bookmarks SET folder = 'Poetry' WHERE id = ?1", params![mark.id]).unwrap();
        let folders = library.bookmark_folders().unwrap();
        assert_eq!(folders.len(), 1);
        assert_eq!(folders[0].name, "Poetry");
        assert_eq!(folders[0].id, "label:poetry", "the same id on every device");
        assert_eq!(library.bookmarks().unwrap()[0].folder_id.as_deref(), Some("label:poetry"));
        // A second old bookmark with that name joins the same folder.
        let next = library.add_bookmark("Next", "https://next.test/").unwrap();
        library.conn.execute("UPDATE bookmarks SET folder = 'poetry' WHERE id = ?1", params![next.id]).unwrap();
        assert_eq!(library.bookmark_folders().unwrap().len(), 1);
        assert_eq!(titles(&library, Some("label:poetry")), ["Old", "Next"]);
        // Renamed here, then an older device names another bookmark "Poetry":
        // the renamed folder stays as it is and a new Poetry folder is made.
        library.rename_bookmark_folder("label:poetry", "Verse").unwrap();
        let late = library.add_bookmark("Late", "https://late.test/").unwrap();
        library.conn.execute("UPDATE bookmarks SET folder = 'Poetry' WHERE id = ?1", params![late.id]).unwrap();
        let folders = library.bookmark_folders().unwrap();
        assert_eq!(folders.iter().map(|f| f.name.as_str()).collect::<Vec<_>>(), ["Verse", "Poetry"]);
        assert_eq!(titles(&library, Some("label:poetry")), ["Old", "Next"]);
    }

    #[test]
    fn folders_nest_move_and_cannot_go_inside_themselves() {
        let (_dir, library) = open_temp_library();
        let outer = library.create_bookmark_folder("Outer", None).unwrap();
        let inner = library.create_bookmark_folder("Inner", Some(&outer.id)).unwrap();
        let other = library.create_bookmark_folder("Other", None).unwrap();
        assert!(library.move_bookmark_folder(&outer.id, Some(&inner.id), None).is_err());
        assert!(library.move_bookmark_folder(&outer.id, Some(&outer.id), None).is_err());
        library.move_bookmark_folder(&other.id, None, Some(&outer.id)).unwrap();
        let top: Vec<String> = library.bookmark_folders().unwrap().into_iter().filter(|f| f.parent_id.is_none()).map(|f| f.name).collect();
        assert_eq!(top, ["Other", "Outer"]);
        let undo = library.move_bookmark_folder(&inner.id, Some(&other.id), None).unwrap();
        assert_eq!(library.bookmark_folders().unwrap().iter().find(|f| f.id == inner.id).unwrap().parent_id.as_deref(), Some(other.id.as_str()));
        library.undo_bookmarks(&undo).unwrap();
        assert_eq!(library.bookmark_folders().unwrap().iter().find(|f| f.id == inner.id).unwrap().parent_id.as_deref(), Some(outer.id.as_str()));
        // A loop made by two devices at once shows both at the top level.
        library.conn.execute("UPDATE bookmark_folders SET parent_id = ?1 WHERE id = ?2", params![inner.id, outer.id]).unwrap();
        let folders = library.bookmark_folders().unwrap();
        assert!(folders.iter().filter(|f| f.id == inner.id || f.id == outer.id).all(|f| f.parent_id.is_none()));
    }

    #[test]
    fn several_bookmarks_move_and_removal_can_be_undone() {
        let (_dir, library) = open_temp_library();
        let folder = library.create_bookmark_folder("Reading", None).unwrap();
        let a = library.add_bookmark("A", "https://a.test/").unwrap();
        let b = library.add_bookmark("B", "https://b.test/").unwrap();
        let c = library.add_bookmark("C", "https://c.test/").unwrap();
        let undo = library.move_bookmarks(&[c.id.clone(), a.id.clone()], Some(&folder.id), None).unwrap();
        assert_eq!(titles(&library, Some(&folder.id)), ["A", "C"]);
        assert_eq!(titles(&library, None), ["B"]);
        library.undo_bookmarks(&undo).unwrap();
        assert_eq!(titles(&library, None), ["A", "B", "C"]);
        assert!(library.bookmarks().unwrap().iter().all(|m| m.folder.is_none()));
        library.move_bookmarks(std::slice::from_ref(&c.id), None, Some(&a.id)).unwrap();
        assert_eq!(titles(&library, None), ["C", "A", "B"]);
        let undo = library.remove_bookmarks(&[a.id.clone(), b.id.clone()]).unwrap();
        assert_eq!(titles(&library, None), ["C"]);
        library.undo_bookmarks(&undo).unwrap();
        assert_eq!(titles(&library, None), ["C", "A", "B"]);
    }

    #[test]
    fn deleting_a_folder_takes_its_contents_or_moves_them_up() {
        let (_dir, library) = open_temp_library();
        let outer = library.create_bookmark_folder("Outer", None).unwrap();
        let inner = library.create_bookmark_folder("Inner", Some(&outer.id)).unwrap();
        library.add_bookmark_to("In outer", "https://outer.test/", Some(&outer.id)).unwrap();
        library.add_bookmark_to("In inner", "https://inner.test/", Some(&inner.id)).unwrap();
        library.add_bookmark("Top", "https://top.test/").unwrap();
        let undo = library.delete_bookmark_folder(&outer.id, true).unwrap();
        assert_eq!(titles(&library, None), ["Top", "In outer"]);
        assert_eq!(library.bookmark_folders().unwrap().iter().map(|f| (f.name.as_str(), f.parent_id.is_none())).collect::<Vec<_>>(), [("Inner", true)]);
        library.undo_bookmarks(&undo).unwrap();
        assert_eq!(titles(&library, Some(&outer.id)), ["In outer"]);
        let undo = library.delete_bookmark_folder(&outer.id, false).unwrap();
        assert_eq!(titles(&library, None), ["Top"]);
        assert!(library.bookmark_folders().unwrap().is_empty());
        assert_eq!(undo.removed_bookmarks.len(), 2);
        library.undo_bookmarks(&undo).unwrap();
        assert_eq!(titles(&library, Some(&inner.id)), ["In inner"]);
        assert_eq!(library.bookmarks().unwrap().iter().find(|m| m.title == "In outer").unwrap().folder.as_deref(), Some("Outer"));
    }

    #[test]
    fn a_folder_sorts_once_and_renames_carry_to_its_bookmarks() {
        let (_dir, library) = open_temp_library();
        let folder = library.create_bookmark_folder("Sites", None).unwrap();
        for (title, url, day) in [("Cherry", "https://c.test/", 3), ("apple", "https://a.test/", 1), ("Banana", "https://b.test/", 2)] {
            library.add_bookmark_to(title, url, Some(&folder.id)).unwrap();
            library.conn.execute("UPDATE bookmarks SET created_at = ?1 WHERE url = ?2", params![format!("2026-01-0{day}"), url]).unwrap();
        }
        library.sort_bookmark_folder(Some(&folder.id), "name").unwrap();
        assert_eq!(titles(&library, Some(&folder.id)), ["apple", "Banana", "Cherry"]);
        library.sort_bookmark_folder(Some(&folder.id), "added").unwrap();
        assert_eq!(titles(&library, Some(&folder.id)), ["Cherry", "Banana", "apple"]);
        library.rename_bookmark_folder(&folder.id, "Fruit").unwrap();
        assert!(library.bookmarks().unwrap().iter().all(|m| m.folder.as_deref() == Some("Fruit")));
        assert!(library.rename_bookmark_folder(&folder.id, "  ").is_err());
    }
}

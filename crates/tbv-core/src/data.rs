//! Looking after the library's data: where it lives, exports, backups and
//! restoring them, and the accent colour Adaptive theming takes from a cover.

use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::{params, Connection};
use serde::Serialize;

use crate::error::{Error, Result};
use crate::library::{migrate, Library};
use crate::model::*;
use crate::time::now_utc;

/// Where this device keeps the library, for Settings.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryInfo {
    pub database: String,
    pub books_dir: String,
    pub schema_version: usize,
    pub book_count: u32,
    /// The database file, in bytes. Book files are not included.
    pub database_bytes: u64,
    /// The book files TBV keeps, in bytes.
    pub books_bytes: u64,
}

fn folder_bytes(dir: &Path) -> u64 {
    fs::read_dir(dir)
        .map(|entries| {
            entries
                .flatten()
                .map(|e| match e.metadata() {
                    Ok(m) if m.is_dir() => folder_bytes(&e.path()),
                    Ok(m) => m.len(),
                    Err(_) => 0,
                })
                .sum()
        })
        .unwrap_or(0)
}

impl Library {
    pub fn library_info(&self) -> Result<LibraryInfo> {
        Ok(LibraryInfo {
            database: self.paths.database.display().to_string(),
            books_dir: self.paths.books_dir.display().to_string(),
            schema_version: Self::schema_version(),
            book_count: self.conn.query_row(
                "SELECT COUNT(*) FROM books WHERE deleted_at IS NULL",
                [],
                |r| r.get(0),
            )?,
            database_bytes: fs::metadata(&self.paths.database)
                .map(|m| m.len())
                .unwrap_or(0),
            books_bytes: folder_bytes(&self.paths.books_dir),
        })
    }

    /// Writes everything you've made (books' details and progress,
    /// collections, highlights and notes) to a readable JSON file.
    pub fn export_library(&self, target: &Path) -> Result<()> {
        // `library_page` caps its page size, so walk every page.
        let mut all_books = Vec::new();
        let mut page = 0;
        loop {
            let result = self.library_page(&LibraryQuery {
                sort: SortOrder::Title,
                page,
                page_size: 200,
                ..Default::default()
            })?;
            let done = (page + 1) * result.page_size >= result.total;
            all_books.extend(result.books);
            if done {
                break;
            }
            page += 1;
        }

        let overview = self.collections_overview()?;
        let mut collections = Vec::new();
        for c in &overview.collections {
            let detail = self.collection_detail(&CollectionRef::Collection { id: c.id.clone() })?;
            collections.push(serde_json::json!({
                "name": c.name,
                "kind": c.kind,
                "description": c.description,
                "badge": c.badge,
                "picture": c.picture,
                "books": detail.books.iter().map(|b| &b.title).collect::<Vec<_>>(),
            }));
        }
        let notes = self.notes_page(&NotesQuery {
            sort: NotesSort::Book,
            ..Default::default()
        })?;
        let mut bookmarks = Vec::new();
        for b in &all_books {
            for a in self.book_annotations(&b.id)? {
                if a.kind == AnnotationKind::Bookmark {
                    bookmarks.push(serde_json::json!({
                        "book": b.title,
                        "words": a.excerpt,
                        "locator": a.locator,
                    }));
                }
            }
        }
        let export = serde_json::json!({
            "app": "The Bound Vigil",
            "exportedAt": now_utc(),
            "schemaVersion": Self::schema_version(),
            "books": all_books.iter().map(|b| serde_json::json!({
                "id": b.id,
                "title": b.title,
                "authors": b.authors,
                "series": b.series,
                "seriesIndex": b.series_index,
                "format": b.format,
                "status": b.status,
                "progress": b.total_progression,
                "position": b.resume_locator,
                "favourite": b.favorite,
                "wantToRead": b.want_to_read,
                "addedAt": b.added_at,
                "lastOpenedAt": b.last_opened_at,
            })).collect::<Vec<_>>(),
            "collections": collections,
            "notes": notes.notes,
            "bookmarks": bookmarks,
        });
        fs::write(target, serde_json::to_vec_pretty(&export)?)?;
        Ok(())
    }

    /// Writes every note as Markdown, grouped by book, for reading anywhere.
    pub fn export_notes_markdown(&self, target: &Path) -> Result<()> {
        let notes = self.notes_page(&NotesQuery {
            sort: NotesSort::Book,
            ..Default::default()
        })?;
        let mut out = String::from("# Notes from The Bound Vigil\n");
        let mut current: Option<String> = None;
        for n in &notes.notes {
            let heading = match &n.book {
                Some(b) if b.authors.is_empty() => b.title.clone(),
                Some(b) => format!("{} — {}", b.title, b.authors.join(", ")),
                None => "Personal notes".to_string(),
            };
            if current.as_ref() != Some(&heading) {
                out.push_str(&format!("\n## {heading}\n"));
                current = Some(heading);
            }
            out.push('\n');
            if let Some(title) = &n.title {
                out.push_str(&format!("### {title}\n\n"));
            }
            if n.kind == NoteKind::BookNote {
                out.push_str("*About the whole book*\n\n");
            }
            if !n.excerpt.is_empty() {
                for line in n.excerpt.lines() {
                    out.push_str(&format!("> {line}\n"));
                }
                let place: Vec<String> = n
                    .locator
                    .iter()
                    .flat_map(|l| {
                        [
                            l.chapter.clone(),
                            l.page_index.map(|p| format!("p. {}", p + 1)),
                        ]
                    })
                    .flatten()
                    .collect();
                if !place.is_empty() {
                    out.push_str(&format!(">\n> — {}\n", place.join(", ")));
                }
                out.push('\n');
            }
            if let Some(note) = &n.note {
                out.push_str(note);
                out.push('\n');
            }
        }
        fs::write(target, out)?;
        Ok(())
    }

    /// Saves a copy of the library's records (not the book files) to one file.
    /// An existing backup is only replaced once the new one is complete.
    pub fn create_backup(&self, target: &Path) -> Result<()> {
        if target == self.paths.database {
            return Err(Error::Unsuitable("choose a different file for the backup".into()));
        }
        let partial = sibling(target, "partial");
        let _ = fs::remove_file(&partial);
        let made = self
            .conn
            .execute("VACUUM INTO ?1", params![partial.display().to_string()])
            .map_err(Error::from)
            .and_then(|_| forget_device_only(&partial))
            .and_then(|_| fs::rename(&partial, target).map_err(Error::from));
        if made.is_err() {
            let _ = fs::remove_file(&partial);
        }
        made
    }

    /// Replaces the library's records with a backup's. Book files are left
    /// alone; books whose files aren't on this device show as missing.
    pub fn restore_backup(&mut self, source: &Path) -> Result<()> {
        // Checked and brought up to date on a copy, so a bad file never
        // touches the library in use.
        let staging = sibling(&self.paths.database, "restore");
        let _ = fs::remove_file(&staging);
        fs::copy(source, &staging)?;
        let checked = check_backup(&staging);
        let restored = checked.and_then(|_| {
            // Where this device keeps its book files, and its sync sign-in,
            // aren't part of a backup.
            let here = self.local_files()?;
            let kept = DEVICE_ONLY
                .iter()
                .map(|key| Ok((*key, self.setting(key)?)))
                .collect::<Result<Vec<_>>>()?;
            self.conn
                .restore(rusqlite::MAIN_DB, &staging, None::<fn(rusqlite::backup::Progress)>)?;
            crate::sync::install_triggers(&self.conn)?;
            self.rebind_local_files(here)?;
            for (key, value) in kept {
                self.conn.execute("DELETE FROM device_settings WHERE key = ?1", params![key])?;
                if let Some(value) = value {
                    self.set_setting(key, &value)?;
                }
            }
            // Start sync afresh: send everything again; the cloud keeps whichever is newer.
            self.reset_sync()
        });
        let _ = fs::remove_file(&staging);
        restored
    }

    fn local_files(&self) -> Result<Vec<LocalFile>> {
        let mut statement = self.conn.prepare("SELECT book_id, path, cover_path FROM local_files")?;
        let rows = statement.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    /// Drops file locations that don't exist on this device, then puts back
    /// the ones this device had before the restore.
    fn rebind_local_files(&self, here: Vec<LocalFile>) -> Result<()> {
        let restored = self.local_files()?;
        let tx = self.conn.unchecked_transaction()?;
        for (book_id, path, cover) in restored {
            if path.is_some_and(|p| !Path::new(&p).exists()) {
                tx.execute("DELETE FROM local_files WHERE book_id = ?1", params![book_id])?;
            } else if cover.is_some_and(|c| !Path::new(&c).exists()) {
                tx.execute("UPDATE local_files SET cover_path = NULL WHERE book_id = ?1", params![book_id])?;
            }
        }
        for (book_id, path, cover) in here {
            tx.execute(
                "INSERT OR REPLACE INTO local_files (book_id, path, cover_path)
                 SELECT ?1, ?2, ?3 WHERE EXISTS (SELECT 1 FROM books WHERE id = ?1)",
                params![book_id, path, cover],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    /// A gentle accent colour from a book's cover, as `#rrggbb`, for
    /// Adaptive theming. None when the book has no cover on this device.
    pub fn cover_accent(&self, book_id: &str) -> Result<Option<String>> {
        let cover: Option<String> = self
            .conn
            .query_row(
                "SELECT cover_path FROM local_files WHERE book_id = ?1",
                params![book_id],
                |r| r.get(0),
            )
            .unwrap_or(None);
        let Some(cover) = cover else {
            return Ok(None);
        };
        let Ok(image) = image::open(&cover) else {
            return Ok(None);
        };
        Ok(accent_of(&image.thumbnail(48, 48).to_rgb8()))
    }
}

/// Settings that belong to this device and its sign-in, never to a backup.
const DEVICE_ONLY: [&str; 5] = ["sync.session", "sync.supabase", "sync.device_id", crate::sync::PROVIDER, crate::hardcover::ACCOUNT_KEY];

/// Sign-ins (and the sync choice, which can hold a WebDAV password): never
/// written into a backup file.
const SIGN_INS: [&str; 3] = ["sync.session", crate::sync::PROVIDER, crate::hardcover::ACCOUNT_KEY];

/// Takes this device's sign-ins out of a backup copy, so a backup file never
/// holds a way into the cloud or into Hardcover.
fn forget_device_only(copy: &Path) -> Result<()> {
    let conn = Connection::open(copy)?;
    for key in SIGN_INS {
        conn.execute("DELETE FROM device_settings WHERE key = ?1", [key])?;
    }
    Ok(())
}

/// A book's file and cover on this device: (book id, file, cover).
type LocalFile = (String, Option<String>, Option<String>);

/// `file.ext` becomes `file.ext.<suffix>` beside it.
fn sibling(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path.file_name().unwrap_or_default().to_os_string();
    name.push(format!(".{suffix}"));
    path.with_file_name(name)
}

/// Makes sure a copied backup is a whole TBV library, brought up to the
/// current schema: every table and column TBV expects, and no damage.
fn check_backup(copy: &Path) -> Result<()> {
    let not_backup = || Error::Unsuitable("that file isn't a TBV backup".into());
    let mut backup = Connection::open(copy).map_err(|_| not_backup())?;
    let version: usize = backup
        .pragma_query_value(None, "user_version", |r| r.get(0))
        .map_err(|_| not_backup())?;
    if version == 0 {
        return Err(not_backup());
    }
    if version > Library::schema_version() {
        return Err(Error::Unsuitable("that backup comes from a newer TBV; update TBV first".into()));
    }
    let ok: String = backup.query_row("PRAGMA integrity_check", [], |r| r.get(0)).map_err(|_| not_backup())?;
    if ok != "ok" {
        return Err(Error::Unsuitable("that backup is damaged".into()));
    }
    migrate(&mut backup).map_err(|_| not_backup())?;
    let mut expected = Connection::open_in_memory()?;
    migrate(&mut expected)?;
    let have = columns(&backup)?;
    if columns(&expected)?.iter().any(|c| !have.contains(c)) {
        return Err(not_backup());
    }
    Ok(())
}

/// Every (table, column) in a database.
fn columns(conn: &Connection) -> Result<Vec<(String, String)>> {
    let mut statement = conn.prepare(
        "SELECT m.name, p.name FROM sqlite_master m, pragma_table_info(m.name) p
         WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite_%'",
    )?;
    let rows = statement.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
    Ok(rows.collect::<std::result::Result<_, _>>()?)
}

/// The most colourful common tone in a small picture, toned down so text
/// on it stays readable in both light and dark themes.
fn accent_of(pixels: &image::RgbImage) -> Option<String> {
    // Buckets of similar colours, weighted towards colourful ones.
    let mut buckets = std::collections::HashMap::<(u8, u8, u8), (f64, [f64; 3])>::new();
    for p in pixels.pixels() {
        let [r, g, b] = p.0.map(f64::from);
        let max = r.max(g).max(b);
        let min = r.min(g).min(b);
        let saturation = if max == 0.0 { 0.0 } else { (max - min) / max };
        if max < 40.0 || min > 225.0 {
            continue;
        }
        let key = (p.0[0] / 32, p.0[1] / 32, p.0[2] / 32);
        let weight = 0.2 + saturation;
        let entry = buckets.entry(key).or_insert((0.0, [0.0; 3]));
        entry.0 += weight;
        entry.1[0] += r * weight;
        entry.1[1] += g * weight;
        entry.1[2] += b * weight;
    }
    let (weight, sum) = buckets
        .into_values()
        .max_by(|a, b| a.0.total_cmp(&b.0))?;
    let [r, g, b] = sum.map(|c| c / weight);
    // Keep it in a middle lightness so it works as an accent on both themes.
    let lightness = (r.max(g).max(b) + r.min(g).min(b)) / 2.0;
    let scale = if lightness > 0.0 { 110.0 / lightness } else { 1.0 };
    let [r, g, b] = [r, g, b].map(|c| (c * scale).clamp(0.0, 255.0) as u8);
    Some(format!("#{r:02x}{g:02x}{b:02x}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::epub::tests::write_test_epub_with;
    use crate::library::tests::open_temp_library;

    #[test]
    fn backups_restore_the_library_as_it_was() {
        let (dir, mut library) = open_temp_library();
        let book = dir.path().join("Lamps.epub");
        write_test_epub_with(&book, "Lamps", "Wren Hale", false, "");
        library.import_files(&[book]);
        library.save_personal_note(None, Some("Plan"), "Read more").unwrap();

        let backup = dir.path().join("library.tbvbackup");
        library.create_backup(&backup).unwrap();
        // Overwriting an earlier backup is fine.
        library.create_backup(&backup).unwrap();

        library.save_personal_note(None, None, "Written after the backup").unwrap();
        assert_eq!(library.notes_page(&NotesQuery::default()).unwrap().counts.personal, 2);

        library.restore_backup(&backup).unwrap();
        assert_eq!(library.notes_page(&NotesQuery::default()).unwrap().counts.personal, 1);
        assert_eq!(library.library_info().unwrap().book_count, 1);

        let junk = dir.path().join("junk.tbvbackup");
        fs::write(&junk, b"not a database").unwrap();
        assert!(library.restore_backup(&junk).is_err());
        assert_eq!(library.library_info().unwrap().book_count, 1, "a bad file changes nothing");

        // A database that only looks like TBV's is turned away too.
        let lookalike = dir.path().join("lookalike.tbvbackup");
        let other = Connection::open(&lookalike).unwrap();
        other.execute_batch("CREATE TABLE books (id TEXT); PRAGMA user_version = 5;").unwrap();
        drop(other);
        assert!(library.restore_backup(&lookalike).is_err());
        assert_eq!(library.library_info().unwrap().book_count, 1);

        let leftovers: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|e| e.ok()?.file_name().into_string().ok())
            .filter(|n| n.ends_with(".partial") || n.ends_with(".restore"))
            .collect();
        assert!(leftovers.is_empty(), "{leftovers:?}");
    }

    #[test]
    fn a_restore_keeps_this_devices_book_files() {
        let (dir, mut library) = open_temp_library();
        let book = dir.path().join("Lamps.epub");
        write_test_epub_with(&book, "Lamps", "Wren Hale", false, "");
        library.import_files(&[book]);
        let here = library.local_files().unwrap();

        // A backup made on another computer points at that computer's files.
        let backup = dir.path().join("library.tbvbackup");
        library.create_backup(&backup).unwrap();
        let other = Connection::open(&backup).unwrap();
        other
            .execute("UPDATE local_files SET path = '/elsewhere/Lamps.epub', cover_path = '/elsewhere/c.jpg'", [])
            .unwrap();
        drop(other);

        library.restore_backup(&backup).unwrap();
        assert_eq!(library.local_files().unwrap(), here);
    }

    #[test]
    fn backups_never_hold_the_sync_sign_in_and_restores_keep_it() {
        let (dir, mut library) = open_temp_library();
        library.set_setting("sync.session", r#"{"secret":"token"}"#).unwrap();
        library.set_setting("hardcover.account", r#"{"access_token":"hc"}"#).unwrap();
        let backup = dir.path().join("library.tbvbackup");
        library.create_backup(&backup).unwrap();
        let copy = Connection::open(&backup).unwrap();
        let held: i64 = copy
            .query_row("SELECT COUNT(*) FROM device_settings WHERE key IN ('sync.session', 'hardcover.account')", [], |r| r.get(0))
            .unwrap();
        assert_eq!(held, 0);
        drop(copy);

        library.restore_backup(&backup).unwrap();
        assert_eq!(library.setting("sync.session").unwrap().as_deref(), Some(r#"{"secret":"token"}"#));
        assert_eq!(library.setting("hardcover.account").unwrap().as_deref(), Some(r#"{"access_token":"hc"}"#));
        // Changes after a restore are still noticed for sync.
        library.save_personal_note(None, None, "After the restore").unwrap();
        let waiting: i64 = library.conn.query_row("SELECT COUNT(*) FROM sync_clock WHERE kind = 'personal_note' AND pushed = 0", [], |r| r.get(0)).unwrap();
        assert_eq!(waiting, 1);
    }

    #[test]
    fn exports_are_written() {
        let (dir, mut library) = open_temp_library();
        let book = dir.path().join("Lamps.epub");
        write_test_epub_with(&book, "Lamps", "Wren Hale", false, "");
        let id = match library.import_files(&[book]).remove(0) {
            ImportResult::Imported { book_id, .. } => book_id,
            other => panic!("{other:?}"),
        };
        library.save_book_note(&id, None, "A quiet book.").unwrap();
        library.save_personal_note(None, Some("Plan"), "Read more").unwrap();

        let json = dir.path().join("export.json");
        library.export_library(&json).unwrap();
        let value: serde_json::Value = serde_json::from_slice(&fs::read(&json).unwrap()).unwrap();
        assert_eq!(value["books"][0]["title"], "Lamps");
        assert_eq!(value["notes"].as_array().unwrap().len(), 2);

        let md = dir.path().join("notes.md");
        library.export_notes_markdown(&md).unwrap();
        let text = fs::read_to_string(&md).unwrap();
        assert!(text.contains("## Lamps — Wren Hale"));
        assert!(text.contains("A quiet book."));
        assert!(text.contains("## Personal notes"));
        assert!(text.contains("### Plan"));
    }

    #[test]
    fn accent_comes_from_the_most_colourful_common_tone() {
        let mut picture = image::RgbImage::new(10, 10);
        for (x, _, p) in picture.enumerate_pixels_mut() {
            *p = if x < 7 { image::Rgb([180, 40, 40]) } else { image::Rgb([250, 250, 250]) };
        }
        let accent = accent_of(&picture).unwrap();
        let red = u8::from_str_radix(&accent[1..3], 16).unwrap();
        let green = u8::from_str_radix(&accent[3..5], 16).unwrap();
        assert!(red > green * 2, "{accent}");

        let blank = image::RgbImage::from_pixel(4, 4, image::Rgb([255, 255, 255]));
        assert_eq!(accent_of(&blank), None);
    }
}

//! The local library: a SQLite cache in the app-data folder plus the book
//! files TBV manages. Book files are never modified after import.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use rusqlite::{params, Connection, OptionalExtension};

use crate::formats::read_metadata;
use crate::error::{Error, Result};
use crate::ids::{book_id_for_file, book_id_hex};
use crate::model::{BookId, ImportResult};
use crate::time::now_utc;

/// Formats TBV accepts on import. Only EPUB metadata is read today; the rest
/// are titled from their file name until their readers land.
pub const SUPPORTED_FORMATS: &[&str] = &[
    "epub", "pdf", "mobi", "azw", "azw3", "fb2", "fbz", "cbz", "txt", "docx", "doc",
];

/// Where this device keeps TBV's files.
#[derive(Debug, Clone)]
pub struct LibraryPaths {
    /// SQLite database (OS app-data folder).
    pub database: PathBuf,
    /// Book files TBV imported (app-data folder by default).
    pub books_dir: PathBuf,
    /// Extracted covers (OS cache folder; safe to delete).
    pub covers_dir: PathBuf,
    /// This device's profile picture (app-data folder).
    pub profile_dir: PathBuf,
    /// Pictures the user added for collections, named by content hash so
    /// every device agrees on the name (app-data folder).
    pub pictures_dir: PathBuf,
}

impl LibraryPaths {
    pub fn new(data_dir: &Path, cache_dir: &Path) -> Self {
        Self {
            database: data_dir.join("library.sqlite3"),
            books_dir: data_dir.join("Library"),
            covers_dir: cache_dir.join("covers"),
            profile_dir: data_dir.join("Profile"),
            pictures_dir: data_dir.join("Pictures"),
        }
    }
}

pub struct Library {
    pub(crate) conn: Connection,
    pub(crate) paths: LibraryPaths,
    /// False while changes from another device are written, so they aren't
    /// stamped as this device's own.
    pub(crate) sync_live: Arc<AtomicBool>,
    /// Goes up each time sync starts over, so a run that began before then
    /// stops instead of writing what it learned from the old place.
    pub(crate) sync_epoch: u64,
}

const MIGRATIONS: &[&str] = &[
    // v1: books keyed by content hash, device-local file paths kept apart.
    r#"
    CREATE TABLE books (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        authors TEXT NOT NULL DEFAULT '[]',
        format TEXT NOT NULL,
        file_size INTEGER NOT NULL,
        synopsis TEXT,
        publisher TEXT,
        language TEXT,
        added_at TEXT NOT NULL,
        last_opened_at TEXT,
        status TEXT NOT NULL DEFAULT 'unread',
        total_progression REAL,
        resume_locator TEXT,
        deleted_at TEXT
    );
    CREATE INDEX idx_books_added ON books(added_at);
    CREATE INDEX idx_books_opened ON books(last_opened_at);

    -- Only on this device; never synced.
    CREATE TABLE local_files (
        book_id TEXT PRIMARY KEY REFERENCES books(id),
        path TEXT NOT NULL,
        cover_path TEXT
    );

    -- The user's edits, layered over the metadata read from the book.
    CREATE TABLE metadata_overrides (
        book_id TEXT NOT NULL REFERENCES books(id),
        field TEXT NOT NULL,
        value TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (book_id, field)
    );

    CREATE TABLE collections (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        deleted_at TEXT
    );
    CREATE TABLE collection_books (
        collection_id TEXT NOT NULL REFERENCES collections(id),
        book_id TEXT NOT NULL REFERENCES books(id),
        added_at TEXT NOT NULL,
        PRIMARY KEY (collection_id, book_id)
    );

    CREATE TABLE annotations (
        id TEXT PRIMARY KEY,
        book_id TEXT NOT NULL REFERENCES books(id),
        kind TEXT NOT NULL,
        excerpt TEXT NOT NULL DEFAULT '',
        note TEXT,
        locator TEXT NOT NULL,
        color TEXT,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
    );
    CREATE INDEX idx_annotations_updated ON annotations(updated_at);
    "#,
    // v2: series, shelves the user picks (favourites, want to read), and
    // settings that belong to this device only.
    r#"
    ALTER TABLE books ADD COLUMN series TEXT;
    ALTER TABLE books ADD COLUMN series_index REAL;
    ALTER TABLE books ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE books ADD COLUMN want_to_read INTEGER NOT NULL DEFAULT 0;

    CREATE TABLE device_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );
    "#,
    // v3: the reader. Highlights and bookmarks remember when they were made
    // and how far into the book they sit, for "sort by position".
    r#"
    ALTER TABLE annotations ADD COLUMN created_at TEXT;
    UPDATE annotations SET created_at = updated_at WHERE created_at IS NULL;
    CREATE INDEX idx_annotations_book ON annotations(book_id);
    "#,
    // v4: the Collections page. Collections gain a description, a badge, a
    // picture, pinning and an order; reading lists keep their books in order.
    // Removing a book leaves a tombstone so sync can pass the removal on. The
    // built-in Up next shelf gets a fixed id so every device agrees on it.
    r#"
    ALTER TABLE collections ADD COLUMN description TEXT;
    ALTER TABLE collections ADD COLUMN kind TEXT NOT NULL DEFAULT 'collection';
    ALTER TABLE collections ADD COLUMN badge TEXT;
    ALTER TABLE collections ADD COLUMN picture TEXT;
    ALTER TABLE collections ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE collections ADD COLUMN position REAL;
    ALTER TABLE collections ADD COLUMN updated_at TEXT;
    UPDATE collections SET updated_at = created_at;

    ALTER TABLE collection_books ADD COLUMN position REAL;
    ALTER TABLE collection_books ADD COLUMN removed_at TEXT;
    ALTER TABLE collection_books ADD COLUMN updated_at TEXT;
    UPDATE collection_books SET updated_at = added_at;

    INSERT OR IGNORE INTO collections (id, name, created_at, updated_at, kind, badge, picture, pinned, position) VALUES
        ('shelf:want_to_read', 'Up next', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 'shelf', 'bookmark', 'gallery:forest', 1, 1);
    "#,
    // v5: the Notes page. Book notes (about a whole book) live with the
    // other annotations as kind 'book_note'. Personal notes belong to no
    // book, so they get their own table.
    r#"
    CREATE TABLE personal_notes (
        id TEXT PRIMARY KEY,
        title TEXT,
        body TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
    );
    CREATE INDEX idx_personal_notes_updated ON personal_notes(updated_at);
    "#,
    // v6: sync. Every change to something that travels between devices
    // stamps `sync_clock` (see sync.rs, which adds the triggers), and
    // `pushed` says whether the cloud has it yet. Existing data is stamped
    // with its own dates, so a device that joins later doesn't overrule newer
    // changes made elsewhere. A book can now be known here only by its cover,
    // so `local_files.path` may be empty.
    r#"
    CREATE TABLE sync_clock (
        kind TEXT NOT NULL,
        key TEXT NOT NULL,
        changed_at TEXT NOT NULL,
        pushed INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (kind, key)
    );
    CREATE INDEX idx_sync_clock_waiting ON sync_clock(pushed) WHERE pushed = 0;

    -- Changes from another device that waited for something they belong to
    -- (a note before its book arrived, say).
    CREATE TABLE sync_waiting (
        kind TEXT NOT NULL,
        key TEXT NOT NULL,
        record TEXT NOT NULL,
        PRIMARY KEY (kind, key)
    );

    -- Both devices changed the same thing and the user asked to choose.
    CREATE TABLE sync_conflicts (
        kind TEXT NOT NULL,
        key TEXT NOT NULL,
        remote TEXT NOT NULL,
        found_at TEXT NOT NULL,
        PRIMARY KEY (kind, key)
    );

    -- Files this device has put in the cloud, or failed to.
    CREATE TABLE sync_files (
        path TEXT PRIMARY KEY,
        uploaded_at TEXT,
        failed_at TEXT,
        error TEXT
    );

    INSERT INTO sync_clock (kind, key, changed_at)
        SELECT 'book', json_array(id), added_at FROM books;
    INSERT INTO sync_clock (kind, key, changed_at)
        SELECT 'book_progress', json_array(id), COALESCE(last_opened_at, added_at) FROM books
        WHERE status != 'unread' OR resume_locator IS NOT NULL OR last_opened_at IS NOT NULL;
    INSERT INTO sync_clock (kind, key, changed_at)
        SELECT 'book_shelves', json_array(id), added_at FROM books WHERE favorite = 1 OR want_to_read = 1;
    INSERT INTO sync_clock (kind, key, changed_at)
        SELECT 'override', json_array(book_id, field), updated_at FROM metadata_overrides;
    INSERT INTO sync_clock (kind, key, changed_at)
        SELECT 'collection', json_array(id), COALESCE(updated_at, created_at) FROM collections
        WHERE kind != 'shelf' OR updated_at > '2026-01-01T00:00:00.000Z';
    INSERT INTO sync_clock (kind, key, changed_at)
        SELECT 'collection_book', json_array(collection_id, book_id), COALESCE(updated_at, added_at) FROM collection_books;
    INSERT INTO sync_clock (kind, key, changed_at)
        SELECT 'annotation', json_array(id), updated_at FROM annotations;
    INSERT INTO sync_clock (kind, key, changed_at)
        SELECT 'personal_note', json_array(id), updated_at FROM personal_notes;

    CREATE TABLE local_files_v6 (
        book_id TEXT PRIMARY KEY REFERENCES books(id),
        path TEXT,
        cover_path TEXT
    );
    INSERT INTO local_files_v6 SELECT book_id, path, cover_path FROM local_files;
    DROP TABLE local_files;
    ALTER TABLE local_files_v6 RENAME TO local_files;
    "#,
    // v7: your own star rating (1 to 5) and the day you finished a book, and
    // the ISBN printed in it, which lets a Goodreads export find the book.
    r#"
    ALTER TABLE books ADD COLUMN rating INTEGER CHECK (rating BETWEEN 1 AND 5);
    ALTER TABLE books ADD COLUMN finished_at TEXT;
    ALTER TABLE books ADD COLUMN isbn TEXT;
    "#,
    // v8: rules that fill a collection by themselves, as JSON (see rules.rs).
    r#"
    ALTER TABLE collections ADD COLUMN rules TEXT;
    "#,
    // v9: your own tags on books. A removed tag is kept as a tombstone so
    // sync can pass the removal on.
    r#"
    CREATE TABLE book_tags (
        book_id TEXT NOT NULL REFERENCES books(id),
        tag TEXT NOT NULL,
        added_at TEXT NOT NULL,
        removed_at TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (book_id, tag)
    );
    CREATE INDEX idx_book_tags_tag ON book_tags(tag) WHERE removed_at IS NULL;
    "#,
];

/// Early builds had four built-in shelves, but three of them repeated smart
/// collections (Favourites, In progress, Read). Only Up next is kept. Run at
/// every open, so it also tidies a library restored from an old backup.
const RETIRED_SHELVES: &str = r#"
    DELETE FROM collection_books WHERE collection_id IN ('shelf:favorites', 'shelf:reading', 'shelf:completed');
    DELETE FROM collections WHERE id IN ('shelf:favorites', 'shelf:reading', 'shelf:completed');
    UPDATE collections SET name = 'Up next' WHERE id = 'shelf:want_to_read' AND name = 'To be read';
"#;

/// Brings a database up to the current schema, one step at a time.
pub(crate) fn migrate(conn: &mut Connection) -> Result<()> {
    let version: usize = conn.pragma_query_value(None, "user_version", |r| r.get(0))?;
    for (index, sql) in MIGRATIONS.iter().enumerate().skip(version) {
        let tx = conn.transaction()?;
        tx.execute_batch(sql)?;
        tx.pragma_update(None, "user_version", index + 1)?;
        tx.commit()?;
    }
    Ok(())
}

/// SQLite's own `lower()` only folds A–Z, so "Émile" would never match "émile".
/// `tbv_fold` lowercases with Rust's Unicode-aware rules instead.
///
/// `tbv_sync_live` tells the sync triggers whether a change is this device's own.
fn register_functions(conn: &Connection, sync_live: &Arc<AtomicBool>) -> Result<()> {
    use rusqlite::functions::FunctionFlags;
    conn.create_scalar_function(
        "tbv_fold",
        1,
        FunctionFlags::SQLITE_UTF8 | FunctionFlags::SQLITE_DETERMINISTIC,
        |ctx| Ok(ctx.get::<Option<String>>(0)?.map(|s| s.to_lowercase())),
    )?;
    let live = sync_live.clone();
    conn.create_scalar_function("tbv_sync_live", 0, FunctionFlags::SQLITE_UTF8, move |_| {
        Ok(live.load(Ordering::Relaxed))
    })?;
    Ok(())
}

impl Library {
    pub fn open(paths: LibraryPaths) -> Result<Self> {
        if let Some(parent) = paths.database.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::create_dir_all(&paths.books_dir)?;
        fs::create_dir_all(&paths.covers_dir)?;
        let conn = Connection::open(&paths.database)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        let sync_live = Arc::new(AtomicBool::new(true));
        register_functions(&conn, &sync_live)?;
        let mut library = Self { conn, paths, sync_live, sync_epoch: 0 };
        library.migrate()?;
        crate::sync::install_triggers(&library.conn)?;
        library.conn.execute_batch(RETIRED_SHELVES)?;
        Ok(library)
    }

    /// The schema this version of TBV writes.
    pub(crate) fn schema_version() -> usize {
        MIGRATIONS.len()
    }

    pub(crate) fn migrate(&mut self) -> Result<()> {
        migrate(&mut self.conn)
    }

    pub fn paths(&self) -> &LibraryPaths {
        &self.paths
    }

    /// Imports each file: copies it into the library folder (the original is
    /// left untouched), reads its metadata, and records it under its content hash.
    /// Imports files and folders. Folders are searched (including subfolders)
    /// for book files; other files inside them are skipped without a report.
    pub fn import_files(&mut self, sources: &[PathBuf]) -> Vec<ImportResult> {
        let files = find_book_files(sources, &self.paths.books_dir);
        files.iter().map(|source| self.import_one(source)).collect()
    }

    /// Where TBV keeps its own copies, which `find_book_files` skips.
    pub fn books_dir(&self) -> &Path {
        &self.paths.books_dir
    }

    fn import_one(&mut self, source: &Path) -> ImportResult {
        let path = source.display().to_string();
        let format = match extension_of(source) {
            Some(ext) if SUPPORTED_FORMATS.contains(&ext.as_str()) => ext,
            _ => return ImportResult::Unsupported { path },
        };
        match book_id_for_file(source).and_then(|id| self.try_import(source, &format, id)) {
            Ok(result) => result,
            Err(error) => ImportResult::Failed {
                path,
                reason: error.to_string(),
            },
        }
    }

    fn try_import(&mut self, source: &Path, format: &str, book_id: BookId) -> Result<ImportResult> {
        let plan = match self.import_plan(source, format, book_id)? {
            ImportPlan::Finished(result) => return Ok(result),
            ImportPlan::Prepare(plan) => plan,
        };
        let prepared = plan.prepare(&self.paths)?;
        self.finish_import(prepared)
    }

    /// The quick first look at a hashed file: is there anything to do?
    pub fn import_plan(&self, source: &Path, format: &str, book_id: BookId) -> Result<ImportPlan> {
        let path = source.display().to_string();
        let known = self.title_of(&book_id)?;
        if let Some(title) = &known {
            if self.has_local_file(&book_id)? {
                return Ok(ImportPlan::Finished(ImportResult::AlreadyInLibrary { path, book_id, title: title.clone() }));
            }
        }
        let cover = if known.is_some() { self.cover_of(&book_id)? } else { None };
        Ok(ImportPlan::Prepare(ImportJob { source: source.to_path_buf(), format: format.to_string(), book_id, known, cover }))
    }

    /// Records a book whose file has been copied in. Quick: the library is
    /// only needed for this part.
    pub fn finish_import(&mut self, done: PreparedImport) -> Result<ImportResult> {
        let PreparedImport { job, title, metadata, stored, cover } = done;
        let path = job.source.display().to_string();
        let book_id = job.book_id;
        let stored_path = stored.display().to_string();
        // Known already (maybe synced from elsewhere, or the same file twice
        // in one import): adopt this copy if there's none here.
        if let Some(title) = self.title_of(&book_id)? {
            if !self.has_local_file(&book_id)? {
                let cover = match self.cover_of(&book_id)? {
                    Some(cover) => Some(cover),
                    None => cover,
                };
                self.conn.execute(
                    "INSERT INTO local_files (book_id, path, cover_path) VALUES (?1, ?2, ?3)
                     ON CONFLICT(book_id) DO UPDATE SET path = excluded.path, cover_path = excluded.cover_path",
                    params![book_id, stored_path, cover],
                )?;
            }
            return Ok(ImportResult::AlreadyInLibrary { path, book_id, title });
        }

        let tx = self.conn.transaction()?;
        tx.execute(
            // A book deleted earlier comes back when its file is imported again.
            "INSERT INTO books (id, title, authors, format, file_size, synopsis, publisher, language, added_at, series, series_index, isbn)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
             ON CONFLICT(id) DO UPDATE SET
                title = excluded.title, authors = excluded.authors, format = excluded.format, file_size = excluded.file_size,
                synopsis = excluded.synopsis, publisher = excluded.publisher, language = excluded.language,
                added_at = excluded.added_at, series = excluded.series, series_index = excluded.series_index,
                isbn = excluded.isbn, deleted_at = NULL",
            params![
                book_id,
                title,
                serde_json::to_string(&metadata.authors)?,
                job.format,
                fs::metadata(&stored)?.len() as i64,
                metadata.synopsis,
                metadata.publisher,
                metadata.language,
                now_utc(),
                metadata.series,
                metadata.series_index,
                metadata.isbn,
            ],
        )?;
        tx.execute(
            "INSERT INTO local_files (book_id, path, cover_path) VALUES (?1, ?2, ?3)
             ON CONFLICT(book_id) DO UPDATE SET path = excluded.path, cover_path = excluded.cover_path",
            params![book_id, stored_path, cover],
        )?;
        tx.commit()?;
        Ok(ImportResult::Imported { path, book_id, title })
    }

    fn title_of(&self, book_id: &BookId) -> Result<Option<String>> {
        Ok(self
            .conn
            .query_row(
                "SELECT title FROM books WHERE id = ?1 AND deleted_at IS NULL",
                params![book_id],
                |r| r.get(0),
            )
            .optional()?)
    }

    /// The cover this device has for a book, if it is still there.
    /// Gives a book a cover drawn by the reader (a PDF's first page, which
    /// only the PDF engine can draw), unless it already has one. Returns
    /// whether the picture was kept.
    pub fn fill_cover(&self, book_id: &str, picture: &[u8]) -> Result<bool> {
        let book_id = book_id.to_string();
        if self.title_of(&book_id)?.is_none() || self.cover_of(&book_id)?.is_some() {
            return Ok(false);
        }
        let image = image::load_from_memory(picture).map_err(|e| Error::Unsuitable(format!("That picture couldn't be read: {e}")))?;
        // Covers are shown small; a page drawn at full size would be wasted space.
        let image = if image.height() > 900 { image.resize(900, 900, image::imageops::FilterType::Triangle) } else { image };
        let mut bytes = Vec::new();
        image
            .to_rgb8()
            .write_to(&mut std::io::Cursor::new(&mut bytes), image::ImageFormat::Jpeg)
            .map_err(|e| Error::Unsuitable(e.to_string()))?;
        let metadata = crate::epub::BookMetadata {
            cover: Some(crate::epub::Cover { bytes, extension: "jpg".into() }),
            ..Default::default()
        };
        let cover = save_cover(&self.paths, &book_id, &metadata)?;
        self.conn.execute(
            "INSERT INTO local_files (book_id, path, cover_path) VALUES (?1, NULL, ?2)
             ON CONFLICT(book_id) DO UPDATE SET cover_path = excluded.cover_path",
            params![book_id, cover],
        )?;
        Ok(true)
    }

    fn cover_of(&self, book_id: &BookId) -> Result<Option<String>> {
        let cover: Option<String> = self
            .conn
            .query_row(
                "SELECT cover_path FROM local_files WHERE book_id = ?1",
                params![book_id],
                |r| r.get(0),
            )
            .optional()?
            .flatten();
        Ok(cover.filter(|c| Path::new(c).exists()))
    }

    fn has_local_file(&self, book_id: &BookId) -> Result<bool> {
        let path: Option<String> = self
            .conn
            .query_row(
                "SELECT path FROM local_files WHERE book_id = ?1",
                params![book_id],
                |r| r.get(0),
            )
            .optional()?
            .flatten();
        Ok(path.is_some_and(|p| Path::new(&p).exists()))
    }
}

/// Every book file in `sources`: files as given, folders searched through.
/// TBV's own copies in `books_dir` are never picked up again.
pub fn find_book_files(sources: &[PathBuf], books_dir: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    for source in sources {
        if source.is_dir() {
            collect_books(source, books_dir, &mut files);
        } else {
            files.push(source.clone());
        }
    }
    files
}

fn collect_books(dir: &Path, books_dir: &Path, out: &mut Vec<PathBuf>) {
    if dir.starts_with(books_dir) {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    let mut entries: Vec<_> = entries.flatten().collect();
    entries.sort_by_key(|e| e.file_name());
    for entry in entries {
        let path = entry.path();
        let hidden = entry.file_name().to_string_lossy().starts_with('.');
        // file_type() does not follow symlinks, so link loops cannot trap the walk.
        match entry.file_type() {
            Ok(t) if t.is_dir() && !hidden => collect_books(&path, books_dir, out),
            Ok(t) if t.is_file() && !hidden && extension_of(&path).is_some_and(|ext| SUPPORTED_FORMATS.contains(&ext.as_str())) => {
                out.push(path);
            }
            _ => {}
        }
    }
}

/// A hashed file that needs copying in. `prepare` does the slow part
/// without the library.
#[derive(Debug)]
pub struct ImportJob {
    source: PathBuf,
    format: String,
    book_id: BookId,
    /// The title, if the library already knows this book.
    known: Option<String>,
    /// The cover this device already has for it.
    cover: Option<String>,
}

pub enum ImportPlan {
    Finished(ImportResult),
    Prepare(ImportJob),
}

pub struct PreparedImport {
    job: ImportJob,
    title: String,
    metadata: crate::epub::BookMetadata,
    stored: PathBuf,
    cover: Option<String>,
}

impl ImportJob {
    /// Reads the book's details, copies it into TBV's folder and saves its
    /// cover. Needs only the folders, so the library stays free meanwhile.
    pub fn prepare(self, paths: &LibraryPaths) -> Result<PreparedImport> {
        let metadata = if self.known.is_some() && self.cover.is_some() {
            crate::epub::BookMetadata::default()
        } else {
            read_metadata(&self.source, &self.format)?
        };
        let title = self.known.clone().or_else(|| metadata.title.clone()).unwrap_or_else(|| title_from_file_name(&self.source));
        let stored = copy_into_library(paths, &self.source, &title, &self.book_id, &self.format)?;
        let cover = match &self.cover {
            Some(cover) => Some(cover.clone()),
            None => save_cover(paths, &self.book_id, &metadata)?,
        };
        Ok(PreparedImport { job: self, title, metadata, stored, cover })
    }
}

fn save_cover(paths: &LibraryPaths, book_id: &BookId, metadata: &crate::epub::BookMetadata) -> Result<Option<String>> {
    let Some(cover) = &metadata.cover else {
        return Ok(None);
    };
    let cover_file = paths.covers_dir.join(format!("{}.{}", book_id_hex(book_id), cover.extension));
    fs::write(&cover_file, &cover.bytes)?;
    Ok(Some(cover_file.display().to_string()))
}

/// Copies via a temporary file and a rename, so a crash never leaves a
/// half-written book in the library folder.
fn copy_into_library(paths: &LibraryPaths, source: &Path, title: &str, book_id: &str, format: &str) -> Result<PathBuf> {
    let short = &book_id_hex(book_id)[..8];
    let name = format!("{} [{short}].{format}", safe_file_stem(title));
    let target = paths.books_dir.join(name);
    if target.exists() {
        return Ok(target);
    }
    // Unique per copy, so two imports of one book never share a temp file.
    let partial = target.with_extension(format!("{format}.{}.partial", crate::ids::new_record_id()));
    fs::copy(source, &partial)?;
    if let Err(e) = fs::rename(&partial, &target) {
        let _ = fs::remove_file(&partial);
        if !target.exists() {
            return Err(e.into());
        }
    }
    Ok(target)
}

fn extension_of(path: &Path) -> Option<String> {
    path.extension()
        .map(|e| e.to_string_lossy().to_ascii_lowercase())
}

fn title_from_file_name(path: &Path) -> String {
    path.file_stem()
        .map(|s| {
            s.to_string_lossy()
                .replace(['_', '.'], " ")
                .trim()
                .to_string()
        })
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "Untitled".into())
}

/// A file name that is valid on Windows, macOS and Linux.
fn safe_file_stem(title: &str) -> String {
    let cleaned: String = title
        .chars()
        .map(|c| {
            if "<>:\"/\\|?*".contains(c) || c.is_control() {
                ' '
            } else {
                c
            }
        })
        .collect();
    let collapsed = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    let trimmed: String = collapsed
        .trim_end_matches(['.', ' '])
        .chars()
        .take(80)
        .collect();
    if trimmed.is_empty() {
        "Untitled".into()
    } else {
        trimmed
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::epub::tests::write_test_epub;

    pub fn open_temp_library() -> (tempfile::TempDir, Library) {
        let dir = tempfile::tempdir().unwrap();
        let paths = LibraryPaths::new(&dir.path().join("data"), &dir.path().join("cache"));
        let library = Library::open(paths).unwrap();
        (dir, library)
    }

    #[test]
    fn one_book_imported_twice_at_once_is_added_once() {
        let (dir, mut library) = open_temp_library();
        let source = dir.path().join("Carmilla.epub");
        write_test_epub(&source, "Carmilla", "J. Sheridan Le Fanu", true);
        let id = book_id_for_file(&source).unwrap();
        let job = |library: &Library| match library.import_plan(&source, "epub", id.clone()).unwrap() {
            ImportPlan::Prepare(job) => job,
            ImportPlan::Finished(_) => panic!("nothing to do"),
        };
        // Both are planned before either finishes, as with two import threads.
        let (first, second) = (job(&library), job(&library));
        let paths = library.paths().clone();
        let (first, second) = (first.prepare(&paths).unwrap(), second.prepare(&paths).unwrap());
        assert!(matches!(library.finish_import(first).unwrap(), ImportResult::Imported { .. }));
        assert!(matches!(library.finish_import(second).unwrap(), ImportResult::AlreadyInLibrary { .. }));
        assert_eq!(library.title_of(&id).unwrap().as_deref(), Some("Carmilla"));
        assert!(library.has_local_file(&id).unwrap());
        assert!(matches!(library.import_plan(&source, "epub", id).unwrap(), ImportPlan::Finished(_)));
        let leftovers = fs::read_dir(&paths.books_dir).unwrap().flatten().filter(|e| e.path().to_string_lossy().ends_with(".partial")).count();
        assert_eq!(leftovers, 0);
    }

    #[test]
    fn shelves_that_repeat_smart_collections_are_retired() {
        let dir = tempfile::tempdir().unwrap();
        let paths = || LibraryPaths::new(&dir.path().join("data"), &dir.path().join("cache"));
        let library = Library::open(paths()).unwrap();
        library
            .conn
            .execute_batch(
                "INSERT INTO collections (id, name, created_at, updated_at, kind, pinned, position) VALUES
                    ('shelf:favorites', 'Favourites', '2026-01-01', '2026-01-01', 'shelf', 1, 1),
                    ('shelf:completed', 'Completed', '2026-01-01', '2026-01-01', 'shelf', 1, 4);
                 UPDATE collections SET name = 'To be read' WHERE id = 'shelf:want_to_read';",
            )
            .unwrap();
        drop(library);

        let library = Library::open(paths()).unwrap();
        let shelves: Vec<(String, String)> = library
            .conn
            .prepare("SELECT id, name FROM collections WHERE kind = 'shelf'")
            .unwrap()
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap();
        assert_eq!(shelves, [("shelf:want_to_read".to_string(), "Up next".to_string())]);
    }

    #[test]
    fn import_copies_file_and_leaves_original_untouched() {
        let (dir, mut library) = open_temp_library();
        let source = dir.path().join("dracula.epub");
        write_test_epub(&source, "Dracula", "Bram Stoker", true);
        let before = fs::read(&source).unwrap();

        let results = library.import_files(std::slice::from_ref(&source));
        let ImportResult::Imported { book_id, title, .. } = &results[0] else {
            panic!("unexpected {results:?}");
        };
        assert_eq!(title, "Dracula");
        assert!(book_id.starts_with("sha256:"));
        assert_eq!(fs::read(&source).unwrap(), before, "source must not change");

        let stored: String = library
            .conn
            .query_row(
                "SELECT path FROM local_files WHERE book_id = ?1",
                params![book_id],
                |r| r.get(0),
            )
            .unwrap();
        assert!(stored.starts_with(&library.paths.books_dir.display().to_string()));
        assert_eq!(fs::read(&stored).unwrap(), before);
    }

    #[test]
    fn importing_the_same_bytes_twice_is_one_book() {
        let (dir, mut library) = open_temp_library();
        let a = dir.path().join("a.epub");
        write_test_epub(&a, "Carmilla", "J. Sheridan Le Fanu", false);
        let b = dir.path().join("renamed copy.epub");
        fs::copy(&a, &b).unwrap();

        let results = library.import_files(&[a, b]);
        assert!(matches!(results[0], ImportResult::Imported { .. }));
        assert!(matches!(results[1], ImportResult::AlreadyInLibrary { .. }));
        let count: i64 = library
            .conn
            .query_row("SELECT COUNT(*) FROM books", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn a_drawn_cover_fills_in_once() {
        let (dir, mut library) = open_temp_library();
        let pdf = dir.path().join("Plain.pdf");
        fs::write(&pdf, "%PDF-1.4 fake").unwrap();
        let ImportResult::Imported { book_id, .. } = library.import_files(&[pdf]).remove(0) else {
            panic!()
        };
        let mut png = Vec::new();
        image::RgbImage::from_pixel(60, 1200, image::Rgb([200, 30, 30]))
            .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
            .unwrap();
        assert!(library.fill_cover(&book_id, &png).unwrap());
        let cover = library.cover_of(&book_id).unwrap().unwrap();
        assert!(cover.ends_with(".jpg"));
        assert_eq!(image::open(&cover).unwrap().height(), 900);
        // A cover that's already there stays.
        assert!(!library.fill_cover(&book_id, &png).unwrap());
        assert!(library.fill_cover("nope", &png).is_ok_and(|kept| !kept));
        assert!(library.fill_cover(&book_id, b"junk").is_ok());
    }

    #[test]
    fn every_kind_of_book_imports_with_its_details() {
        let (dir, mut library) = open_temp_library();
        let mobi = dir.path().join("x.azw3");
        fs::write(&mobi, crate::formats::mobi_sample("Bleak House", "Charles Dickens")).unwrap();
        let doc = dir.path().join("y.doc");
        fs::copy(Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/lamps.doc"), &doc).unwrap();
        let txt = dir.path().join("Night_Thoughts.txt");
        fs::write(&txt, "Chapter 1\n\nIt was night.").unwrap();
        let results = library.import_files(&[mobi, doc, txt]);
        let titles: Vec<_> = results
            .iter()
            .map(|r| match r {
                ImportResult::Imported { title, .. } => title.clone(),
                other => panic!("{other:?}"),
            })
            .collect();
        assert_eq!(titles, ["Bleak House", "Lamps at Dusk", "Night Thoughts"]);
        let ImportResult::Imported { book_id, .. } = &results[0] else { panic!() };
        assert!(library.cover_of(book_id).unwrap().is_some());
        let ImportResult::Imported { book_id, .. } = &results[1] else { panic!() };
        assert!(library.book_text(book_id).unwrap().contains("harbour wall"));
    }

    #[test]
    fn unsupported_and_broken_files_are_reported_not_fatal() {
        let (dir, mut library) = open_temp_library();
        let rtf = dir.path().join("notes.rtf");
        fs::write(&rtf, "hi").unwrap();
        let broken = dir.path().join("broken.epub");
        fs::write(&broken, "not a zip").unwrap();
        let pdf = dir.path().join("The_Night_Watch.pdf");
        fs::write(&pdf, "%PDF-1.4 fake").unwrap();

        let results = library.import_files(&[rtf, broken, pdf]);
        assert!(matches!(results[0], ImportResult::Unsupported { .. }));
        assert!(matches!(results[1], ImportResult::Failed { .. }));
        let ImportResult::Imported { title, .. } = &results[2] else {
            panic!("{results:?}")
        };
        assert_eq!(title, "The Night Watch");
    }

    #[test]
    fn a_library_from_before_sync_is_ready_to_send() {
        let dir = tempfile::tempdir().unwrap();
        let paths = LibraryPaths::new(&dir.path().join("data"), &dir.path().join("cache"));
        fs::create_dir_all(dir.path().join("data")).unwrap();
        {
            let conn = Connection::open(&paths.database).unwrap();
            for (i, sql) in MIGRATIONS.iter().take(5).enumerate() {
                conn.execute_batch(sql).unwrap();
                conn.pragma_update(None, "user_version", i + 1).unwrap();
            }
            conn.execute_batch(
                "INSERT INTO books (id, title, format, file_size, added_at, favorite, last_opened_at, status)
                 VALUES ('sha256:aa', 'Old', 'epub', 1, '2020-01-01T00:00:00.000Z', 1, '2021-01-01T00:00:00.000Z', 'in_progress');
                 INSERT INTO local_files (book_id, path) VALUES ('sha256:aa', '/books/old.epub');",
            )
            .unwrap();
        }
        let library = Library::open(paths).unwrap();
        let stamps: Vec<(String, String)> = library
            .conn
            .prepare("SELECT kind, changed_at FROM sync_clock WHERE pushed = 0 ORDER BY kind")
            .unwrap()
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap();
        assert_eq!(
            stamps,
            [
                ("book".into(), "2020-01-01T00:00:00.000Z".into()),
                ("book_progress".into(), "2021-01-01T00:00:00.000Z".into()),
                ("book_shelves".into(), "2020-01-01T00:00:00.000Z".into()),
            ]
        );
        // The file path survived the table's rebuild, and may now be empty.
        let path: Option<String> = library.conn.query_row("SELECT path FROM local_files", [], |r| r.get(0)).unwrap();
        assert_eq!(path.as_deref(), Some("/books/old.epub"));
        library.conn.execute("UPDATE local_files SET path = NULL", []).unwrap();
    }

    #[test]
    fn reopening_keeps_data_and_does_not_rerun_migrations() {
        let dir = tempfile::tempdir().unwrap();
        let paths = LibraryPaths::new(&dir.path().join("data"), &dir.path().join("cache"));
        let source = dir.path().join("b.epub");
        write_test_epub(&source, "Dracula", "Bram Stoker", false);
        Library::open(paths.clone())
            .unwrap()
            .import_files(&[source]);
        let library = Library::open(paths).unwrap();
        let count: i64 = library
            .conn
            .query_row("SELECT COUNT(*) FROM books", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn folders_are_searched_for_books_and_other_files_skipped() {
        let (dir, mut library) = open_temp_library();
        let folder = dir.path().join("Downloads");
        fs::create_dir_all(folder.join("Series/Book 2")).unwrap();
        fs::create_dir_all(folder.join(".hidden")).unwrap();
        write_test_epub(&folder.join("One.epub"), "One", "A", false);
        write_test_epub(&folder.join("Series/Book 2/Two.EPUB"), "Two", "A", false);
        write_test_epub(&folder.join(".hidden/Secret.epub"), "Secret", "A", false);
        fs::write(folder.join("cover.jpg"), b"not a book").unwrap();

        let results = library.import_files(&[folder]);
        let titles: Vec<_> = results
            .iter()
            .map(|r| match r {
                ImportResult::Imported { title, .. } => title.as_str(),
                other => panic!("{other:?}"),
            })
            .collect();
        assert_eq!(titles, ["One", "Two"]);

        // Importing TBV's own library folder adds nothing.
        let books_dir = library.paths().books_dir.clone();
        assert!(library.import_files(&[books_dir]).is_empty());
    }

    #[test]
    fn file_names_are_safe_everywhere() {
        assert_eq!(
            safe_file_stem("What? A: Story/Part 1."),
            "What A Story Part 1"
        );
        assert_eq!(safe_file_stem("   "), "Untitled");
    }
}

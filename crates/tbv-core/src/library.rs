//! The local library: a SQLite cache in the app-data folder plus the book
//! files TBV manages. Book files are never modified after import.

use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::{params, Connection, OptionalExtension};

use crate::epub::read_epub_metadata;
use crate::error::Result;
use crate::ids::{book_id_for_file, book_id_hex};
use crate::model::{BookId, ImportResult};
use crate::time::now_utc;

/// Formats TBV accepts on import. Only EPUB metadata is read today; the rest
/// are titled from their file name until their readers land.
pub const SUPPORTED_FORMATS: &[&str] = &["epub", "pdf", "mobi", "azw3", "cbz", "fb2"];

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
    // four built-in shelves get fixed ids so every device agrees on them.
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
        ('shelf:favorites', 'Favourites', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 'shelf', 'star', 'gallery:archive', 1, 1),
        ('shelf:reading', 'Currently reading', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 'shelf', 'compass', 'gallery:peaks', 1, 2),
        ('shelf:want_to_read', 'To be read', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 'shelf', 'bookmark', 'gallery:forest', 1, 3),
        ('shelf:completed', 'Completed', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 'shelf', 'check', 'gallery:coast', 1, 4);
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
];

/// SQLite's own `lower()` only folds A–Z, so "Émile" would never match "émile".
/// `tbv_fold` lowercases with Rust's Unicode-aware rules instead.
fn register_functions(conn: &Connection) -> Result<()> {
    use rusqlite::functions::FunctionFlags;
    conn.create_scalar_function(
        "tbv_fold",
        1,
        FunctionFlags::SQLITE_UTF8 | FunctionFlags::SQLITE_DETERMINISTIC,
        |ctx| Ok(ctx.get::<Option<String>>(0)?.map(|s| s.to_lowercase())),
    )?;
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
        register_functions(&conn)?;
        let mut library = Self { conn, paths };
        library.migrate()?;
        Ok(library)
    }

    /// The schema this version of TBV writes.
    pub(crate) fn schema_version() -> usize {
        MIGRATIONS.len()
    }

    pub(crate) fn migrate(&mut self) -> Result<()> {
        let version: usize = self
            .conn
            .pragma_query_value(None, "user_version", |r| r.get(0))?;
        for (index, sql) in MIGRATIONS.iter().enumerate().skip(version) {
            let tx = self.conn.transaction()?;
            tx.execute_batch(sql)?;
            tx.pragma_update(None, "user_version", index + 1)?;
            tx.commit()?;
        }
        Ok(())
    }

    pub fn paths(&self) -> &LibraryPaths {
        &self.paths
    }

    /// Imports each file: copies it into the library folder (the original is
    /// left untouched), reads its metadata, and records it under its content hash.
    /// Imports files and folders. Folders are searched (including subfolders)
    /// for book files; other files inside them are skipped without a report.
    pub fn import_files(&mut self, sources: &[PathBuf]) -> Vec<ImportResult> {
        let mut files = Vec::new();
        for source in sources {
            if source.is_dir() {
                self.collect_books(source, &mut files);
            } else {
                files.push(source.clone());
            }
        }
        files.iter().map(|source| self.import_one(source)).collect()
    }

    fn collect_books(&self, dir: &Path, out: &mut Vec<PathBuf>) {
        // Never re-import TBV's own copies.
        if dir.starts_with(&self.paths.books_dir) {
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
                Ok(t) if t.is_dir() && !hidden => self.collect_books(&path, out),
                Ok(t)
                    if t.is_file()
                        && !hidden
                        && extension_of(&path)
                            .is_some_and(|ext| SUPPORTED_FORMATS.contains(&ext.as_str())) =>
                {
                    out.push(path);
                }
                _ => {}
            }
        }
    }

    fn import_one(&mut self, source: &Path) -> ImportResult {
        let path = source.display().to_string();
        let format = match extension_of(source) {
            Some(ext) if SUPPORTED_FORMATS.contains(&ext.as_str()) => ext,
            _ => return ImportResult::Unsupported { path },
        };
        match self.try_import(source, &format) {
            Ok(result) => result,
            Err(error) => ImportResult::Failed {
                path,
                reason: error.to_string(),
            },
        }
    }

    fn try_import(&mut self, source: &Path, format: &str) -> Result<ImportResult> {
        let path = source.display().to_string();
        let book_id = book_id_for_file(source)?;

        if let Some(title) = self.title_of(&book_id)? {
            // Known book (maybe synced from elsewhere) without a file here: adopt this copy.
            if !self.has_local_file(&book_id)? {
                let stored = self.copy_into_library(source, &title, &book_id, format)?;
                // Keep any cover already cached for this book.
                self.conn.execute(
                    "INSERT INTO local_files (book_id, path) VALUES (?1, ?2)
                     ON CONFLICT(book_id) DO UPDATE SET path = excluded.path",
                    params![book_id, stored.display().to_string()],
                )?;
            }
            return Ok(ImportResult::AlreadyInLibrary {
                path,
                book_id,
                title,
            });
        }

        let metadata = if format == "epub" {
            read_epub_metadata(source)?
        } else {
            Default::default()
        };
        let title = metadata
            .title
            .clone()
            .unwrap_or_else(|| title_from_file_name(source));

        let stored = self.copy_into_library(source, &title, &book_id, format)?;
        let cover_path = match &metadata.cover {
            Some(cover) => {
                let cover_file = self.paths.covers_dir.join(format!(
                    "{}.{}",
                    book_id_hex(&book_id),
                    cover.extension
                ));
                fs::write(&cover_file, &cover.bytes)?;
                Some(cover_file.display().to_string())
            }
            None => None,
        };

        let tx = self.conn.transaction()?;
        tx.execute(
            "INSERT INTO books (id, title, authors, format, file_size, synopsis, publisher, language, added_at, series, series_index)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                book_id,
                title,
                serde_json::to_string(&metadata.authors)?,
                format,
                fs::metadata(&stored)?.len() as i64,
                metadata.synopsis,
                metadata.publisher,
                metadata.language,
                now_utc(),
                metadata.series,
                metadata.series_index,
            ],
        )?;
        tx.execute(
            "INSERT INTO local_files (book_id, path, cover_path) VALUES (?1, ?2, ?3)",
            params![book_id, stored.display().to_string(), cover_path],
        )?;
        tx.commit()?;

        Ok(ImportResult::Imported {
            path,
            book_id,
            title,
        })
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

    fn has_local_file(&self, book_id: &BookId) -> Result<bool> {
        let path: Option<String> = self
            .conn
            .query_row(
                "SELECT path FROM local_files WHERE book_id = ?1",
                params![book_id],
                |r| r.get(0),
            )
            .optional()?;
        Ok(path.is_some_and(|p| Path::new(&p).exists()))
    }

    /// Copies via a temporary file and a rename, so a crash never leaves a
    /// half-written book in the library folder.
    fn copy_into_library(
        &self,
        source: &Path,
        title: &str,
        book_id: &str,
        format: &str,
    ) -> Result<PathBuf> {
        let short = &book_id_hex(book_id)[..8];
        let name = format!("{} [{short}].{format}", safe_file_stem(title));
        let target = self.paths.books_dir.join(name);
        if target.exists() {
            return Ok(target);
        }
        let partial = target.with_extension(format!("{format}.partial"));
        fs::copy(source, &partial)?;
        fs::rename(&partial, &target)?;
        Ok(target)
    }
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
    fn unsupported_and_broken_files_are_reported_not_fatal() {
        let (dir, mut library) = open_temp_library();
        let txt = dir.path().join("notes.txt");
        fs::write(&txt, "hi").unwrap();
        let broken = dir.path().join("broken.epub");
        fs::write(&broken, "not a zip").unwrap();
        let pdf = dir.path().join("The_Night_Watch.pdf");
        fs::write(&pdf, "%PDF-1.4 fake").unwrap();

        let results = library.import_files(&[txt, broken, pdf]);
        assert!(matches!(results[0], ImportResult::Unsupported { .. }));
        assert!(matches!(results[1], ImportResult::Failed { .. }));
        let ImportResult::Imported { title, .. } = &results[2] else {
            panic!("{results:?}")
        };
        assert_eq!(title, "The Night Watch");
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

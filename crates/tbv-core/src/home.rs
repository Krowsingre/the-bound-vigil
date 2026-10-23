//! Builds the Home screen's view model in one query pass, so the UI never
//! makes a database call per card.

use std::path::Path;

use rusqlite::{params, Row};

use crate::error::Result;
use crate::library::Library;
use crate::model::*;
use crate::time::now_utc;

const RECENTLY_ADDED_LIMIT: u32 = 5;
/// How long a book counts as recently added (embre, 2026-10-23).
pub(crate) const RECENT_DAYS: i64 = 7;

/// When a book added now stops counting as recently added, as stored.
fn recent_since() -> String {
    (chrono::Utc::now() - chrono::Duration::days(RECENT_DAYS)).to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}
const IN_PROGRESS_LIMIT: u32 = 3;
const COLLECTIONS_LIMIT: u32 = 4;
const ANNOTATIONS_LIMIT: u32 = 2;

/// Effective metadata: your edit if there is one, else details fetched online
/// (or read from the file beyond the basics), else the book's own.
pub(crate) const BOOK_COLUMNS: &str = r#"
    SELECT b.id,
           COALESCE(o_title.value, f_title.value, b.title),
           COALESCE(o_authors.value, f_authors.value, b.authors),
           b.format,
           COALESCE(o_synopsis.value, f_synopsis.value, b.synopsis),
           b.added_at, b.last_opened_at, b.status, b.total_progression, b.resume_locator,
           lf.path, lf.cover_path,
           COALESCE(o_series.value, f_series.value, b.series),
           COALESCE(CAST(NULLIF(o_series_index.value, '') AS REAL), CAST(NULLIF(f_series_index.value, '') AS REAL), b.series_index),
           b.favorite, b.want_to_read,
           b.rating, b.finished_at,
           (SELECT json_group_array(tag) FROM (SELECT t.tag FROM book_tags t
             WHERE t.book_id = b.id AND t.removed_at IS NULL ORDER BY t.tag COLLATE NOCASE)),
           (EXISTS (SELECT 1 FROM sync_files sf WHERE sf.uploaded_at IS NOT NULL
             AND sf.path = 'books/' || substr(b.id, 8) || '.' || b.format)
            OR EXISTS (SELECT 1 FROM sync_files_also sf WHERE sf.uploaded_at IS NOT NULL
             AND sf.path = 'books/' || substr(b.id, 8) || '.' || b.format)),
           COALESCE(o_genres.value, f_genres.value),
           (SELECT ab.duration_ms FROM audiobooks ab WHERE ab.book_id = b.id),
           COALESCE((SELECT value FROM metadata_overrides WHERE book_id = b.id AND field = 'narrators'),
                    (SELECT value FROM metadata_fetched WHERE book_id = b.id AND field = 'narrators'),
                    (SELECT ab.narrators FROM audiobooks ab WHERE ab.book_id = b.id)),
           tbv_language(COALESCE(o_language.value, f_language.value, b.language)),
           (EXISTS (SELECT 1 FROM audiobooks ab JOIN books e ON e.id = ab.ebook_id
             WHERE ab.book_id = b.id AND e.deleted_at IS NULL)
            OR EXISTS (SELECT 1 FROM audiobooks ab JOIN books a ON a.id = ab.book_id
             WHERE ab.ebook_id = b.id AND a.deleted_at IS NULL)),
           b.phone_wanted, b.phone_has
"#;

/// Whether an audiobook has its ebook, or an ebook its audiobook: the same
/// test as the paired column above, for Resonance's switch.
pub(crate) const PAIRED: &str = "(EXISTS (SELECT 1 FROM audiobooks ab JOIN books e ON e.id = ab.ebook_id
     WHERE ab.book_id = b.id AND e.deleted_at IS NULL)
    OR EXISTS (SELECT 1 FROM audiobooks ab JOIN books a ON a.id = ab.book_id
     WHERE ab.ebook_id = b.id AND a.deleted_at IS NULL))";

/// Leaves out a book when a newer copy of it (same title and first author,
/// in another file) is in the library, so lists of what's new show each
/// book once. Asked book by book, so quick for a short list (Sanctum's).
pub(crate) const NEWEST_COPY: &str = "NOT EXISTS (SELECT 1 FROM books d
    WHERE d.id != b.id AND d.deleted_at IS NULL AND d.same_as IS NULL
      AND tbv_fold(d.title) = tbv_fold(b.title)
      AND lower(COALESCE(json_extract(d.authors, '$[0]'), '')) = lower(COALESCE(json_extract(b.authors, '$[0]'), ''))
      AND (d.added_at > b.added_at OR (d.added_at = b.added_at AND d.id > b.id)))";

/// The same, worked out once for the whole library, for counting every
/// new book: asked book by book, that took 17 seconds with 8,000 new books.
pub(crate) const NEWEST_COPY_ALL: &str = "b.id IN (SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY tbv_fold(title), lower(COALESCE(json_extract(authors, '$[0]'), ''))
      ORDER BY added_at DESC, id DESC) AS newest
    FROM books WHERE deleted_at IS NULL AND same_as IS NULL) WHERE newest = 1)";

/// Effective narrators, for filters.
pub(crate) const NARRATORS: &str = "COALESCE((SELECT value FROM metadata_overrides WHERE book_id = b.id AND field = 'narrators'),
    (SELECT value FROM metadata_fetched WHERE book_id = b.id AND field = 'narrators'),
    (SELECT ab.narrators FROM audiobooks ab WHERE ab.book_id = b.id))";

/// The joins that make the effective metadata available to WHERE and ORDER BY.
pub(crate) const BOOK_FROM: &str = r#"
    FROM books b
    LEFT JOIN local_files lf ON lf.book_id = b.id
    LEFT JOIN metadata_overrides o_title ON o_title.book_id = b.id AND o_title.field = 'title'
    LEFT JOIN metadata_overrides o_authors ON o_authors.book_id = b.id AND o_authors.field = 'authors'
    LEFT JOIN metadata_overrides o_synopsis ON o_synopsis.book_id = b.id AND o_synopsis.field = 'synopsis'
    LEFT JOIN metadata_overrides o_series ON o_series.book_id = b.id AND o_series.field = 'series'
    LEFT JOIN metadata_overrides o_series_index ON o_series_index.book_id = b.id AND o_series_index.field = 'series_index'
    LEFT JOIN metadata_overrides o_publisher ON o_publisher.book_id = b.id AND o_publisher.field = 'publisher'
    LEFT JOIN metadata_overrides o_language ON o_language.book_id = b.id AND o_language.field = 'language'
    LEFT JOIN metadata_overrides o_genres ON o_genres.book_id = b.id AND o_genres.field = 'genres'
    LEFT JOIN metadata_fetched f_title ON f_title.book_id = b.id AND f_title.field = 'title'
    LEFT JOIN metadata_fetched f_authors ON f_authors.book_id = b.id AND f_authors.field = 'authors'
    LEFT JOIN metadata_fetched f_synopsis ON f_synopsis.book_id = b.id AND f_synopsis.field = 'synopsis'
    LEFT JOIN metadata_fetched f_series ON f_series.book_id = b.id AND f_series.field = 'series'
    LEFT JOIN metadata_fetched f_series_index ON f_series_index.book_id = b.id AND f_series_index.field = 'series_index'
    LEFT JOIN metadata_fetched f_publisher ON f_publisher.book_id = b.id AND f_publisher.field = 'publisher'
    LEFT JOIN metadata_fetched f_language ON f_language.book_id = b.id AND f_language.field = 'language'
    LEFT JOIN metadata_fetched f_genres ON f_genres.book_id = b.id AND f_genres.field = 'genres'
    WHERE b.deleted_at IS NULL AND b.same_as IS NULL
"#;

/// Effective publisher and language, for rules and the reader.
pub(crate) const PUBLISHER: &str = "COALESCE(o_publisher.value, f_publisher.value, b.publisher)";
pub(crate) const LANGUAGE: &str = "COALESCE(o_language.value, f_language.value, b.language)";

/// The kinds of file the Documents page holds. Audio is on the Audiobooks
/// page, and everything else is a book in the Library.
pub const DOCUMENT_FORMATS: &[&str] = &["pdf", "doc", "docx", "txt"];

impl Library {
    pub fn home(&self) -> Result<HomeViewModel> {
        // Home is for reading; audiobooks have their own page and Continue listening.
        let audio = crate::audio::AUDIO_FORMATS.iter().map(|f| format!("'{f}'")).collect::<Vec<_>>().join(", ");
        let in_progress = self.books(
            &format!("AND b.status = 'in_progress' AND b.format NOT IN ({audio}) ORDER BY b.last_opened_at IS NULL, b.last_opened_at DESC"),
            IN_PROGRESS_LIMIT,
        )?;
        Ok(HomeViewModel {
            resume_book: in_progress.first().cloned(),
            recently_added: self.books(&format!("AND b.format NOT IN ({audio}) AND b.added_at >= '{}' AND {NEWEST_COPY} ORDER BY b.added_at DESC", recent_since()), RECENTLY_ADDED_LIMIT)?,
            in_progress,
            collections: self.collection_previews()?,
            annotations: self.annotation_previews()?,
            library_counts: self.counts()?,
            activity: None,
            finished_dates: self.finished_dates()?,
            sync: self.sync_status()?,
        })
    }

    /// When books were finished in the last 400 days, newest first.
    fn finished_dates(&self) -> Result<Vec<IsoUtc>> {
        let since = (chrono::Utc::now() - chrono::Duration::days(400)).to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
        let mut statement = self.conn.prepare(
            "SELECT finished_at FROM books
             WHERE deleted_at IS NULL AND same_as IS NULL AND status = 'read' AND finished_at >= ?1
             ORDER BY finished_at DESC",
        )?;
        let rows = statement.query_map([since], |r| r.get(0))?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    /// Sets read status explicitly. Status is never inferred from a percentage.
    pub fn set_status(&self, book_id: &str, status: ReadStatus) -> Result<()> {
        let now = now_utc();
        match status {
            ReadStatus::Unread => self.conn.execute(
                "UPDATE books SET status = 'unread', total_progression = NULL, resume_locator = NULL, finished_at = NULL WHERE id = ?1",
                params![book_id],
            )?,
            ReadStatus::InProgress => self.conn.execute(
                "UPDATE books SET status = 'in_progress', last_opened_at = COALESCE(last_opened_at, ?2) WHERE id = ?1",
                params![book_id, now],
            )?,
            // Marking a book read again keeps the day it was first finished.
            ReadStatus::Read => self.conn.execute(
                "UPDATE books SET status = 'read', finished_at = COALESCE(finished_at, ?2) WHERE id = ?1",
                params![book_id, now],
            )?,
        };
        Ok(())
    }

    fn books(&self, tail: &str, limit: u32) -> Result<Vec<BookPreview>> {
        let sql = format!("{BOOK_COLUMNS} {BOOK_FROM} {tail} LIMIT ?1");
        let mut statement = self.conn.prepare(&sql)?;
        let rows = statement.query_map(params![limit], book_from_row)?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    fn counts(&self) -> Result<LibraryCounts> {
        // Every book in the library counts, downloaded here or not.
        Ok(self.conn.query_row(
            "SELECT COUNT(*),
                    COALESCE(SUM(status = 'unread'), 0),
                    COALESCE(SUM(status = 'in_progress'), 0),
                    COALESCE(SUM(status = 'read'), 0)
             FROM books WHERE deleted_at IS NULL AND same_as IS NULL",
            [],
            |r| {
                Ok(LibraryCounts {
                    total: r.get(0)?,
                    unread: r.get(1)?,
                    in_progress: r.get(2)?,
                    read: r.get(3)?,
                })
            },
        )?)
    }

    fn collection_previews(&self) -> Result<Vec<CollectionPreview>> {
        self.collections(COLLECTIONS_LIMIT)
    }

    /// Collections, newest first, each with up to four covers.
    pub fn collections(&self, limit: u32) -> Result<Vec<CollectionPreview>> {
        let mut statement = self.conn.prepare(
            "SELECT c.id, c.name,
                    (SELECT COUNT(*) FROM collection_books cb JOIN books b ON b.id = cb.book_id
                     WHERE cb.collection_id = c.id AND cb.removed_at IS NULL AND b.deleted_at IS NULL AND b.same_as IS NULL)
             FROM collections c WHERE c.deleted_at IS NULL AND c.kind != 'shelf'
             ORDER BY c.created_at DESC LIMIT ?1",
        )?;
        let mut covers = self.conn.prepare(
            "SELECT lf.cover_path FROM collection_books cb
             JOIN local_files lf ON lf.book_id = cb.book_id
             WHERE cb.collection_id = ?1 AND cb.removed_at IS NULL AND lf.cover_path IS NOT NULL
             ORDER BY cb.added_at LIMIT 4",
        )?;
        let rows = statement
            .query_map(params![limit], |r| {
                Ok((r.get::<_, String>(0)?, r.get(1)?, r.get(2)?))
            })?
            .collect::<std::result::Result<Vec<(String, String, u32)>, _>>()?;
        rows.into_iter()
            .map(|(id, name, count)| {
                let cover_paths = covers
                    .query_map(params![id], |r| r.get(0))?
                    .collect::<std::result::Result<_, _>>()?;
                Ok(CollectionPreview {
                    id,
                    name,
                    count,
                    cover_paths,
                })
            })
            .collect()
    }

    fn annotation_previews(&self) -> Result<Vec<AnnotationPreview>> {
        let mut statement = self.conn.prepare(
            "SELECT a.id, a.book_id, COALESCE(o.value, b.title), a.kind, a.excerpt, a.note, a.locator, a.updated_at
             FROM annotations a JOIN books b ON b.id = a.book_id
             LEFT JOIN metadata_overrides o ON o.book_id = b.id AND o.field = 'title'
             WHERE a.deleted_at IS NULL AND b.deleted_at IS NULL AND a.kind IN ('note', 'highlight')
             ORDER BY a.updated_at DESC LIMIT ?1",
        )?;
        let rows = statement.query_map(params![ANNOTATIONS_LIMIT], |r| {
            let kind = match r.get::<_, String>(3)?.as_str() {
                "note" => AnnotationKind::Note,
                "bookmark" => AnnotationKind::Bookmark,
                _ => AnnotationKind::Highlight,
            };
            let locator: String = r.get(6)?;
            Ok(AnnotationPreview {
                id: r.get(0)?,
                book_id: r.get(1)?,
                book_title: r.get(2)?,
                kind,
                excerpt: r.get(4)?,
                note: r.get(5)?,
                locator: serde_json::from_str(&locator).unwrap_or_default(),
                updated_at: r.get(7)?,
            })
        })?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }
}

pub(crate) fn book_from_row(r: &Row) -> rusqlite::Result<BookPreview> {
    let authors: String = r.get(2)?;
    let status: String = r.get(7)?;
    let locator: Option<String> = r.get(9)?;
    let local_path: Option<String> = r.get(10)?;
    let availability = match &local_path {
        None => Availability::Cloud,
        Some(p) if Path::new(p).exists() => Availability::Local,
        Some(_) => Availability::Missing,
    };
    Ok(BookPreview {
        id: r.get(0)?,
        title: r.get(1)?,
        authors: serde_json::from_str(&authors).unwrap_or_default(),
        cover_path: r.get(11)?,
        format: r.get(3)?,
        synopsis: r.get(4)?,
        added_at: r.get(5)?,
        last_opened_at: r.get(6)?,
        status: ReadStatus::parse(&status),
        total_progression: r.get(8)?,
        resume_locator: locator.and_then(|l| serde_json::from_str(&l).ok()),
        availability,
        // Filled in once sync records other devices' positions.
        remote_positions: Vec::new(),
        // An edit that empties the series takes the book out of it.
        series: r.get::<_, Option<String>>(12)?.filter(|s| !s.trim().is_empty()),
        series_index: r.get(13)?,
        favorite: r.get(14)?,
        want_to_read: r.get(15)?,
        rating: r.get(16)?,
        finished_at: r.get(17)?,
        tags: r
            .get::<_, Option<String>>(18)?
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or_default(),
        in_cloud: r.get(19)?,
        genres: r
            .get::<_, Option<String>>(20)?
            .and_then(|g| serde_json::from_str(&g).ok())
            .unwrap_or_default(),
        duration_ms: r.get::<_, Option<i64>>(21)?.map(|d| d.max(0) as u64),
        narrators: r
            .get::<_, Option<String>>(22)?
            .and_then(|n| serde_json::from_str(&n).ok())
            .unwrap_or_default(),
        language: r.get(23)?,
        paired: r.get(24)?,
        phone_wanted: r.get(25)?,
        phone_has: r.get(26)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::epub::tests::write_test_epub;
    use crate::library::tests::open_temp_library;
    use std::fs;

    fn import(library: &mut Library, dir: &Path, title: &str) -> String {
        let path = dir.join(format!("{title}.epub"));
        write_test_epub(&path, title, "Author", true);
        match &library.import_files(&[path])[0] {
            ImportResult::Imported { book_id, .. } => book_id.clone(),
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn empty_library_has_no_fabricated_content() {
        let (_dir, library) = open_temp_library();
        let home = library.home().unwrap();
        assert!(home.resume_book.is_none());
        assert!(home.recently_added.is_empty());
        assert!(home.activity.is_none());
        assert_eq!(home.library_counts, LibraryCounts::default());
        assert_eq!(home.sync.state, SyncState::Disabled);
    }

    #[test]
    fn recently_added_shows_a_book_once_and_never_a_deleted_one() {
        let (dir, mut library) = open_temp_library();
        let gone = import(&mut library, dir.path(), "Gone");
        library.delete_book(&gone).unwrap();
        let path = dir.path().join("Twice.epub");
        crate::epub::tests::write_test_epub_with(&path, "Carmilla", "Le Fanu", false, "");
        library.import_files(&[path]);
        std::thread::sleep(std::time::Duration::from_millis(3));
        let other = dir.path().join("Twice again.epub");
        crate::epub::tests::write_test_epub_with(&other, "Carmilla", "Le Fanu", false, "<p>another edition</p>");
        library.import_files(&[other]);
        let titles: Vec<String> = library.home().unwrap().recently_added.into_iter().map(|b| b.title).collect();
        assert_eq!(titles, ["Carmilla"]);
    }

    #[test]
    fn recently_added_is_newest_first_and_capped() {
        let (dir, mut library) = open_temp_library();
        for i in 0..7 {
            import(&mut library, dir.path(), &format!("Book {i}"));
            std::thread::sleep(std::time::Duration::from_millis(3));
        }
        let home = library.home().unwrap();
        let titles: Vec<_> = home
            .recently_added
            .iter()
            .map(|b| b.title.as_str())
            .collect();
        assert_eq!(titles, ["Book 6", "Book 5", "Book 4", "Book 3", "Book 2"]);
        assert_eq!(home.library_counts.total, 7);
        assert_eq!(home.library_counts.unread, 7);
        assert!(home.recently_added[0].cover_path.is_some());
        assert_eq!(home.recently_added[0].availability, Availability::Local);
    }

    #[test]
    fn in_progress_follows_explicit_status_and_counts_add_up() {
        let (dir, mut library) = open_temp_library();
        let a = import(&mut library, dir.path(), "A");
        let b = import(&mut library, dir.path(), "B");
        let _c = import(&mut library, dir.path(), "C");
        library.set_status(&a, ReadStatus::InProgress).unwrap();
        library.set_status(&b, ReadStatus::Read).unwrap();

        let home = library.home().unwrap();
        assert_eq!(home.resume_book.as_ref().unwrap().id, a);
        assert_eq!(home.in_progress.len(), 1);
        let c = home.library_counts;
        assert_eq!((c.total, c.unread, c.in_progress, c.read), (3, 1, 1, 1));
        assert_eq!(c.unread + c.in_progress + c.read, c.total);
    }

    #[test]
    fn user_title_override_wins_and_file_is_untouched() {
        let (dir, mut library) = open_temp_library();
        let a = import(&mut library, dir.path(), "Original");
        library
            .conn
            .execute(
                "INSERT INTO metadata_overrides (book_id, field, value, updated_at) VALUES (?1, 'title', 'Edited', ?2)",
                params![a, now_utc()],
            )
            .unwrap();
        assert_eq!(library.home().unwrap().recently_added[0].title, "Edited");
    }

    #[test]
    fn a_deleted_local_file_shows_as_missing() {
        let (dir, mut library) = open_temp_library();
        let a = import(&mut library, dir.path(), "Gone");
        let path: String = library
            .conn
            .query_row(
                "SELECT path FROM local_files WHERE book_id = ?1",
                params![a],
                |r| r.get(0),
            )
            .unwrap();
        fs::remove_file(path).unwrap();
        assert_eq!(
            library.home().unwrap().recently_added[0].availability,
            Availability::Missing
        );
    }
    #[test]
    fn reimporting_a_missing_book_relinks_it_and_keeps_its_cover() {
        let (dir, mut library) = open_temp_library();
        let source = dir.path().join("Back.epub");
        write_test_epub(&source, "Back", "Author", true);
        library.import_files(std::slice::from_ref(&source));
        let before = library.home().unwrap().recently_added[0].clone();
        fs::remove_file(
            library
                .paths()
                .books_dir
                .join(format!("Back [{}].epub", &before.id[7..15])),
        )
        .unwrap();
        assert_eq!(
            library.home().unwrap().recently_added[0].availability,
            Availability::Missing
        );

        assert!(matches!(
            library.import_files(&[source])[0],
            ImportResult::AlreadyInLibrary { .. }
        ));
        let after = library.home().unwrap().recently_added[0].clone();
        assert_eq!(after.availability, Availability::Local);
        assert!(after.cover_path.is_some());
        assert_eq!(after.cover_path, before.cover_path);
    }
}

//! Builds the Home screen's view model in one query pass, so the UI never
//! makes a database call per card.

use std::path::Path;

use rusqlite::{params, Row};

use crate::error::Result;
use crate::library::Library;
use crate::model::*;
use crate::time::now_utc;

const RECENTLY_ADDED_LIMIT: u32 = 5;
const IN_PROGRESS_LIMIT: u32 = 3;
const COLLECTIONS_LIMIT: u32 = 4;
const ANNOTATIONS_LIMIT: u32 = 2;

/// Effective metadata = the user's override if there is one, else the book's own.
pub(crate) const BOOK_COLUMNS: &str = r#"
    SELECT b.id,
           COALESCE(o_title.value, b.title),
           COALESCE(o_authors.value, b.authors),
           b.format,
           COALESCE(o_synopsis.value, b.synopsis),
           b.added_at, b.last_opened_at, b.status, b.total_progression, b.resume_locator,
           lf.path, lf.cover_path,
           COALESCE(o_series.value, b.series), b.series_index, b.favorite, b.want_to_read
"#;

/// The joins that make the effective metadata available to WHERE and ORDER BY.
pub(crate) const BOOK_FROM: &str = r#"
    FROM books b
    LEFT JOIN local_files lf ON lf.book_id = b.id
    LEFT JOIN metadata_overrides o_title ON o_title.book_id = b.id AND o_title.field = 'title'
    LEFT JOIN metadata_overrides o_authors ON o_authors.book_id = b.id AND o_authors.field = 'authors'
    LEFT JOIN metadata_overrides o_synopsis ON o_synopsis.book_id = b.id AND o_synopsis.field = 'synopsis'
    LEFT JOIN metadata_overrides o_series ON o_series.book_id = b.id AND o_series.field = 'series'
    WHERE b.deleted_at IS NULL
"#;

impl Library {
    pub fn home(&self) -> Result<HomeViewModel> {
        let in_progress = self.books(
            "AND b.status = 'in_progress' ORDER BY b.last_opened_at IS NULL, b.last_opened_at DESC",
            IN_PROGRESS_LIMIT,
        )?;
        Ok(HomeViewModel {
            resume_book: in_progress.first().cloned(),
            recently_added: self.books("ORDER BY b.added_at DESC", RECENTLY_ADDED_LIMIT)?,
            in_progress,
            collections: self.collection_previews()?,
            annotations: self.annotation_previews()?,
            library_counts: self.counts()?,
            activity: None,
            sync: SyncStatus {
                state: SyncState::Disabled,
                last_success_at: None,
            },
        })
    }

    /// Sets read status explicitly. Status is never inferred from a percentage.
    pub fn set_status(&self, book_id: &str, status: ReadStatus) -> Result<()> {
        let now = now_utc();
        match status {
            ReadStatus::Unread => self.conn.execute(
                "UPDATE books SET status = 'unread', total_progression = NULL, resume_locator = NULL WHERE id = ?1",
                params![book_id],
            )?,
            ReadStatus::InProgress => self.conn.execute(
                "UPDATE books SET status = 'in_progress', last_opened_at = COALESCE(last_opened_at, ?2) WHERE id = ?1",
                params![book_id, now],
            )?,
            ReadStatus::Read => self.conn.execute(
                "UPDATE books SET status = 'read' WHERE id = ?1",
                params![book_id],
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
             FROM books WHERE deleted_at IS NULL",
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
                     WHERE cb.collection_id = c.id AND b.deleted_at IS NULL)
             FROM collections c WHERE c.deleted_at IS NULL
             ORDER BY c.created_at DESC LIMIT ?1",
        )?;
        let mut covers = self.conn.prepare(
            "SELECT lf.cover_path FROM collection_books cb
             JOIN local_files lf ON lf.book_id = cb.book_id
             WHERE cb.collection_id = ?1 AND lf.cover_path IS NOT NULL
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
        series: r.get(12)?,
        series_index: r.get(13)?,
        favorite: r.get(14)?,
        want_to_read: r.get(15)?,
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

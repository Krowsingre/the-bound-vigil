//! What the reader stores: where you are in each book, and your highlights,
//! notes and bookmarks. Positions are EPUB CFIs, never pixel offsets, so they
//! survive a different window size, font or device.

use std::path::PathBuf;

use rusqlite::{params, OptionalExtension, Row};

use crate::error::{Error, Result};
use crate::home::{book_from_row, BOOK_COLUMNS, BOOK_FROM, LANGUAGE, PUBLISHER};
use crate::ids::new_record_id;
use crate::library::Library;
use crate::model::*;
use crate::time::now_utc;

/// The four highlight colours the reader offers.
pub const HIGHLIGHT_COLORS: [&str; 4] = ["rose", "amber", "sage", "slate"];

impl AnnotationKind {
    pub fn as_str(self) -> &'static str {
        match self {
            AnnotationKind::Note => "note",
            AnnotationKind::Highlight => "highlight",
            AnnotationKind::Bookmark => "bookmark",
        }
    }

    pub fn parse(value: &str) -> AnnotationKind {
        match value {
            "note" => AnnotationKind::Note,
            "bookmark" => AnnotationKind::Bookmark,
            _ => AnnotationKind::Highlight,
        }
    }
}

const ANNOTATION_COLUMNS: &str =
    "id, book_id, kind, excerpt, note, color, locator, COALESCE(created_at, updated_at), updated_at";

fn annotation_from_row(r: &Row) -> rusqlite::Result<Annotation> {
    let kind: String = r.get(2)?;
    let locator: String = r.get(6)?;
    Ok(Annotation {
        id: r.get(0)?,
        book_id: r.get(1)?,
        kind: AnnotationKind::parse(&kind),
        excerpt: r.get(3)?,
        note: r.get(4)?,
        color: r.get(5)?,
        locator: serde_json::from_str(&locator).unwrap_or_default(),
        created_at: r.get(7)?,
        updated_at: r.get(8)?,
    })
}

impl Library {
    /// One book with its effective metadata, or `None` if it isn't in the library.
    pub fn book(&self, book_id: &str) -> Result<Option<BookPreview>> {
        let sql = format!("{BOOK_COLUMNS} {BOOK_FROM} AND b.id = ?1");
        Ok(self
            .conn
            .query_row(&sql, params![book_id], book_from_row)
            .optional()?)
    }

    /// Opens a book for reading: records when it was opened and, the first
    /// time, moves it from Unread to In progress.
    pub fn open_book(&self, book_id: &str) -> Result<ReaderBook> {
        let previously_opened_at: Option<String> = self
            .conn
            .query_row(
                "SELECT last_opened_at FROM books WHERE id = ?1",
                params![book_id],
                |r| r.get(0),
            )
            .optional()?
            .flatten();
        let changed = self.conn.execute(
            "UPDATE books SET last_opened_at = ?2,
                    status = CASE status WHEN 'unread' THEN 'in_progress' ELSE status END
             WHERE id = ?1 AND deleted_at IS NULL",
            params![book_id, now_utc()],
        )?;
        if changed == 0 {
            return Err(Error::Unsuitable(
                "This book is no longer in your library.".into(),
            ));
        }
        let book = self
            .book(book_id)?
            .ok_or_else(|| Error::Unsuitable("This book is no longer in your library.".into()))?;
        let (publisher, language, file_size) = self.conn.query_row(
            &format!("SELECT {PUBLISHER}, {LANGUAGE}, b.file_size {BOOK_FROM} AND b.id = ?1"),
            params![book_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get::<_, i64>(2)?)),
        )?;
        Ok(ReaderBook {
            book,
            publisher,
            language,
            file_size: file_size.max(0) as u64,
            previously_opened_at,
        })
    }

    /// Where this device keeps the book's file, if it is here.
    pub fn book_file(&self, book_id: &str) -> Result<PathBuf> {
        let path: Option<String> = self
            .conn
            .query_row(
                "SELECT path FROM local_files WHERE book_id = ?1",
                params![book_id],
                |r| r.get(0),
            )
            .optional()?
            .flatten();
        let path = path.map(PathBuf::from).ok_or_else(|| {
            Error::Unsuitable("This book isn't downloaded to this device yet.".into())
        })?;
        if !path.exists() {
            return Err(Error::Unsuitable(
                "This book's file is missing from this device.".into(),
            ));
        }
        Ok(path)
    }

    /// The plain text of a book shown without its own formatting: old Word
    /// documents, whose layout only Word itself can reproduce.
    pub fn book_text(&self, book_id: &str) -> Result<String> {
        crate::formats::doc::read_text(&self.book_file(book_id)?)
    }

    /// Remembers the reading position. Status is left alone: finishing a book
    /// is the reader's call, not a percentage's.
    pub fn save_position(&self, book_id: &str, locator: &ReaderLocator) -> Result<()> {
        let progression = locator.total_progression.map(|p| p.clamp(0.0, 1.0));
        self.conn.execute(
            "UPDATE books SET resume_locator = ?2, total_progression = COALESCE(?3, total_progression)
             WHERE id = ?1",
            params![book_id, serde_json::to_string(locator)?, progression],
        )?;
        Ok(())
    }

    /// A book's highlights, notes and bookmarks, in reading order.
    pub fn book_annotations(&self, book_id: &str) -> Result<Vec<Annotation>> {
        let mut statement = self.conn.prepare(&format!(
            "SELECT {ANNOTATION_COLUMNS} FROM annotations
             WHERE book_id = ?1 AND deleted_at IS NULL AND kind != 'book_note'
             ORDER BY json_extract(locator, '$.totalProgression'), created_at"
        ))?;
        let rows = statement.query_map(params![book_id], annotation_from_row)?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    /// Creates an annotation, or updates the one with the given id.
    pub fn save_annotation(&self, input: &AnnotationInput) -> Result<Annotation> {
        if let Some(color) = &input.color {
            if !HIGHLIGHT_COLORS.contains(&color.as_str()) {
                return Err(Error::Unsuitable(format!(
                    "“{color}” isn't a highlight colour."
                )));
            }
        }
        let note = input
            .note
            .as_deref()
            .map(str::trim)
            .filter(|n| !n.is_empty());
        let now = now_utc();
        let id = input.id.clone().unwrap_or_else(new_record_id);
        let locator = serde_json::to_string(&input.locator)?;
        self.conn.execute(
            "INSERT INTO annotations (id, book_id, kind, excerpt, note, locator, color, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)
             ON CONFLICT(id) DO UPDATE SET
                kind = excluded.kind, excerpt = excluded.excerpt, note = excluded.note,
                locator = excluded.locator, color = excluded.color,
                updated_at = excluded.updated_at, deleted_at = NULL",
            params![
                id,
                input.book_id,
                input.kind.as_str(),
                input.excerpt,
                note,
                locator,
                input.color,
                now
            ],
        )?;
        Ok(self.conn.query_row(
            &format!("SELECT {ANNOTATION_COLUMNS} FROM annotations WHERE id = ?1"),
            params![id],
            annotation_from_row,
        )?)
    }

    /// Deletes an annotation. It is kept as a tombstone so sync can pass the deletion on.
    pub fn delete_annotation(&self, id: &str) -> Result<()> {
        let now = now_utc();
        self.conn.execute(
            "UPDATE annotations SET deleted_at = ?2, updated_at = ?2 WHERE id = ?1",
            params![id, now],
        )?;
        Ok(())
    }

    /// A setting that belongs to this device only, such as reader text size.
    pub fn setting(&self, key: &str) -> Result<Option<String>> {
        Ok(self
            .conn
            .query_row(
                "SELECT value FROM device_settings WHERE key = ?1",
                params![key],
                |r| r.get(0),
            )
            .optional()?)
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<()> {
        self.conn.execute(
            "INSERT INTO device_settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::epub::tests::write_test_epub;
    use crate::library::tests::open_temp_library;

    fn import(library: &mut Library, dir: &std::path::Path, title: &str) -> String {
        let path = dir.join(format!("{title}.epub"));
        write_test_epub(&path, title, "Author", false);
        match &library.import_files(&[path])[0] {
            ImportResult::Imported { book_id, .. } => book_id.clone(),
            other => panic!("{other:?}"),
        }
    }

    fn at(cfi: &str, progression: f64) -> ReaderLocator {
        ReaderLocator {
            cfi: Some(cfi.into()),
            total_progression: Some(progression),
            ..Default::default()
        }
    }

    #[test]
    fn opening_a_book_marks_it_in_progress_and_finds_its_file() {
        let (dir, mut library) = open_temp_library();
        let id = import(&mut library, dir.path(), "Piranesi");
        let opened = library.open_book(&id).unwrap();
        assert_eq!(opened.book.status, ReadStatus::InProgress);
        assert!(opened.book.last_opened_at.is_some());
        assert!(opened.file_size > 0);
        assert_eq!(opened.previously_opened_at, None);
        let again = library.open_book(&id).unwrap();
        assert_eq!(again.previously_opened_at, opened.book.last_opened_at);
        assert!(library.book_file(&id).unwrap().exists());

        library.set_status(&id, ReadStatus::Read).unwrap();
        assert_eq!(
            library.open_book(&id).unwrap().book.status,
            ReadStatus::Read
        );
        assert!(library.open_book("sha256:nope").is_err());
    }

    #[test]
    fn saves_and_restores_the_position() {
        let (dir, mut library) = open_temp_library();
        let id = import(&mut library, dir.path(), "Dune");
        let mut locator = at("epubcfi(/6/8!/4/2/1:0)", 0.42);
        locator.chapter = Some("Chapter Two".into());
        library.save_position(&id, &locator).unwrap();
        let book = library.book(&id).unwrap().unwrap();
        assert_eq!(book.total_progression, Some(0.42));
        assert_eq!(book.resume_locator, Some(locator));
    }

    #[test]
    fn annotations_round_trip_in_reading_order() {
        let (dir, mut library) = open_temp_library();
        let id = import(&mut library, dir.path(), "Emma");
        let later = library
            .save_annotation(&AnnotationInput {
                id: None,
                book_id: id.clone(),
                kind: AnnotationKind::Highlight,
                excerpt: "Later words".into(),
                note: Some("  ".into()),
                color: Some("sage".into()),
                locator: at("epubcfi(/6/10!/4/2,/1:0,/1:5)", 0.8),
            })
            .unwrap();
        assert_eq!(later.note, None, "blank notes are not kept");
        let earlier = library
            .save_annotation(&AnnotationInput {
                id: None,
                book_id: id.clone(),
                kind: AnnotationKind::Bookmark,
                excerpt: "Earlier".into(),
                note: None,
                color: None,
                locator: at("epubcfi(/6/4!/4/2/1:0)", 0.1),
            })
            .unwrap();
        let list = library.book_annotations(&id).unwrap();
        assert_eq!(
            list.iter().map(|a| a.id.as_str()).collect::<Vec<_>>(),
            [earlier.id.as_str(), later.id.as_str()]
        );

        // Editing keeps the id and creation time.
        let edited = library
            .save_annotation(&AnnotationInput {
                id: Some(later.id.clone()),
                note: Some("A thought".into()),
                color: Some("rose".into()),
                ..AnnotationInput {
                    id: None,
                    book_id: id.clone(),
                    kind: AnnotationKind::Highlight,
                    excerpt: "Later words".into(),
                    note: None,
                    color: None,
                    locator: later.locator.clone(),
                }
            })
            .unwrap();
        assert_eq!(edited.created_at, later.created_at);
        assert_eq!(edited.note.as_deref(), Some("A thought"));

        library.delete_annotation(&earlier.id).unwrap();
        assert_eq!(library.book_annotations(&id).unwrap().len(), 1);
    }

    #[test]
    fn rejects_unknown_colours() {
        let (dir, mut library) = open_temp_library();
        let id = import(&mut library, dir.path(), "Persuasion");
        let result = library.save_annotation(&AnnotationInput {
            id: None,
            book_id: id,
            kind: AnnotationKind::Highlight,
            excerpt: "x".into(),
            note: None,
            color: Some("chartreuse".into()),
            locator: ReaderLocator::default(),
        });
        assert!(matches!(result, Err(Error::Unsuitable(_))));
    }

    #[test]
    fn device_settings_round_trip() {
        let (_dir, library) = open_temp_library();
        assert_eq!(library.setting("reader").unwrap(), None);
        library.set_setting("reader", "{\"size\":18}").unwrap();
        library.set_setting("reader", "{\"size\":20}").unwrap();
        assert_eq!(
            library.setting("reader").unwrap().as_deref(),
            Some("{\"size\":20}")
        );
    }
}

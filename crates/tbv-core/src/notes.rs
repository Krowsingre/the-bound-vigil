//! The Notes page: highlights, annotations (highlights with your words),
//! notes about a whole book, and personal notes that belong to no book.

use rusqlite::{params, OptionalExtension};

use crate::error::{Error, Result};
use crate::ids::new_record_id;
use crate::library::Library;
use crate::model::*;
use crate::time::now_utc;

const MAX_TITLE_CHARS: usize = 120;

fn clean(text: Option<&str>) -> Option<String> {
    text.map(str::trim)
        .filter(|t| !t.is_empty())
        .map(str::to_owned)
}

fn in_tab(kind: NoteKind, tab: NotesTab) -> bool {
    match tab {
        NotesTab::All => true,
        NotesTab::Highlights => kind == NoteKind::Highlight,
        NotesTab::Annotations => kind == NoteKind::Annotation,
        NotesTab::BookNotes => kind == NoteKind::BookNote,
        NotesTab::Personal => kind == NoteKind::Personal,
    }
}

impl Library {
    /// Every note, newest first, before any tab, search or filter.
    fn all_notes(&self) -> Result<Vec<NoteItem>> {
        let mut statement = self.conn.prepare(
            "SELECT a.id, a.kind, a.excerpt, a.note, a.color, a.locator,
                    COALESCE(a.created_at, a.updated_at), a.updated_at,
                    b.id, COALESCE(o_title.value, b.title), COALESCE(o_authors.value, b.authors),
                    lf.cover_path
             FROM annotations a
             JOIN books b ON b.id = a.book_id AND b.deleted_at IS NULL
             LEFT JOIN local_files lf ON lf.book_id = b.id
             LEFT JOIN metadata_overrides o_title ON o_title.book_id = b.id AND o_title.field = 'title'
             LEFT JOIN metadata_overrides o_authors ON o_authors.book_id = b.id AND o_authors.field = 'authors'
             WHERE a.deleted_at IS NULL AND a.kind IN ('highlight', 'note', 'book_note')",
        )?;
        let mut notes = statement
            .query_map([], |r| {
                let kind: String = r.get(1)?;
                let note: Option<String> = r.get(3)?;
                let locator: String = r.get(5)?;
                let authors: String = r.get(10)?;
                let kind = match kind.as_str() {
                    "book_note" => NoteKind::BookNote,
                    _ if note.as_deref().is_some_and(|n| !n.trim().is_empty()) => {
                        NoteKind::Annotation
                    }
                    "note" => NoteKind::Annotation,
                    _ => NoteKind::Highlight,
                };
                Ok(NoteItem {
                    id: r.get(0)?,
                    kind,
                    excerpt: r.get(2)?,
                    note,
                    title: None,
                    color: r.get(4)?,
                    locator: (kind != NoteKind::BookNote)
                        .then(|| serde_json::from_str(&locator).ok())
                        .flatten(),
                    created_at: r.get(6)?,
                    updated_at: r.get(7)?,
                    book: Some(CoverRef {
                        id: r.get(8)?,
                        title: r.get(9)?,
                        authors: serde_json::from_str(&authors).unwrap_or_default(),
                        cover_path: r.get(11)?,
                    }),
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;

        let mut personal = self.conn.prepare(
            "SELECT id, title, body, created_at, updated_at FROM personal_notes WHERE deleted_at IS NULL",
        )?;
        notes.extend(
            personal
                .query_map([], |r| {
                    Ok(NoteItem {
                        id: r.get(0)?,
                        kind: NoteKind::Personal,
                        book: None,
                        excerpt: String::new(),
                        title: r.get(1)?,
                        note: r.get(2)?,
                        color: None,
                        locator: None,
                        created_at: r.get(3)?,
                        updated_at: r.get(4)?,
                    })
                })?
                .collect::<std::result::Result<Vec<_>, _>>()?,
        );
        notes.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        Ok(notes)
    }

    pub fn notes_page(&self, query: &NotesQuery) -> Result<NotesPage> {
        let all = self.all_notes()?;

        let mut counts = NoteCounts {
            all: all.len() as u32,
            ..Default::default()
        };
        let mut books: Vec<CoverRef> = Vec::new();
        for n in &all {
            match n.kind {
                NoteKind::Highlight => counts.highlights += 1,
                NoteKind::Annotation => counts.annotations += 1,
                NoteKind::BookNote => counts.book_notes += 1,
                NoteKind::Personal => counts.personal += 1,
            }
            if let Some(book) = &n.book {
                if !books.iter().any(|b| b.id == book.id) {
                    books.push(book.clone());
                }
            }
        }
        books.sort_by_key(|b| b.title.to_lowercase());

        let search = clean(query.search.as_deref()).map(|s| s.to_lowercase());
        let mut notes: Vec<NoteItem> = all
            .into_iter()
            .filter(|n| in_tab(n.kind, query.tab))
            .filter(|n| {
                query
                    .book_id
                    .as_ref()
                    .is_none_or(|id| n.book.as_ref().is_some_and(|b| &b.id == id))
            })
            .filter(|n| {
                query.colors.is_empty()
                    || n.color.as_ref().is_some_and(|c| query.colors.contains(c))
            })
            .filter(|n| {
                let Some(search) = &search else {
                    return true;
                };
                let book = n.book.as_ref();
                [
                    Some(n.excerpt.as_str()),
                    n.note.as_deref(),
                    n.title.as_deref(),
                    book.map(|b| b.title.as_str()),
                    n.locator.as_ref().and_then(|l| l.chapter.as_deref()),
                ]
                .into_iter()
                .flatten()
                .chain(
                    book.into_iter()
                        .flat_map(|b| b.authors.iter().map(String::as_str)),
                )
                .any(|text| text.to_lowercase().contains(search.as_str()))
            })
            .collect();

        match query.sort {
            NotesSort::Recent => {}
            NotesSort::Updated => notes.sort_by(|a, b| b.updated_at.cmp(&a.updated_at)),
            NotesSort::Book => notes.sort_by(|a, b| {
                let title = |n: &NoteItem| n.book.as_ref().map(|b| b.title.to_lowercase());
                let place = |n: &NoteItem| {
                    // A note about the whole book comes before notes inside it.
                    n.locator
                        .as_ref()
                        .and_then(|l| l.total_progression)
                        .unwrap_or(-1.0)
                };
                // Personal notes (no book) go last.
                (title(a).is_none(), title(a))
                    .cmp(&(title(b).is_none(), title(b)))
                    .then(place(a).total_cmp(&place(b)))
            }),
        }

        Ok(NotesPage {
            notes,
            counts,
            books,
        })
    }

    fn note(&self, id: &str) -> Result<NoteItem> {
        self.all_notes()?
            .into_iter()
            .find(|n| n.id == id)
            .ok_or_else(|| Error::Unsuitable("that note no longer exists".into()))
    }

    /// Writes or rewrites a note about a whole book.
    pub fn save_book_note(&self, book_id: &str, id: Option<&str>, text: &str) -> Result<NoteItem> {
        let text =
            clean(Some(text)).ok_or_else(|| Error::Unsuitable("the note is empty".into()))?;
        let now = now_utc();
        let id = match id {
            Some(id) => {
                let changed = self.conn.execute(
                    "UPDATE annotations SET note = ?2, updated_at = ?3
                     WHERE id = ?1 AND kind = 'book_note' AND deleted_at IS NULL",
                    params![id, text, now],
                )?;
                if changed == 0 {
                    return Err(Error::Unsuitable("that note no longer exists".into()));
                }
                id.to_owned()
            }
            None => {
                let exists: Option<i64> = self
                    .conn
                    .query_row(
                        "SELECT 1 FROM books WHERE id = ?1 AND deleted_at IS NULL",
                        params![book_id],
                        |r| r.get(0),
                    )
                    .optional()?;
                if exists.is_none() {
                    return Err(Error::Unsuitable(
                        "that book is no longer in your library".into(),
                    ));
                }
                let id = new_record_id();
                self.conn.execute(
                    "INSERT INTO annotations (id, book_id, kind, excerpt, note, locator, created_at, updated_at)
                     VALUES (?1, ?2, 'book_note', '', ?3, '{}', ?4, ?4)",
                    params![id, book_id, text, now],
                )?;
                id
            }
        };
        self.note(&id)
    }

    /// Writes or rewrites a personal note.
    pub fn save_personal_note(
        &self,
        id: Option<&str>,
        title: Option<&str>,
        body: &str,
    ) -> Result<NoteItem> {
        let title = clean(title).map(|t| t.chars().take(MAX_TITLE_CHARS).collect::<String>());
        let body = clean(Some(body));
        if title.is_none() && body.is_none() {
            return Err(Error::Unsuitable("the note is empty".into()));
        }
        let now = now_utc();
        let id = match id {
            Some(id) => {
                let changed = self.conn.execute(
                    "UPDATE personal_notes SET title = ?2, body = ?3, updated_at = ?4
                     WHERE id = ?1 AND deleted_at IS NULL",
                    params![id, title, body.unwrap_or_default(), now],
                )?;
                if changed == 0 {
                    return Err(Error::Unsuitable("that note no longer exists".into()));
                }
                id.to_owned()
            }
            None => {
                let id = new_record_id();
                self.conn.execute(
                    "INSERT INTO personal_notes (id, title, body, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?4)",
                    params![id, title, body.unwrap_or_default(), now],
                )?;
                id
            }
        };
        self.note(&id)
    }

    /// Changes the words attached to a highlight. Empty words make it a plain highlight.
    pub fn set_annotation_note(&self, id: &str, note: Option<&str>) -> Result<NoteItem> {
        let changed = self.conn.execute(
            "UPDATE annotations SET note = ?2, updated_at = ?3
             WHERE id = ?1 AND kind IN ('highlight', 'note') AND deleted_at IS NULL",
            params![id, clean(note), now_utc()],
        )?;
        if changed == 0 {
            return Err(Error::Unsuitable("that note no longer exists".into()));
        }
        self.note(id)
    }

    /// Deletes any kind of note. Kept as a tombstone so sync can pass it on.
    pub fn delete_note(&self, id: &str, kind: NoteKind) -> Result<()> {
        if kind == NoteKind::Personal {
            let now = now_utc();
            self.conn.execute(
                "UPDATE personal_notes SET deleted_at = ?2, updated_at = ?2 WHERE id = ?1",
                params![id, now],
            )?;
            Ok(())
        } else {
            self.delete_annotation(id)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::epub::tests::write_test_epub_with;
    use crate::library::tests::open_temp_library;
    use std::path::Path;

    fn add(library: &mut Library, dir: &Path, title: &str, author: &str) -> String {
        let path = dir.join(format!("{title}.epub"));
        write_test_epub_with(&path, title, author, false, "");
        match library.import_files(&[path]).remove(0) {
            ImportResult::Imported { book_id, .. } => book_id,
            other => panic!("{other:?}"),
        }
    }

    fn highlight(
        library: &Library,
        book: &str,
        words: &str,
        note: Option<&str>,
        at: f64,
    ) -> String {
        library
            .save_annotation(&AnnotationInput {
                id: None,
                book_id: book.into(),
                kind: AnnotationKind::Highlight,
                excerpt: words.into(),
                note: note.map(Into::into),
                color: Some("sage".into()),
                locator: ReaderLocator {
                    total_progression: Some(at),
                    chapter: Some("The Wall".into()),
                    ..Default::default()
                },
            })
            .unwrap()
            .id
    }

    #[test]
    fn notes_of_every_kind_are_counted_and_filtered() {
        let (dir, mut library) = open_temp_library();
        let lamps = add(&mut library, dir.path(), "Lamps", "Wren Hale");
        let tides = add(&mut library, dir.path(), "Tides", "Ada Moss");
        highlight(&library, &lamps, "a light is a promise", None, 0.5);
        let annotated = highlight(&library, &lamps, "keep the lamps", Some("Lovely"), 0.2);
        let book_note = library
            .save_book_note(&tides, None, "  A quiet book.  ")
            .unwrap();
        assert_eq!(book_note.note.as_deref(), Some("A quiet book."));
        // Times are kept to the millisecond; make sure the next note is newer.
        std::thread::sleep(std::time::Duration::from_millis(5));
        library
            .save_personal_note(None, Some("Ideas"), "Read more poetry")
            .unwrap();
        assert!(library.save_personal_note(None, Some(" "), " ").is_err());
        // Bookmarks aren't notes.
        library
            .save_annotation(&AnnotationInput {
                id: None,
                book_id: lamps.clone(),
                kind: AnnotationKind::Bookmark,
                excerpt: "page".into(),
                note: None,
                color: None,
                locator: ReaderLocator::default(),
            })
            .unwrap();

        let page = library.notes_page(&NotesQuery::default()).unwrap();
        assert_eq!(
            page.counts,
            NoteCounts {
                all: 4,
                highlights: 1,
                annotations: 1,
                book_notes: 1,
                personal: 1
            }
        );
        assert_eq!(
            page.books
                .iter()
                .map(|b| b.title.as_str())
                .collect::<Vec<_>>(),
            ["Lamps", "Tides"]
        );
        assert_eq!(page.notes[0].kind, NoteKind::Personal, "newest first");

        let tab = |tab| {
            library
                .notes_page(&NotesQuery {
                    tab,
                    ..Default::default()
                })
                .unwrap()
                .notes
        };
        assert_eq!(tab(NotesTab::Annotations)[0].id, annotated);
        assert_eq!(
            tab(NotesTab::BookNotes)[0].book.as_ref().unwrap().title,
            "Tides"
        );

        let search = |s: &str| {
            library
                .notes_page(&NotesQuery {
                    search: Some(s.into()),
                    ..Default::default()
                })
                .unwrap()
                .notes
                .len()
        };
        assert_eq!(search("LOVELY"), 1, "your own words");
        assert_eq!(search("wren"), 2, "the author");
        assert_eq!(search("the wall"), 2, "the chapter");
        assert_eq!(search("poetry"), 1, "personal notes");

        let by_book = library
            .notes_page(&NotesQuery {
                sort: NotesSort::Book,
                ..Default::default()
            })
            .unwrap()
            .notes;
        let order: Vec<_> = by_book
            .iter()
            .map(|n| (n.kind, n.excerpt.as_str()))
            .collect();
        assert_eq!(
            order,
            [
                (NoteKind::Annotation, "keep the lamps"),
                (NoteKind::Highlight, "a light is a promise"),
                (NoteKind::BookNote, ""),
                (NoteKind::Personal, ""),
            ]
        );
        assert_eq!(
            library
                .notes_page(&NotesQuery {
                    book_id: Some(tides.clone()),
                    ..Default::default()
                })
                .unwrap()
                .notes
                .len(),
            1
        );
        assert_eq!(
            library
                .notes_page(&NotesQuery {
                    colors: vec!["rose".into()],
                    ..Default::default()
                })
                .unwrap()
                .notes
                .len(),
            0
        );
    }

    #[test]
    fn notes_change_kind_with_their_words_and_can_be_deleted() {
        let (dir, mut library) = open_temp_library();
        let lamps = add(&mut library, dir.path(), "Lamps", "Wren Hale");
        let id = highlight(&library, &lamps, "a light is a promise", None, 0.5);

        assert_eq!(
            library.set_annotation_note(&id, Some("Yes")).unwrap().kind,
            NoteKind::Annotation
        );
        assert_eq!(
            library.set_annotation_note(&id, Some("  ")).unwrap().kind,
            NoteKind::Highlight
        );

        let book_note = library.save_book_note(&lamps, None, "First").unwrap();
        let rewritten = library
            .save_book_note(&lamps, Some(&book_note.id), "Second")
            .unwrap();
        assert_eq!(rewritten.note.as_deref(), Some("Second"));
        assert!(
            library
                .book_annotations(&lamps)
                .unwrap()
                .iter()
                .all(|a| a.id != book_note.id),
            "book notes stay out of the reader's highlight list"
        );

        let personal = library
            .save_personal_note(None, None, "Just a thought")
            .unwrap();
        let edited = library
            .save_personal_note(Some(&personal.id), Some("Title"), "Body")
            .unwrap();
        assert_eq!(edited.title.as_deref(), Some("Title"));

        library
            .delete_note(&personal.id, NoteKind::Personal)
            .unwrap();
        library
            .delete_note(&book_note.id, NoteKind::BookNote)
            .unwrap();
        library.delete_note(&id, NoteKind::Highlight).unwrap();
        assert_eq!(
            library
                .notes_page(&NotesQuery::default())
                .unwrap()
                .counts
                .all,
            0
        );
    }
}

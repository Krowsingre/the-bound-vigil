//! Looking after the library's books: your own tags, deleting a book,
//! removing the copy on this device when the cloud has one, and finding
//! books that look like the same book twice.

use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::path::Path;

use rusqlite::{params, OptionalExtension};
use serde::Serialize;

use crate::error::{Error, Result};
use crate::home::{book_from_row, BOOK_COLUMNS, BOOK_FROM};
use crate::library::Library;
use crate::model::{BookId, BookPreview};
use crate::time::now_utc;

const MAX_TAG_CHARS: usize = 40;
const MAX_TAGS: usize = 50;
const DISMISSED: &str = "duplicates.dismissed";

/// A tag and how many books carry it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagCount {
    pub name: String,
    pub count: u32,
}

/// Books that look like the same book.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateGroup {
    /// Stays the same for the same books, so a group marked "not duplicates" stays hidden.
    pub key: String,
    /// Why they look alike, in words.
    pub reason: String,
    pub books: Vec<DuplicateBook>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateBook {
    #[serde(flatten)]
    pub book: BookPreview,
    pub file_size: u64,
    pub notes: u32,
    /// The cover's width and height in pixels, when there is one.
    pub cover_size: Option<[u32; 2]>,
}

/// A cover picture's width and height, read from its header only.
fn cover_size(path: Option<&str>) -> Option<[u32; 2]> {
    image::image_dimensions(path?).ok().map(|(w, h)| [w, h])
}

fn clean_tag(tag: &str) -> Option<String> {
    let tag: String = tag.split_whitespace().collect::<Vec<_>>().join(" ");
    let tag: String = tag.chars().take(MAX_TAG_CHARS).collect();
    (!tag.is_empty()).then_some(tag)
}

/// A title as it compares with others: lowercase, letters and digits only,
/// without a leading article or a subtitle.
pub(crate) fn title_key(title: &str) -> String {
    let main = title.split([':', '(', '[']).next().unwrap_or(title);
    let words: Vec<String> = main
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .map(str::to_lowercase)
        .collect();
    let skip = usize::from(words.len() > 1 && matches!(words[0].as_str(), "the" | "a" | "an"));
    words[skip..].join(" ")
}

/// The number a title gives a book of a series: the main title's last word
/// ("Dark City Girls 3"), and, as `tagged`, one marked anywhere ("Book 2",
/// "Vol. 4", "#1").
struct TitleNumber {
    main: Option<u64>,
    tagged: Option<u64>,
}

fn title_number(title: &str) -> TitleNumber {
    let lower = title.to_lowercase();
    let main_part = lower.split([':', '(', '[']).next().unwrap_or(&lower);
    let main = main_part.split(|c: char| !c.is_alphanumeric()).rfind(|w| !w.is_empty()).and_then(|w| w.parse().ok());
    let words: Vec<&str> = lower.split(|c: char| !c.is_alphanumeric() && c != '#').filter(|w| !w.is_empty()).collect();
    let mut tagged = None;
    for (i, word) in words.iter().enumerate() {
        if let Some(n) = word.strip_prefix('#').and_then(|n| n.parse().ok()) {
            tagged = Some(n);
        } else if matches!(*word, "book" | "volume" | "vol" | "part" | "no" | "tome" | "episode") {
            if let Some(n) = words.get(i + 1).and_then(|n| n.trim_start_matches('#').parse().ok()) {
                tagged = Some(n);
            }
        }
    }
    TitleNumber { main, tagged: tagged.or(main) }
}

/// Whether two titles name different books of a series by their numbers:
/// "Dark City Girls" and "Dark City Girls 3", or "Saga: Book 2" and
/// "Saga: Book 3". A number only one of them marks in brackets ("(Discworld
/// #1)") doesn't count.
pub(crate) fn numbered_apart(a: &str, b: &str) -> bool {
    let (a, b) = (title_number(a), title_number(b));
    a.main != b.main || matches!((a.tagged, b.tagged), (Some(x), Some(y)) if x != y)
}

/// The first author's surname, as it compares with others.
pub(crate) fn author_key(authors: &[String]) -> String {
    let first = authors.first().map(String::as_str).unwrap_or_default();
    // "Stoker, Bram" and "Bram Stoker" alike.
    let surname = match first.split_once(',') {
        Some((last, _)) => last,
        None => first.split_whitespace().last().unwrap_or_default(),
    };
    surname
        .chars()
        .filter(|c| c.is_alphanumeric())
        .collect::<String>()
        .to_lowercase()
}

impl Library {
    /// Every tag in the library, A to Z, with how many books have it.
    pub fn all_tags(&self) -> Result<Vec<TagCount>> {
        let mut statement = self.conn.prepare(
            "SELECT t.tag, COUNT(*) FROM book_tags t JOIN books b ON b.id = t.book_id
             WHERE t.removed_at IS NULL AND b.deleted_at IS NULL
             GROUP BY t.tag ORDER BY t.tag COLLATE NOCASE",
        )?;
        let rows = statement.query_map([], |r| {
            Ok(TagCount {
                name: r.get(0)?,
                count: r.get(1)?,
            })
        })?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    /// The spelling already used for a tag, so "gothic" joins "Gothic".
    fn tag_spelling(&self, tag: &str) -> Result<String> {
        Ok(self
            .conn
            .query_row(
                "SELECT tag FROM book_tags WHERE lower(tag) = lower(?1) AND removed_at IS NULL
                 GROUP BY tag ORDER BY COUNT(*) DESC LIMIT 1",
                params![tag],
                |r| r.get(0),
            )
            .optional()?
            .unwrap_or_else(|| tag.to_string()))
    }

    fn book_exists(&self, book_id: &str) -> Result<bool> {
        Ok(self
            .conn
            .query_row(
                "SELECT 1 FROM books WHERE id = ?1 AND deleted_at IS NULL",
                params![book_id],
                |_| Ok(()),
            )
            .optional()?
            .is_some())
    }

    /// Gives books a tag. Books that have it already are left alone.
    pub fn add_tag(&self, book_ids: &[BookId], tag: &str) -> Result<String> {
        let tag = clean_tag(tag).ok_or_else(|| Error::Unsuitable("type a tag first".into()))?;
        let tag = self.tag_spelling(&tag)?;
        let now = now_utc();
        let tx = self.conn.unchecked_transaction()?;
        for id in book_ids {
            if !self.book_exists(id)? {
                continue;
            }
            let count: i64 = tx.query_row(
                "SELECT COUNT(*) FROM book_tags WHERE book_id = ?1 AND removed_at IS NULL",
                params![id],
                |r| r.get(0),
            )?;
            if count as usize >= MAX_TAGS {
                continue;
            }
            // The same tag in another case is the same tag.
            let has: bool = tx
                .query_row(
                    "SELECT 1 FROM book_tags WHERE book_id = ?1 AND lower(tag) = lower(?2) AND removed_at IS NULL",
                    params![id, tag],
                    |_| Ok(()),
                )
                .optional()?
                .is_some();
            if has {
                continue;
            }
            tx.execute(
                "INSERT INTO book_tags (book_id, tag, added_at, updated_at) VALUES (?1, ?2, ?3, ?3)
                 ON CONFLICT(book_id, tag) DO UPDATE SET removed_at = NULL, added_at = excluded.added_at, updated_at = excluded.updated_at",
                params![id, tag, now],
            )?;
        }
        tx.commit()?;
        Ok(tag)
    }

    /// Takes a tag off books, whatever its case.
    pub fn remove_tag(&self, book_ids: &[BookId], tag: &str) -> Result<()> {
        let now = now_utc();
        let tx = self.conn.unchecked_transaction()?;
        for id in book_ids {
            tx.execute(
                "UPDATE book_tags SET removed_at = ?3, updated_at = ?3
                 WHERE book_id = ?1 AND lower(tag) = lower(?2) AND removed_at IS NULL",
                params![id, tag.trim(), now],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    /// Makes a book's tags exactly these.
    pub fn set_book_tags(&self, book_id: &str, tags: &[String]) -> Result<Vec<String>> {
        if !self.book_exists(book_id)? {
            return Err(Error::Unsuitable(
                "This book is no longer in your library.".into(),
            ));
        }
        let wanted: Vec<String> = tags
            .iter()
            .filter_map(|t| clean_tag(t))
            .take(MAX_TAGS)
            .collect();
        let lower: HashSet<String> = wanted.iter().map(|t| t.to_lowercase()).collect();
        let current: Vec<String> = self
            .conn
            .prepare("SELECT tag FROM book_tags WHERE book_id = ?1 AND removed_at IS NULL")?
            .query_map(params![book_id], |r| r.get(0))?
            .collect::<std::result::Result<_, _>>()?;
        let id = vec![book_id.to_string()];
        for tag in &current {
            if !lower.contains(&tag.to_lowercase()) {
                self.remove_tag(&id, tag)?;
            }
        }
        for tag in &wanted {
            self.add_tag(&id, tag)?;
        }
        self.book_tags(book_id)
    }

    pub fn book_tags(&self, book_id: &str) -> Result<Vec<String>> {
        Ok(self
            .conn
            .prepare("SELECT tag FROM book_tags WHERE book_id = ?1 AND removed_at IS NULL ORDER BY tag COLLATE NOCASE")?
            .query_map(params![book_id], |r| r.get(0))?
            .collect::<std::result::Result<_, _>>()?)
    }

    /// The file TBV keeps for a book, if it's in TBV's own Library folder.
    fn own_copy(&self, book_id: &str) -> Result<Option<String>> {
        let path: Option<String> = self
            .conn
            .query_row(
                "SELECT path FROM local_files WHERE book_id = ?1",
                params![book_id],
                |r| r.get(0),
            )
            .optional()?
            .flatten();
        Ok(path.filter(|p| Path::new(p).starts_with(&self.paths.books_dir)))
    }

    /// Takes a book out of the library on every device, keeping everything
    /// else: its highlights, notes, tags and collections wait, hidden, and its
    /// file stays in the cloud, so importing the book again brings it all
    /// back. TBV's own copy on this device is removed.
    pub fn remove_from_library(&self, book_id: &str) -> Result<()> {
        if !self.book_exists(book_id)? {
            return Ok(());
        }
        let copy = self.own_copy(book_id)?;
        let tx = self.conn.unchecked_transaction()?;
        tx.execute("UPDATE books SET deleted_at = ?2 WHERE id = ?1", params![book_id, now_utc()])?;
        tx.execute("UPDATE local_files SET path = NULL WHERE book_id = ?1", params![book_id])?;
        tx.commit()?;
        if let Some(copy) = copy {
            let _ = fs::remove_file(copy);
        }
        Ok(())
    }

    /// Deletes a book for good, on every device. Its highlights and notes go
    /// with it, and its file and cover are erased from the cloud at the next
    /// sync. TBV's own copy on this device is removed; the file you imported
    /// it from is never touched.
    pub fn delete_book(&self, book_id: &str) -> Result<()> {
        if !self.book_exists(book_id)? {
            return Ok(());
        }
        let copy = self.own_copy(book_id)?;
        self.erase_from_cloud(book_id)?;
        let now = now_utc();
        let tx = self.conn.unchecked_transaction()?;
        tx.execute(
            "UPDATE books SET deleted_at = ?2 WHERE id = ?1",
            params![book_id, now],
        )?;
        tx.execute(
            "UPDATE annotations SET deleted_at = ?2, updated_at = ?2 WHERE book_id = ?1 AND deleted_at IS NULL",
            params![book_id, now],
        )?;
        tx.execute(
            "UPDATE collection_books SET removed_at = ?2, updated_at = ?2 WHERE book_id = ?1 AND removed_at IS NULL",
            params![book_id, now],
        )?;
        tx.execute(
            "UPDATE book_tags SET removed_at = ?2, updated_at = ?2 WHERE book_id = ?1 AND removed_at IS NULL",
            params![book_id, now],
        )?;
        tx.execute(
            "UPDATE local_files SET path = NULL WHERE book_id = ?1",
            params![book_id],
        )?;
        tx.commit()?;
        if let Some(copy) = copy {
            let _ = fs::remove_file(copy);
        }
        Ok(())
    }

    /// Removes the book's file from this device and keeps it in the library,
    /// to download again when it's next opened. Only when the cloud has it.
    pub fn remove_download(&self, book_id: &str) -> Result<()> {
        let in_cloud: bool = self.conn.query_row(
            "SELECT EXISTS (SELECT 1 FROM books b JOIN (SELECT path, uploaded_at FROM sync_files
                  UNION ALL SELECT path, uploaded_at FROM sync_files_also) sf
                ON sf.path = 'books/' || substr(b.id, 8) || '.' || b.format AND sf.uploaded_at IS NOT NULL
              WHERE b.id = ?1)",
            params![book_id],
            |r| r.get(0),
        )?;
        if !in_cloud {
            return Err(Error::Unsuitable(
                "This book's file isn't in the cloud yet, so this device's copy is the only one. Turn on Sync book files and sync first.".into(),
            ));
        }
        let copy = self.own_copy(book_id)?;
        self.conn.execute(
            "UPDATE local_files SET path = NULL WHERE book_id = ?1",
            params![book_id],
        )?;
        if let Some(copy) = copy {
            let _ = fs::remove_file(copy);
        }
        Ok(())
    }

    /// Books that look like the same book: the same ISBN, or the same title
    /// and first author's surname. Groups marked as not duplicates are left out.
    pub fn find_duplicates(&self) -> Result<Vec<DuplicateGroup>> {
        let sql = format!(
            "{BOOK_COLUMNS},
                    COALESCE((SELECT value FROM metadata_overrides WHERE book_id = b.id AND field = 'isbn'),
                             (SELECT value FROM metadata_fetched WHERE book_id = b.id AND field = 'isbn'), b.isbn),
                    b.file_size,
                    (SELECT COUNT(*) FROM annotations a WHERE a.book_id = b.id AND a.deleted_at IS NULL)
             {BOOK_FROM} ORDER BY b.added_at"
        );
        let mut statement = self.conn.prepare(&sql)?;
        let rows = statement
            .query_map([], |r| {
                Ok((
                    book_from_row(r)?,
                    r.get::<_, Option<String>>(27)?,
                    r.get::<_, i64>(28)?,
                    r.get::<_, u32>(29)?,
                ))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;

        let mut by_isbn: BTreeMap<String, Vec<usize>> = BTreeMap::new();
        let mut by_title: BTreeMap<String, Vec<usize>> = BTreeMap::new();
        for (i, (book, isbn, ..)) in rows.iter().enumerate() {
            if let Some(isbn) = isbn
                .as_deref()
                .map(|s| {
                    s.chars()
                        .filter(char::is_ascii_alphanumeric)
                        .collect::<String>()
                })
                .filter(|s| s.len() >= 10)
            {
                by_isbn.entry(isbn).or_default().push(i);
            }
            let title = title_key(&book.title);
            if !title.is_empty() {
                by_title
                    .entry(format!("{title}|{}", author_key(&book.authors)))
                    .or_default()
                    .push(i);
            }
        }

        let dismissed: HashSet<String> = self
            .setting(DISMISSED)?
            .and_then(|s| serde_json::from_str::<Vec<String>>(&s).ok())
            .unwrap_or_default()
            .into_iter()
            .collect();
        let mut seen: HashSet<Vec<usize>> = HashSet::new();
        let mut groups = Vec::new();
        let candidates = by_isbn.into_values().map(|g| (g, "The same ISBN")).chain(
            by_title
                .into_values()
                .map(|g| (g, "The same title and author")),
        );
        // Books of one series that share a title apart from their number
        // aren't duplicates, so a group splits by number.
        let apart = |i: usize, j: usize| {
            let (a, b) = (&rows[i].0, &rows[j].0);
            numbered_apart(&a.title, &b.title)
                || matches!((a.series_index, b.series_index), (Some(x), Some(y)) if (x - y).abs() > 1e-6)
        };
        let candidates = candidates.flat_map(|(members, reason)| {
            let mut parts: Vec<Vec<usize>> = Vec::new();
            for i in members {
                match parts.iter_mut().find(|p| p.iter().all(|&j| !apart(i, j))) {
                    Some(part) => part.push(i),
                    None => parts.push(vec![i]),
                }
            }
            parts.into_iter().map(move |p| (p, reason))
        });
        for (members, reason) in candidates {
            if members.len() < 2 || !seen.insert(members.clone()) {
                continue;
            }
            let mut ids: Vec<&str> = members.iter().map(|&i| rows[i].0.id.as_str()).collect();
            ids.sort_unstable();
            let key = ids.join("+");
            if dismissed.contains(&key) {
                continue;
            }
            groups.push(DuplicateGroup {
                key,
                reason: reason.into(),
                books: members
                    .iter()
                    .map(|&i| DuplicateBook {
                        book: rows[i].0.clone(),
                        file_size: rows[i].2.max(0) as u64,
                        notes: rows[i].3,
                        cover_size: cover_size(rows[i].0.cover_path.as_deref()),
                    })
                    .collect(),
            });
        }
        Ok(groups)
    }

    /// Gives every one of these books the largest cover any of them has.
    /// The cover is a copy, so it stays when the other books are deleted, and
    /// resetting a book's details brings back its own. Returns how many changed.
    pub fn share_best_cover(&self, book_ids: &[BookId]) -> Result<u32> {
        let covers = book_ids
            .iter()
            .map(|id| {
                let path = self.cover_of(id)?;
                let size = cover_size(path.as_deref());
                Ok((id, path, size))
            })
            .collect::<Result<Vec<_>>>()?;
        let area = |size: &Option<[u32; 2]>| size.map_or(0, |[w, h]| u64::from(w) * u64::from(h));
        let Some((_, Some(best_path), best_size)) = covers.iter().max_by_key(|(_, _, size)| area(size)).cloned() else {
            return Ok(0);
        };
        let picture = fs::read(&best_path)?;
        let mut changed = 0;
        for (id, path, size) in &covers {
            if path.as_deref() == Some(best_path.as_str()) || area(size) >= area(&best_size) {
                continue;
            }
            if self.replace_cover(id, &picture)? {
                changed += 1;
            }
        }
        Ok(changed)
    }

    /// Remembers that these books aren't duplicates, so they aren't shown again.
    pub fn dismiss_duplicates(&self, key: &str) -> Result<()> {
        let mut list: Vec<String> = self
            .setting(DISMISSED)?
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        if !list.iter().any(|k| k == key) {
            list.push(key.to_string());
        }
        self.set_setting(DISMISSED, &serde_json::to_string(&list)?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::epub::tests::write_test_epub_with;
    use crate::library::tests::open_temp_library;
    use crate::model::{CollectionRef, ImportResult, LibraryQuery};

    fn add(
        library: &mut Library,
        dir: &Path,
        file: &str,
        title: &str,
        author: &str,
        extra: &str,
    ) -> String {
        let path = dir.join(format!("{file}.epub"));
        write_test_epub_with(&path, title, author, false, extra);
        match library.import_files(&[path]).remove(0) {
            ImportResult::Imported { book_id, .. } => book_id,
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn tags_join_whatever_their_case_and_filter_the_library() {
        let (dir, mut library) = open_temp_library();
        let a = add(&mut library, dir.path(), "a", "Carmilla", "Le Fanu", "");
        let b = add(&mut library, dir.path(), "b", "Uncle Silas", "Le Fanu", "");
        assert_eq!(
            library.add_tag(std::slice::from_ref(&a), "  Gothic  ").unwrap(),
            "Gothic"
        );
        assert_eq!(
            library.add_tag(&[a.clone(), b.clone()], "gothic").unwrap(),
            "Gothic"
        );
        assert_eq!(
            library.all_tags().unwrap(),
            vec![TagCount {
                name: "Gothic".into(),
                count: 2
            }]
        );
        library
            .set_book_tags(&a, &["Gothic".into(), "Vampires".into()])
            .unwrap();
        library.set_book_tags(&b, &[]).unwrap();
        let page = library
            .library_page(&LibraryQuery {
                tags: vec!["gothic".into()],
                ..Default::default()
            })
            .unwrap();
        assert_eq!(page.books.len(), 1);
        assert_eq!(page.books[0].tags, vec!["Gothic", "Vampires"]);
        assert!(library
            .library_page(&LibraryQuery::default())
            .unwrap()
            .books
            .iter()
            .any(|x| x.tags.is_empty()));
    }

    #[test]
    fn deleting_a_book_removes_it_and_a_fresh_import_brings_it_back() {
        let (dir, mut library) = open_temp_library();
        let a = add(&mut library, dir.path(), "a", "Carmilla", "Le Fanu", "");
        library.add_tag(std::slice::from_ref(&a), "Gothic").unwrap();
        let copy = library.own_copy(&a).unwrap().unwrap();
        library.delete_book(&a).unwrap();
        assert!(!Path::new(&copy).exists());
        assert!(
            dir.path().join("a.epub").exists(),
            "the original file is never touched"
        );
        assert_eq!(
            library
                .library_page(&LibraryQuery::default())
                .unwrap()
                .total,
            0
        );
        assert!(library.all_tags().unwrap().is_empty());
        let again = library.import_files(&[dir.path().join("a.epub")]).remove(0);
        assert!(matches!(again, ImportResult::Imported { .. }), "{again:?}");
        assert_eq!(
            library
                .library_page(&LibraryQuery::default())
                .unwrap()
                .total,
            1
        );
    }

    #[test]
    fn a_deleted_book_imported_again_goes_into_previously_deleted_or_is_skipped() {
        use crate::collections::PREVIOUSLY_DELETED;
        let (dir, mut library) = open_temp_library();
        let a = add(&mut library, dir.path(), "a", "Carmilla", "Le Fanu", "");
        let b = add(&mut library, dir.path(), "b", "Dracula", "Stoker", "");
        let members = |l: &Library| -> Vec<String> {
            let detail = l.collection_detail(&CollectionRef::Collection { id: PREVIOUSLY_DELETED.into() });
            detail.map(|d| d.books.into_iter().map(|b| b.id).collect()).unwrap_or_default()
        };
        assert!(library.collection(PREVIOUSLY_DELETED).is_err(), "made only when needed");

        library.delete_book(&a).unwrap();
        let again = library.import_files(&[dir.path().join("a.epub")]).remove(0);
        assert!(matches!(again, ImportResult::Imported { returned: true, .. }), "{again:?}");
        assert_eq!(members(&library), vec![a.clone()]);
        // A book that was never deleted comes in as usual.
        let fresh = dir.path().join("c.epub");
        write_test_epub_with(&fresh, "Laura", "Le Fanu", false, "");
        let c = library.import_files(&[fresh]).remove(0);
        assert!(matches!(c, ImportResult::Imported { returned: false, .. }), "{c:?}");

        // Deleting the collection, then another book returning, starts it afresh.
        library.delete_collection(PREVIOUSLY_DELETED).unwrap();
        library.remove_from_library(&b).unwrap();
        library.import_files(&[dir.path().join("b.epub")]);
        assert_eq!(members(&library), vec![b.clone()]);

        // With Skip books I've deleted, they stay out.
        library.set_setting(crate::sync::APP_SETTINGS, r#"{"skipDeletedImports":true}"#).unwrap();
        library.delete_book(&a).unwrap();
        let skipped = library.import_files(&[dir.path().join("a.epub")]).remove(0);
        assert!(matches!(&skipped, ImportResult::SkippedDeleted { title, .. } if title == "Carmilla"), "{skipped:?}");
        assert_eq!(library.library_page(&LibraryQuery::default()).unwrap().total, 2);
    }

    #[test]
    fn removing_a_book_keeps_its_notes_and_tags_for_when_it_comes_back() {
        let (dir, mut library) = open_temp_library();
        let a = add(&mut library, dir.path(), "a", "Carmilla", "Le Fanu", "");
        library.add_tag(std::slice::from_ref(&a), "Gothic").unwrap();
        library.save_book_note(&a, None, "Laura narrates.").unwrap();
        let notes = |l: &Library| l.notes_page(&Default::default()).unwrap().notes.len();
        assert_eq!(notes(&library), 1);
        let copy = library.own_copy(&a).unwrap().unwrap();
        library.remove_from_library(&a).unwrap();
        assert!(!Path::new(&copy).exists());
        assert!(dir.path().join("a.epub").exists(), "the original file is never touched");
        assert_eq!(library.library_page(&LibraryQuery::default()).unwrap().total, 0);
        assert!(library.all_tags().unwrap().is_empty(), "hidden while it's out");
        assert_eq!(notes(&library), 0);
        let again = library.import_files(&[dir.path().join("a.epub")]).remove(0);
        assert!(matches!(again, ImportResult::Imported { .. }), "{again:?}");
        assert_eq!(library.all_tags().unwrap().len(), 1, "its tag is back");
        assert_eq!(notes(&library), 1, "and its note");
    }

    #[test]
    fn a_download_is_only_removed_when_the_cloud_has_the_file() {
        let (dir, mut library) = open_temp_library();
        let a = add(&mut library, dir.path(), "a", "Carmilla", "Le Fanu", "");
        assert!(library.remove_download(&a).is_err());
        let hex = crate::ids::book_id_hex(&a).to_string();
        library
            .conn
            .execute("INSERT INTO sync_files (path, uploaded_at) VALUES (?1, '2026-10-17T00:00:00.000Z')", params![format!("books/{hex}.epub")])
            .unwrap();
        let before = library
            .library_page(&LibraryQuery::default())
            .unwrap()
            .books
            .remove(0);
        assert!(before.in_cloud);
        library.remove_download(&a).unwrap();
        let after = library
            .library_page(&LibraryQuery::default())
            .unwrap()
            .books
            .remove(0);
        assert_eq!(after.availability, crate::model::Availability::Cloud);
    }

    #[test]
    fn duplicates_are_found_by_title_and_author_and_can_be_dismissed() {
        let (dir, mut library) = open_temp_library();
        add(
            &mut library,
            dir.path(),
            "a",
            "The Woman in White",
            "Wilkie Collins",
            "",
        );
        add(
            &mut library,
            dir.path(),
            "b",
            "Woman in White: A Novel",
            "Collins, Wilkie",
            "<p>Another edition.</p>",
        );
        add(
            &mut library,
            dir.path(),
            "c",
            "The Moonstone",
            "Wilkie Collins",
            "",
        );
        let groups = library.find_duplicates().unwrap();
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].books.len(), 2);
        library.dismiss_duplicates(&groups[0].key).unwrap();
        assert!(library.find_duplicates().unwrap().is_empty());
    }

    fn png(width: u32, height: u32) -> Vec<u8> {
        let mut bytes = Vec::new();
        image::RgbImage::new(width, height).write_to(&mut std::io::Cursor::new(&mut bytes), image::ImageFormat::Png).unwrap();
        bytes
    }

    #[test]
    fn duplicates_share_the_largest_cover_and_keep_it_after_the_other_goes() {
        let (dir, mut library) = open_temp_library();
        let small = add(&mut library, dir.path(), "a", "Carmilla", "Le Fanu", "");
        let large = add(&mut library, dir.path(), "b", "Carmilla", "Le Fanu", "<p>Another edition.</p>");
        let none = add(&mut library, dir.path(), "c", "Carmilla", "Le Fanu", "<p>A third.</p>");
        library.replace_cover(&small, &png(200, 300)).unwrap();
        library.replace_cover(&large, &png(600, 900)).unwrap();
        let group = library.find_duplicates().unwrap().remove(0);
        let size = |id: &str| group.books.iter().find(|b| b.book.id == id).unwrap().cover_size;
        assert_eq!((size(&small), size(&large), size(&none)), (Some([200, 300]), Some([600, 900]), None));

        assert_eq!(library.share_best_cover(&[small.clone(), large.clone(), none.clone()]).unwrap(), 2);
        let now = |l: &Library, id: &str| cover_size(l.cover_of(&id.to_string()).unwrap().as_deref());
        assert_eq!(now(&library, &small), Some([600, 900]));
        assert_eq!(now(&library, &none), Some([600, 900]));
        // Already the best everywhere: nothing more to do.
        assert_eq!(library.share_best_cover(&[small.clone(), large.clone()]).unwrap(), 0);
        // The larger copy goes; the one kept still has its cover.
        library.delete_book(&large).unwrap();
        assert_eq!(now(&library, &small), Some([600, 900]));
    }

    #[test]
    fn book_numbers_keep_a_series_apart() {
        assert!(numbered_apart("Dark City Girls 2", "Dark City Girls 3"));
        assert!(numbered_apart("Dark City Girls", "Dark City Girls 3: An Urban Fantasy"));
        assert!(numbered_apart("Saga: Book 2", "Saga: Book 3"));
        assert!(numbered_apart("Saga (Vol. 1)", "Saga (Vol. 2)"));
        assert!(!numbered_apart("Dark City Girls 3: An Urban Fantasy", "Dark City Girls 3"));
        assert!(!numbered_apart("The Colour of Magic", "The Colour of Magic (Discworld #1)"));
        assert!(!numbered_apart("Dracula", "Dracula (1897)"));
        assert!(!numbered_apart("Catch-22", "Catch-22: A Novel"));
    }

    #[test]
    fn title_keys_ignore_articles_subtitles_and_punctuation() {
        assert_eq!(
            title_key("The Count of Monte-Cristo: Volume 1"),
            "count of monte cristo"
        );
        assert_eq!(title_key("A"), "a");
        assert_eq!(
            author_key(&["Stoker, Bram".into()]),
            author_key(&["Bram Stoker".into()])
        );
    }
}

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
}

fn clean_tag(tag: &str) -> Option<String> {
    let tag: String = tag.split_whitespace().collect::<Vec<_>>().join(" ");
    let tag: String = tag.chars().take(MAX_TAG_CHARS).collect();
    (!tag.is_empty()).then_some(tag)
}

/// A title as it compares with others: lowercase, letters and digits only,
/// without a leading article or a subtitle.
fn title_key(title: &str) -> String {
    let main = title.split([':', '(', '[']).next().unwrap_or(title);
    let words: Vec<String> = main
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .map(str::to_lowercase)
        .collect();
    let skip = usize::from(words.len() > 1 && matches!(words[0].as_str(), "the" | "a" | "an"));
    words[skip..].join(" ")
}

/// The first author's surname, as it compares with others.
fn author_key(authors: &[String]) -> String {
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

    /// Deletes a book from the library on every device. Its highlights and
    /// notes go with it. TBV's own copy of the file on this device is
    /// removed; the file you imported it from is never touched.
    pub fn delete_book(&self, book_id: &str) -> Result<()> {
        if !self.book_exists(book_id)? {
            return Ok(());
        }
        let copy = self.own_copy(book_id)?;
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
            "SELECT EXISTS (SELECT 1 FROM books b JOIN sync_files sf
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
                    r.get::<_, Option<String>>(23)?,
                    r.get::<_, i64>(24)?,
                    r.get::<_, u32>(25)?,
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
                    })
                    .collect(),
            });
        }
        Ok(groups)
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
    use crate::model::{ImportResult, LibraryQuery};

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

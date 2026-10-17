//! A book's details as the Book details page shows them, in their three
//! layers: your own edits, details fetched online (or read from the file
//! beyond the basics), and the book's own metadata. The book file is never
//! changed. Editing many books at once is the same edit applied to each.

use std::collections::BTreeMap;

use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};
use crate::library::Library;
use crate::model::{BookId, BookPreview};
use crate::time::now_utc;

/// Where a fetched cover may come from: the two services the details search
/// uses, and the archive Open Library keeps its pictures in.
fn cover_host_allowed(host: &str) -> bool {
    matches!(host, "books.google.com" | "books.googleusercontent.com" | "covers.openlibrary.org")
        || host.ends_with(".archive.org")
        || host == "archive.org"
}

/// Downloads a cover picture found online, for [`Library::fill_cover`]. Runs
/// without the library, so the app carries on while it downloads.
pub fn download_cover(url: &str) -> Result<Vec<u8>> {
    let host_of = |u: &str| u.strip_prefix("https://").and_then(|rest| rest.split(['/', '?', ':']).next()).map(str::to_string);
    let host = host_of(url).ok_or_else(|| Error::Unsuitable("covers are only fetched over https".into()))?;
    if !cover_host_allowed(&host) {
        return Err(Error::Unsuitable(format!("covers aren't fetched from {host}")));
    }
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(std::time::Duration::from_secs(30)))
        .max_redirects(4)
        .user_agent(concat!("The Bound Vigil/", env!("CARGO_PKG_VERSION"), " (desktop eBook reader)"))
        .build()
        .into();
    let mut response = agent.get(url).call().map_err(|e| Error::Offline(format!("the cover couldn't be downloaded: {e}")))?;
    let bytes = response
        .body_mut()
        .with_config()
        .limit(8 * 1024 * 1024)
        .read_to_vec()
        .map_err(|e| Error::Offline(format!("the cover couldn't be downloaded: {e}")))?;
    Ok(bytes)
}

/// Every detail that can be edited or fetched, in the order the page shows them.
pub const FIELDS: &[&str] = &[
    "title", "authors", "series", "series_index", "synopsis", "genres", "publisher", "published", "language", "isbn",
    "narrators",
];

/// Fields held as a JSON list of names.
const LISTS: &[&str] = &["authors", "genres", "narrators"];
const MAX_LIST: usize = 20;
const MAX_TEXT: usize = 500;
const MAX_SYNOPSIS: usize = 20_000;

/// One detail in its layers. Lists (authors, genres) are JSON arrays.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetailField {
    pub field: String,
    /// From the book file.
    pub own: Option<String>,
    /// Fetched online, or read from the file beyond the basics.
    pub fetched: Option<String>,
    /// Where `fetched` came from: "google", "openlibrary" or "file".
    pub fetched_from: Option<String>,
    /// Your own edit.
    pub edited: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NamedRef {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookDetails {
    pub book: BookPreview,
    pub fields: Vec<DetailField>,
    pub file_size: u64,
    /// The file on this device, if it's here.
    pub file_path: Option<String>,
    /// The collections and reading lists it's in.
    pub collections: Vec<NamedRef>,
    /// Highlights, notes and bookmarks in it.
    pub annotations: u32,
}

/// Sets a detail to `value`, or with `None` takes your edit away so the
/// fetched or own value shows again.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetailChange {
    pub field: String,
    pub value: Option<String>,
}

/// A layer of details by field: the value, and where it came from.
type Layer = BTreeMap<String, (Option<String>, Option<String>)>;

fn label(field: &str) -> &str {
    match field {
        "series_index" => "number in series",
        "isbn" => "ISBN",
        other => other,
    }
}

/// A value as it's kept, or an error saying what's wrong with it.
/// `Ok(None)` is an empty value, kept as an empty edit so it hides the others.
pub(crate) fn clean_value(field: &str, value: &str) -> Result<String> {
    if !FIELDS.contains(&field) {
        return Err(Error::Unsuitable(format!("TBV doesn't keep a detail called {field}")));
    }
    let collapse = |s: &str| s.split_whitespace().collect::<Vec<_>>().join(" ");
    if LISTS.contains(&field) {
        let items: Vec<String> = serde_json::from_str(value)
            .map_err(|_| Error::Unsuitable(format!("the {} should be a list of names", label(field))))?;
        let mut kept: Vec<String> = Vec::new();
        for item in items.iter().map(|i| collapse(i)).filter(|i| !i.is_empty()) {
            let item: String = item.chars().take(MAX_TEXT).collect();
            if kept.len() < MAX_LIST && !kept.iter().any(|k| k.eq_ignore_ascii_case(&item)) {
                kept.push(item);
            }
        }
        if field == "authors" && kept.is_empty() {
            return Err(Error::Unsuitable("a book needs at least one author".into()));
        }
        return Ok(serde_json::to_string(&kept)?);
    }
    let text = if field == "synopsis" {
        value.trim().chars().take(MAX_SYNOPSIS).collect::<String>()
    } else {
        collapse(value).chars().take(MAX_TEXT).collect()
    };
    match field {
        "title" if text.is_empty() => Err(Error::Unsuitable("a book needs a title".into())),
        "series_index" if !text.is_empty() => text
            .replace(',', ".")
            .parse::<f64>()
            .ok()
            .filter(|n| n.is_finite() && *n >= 0.0 && *n < 100_000.0)
            .map(|n| n.to_string())
            .ok_or_else(|| Error::Unsuitable("the number in series should be a number, like 2 or 2.5".into())),
        "isbn" if !text.is_empty() => {
            let digits: String = text.chars().filter(|c| c.is_ascii_alphanumeric()).collect::<String>().to_uppercase();
            if digits.len() == 10 || digits.len() == 13 {
                Ok(digits)
            } else {
                Err(Error::Unsuitable("an ISBN has 10 or 13 digits".into()))
            }
        }
        _ => Ok(text),
    }
}

impl Library {
    pub fn book_details(&self, book_id: &str) -> Result<BookDetails> {
        let book = self
            .book(book_id)?
            .ok_or_else(|| Error::Unsuitable("This book is no longer in your library.".into()))?;
        let (own, file_size, file_path): (BTreeMap<String, Option<String>>, i64, Option<String>) = self.conn.query_row(
            "SELECT b.title, b.authors, b.series, b.series_index, b.synopsis, b.publisher, b.language, b.isbn,
                    b.file_size, lf.path, ab.narrators
             FROM books b LEFT JOIN local_files lf ON lf.book_id = b.id LEFT JOIN audiobooks ab ON ab.book_id = b.id
             WHERE b.id = ?1",
            params![book_id],
            |r| {
                let mut own = BTreeMap::new();
                own.insert("title".to_string(), r.get(0)?);
                own.insert("authors".to_string(), r.get(1)?);
                own.insert("series".to_string(), r.get(2)?);
                own.insert("series_index".to_string(), r.get::<_, Option<f64>>(3)?.map(|n| n.to_string()));
                own.insert("synopsis".to_string(), r.get(4)?);
                own.insert("publisher".to_string(), r.get(5)?);
                own.insert("language".to_string(), r.get(6)?);
                own.insert("isbn".to_string(), r.get(7)?);
                own.insert("narrators".to_string(), r.get(10)?);
                Ok((own, r.get(8)?, r.get(9)?))
            },
        )?;
        let layer = |table: &str| -> Result<Layer> {
            let source = if table == "metadata_fetched" { "source" } else { "NULL" };
            let mut statement =
                self.conn.prepare(&format!("SELECT field, value, {source} FROM {table} WHERE book_id = ?1"))?;
            let rows = statement.query_map(params![book_id], |r| Ok((r.get::<_, String>(0)?, (r.get(1)?, r.get(2)?))))?;
            Ok(rows.collect::<std::result::Result<_, _>>()?)
        };
        let edited = layer("metadata_overrides")?;
        let fetched = layer("metadata_fetched")?;
        let fields = FIELDS
            .iter()
            .map(|&f| DetailField {
                field: f.to_string(),
                own: own.get(f).cloned().flatten(),
                fetched: fetched.get(f).and_then(|v| v.0.clone()),
                fetched_from: fetched.get(f).and_then(|v| v.1.clone()),
                edited: edited.get(f).and_then(|v| v.0.clone()),
            })
            .collect();

        let mut statement = self.conn.prepare(
            "SELECT c.id, c.name FROM collection_books cb JOIN collections c ON c.id = cb.collection_id
             WHERE cb.book_id = ?1 AND cb.removed_at IS NULL AND c.deleted_at IS NULL AND c.kind != 'shelf'
             ORDER BY c.name COLLATE NOCASE",
        )?;
        let collections = statement
            .query_map(params![book_id], |r| Ok(NamedRef { id: r.get(0)?, name: r.get(1)? }))?
            .collect::<std::result::Result<_, _>>()?;
        let annotations = self.conn.query_row(
            "SELECT COUNT(*) FROM annotations WHERE book_id = ?1 AND deleted_at IS NULL",
            params![book_id],
            |r| r.get(0),
        )?;
        Ok(BookDetails { book, fields, file_size: file_size.max(0) as u64, file_path, collections, annotations })
    }

    /// Applies the same changes to each of these books. Nothing is changed if any value is unsuitable.
    pub fn edit_details(&self, book_ids: &[BookId], changes: &[DetailChange]) -> Result<()> {
        let cleaned = changes
            .iter()
            .map(|c| match &c.value {
                Some(v) => clean_value(&c.field, v).map(|v| (c.field.as_str(), Some(v))),
                None if FIELDS.contains(&c.field.as_str()) => Ok((c.field.as_str(), None)),
                None => Err(Error::Unsuitable(format!("TBV doesn't keep a detail called {}", c.field))),
            })
            .collect::<Result<Vec<_>>>()?;
        let now = now_utc();
        let tx = self.conn.unchecked_transaction()?;
        for id in book_ids {
            let exists = tx
                .query_row("SELECT 1 FROM books WHERE id = ?1 AND deleted_at IS NULL", params![id], |_| Ok(()))
                .optional()?
                .is_some();
            if !exists {
                continue;
            }
            for (field, value) in &cleaned {
                match value {
                    Some(v) => tx.execute(
                        "INSERT INTO metadata_overrides (book_id, field, value, updated_at) VALUES (?1, ?2, ?3, ?4)
                         ON CONFLICT(book_id, field) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
                         WHERE value IS NOT excluded.value",
                        params![id, field, v, now],
                    )?,
                    None => tx.execute(
                        "DELETE FROM metadata_overrides WHERE book_id = ?1 AND field = ?2",
                        params![id, field],
                    )?,
                };
            }
        }
        tx.commit()?;
        Ok(())
    }

    /// Takes away your edits to a book, and with `fetched` also what was fetched
    /// online, so it shows its own details again.
    pub fn reset_details(&self, book_id: &str, fetched: bool) -> Result<()> {
        self.conn.execute("DELETE FROM metadata_overrides WHERE book_id = ?1", params![book_id])?;
        if fetched {
            self.conn
                .execute("DELETE FROM metadata_fetched WHERE book_id = ?1 AND source != 'file'", params![book_id])?;
        }
        Ok(())
    }

    /// Keeps details found online (`source` "google" or "openlibrary"). Only the
    /// fields given change; empty values are skipped.
    pub fn save_fetched(&self, book_id: &str, source: &str, values: &BTreeMap<String, String>) -> Result<()> {
        if !matches!(source, "google" | "openlibrary" | "file") {
            return Err(Error::Unsuitable(format!("unknown source {source}")));
        }
        let mut cleaned = Vec::new();
        for (field, value) in values {
            let v = clean_value(field, value)?;
            if !v.is_empty() && v != "[]" {
                cleaned.push((field.as_str(), v));
            }
        }
        let now = now_utc();
        let tx = self.conn.unchecked_transaction()?;
        for (field, value) in cleaned {
            tx.execute(
                "INSERT INTO metadata_fetched (book_id, field, value, source, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(book_id, field) DO UPDATE SET value = excluded.value, source = excluded.source,
                    updated_at = excluded.updated_at
                 WHERE value IS NOT excluded.value OR source IS NOT excluded.source",
                params![book_id, field, value, source, now],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    /// Genres and the publication date read from a newly imported file, kept
    /// with the fetched details so they sync, unless something is there already.
    pub(crate) fn keep_file_details(&self, book_id: &str, subjects: &[String], published: Option<&str>) -> Result<()> {
        let now = now_utc();
        let put = |field: &str, value: String| -> Result<()> {
            self.conn.execute(
                "INSERT OR IGNORE INTO metadata_fetched (book_id, field, value, source, updated_at) VALUES (?1, ?2, ?3, 'file', ?4)",
                params![book_id, field, value, now],
            )?;
            Ok(())
        };
        if !subjects.is_empty() {
            put("genres", clean_value("genres", &serde_json::to_string(subjects)?)?)?;
        }
        if let Some(date) = published.map(str::trim).filter(|d| !d.is_empty()) {
            put("published", clean_value("published", date)?)?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::epub::tests::write_test_epub;
    use crate::library::tests::open_temp_library;
    use crate::model::{ItemKind, LibraryQuery, SortOrder};

    fn import(library: &mut Library, dir: &std::path::Path, title: &str) -> BookId {
        let path = dir.join(format!("{title}.epub"));
        write_test_epub(&path, title, "Mary Shelley", false);
        library.import_files(&[path]);
        library.home().unwrap().recently_added.into_iter().find(|b| b.title == title).unwrap().id
    }

    #[test]
    fn edits_sit_over_fetched_details_over_the_books_own() {
        let (dir, mut library) = open_temp_library();
        let id = import(&mut library, dir.path(), "Frankenstein");
        let fetched = BTreeMap::from([
            ("title".to_string(), "Frankenstein; or, The Modern Prometheus".to_string()),
            ("genres".to_string(), r#"["Gothic fiction", "Science fiction"]"#.to_string()),
        ]);
        library.save_fetched(&id, "openlibrary", &fetched).unwrap();
        let book = library.book(&id).unwrap().unwrap();
        assert_eq!(book.title, "Frankenstein; or, The Modern Prometheus");
        assert_eq!(book.genres, ["Gothic fiction", "Science fiction"]);

        library.edit_details(std::slice::from_ref(&id), &[DetailChange { field: "title".into(), value: Some("  My   Frankenstein ".into()) }]).unwrap();
        assert_eq!(library.book(&id).unwrap().unwrap().title, "My Frankenstein");
        let details = library.book_details(&id).unwrap();
        let title = details.fields.iter().find(|f| f.field == "title").unwrap();
        assert_eq!(title.own.as_deref(), Some("Frankenstein"));
        assert_eq!(title.fetched_from.as_deref(), Some("openlibrary"));
        assert_eq!(title.edited.as_deref(), Some("My Frankenstein"));

        // Taking the edit away shows the fetched title; a full reset, the book's own.
        library.edit_details(std::slice::from_ref(&id), &[DetailChange { field: "title".into(), value: None }]).unwrap();
        assert_eq!(library.book(&id).unwrap().unwrap().title, "Frankenstein; or, The Modern Prometheus");
        library.reset_details(&id, true).unwrap();
        assert_eq!(library.book(&id).unwrap().unwrap().title, "Frankenstein");
    }

    #[test]
    fn genres_and_date_come_from_the_file() {
        let (dir, mut library) = open_temp_library();
        let path = dir.path().join("dracula.epub");
        crate::epub::tests::write_test_epub_with(
            &path,
            "Dracula",
            "Bram Stoker",
            false,
            "<dc:subject>Horror</dc:subject><dc:subject>Vampires</dc:subject><dc:date>1897-05-26T00:00:00Z</dc:date>",
        );
        library.import_files(&[path]);
        let id = library.home().unwrap().recently_added[0].id.clone();
        assert_eq!(library.book(&id).unwrap().unwrap().genres, ["Horror", "Vampires"]);
        let details = library.book_details(&id).unwrap();
        let published = details.fields.iter().find(|f| f.field == "published").unwrap();
        assert_eq!((published.fetched.as_deref(), published.fetched_from.as_deref()), (Some("1897-05-26"), Some("file")));
    }

    #[test]
    fn unsuitable_values_change_nothing() {
        let (dir, mut library) = open_temp_library();
        let id = import(&mut library, dir.path(), "Dracula");
        let changes = [
            DetailChange { field: "series".into(), value: Some("Gothic".into()) },
            DetailChange { field: "isbn".into(), value: Some("12".into()) },
        ];
        assert!(library.edit_details(std::slice::from_ref(&id), &changes).is_err());
        assert_eq!(library.book(&id).unwrap().unwrap().series, None);
        assert!(clean_value("title", "  ").is_err());
        assert!(clean_value("authors", "[]").is_err());
        assert_eq!(clean_value("series_index", "2,5").unwrap(), "2.5");
        assert_eq!(clean_value("isbn", "978-0-14-143984-6").unwrap(), "9780141439846");
        assert_eq!(clean_value("genres", r#"["Horror", "horror", " Gothic "]"#).unwrap(), r#"["Horror","Gothic"]"#);
    }

    #[test]
    fn many_books_at_once_and_genres_sort_and_filter() {
        let (dir, mut library) = open_temp_library();
        let a = import(&mut library, dir.path(), "Carmilla");
        let b = import(&mut library, dir.path(), "Emma");
        let c = import(&mut library, dir.path(), "Middlemarch");
        library
            .edit_details(&[a.clone(), b.clone()], &[DetailChange { field: "genres".into(), value: Some(r#"["Romance"]"#.into()) }])
            .unwrap();
        library.edit_details(std::slice::from_ref(&a), &[DetailChange { field: "genres".into(), value: Some(r#"["Gothic"]"#.into()) }]).unwrap();
        let query = |genres: Vec<String>, sort| LibraryQuery { genres, sort, page_size: 50, ..Default::default() };
        let page = library.library_page(&query(vec![], SortOrder::Genre)).unwrap();
        assert_eq!(page.books.iter().map(|x| x.id.clone()).collect::<Vec<_>>(), [a.clone(), b.clone(), c.clone()]);
        assert_eq!(page.genres, ["Gothic", "Romance"]);
        let romance = library.library_page(&query(vec!["romance".into()], SortOrder::Title)).unwrap();
        assert_eq!(romance.books.iter().map(|x| x.id.clone()).collect::<Vec<_>>(), [b]);
        let docs = library.library_page(&LibraryQuery { kind: Some(ItemKind::Documents), ..Default::default() }).unwrap();
        assert_eq!((docs.total, docs.counts.all), (0, 0), "EPUBs belong in the Library");
    }
}

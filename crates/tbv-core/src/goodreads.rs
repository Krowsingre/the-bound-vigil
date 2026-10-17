//! Bringing in what you kept on Goodreads, from the export file it gives
//! you (My Books › Import and export). Goodreads closed its API in 2020, so
//! the export is the one way in.
//!
//! Each row is matched to a book already in the library, first by ISBN, then
//! by title and author. A matched book takes your Goodreads rating, its read
//! status and finish date, Up next for "to-read", Favourites for a favourites
//! shelf, and your other shelves as collections. Anything you already set in
//! TBV is kept: the export only fills in what's missing. Rows for books that
//! aren't in the library are listed, never added as empty books.

use std::collections::HashMap;
use std::path::Path;

use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::epub::{clean_isbn, read_epub_metadata, BookMetadata};
use crate::error::{Error, Result};
use crate::library::Library;
use crate::model::{BookId, CollectionInput, CollectionKind};

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoodreadsImport {
    /// Books in the export file.
    pub rows: u32,
    /// Of those, the ones found in this library.
    pub matched: u32,
    pub ratings: u32,
    /// Books marked read or in progress.
    pub statuses: u32,
    pub up_next: u32,
    pub favourites: u32,
    /// Your own Goodreads shelves that became new collections.
    pub collections_created: Vec<String>,
    /// Books added to collections (new or existing).
    pub collection_books: u32,
    /// "Title by Author" for each book that isn't in the library.
    pub not_found: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct Row {
    #[serde(rename = "Title", default)]
    title: String,
    #[serde(rename = "Author", default)]
    author: String,
    #[serde(rename = "Additional Authors", default)]
    additional_authors: String,
    #[serde(rename = "ISBN", default)]
    isbn: String,
    #[serde(rename = "ISBN13", default)]
    isbn13: String,
    #[serde(rename = "My Rating", default)]
    rating: String,
    #[serde(rename = "Date Read", default)]
    date_read: String,
    #[serde(rename = "Bookshelves", default)]
    shelves: String,
    #[serde(rename = "Exclusive Shelf", default)]
    exclusive_shelf: String,
}

struct Known {
    id: BookId,
    isbn: Option<String>,
    title: String,
    short_title: String,
    surnames: Vec<String>,
}

/// Lowercase letters and digits only, so punctuation and spacing never
/// stop a match. Goodreads adds the series to titles, "Dune (Dune, #1)",
/// which is dropped.
fn title_key(title: &str) -> String {
    let main = title.split(" (").next().unwrap_or(title);
    main.chars().filter(|c| c.is_alphanumeric()).flat_map(char::to_lowercase).collect()
}

/// The title without a subtitle after a colon. Only trusted when it points
/// at a single book, since "Collected Essays: Volume One" and "…: Volume Two"
/// share it.
fn short_title_key(title: &str) -> String {
    title_key(title.split(':').next().unwrap_or(title))
}

/// The last word of a name, "Ursula K. Le Guin" → "guin", which survives
/// initials and "Last, First" both being written different ways.
fn surname(name: &str) -> Option<String> {
    let name = match name.split_once(',') {
        Some((last, _)) => last,
        None => name,
    };
    name.split_whitespace()
        .last()
        .map(|w| w.chars().filter(|c| c.is_alphanumeric()).flat_map(char::to_lowercase).collect())
        .filter(|w: &String| !w.is_empty())
}

/// Goodreads writes ISBNs as `="9780441013593"` so spreadsheets keep the zeros.
fn export_isbn(raw: &str) -> Option<String> {
    clean_isbn(raw.trim_start_matches('=').trim_matches('"'))
}

/// `2023/05/14` → `2023-05-14T12:00:00.000Z`. Midday, so the day stays the same
/// in any time zone.
fn export_date(raw: &str) -> Option<String> {
    let parts: Vec<u32> = raw.trim().split(['/', '-']).map(|p| p.parse().ok()).collect::<Option<_>>()?;
    match parts[..] {
        [y, m, d] if (1..=12).contains(&m) && (1..=31).contains(&d) && y > 1000 => {
            Some(format!("{y:04}-{m:02}-{d:02}T12:00:00.000Z"))
        }
        _ => None,
    }
}

/// "science-fiction" → "Science fiction".
fn shelf_name(slug: &str) -> String {
    let words = slug.trim().replace(['-', '_'], " ");
    let mut chars = words.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().chain(chars).collect(),
        None => String::new(),
    }
}

const EXCLUSIVE: &[&str] = &["read", "currently-reading", "to-read"];
const FAVOURITE_SHELVES: &[&str] = &["favorites", "favourites", "favorite", "favourite"];

impl Library {
    pub fn import_goodreads(&self, file: &Path) -> Result<GoodreadsImport> {
        let unreadable = |e: csv::Error| Error::Unsuitable(format!("this isn't a Goodreads export TBV can read ({e})"));
        let mut reader = csv::ReaderBuilder::new().flexible(true).from_path(file).map_err(unreadable)?;
        let headers = reader.headers().map_err(unreadable)?.clone();
        if !headers.iter().any(|h| h == "Exclusive Shelf") || !headers.iter().any(|h| h == "Title") {
            return Err(Error::Unsuitable(
                "this file isn't a Goodreads export. On Goodreads, open My Books › Import and export, and choose Export Library".into(),
            ));
        }
        let rows: Vec<Row> = reader.deserialize().collect::<std::result::Result<_, _>>().map_err(unreadable)?;

        self.fill_missing_isbns()?;
        let known = self.books_for_matching()?;
        let mut by_isbn: HashMap<&str, usize> = HashMap::new();
        let mut by_title: HashMap<&str, Vec<usize>> = HashMap::new();
        let mut by_short_title: HashMap<&str, Vec<usize>> = HashMap::new();
        for (i, k) in known.iter().enumerate() {
            if let Some(isbn) = &k.isbn {
                by_isbn.insert(isbn, i);
            }
            by_title.entry(k.title.as_str()).or_default().push(i);
            by_short_title.entry(k.short_title.as_str()).or_default().push(i);
        }

        let mut report = GoodreadsImport { rows: rows.len() as u32, ..Default::default() };
        let mut shelves: HashMap<String, Vec<BookId>> = HashMap::new();
        for row in &rows {
            let found = [&row.isbn13, &row.isbn]
                .iter()
                .find_map(|raw| export_isbn(raw).and_then(|isbn| by_isbn.get(isbn.as_str()).copied()))
                .or_else(|| {
                    let names = std::iter::once(row.author.as_str()).chain(row.additional_authors.split(','));
                    let wanted: Vec<String> = names.filter_map(surname).collect();
                    let by_author = |i: &usize| wanted.is_empty() || known[*i].surnames.iter().any(|s| wanted.contains(s));
                    let exact = by_title.get(title_key(&row.title).as_str()).and_then(|c| c.iter().copied().find(by_author));
                    exact.or_else(|| {
                        let short = short_title_key(&row.title);
                        let mut candidates: Vec<usize> = by_short_title.get(short.as_str())?.iter().copied().filter(by_author).collect();
                        candidates.extend(by_title.get(short.as_str()).into_iter().flatten().copied().filter(by_author));
                        candidates.sort_unstable();
                        candidates.dedup();
                        match candidates[..] {
                            [only] => Some(only),
                            _ => None,
                        }
                    })
                });
            let Some(index) = found else {
                report.not_found.push(if row.author.trim().is_empty() {
                    row.title.trim().to_string()
                } else {
                    format!("{} by {}", row.title.trim(), row.author.trim())
                });
                continue;
            };
            report.matched += 1;
            let id = &known[index].id;

            if let Ok(stars @ 1..=5) = row.rating.trim().parse::<u8>() {
                if self.conn.execute("UPDATE books SET rating = ?2 WHERE id = ?1 AND rating IS NULL", params![id, stars])? > 0 {
                    report.ratings += 1;
                }
            }
            let finished = export_date(&row.date_read);
            let changed = match row.exclusive_shelf.trim() {
                // A book being read again here keeps its in-progress status.
                "read" => {
                    self.conn.execute(
                        "UPDATE books SET status = 'read', finished_at = COALESCE(finished_at, ?2)
                         WHERE id = ?1 AND (status = 'unread' OR (status = 'read' AND finished_at IS NULL AND ?2 IS NOT NULL))",
                        params![id, finished],
                    )? > 0
                }
                "currently-reading" => {
                    self.conn.execute("UPDATE books SET status = 'in_progress' WHERE id = ?1 AND status = 'unread'", params![id])? > 0
                }
                "to-read" => {
                    if self.conn.execute("UPDATE books SET want_to_read = 1 WHERE id = ?1 AND want_to_read = 0", params![id])? > 0 {
                        report.up_next += 1;
                    }
                    false
                }
                _ => false,
            };
            if changed {
                report.statuses += 1;
            }
            for shelf in row.shelves.split(',').map(str::trim).filter(|s| !s.is_empty()) {
                let slug = shelf.to_ascii_lowercase();
                if EXCLUSIVE.contains(&slug.as_str()) {
                    continue;
                }
                if FAVOURITE_SHELVES.contains(&slug.as_str()) {
                    if self.conn.execute("UPDATE books SET favorite = 1 WHERE id = ?1 AND favorite = 0", params![id])? > 0 {
                        report.favourites += 1;
                    }
                    continue;
                }
                shelves.entry(shelf_name(shelf)).or_default().push(id.clone());
            }
        }

        let mut names: Vec<_> = shelves.into_iter().filter(|(name, _)| !name.is_empty()).collect();
        names.sort_by(|a, b| a.0.cmp(&b.0));
        for (name, books) in names {
            let existing: Option<String> = self
                .conn
                .query_row(
                    "SELECT id FROM collections WHERE deleted_at IS NULL AND kind != 'shelf' AND name = ?1 COLLATE NOCASE",
                    params![name],
                    |r| r.get(0),
                )
                .optional()?;
            let id = match existing {
                Some(id) => id,
                None => {
                    let made = self.create_collection(&CollectionInput {
                        name: name.clone(),
                        description: Some("From your Goodreads shelves.".into()),
                        kind: CollectionKind::Collection,
                        badge: None,
                        pinned: false,
                        rules: None,
                    })?;
                    report.collections_created.push(name);
                    made.id
                }
            };
            let already: i64 = self.conn.query_row(
                "SELECT COUNT(*) FROM collection_books WHERE collection_id = ?1 AND removed_at IS NULL",
                params![id],
                |r| r.get(0),
            )?;
            self.add_to_collection(&id, &books)?;
            let now: i64 = self.conn.query_row(
                "SELECT COUNT(*) FROM collection_books WHERE collection_id = ?1 AND removed_at IS NULL",
                params![id],
                |r| r.get(0),
            )?;
            report.collection_books += (now - already).max(0) as u32;
        }
        Ok(report)
    }

    fn books_for_matching(&self) -> Result<Vec<Known>> {
        let mut statement = self.conn.prepare(
            "SELECT b.id, b.isbn, COALESCE(o_title.value, b.title), COALESCE(o_authors.value, b.authors)
             FROM books b
             LEFT JOIN metadata_overrides o_title ON o_title.book_id = b.id AND o_title.field = 'title'
             LEFT JOIN metadata_overrides o_authors ON o_authors.book_id = b.id AND o_authors.field = 'authors'
             WHERE b.deleted_at IS NULL",
        )?;
        let rows = statement.query_map([], |r| {
            let authors: String = r.get(3)?;
            let authors: Vec<String> = serde_json::from_str(&authors).unwrap_or_default();
            Ok(Known {
                id: r.get(0)?,
                isbn: r.get(1)?,
                title: title_key(&r.get::<_, String>(2)?),
                short_title: short_title_key(&r.get::<_, String>(2)?),
                surnames: authors.iter().filter_map(|a| surname(a)).collect(),
            })
        })?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    /// Books imported before TBV kept ISBNs have none on record, so they are
    /// read from the EPUBs on this device the first time they're needed.
    fn fill_missing_isbns(&self) -> Result<()> {
        let missing: Vec<(BookId, String)> = {
            let mut statement = self.conn.prepare(
                "SELECT b.id, f.path FROM books b JOIN local_files f ON f.book_id = b.id
                 WHERE b.isbn IS NULL AND b.format = 'epub' AND b.deleted_at IS NULL AND f.path IS NOT NULL AND f.path != ''",
            )?;
            let rows = statement.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
            rows.collect::<std::result::Result<_, _>>()?
        };
        for (id, path) in missing {
            if let Ok(BookMetadata { isbn: Some(isbn), .. }) = read_epub_metadata(Path::new(&path)) {
                self.conn.execute("UPDATE books SET isbn = ?2 WHERE id = ?1 AND isbn IS NULL", params![id, isbn])?;
            }
        }
        Ok(())
    }
}

/// Goodreads' own export columns, which its importer reads back.
const EXPORT_HEADER: [&str; 24] = [
    "Book Id", "Title", "Author", "Author l-f", "Additional Authors", "ISBN", "ISBN13", "My Rating",
    "Average Rating", "Publisher", "Binding", "Number of Pages", "Year Published", "Original Publication Year",
    "Date Read", "Date Added", "Bookshelves", "Bookshelves with positions", "Exclusive Shelf", "My Review",
    "Spoiler", "Private Notes", "Read Count", "Owned Copies",
];

/// "Mary Shelley" as Goodreads files it: "Shelley, Mary".
fn last_first(name: &str) -> String {
    match name.trim().rsplit_once(' ') {
        Some((first, last)) => format!("{last}, {first}"),
        None => name.trim().to_string(),
    }
}

/// A shelf name the way Goodreads writes them: "Sci fi" becomes "sci-fi".
fn goodreads_shelf(name: &str) -> String {
    name.trim().to_lowercase().split_whitespace().collect::<Vec<_>>().join("-")
}

/// Goodreads dates are written 2024/05/14.
fn goodreads_date(iso: &str) -> String {
    iso.get(..10).map(|d| d.replace('-', "/")).unwrap_or_default()
}

impl Library {
    /// Writes a file in Goodreads' export format, for its importer (My Books
    /// › Import and export › Import). Books you've rated, read, started or
    /// put in Up next are included; others would only crowd your Goodreads
    /// shelves. Returns how many books were written.
    pub fn export_goodreads(&self, file: &Path) -> Result<u32> {
        let mut statement = self.conn.prepare(
            "SELECT b.id, COALESCE(o_title.value, b.title), COALESCE(o_authors.value, b.authors), b.isbn, b.rating,
                    b.status, b.finished_at, b.added_at, b.want_to_read, b.favorite, b.publisher
             FROM books b
             LEFT JOIN metadata_overrides o_title ON o_title.book_id = b.id AND o_title.field = 'title'
             LEFT JOIN metadata_overrides o_authors ON o_authors.book_id = b.id AND o_authors.field = 'authors'
             WHERE b.deleted_at IS NULL AND (b.rating IS NOT NULL OR b.status != 'unread' OR b.want_to_read = 1)
             ORDER BY b.added_at",
        )?;
        type ExportRow = (String, String, String, Option<String>, Option<u8>, String, Option<String>, String, bool, bool, Option<String>);
        let rows: Vec<ExportRow> = statement
            .query_map([], |r| {
                Ok((
                    r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?, r.get(7)?, r.get(8)?,
                    r.get(9)?, r.get(10)?,
                ))
            })?
            .collect::<std::result::Result<_, _>>()?;
        let mut shelves_of = self.conn.prepare(
            "SELECT c.name FROM collection_books cb JOIN collections c ON c.id = cb.collection_id
             WHERE cb.book_id = ?1 AND cb.removed_at IS NULL AND c.deleted_at IS NULL AND c.kind != 'shelf'
             ORDER BY c.name",
        )?;

        let mut writer = csv::Writer::from_path(file).map_err(|e| Error::Unsuitable(e.to_string()))?;
        writer.write_record(EXPORT_HEADER).map_err(|e| Error::Unsuitable(e.to_string()))?;
        // Books in Up next and other unread books go to Goodreads' "to-read".
        for (id, title, authors, isbn, rating, status, finished, added, _up_next, favourite, publisher) in &rows {
            let authors: Vec<String> = serde_json::from_str(authors).unwrap_or_default();
            let exclusive = match status.as_str() {
                "read" => "read",
                "in_progress" => "currently-reading",
                _ => "to-read",
            };
            let mut shelves: Vec<String> = shelves_of
                .query_map(params![id], |r| r.get::<_, String>(0))?
                .collect::<std::result::Result<Vec<_>, _>>()?
                .iter()
                .map(|s| goodreads_shelf(s))
                .collect();
            if *favourite {
                shelves.push("favorites".into());
            }
            let (isbn10, isbn13) = match isbn.as_deref() {
                Some(i) if i.len() == 13 => (String::new(), i.to_string()),
                Some(i) => (i.to_string(), String::new()),
                None => (String::new(), String::new()),
            };
            let first = authors.first().cloned().unwrap_or_default();
            let record = [
                String::new(),
                title.clone(),
                first.clone(),
                last_first(&first),
                authors.iter().skip(1).cloned().collect::<Vec<_>>().join(", "),
                isbn10,
                isbn13,
                rating.map(|r| r.to_string()).unwrap_or_else(|| "0".into()),
                String::new(),
                publisher.clone().unwrap_or_default(),
                String::new(),
                String::new(),
                String::new(),
                String::new(),
                if exclusive == "read" { finished.as_deref().map(goodreads_date).unwrap_or_default() } else { String::new() },
                goodreads_date(added),
                shelves.join(", "),
                String::new(),
                exclusive.to_string(),
                String::new(),
                String::new(),
                String::new(),
                if exclusive == "read" { "1" } else { "0" }.to_string(),
                "0".to_string(),
            ];
            writer.write_record(&record).map_err(|e| Error::Unsuitable(e.to_string()))?;
        }
        writer.flush()?;
        Ok(rows.len() as u32)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::epub::tests::write_test_epub;
    use crate::library::tests::open_temp_library;
    use crate::model::{CollectionRef, ImportResult, ReadStatus};
    use std::fs;

    const HEADER: &str = "Book Id,Title,Author,Author l-f,Additional Authors,ISBN,ISBN13,My Rating,Average Rating,Publisher,Binding,Number of Pages,Year Published,Original Publication Year,Date Read,Date Added,Bookshelves,Bookshelves with positions,Exclusive Shelf,My Review,Spoiler,Private Notes,Read Count,Owned Copies";

    fn add(library: &mut Library, dir: &Path, title: &str, author: &str) -> BookId {
        let path = dir.join(format!("{title}.epub"));
        write_test_epub(&path, title, author, false);
        match &library.import_files(&[path])[0] {
            ImportResult::Imported { book_id, .. } => book_id.clone(),
            other => panic!("unexpected {other:?}"),
        }
    }

    #[test]
    fn goodreads_fills_in_what_tbv_does_not_have() {
        let (dir, mut library) = open_temp_library();
        let dune = add(&mut library, dir.path(), "Dune", "Frank Herbert");
        let lathe = add(&mut library, dir.path(), "The Lathe of Heaven", "Ursula K. Le Guin");
        let emma = add(&mut library, dir.path(), "Emma", "Jane Austen");
        library.set_rating(&emma, Some(2)).unwrap();
        let export = dir.path().join("goodreads_library_export.csv");
        fs::write(
            &export,
            format!(
                "{HEADER}\n\
                 1,\"Dune (Dune, #1)\",Frank Herbert,\"Herbert, Frank\",,=\"\",=\"\",5,4.2,Ace,Paperback,600,1990,1965,2023/05/14,2022/01/02,\"sci-fi, favorites\",,read,,,,1,0\n\
                 2,\"The Lathe of Heaven\",Ursula K. Le Guin,\"Le Guin, Ursula K.\",,=\"\",=\"\",0,4.0,Avon,Paperback,184,1971,1971,,2022/01/02,\"to-read, sci-fi\",,to-read,,,,0,0\n\
                 3,Emma,Jane Austen,\"Austen, Jane\",,=\"\",=\"\",4,3.9,Penguin,Paperback,474,2003,1815,,2022/01/02,currently-reading,,currently-reading,,,,0,0\n\
                 4,Middlemarch,George Eliot,\"Eliot, George\",,=\"\",=\"\",5,4.0,Penguin,Paperback,880,2003,1871,2021/03/01,2021/01/01,,,read,,,,1,0\n"
            ),
        )
        .unwrap();

        let report = library.import_goodreads(&export).unwrap();
        assert_eq!(report.rows, 4);
        assert_eq!(report.matched, 3);
        assert_eq!(report.not_found, ["Middlemarch by George Eliot"]);
        assert_eq!(report.ratings, 1, "Emma keeps the rating set in TBV");
        assert_eq!(report.statuses, 2);
        assert_eq!(report.up_next, 1);
        assert_eq!(report.favourites, 1);
        assert_eq!(report.collections_created, ["Sci fi"]);
        assert_eq!(report.collection_books, 2);

        let book = |id: &str| library.book(id).unwrap().unwrap();
        assert_eq!(book(&dune).rating, Some(5));
        assert_eq!(book(&dune).status, ReadStatus::Read);
        assert_eq!(book(&dune).finished_at.as_deref(), Some("2023-05-14T12:00:00.000Z"));
        assert!(book(&dune).favorite);
        assert!(book(&lathe).want_to_read);
        assert_eq!(book(&emma).rating, Some(2));
        assert_eq!(book(&emma).status, ReadStatus::InProgress);

        // Importing again changes nothing and makes no second collection.
        let again = library.import_goodreads(&export).unwrap();
        assert_eq!((again.ratings, again.statuses, again.collection_books), (0, 0, 0));
        assert!(again.collections_created.is_empty());
        let overview = library.collections_overview().unwrap();
        let sci_fi = overview.collections.iter().find(|c| c.name == "Sci fi").unwrap();
        assert_eq!(sci_fi.count, 2);
        assert_eq!(sci_fi.rating, Some(5.0));
        let detail = library.collection_detail(&CollectionRef::Collection { id: sci_fi.id.clone() }).unwrap();
        assert_eq!(detail.books.len(), 2);
    }

    #[test]
    fn goodreads_export_reads_back_in() {
        let (dir, mut library) = open_temp_library();
        let dune = add(&mut library, dir.path(), "Dune", "Frank Herbert");
        let lathe = add(&mut library, dir.path(), "The Lathe of Heaven", "Ursula K. Le Guin");
        let _untouched = add(&mut library, dir.path(), "Emma", "Jane Austen");
        library.set_rating(&dune, Some(5)).unwrap();
        library.set_status(&dune, ReadStatus::Read).unwrap();
        library.set_favorite(&dune, true).unwrap();
        library.set_want_to_read(&lathe, true).unwrap();
        let file = dir.path().join("out.csv");
        assert_eq!(library.export_goodreads(&file).unwrap(), 2);
        let text = fs::read_to_string(&file).unwrap();
        assert!(text.starts_with("Book Id,Title,Author,Author l-f"), "{text}");
        assert!(text.contains("Dune,Frank Herbert,\"Herbert, Frank\""), "{text}");
        assert!(text.contains(",5,"), "{text}");
        assert!(text.contains("favorites"), "{text}");
        assert!(text.contains("to-read"), "{text}");
        assert!(!text.contains("Emma"), "{text}");

        // A fresh library takes it all back through the Goodreads import.
        let (dir2, mut other) = open_temp_library();
        let dune2 = add(&mut other, dir2.path(), "Dune", "Frank Herbert");
        let report = other.import_goodreads(&file).unwrap();
        assert_eq!(report.matched, 1);
        let back = other.book(&dune2).unwrap().unwrap();
        assert_eq!(back.rating, Some(5));
        assert!(back.favorite);
    }

    #[test]
    fn close_titles_rereads_and_older_books_are_handled_carefully() {
        let (dir, mut library) = open_temp_library();
        let one = add(&mut library, dir.path(), "Collected Essays: Volume One", "Mary Hale");
        let two = add(&mut library, dir.path(), "Collected Essays: Volume Two", "Mary Hale");
        let emma = add(&mut library, dir.path(), "Emma", "Jane Austen");
        library.set_status(&emma, ReadStatus::InProgress).unwrap();
        // A book imported before ISBNs were kept, under a different title.
        let path = dir.path().join("lathe.epub");
        crate::epub::tests::write_test_epub_with(&path, "Lathe", "U. Le Guin", false, "<dc:identifier>urn:isbn:9780060512750</dc:identifier>");
        let ImportResult::Imported { book_id: lathe, .. } = &library.import_files(&[path])[0] else { panic!() };
        library.conn.execute("UPDATE books SET isbn = NULL", []).unwrap();

        let export = dir.path().join("export.csv");
        fs::write(
            &export,
            format!(
                "{HEADER}\n\
                 1,\"Collected Essays: Volume Two\",Mary Hale,,,=\"\",=\"\",4,4,,,,,,,,,,read,,,,1,0\n\
                 2,\"Collected Essays\",Mary Hale,,,=\"\",=\"\",3,4,,,,,,,,,,read,,,,1,0\n\
                 3,Emma,Jane Austen,,,=\"\",=\"\",5,4,,,,,,2020/01/01,,,,read,,,,1,0\n\
                 4,The Lathe of Heaven,Ursula K. Le Guin,,,=\"\",=\"9780060512750\",5,4,,,,,,,,,,read,,,,1,0\n"
            ),
        )
        .unwrap();
        let report = library.import_goodreads(&export).unwrap();
        let book = |id: &str| library.book(id).unwrap().unwrap();
        assert_eq!(book(&two).rating, Some(4));
        assert_eq!(book(&one).rating, None, "a shortened title that fits two books matches neither");
        assert_eq!(report.not_found, ["Collected Essays by Mary Hale"]);
        assert_eq!(book(&emma).status, ReadStatus::InProgress, "a reread in progress stays in progress");
        assert_eq!(book(lathe).rating, Some(5), "found by the ISBN read from the file");
    }

    #[test]
    fn other_files_are_turned_away() {
        let (dir, library) = open_temp_library();
        let file = dir.path().join("notes.csv");
        fs::write(&file, "name,age\nA,1\n").unwrap();
        let err = library.import_goodreads(&file).unwrap_err().to_string();
        assert!(err.contains("isn't a Goodreads export"), "{err}");
    }

    #[test]
    fn isbns_dates_and_names_are_read_carefully() {
        assert_eq!(export_isbn("=\"9780441013593\""), Some("9780441013593".into()));
        assert_eq!(export_isbn("=\"\""), None);
        assert_eq!(clean_isbn("urn:isbn:978-0-441-01359-3"), Some("9780441013593".into()));
        assert_eq!(clean_isbn("urn:uuid:1234"), None);
        assert_eq!(export_date("2023/05/14"), Some("2023-05-14T12:00:00.000Z".into()));
        assert_eq!(export_date(""), None);
        assert_eq!(short_title_key("Dune: Deluxe Edition (Dune, #1)"), "dune");
        assert_eq!(title_key("Dune: Deluxe Edition (Dune, #1)"), "dunedeluxeedition");
        assert_eq!(surname("Le Guin, Ursula K."), Some("guin".into()));
        assert_eq!(surname("Ursula K. Le Guin"), Some("guin".into()));
        assert_eq!(shelf_name("science-fiction"), "Science fiction");
    }
}

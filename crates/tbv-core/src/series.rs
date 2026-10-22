//! Finding the rest of a series. A list of the series' books is looked up
//! online (Hardcover when it's connected, and Audible's public catalogue)
//! and kept per series, so it syncs. Books in the list that the library
//! doesn't have show as missing. Books in the library that look like one of
//! them but don't say they're in the series are offered for review: an
//! approval sets the series and number as a details edit, and a denial is
//! remembered so the book isn't offered again.

use std::collections::HashSet;

use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::details::DetailChange;
use crate::error::{Error, Result};
use crate::hardcover::{graphql, Transport};
use crate::home::{book_from_row, BOOK_COLUMNS, BOOK_FROM};
use crate::library::Library;
use crate::manage::{author_key, numbered_apart, title_key};
use crate::model::{BookId, BookPreview};
use crate::time::now_utc;

/// One book of a series, as a source lists it.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SeriesEntry {
    pub title: String,
    /// Its number in the series. Novellas can be 2.5.
    pub position: Option<f64>,
    pub authors: Vec<String>,
    pub cover_url: Option<String>,
    pub source: String,
}

impl SeriesEntry {
    /// Stays the same for the same book of the series, so hiding it sticks.
    pub fn key(&self) -> String {
        match self.position {
            Some(p) => number_text(p),
            None => format!("t:{}", title_key(&self.title)),
        }
    }
}

/// A book of the series the library doesn't have.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MissingBook {
    pub key: String,
    #[serde(flatten)]
    pub entry: SeriesEntry,
    /// Hidden by the person (a short story they don't want, say).
    pub hidden: bool,
    /// Read somewhere else (borrowed, say), as the person marked it.
    pub read: bool,
}

/// A book of the series the library has, with its number: from its details,
/// or from the list when its title is in it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OwnedBook {
    pub book: BookPreview,
    pub position: Option<f64>,
}

/// A book in the library that is probably in the series.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SeriesMatch {
    pub book: BookPreview,
    /// The number it would get.
    pub position: Option<f64>,
    /// Why TBV thinks it fits, in words.
    pub reason: String,
}

/// What TBV knows about one series.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SeriesReview {
    pub name: String,
    /// When the list was last looked up online. None: never.
    pub checked_at: Option<String>,
    /// How many books the online list has.
    pub listed: usize,
    /// How many books of the series the library has.
    pub owned: usize,
    pub missing: Vec<MissingBook>,
    pub matches: Vec<SeriesMatch>,
    /// The books here, in series order.
    pub owned_books: Vec<OwnedBook>,
}

/// An approved match: the book and the number it gets.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Approval {
    pub book_id: BookId,
    pub position: Option<f64>,
}

/// "3" rather than "3.0", "2.5" as it is.
fn number_text(n: f64) -> String {
    if n.fract() == 0.0 {
        format!("{}", n as i64)
    } else {
        format!("{n}")
    }
}

pub(crate) fn series_id(name: &str) -> String {
    name.trim().to_lowercase()
}

fn text(v: &Value) -> Option<String> {
    v.as_str().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string)
}

fn number(v: &Value) -> Option<f64> {
    v.as_f64().or_else(|| v.as_str().and_then(|s| s.trim().replace(',', ".").parse().ok()))
}

/// Every surname, compared the way duplicates compare them.
fn surnames(authors: &[String]) -> HashSet<String> {
    authors.iter().map(|a| author_key(std::slice::from_ref(a))).filter(|s| !s.is_empty()).collect()
}

/// Edits needed to turn one title into the other, counting characters.
fn distance(a: &str, b: &str) -> usize {
    let b: Vec<char> = b.chars().collect();
    let mut row: Vec<usize> = (0..=b.len()).collect();
    for (i, ca) in a.chars().enumerate() {
        let mut last = row[0];
        row[0] = i + 1;
        for (j, cb) in b.iter().enumerate() {
            let here = row[j + 1];
            row[j + 1] = (last + usize::from(ca != *cb)).min(row[j] + 1).min(row[j + 1] + 1);
            last = here;
        }
    }
    row[b.len()]
}

/// How alike two titles are: the same, close (a typo or two), or not.
fn alike(a: &str, b: &str) -> Option<&'static str> {
    if numbered_apart(a, b) {
        return None;
    }
    let (a, b) = (title_key(a), title_key(b));
    if a.is_empty() || b.is_empty() {
        return None;
    }
    if a == b {
        return Some("The same title");
    }
    let short = a.chars().count().min(b.chars().count());
    if short >= 8 && distance(&a, &b) <= 2 {
        return Some("A nearly identical title");
    }
    None
}

/// Audible's search answer as the books of one series. Only products that
/// say they're in it (by name) count, in the language most of them are in,
/// and box sets ("1-3") are left out.
pub fn audible_series_from(data: &Value, name: &str) -> Vec<SeriesEntry> {
    let want = series_id(name);
    let mut found: Vec<(SeriesEntry, Option<String>)> = Vec::new();
    for p in data["products"].as_array().into_iter().flatten() {
        let Some(title) = text(&p["title"]) else { continue };
        let Some(series) = p["series"].as_array().and_then(|list| list.iter().find(|s| text(&s["title"]).is_some_and(|t| series_id(&t) == want)))
        else {
            continue;
        };
        let sequence = &series["sequence"];
        if text(sequence).is_some_and(|s| s.contains('-')) {
            continue;
        }
        let cover = p["product_images"].as_object().and_then(|images| ["500", "1024", "252"].iter().find_map(|size| images.get(*size)).and_then(text));
        let authors = p["authors"].as_array().map(|a| a.iter().filter_map(|x| text(&x["name"])).collect()).unwrap_or_default();
        found.push((
            SeriesEntry { title, position: number(sequence), authors, cover_url: cover.map(|c| c.replace("http://", "https://")), source: "audible".into() },
            text(&p["language"]).map(|l| l.to_lowercase()),
        ));
    }
    let mut counts: Vec<(Option<String>, usize)> = Vec::new();
    for (_, language) in &found {
        match counts.iter_mut().find(|(l, _)| l == language) {
            Some((_, n)) => *n += 1,
            None => counts.push((language.clone(), 1)),
        }
    }
    let main = counts.into_iter().max_by_key(|(_, n)| *n).and_then(|(l, _)| l);
    found.into_iter().filter(|(_, l)| main.is_none() || *l == main).map(|(e, _)| e).collect()
}

/// Looks the series up in Audible's public catalogue (no account needed).
pub fn search_audible_series(name: &str, author: &str) -> Result<Vec<SeriesEntry>> {
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(std::time::Duration::from_secs(20)))
        .user_agent(concat!("The Bound Vigil/", env!("CARGO_PKG_VERSION"), " (desktop eBook reader)"))
        .build()
        .into();
    let mut all = Vec::new();
    for page in 0..2 {
        let mut request = agent
            .get("https://api.audible.com/1.0/catalog/products")
            .query("num_results", "50")
            .query("page", page.to_string())
            .query("products_sort_by", "Relevance")
            .query("response_groups", "contributors,media,product_attrs,series")
            .query("keywords", name.trim());
        if !author.trim().is_empty() {
            request = request.query("author", author.trim());
        }
        let mut response = request.call().map_err(|e| Error::Offline(format!("Audible couldn't be reached: {e}")))?;
        let data: Value = response.body_mut().read_json().map_err(|e| Error::Offline(format!("Audible's answer couldn't be read: {e}")))?;
        let more = data["products"].as_array().is_some_and(|p| p.len() == 50);
        all.extend(audible_series_from(&data, name));
        if !more {
            break;
        }
    }
    Ok(all)
}

/// Hardcover's answer as the books of one series: the series of that name
/// with the most books, in order.
pub fn hardcover_series_from(data: &Value) -> Vec<SeriesEntry> {
    let Some(series) = data["series"]
        .as_array()
        .and_then(|list| list.iter().max_by_key(|s| s["book_series"].as_array().map_or(0, Vec::len)))
    else {
        return Vec::new();
    };
    series["book_series"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|b| !b["compilation"].as_bool().unwrap_or(false))
        .filter_map(|b| {
            let book = &b["book"];
            Some(SeriesEntry {
                title: text(&book["title"])?,
                position: number(&b["position"]),
                authors: book["contributions"]
                    .as_array()
                    .map(|c| c.iter().filter_map(|x| text(&x["author"]["name"])).collect())
                    .unwrap_or_default(),
                cover_url: text(&book["image"]["url"]),
                source: "hardcover".into(),
            })
        })
        .collect()
}

/// Looks the series up on Hardcover with the person's own connection.
pub fn search_hardcover_series(net: &dyn Transport, token: &str, name: &str) -> Result<Vec<SeriesEntry>> {
    let data = graphql(
        net,
        token,
        "query ($name: String!) { series(where: {name: {_eq: $name}}, limit: 5) { name \
         book_series(order_by: {position: asc}) { position compilation \
         book { title image { url } contributions(limit: 3) { author { name } } } } } }",
        json!({ "name": name.trim() }),
    )?;
    Ok(hardcover_series_from(&data))
}

/// One list from several sources: the first source to name a number keeps
/// it, the same title is only listed once, and books come in series order.
pub fn merge(lists: Vec<Vec<SeriesEntry>>) -> Vec<SeriesEntry> {
    let mut out: Vec<SeriesEntry> = Vec::new();
    for entry in lists.into_iter().flatten() {
        let same_number = |e: &SeriesEntry| matches!((e.position, entry.position), (Some(a), Some(b)) if (a - b).abs() < 1e-6);
        let same_title = |e: &SeriesEntry| title_key(&e.title) == title_key(&entry.title);
        if let Some(kept) = out.iter_mut().find(|e| same_number(e) || (same_title(e) && (e.position.is_none() || entry.position.is_none()))) {
            if kept.position.is_none() {
                kept.position = entry.position;
            }
            if kept.cover_url.is_none() {
                kept.cover_url = entry.cover_url;
            }
            if kept.authors.is_empty() {
                kept.authors = entry.authors;
            }
            continue;
        }
        out.push(entry);
    }
    out.sort_by(|a, b| a.position.unwrap_or(f64::MAX).total_cmp(&b.position.unwrap_or(f64::MAX)));
    out
}

/// What is saved for a series.
#[derive(Debug, Default)]
struct Saved {
    name: String,
    books: Vec<SeriesEntry>,
    hidden: Vec<String>,
    denied: Vec<String>,
    read: Vec<String>,
    checked_at: Option<String>,
}

/// Books the person added to a series list by hand.
pub const BY_HAND: &str = "you";

/// Turns a key on or off in one of a series' lists of keys.
fn toggle(list: &mut Vec<String>, key: &str, on: bool) {
    list.retain(|k| k != key);
    if on {
        list.push(key.to_string());
    }
}

impl Library {
    fn saved_series(&self, name: &str) -> Result<Option<Saved>> {
        let row = self
            .conn
            .query_row(
                "SELECT name, books, hidden, denied, checked_at, read FROM series_lists WHERE id = ?1",
                params![series_id(name)],
                |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                        r.get::<_, String>(3)?,
                        r.get::<_, Option<String>>(4)?,
                        r.get::<_, String>(5)?,
                    ))
                },
            )
            .optional()?;
        Ok(row.map(|(name, books, hidden, denied, checked_at, read)| Saved {
            name,
            books: serde_json::from_str(&books).unwrap_or_default(),
            hidden: serde_json::from_str(&hidden).unwrap_or_default(),
            denied: serde_json::from_str(&denied).unwrap_or_default(),
            read: serde_json::from_str(&read).unwrap_or_default(),
            checked_at,
        }))
    }

    fn save_series(&self, saved: &Saved) -> Result<()> {
        self.conn.execute(
            "INSERT INTO series_lists (id, name, books, hidden, denied, checked_at, updated_at, read) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(id) DO UPDATE SET name = excluded.name, books = excluded.books, hidden = excluded.hidden,
                denied = excluded.denied, checked_at = excluded.checked_at, updated_at = excluded.updated_at, read = excluded.read",
            params![
                series_id(&saved.name),
                saved.name.trim(),
                serde_json::to_string(&saved.books)?,
                serde_json::to_string(&saved.hidden)?,
                serde_json::to_string(&saved.denied)?,
                saved.checked_at,
                now_utc(),
                serde_json::to_string(&saved.read)?,
            ],
        )?;
        Ok(())
    }

    /// Keeps the list just looked up online for a series. What was hidden,
    /// denied or marked read stays so, and books added by hand stay listed.
    pub fn save_series_found(&self, name: &str, books: Vec<SeriesEntry>) -> Result<SeriesReview> {
        let mut saved = self.saved_series(name)?.unwrap_or_default();
        saved.name = name.trim().to_string();
        let by_hand: Vec<SeriesEntry> = saved.books.iter().filter(|b| b.source == BY_HAND).cloned().collect();
        saved.books = merge(vec![by_hand, books]);
        saved.checked_at = Some(now_utc().to_string());
        self.save_series(&saved)?;
        self.series_review(name)
    }

    /// Hides one missing book of a series, or shows it again.
    pub fn hide_series_book(&self, name: &str, key: &str, hidden: bool) -> Result<SeriesReview> {
        let mut saved = self.saved_series(name)?.ok_or_else(|| Error::Unsuitable(format!("TBV hasn't looked up {name} yet")))?;
        toggle(&mut saved.hidden, key, hidden);
        self.save_series(&saved)?;
        self.series_review(name)
    }

    /// Marks one missing book of a series as read elsewhere, or not.
    pub fn mark_series_book_read(&self, name: &str, key: &str, read: bool) -> Result<SeriesReview> {
        let mut saved = self.saved_series(name)?.ok_or_else(|| Error::Unsuitable(format!("TBV hasn't looked up {name} yet")))?;
        toggle(&mut saved.read, key, read);
        self.save_series(&saved)?;
        self.series_review(name)
    }

    /// Adds a book no source knows to the series' list.
    pub fn add_series_book(&self, name: &str, title: &str, position: Option<f64>, authors: Vec<String>) -> Result<SeriesReview> {
        let title = title.trim();
        if title.is_empty() {
            return Err(Error::Unsuitable("give the book a title".into()));
        }
        if position.is_some_and(|p| !p.is_finite() || p < 0.0) {
            return Err(Error::Unsuitable("its number in the series should be 0 or more".into()));
        }
        let mut saved = self.saved_series(name)?.unwrap_or_default();
        saved.name = name.trim().to_string();
        let entry = SeriesEntry { title: title.to_string(), position, authors, cover_url: None, source: BY_HAND.into() };
        // Takes the place of a listed book with the same number.
        let key = entry.key();
        saved.books.retain(|b| b.key() != key);
        saved.books.push(entry);
        saved.books = merge(vec![std::mem::take(&mut saved.books)]);
        self.save_series(&saved)?;
        self.series_review(name)
    }

    /// Takes a book added by hand off the series' list.
    pub fn remove_series_book(&self, name: &str, key: &str) -> Result<SeriesReview> {
        let mut saved = self.saved_series(name)?.ok_or_else(|| Error::Unsuitable(format!("TBV hasn't looked up {name} yet")))?;
        saved.books.retain(|b| !(b.source == BY_HAND && b.key() == key));
        self.save_series(&saved)?;
        self.series_review(name)
    }

    /// Puts these books in the series, each with its number, as details edits.
    pub fn approve_series_matches(&self, name: &str, approvals: &[Approval]) -> Result<SeriesReview> {
        for a in approvals {
            let mut changes = vec![DetailChange { field: "series".into(), value: Some(name.trim().to_string()) }];
            if let Some(p) = a.position {
                changes.push(DetailChange { field: "series_index".into(), value: Some(number_text(p)) });
            }
            self.edit_details(std::slice::from_ref(&a.book_id), &changes)?;
        }
        self.series_review(name)
    }

    /// Remembers these books aren't in the series, so they aren't offered again.
    pub fn deny_series_matches(&self, name: &str, book_ids: &[BookId]) -> Result<SeriesReview> {
        let mut saved = self.saved_series(name)?.unwrap_or_default();
        saved.name = name.trim().to_string();
        for id in book_ids {
            if !saved.denied.iter().any(|d| d == id.as_str()) {
                saved.denied.push(id.to_string());
            }
        }
        self.save_series(&saved)?;
        self.series_review(name)
    }

    /// The series as TBV sees it now: what's missing, and what in the
    /// library probably belongs to it.
    pub fn series_review(&self, name: &str) -> Result<SeriesReview> {
        let saved = self.saved_series(name)?;
        let id = series_id(name);
        let mut statement = self.conn.prepare(&format!("{BOOK_COLUMNS} {BOOK_FROM}"))?;
        let books = statement.query_map([], book_from_row)?.collect::<std::result::Result<Vec<_>, _>>()?;
        let (inside, outside): (Vec<BookPreview>, Vec<BookPreview>) =
            books.into_iter().partition(|b| b.series.as_deref().is_some_and(|s| series_id(s) == id));

        let Some(saved) = saved else {
            let owned_books = owned_in_order(&inside, &[]);
            return Ok(SeriesReview {
                name: name.trim().to_string(),
                checked_at: None,
                listed: 0,
                owned: inside.len(),
                missing: Vec::new(),
                matches: Vec::new(),
                owned_books,
            });
        };
        let denied: HashSet<&str> = saved.denied.iter().map(String::as_str).collect();
        let same_author = |entry: &SeriesEntry, book: &BookPreview| {
            let (a, b) = (surnames(&entry.authors), surnames(&book.authors));
            a.is_empty() || b.is_empty() || !a.is_disjoint(&b)
        };
        let mut missing = Vec::new();
        let mut matches: Vec<SeriesMatch> = Vec::new();
        let mut offered: HashSet<String> = HashSet::new();
        // Each book here stands for one book of the list: first those whose
        // number says which, then those whose title does.
        let mut used: HashSet<&str> = HashSet::new();
        // Which book of the list each book here is.
        let mut places: Vec<(&str, Option<f64>)> = Vec::new();
        let numbered: Vec<bool> = saved
            .books
            .iter()
            .map(|entry| {
                let by_number = entry.position.and_then(|p| inside.iter().find(|b| !used.contains(b.id.as_str()) && b.series_index.is_some_and(|i| (i - p).abs() < 1e-6)));
                by_number.map(|b| used.insert(b.id.as_str())).is_some()
            })
            .collect();
        for (entry, numbered) in saved.books.iter().zip(numbered) {
            if numbered {
                continue;
            }
            let by_title = inside.iter().find(|b| !used.contains(b.id.as_str()) && alike(&b.title, &entry.title).is_some());
            if let Some(book) = by_title {
                used.insert(book.id.as_str());
                places.push((book.id.as_str(), entry.position));
                // In the series already, but without its number.
                if book.series_index.is_none() && entry.position.is_some() && !denied.contains(book.id.as_str()) && offered.insert(book.id.to_string()) {
                    matches.push(SeriesMatch { book: book.clone(), position: entry.position, reason: "In the series, but without its number".into() });
                }
                continue;
            }
            let key = entry.key();
            let hidden = saved.hidden.contains(&key);
            let read = saved.read.contains(&key);
            missing.push(MissingBook { key, entry: entry.clone(), hidden, read });
            if hidden {
                continue;
            }
            for book in &outside {
                if denied.contains(book.id.as_str()) || offered.contains(book.id.as_str()) || !same_author(entry, book) {
                    continue;
                }
                if let Some(how) = alike(&book.title, &entry.title) {
                    let author = if surnames(&entry.authors).is_empty() || surnames(&book.authors).is_empty() { "" } else { " and author" };
                    let reason = match &book.series {
                        Some(other) => format!("{how}{author}, but its details say {other}"),
                        None => format!("{how}{author}, with no series in its details"),
                    };
                    offered.insert(book.id.to_string());
                    matches.push(SeriesMatch { book: book.clone(), position: entry.position, reason });
                }
            }
        }
        let owned_books = owned_in_order(&inside, &places);
        Ok(SeriesReview {
            name: saved.name.clone(),
            checked_at: saved.checked_at.clone(),
            listed: saved.books.len(),
            owned: inside.len(),
            missing,
            matches,
            owned_books,
        })
    }
}

/// The library's books of a series in order, each with its number: its own,
/// or the one the list gives its title (`places`).
fn owned_in_order(inside: &[BookPreview], places: &[(&str, Option<f64>)]) -> Vec<OwnedBook> {
    let mut owned: Vec<OwnedBook> = inside
        .iter()
        .map(|b| {
            let listed = places.iter().find(|(id, _)| *id == b.id.as_str()).and_then(|(_, p)| *p);
            OwnedBook { book: b.clone(), position: b.series_index.or(listed) }
        })
        .collect();
    owned.sort_by(|a, b| a.position.unwrap_or(f64::MAX).total_cmp(&b.position.unwrap_or(f64::MAX)));
    owned
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::epub::tests::write_test_epub_with;
    use crate::library::tests::open_temp_library;

    fn entry(title: &str, n: f64) -> SeriesEntry {
        SeriesEntry { title: title.into(), position: Some(n), authors: vec!["Terry Pratchett".into()], cover_url: None, source: "test".into() }
    }

    fn add(library: &mut Library, dir: &std::path::Path, title: &str, series: Option<(&str, u32)>) -> String {
        let extra = series
            .map(|(s, n)| format!(r#"<meta name="calibre:series" content="{s}"/><meta name="calibre:series_index" content="{n}"/>"#))
            .unwrap_or_default();
        let path = dir.join(format!("{title}.epub"));
        write_test_epub_with(&path, title, "Terry Pratchett", false, &extra);
        library.import_files(&[path]);
        library.library_page(&Default::default()).unwrap().books.into_iter().find(|b| b.title == title).unwrap().id.to_string()
    }

    #[test]
    fn missing_books_and_likely_matches() {
        let (dir, mut library) = open_temp_library();
        add(&mut library, dir.path(), "The Colour of Magic", Some(("Discworld", 1)));
        let loose = add(&mut library, dir.path(), "Equal Rites", None);
        let typo = add(&mut library, dir.path(), "The Light Fantastik", None);
        add(&mut library, dir.path(), "Good Omens", None);
        let list = vec![entry("The Colour of Magic", 1.0), entry("The Light Fantastic", 2.0), entry("Equal Rites", 3.0), entry("Mort", 4.0)];

        let review = library.save_series_found("Discworld", list).unwrap();
        assert_eq!((review.listed, review.owned), (4, 1));
        let missing: Vec<&str> = review.missing.iter().map(|m| m.entry.title.as_str()).collect();
        assert_eq!(missing, ["The Light Fantastic", "Equal Rites", "Mort"]);
        let offered: Vec<(&str, Option<f64>)> = review.matches.iter().map(|m| (m.book.title.as_str(), m.position)).collect();
        assert_eq!(offered, [("The Light Fantastik", Some(2.0)), ("Equal Rites", Some(3.0))]);

        // Approving one puts it in the series; denying the other keeps it out of the list.
        library.approve_series_matches("Discworld", &[Approval { book_id: loose.clone(), position: Some(3.0) }]).unwrap();
        let review = library.deny_series_matches("discworld", std::slice::from_ref(&typo)).unwrap();
        assert!(review.matches.is_empty());
        assert_eq!(review.owned, 2);
        assert_eq!(review.missing.iter().map(|m| m.entry.title.as_str()).collect::<Vec<_>>(), ["The Light Fantastic", "Mort"]);
        let book = library.library_page(&Default::default()).unwrap().books.into_iter().find(|b| b.id.as_str() == loose).unwrap();
        assert_eq!((book.series.as_deref(), book.series_index), (Some("Discworld"), Some(3.0)));

        // Hiding sticks when the list is looked up again.
        let review = library.hide_series_book("Discworld", "4", true).unwrap();
        assert!(review.missing.iter().any(|m| m.key == "4" && m.hidden));
        let review = library.save_series_found("Discworld", vec![entry("Mort", 4.0)]).unwrap();
        assert!(review.missing[0].hidden);
    }

    #[test]
    fn missing_books_can_be_marked_read_or_added_by_hand_and_owned_books_show_their_number() {
        let (dir, mut library) = open_temp_library();
        add(&mut library, dir.path(), "Mort", Some(("Discworld", 4)));
        let loose = add(&mut library, dir.path(), "Sourcery", None);
        library.approve_series_matches("Discworld", &[Approval { book_id: loose.clone(), position: None }]).unwrap();
        let review = library.save_series_found("Discworld", vec![entry("The Colour of Magic", 1.0), entry("Mort", 4.0), entry("Sourcery", 5.0)]).unwrap();
        // Sourcery has no number of its own; the list's title gives it one.
        let owned: Vec<(&str, Option<f64>)> = review.owned_books.iter().map(|o| (o.book.title.as_str(), o.position)).collect();
        assert_eq!(owned, [("Mort", Some(4.0)), ("Sourcery", Some(5.0))]);

        let review = library.mark_series_book_read("Discworld", "1", true).unwrap();
        assert!(review.missing[0].read);
        let review = library.add_series_book("Discworld", "Troll Bridge", Some(2.5), vec![]).unwrap();
        assert_eq!(review.missing.iter().map(|m| (m.entry.title.as_str(), m.entry.source.as_str())).collect::<Vec<_>>(), [("The Colour of Magic", "test"), ("Troll Bridge", BY_HAND)]);
        assert!(library.add_series_book("Discworld", " ", None, vec![]).is_err());
        // Looking it up again keeps what was added by hand and marked read.
        let review = library.save_series_found("Discworld", vec![entry("The Colour of Magic", 1.0)]).unwrap();
        assert_eq!(review.missing.len(), 2);
        assert!(review.missing[0].read);
        let review = library.remove_series_book("Discworld", "2.5").unwrap();
        assert_eq!(review.missing.len(), 1);

        // The Collections page's series card fills its strip with what's missing.
        let mut with_cover = entry("Eric", 9.0);
        with_cover.cover_url = Some("https://x/eric.jpg".into());
        library.save_series_found("Discworld", vec![entry("The Colour of Magic", 1.0), entry("Mort", 4.0), with_cover]).unwrap();
        library.hide_series_book("Discworld", "1", true).unwrap();
        let card = library.collections_overview().unwrap().series.into_iter().find(|s| s.name == "Discworld").unwrap();
        assert_eq!(card.covers.len(), 2);
        assert_eq!(card.missing.iter().map(|m| (m.title.as_str(), m.cover_url.as_deref())).collect::<Vec<_>>(), [("Eric", Some("https://x/eric.jpg"))]);
    }

    #[test]
    fn sources_merge_by_number_and_title() {
        let hardcover = vec![entry("Mort", 4.0), entry("Sourcery", 5.0)];
        let mut audible = vec![entry("Mort (Discworld 4)", 4.0), entry("Wyrd Sisters", 6.0), entry("Sourcery", 5.0)];
        audible[1].cover_url = Some("https://x/6.jpg".into());
        audible.push(SeriesEntry { position: None, ..entry("Sourcery", 0.0) });
        let merged = merge(vec![hardcover, audible]);
        let titles: Vec<(&str, Option<f64>)> = merged.iter().map(|e| (e.title.as_str(), e.position)).collect();
        assert_eq!(titles, [("Mort", Some(4.0)), ("Sourcery", Some(5.0)), ("Wyrd Sisters", Some(6.0))]);
        assert_eq!(merged[2].cover_url.as_deref(), Some("https://x/6.jpg"));
    }

    #[test]
    fn audible_answer_keeps_the_series_only_in_its_main_language() {
        let data = json!({ "products": [
            { "title": "Mort", "language": "english", "authors": [{ "name": "Terry Pratchett" }],
              "series": [{ "title": "Discworld", "sequence": "4" }], "product_images": { "500": "http://m/4.jpg" } },
            { "title": "Sourcery", "language": "english", "series": [{ "title": "Discworld", "sequence": "5" }] },
            { "title": "Gevatter Tod", "language": "german", "series": [{ "title": "Discworld", "sequence": "4" }] },
            { "title": "Discworld 1-3", "language": "english", "series": [{ "title": "Discworld", "sequence": "1-3" }] },
            { "title": "Good Omens", "language": "english" }
        ]});
        let found = audible_series_from(&data, "discworld");
        assert_eq!(found.iter().map(|e| e.title.as_str()).collect::<Vec<_>>(), ["Mort", "Sourcery"]);
        assert_eq!(found[0].position, Some(4.0));
        assert_eq!(found[0].cover_url.as_deref(), Some("https://m/4.jpg"));
    }

    #[test]
    fn hardcover_answer_takes_the_biggest_series_and_skips_omnibuses() {
        let data = json!({ "series": [
            { "name": "Discworld", "book_series": [{ "position": 1, "book": { "title": "Small" } }] },
            { "name": "Discworld", "book_series": [
                { "position": 1, "book": { "title": "The Colour of Magic", "contributions": [{ "author": { "name": "Terry Pratchett" } }] } },
                { "position": 2.5, "book": { "title": "Troll Bridge" } },
                { "position": 1, "compilation": true, "book": { "title": "The Colour of Magic / The Light Fantastic" } }
            ]}
        ]});
        let found = hardcover_series_from(&data);
        assert_eq!(found.iter().map(|e| (e.title.as_str(), e.position)).collect::<Vec<_>>(), [("The Colour of Magic", Some(1.0)), ("Troll Bridge", Some(2.5))]);
        assert_eq!(found[0].authors, ["Terry Pratchett"]);
        assert_eq!(number_text(2.5), "2.5");
        assert_eq!(number_text(3.0), "3");
    }
}

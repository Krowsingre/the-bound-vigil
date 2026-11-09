//! Books bought on Kindle, from a list of them (the JSON the KindLogger
//! browser extension saves), chosen in Import books. The app doesn't name or
//! point to that extension (embre, 6 November 2026). TBV can't download or
//! unlock Kindle books; the list is a record of what you own.
//!
//! Each purchase is kept by its ASIN, so importing a newer file only adds the
//! new ones. Purchases are matched to library books by title and author
//! (Kindle adds the series in brackets, "Weight of the Heart (Bruna Husky
//! Book 2)", which is dropped). Nothing changes until the matches are
//! reviewed: then the books get the tag "Kindle", and those read on Kindle
//! can be marked Read. The rest make up the "Kindle, not in library" list,
//! which a book leaves by itself once it's added to the library, or by hand.
//! Books borrowed (Kindle Unlimited, Prime Reading) are kept but never
//! tagged or listed, since they weren't bought.

use std::collections::{HashMap, HashSet};
use std::path::Path;

use rusqlite::params;
use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};
use crate::goodreads::{short_title_key, surname, title_key, Known};
use crate::library::Library;
use crate::model::BookId;
use crate::time::now_utc;

/// The tag for books bought from Amazon.
pub const KINDLE_TAG: &str = "Kindle";
/// Whether books read on Kindle are marked Read (the last choice made).
const MARK_READ: &str = "kindle.markRead";

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KindleImport {
    /// Books in the file.
    pub total: u32,
    /// Of those, ones TBV hadn't seen before.
    pub new_purchases: u32,
    /// Borrowed rather than bought, so left out of the tag and the list.
    pub borrowed: u32,
    pub review: KindleReview,
}

/// What's waiting to be confirmed.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KindleReview {
    /// Same title and author as a library book.
    pub matched: Vec<KindleMatch>,
    /// Close, but the title or author differs: each needs a yes.
    pub probable: Vec<KindleMatch>,
    /// Bought, not found in the library and not taken off the list.
    pub missing: u32,
    /// Of the matched and probable, those read on Kindle but not Read in TBV.
    pub read_to_mark: u32,
    /// The last choice for marking them Read (on unless turned off).
    pub mark_read: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KindleMatch {
    pub asin: String,
    pub title: String,
    pub author: String,
    pub cover_url: String,
    pub read: bool,
    pub borrowed: bool,
    pub book_id: BookId,
    pub book_title: String,
    pub book_authors: Vec<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KindleApplied {
    /// Books given the Kindle tag.
    pub tagged: u32,
    pub marked_read: u32,
    /// Left on the "Kindle, not in library" list.
    pub missing: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KindlePurchase {
    pub asin: String,
    pub title: String,
    pub author: String,
    pub acquired_at: Option<String>,
    pub read: bool,
    pub link: String,
    pub cover_url: String,
    /// Taken off the list by hand.
    pub removed: bool,
    pub book_ids: Vec<BookId>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KindleSummary {
    /// Every purchase kept, borrowed ones included.
    pub total: u32,
    /// Matched to a library book and confirmed.
    pub in_library: u32,
    /// On the "Kindle, not in library" list.
    pub missing: u32,
    /// Taken off that list by hand.
    pub removed: u32,
    /// Matches waiting for review.
    pub waiting: u32,
    pub last_added: Option<String>,
    /// The newest few on the list, for its card.
    pub covers: Vec<KindleCover>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KindleCover {
    pub title: String,
    pub cover_url: Option<String>,
}

#[derive(Deserialize)]
struct Export {
    kindlogger: serde_json::Value,
    books: Vec<ExportBook>,
}

#[derive(Deserialize)]
struct ExportBook {
    asin: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    author: String,
    #[serde(default)]
    acquired: String,
    #[serde(default)]
    read: bool,
    #[serde(default)]
    link: String,
    #[serde(default)]
    cover: String,
}

/// "October 17, 2026" (or "Borrowed on October 17, 2026") → midday that day,
/// so the day stays the same in any time zone.
fn acquired_date(raw: &str) -> Option<String> {
    const MONTHS: [&str; 12] =
        ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
    let words: Vec<String> = raw.split([' ', ',']).filter(|w| !w.is_empty()).map(str::to_lowercase).collect();
    let at = words.iter().position(|w| MONTHS.contains(&w.as_str()))?;
    let month = MONTHS.iter().position(|m| *m == words[at])? + 1;
    let day: u32 = words.get(at + 1)?.parse().ok().filter(|d| (1..=31).contains(d))?;
    let year: u32 = words.get(at + 2)?.parse().ok().filter(|y| *y > 1990)?;
    Some(format!("{year:04}-{month:02}-{day:02}T12:00:00.000Z"))
}

/// Kindle titles from series often also end in "Book 2" after a colon or
/// dash, which the library's copy rarely has.
fn kindle_titles(title: &str) -> (String, String) {
    let main = title.split(" (").next().unwrap_or(title);
    let main = main.split(" [").next().unwrap_or(main);
    let short = main.split([':', '|']).next().unwrap_or(main);
    let short = short.split(" - ").next().unwrap_or(short);
    (title_key(main), short_title_key(short))
}

enum Found {
    Sure(usize),
    Probably(usize),
}

struct Matcher {
    known: Vec<Known>,
    by_title: HashMap<String, Vec<usize>>,
    by_short_title: HashMap<String, Vec<usize>>,
}

impl Matcher {
    fn new(known: Vec<Known>) -> Self {
        let mut by_title: HashMap<String, Vec<usize>> = HashMap::new();
        let mut by_short_title: HashMap<String, Vec<usize>> = HashMap::new();
        for (i, k) in known.iter().enumerate() {
            if !k.title.is_empty() {
                by_title.entry(k.title.clone()).or_default().push(i);
            }
            if !k.short_title.is_empty() {
                by_short_title.entry(k.short_title.clone()).or_default().push(i);
            }
        }
        Self { known, by_title, by_short_title }
    }

    fn find(&self, title: &str, author: &str) -> Option<Found> {
        let (full, short) = kindle_titles(title);
        if full.is_empty() {
            return None;
        }
        let wanted: Vec<String> = author.split(',').filter_map(surname).collect();
        let by_author = |i: &usize| !wanted.is_empty() && self.known[*i].surnames.iter().any(|s| wanted.contains(s));
        let titled = self.by_title.get(&full).map(Vec::as_slice).unwrap_or_default();
        if let Some(i) = titled.iter().copied().find(by_author) {
            return Some(Found::Sure(i));
        }
        let mut close: Vec<usize> = [self.by_short_title.get(&short), self.by_title.get(&short), self.by_short_title.get(&full)]
            .into_iter()
            .flatten()
            .flatten()
            .copied()
            .filter(by_author)
            .collect();
        close.sort_unstable();
        close.dedup();
        if let [only] = close[..] {
            return Some(Found::Probably(only));
        }
        // The same title by someone else: worth asking only when there's one.
        match titled {
            [only] => Some(Found::Probably(*only)),
            _ => None,
        }
    }
}

/// A purchase that is on the "Kindle, not in library" list (as `k`).
const BOOK_IDS: &str = "CASE WHEN json_valid(k.matched_books) THEN
    CASE WHEN json_extract(k.matched_books, '$[0]') = k.book_id THEN k.matched_books ELSE json_array(k.book_id) END
    ELSE json_array(k.book_id) END";
fn in_library_clause() -> String {
    format!("k.book_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM json_each({BOOK_IDS}) j
        WHERE NOT EXISTS (SELECT 1 FROM books b WHERE b.id = j.value AND b.deleted_at IS NULL AND b.same_as IS NULL)
    )")
}
fn missing_clause() -> String {
    format!("k.borrowed = 0 AND NOT (COALESCE(k.match_state, '') IN ('auto', 'confirmed') AND {})", in_library_clause())
}

impl Library {
    pub fn import_kindle(&self, file: &Path) -> Result<KindleImport> {
        let not_kindle = || {
            Error::Unsuitable(
                "this file isn't a list of Kindle books".into(),
            )
        };
        let text = std::fs::read_to_string(file)?;
        let export: Export = serde_json::from_str(&text).map_err(|_| not_kindle())?;
        if !export.kindlogger.is_object() {
            return Err(not_kindle());
        }
        let now = now_utc();
        let mut report = KindleImport { total: export.books.len() as u32, ..Default::default() };
        let tx = self.conn.unchecked_transaction()?;
        let mut seen = HashSet::new();
        let mut changed = Vec::new();
        for book in &export.books {
            let asin = book.asin.trim();
            if asin.is_empty() || !seen.insert(asin.to_string()) {
                continue;
            }
            let borrowed = book.acquired.trim_start().to_lowercase().starts_with("borrowed");
            report.borrowed += borrowed as u32;
            let acquired = acquired_date(&book.acquired);
            let link = if book.link.starts_with("https://") { book.link.clone() } else { format!("https://www.amazon.com/dp/{asin}") };
            let cover = if book.cover.starts_with("https://") { book.cover.clone() } else { String::new() };
            let added = tx.execute(
                "INSERT INTO kindle_purchases (asin, title, author, acquired_at, borrowed, read, link, cover_url, added_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9) ON CONFLICT(asin) DO NOTHING",
                params![asin, book.title.trim(), book.author.trim(), acquired, borrowed, book.read, link, cover, now],
            )?;
            if added > 0 {
                report.new_purchases += 1;
            } else {
                // Read on Kindle since the last file, or bought after borrowing:
                // a book already confirmed takes the change (tag, Read) below.
                let gained: bool = tx.query_row(
                    "SELECT match_state = 'confirmed' AND ((read = 0 AND ?2) OR (borrowed = 1 AND NOT ?3)) FROM kindle_purchases WHERE asin = ?1",
                    params![asin, book.read, borrowed],
                    |r| r.get::<_, Option<bool>>(0),
                )?
                .unwrap_or(false);
                if gained {
                    changed.push(asin.to_string());
                }
                tx.execute(
                    "UPDATE kindle_purchases SET title = ?2, author = ?3, acquired_at = COALESCE(?4, acquired_at), borrowed = ?5,
                         read = MAX(read, ?6), link = ?7, cover_url = CASE WHEN ?8 = '' THEN cover_url ELSE ?8 END, updated_at = ?9
                     WHERE asin = ?1 AND (title IS NOT ?2 OR author IS NOT ?3 OR acquired_at IS NOT COALESCE(?4, acquired_at)
                         OR borrowed IS NOT ?5 OR read < ?6 OR link IS NOT ?7 OR (?8 != '' AND cover_url IS NOT ?8))",
                    params![asin, book.title.trim(), book.author.trim(), acquired, borrowed, book.read, link, cover, now],
                )?;
            }
        }
        tx.commit()?;
        if !changed.is_empty() {
            self.settle_kindle(&changed, self.setting(MARK_READ)?.as_deref() != Some("false"))?;
        }
        self.match_kindle(false)?;
        report.review = self.kindle_review()?;
        Ok(report)
    }

    /// Matches purchases not matched yet. Straight after an import the
    /// matches wait for review; later (`arrivals`), books that have since
    /// come into the library are taken as found when sure, and tagged.
    fn match_kindle(&self, arrivals: bool) -> Result<()> {
        // A rejected one is looked at again, for a book that has the same
        // title and author and isn't the one turned down.
        let open: Vec<(String, String, String, Option<String>)> = self
            .conn
            .prepare("SELECT asin, title, author, CASE WHEN match_state = 'rejected' THEN book_id END FROM kindle_purchases WHERE match_state IS NULL OR match_state = 'rejected'")?
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?
            .collect::<std::result::Result<_, _>>()?;
        if open.is_empty() {
            return Ok(());
        }
        let matcher = Matcher::new(self.books_for_matching()?);
        let now = now_utc();
        let mut sure = Vec::new();
        let tx = self.conn.unchecked_transaction()?;
        for (asin, title, author, turned_down) in open {
            let found = match (matcher.find(&title, &author), &turned_down) {
                (Some(Found::Sure(i)), Some(no)) if matcher.known[i].id == *no => None,
                (Some(Found::Probably(_)), Some(_)) => None,
                (found, _) => found,
            };
            let (index, state) = match found {
                Some(Found::Sure(i)) if arrivals => (i, "confirmed"),
                Some(Found::Sure(i)) => (i, "auto"),
                Some(Found::Probably(i)) => (i, "probable"),
                None => continue,
            };
            let book = &matcher.known[index].id;
            tx.execute(
                "UPDATE kindle_purchases SET book_id = ?2, match_state = ?3, updated_at = ?4 WHERE asin = ?1",
                params![asin, book, state, now],
            )?;
            if state == "confirmed" {
                sure.push(asin);
            }
        }
        tx.commit()?;
        if !sure.is_empty() {
            let mark_read = self.setting(MARK_READ)?.as_deref() != Some("false");
            self.settle_kindle(&sure, mark_read)?;
        }
        Ok(())
    }

    /// Tags the books of these confirmed purchases, and marks them Read
    /// when read on Kindle. Returns (tagged, marked read).
    fn settle_kindle(&self, asins: &[String], mark_read: bool) -> Result<(u32, u32)> {
        let mut tag = Vec::new();
        let mut read = Vec::new();
        let mut of = self.conn.prepare(&format!(
            "SELECT b.id, k.borrowed, k.read FROM kindle_purchases k, json_each({BOOK_IDS}) j
             JOIN books b ON b.id = j.value WHERE k.asin = ?1 AND b.deleted_at IS NULL AND b.same_as IS NULL",
        ))?;
        for asin in asins {
            let rows = of.query_map(params![asin], |r| Ok((r.get::<_, String>(0)?, r.get::<_, bool>(1)?, r.get::<_, bool>(2)?)))?;
            for row in rows {
                let (book, borrowed, was_read) = row?;
                if !borrowed && !tag.contains(&book) {
                    tag.push(book.clone());
                }
                if was_read && !read.contains(&book) {
                    read.push(book);
                }
            }
        }
        drop(of);
        let already: HashSet<String> = self
            .conn
            .prepare("SELECT book_id FROM book_tags WHERE tag = ?1 COLLATE NOCASE AND removed_at IS NULL")?
            .query_map(params![KINDLE_TAG], |r| r.get(0))?
            .collect::<std::result::Result<_, _>>()?;
        let new_tags = tag.iter().filter(|b| !already.contains(*b)).count() as u32;
        if !tag.is_empty() {
            self.add_tag(&tag, KINDLE_TAG)?;
        }
        let mut marked = 0;
        if mark_read {
            for book in &read {
                // A book being read again here keeps its in-progress status.
                if self.conn.execute("UPDATE books SET status = 'read' WHERE id = ?1 AND status = 'unread'", params![book])? > 0 {
                    self.remember_reading(book)?;
                    marked += 1;
                }
            }
        }
        Ok((new_tags, marked))
    }

    pub fn kindle_review(&self) -> Result<KindleReview> {
        let list = |state: &str| -> Result<Vec<KindleMatch>> {
            let mut statement = self.conn.prepare(&format!(
                "SELECT k.asin, k.title, k.author, k.cover_url, k.read, k.borrowed, k.book_id,
                        COALESCE(o_title.value, f_title.value, b.title), COALESCE(o_authors.value, f_authors.value, b.authors)
                 FROM kindle_purchases k
                 JOIN books b ON b.id = k.book_id AND b.deleted_at IS NULL
                 LEFT JOIN metadata_overrides o_title ON o_title.book_id = b.id AND o_title.field = 'title'
                 LEFT JOIN metadata_overrides o_authors ON o_authors.book_id = b.id AND o_authors.field = 'authors'
                 LEFT JOIN metadata_fetched f_title ON f_title.book_id = b.id AND f_title.field = 'title'
                 LEFT JOIN metadata_fetched f_authors ON f_authors.book_id = b.id AND f_authors.field = 'authors'
                 WHERE k.match_state = '{state}'
                 ORDER BY k.title COLLATE NOCASE"
            ))?;
            let rows = statement.query_map([], |r| {
                Ok(KindleMatch {
                    asin: r.get(0)?,
                    title: r.get(1)?,
                    author: r.get(2)?,
                    cover_url: r.get(3)?,
                    read: r.get(4)?,
                    borrowed: r.get(5)?,
                    book_id: r.get(6)?,
                    book_title: r.get(7)?,
                    book_authors: serde_json::from_str(&r.get::<_, String>(8)?).unwrap_or_default(),
                })
            })?;
            Ok(rows.collect::<std::result::Result<_, _>>()?)
        };
        let matched = list("auto")?;
        let probable = list("probable")?;
        let read_to_mark: u32 = self.conn.query_row(
            "SELECT COUNT(DISTINCT b.id) FROM kindle_purchases k JOIN books b ON b.id = k.book_id
             WHERE k.match_state IN ('auto', 'probable') AND k.read = 1 AND b.status = 'unread' AND b.deleted_at IS NULL",
            [],
            |r| r.get(0),
        )?;
        Ok(KindleReview {
            missing: self.kindle_summary()?.missing.saturating_sub(probable.len() as u32),
            matched,
            probable,
            read_to_mark,
            mark_read: self.setting(MARK_READ)?.as_deref() != Some("false"),
        })
    }

    /// Accepts the matched books and the probable ones in `confirmed`; the
    /// other probable ones are taken as not in the library.
    pub fn apply_kindle(&self, confirmed: &[String], mark_read: bool) -> Result<KindleApplied> {
        self.set_setting(MARK_READ, if mark_read { "true" } else { "false" })?;
        let waiting: Vec<(String, String)> = self
            .conn
            .prepare("SELECT asin, match_state FROM kindle_purchases WHERE match_state IN ('auto', 'probable')")?
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<std::result::Result<_, _>>()?;
        let now = now_utc();
        let mut yes = Vec::new();
        let tx = self.conn.unchecked_transaction()?;
        for (asin, state) in waiting {
            let ok = state == "auto" || confirmed.contains(&asin);
            tx.execute(
                "UPDATE kindle_purchases SET match_state = ?2, updated_at = ?3 WHERE asin = ?1",
                params![asin, if ok { "confirmed" } else { "rejected" }, now],
            )?;
            if ok {
                yes.push(asin);
            }
        }
        tx.commit()?;
        let (tagged, marked_read) = self.settle_kindle(&yes, mark_read)?;
        Ok(KindleApplied { tagged, marked_read, missing: self.kindle_summary()?.missing })
    }

    pub fn kindle_summary(&self) -> Result<KindleSummary> {
        let in_library = in_library_clause();
        let missing = missing_clause();
        let covers = self
            .conn
            .prepare(&format!(
                "SELECT k.title, NULLIF(k.cover_url, '') FROM kindle_purchases k WHERE {missing} AND k.dismissed_at IS NULL
                 ORDER BY k.acquired_at DESC, k.title COLLATE NOCASE LIMIT 3"
            ))?
            .query_map([], |r| Ok(KindleCover { title: r.get(0)?, cover_url: r.get(1)? }))?
            .collect::<std::result::Result<_, _>>()?;
        Ok(self.conn.query_row(
            &format!(
                "SELECT COUNT(*),
                        COALESCE(SUM(k.match_state = 'confirmed' AND {in_library}), 0),
                        COALESCE(SUM({missing} AND k.dismissed_at IS NULL), 0),
                        COALESCE(SUM({missing} AND k.dismissed_at IS NOT NULL), 0),
                        COALESCE(SUM(k.match_state IN ('auto', 'probable')), 0),
                        MAX(k.added_at)
                 FROM kindle_purchases k"
            ),
            [],
            |r| {
                Ok(KindleSummary {
                    total: r.get(0)?,
                    in_library: r.get(1)?,
                    missing: r.get(2)?,
                    removed: r.get(3)?,
                    waiting: r.get(4)?,
                    last_added: r.get(5)?,
                    covers,
                })
            },
        )?)
    }

    /// The "Kindle, not in library" list, newest purchase first, or the
    /// books taken off it (`removed`). Books added to the library since are
    /// matched first, so they leave the list.
    pub fn kindle_missing(&self, removed: bool) -> Result<Vec<KindlePurchase>> {
        self.match_kindle(true)?;
        let missing = missing_clause();
        let mut statement = self.conn.prepare(&format!(
            "SELECT k.asin, k.title, k.author, k.acquired_at, k.read, k.link, k.cover_url, k.dismissed_at IS NOT NULL,
                    CASE WHEN k.match_state = 'confirmed' THEN {BOOK_IDS} ELSE '[]' END
             FROM kindle_purchases k
             WHERE {missing} AND (k.dismissed_at IS NOT NULL) = ?1
             ORDER BY k.acquired_at DESC, k.title COLLATE NOCASE"
        ))?;
        let rows = statement.query_map(params![removed], |r| {
            Ok(KindlePurchase {
                asin: r.get(0)?,
                title: r.get(1)?,
                author: r.get(2)?,
                acquired_at: r.get(3)?,
                read: r.get(4)?,
                link: r.get(5)?,
                cover_url: r.get(6)?,
                removed: r.get(7)?,
                book_ids: serde_json::from_str::<Vec<Option<String>>>(&r.get::<_, String>(8)?).unwrap_or_default().into_iter().flatten().collect(),
            })
        })?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    /// Confirms a purchase against one Archive book or all members of its box set.
    pub fn match_kindle_manually(&self, asin: &str, book_ids: &[BookId], mark_read: bool) -> Result<KindleApplied> {
        let mut seen = HashSet::new();
        let ids: Vec<&str> = book_ids.iter().map(String::as_str).filter(|id| seen.insert(*id)).collect();
        let Some(primary) = ids.first() else {
            return Err(Error::Unsuitable("Choose at least one Archive book.".into()));
        };
        for id in &ids {
            let exists: bool = self.conn.query_row(
                "SELECT EXISTS(SELECT 1 FROM books WHERE id = ?1 AND deleted_at IS NULL AND same_as IS NULL)",
                params![id],
                |row| row.get(0),
            )?;
            if !exists {
                return Err(Error::Unsuitable("One of those books is no longer in the Archive.".into()));
            }
        }
        let matched_books = if ids.len() > 1 { Some(serde_json::to_string(&ids)?) } else { None };
        let changed = self.conn.execute(
            "UPDATE kindle_purchases SET book_id = ?2, matched_books = ?3, match_state = 'confirmed',
                    dismissed_at = NULL, updated_at = ?4 WHERE asin = ?1 AND borrowed = 0",
            params![asin, primary, matched_books, now_utc()],
        )?;
        if changed == 0 {
            return Err(Error::Unsuitable("That Kindle purchase is no longer available.".into()));
        }
        let (tagged, marked_read) = self.settle_kindle(&[asin.to_string()], mark_read)?;
        Ok(KindleApplied { tagged, marked_read, missing: self.kindle_summary()?.missing })
    }

    /// Takes a book off the list, or puts it back. Remembered, so a newer
    /// file doesn't bring it back.
    pub fn set_kindle_removed(&self, asins: &[String], removed: bool) -> Result<()> {
        let now = now_utc();
        let tx = self.conn.unchecked_transaction()?;
        for asin in asins {
            tx.execute(
                "UPDATE kindle_purchases SET dismissed_at = CASE WHEN ?2 THEN COALESCE(dismissed_at, ?3) END, updated_at = ?3
                 WHERE asin = ?1 AND (dismissed_at IS NULL) = ?2",
                params![asin, removed, now],
            )?;
        }
        tx.commit()?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::epub::tests::write_test_epub;
    use crate::library::tests::open_temp_library;
    use crate::model::{ImportResult, ReadStatus};
    use std::fs;

    fn add(library: &mut Library, dir: &Path, title: &str, author: &str) -> BookId {
        let path = dir.join(format!("{title}.epub"));
        write_test_epub(&path, title, author, false);
        match &library.import_files(&[path])[0] {
            ImportResult::Imported { book_id, .. } => book_id.clone(),
            other => panic!("unexpected {other:?}"),
        }
    }

    fn export(dir: &Path, books: &str) -> std::path::PathBuf {
        let file = dir.join("kindlogger-export.json");
        fs::write(
            &file,
            format!(r#"{{"kindlogger":{{"version":"1.0.0","exported":"2026-11-05T21:01:05.571Z","region":"www.amazon.com"}},"books":[{books}]}}"#),
        )
        .unwrap();
        file
    }

    fn book(asin: &str, title: &str, author: &str, acquired: &str, read: bool) -> String {
        format!(
            r#"{{"asin":"{asin}","title":"{title}","author":"{author}","acquired":"{acquired}","read":{read},"format":"KindleEBook","link":"https://www.amazon.com/dp/{asin}","cover":"https://m.media-amazon.com/images/I/{asin}.SX150.jpg"}}"#
        )
    }

    #[test]
    fn dates_are_read() {
        assert_eq!(acquired_date("October 17, 2026").as_deref(), Some("2026-10-17T12:00:00.000Z"));
        assert_eq!(acquired_date("Borrowed on April 1, 2025").as_deref(), Some("2025-04-01T12:00:00.000Z"));
        assert_eq!(acquired_date("sometime"), None);
    }

    #[test]
    fn manual_matches_accept_box_sets_and_reopen_when_a_member_is_missing() {
        let (dir, mut library) = open_temp_library();
        let first = add(&mut library, dir.path(), "First book", "Writer");
        let second = add(&mut library, dir.path(), "Second book", "Writer");
        let file = export(dir.path(), &[
            book("BBOX", "Collected set", "Writer", "October 17, 2026", true),
            book("BONE", "Kindle edition one", "Writer", "October 16, 2026", false),
        ].join(","));
        library.import_kindle(&file).unwrap();
        library.conn.execute("UPDATE kindle_purchases SET match_state = 'rejected', book_id = ?1 WHERE asin = 'BBOX'", params![first]).unwrap();
        let result = library.match_kindle_manually("BBOX", &[first.clone(), second.clone(), first.clone()], true).unwrap();
        assert_eq!((result.tagged, result.marked_read, result.missing), (2, 2, 1));
        library.match_kindle_manually("BONE", std::slice::from_ref(&first), false).unwrap();
        assert_eq!(library.kindle_summary().unwrap().in_library, 2);
        library.conn.execute("UPDATE books SET deleted_at = ?2 WHERE id = ?1", params![second, now_utc()]).unwrap();
        let missing = library.kindle_missing(false).unwrap();
        assert_eq!(missing.len(), 1);
        assert_eq!(missing[0].asin, "BBOX");
        assert_eq!(missing[0].book_ids, [first, second]);
    }

    #[test]
    fn kindle_purchases_are_matched_reviewed_and_listed() {
        let (dir, mut library) = open_temp_library();
        let heart = add(&mut library, dir.path(), "Weight of the Heart", "Rosa Montero");
        let warlock = add(&mut library, dir.path(), "Warlock", "Glen Cook");
        let emma = add(&mut library, dir.path(), "Emma", "Jane Austen");
        let file = export(
            dir.path(),
            &[
                book("B01", "Weight of the Heart (Bruna Husky Book 2)", "Rosa Montero", "October 17, 2026", true),
                book("B02", "Warlock: Book One", "Glen Cook", "October 1, 2026", false),
                book("B03", "Middlemarch", "George Eliot", "May 2, 2024", true),
                book("B04", "Dune", "Frank Herbert", "Borrowed on May 2, 2024", false),
                book("B05", "Emma", "Someone Else", "May 3, 2024", false),
            ]
            .join(","),
        );

        let report = library.import_kindle(&file).unwrap();
        assert_eq!((report.total, report.new_purchases, report.borrowed), (5, 5, 1));
        assert_eq!(report.review.matched.iter().map(|m| m.book_id.as_str()).collect::<Vec<_>>(), [heart.as_str()]);
        let mut probable: Vec<_> = report.review.probable.iter().map(|m| m.asin.as_str()).collect();
        probable.sort();
        assert_eq!(probable, ["B02", "B05"]);
        assert_eq!(report.review.missing, 1, "Middlemarch; Dune was borrowed");
        assert_eq!(report.review.read_to_mark, 1);
        assert!(library.book_tags(&heart).unwrap().is_empty(), "nothing changes before review");

        let applied = library.apply_kindle(&["B02".into()], true).unwrap();
        assert_eq!((applied.tagged, applied.marked_read, applied.missing), (2, 1, 2));
        assert_eq!(library.book_tags(&heart).unwrap(), ["Kindle"]);
        assert_eq!(library.book_tags(&warlock).unwrap(), ["Kindle"]);
        assert!(library.book_tags(&emma).unwrap().is_empty());
        assert_eq!(library.book(&heart).unwrap().unwrap().status, ReadStatus::Read);

        let missing: Vec<_> = library.kindle_missing(false).unwrap().into_iter().map(|p| p.asin).collect();
        assert_eq!(missing, ["B05", "B03"]);

        // Taken off by hand stays off after a newer file.
        library.set_kindle_removed(&["B05".into()], true).unwrap();
        let again = library.import_kindle(&file).unwrap();
        assert_eq!(again.new_purchases, 0);
        assert!(again.review.matched.is_empty() && again.review.probable.is_empty());
        assert_eq!(library.kindle_missing(true).unwrap().len(), 1);

        // A book added to the library leaves the list, tagged and marked read.
        let middlemarch = add(&mut library, dir.path(), "Middlemarch", "George Eliot");
        assert!(library.kindle_missing(false).unwrap().is_empty());
        assert_eq!(library.book_tags(&middlemarch).unwrap(), ["Kindle"]);
        assert_eq!(library.book(&middlemarch).unwrap().unwrap().status, ReadStatus::Read);
        // Emma (turned down: someone else's) is found once the right one arrives.
        library.set_kindle_removed(&["B05".into()], false).unwrap();
        let emma2 = add(&mut library, dir.path(), "Emma ", "Someone Else");
        assert!(library.kindle_missing(false).unwrap().is_empty());
        assert_eq!(library.book_tags(&emma2).unwrap(), ["Kindle"]);
        assert!(library.book_tags(&emma).unwrap().is_empty());

        // Read on Kindle since the last file: a confirmed book takes it.
        let file2 = export(dir.path(), &book("B02", "Warlock: Book One", "Glen Cook", "October 1, 2026", true));
        library.import_kindle(&file2).unwrap();
        assert_eq!(library.book(&warlock).unwrap().unwrap().status, ReadStatus::Read);
        let summary = library.kindle_summary().unwrap();
        assert_eq!((summary.total, summary.in_library, summary.missing, summary.removed, summary.waiting), (5, 4, 0, 0, 0));
    }

    #[test]
    fn other_files_are_refused() {
        let (dir, library) = open_temp_library();
        let file = dir.path().join("x.json");
        fs::write(&file, r#"{"books":[]}"#).unwrap();
        assert!(matches!(library.import_kindle(&file), Err(Error::Unsuitable(_))));
    }
}

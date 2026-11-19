//! Watching authors and single books (embre, 19 November): the books an
//! author has out or coming, and a book's release date, looked up on Google
//! Books (free, no account). The app keeps the watch list and decides what
//! counts as news: a book newly announced, or one whose release date has come.

use std::collections::{HashMap, HashSet};
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;

use crate::error::{Error, Result};
use crate::library::Library;
use crate::manage::{author_key, title_key};

/// A book found online for a watched author or book.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchedBook {
    /// The same for every edition of the book: its title, compared loosely.
    pub key: String,
    pub title: String,
    pub authors: Vec<String>,
    /// When it comes out (or came out): "2027-03-04", "2027-03" or "2027".
    pub date: Option<String>,
    pub cover_url: Option<String>,
    /// Its Google Books page.
    pub link: Option<String>,
}

fn text(v: &Value) -> Option<String> {
    v.as_str().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string)
}

/// Whether a book's authors include the one asked about.
fn by(authors: &[String], author: &str) -> bool {
    let want = author_key(&[author.to_string()]);
    want.is_empty() || authors.iter().any(|a| author_key(std::slice::from_ref(a)) == want)
}

/// A date as Google gives it, if it's one: "2027", "2027-03" or "2027-03-04".
fn date_of(v: &Value) -> Option<String> {
    let d = text(v)?;
    let ok = matches!(d.len(), 4 | 7 | 10) && d.chars().enumerate().all(|(i, c)| if i == 4 || i == 7 { c == '-' } else { c.is_ascii_digit() });
    ok.then_some(d)
}

/// The books in a Google Books answer by `author`, one per title: the
/// edition with the most exact date, then the earliest.
pub fn books_from_google(data: &Value, author: &str) -> Vec<WatchedBook> {
    let mut found: Vec<WatchedBook> = Vec::new();
    let mut at: HashMap<String, usize> = HashMap::new();
    for item in data["items"].as_array().into_iter().flatten() {
        let info = &item["volumeInfo"];
        let Some(title) = text(&info["title"]) else { continue };
        let authors: Vec<String> = info["authors"].as_array().map(|a| a.iter().filter_map(text).collect()).unwrap_or_default();
        if authors.is_empty() || !by(&authors, author) {
            continue;
        }
        let key = title_key(&title);
        if key.is_empty() {
            continue;
        }
        let book = WatchedBook {
            key: key.clone(),
            title,
            authors,
            date: date_of(&info["publishedDate"]),
            cover_url: text(&info["imageLinks"]["thumbnail"]).map(|c| c.replace("http://", "https://")),
            link: text(&info["infoLink"]).or_else(|| text(&info["canonicalVolumeLink"])),
        };
        match at.get(&key) {
            None => {
                at.insert(key, found.len());
                found.push(book);
            }
            Some(&i) => {
                let kept = &mut found[i];
                let better = match (&book.date, &kept.date) {
                    (Some(_), None) => true,
                    (Some(new), Some(old)) => new.len() > old.len() || (new.len() == old.len() && new < old),
                    _ => false,
                };
                if better {
                    kept.date = book.date;
                }
                if kept.cover_url.is_none() {
                    kept.cover_url = book.cover_url;
                }
            }
        }
    }
    found
}

fn ask(q: &str, newest: bool) -> Result<Value> {
    let agent: ureq::Agent = ureq::Agent::config_builder().timeout_global(Some(Duration::from_secs(20))).build().into();
    let mut request = agent.get("https://www.googleapis.com/books/v1/volumes").query("q", q).query("maxResults", "40").query("printType", "books");
    if newest {
        request = request.query("orderBy", "newest");
    }
    let mut response = request.call().map_err(|e| Error::Offline(format!("Google Books couldn't be reached: {e}")))?;
    response.body_mut().read_json().map_err(|e| Error::Offline(format!("Google Books' answer couldn't be read: {e}")))
}

/// An author's books, newest first as Google has them.
pub fn author_books(author: &str) -> Result<Vec<WatchedBook>> {
    let author = author.trim();
    if author.is_empty() {
        return Ok(Vec::new());
    }
    let q = format!("inauthor:\"{author}\"");
    // The newest for what's coming, and the usual order too, so an old book
    // in a new edition is seen with its first date and isn't taken for new.
    let newest = ask(&q, true)?;
    let usual = ask(&q, false).unwrap_or_default();
    let items: Vec<Value> = [&newest, &usual].iter().flat_map(|d| d["items"].as_array().cloned().unwrap_or_default()).collect();
    Ok(books_from_google(&serde_json::json!({ "items": items }), author))
}

/// One book, by its title and author, if Google knows it.
pub fn find_book(title: &str, author: &str) -> Result<Option<WatchedBook>> {
    let key = title_key(title);
    if key.is_empty() {
        return Ok(None);
    }
    let mut q = format!("intitle:\"{}\"", title.trim());
    if !author.trim().is_empty() {
        q.push_str(&format!(" inauthor:\"{}\"", author.trim()));
    }
    Ok(books_from_google(&ask(&q, false)?, author).into_iter().find(|b| b.key == key))
}

impl Library {
    /// The titles in the library, compared loosely, so books already here
    /// aren't news.
    pub fn title_keys(&self) -> Result<HashSet<String>> {
        let mut statement = self.conn.prepare(
            "SELECT COALESCE(o.value, b.title) FROM books b \
             LEFT JOIN metadata_overrides o ON o.book_id = b.id AND o.field = 'title'",
        )?;
        let titles = statement.query_map([], |row| row.get::<_, Option<String>>(0))?;
        let mut keys = HashSet::new();
        for title in titles {
            keys.insert(title_key(&title?.unwrap_or_default()));
        }
        Ok(keys)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn one_book_per_title_with_the_most_exact_date() {
        let data = json!({ "items": [
            { "volumeInfo": { "title": "The Winds of Winter", "authors": ["George R. R. Martin"], "publishedDate": "2027", "infoLink": "https://books.google.com/a" } },
            { "volumeInfo": { "title": "The Winds of Winter: A Song of Ice and Fire", "authors": ["George R.R. Martin"], "publishedDate": "2027-03-04", "imageLinks": { "thumbnail": "http://books.google.com/c.jpg" } } },
            { "volumeInfo": { "title": "Fire & Blood", "authors": ["George R. R. Martin"], "publishedDate": "2018-11-20" } },
            { "volumeInfo": { "title": "A Guide to Westeros", "authors": ["Someone Else"], "publishedDate": "2020" } },
            { "volumeInfo": { "title": "No Authors" } },
            { "volumeInfo": { "title": "Odd Date", "authors": ["George R. R. Martin"], "publishedDate": "2019-01-01T00:00" } }
        ]});
        let found = books_from_google(&data, "George R. R. Martin");
        let titles: Vec<&str> = found.iter().map(|b| b.title.as_str()).collect();
        assert_eq!(titles, ["The Winds of Winter", "Fire & Blood", "Odd Date"]);
        assert_eq!(found[0].date.as_deref(), Some("2027-03-04"));
        assert_eq!(found[0].cover_url.as_deref(), Some("https://books.google.com/c.jpg"));
        assert_eq!(found[0].link.as_deref(), Some("https://books.google.com/a"));
        assert_eq!(found[2].date, None);
    }

    #[test]
    fn library_titles_compare_loosely_and_follow_edits() {
        let (dir, mut library) = crate::library::tests::open_temp_library();
        let path = dir.path().join("book.epub");
        crate::epub::tests::write_test_epub(&path, "Lathe", "Ursula K. Le Guin", false);
        let crate::model::ImportResult::Imported { book_id, .. } = &library.import_files(&[path])[0] else { panic!() };
        library
            .conn
            .execute(
                "INSERT INTO metadata_overrides (book_id, field, value, updated_at) VALUES (?1, 'title', 'The Lathe of Heaven: A Novel', '2026-11-19T00:00:00Z')",
                [book_id],
            )
            .unwrap();
        let keys = library.title_keys().unwrap();
        assert!(keys.contains(&title_key("Lathe of Heaven")));
        assert!(!keys.contains("lathe"));
    }
}

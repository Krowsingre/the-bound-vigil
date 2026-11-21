//! Find alike (embre, 21 November): books by the same author whose titles
//! start alike ("Dark City Girls", "Dark City Girls 2", "Dark City Girls:
//! Book 3") gathered into one group, with the books already in a series
//! joining the group of their series. From a group the person makes a
//! series, adds books to one, or keeps a book out of that group, which lasts
//! (on every device) until Book details lets it back in.

use std::collections::{BTreeMap, HashMap, HashSet};

use rusqlite::params;
use serde::{Deserialize, Serialize};

use crate::browse::kind_condition;
use crate::error::Result;
use crate::home::{book_from_row, BOOK_COLUMNS, BOOK_FROM};
use crate::library::Library;
use crate::manage::{title_key, title_number};
use crate::model::{BookPreview, ItemKind};
use crate::time::now_utc;

/// The book's override holding the groups it's kept out of: a JSON list of
/// group keys. An override so it travels like the book's other edits.
pub const KEPT_OUT: &str = "find_alike_out";

/// Words that mark a book's place in a series, left out of the title a group goes by.
const PLACE_WORDS: &[&str] = &["book", "books", "volume", "vol", "part", "no", "tome", "episode", "omnibus"];
const NUMBER_WORDS: &[&str] = &["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
const ROMAN: &[&str] = &["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x", "xi", "xii"];
/// Little words kept lower-case in a group's suggested series name.
const SMALL: &[&str] = &["a", "an", "and", "as", "at", "but", "by", "for", "in", "of", "on", "or", "the", "to"];

/// The details Find alike can match by or look only at (embre, 21 November).
pub const ALIKE_FIELDS: &[&str] = &["author", "title", "series", "publisher", "genre", "tag", "narrator", "language", "year"];
/// A list detail (genres, tags, narrators) counts this many of its values at most.
const MAX_VALUES: usize = 5;

/// How Find alike searches: the details books must share to be grouped
/// (author and title start until changed), and the books it looks at.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlikeOptions {
    #[serde(default)]
    pub match_by: Vec<String>,
    #[serde(default)]
    pub only: Vec<AlikeFilter>,
}

/// "Only look at" books whose `field` has this value (any of its values, for a list).
#[derive(Debug, Clone, Deserialize)]
pub struct AlikeFilter {
    pub field: String,
    pub value: String,
}

/// A book with the details Find alike reads that a preview doesn't carry.
struct Row {
    book: BookPreview,
    audio: Option<String>,
    out: Option<String>,
    publisher: Option<String>,
    published: Option<String>,
}

/// A detail's values, as they compare (lower case, words only).
fn values(row: &Row, field: &str) -> Vec<String> {
    let one = |v: Option<&str>| v.map(|v| words(v).join(" ")).filter(|v| !v.is_empty()).into_iter().collect::<Vec<_>>();
    let many = |list: &[String]| {
        let mut out: Vec<String> = list.iter().map(|v| words(v).join(" ")).filter(|v| !v.is_empty()).collect();
        out.dedup();
        out.truncate(MAX_VALUES);
        out
    };
    let book = &row.book;
    match field {
        "author" => Some(author_of(&book.authors)).filter(|a| !a.is_empty()).into_iter().collect(),
        "title" => Some(lead(&stem(&book.title))).filter(|t| !t.is_empty()).into_iter().collect(),
        "series" => one(book.series.as_deref()),
        "publisher" => one(row.publisher.as_deref()),
        "genre" => many(&book.genres),
        "tag" => many(&book.tags),
        "narrator" => many(&book.narrators),
        "language" => one(book.language.as_deref()),
        "year" => row.published.as_deref().map(|p| p.chars().take(4).collect::<String>()).filter(|y| y.len() == 4 && y.chars().all(|c| c.is_ascii_digit())).into_iter().collect(),
        _ => Vec::new(),
    }
}

/// The keys a book is found by: one for each mix of its values of the details matched.
/// Matching by title start also joins the books of one series.
fn keys_for(row: &Row, match_by: &[String]) -> Vec<String> {
    let mut keys = vec![String::new()];
    for field in match_by {
        let mut options: Vec<String> = values(row, field).into_iter().map(|v| format!("{field}:{v}")).collect();
        if field == "title" && !match_by.iter().any(|f| f == "series") {
            options.extend(values(row, "series").into_iter().map(|v| format!("series:{v}")));
        }
        if options.is_empty() {
            return Vec::new();
        }
        keys = keys.iter().flat_map(|k| options.iter().map(move |o| if k.is_empty() { o.clone() } else { format!("{k}|{o}") })).collect();
    }
    keys
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AlikeBook {
    pub book: BookPreview,
    /// The number its title gives it ("Book 3", "#2", a last word "3").
    pub guess: Option<f64>,
    /// Another book of the group that is the same book (the same title and number).
    pub same_as: Option<String>,
    /// The audiobook paired with this ebook, if any.
    pub paired_audio: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AlikeGroup {
    /// Every key the group was found by; keeping a book out stores them.
    pub keys: Vec<String>,
    /// The name a new series would take: the series most of its books are in,
    /// or the words their titles share.
    pub name: String,
    pub author: String,
    pub books: Vec<AlikeBook>,
}

/// The first author, as it compares with others: "Stoker, Bram" and "Bram Stoker" alike.
fn author_of(authors: &[String]) -> String {
    let first = authors.first().map(String::as_str).unwrap_or_default();
    let flipped = match first.split_once(',') {
        Some((last, rest)) => format!("{rest} {last}"),
        None => first.to_string(),
    };
    words(&flipped).join(" ")
}

fn words(text: &str) -> Vec<String> {
    text.split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty()).map(str::to_lowercase).collect()
}

/// The title without its place in a series: "Dark City Girls: Book 3" → "dark city girls".
pub(crate) fn stem(title: &str) -> String {
    let is_place = |w: &str| PLACE_WORDS.contains(&w) || w.parse::<f64>().is_ok() || NUMBER_WORDS.contains(&w) || ROMAN.contains(&w);
    let mut key = title_key(title);
    // "Book 1: Saga" goes by what follows its place.
    if key.split(' ').all(is_place) {
        if let Some((_, rest)) = title.split_once(':') {
            key = title_key(rest);
        }
    }
    let mut words: Vec<&str> = key.split(' ').filter(|w| !w.is_empty()).collect();
    // A place at the end ("… 3", "… Book 3", "… Part II"), then at the start ("Book 1 …").
    while let Some(last) = words.last() {
        let after_place = words.len() > 1 && PLACE_WORDS.contains(&words[words.len() - 2]);
        let place = last.parse::<f64>().is_ok()
            || PLACE_WORDS.contains(last)
            || ((ROMAN.contains(last) || NUMBER_WORDS.contains(last)) && (after_place || ROMAN.contains(last) && *last != "i"));
        if !place || words.len() == 1 {
            break;
        }
        words.pop();
    }
    while words.len() > 1 && (PLACE_WORDS.contains(&words[0]) || words[0].parse::<f64>().is_ok()) {
        words.remove(0);
    }
    words.join(" ")
}

/// What a group's titles go by: their first two words, or one word alone.
fn lead(stem: &str) -> String {
    stem.split(' ').take(2).collect::<Vec<_>>().join(" ")
}

/// "dark city girls" → "Dark City Girls".
fn title_case(text: &str) -> String {
    text.split(' ')
        .enumerate()
        .map(|(i, w)| {
            if i > 0 && SMALL.contains(&w) {
                return w.to_string();
            }
            let mut chars = w.chars();
            chars.next().map(|c| c.to_uppercase().chain(chars).collect()).unwrap_or_default()
        })
        .collect::<Vec<String>>()
        .join(" ")
}

/// The words every one of these stems starts with.
fn shared_start(stems: &[String]) -> String {
    let lists: Vec<Vec<&str>> = stems.iter().map(|s| s.split(' ').collect()).collect();
    let Some(first) = lists.first() else { return String::new() };
    let mut n = first.len();
    for list in &lists[1..] {
        n = n.min(first.iter().zip(list).take_while(|(a, b)| a == b).count());
    }
    first[..n].join(" ")
}

struct Found {
    parent: Vec<usize>,
}

impl Found {
    fn root(&mut self, i: usize) -> usize {
        let mut i = i;
        while self.parent[i] != i {
            self.parent[i] = self.parent[self.parent[i]];
            i = self.parent[i];
        }
        i
    }
    fn join(&mut self, a: usize, b: usize) {
        let (a, b) = (self.root(a), self.root(b));
        if a != b {
            self.parent[a.max(b)] = a.min(b);
        }
    }
}

impl Library {
    /// The groups of alike books of one kind, biggest first. A group needs two
    /// books, and something left to do: a book in no series, or books in
    /// different series.
    pub fn find_alike(&self, kind: ItemKind, options: &AlikeOptions) -> Result<Vec<AlikeGroup>> {
        let mut match_by: Vec<String> = options.match_by.iter().filter(|f| ALIKE_FIELDS.contains(&f.as_str())).cloned().collect();
        match_by.dedup();
        if match_by.is_empty() {
            match_by = vec!["author".into(), "title".into()];
        }
        let sql = format!(
            "{BOOK_COLUMNS}, (SELECT a.book_id FROM audiobooks a JOIN books ab ON ab.id = a.book_id AND ab.deleted_at IS NULL
                              WHERE a.ebook_id = b.id LIMIT 1) AS alike_audio,
                    (SELECT value FROM metadata_overrides WHERE book_id = b.id AND field = '{KEPT_OUT}') AS alike_out,
                    COALESCE((SELECT value FROM metadata_overrides WHERE book_id = b.id AND field = 'publisher'),
                             (SELECT value FROM metadata_fetched WHERE book_id = b.id AND field = 'publisher'), b.publisher) AS alike_publisher,
                    COALESCE((SELECT value FROM metadata_overrides WHERE book_id = b.id AND field = 'published'),
                             (SELECT value FROM metadata_fetched WHERE book_id = b.id AND field = 'published')) AS alike_published
             {BOOK_FROM} AND {} ORDER BY b.added_at",
            kind_condition(kind)
        );
        let mut statement = self.conn.prepare(&sql)?;
        let all = statement
            .query_map([], |r| {
                Ok(Row {
                    book: book_from_row(r)?,
                    audio: r.get("alike_audio")?,
                    out: r.get("alike_out")?,
                    publisher: r.get("alike_publisher")?,
                    published: r.get("alike_published")?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        // "Only look at": every filter must hold.
        let filters: Vec<(String, String)> = options
            .only
            .iter()
            .filter(|f| ALIKE_FIELDS.contains(&f.field.as_str()))
            .map(|f| (f.field.clone(), words(&f.value).join(" ")))
            .filter(|(_, v)| !v.is_empty())
            .collect();
        let rows: Vec<Row> = all
            .into_iter()
            .filter(|row| {
                filters.iter().all(|(field, want)| match field.as_str() {
                    // A title is looked at by its words, anywhere in it.
                    "title" => words(&row.book.title).join(" ").contains(want.as_str()),
                    _ => values(row, field).iter().any(|v| v == want),
                })
            })
            .collect();

        let mut keys_of: Vec<Vec<String>> = Vec::with_capacity(rows.len());
        let mut stems: Vec<String> = Vec::with_capacity(rows.len());
        let mut by_key: HashMap<String, Vec<usize>> = HashMap::new();
        for (i, row) in rows.iter().enumerate() {
            let keys = keys_for(row, &match_by);
            for key in &keys {
                by_key.entry(key.clone()).or_default().push(i);
            }
            keys_of.push(keys);
            stems.push(stem(&row.book.title));
        }
        let mut found = Found { parent: (0..rows.len()).collect() };
        for members in by_key.values() {
            for pair in members.windows(2) {
                found.join(pair[0], pair[1]);
            }
        }
        let mut groups: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
        for (i, keys) in keys_of.iter().enumerate() {
            if !keys.is_empty() {
                let root = found.root(i);
                groups.entry(root).or_default().push(i);
            }
        }

        let kept_out: Vec<HashSet<String>> = rows
            .iter()
            .map(|row| row.out.as_deref().and_then(|o| serde_json::from_str::<Vec<String>>(o).ok()).unwrap_or_default().into_iter().collect())
            .collect();
        let mut out = Vec::new();
        for members in groups.into_values() {
            let mut keys: Vec<String> = members.iter().flat_map(|&i| keys_of[i].iter().cloned()).collect();
            keys.sort();
            keys.dedup();
            let members: Vec<usize> = members.into_iter().filter(|&i| !keys.iter().any(|k| kept_out[i].contains(k))).collect();
            if members.len() < 2 {
                continue;
            }
            let series: HashSet<String> = members
                .iter()
                .filter_map(|&i| rows[i].book.series.as_deref().map(|s| words(s).join(" ")).filter(|s| !s.is_empty()))
                .collect();
            let loose = members.iter().any(|&i| rows[i].book.series.as_deref().is_none_or(|s| s.trim().is_empty()));
            if !loose && series.len() < 2 {
                continue;
            }
            out.push(alike_group(&rows, &stems, members, keys, &match_by));
        }
        out.sort_by(|a, b| b.books.len().cmp(&a.books.len()).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
        Ok(out)
    }

    /// Keeps these books out of the group found by `keys` (until `include_in_alike`),
    /// or, with `out` false, lets them back into it.
    pub fn keep_out_of_alike(&self, book_ids: &[String], keys: &[String], out: bool) -> Result<()> {
        let now = now_utc();
        let tx = self.conn.unchecked_transaction()?;
        for id in book_ids {
            let current: Option<String> = tx
                .query_row(
                    "SELECT value FROM metadata_overrides WHERE book_id = ?1 AND field = ?2",
                    params![id, KEPT_OUT],
                    |r| r.get(0),
                )
                .ok();
            let mut list: Vec<String> = current.as_deref().and_then(|c| serde_json::from_str(c).ok()).unwrap_or_default();
            for key in keys {
                if out && !list.contains(key) {
                    list.push(key.clone());
                }
            }
            if !out {
                list.retain(|k| !keys.contains(k));
            }
            if list.is_empty() {
                tx.execute("DELETE FROM metadata_overrides WHERE book_id = ?1 AND field = ?2", params![id, KEPT_OUT])?;
            } else {
                tx.execute(
                    "INSERT INTO metadata_overrides (book_id, field, value, updated_at) VALUES (?1, ?2, ?3, ?4)
                     ON CONFLICT(book_id, field) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
                     WHERE value IS NOT excluded.value",
                    params![id, KEPT_OUT, serde_json::to_string(&list)?, now],
                )?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    /// Whether the book is kept out of any Find alike group.
    pub fn kept_out_of_alike(&self, book_id: &str) -> Result<bool> {
        Ok(self.conn.query_row(
            "SELECT EXISTS (SELECT 1 FROM metadata_overrides WHERE book_id = ?1 AND field = ?2)",
            params![book_id, KEPT_OUT],
            |r| r.get(0),
        )?)
    }

    /// The books of one kind kept out of a group, to let back in from Find alike.
    pub fn kept_out_books(&self, kind: ItemKind) -> Result<Vec<BookPreview>> {
        let sql = format!(
            "{BOOK_COLUMNS} {BOOK_FROM} AND {} AND EXISTS (SELECT 1 FROM metadata_overrides WHERE book_id = b.id AND field = '{KEPT_OUT}')
             ORDER BY lower({})",
            kind_condition(kind),
            crate::browse::TITLE,
        );
        let mut statement = self.conn.prepare(&sql)?;
        let books = statement.query_map([], book_from_row)?.collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(books)
    }

    /// Book details' "Include in Find alike": lets the book back into every group.
    pub fn include_in_alike(&self, book_id: &str) -> Result<()> {
        self.conn.execute("DELETE FROM metadata_overrides WHERE book_id = ?1 AND field = ?2", params![book_id, KEPT_OUT])?;
        Ok(())
    }
}

fn alike_group(rows: &[Row], stems: &[String], members: Vec<usize>, keys: Vec<String>, match_by: &[String]) -> AlikeGroup {
    // The name: the series most of the books are in, or the words the titles share.
    let mut counts: HashMap<&str, usize> = HashMap::new();
    for &i in &members {
        if let Some(s) = rows[i].book.series.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
            *counts.entry(s).or_default() += 1;
        }
    }
    let name = match counts.into_iter().max_by(|a, b| a.1.cmp(&b.1).then_with(|| b.0.cmp(a.0))) {
        Some((series, _)) => series.to_string(),
        None if match_by.iter().any(|f| f == "title") => {
            let loose: Vec<String> = members.iter().map(|&i| stems[i].clone()).collect();
            let shared = shared_start(&loose);
            title_case(if shared.is_empty() { &loose[0] } else { &shared })
        }
        // Not matched by title: named by what its books share.
        None => {
            let first = &rows[members[0]];
            let shared: Vec<String> = match_by
                .iter()
                .filter_map(|field| {
                    let mine = values(first, field);
                    mine.into_iter().find(|v| members.iter().all(|&i| values(&rows[i], field).contains(v)))
                })
                .map(|v| title_case(&v))
                .collect();
            if shared.is_empty() { title_case(&stems[members[0]]) } else { shared.join(" · ") }
        }
    };
    let author = rows[members[0]].book.authors.first().cloned().unwrap_or_default();
    let mut seen: HashMap<(String, Option<u64>), String> = HashMap::new();
    let books = members
        .iter()
        .map(|&i| {
            let book = &rows[i].book;
            let number = title_number(&book.title);
            let guess = number.tagged.or(number.main);
            let same_as = match seen.get(&(title_key(&book.title), guess)) {
                Some(id) => Some(id.clone()),
                None => {
                    seen.insert((title_key(&book.title), guess), book.id.to_string());
                    None
                }
            };
            AlikeBook { book: book.clone(), guess: guess.map(|n| n as f64), same_as, paired_audio: rows[i].audio.clone() }
        })
        .collect();
    AlikeGroup { keys, name, author, books }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::epub::tests::write_test_epub_with;
    use crate::library::tests::open_temp_library;
    use crate::model::ImportResult;
    use std::path::Path;

    fn add(library: &mut Library, dir: &Path, title: &str, author: &str) -> String {
        let path = dir.join(format!("{title}.epub"));
        write_test_epub_with(&path, title, author, false, "");
        match library.import_files(&[path]).remove(0) {
            ImportResult::Imported { book_id, .. } => book_id,
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn groups_gather_alike_titles_and_series_and_keep_books_out() {
        let (dir, mut library) = open_temp_library();
        let one = add(&mut library, dir.path(), "Dark City Girls", "Kay Smith");
        let two = add(&mut library, dir.path(), "Dark City Girls 2", "Smith, Kay");
        let three = add(&mut library, dir.path(), "Dark City Girls: Book 3", "Kay Smith");
        let side = add(&mut library, dir.path(), "Night Market", "Kay Smith");
        add(&mut library, dir.path(), "Dark City Lights", "Someone Else");
        library.conn.execute("UPDATE books SET series = 'Dark City Girls' WHERE id IN (?1, ?2)", params![side, three]).unwrap();

        let groups = library.find_alike(ItemKind::Books, &AlikeOptions::default()).unwrap();
        assert_eq!(groups.len(), 1, "{groups:?}");
        let group = &groups[0];
        assert_eq!(group.name, "Dark City Girls");
        let mut ids: Vec<&str> = group.books.iter().map(|b| b.book.id.as_str()).collect();
        ids.sort_unstable();
        let mut want = vec![one.as_str(), two.as_str(), three.as_str(), side.as_str()];
        want.sort_unstable();
        assert_eq!(ids, want);
        let guess = |id: &str| group.books.iter().find(|b| b.book.id == id).unwrap().guess;
        assert_eq!((guess(&one), guess(&two), guess(&three)), (None, Some(2.0), Some(3.0)));

        // Kept out of this group: gone from it, and back with Include in Find alike.
        library.keep_out_of_alike(std::slice::from_ref(&two), &group.keys, true).unwrap();
        assert!(library.kept_out_of_alike(&two).unwrap());
        let groups = library.find_alike(ItemKind::Books, &AlikeOptions::default()).unwrap();
        assert!(groups[0].books.iter().all(|b| b.book.id != two));
        library.reset_details(&two, false).unwrap();
        assert!(library.kept_out_of_alike(&two).unwrap(), "resetting details keeps it out");
        let out: Vec<String> = library.kept_out_books(ItemKind::Books).unwrap().into_iter().map(|b| b.id.to_string()).collect();
        assert_eq!(out, std::slice::from_ref(&two));
        library.include_in_alike(&two).unwrap();
        assert_eq!(library.find_alike(ItemKind::Books, &AlikeOptions::default()).unwrap()[0].books.len(), 4);

        // All in one series: nothing left to do, so no group.
        library.conn.execute("UPDATE books SET series = 'Dark City Girls' WHERE id IN (?1, ?2)", params![one, two]).unwrap();
        assert!(library.find_alike(ItemKind::Books, &AlikeOptions::default()).unwrap().is_empty());
    }

    #[test]
    fn options_choose_what_must_match_and_which_books_are_looked_at() {
        let (dir, mut library) = open_temp_library();
        let a = add(&mut library, dir.path(), "Night Market", "Kay Smith");
        let b = add(&mut library, dir.path(), "Glass Harbour", "Kay Smith");
        let c = add(&mut library, dir.path(), "Night Market 2", "Kay Smith");
        let genre = |ids: &[String], g: &str| {
            let change = crate::details::DetailChange { field: "genres".into(), value: Some(format!("[\"{g}\"]")) };
            library.edit_details(ids, std::slice::from_ref(&change)).unwrap();
        };
        genre(&[a.clone(), b.clone()], "Fantasy");
        genre(std::slice::from_ref(&c), "Crime");
        let options = |match_by: &[&str], only: &[(&str, &str)]| AlikeOptions {
            match_by: match_by.iter().map(|f| f.to_string()).collect(),
            only: only.iter().map(|(f, v)| AlikeFilter { field: f.to_string(), value: v.to_string() }).collect(),
        };
        let ids = |groups: Vec<AlikeGroup>| {
            groups.into_iter().map(|g| { let mut v: Vec<String> = g.books.into_iter().map(|b| b.book.id.to_string()).collect(); v.sort(); v }).collect::<Vec<_>>()
        };
        let sorted = |mut v: Vec<String>| { v.sort(); v };

        // Author and title start: the two Night Markets.
        assert_eq!(ids(library.find_alike(ItemKind::Books, &options(&[], &[])).unwrap()), [sorted(vec![a.clone(), c.clone()])]);
        // Author and genre: the two fantasy books, named by what they share.
        let by_genre = library.find_alike(ItemKind::Books, &options(&["author", "genre"], &[])).unwrap();
        assert_eq!(by_genre[0].name, "Kay Smith · Fantasy");
        assert_eq!(ids(by_genre), [sorted(vec![a.clone(), b.clone()])]);
        // Only crime books: one Night Market alone isn't a group.
        assert!(library.find_alike(ItemKind::Books, &options(&[], &[("genre", "crime")])).unwrap().is_empty());
        assert_eq!(ids(library.find_alike(ItemKind::Books, &options(&["author"], &[("title", "night")])).unwrap()), [sorted(vec![a, c])]);
    }

    #[test]
    fn stems_leave_out_the_place_in_a_series() {
        assert_eq!(stem("Dark City Girls 3"), "dark city girls");
        assert_eq!(stem("Dark City Girls: Book 3"), "dark city girls");
        assert_eq!(stem("The Dark City Girls, Book Two"), "dark city girls");
        assert_eq!(stem("Ocean's Eleven"), "ocean s eleven");
        assert_eq!(stem("Saga Part II"), "saga");
        assert_eq!(stem("Book 1: Saga"), "saga");
        assert_eq!(stem("1984"), "1984");
        assert_eq!(title_case("lord of the rings"), "Lord of the Rings");
        assert_eq!(author_of(&["Stoker, Bram".into()]), author_of(&["Bram Stoker".into()]));
    }
}

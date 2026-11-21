//! Find alike (embre, 21 November): books by the same author whose titles
//! start alike ("Dark City Girls", "Dark City Girls 2", "Dark City Girls:
//! Book 3") gathered into one group, with the books already in a series
//! joining the group of their series. From a group the person makes a
//! series, adds books to one, or keeps a book out of that group, which lasts
//! (on every device) until Book details lets it back in.

use std::collections::{BTreeMap, HashMap, HashSet};

use rusqlite::params;
use serde::Serialize;

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
    pub fn find_alike(&self, kind: ItemKind) -> Result<Vec<AlikeGroup>> {
        let sql = format!(
            "{BOOK_COLUMNS}, (SELECT a.book_id FROM audiobooks a JOIN books ab ON ab.id = a.book_id AND ab.deleted_at IS NULL
                              WHERE a.ebook_id = b.id LIMIT 1) AS alike_audio,
                    (SELECT value FROM metadata_overrides WHERE book_id = b.id AND field = '{KEPT_OUT}') AS alike_out
             {BOOK_FROM} AND {} ORDER BY b.added_at",
            kind_condition(kind)
        );
        let mut statement = self.conn.prepare(&sql)?;
        let rows = statement
            .query_map([], |r| {
                Ok((book_from_row(r)?, r.get::<_, Option<String>>("alike_audio")?, r.get::<_, Option<String>>("alike_out")?))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;

        // Each book is found by its author and its title's start, and by its series.
        let mut keys_of: Vec<Vec<String>> = Vec::with_capacity(rows.len());
        let mut stems: Vec<String> = Vec::with_capacity(rows.len());
        let mut by_key: HashMap<String, Vec<usize>> = HashMap::new();
        for (i, (book, ..)) in rows.iter().enumerate() {
            let author = author_of(&book.authors);
            let stem = stem(&book.title);
            let mut keys = Vec::new();
            if !author.is_empty() && !stem.is_empty() {
                keys.push(format!("{author}|{}", lead(&stem)));
            }
            if let Some(series) = book.series.as_deref().map(|s| words(s).join(" ")).filter(|s| !s.is_empty()) {
                if !author.is_empty() {
                    keys.push(format!("{author}|series:{series}"));
                }
            }
            for key in &keys {
                by_key.entry(key.clone()).or_default().push(i);
            }
            keys_of.push(keys);
            stems.push(stem);
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
            .map(|(_, _, out)| out.as_deref().and_then(|o| serde_json::from_str::<Vec<String>>(o).ok()).unwrap_or_default().into_iter().collect())
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
                .filter_map(|&i| rows[i].0.series.as_deref().map(|s| words(s).join(" ")).filter(|s| !s.is_empty()))
                .collect();
            let loose = members.iter().any(|&i| rows[i].0.series.as_deref().is_none_or(|s| s.trim().is_empty()));
            if !loose && series.len() < 2 {
                continue;
            }
            out.push(self.alike_group(&rows, &stems, members, keys));
        }
        out.sort_by(|a, b| b.books.len().cmp(&a.books.len()).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
        Ok(out)
    }

    fn alike_group(
        &self,
        rows: &[(BookPreview, Option<String>, Option<String>)],
        stems: &[String],
        members: Vec<usize>,
        keys: Vec<String>,
    ) -> AlikeGroup {
        // The name: the series most of the books are in, or the words the titles share.
        let mut counts: HashMap<&str, usize> = HashMap::new();
        for &i in &members {
            if let Some(s) = rows[i].0.series.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
                *counts.entry(s).or_default() += 1;
            }
        }
        let name = match counts.into_iter().max_by(|a, b| a.1.cmp(&b.1).then_with(|| b.0.cmp(a.0))) {
            Some((series, _)) => series.to_string(),
            None => {
                let loose: Vec<String> = members.iter().map(|&i| stems[i].clone()).collect();
                let shared = shared_start(&loose);
                title_case(if shared.is_empty() { &loose[0] } else { &shared })
            }
        };
        let author = rows[members[0]].0.authors.first().cloned().unwrap_or_default();
        let mut seen: HashMap<(String, Option<u64>), String> = HashMap::new();
        let books = members
            .iter()
            .map(|&i| {
                let book = &rows[i].0;
                let number = title_number(&book.title);
                let guess = number.tagged.or(number.main);
                let same_as = match seen.get(&(title_key(&book.title), guess)) {
                    Some(id) => Some(id.clone()),
                    None => {
                        seen.insert((title_key(&book.title), guess), book.id.to_string());
                        None
                    }
                };
                AlikeBook { book: book.clone(), guess: guess.map(|n| n as f64), same_as, paired_audio: rows[i].1.clone() }
            })
            .collect();
        AlikeGroup { keys, name, author, books }
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

        let groups = library.find_alike(ItemKind::Books).unwrap();
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
        let groups = library.find_alike(ItemKind::Books).unwrap();
        assert!(groups[0].books.iter().all(|b| b.book.id != two));
        library.reset_details(&two, false).unwrap();
        assert!(library.kept_out_of_alike(&two).unwrap(), "resetting details keeps it out");
        let out: Vec<String> = library.kept_out_books(ItemKind::Books).unwrap().into_iter().map(|b| b.id.to_string()).collect();
        assert_eq!(out, std::slice::from_ref(&two));
        library.include_in_alike(&two).unwrap();
        assert_eq!(library.find_alike(ItemKind::Books).unwrap()[0].books.len(), 4);

        // All in one series: nothing left to do, so no group.
        library.conn.execute("UPDATE books SET series = 'Dark City Girls' WHERE id IN (?1, ?2)", params![one, two]).unwrap();
        assert!(library.find_alike(ItemKind::Books).unwrap().is_empty());
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

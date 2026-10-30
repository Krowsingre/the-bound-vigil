//! Looking for passages of a book being written that also appear, word for
//! word, in the books of the library on this device. Each run of eight words
//! in the writing is matched against every run of eight in a library book;
//! where runs meet end to end, the passage they make is reported, from twelve
//! words up. Everything happens here: nothing leaves the device.

use std::collections::{HashMap, HashSet};
use std::hash::{DefaultHasher, Hash, Hasher};
use std::io::Read;
use std::path::Path;

use rusqlite::params;
use serde::{Deserialize, Serialize};
use unicode_normalization::UnicodeNormalization;

use crate::error::{Error, Result};
use crate::library::Library;

/// Words in each run that's matched.
const RUN: usize = 8;
/// The shortest passage worth reporting; shorter ones are common phrases.
pub const SHORTEST: usize = 12;
/// Passages kept for each book.
const MOST_PASSAGES: usize = 25;
/// Formats whose words can be read.
const READABLE: &[&str] = &["epub", "kepub", "txt", "md", "fb2", "docx", "html", "htm"];

/// One part of the writing (a chapter), as plain text.
#[derive(Debug, Clone, Deserialize)]
pub struct Section {
    pub title: String,
    pub text: String,
}

/// A library book to look through.
#[derive(Debug, Clone)]
pub struct CheckBook {
    pub id: String,
    pub title: String,
    pub author: Option<String>,
    pub format: String,
    pub path: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Passage {
    /// Which section of the writing, by its place in the list sent.
    pub section: usize,
    pub words: usize,
    /// The passage as written.
    pub text: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyMatch {
    pub book_id: String,
    pub title: String,
    pub author: Option<String>,
    /// Words of the writing found in this book, all passages together.
    pub words: usize,
    pub passages: Vec<Passage>,
}

/// A word: its plain form for matching, and where it sits in its section's text.
struct Word {
    key: String,
    start: usize,
    end: usize,
}

/// Words as they're matched: lower case, accents and apostrophes gone, so
/// "Don’t" and "dont" agree and punctuation never splits a match.
fn words(text: &str) -> Vec<Word> {
    let mut out = Vec::new();
    let mut key = String::new();
    let mut start = 0;
    let mut end = 0;
    for (at, c) in text.char_indices() {
        if c.is_alphanumeric() {
            if key.is_empty() {
                start = at;
            }
            key.extend(c.to_lowercase().collect::<String>().nfkd().filter(|c| c.is_alphanumeric()));
            end = at + c.len_utf8();
        } else if matches!(c, '\'' | '’' | '‘') && !key.is_empty() {
            continue;
        } else if !key.is_empty() {
            out.push(Word { key: std::mem::take(&mut key), start, end });
        }
    }
    if !key.is_empty() {
        out.push(Word { key, start, end });
    }
    out
}

fn run_hash<'a>(keys: impl Iterator<Item = &'a str>) -> u64 {
    let mut hasher = DefaultHasher::new();
    for k in keys {
        k.hash(&mut hasher);
    }
    hasher.finish()
}

/// The writing, ready to be looked for.
pub struct Writing {
    sections: Vec<(String, Vec<Word>)>,
    /// Each run's hash, and where it starts: (section, word).
    runs: HashMap<u64, Vec<(usize, usize)>>,
}

impl Writing {
    pub fn new(sections: Vec<Section>) -> Self {
        let mut runs: HashMap<u64, Vec<(usize, usize)>> = HashMap::new();
        let sections: Vec<(String, Vec<Word>)> = sections.into_iter().map(|s| {
            let w = words(&s.text);
            (s.text, w)
        }).collect();
        for (si, (_, w)) in sections.iter().enumerate() {
            for start in 0..w.len().saturating_sub(RUN - 1) {
                runs.entry(run_hash(w[start..start + RUN].iter().map(|x| x.key.as_str()))).or_default().push((si, start));
            }
        }
        Writing { sections, runs }
    }

    pub fn is_empty(&self) -> bool {
        self.runs.is_empty()
    }

    /// The passages of the writing that are also in `text`.
    pub fn find_in(&self, text: &str) -> Vec<Passage> {
        let found = words(text);
        let mut hit: HashSet<(usize, usize)> = HashSet::new();
        for start in 0..found.len().saturating_sub(RUN - 1) {
            if let Some(places) = self.runs.get(&run_hash(found[start..start + RUN].iter().map(|x| x.key.as_str()))) {
                hit.extend(places.iter().copied());
            }
        }
        let mut passages = Vec::new();
        for (si, (source, w)) in self.sections.iter().enumerate() {
            let mut covered = vec![false; w.len()];
            for &(_, start) in hit.iter().filter(|(s, _)| *s == si) {
                covered[start..start + RUN].iter_mut().for_each(|c| *c = true);
            }
            let mut at = 0;
            while at < covered.len() {
                if !covered[at] {
                    at += 1;
                    continue;
                }
                let from = at;
                while at < covered.len() && covered[at] {
                    at += 1;
                }
                let count = at - from;
                if count >= SHORTEST {
                    passages.push(Passage { section: si, words: count, text: source[w[from].start..w[at - 1].end].to_string() });
                }
            }
        }
        passages
    }
}

/// Markup taken out, the commonest character names put back.
fn strip_markup(xml: &str) -> String {
    let mut out = String::with_capacity(xml.len() / 2);
    let mut rest = xml;
    while let Some(open) = rest.find('<') {
        out.push_str(&rest[..open]);
        let after = &rest[open..];
        let lower = after.get(..8).unwrap_or(after).to_ascii_lowercase();
        let skip_to = if lower.starts_with("<script") {
            after.to_ascii_lowercase().find("</script>").map(|i| i + 9)
        } else if lower.starts_with("<style") {
            after.to_ascii_lowercase().find("</style>").map(|i| i + 8)
        } else {
            after.find('>').map(|i| i + 1)
        };
        out.push(' ');
        rest = match skip_to {
            Some(i) => &after[i..],
            None => "",
        };
    }
    out.push_str(rest);
    entities(&out)
}

fn entities(text: &str) -> String {
    if !text.contains('&') {
        return text.to_string();
    }
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(amp) = rest.find('&') {
        out.push_str(&rest[..amp]);
        let after = &rest[amp + 1..];
        let Some(semi) = after.find(';').filter(|&i| i <= 10) else {
            out.push('&');
            rest = after;
            continue;
        };
        let name = &after[..semi];
        let c = match name {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" | "rsquo" | "lsquo" => Some('’'),
            "nbsp" => Some(' '),
            "mdash" => Some('—'),
            "ndash" => Some('–'),
            "hellip" => Some('…'),
            "ldquo" | "rdquo" => Some('"'),
            _ if name.starts_with("#x") || name.starts_with("#X") => u32::from_str_radix(&name[2..], 16).ok().and_then(char::from_u32),
            _ if name.starts_with('#') => name[1..].parse().ok().and_then(char::from_u32),
            _ => Some(' '),
        };
        out.push(c.unwrap_or(' '));
        rest = &after[semi + 1..];
    }
    out.push_str(rest);
    out
}

/// A library book's words, from its file.
pub fn book_text(path: &Path, format: &str) -> Result<String> {
    let zipped = |e: zip::result::ZipError| Error::BadBook(e.to_string());
    match format {
        "epub" | "kepub" | "docx" => {
            let mut archive = zip::ZipArchive::new(std::fs::File::open(path)?).map_err(zipped)?;
            let mut names: Vec<String> = archive
                .file_names()
                .filter(|n| {
                    let n = n.to_ascii_lowercase();
                    if format == "docx" {
                        n == "word/document.xml"
                    } else {
                        n.ends_with(".xhtml") || n.ends_with(".html") || n.ends_with(".htm")
                    }
                })
                .map(str::to_string)
                .collect();
            names.sort_by(|a, b| crate::formats::natural_cmp(a, b));
            let mut text = String::new();
            for name in names {
                let mut xml = String::new();
                if archive.by_name(&name).map_err(zipped)?.read_to_string(&mut xml).is_ok() {
                    // Word keeps each paragraph in <w:p>; a break there keeps paragraphs apart.
                    let xml = if format == "docx" { xml.replace("</w:p>", "</w:p>\n") } else { xml };
                    text.push_str(&strip_markup(&xml));
                    text.push('\n');
                }
            }
            Ok(text)
        }
        "fb2" | "html" | "htm" => Ok(strip_markup(&String::from_utf8_lossy(&std::fs::read(path)?))),
        "txt" | "md" => Ok(String::from_utf8_lossy(&std::fs::read(path)?).into_owned()),
        other => Err(Error::Unsuitable(format!("{other} books can't be read for words"))),
    }
}

impl Library {
    /// The books on this device whose words can be read, leaving out copies of the book being checked.
    pub fn copy_check_books(&self, leave_out_title: &str) -> Result<Vec<CheckBook>> {
        let formats = READABLE.iter().map(|f| format!("'{f}'")).collect::<Vec<_>>().join(",");
        let mut statement = self.conn.prepare(&format!(
            "SELECT b.id, COALESCE((SELECT value FROM metadata_overrides o WHERE o.book_id = b.id AND o.field = 'title'), b.title),
                    json_extract(b.authors, '$[0]'), lower(b.format), lf.path
             FROM books b JOIN local_files lf ON lf.book_id = b.id
             WHERE b.deleted_at IS NULL AND lf.path != '' AND lower(b.format) IN ({formats})"
        ))?;
        let leave_out = leave_out_title.trim().to_lowercase();
        let rows = statement.query_map(params![], |r| {
            Ok(CheckBook { id: r.get(0)?, title: r.get::<_, Option<String>>(1)?.unwrap_or_default(), author: r.get(2)?, format: r.get(3)?, path: r.get(4)? })
        })?;
        let mut books = Vec::new();
        for book in rows {
            let book = book?;
            if leave_out.is_empty() || book.title.trim().to_lowercase() != leave_out {
                books.push(book);
            }
        }
        Ok(books)
    }
}

/// Looks through one book, answering with what it shares with the writing (if anything).
pub fn check_book(writing: &Writing, book: &CheckBook) -> Option<CopyMatch> {
    let text = book_text(Path::new(&book.path), &book.format).ok()?;
    let mut passages = writing.find_in(&text);
    if passages.is_empty() {
        return None;
    }
    let words = passages.iter().map(|p| p.words).sum();
    passages.sort_by_key(|p| std::cmp::Reverse(p.words));
    passages.truncate(MOST_PASSAGES);
    passages.sort_by_key(|p| p.section);
    Some(CopyMatch { book_id: book.id.clone(), title: book.title.clone(), author: book.author.clone(), words, passages })
}

#[cfg(test)]
mod tests {
    use super::*;

    const WRITTEN: &str = "The rain came down on the ash road the night Wren reached the gate, and the guard did not look up from his fire.";

    fn writing() -> Writing {
        Writing::new(vec![Section { title: "One".into(), text: WRITTEN.into() }])
    }

    #[test]
    fn finds_a_passage_whatever_the_punctuation_and_case() {
        let book = "Chapter 3. THE RAIN CAME DOWN ON THE ASH ROAD — the night wren reached the gate; and the guard didn’t move.";
        let found = writing().find_in(book);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].section, 0);
        assert!(found[0].text.starts_with("The rain came down"));
        assert!(found[0].text.ends_with("and the guard"));
        assert_eq!(found[0].words, 17);
    }

    #[test]
    fn short_common_phrases_are_left_alone() {
        // Nine words in common: one run of eight, but under the shortest passage worth reporting.
        assert!(writing().find_in("Somewhere the ash road the night Wren reached the gate was quiet.").is_empty());
        assert!(writing().find_in("Something else entirely, with no words in common at all.").is_empty());
    }

    #[test]
    fn reads_words_from_markup() {
        assert_eq!(strip_markup("<p>Don&rsquo;t <i>go</i>&#160;now</p><style>p{}</style>end").split_whitespace().collect::<Vec<_>>(), ["Don’t", "go", "now", "end"]);
        let keys: Vec<String> = words("Don’t stop—café").into_iter().map(|w| w.key).collect();
        assert_eq!(keys, ["dont", "stop", "cafe"]);
    }
}

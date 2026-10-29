//! Lining up an ebook with its audiobook, word by word, on whichever devices
//! have both. The audiobook is heard a piece at a time (half a minute, each
//! overlapping the next by a few seconds so no word falls between them), the
//! words heard are matched to the book's, and each piece is saved as soon as
//! it's done. A piece syncs on its own, so the work can stop at any moment
//! and carry on later, here or on another device, without starting over.
//! A computer works forward from the start and a phone back from the end,
//! so with both at it they meet in the middle.
//!
//! What's kept for a pair:
//! - read_along.timing: a [`LineUp`], the plan and how it ended;
//! - read_along_pieces: one row per piece, its [ms, word] anchors.
//!
//! The reader (src/readAlong/lineUp.ts) puts the pieces together to follow
//! the narrator, so the shapes here match what it reads.

use std::collections::{BTreeMap, HashMap};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use unicode_normalization::UnicodeNormalization;

use crate::error::{Error, Result};
use crate::library::Library;

/// Each piece of the audiobook heard: Whisper hears half a minute at a time.
pub const PIECE_MS: u64 = 30_000;
/// How much each piece overlaps the next, so a word cut at the edge is heard whole in one of them.
pub const OVERLAP_MS: u64 = 3_000;
const STEP_MS: u64 = PIECE_MS - OVERLAP_MS;
/// How often the device doing the work says so, for the others.
const CLAIM_EVERY_MS: u64 = 5 * 60_000;
/// A finished line-up needs this many matched words, reaching across this share of the book.
const ENOUGH_WORDS: usize = 50;
const ENOUGH_REACH: f64 = 0.5;

/// What's kept in read_along.timing for a pair.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LineUp {
    pub version: u32,
    /// Words in each section of the ebook, as the reader counts them.
    pub sections: Vec<u64>,
    pub duration_ms: u64,
    pub piece_ms: u64,
    pub overlap_ms: u64,
    /// How many pieces the audiobook makes.
    pub pieces: u64,
    /// Every piece is lined up and the result checked.
    pub done: bool,
    /// Why it couldn't be lined up (different editions, say), once that's known.
    pub failed: Option<String>,
    /// The device working on it lately.
    pub worker: Option<Worker>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Worker {
    pub device: String,
    pub computer: bool,
    pub at: String,
}

impl LineUp {
    /// A line-up this version understands, or None (timing from before is lined up again).
    pub fn read(json: Option<&str>) -> Option<LineUp> {
        let l: LineUp = serde_json::from_str(json?).ok()?;
        (l.version == 2 && l.pieces > 0).then_some(l)
    }
}

/// How many pieces an audiobook of `duration_ms` makes.
pub fn piece_count(duration_ms: u64) -> u64 {
    duration_ms.saturating_sub(OVERLAP_MS).div_ceil(STEP_MS).max(1)
}

/// Where piece `i` starts in the audiobook, and the stretch whose anchors it
/// keeps (the overlap is shared out between neighbours).
pub fn piece_span(i: u64, pieces: u64) -> (u64, i64, i64) {
    let start = i * STEP_MS;
    let keep_from = if i == 0 { i64::MIN } else { (start + OVERLAP_MS / 2) as i64 };
    let keep_to = if i + 1 == pieces { i64::MAX } else { (start + STEP_MS + OVERLAP_MS / 2) as i64 };
    (start, keep_from, keep_to)
}

// ---- Words ----

/// Lower case, apostrophes and accents dropped: "Don’t" and "dont" match.
pub fn word_key(word: &str) -> String {
    word.to_lowercase()
        .nfkd()
        .filter(|c| !('\u{300}'..='\u{36f}').contains(c) && *c != '\'' && *c != '’')
        .collect()
}

/// The words of some text, as keys, each with the character where it starts.
pub fn words_in(text: &str) -> Vec<(String, usize)> {
    let chars: Vec<char> = text.chars().collect();
    let mut out = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        if !chars[i].is_alphanumeric() {
            i += 1;
            continue;
        }
        let start = i;
        loop {
            while i < chars.len() && chars[i].is_alphanumeric() {
                i += 1;
            }
            // "don't": an apostrophe between letters stays inside the word.
            if i + 1 < chars.len() && (chars[i] == '\'' || chars[i] == '’') && chars[i + 1].is_alphanumeric() {
                i += 1;
                continue;
            }
            break;
        }
        out.push((word_key(&chars[start..i].iter().collect::<String>()), start));
    }
    out
}

/// What was heard in one piece: the book's word numbers for its words (or
/// `NOT_IN_BOOK`), and when each was said, in ms into the audiobook.
#[derive(Debug, Default, Clone)]
pub struct Heard {
    pub words: Vec<u32>,
    pub times: Vec<i64>,
}

const NOT_IN_BOOK: u32 = u32::MAX;

/// The book's words, numbered so they compare quickly, and where each run of
/// three words appears, for finding what was heard.
pub struct BookIndex {
    pub words: Vec<u32>,
    names: HashMap<String, u32>,
    runs: HashMap<(u32, u32, u32), Vec<usize>>,
}

impl BookIndex {
    pub fn new(words: &[String]) -> BookIndex {
        let mut names: HashMap<String, u32> = HashMap::new();
        let words: Vec<u32> = words
            .iter()
            .map(|w| {
                let next = names.len() as u32;
                *names.entry(w.clone()).or_insert(next)
            })
            .collect();
        let mut runs: HashMap<(u32, u32, u32), Vec<usize>> = HashMap::new();
        for i in 0..words.len().saturating_sub(2) {
            let at = runs.entry((words[i], words[i + 1], words[i + 2])).or_default();
            // A run that's everywhere ("said the man") tells nothing.
            if at.len() < 50 {
                at.push(i);
            }
        }
        BookIndex { words, names, runs }
    }

    /// What was heard, as the book's word numbers. `heard` is each word as
    /// text with when it was said, in ms into the audiobook.
    pub fn heard(&self, heard: &[(String, i64)]) -> Heard {
        let mut out = Heard::default();
        for (text, ms) in heard {
            for (word, _) in words_in(text) {
                out.words.push(*self.names.get(&word).unwrap_or(&NOT_IN_BOOK));
                out.times.push(*ms);
            }
        }
        out
    }

    /// Anchors for one piece: roughly where its words are in the book. Words
    /// can be misheard, skipped or added, so matches vote on where the piece
    /// is, and only those agreeing with the winner count. Places after
    /// `after` are preferred, then those nearest `expected`.
    pub fn find(&self, heard: &Heard, after: i64, expected: f64) -> Vec<(i64, i64)> {
        let mut hits: Vec<(usize, usize)> = Vec::new();
        for k in 0..heard.words.len().saturating_sub(2) {
            if let Some(at) = self.runs.get(&(heard.words[k], heard.words[k + 1], heard.words[k + 2])) {
                hits.extend(at.iter().map(|&p| (k, p)));
            }
        }
        if hits.is_empty() {
            return Vec::new();
        }
        // Votes by where the piece would start in the book, give or take a few words.
        const SLACK: i64 = 12;
        let bucket_of = |k: usize, p: usize| (p as i64 - k as i64).div_euclid(SLACK);
        let mut votes: HashMap<i64, usize> = HashMap::new();
        for &(k, p) in &hits {
            *votes.entry(bucket_of(k, p)).or_default() += 1;
        }
        let mut best: Option<(i64, usize, f64)> = None;
        for (&bucket, &count) in &votes {
            let score = count + votes.get(&(bucket - 1)).unwrap_or(&0) + votes.get(&(bucket + 1)).unwrap_or(&0);
            let start = bucket * SLACK;
            if start + (heard.words.len() as i64) < after {
                continue;
            }
            let distance = (start as f64 - expected).abs();
            if best.is_none_or(|(_, s, d)| score > s || (score == s && distance < d)) {
                best = Some((bucket, score, distance));
            }
        }
        // One run of three alone could be chance.
        let Some((bucket, score, _)) = best else { return Vec::new() };
        if score < 2 {
            return Vec::new();
        }
        let (lo, hi) = ((bucket - 1) * SLACK, (bucket + 2) * SLACK);
        let anchors = hits
            .iter()
            .filter(|&&(k, p)| {
                let s = p as i64 - k as i64;
                s >= lo && s < hi && p as i64 > after
            })
            .map(|&(k, p)| (heard.times[k], p as i64))
            .collect::<Vec<_>>();
        rising(anchors)
    }
}

/// The longest run of anchors rising in both time and word, so stray matches drop out.
pub fn rising(mut anchors: Vec<(i64, i64)>) -> Vec<(i64, i64)> {
    anchors.sort();
    // Patience sorting on the word, keeping the time strictly rising too.
    let mut tails: Vec<usize> = Vec::new();
    let mut before = vec![usize::MAX; anchors.len()];
    for i in 0..anchors.len() {
        let (mut lo, mut hi) = (0, tails.len());
        while lo < hi {
            let mid = (lo + hi) / 2;
            let t = anchors[tails[mid]];
            if t.1 < anchors[i].1 && t.0 < anchors[i].0 {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }
        before[i] = if lo > 0 { tails[lo - 1] } else { usize::MAX };
        if lo == tails.len() {
            tails.push(i);
        } else {
            tails[lo] = i;
        }
    }
    let mut out = Vec::new();
    let mut i = tails.last().copied().unwrap_or(usize::MAX);
    while i != usize::MAX {
        out.push(anchors[i]);
        i = before[i];
    }
    out.reverse();
    out
}

const MATCH: i32 = 3;
const MISS: i32 = -1;
const GAP: i32 = -1;

/// Lines up `heard` with the book's words between `from` and `to` one to one,
/// allowing for words misheard, missed or added (the book's words before and
/// after the match are free, since the piece is somewhere in the middle).
/// Returns [heard word, book word] for each word that matches.
pub fn match_words(heard: &[u32], words: &[u32], from: i64, to: i64) -> Vec<(usize, usize)> {
    let start = from.max(0) as usize;
    let end = (to.max(0) as usize).min(words.len());
    if start >= end || heard.is_empty() {
        return Vec::new();
    }
    let book = &words[start..end];
    let (n, m) = (heard.len(), book.len());
    let width = m + 1;
    let mut score = vec![0i32; (n + 1) * width];
    // 0 diagonal, 1 skip a heard word, 2 skip a book word.
    let mut step = vec![0u8; (n + 1) * width];
    for i in 1..=n {
        score[i * width] = i as i32 * GAP;
        step[i * width] = 1;
    }
    // Book words before the piece cost nothing (row 0 stays 0).
    for s in step.iter_mut().take(m + 1).skip(1) {
        *s = 2;
    }
    for i in 1..=n {
        let (row, up) = (i * width, (i - 1) * width);
        for j in 1..=m {
            let diagonal = score[up + j - 1] + if heard[i - 1] == book[j - 1] { MATCH } else { MISS };
            let skip_heard = score[up + j] + GAP;
            let skip_book = score[row + j - 1] + GAP;
            let (best, how) = if diagonal >= skip_heard && diagonal >= skip_book {
                (diagonal, 0)
            } else if skip_heard >= skip_book {
                (skip_heard, 1)
            } else {
                (skip_book, 2)
            };
            score[row + j] = best;
            step[row + j] = how;
        }
    }
    // Book words after the piece cost nothing either: end wherever scores best.
    let mut j = 0;
    for k in 1..=m {
        if score[n * width + k] > score[n * width + j] {
            j = k;
        }
    }
    let mut pairs = Vec::new();
    let mut i = n;
    while i > 0 && j > 0 {
        match step[i * width + j] {
            0 => {
                if heard[i - 1] == book[j - 1] {
                    pairs.push((i - 1, start + j - 1));
                }
                i -= 1;
                j -= 1;
            }
            1 => i -= 1,
            _ => j -= 1,
        }
    }
    pairs.reverse();
    // A lone match among misses is likely chance ("the" against "the"): kept
    // only beside another match.
    let near = |a: (usize, usize), b: (usize, usize)| a.0.abs_diff(b.0) <= 2 && a.1.abs_diff(b.1) <= 3;
    (0..pairs.len())
        .filter(|&k| (k > 0 && near(pairs[k], pairs[k - 1])) || (k + 1 < pairs.len() && near(pairs[k], pairs[k + 1])))
        .map(|k| pairs[k])
        .collect()
}

/// Anchors for one piece: [ms into the audiobook, word of the book] for each
/// word heard that's found in the book. `after` is the last book word placed
/// before this piece (or None when none is known yet) and `expected` where
/// the narrator should be by now, judged by the pace.
pub fn align_piece(heard: &Heard, index: &BookIndex, after: Option<i64>, expected: f64) -> Vec<(i64, i64)> {
    if heard.words.len() < 3 {
        return Vec::new();
    }
    let rough = index.find(heard, after.map_or(0, |a| a - 200), expected);
    let from = match (rough.first(), after) {
        (Some(&(_, w)), _) => w - 40,
        (None, Some(a)) => a - 20,
        // Not found anywhere (the publisher's credits, say): nothing to line up.
        (None, None) => return Vec::new(),
    };
    let to = from + (heard.words.len() as f64 * 1.6).ceil() as i64 + 120;
    let pairs = match_words(&heard.words, &index.words, from, to);
    // Too few matches for what was heard: not this part of the book after all.
    if (pairs.len() as f64) < (heard.words.len() as f64 * 0.25).max(3.0) {
        return Vec::new();
    }
    rising(pairs.into_iter().map(|(h, w)| (heard.times[h], w as i64)).collect())
}

/// Every piece's anchors put together, rising.
fn combined(pieces: &BTreeMap<u64, Vec<(i64, i64)>>) -> Vec<(i64, i64)> {
    rising(pieces.values().flatten().copied().collect())
}

// ---- The job ----

/// The ebook's words, as the reader counts them (worked out by the app's
/// reader, which opens the book the same way).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BookWords {
    pub sections: Vec<u64>,
    pub words: Vec<String>,
    pub language: Option<String>,
}

/// Turns half a minute of speech (16 kHz mono) into words, each with when
/// it was said in ms from the start of the samples.
pub trait Ear {
    fn hear(&mut self, samples: &[f32]) -> Result<Vec<(String, i64)>>;
}

/// How lining up a pair ended this time.
#[derive(Debug, Clone, PartialEq)]
pub enum Ended {
    Done,
    Failed(String),
    /// Asked to stop; the pieces done are kept.
    Stopped,
}

/// This device, as it signs the work it does.
pub struct Me {
    pub device: String,
    pub computer: bool,
}

/// Lines up one pair, carrying on from whatever pieces are already done
/// (here or on another device). `clip` reads a stretch of the audiobook as
/// 16 kHz mono samples; `progress` is told how many pieces of how many are done.
#[allow(clippy::too_many_arguments)]
pub fn line_up(
    library: &Mutex<Library>,
    ebook_id: &str,
    audiobook_id: &str,
    duration_ms: u64,
    book: &BookWords,
    ear: &mut dyn Ear,
    clip: &mut dyn FnMut(u64, u64) -> Result<Vec<f32>>,
    me: &Me,
    stop: &dyn Fn() -> bool,
    progress: &mut dyn FnMut(usize, u64),
) -> Result<Ended> {
    let lock = || library.lock().map_err(|_| Error::Unsuitable("The library is unavailable.".into()));
    let pieces = piece_count(duration_ms);
    let saved = lock()?.read_along_timing(ebook_id, audiobook_id)?;
    let mut lineup = LineUp::read(saved.as_deref());
    // Start afresh when nothing's planned yet, or the book or audiobook now reads differently.
    if lineup.as_ref().is_none_or(|l| l.sections != book.sections || l.duration_ms != duration_ms) {
        lock()?.clear_read_along_pieces(ebook_id, audiobook_id)?;
        lineup = None;
    }
    let mut lineup = lineup.unwrap_or(LineUp {
        version: 2,
        sections: book.sections.clone(),
        duration_ms,
        piece_ms: PIECE_MS,
        overlap_ms: OVERLAP_MS,
        pieces,
        done: false,
        failed: None,
        worker: None,
    });
    if lineup.done {
        return Ok(Ended::Done);
    }
    if let Some(why) = &lineup.failed {
        return Ok(Ended::Failed(why.clone()));
    }
    let save = |l: &LineUp| -> Result<()> { lock()?.save_read_along_timing(ebook_id, audiobook_id, &serde_json::to_string(l)?) };
    let fail = |l: &mut LineUp, why: &str| -> Result<Ended> {
        l.failed = Some(why.into());
        save(l)?;
        Ok(Ended::Failed(why.into()))
    };
    // The speech model only knows English.
    if book.language.as_deref().is_some_and(|l| !l.to_ascii_lowercase().starts_with("en")) {
        return fail(&mut lineup, "Lining up only works for books in English so far.");
    }
    if book.words.is_empty() {
        return fail(&mut lineup, "TBV couldn't find any words in this ebook to line up.");
    }
    let sign = |l: &mut LineUp| {
        l.worker = Some(Worker { device: me.device.clone(), computer: me.computer, at: crate::time::now_utc() });
    };
    sign(&mut lineup);
    save(&lineup)?;
    let mut claimed = std::time::Instant::now();

    let index = BookIndex::new(&book.words);
    let pace = book.words.len() as f64 / duration_ms.max(1) as f64;
    let mut done: BTreeMap<u64, Vec<(i64, i64)>> = BTreeMap::new();
    let read_pieces = |done: &mut BTreeMap<u64, Vec<(i64, i64)>>| -> Result<()> {
        for (i, json) in lock()?.read_along_pieces(ebook_id, audiobook_id)? {
            if let (Ok(i), Ok(anchors)) = (u64::try_from(i), serde_json::from_str::<Vec<(i64, i64)>>(&json)) {
                done.insert(i, anchors);
            }
        }
        Ok(())
    };
    read_pieces(&mut done)?;
    progress(done.len(), pieces);

    // A computer goes forward from the start, a phone back from the end.
    let order: Vec<u64> = if me.computer { (0..pieces).collect() } else { (0..pieces).rev().collect() };
    for i in order {
        if done.contains_key(&i) {
            continue;
        }
        if stop() {
            return Ok(Ended::Stopped);
        }
        // Another device may have done this piece meanwhile.
        read_pieces(&mut done)?;
        if done.contains_key(&i) {
            continue;
        }
        let (start, keep_from, keep_to) = piece_span(i, pieces);
        // Where the narrator should be: just past the last word placed
        // before this piece, or short of the first placed after it.
        let before = done.range(..i).rev().find_map(|(_, a)| a.last().copied());
        let after_it = done.range(i + 1..).find_map(|(_, a)| a.first().copied());
        let expected = match (before, after_it) {
            (Some((t, w)), _) => w as f64 + (start as i64 - t) as f64 * pace,
            (None, Some((t, w))) => w as f64 - (t - start as i64) as f64 * pace,
            (None, None) => start as f64 * pace,
        };
        let samples = clip(start, PIECE_MS)?;
        let mut anchors = Vec::new();
        if !samples.is_empty() {
            let heard: Vec<(String, i64)> = ear.hear(&samples)?.into_iter().map(|(w, ms)| (w, ms + start as i64)).collect();
            let heard = index.heard(&heard);
            anchors = align_piece(&heard, &index, before.map(|(_, w)| w), expected);
            anchors.retain(|&(t, _)| t >= keep_from && t < keep_to);
        }
        lock()?.save_read_along_piece(ebook_id, audiobook_id, i as i64, &serde_json::to_string(&anchors)?)?;
        done.insert(i, anchors);
        progress(done.len(), pieces);
        if claimed.elapsed().as_millis() as u64 > CLAIM_EVERY_MS {
            sign(&mut lineup);
            save(&lineup)?;
            claimed = std::time::Instant::now();
        }
    }

    // Every piece is here: check the whole before it's followed.
    let anchors = combined(&done);
    let reach = match (anchors.first(), anchors.last()) {
        (Some(a), Some(b)) => (b.1 - a.1) as f64 / book.words.len() as f64,
        _ => 0.0,
    };
    if anchors.len() < ENOUGH_WORDS || reach < ENOUGH_REACH {
        return fail(&mut lineup, "TBV couldn't line this audiobook up with the ebook. They may be different editions.");
    }
    lineup.done = true;
    lineup.failed = None;
    save(&lineup)?;
    Ok(Ended::Done)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Numbers that come out the same every run.
    struct Seeded(u32);
    impl Seeded {
        fn next(&mut self) -> f64 {
            self.0 = self.0.wrapping_mul(1664525).wrapping_add(1013904223);
            self.0 as f64 / 4294967296.0
        }
    }

    /// A made-up book: common words far more often than rare ones, as in real writing.
    fn make_book(length: usize, r: &mut Seeded) -> Vec<String> {
        let common: Vec<&str> = "the and a of to was he she it in that i you his her said with for on at as had but not".split(' ').collect();
        (0..length)
            .map(|_| {
                if r.next() < 0.45 {
                    common[(r.next() * common.len() as f64) as usize].to_string()
                } else {
                    let i = (r.next().powi(2) * 3000.0) as usize;
                    format!("w{i}{}", ["a", "e", "i", "o", "u"][i % 5])
                }
            })
            .collect()
    }

    #[test]
    fn words_are_keyed_the_way_the_reader_keys_them() {
        let words: Vec<String> = words_in("“Don’t,” said Zoë — it's 1984.").into_iter().map(|(w, _)| w).collect();
        assert_eq!(words, ["dont", "said", "zoe", "its", "1984"]);
    }

    #[test]
    fn matches_heard_words_one_by_one_around_mistakes() {
        let book: Vec<String> = "it was a dark and stormy night the rain fell in torrents except at occasional intervals".split(' ').map(String::from).collect();
        let index = BookIndex::new(&book);
        let heard = index.heard(&"a dark and stormy knight the rain fell fell in torrents".split(' ').map(|w| (w.to_string(), 0)).collect::<Vec<_>>());
        let placed: HashMap<usize, usize> = match_words(&heard.words, &index.words, 0, book.len() as i64).into_iter().collect();
        assert_eq!(placed.get(&0), Some(&2));
        assert_eq!(placed.get(&3), Some(&5));
        assert!(!placed.contains_key(&4));
        assert_eq!(placed.get(&10), Some(&11));
    }

    #[test]
    fn pieces_overlap_and_share_the_overlap_out() {
        assert_eq!(piece_count(PIECE_MS), 1);
        assert_eq!(piece_count(0), 1);
        let (a_start, _, a_to) = piece_span(0, 5);
        let (b_start, b_from, _) = piece_span(1, 5);
        assert!(b_start < a_start + PIECE_MS);
        assert_eq!(a_to, b_from);
        assert_eq!(piece_span(4, 5).2, i64::MAX);
    }

    /// Hears a made-up narrator: the words said in the clip, some misheard, missed or added.
    struct FakeEar {
        book: Vec<String>,
        said: Vec<u64>,
        /// Where the next clip starts, as `clip` was last asked.
        at: std::rc::Rc<std::cell::Cell<u64>>,
        r: Seeded,
    }
    impl Ear for FakeEar {
        fn hear(&mut self, _samples: &[f32]) -> Result<Vec<(String, i64)>> {
            let start = self.at.get();
            let mut out = Vec::new();
            for (w, &t) in self.said.iter().enumerate() {
                if t < start || t >= start + PIECE_MS {
                    continue;
                }
                let ms = (t - start) as i64;
                let r = self.r.next();
                if r < 0.06 {
                    out.push(("misheard".into(), ms));
                } else if r < 0.09 {
                } else if r < 0.12 {
                    out.push((self.book[w].clone(), ms));
                    out.push(("um".into(), ms + 100));
                } else {
                    out.push((self.book[w].clone(), ms));
                }
            }
            Ok(out)
        }
    }

    fn run(library: &Mutex<Library>, computer: bool, stop_after: Option<usize>, book: &[String], said: &[u64], duration: u64) -> Ended {
        let at = std::rc::Rc::new(std::cell::Cell::new(0));
        let mut ear = FakeEar { book: book.to_vec(), said: said.to_vec(), at: at.clone(), r: Seeded(if computer { 11 } else { 13 }) };
        let words = BookWords { sections: vec![book.len() as u64], words: book.to_vec(), language: Some("en".into()) };
        let mut clip = |start: u64, _len: u64| {
            at.set(start);
            Ok(vec![0.0; 16])
        };
        let heard = std::cell::Cell::new(0usize);
        let stop = || stop_after.is_some_and(|n| heard.get() >= n);
        let me = Me { device: if computer { "pc".into() } else { "phone".into() }, computer };
        line_up(library, "e1", "a1", duration, &words, &mut ear, &mut clip, &me, &stop, &mut |done, _| heard.set(done)).unwrap()
    }

    #[test]
    fn a_whole_book_is_followed_to_within_a_few_words_shared_between_devices() {
        let mut r = Seeded(7);
        let book = make_book(12_000, &mut r);
        let mut said = Vec::new();
        let mut t = 4_000u64;
        for w in 0..book.len() {
            said.push(t);
            t += 300 + (r.next() * 160.0) as u64 + if w % 40 == 39 { 700 } else { 0 };
        }
        let duration = t + 2_000;
        let (_dir, library) = crate::library::tests::open_temp_library();
        let library = Mutex::new(library);
        let pieces = piece_count(duration) as usize;
        // The phone does the end, the computer the rest.
        assert_eq!(run(&library, false, Some(pieces / 3), &book, &said, duration), Ended::Stopped);
        assert_eq!(run(&library, true, None, &book, &said, duration), Ended::Done);
        let l = library.lock().unwrap();
        let saved = LineUp::read(l.read_along_timing("e1", "a1").unwrap().as_deref()).unwrap();
        assert!(saved.done);
        let mut all = BTreeMap::new();
        for (i, json) in l.read_along_pieces("e1", "a1").unwrap() {
            all.insert(i as u64, serde_json::from_str::<Vec<(i64, i64)>>(&json).unwrap());
        }
        assert_eq!(all.len(), pieces);
        let anchors = combined(&all);
        assert!(anchors.len() > book.len() * 6 / 10, "{} anchors", anchors.len());
        // Every anchor puts its word close to when it was said.
        let mut misses: Vec<u64> = anchors
            .iter()
            .map(|&(t, w)| {
                let said_at = said.partition_point(|&s| (s as i64) <= t).saturating_sub(1);
                said_at.abs_diff(w as usize) as u64
            })
            .collect();
        misses.sort();
        assert!(misses[misses.len() / 2] <= 1);
        assert!(misses[misses.len() * 95 / 100] <= 4);
    }

    #[test]
    fn nothing_is_found_in_speech_that_isnt_in_the_book() {
        let mut r = Seeded(3);
        let index = BookIndex::new(&make_book(2_000, &mut r));
        let credits: Vec<(String, i64)> = "this audiobook was recorded in our studio and is published by sound books".split(' ').enumerate().map(|(i, w)| (w.to_string(), i as i64 * 400)).collect();
        assert!(align_piece(&index.heard(&credits), &index, None, 0.0).is_empty());
    }

    #[test]
    fn books_in_other_languages_are_not_lined_up() {
        let (_dir, library) = crate::library::tests::open_temp_library();
        let library = Mutex::new(library);
        let words = BookWords { sections: vec![1], words: vec!["hola".into()], language: Some("es".into()) };
        struct Deaf;
        impl Ear for Deaf {
            fn hear(&mut self, _: &[f32]) -> Result<Vec<(String, i64)>> {
                Ok(Vec::new())
            }
        }
        let me = Me { device: "pc".into(), computer: true };
        let ended = line_up(&library, "e", "a", 60_000, &words, &mut Deaf, &mut |_, _| Ok(Vec::new()), &me, &|| false, &mut |_, _| ()).unwrap();
        assert!(matches!(ended, Ended::Failed(_)));
    }
}

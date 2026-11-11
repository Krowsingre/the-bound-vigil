//! The reader's offline dictionary on Windows and Android: WordNet 3.1
//! (Princeton University; licence in assets/WORDNET-LICENSE), packed by
//! scripts/build-dictionary.mjs. iPhone, iPad and Mac use Apple's own
//! dictionary instead, so the words aren't carried there.

use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Definition {
    /// The dictionary's word for what was looked up ("ran" is found as "run").
    pub word: String,
    pub senses: Vec<Sense>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Sense {
    /// "noun", "verb", "adjective" or "adverb".
    pub part: &'static str,
    pub definition: String,
    pub example: Option<String>,
}

/// Senses shown for one word, at most; WordNet lists the common ones first.
const MOST: usize = 12;

#[cfg(not(any(target_os = "ios", target_os = "macos")))]
mod words {
    use std::collections::HashMap;
    use std::io::Read;
    use std::sync::OnceLock;

    static PACKED: &[u8] = include_bytes!("../assets/wordnet.txt.gz");

    pub(super) struct Words {
        text: String,
        /// Where each meaning's line starts and ends in `text`.
        meanings: Vec<(u32, u32)>,
        /// Each word's meanings, by number.
        words: HashMap<String, Vec<u32>>,
    }

    impl Words {
        pub(super) fn meaning(&self, id: u32) -> Option<&str> {
            let (start, end) = *self.meanings.get(id as usize)?;
            self.text.get(start as usize..end as usize)
        }
        pub(super) fn of(&self, word: &str) -> Option<&[u32]> {
            self.words.get(word).map(Vec::as_slice).filter(|ids| !ids.is_empty())
        }
    }

    /// Unpacked the first time a word is looked up, then kept.
    pub(super) fn get() -> Option<&'static Words> {
        static WORDS: OnceLock<Option<Words>> = OnceLock::new();
        WORDS.get_or_init(load).as_ref()
    }

    fn load() -> Option<Words> {
        let mut text = String::new();
        flate2::read::GzDecoder::new(PACKED).read_to_string(&mut text).ok()?;
        let split = text.find("\n\n")?;
        let mut meanings = Vec::with_capacity(120_000);
        let mut start = 0;
        for line in text[..split].split('\n') {
            meanings.push((start as u32, (start + line.len()) as u32));
            start += line.len() + 1;
        }
        let mut words = HashMap::with_capacity(150_000);
        for line in text[split + 2..].lines() {
            let Some((word, ids)) = line.split_once('\t') else { continue };
            let ids = ids.split(' ').filter_map(|id| u32::from_str_radix(id, 36).ok()).collect();
            words.insert(word.to_string(), ids);
        }
        Some(Words { text, meanings, words })
    }
}

/// What a word means, found without the internet: the word as selected,
/// and its dictionary form when that's another entry ("stopped", then
/// "stop"). Empty when neither is in the dictionary, and on Apple devices
/// (they use Apple's).
pub fn define(text: &str) -> Vec<Definition> {
    #[cfg(not(any(target_os = "ios", target_os = "macos")))]
    {
        let Some(words) = words::get() else { return Vec::new() };
        let mut found = Vec::new();
        for candidate in candidates(text) {
            let Some(ids) = words.of(&candidate) else { continue };
            let senses = ids.iter().filter_map(|&id| words.meaning(id)).filter_map(sense).take(MOST).collect::<Vec<_>>();
            if senses.is_empty() {
                continue;
            }
            found.push(Definition { word: candidate, senses });
            if found.len() == 2 {
                break;
            }
        }
        found
    }
    #[cfg(any(target_os = "ios", target_os = "macos"))]
    {
        let _ = text;
        Vec::new()
    }
}

fn sense(line: &str) -> Option<Sense> {
    let mut parts = line.splitn(3, '|');
    let part = match parts.next()? {
        "n" => "noun",
        "v" => "verb",
        "a" => "adjective",
        "r" => "adverb",
        _ => return None,
    };
    let definition = parts.next()?.trim().to_string();
    let example = parts.next().map(str::trim).filter(|e| !e.is_empty()).map(str::to_string);
    Some(Sense { part, definition, example })
}

/// Common words whose forms don't follow the endings below.
const IRREGULAR: &[(&str, &str)] = &[
    ("am", "be"), ("is", "be"), ("are", "be"), ("was", "be"), ("were", "be"), ("been", "be"),
    ("has", "have"), ("had", "have"), ("does", "do"), ("did", "do"), ("done", "do"),
    ("went", "go"), ("gone", "go"), ("came", "come"), ("ran", "run"), ("saw", "see"), ("seen", "see"),
    ("took", "take"), ("taken", "take"), ("gave", "give"), ("given", "give"), ("made", "make"),
    ("said", "say"), ("knew", "know"), ("known", "know"), ("thought", "think"), ("brought", "bring"),
    ("bought", "buy"), ("caught", "catch"), ("taught", "teach"), ("fought", "fight"), ("sought", "seek"),
    ("felt", "feel"), ("kept", "keep"), ("slept", "sleep"), ("left", "leave"), ("meant", "mean"),
    ("met", "meet"), ("sat", "sit"), ("stood", "stand"), ("understood", "understand"), ("told", "tell"),
    ("sold", "sell"), ("held", "hold"), ("found", "find"), ("won", "win"), ("began", "begin"),
    ("begun", "begin"), ("drank", "drink"), ("drunk", "drink"), ("sang", "sing"), ("sung", "sing"),
    ("swam", "swim"), ("rang", "ring"), ("wrote", "write"), ("written", "write"), ("rode", "ride"),
    ("ridden", "ride"), ("rose", "rise"), ("risen", "rise"), ("drove", "drive"), ("driven", "drive"),
    ("ate", "eat"), ("eaten", "eat"), ("fell", "fall"), ("fallen", "fall"), ("flew", "fly"),
    ("flown", "fly"), ("forgot", "forget"), ("forgotten", "forget"), ("froze", "freeze"),
    ("frozen", "freeze"), ("spoke", "speak"), ("spoken", "speak"), ("broke", "break"),
    ("broken", "break"), ("chose", "choose"), ("chosen", "choose"), ("woke", "wake"), ("woken", "wake"),
    ("wore", "wear"), ("worn", "wear"), ("tore", "tear"), ("torn", "tear"), ("bore", "bear"),
    ("borne", "bear"), ("hid", "hide"), ("hidden", "hide"), ("bit", "bite"), ("bitten", "bite"),
    ("shook", "shake"), ("shaken", "shake"), ("grew", "grow"), ("grown", "grow"), ("threw", "throw"),
    ("thrown", "throw"), ("blew", "blow"), ("drew", "draw"), ("drawn", "draw"), ("lay", "lie"),
    ("lain", "lie"), ("led", "lead"), ("fed", "feed"), ("fled", "flee"), ("bled", "bleed"),
    ("built", "build"), ("sent", "send"), ("spent", "spend"), ("lent", "lend"), ("bent", "bend"),
    ("lost", "lose"), ("paid", "pay"), ("laid", "lay"), ("heard", "hear"), ("struck", "strike"),
    ("stuck", "stick"), ("hung", "hang"), ("swung", "swing"), ("clung", "cling"), ("wept", "weep"),
    ("crept", "creep"), ("swept", "sweep"), ("dealt", "deal"), ("dreamt", "dream"), ("knelt", "kneel"),
    ("men", "man"), ("women", "woman"), ("children", "child"), ("feet", "foot"), ("teeth", "tooth"),
    ("geese", "goose"), ("mice", "mouse"), ("lice", "louse"), ("oxen", "ox"), ("people", "person"),
    ("better", "good"), ("best", "good"), ("worse", "bad"), ("worst", "bad"),
    ("further", "far"), ("farther", "far"), ("furthest", "far"), ("farthest", "far"),
];

/// Word endings and what to put back, as WordNet's own look-up does.
const ENDINGS: &[(&str, &str)] = &[
    ("ies", "y"), ("ses", "s"), ("xes", "x"), ("zes", "z"), ("ches", "ch"), ("shes", "sh"),
    ("men", "man"), ("es", "e"), ("es", ""), ("s", ""), ("ied", "y"), ("ed", "e"), ("ed", ""),
    ("ing", "e"), ("ing", ""), ("ier", "y"), ("iest", "y"), ("er", "e"), ("er", ""),
    ("est", "e"), ("est", ""), ("ly", ""), ("ily", "y"),
];

/// The word as selected, tidied, then the dictionary forms it could be.
fn candidates(text: &str) -> Vec<String> {
    let cleaned: String = text
        .trim()
        .replace(['\u{2019}', '\u{2018}'], "'")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let word = cleaned
        .trim_matches(|c: char| !c.is_alphanumeric() && c != '\'' && c != '-')
        .trim_matches('\'')
        .to_lowercase();
    let word = word.strip_suffix("'s").unwrap_or(&word).to_string();
    let mut out: Vec<String> = Vec::new();
    let mut push = |w: String| {
        if !w.is_empty() && !out.contains(&w) {
            out.push(w);
        }
    };
    push(word.clone());
    if let Some((_, base)) = IRREGULAR.iter().find(|(form, _)| *form == word) {
        push((*base).to_string());
    }
    for (ending, put_back) in ENDINGS {
        let Some(stem) = word.strip_suffix(ending) else { continue };
        if stem.chars().count() < 2 {
            continue;
        }
        push(format!("{stem}{put_back}"));
        // "running" → "runn" → "run", "stopped" → "stopp" → "stop".
        let mut chars = stem.chars().rev();
        if let (Some(a), Some(b)) = (chars.next(), chars.next()) {
            if a == b && put_back.is_empty() && !"aeiou".contains(a) {
                push(stem[..stem.len() - a.len_utf8()].to_string());
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_words_and_their_dictionary_forms() {
        let words = |text: &str| define(text).into_iter().map(|d| d.word).collect::<Vec<_>>();
        assert_eq!(words("Jumped,"), ["jump"]);
        assert!(define("jumped")[0].senses.iter().any(|s| s.part == "verb"));
        // A form that's a word of its own comes first, then its dictionary form.
        assert_eq!(words("stopped"), ["stopped", "stop"]);
        assert_eq!(words("running"), ["running", "run"]);
        assert_eq!(words("ran"), ["run"]);
        assert_eq!(words("Melancholy"), ["melancholy"]);
        assert_eq!(words("mice")[0], "mouse");
        assert_eq!(words("\u{201c}libraries\u{201d}"), ["library"]);
        assert_eq!(words("New York"), ["new york"]);
        let bank = &define("bank")[0];
        assert!(bank.senses.len() <= MOST);
        assert!(bank.senses[0].definition.contains("slope"), "{:?}", bank.senses[0]);
        assert!(define("zzqxv").is_empty());
        assert!(define("").is_empty());
    }

    #[test]
    fn examples_are_kept_apart_from_definitions() {
        let s = sense("v|move fast by using one's feet|Don't run--you'll be out of breath").unwrap();
        assert_eq!(s.part, "verb");
        assert_eq!(s.example.as_deref(), Some("Don't run--you'll be out of breath"));
        assert_eq!(sense("n|a thing|").unwrap().example, None);
    }
}

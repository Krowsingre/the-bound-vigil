//! Discover's shared block lists: the free public lists that uBlock Origin
//! and Brave also use, read by Brave's own blocking engine (adblock-rust).
//!
//! - EasyList (adverts) and EasyPrivacy (trackers), by the EasyList authors,
//!   https://easylist.to/, under GPLv3 / CC BY-SA 3.0.
//! - Malicious URL Blocklist (sites spreading malware, from abuse.ch's
//!   URLhaus), by curbengh, https://gitlab.com/malware-filter, under CC0 / MIT.
//!
//! Each is downloaded straight from where its authors publish it, at most
//! once a day, and kept on the device; nothing goes through TBV. Until a
//! list has come down at least once, TBV's own short list (protection.rs)
//! does the blocking on its own. Strict uses all three lists; Balanced
//! leaves out EasyList, so advertising loads.

use crate::protection::Level;
use adblock::lists::{FilterSet, ParseOptions};
use adblock::request::Request;
use adblock::Engine;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock, RwLock};
use std::time::{Duration, SystemTime};

/// One list: where it comes from, and which levels use it.
pub struct Source {
    pub id: &'static str,
    /// Its official address first, then its own published mirrors.
    pub urls: &'static [&'static str],
    /// Only Strict uses it (the advertising list).
    pub strict_only: bool,
}

pub const SOURCES: &[Source] = &[
    Source {
        id: "easylist",
        urls: &["https://easylist.to/easylist/easylist.txt", "https://raw.githubusercontent.com/easylist/easylist/gh-pages/easylist.txt"],
        strict_only: true,
    },
    Source {
        id: "easyprivacy",
        urls: &["https://easylist.to/easylist/easyprivacy.txt", "https://raw.githubusercontent.com/easylist/easylist/gh-pages/easyprivacy.txt"],
        strict_only: false,
    },
    Source {
        id: "malicious",
        urls: &[
            "https://malware-filter.gitlab.io/malware-filter/urlhaus-filter-online.txt",
            "https://curbengh.github.io/malware-filter/urlhaus-filter-online.txt",
            "https://malware-filter.pages.dev/urlhaus-filter-online.txt",
        ],
        strict_only: false,
    },
];

/// How old a list may get before it's fetched again.
const DAY: Duration = Duration::from_secs(24 * 60 * 60);
/// After a failed try (no connection), how long before trying again.
const RETRY: Duration = Duration::from_secs(60 * 60);
/// Apple's web view takes at most 150,000 rules in one list.
#[cfg_attr(not(mobile), allow(dead_code))]
const APPLE_MAX: usize = 149_000;

static DIR: OnceLock<PathBuf> = OnceLock::new();
/// The engine for each level, made from the lists on the device.
static ENGINES: RwLock<Engines> = RwLock::new(Engines { strict: None, balanced: None });
/// The level last asked for, so a fresh download rebuilds the one in use.
static WANTED: Mutex<Option<Level>> = Mutex::new(None);
/// Levels being built right now (only one build of each at a time).
static BUILDING: Mutex<Vec<Level>> = Mutex::new(Vec::new());

struct Engines {
    strict: Option<Arc<Engine>>,
    balanced: Option<Arc<Engine>>,
}

fn file(dir: &Path, id: &str) -> PathBuf {
    dir.join(format!("{id}.txt"))
}

/// Starts keeping the lists: the ones on the device are read now, and
/// fresh copies are fetched in the background once a day.
pub fn start(dir: PathBuf) {
    let _ = std::fs::create_dir_all(&dir);
    if DIR.set(dir).is_err() {
        return;
    }
    let _ = std::thread::Builder::new().name("block lists".into()).spawn(|| loop {
        let fetched = refresh();
        if fetched {
            if let Ok(mut engines) = ENGINES.write() {
                engines.strict = None;
                engines.balanced = None;
            }
            if let Some(level) = WANTED.lock().ok().and_then(|w| *w) {
                build(level);
            }
        }
        std::thread::sleep(RETRY);
    });
}

/// Fetches each list that is a day old (or missing). True when any changed.
fn refresh() -> bool {
    let Some(dir) = DIR.get() else { return false };
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(60)))
        .user_agent(concat!("The Bound Vigil/", env!("CARGO_PKG_VERSION")))
        .build()
        .into();
    let mut changed = false;
    for source in SOURCES {
        let path = file(dir, source.id);
        let fresh = std::fs::metadata(&path)
            .and_then(|m| m.modified())
            .ok()
            .and_then(|at| SystemTime::now().duration_since(at).ok())
            .is_some_and(|age| age < DAY);
        if fresh {
            continue;
        }
        for url in source.urls {
            let Ok(mut response) = agent.get(*url).call() else { continue };
            let Ok(text) = response.body_mut().with_config().limit(40 * 1024 * 1024).read_to_string() else { continue };
            if !looks_like_list(&text) {
                continue;
            }
            let part = path.with_extension("part");
            if std::fs::write(&part, &text).is_ok() && std::fs::rename(&part, &path).is_ok() {
                changed = true;
                break;
            }
        }
    }
    changed
}

/// A filter list, not an error page: mostly rules, and plenty of them.
fn looks_like_list(text: &str) -> bool {
    let start = text.trim_start();
    if start.starts_with('<') {
        return false;
    }
    text.lines().filter(|l| !l.trim().is_empty() && !l.starts_with('!')).take(100).count() >= 100
}

/// The lists a level uses, as their text (the ones on the device).
fn texts(level: Level) -> Vec<String> {
    let Some(dir) = DIR.get() else { return Vec::new() };
    SOURCES
        .iter()
        .filter(|s| level == Level::Strict || !s.strict_only)
        .filter_map(|s| std::fs::read_to_string(file(dir, s.id)).ok())
        .collect()
}

fn filter_set(level: Level, debug: bool) -> Option<FilterSet> {
    let lists = texts(level);
    if lists.is_empty() {
        return None;
    }
    let mut set = FilterSet::new(debug);
    for text in lists {
        set.add_filter_list(text, ParseOptions::default());
    }
    set.add_filter_list(crate::protection::own_rules(level).join("\n"), ParseOptions::default());
    Some(set)
}

/// Builds the level's engine in the background, if it isn't built already.
fn build(level: Level) {
    if level == Level::Off {
        return;
    }
    {
        let Ok(mut building) = BUILDING.lock() else { return };
        if building.contains(&level) {
            return;
        }
        building.push(level);
    }
    let _ = std::thread::Builder::new().name("block engine".into()).spawn(move || {
        if let Some(set) = filter_set(level, false) {
            let engine = Arc::new(Engine::new_with_filter_set(set));
            if let Ok(mut engines) = ENGINES.write() {
                match level {
                    Level::Strict => engines.strict = Some(engine),
                    Level::Balanced => engines.balanced = Some(engine),
                    Level::Off => {}
                }
            }
        }
        if let Ok(mut building) = BUILDING.lock() {
            building.retain(|l| *l != level);
        }
    });
}

/// The level now in use: its engine gets ready if it isn't.
pub fn want(level: Level) {
    if let Ok(mut wanted) = WANTED.lock() {
        *wanted = Some(level);
    }
    if engine(level).is_none() {
        build(level);
    }
}

/// The level's engine, once its lists are on the device and read.
pub fn engine(level: Level) -> Option<Arc<Engine>> {
    let engines = ENGINES.read().ok()?;
    match level {
        Level::Strict => engines.strict.clone(),
        Level::Balanced => engines.balanced.clone(),
        Level::Off => None,
    }
}

/// Whether a request is on the lists. None while the lists aren't ready
/// (TBV's own list answers then). `kind` is the request's type in the
/// lists' own words: document, subdocument, script, image, popup, …
pub fn blocks(level: Level, url: &str, page: &str, kind: &str) -> Option<bool> {
    let engine = engine(level)?;
    let request = Request::new(url, if page.is_empty() { url } else { page }, kind, "get").ok()?;
    Some(engine.check_network_request(&request).should_block())
}

/// What to hide on a page: its own rules (as CSS), and whether the lists'
/// general rules (by class and id) may apply to it, with their exceptions.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn page_hiding(level: Level, url: &str) -> Option<(String, bool, Vec<String>)> {
    let engine = engine(level)?;
    let found = engine.url_cosmetic_resources(url);
    let css = hide_css(found.hide_selectors.iter());
    Some((css, !found.generichide, found.exceptions.into_iter().collect()))
}

/// The general rules that hit any of a page's classes or ids, as CSS.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn general_hiding(level: Level, classes: &[String], ids: &[String], exceptions: &[String]) -> String {
    let Some(engine) = engine(level) else { return String::new() };
    let exceptions = exceptions.iter().cloned().collect();
    hide_css(engine.hidden_class_id_selectors(classes, ids, &exceptions).iter())
}

/// One rule per selector, so a selector the page's browser can't read
/// doesn't take the rest down with it.
fn hide_css<'a>(selectors: impl Iterator<Item = &'a String>) -> String {
    let mut css = String::new();
    for selector in selectors {
        if selector.contains('{') || selector.contains('}') {
            continue;
        }
        css.push_str(selector);
        css.push_str("{display:none!important}\n");
    }
    css
}

/// The level's lists as Apple's web view rules (WKContentRuleList JSON),
/// written to a file, with a name that changes whenever the lists do, so
/// iPhone only compiles them again after an update. None while no list is
/// on the device.
#[cfg_attr(not(mobile), allow(dead_code))]
pub fn apple_rules(level: Level, lowered: &[String], cookies: bool) -> Option<(String, PathBuf)> {
    let dir = DIR.get()?;
    // The name: the level, the lists' dates and the lowered sites.
    let mut stamp = format!("{level:?}");
    for source in SOURCES.iter().filter(|s| level == Level::Strict || !s.strict_only) {
        let at = std::fs::metadata(file(dir, source.id)).and_then(|m| m.modified()).ok()?;
        stamp.push_str(&format!("{}", at.duration_since(SystemTime::UNIX_EPOCH).ok()?.as_secs()));
    }
    stamp.push_str(&lowered.join(","));
    stamp.push_str(if cookies { "c" } else { "" });
    let id = format!("{:016x}", steady_hash(&stamp));
    let path = dir.join(format!("apple-{id}.json"));
    if path.exists() {
        return Some((id, path));
    }
    let (rules, _) = filter_set(level, true)?.into_content_blocking().ok()?;
    let mut rules: Vec<serde_json::Value> = rules.into_iter().filter_map(|r| serde_json::to_value(r).ok()).collect();
    if rules.len() > APPLE_MAX {
        // Too many for one list: page-hiding rules go first, blocking stays.
        rules.retain(|r| r["action"]["type"] != "css-display-none");
        rules.truncate(APPLE_MAX);
    }
    if cookies {
        rules.push(serde_json::json!({ "trigger": { "url-filter": ".*", "load-type": ["third-party"] }, "action": { "type": "block-cookies" } }));
    }
    // Sites whose protection was lowered load everything.
    if !lowered.is_empty() {
        let sites: Vec<String> = lowered.iter().map(|h| format!("*{}", h.trim_start_matches("www."))).collect();
        rules.push(serde_json::json!({ "trigger": { "url-filter": ".*", "if-domain": sites }, "action": { "type": "ignore-previous-rules" } }));
    }
    // Older versions aren't needed any more.
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with("apple-") && name.ends_with(".json") {
                let _ = std::fs::remove_file(entry.path());
            }
        }
    }
    std::fs::write(&path, serde_json::Value::Array(rules).to_string()).ok()?;
    Some((id, path))
}

/// A small, steady hash (the same on every run, unlike std's).
#[cfg_attr(not(mobile), allow(dead_code))]
fn steady_hash(text: &str) -> u64 {
    // FNV-1a: plenty for telling list versions apart.
    text.bytes().fold(0xcbf2_9ce4_8422_2325u64, |h, b| (h ^ b as u64).wrapping_mul(0x0100_0000_01b3))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_pages_are_not_lists() {
        assert!(!looks_like_list("<!doctype html><html>…"));
        assert!(!looks_like_list("! only a comment\n||a.com^\n"));
        let list: String = (0..150).map(|i| format!("||ads{i}.example^\n")).collect();
        assert!(looks_like_list(&format!("[Adblock Plus 2.0]\n! Title: test\n{list}")));
    }

    #[test]
    fn the_engine_reads_list_rules_and_tbvs_own() {
        let mut set = FilterSet::new(false);
        set.add_filter_list("||popunder.example^\n||ads.example^$third-party".into(), ParseOptions::default());
        set.add_filter_list(crate::protection::own_rules(Level::Strict).join("\n"), ParseOptions::default());
        let engine = Engine::new_with_filter_set(set);
        let check = |url: &str, page: &str, kind: &str| engine.check_network_request(&Request::new(url, page, kind, "get").unwrap()).should_block();
        assert!(check("https://popunder.example/x", "https://site.example/", "popup"));
        assert!(check("https://ads.example/a.js", "https://site.example/", "script"));
        assert!(!check("https://ads.example/a.js", "https://ads.example/", "script"));
        assert!(check("https://www.google-analytics.com/analytics.js", "https://site.example/", "script"));
        assert!(!check("https://site.example/app.js", "https://site.example/", "script"));
    }

    #[test]
    fn hiding_skips_selectors_that_would_break_out() {
        let css = hide_css(["#ad".to_string(), "a{}b".to_string()].iter());
        assert_eq!(css, "#ad{display:none!important}\n");
    }
}

//! OPDS catalogs: online bookshelves that e-readers can browse, like Project
//! Gutenberg, Standard Ebooks, or a Calibre library served from your own
//! computer. TBV reads both kinds (OPDS 1, Atom feeds; OPDS 2, JSON), lets
//! you browse and search them, and brings a book down into a folder of its
//! own for the import queue. The catalogs are saved on this device only,
//! passwords included, and kept out of backups, like servers.

use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

use md5::{Digest, Md5};
use quick_xml::events::{BytesStart, Event};
use quick_xml::Reader;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use url::Url;

use crate::error::{Error, Result};
use crate::ids::new_record_id;
use crate::library::{Library, SUPPORTED_FORMATS};

pub(crate) const SETTINGS_KEY: &str = "opds.catalogs";

/// What a feed page may weigh, and a book.
const MAX_FEED_BYTES: u64 = 16 * 1024 * 1024;
const MAX_BOOK_BYTES: u64 = 2 * 1024 * 1024 * 1024;

/// Offered the first time, and kept unless the person removes them.
const STARTERS: [(&str, &str, &str); 1] = [("gutenberg", "Project Gutenberg", "https://www.gutenberg.org/ebooks.opds/")];

/// Standard Ebooks came built in until 1.18. Its catalog is for paying
/// supporters only, so now it's offered under "Add a catalog" instead, and the
/// old built-in copy goes unless someone signed in to it.
const RETIRED_STARTER: &str = "standard-ebooks";

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
struct Saved {
    id: String,
    name: String,
    url: String,
    #[serde(default)]
    username: String,
    #[serde(default)]
    password: String,
    /// Empty for OPDS; "audiobookshelf" for an Audiobookshelf server.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    kind: String,
    /// An Audiobookshelf sign-in (never its password).
    #[serde(default, skip_serializing_if = "String::is_empty")]
    token: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    refresh: String,
}

/// What the Catalogs page shows: everything but the password.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogView {
    pub id: String,
    pub name: String,
    pub url: String,
    pub username: Option<String>,
    pub has_password: bool,
    /// "opds", or "audiobookshelf".
    pub kind: String,
}

/// What the page saves. No id adds a catalog; no password keeps the saved one.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogInput {
    pub id: Option<String>,
    pub name: String,
    pub url: String,
    pub username: Option<String>,
    pub password: Option<String>,
}

impl From<&Saved> for CatalogView {
    fn from(s: &Saved) -> Self {
        CatalogView {
            id: s.id.clone(),
            name: s.name.clone(),
            url: s.url.clone(),
            username: Some(s.username.clone()).filter(|u| !u.is_empty()),
            has_password: !s.password.is_empty() || !s.token.is_empty(),
            kind: if s.kind.is_empty() { "opds".into() } else { s.kind.clone() },
        }
    }
}

/// One page of a catalog.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpdsFeed {
    pub url: String,
    pub title: String,
    pub entries: Vec<OpdsEntry>,
    pub next: Option<String>,
    pub previous: Option<String>,
    /// A search address with `{searchTerms}` where the words go.
    pub search: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpdsEntry {
    pub id: String,
    pub title: String,
    pub authors: Vec<String>,
    pub summary: Option<String>,
    pub language: Option<String>,
    pub published: Option<String>,
    /// A picture of the cover (a small one when the catalog has it).
    pub cover: Option<String>,
    /// For a shelf or list rather than a book: the page it leads to.
    pub navigation: Option<String>,
    /// Files of the book, best first.
    pub files: Vec<OpdsFile>,
    /// Books that must be bought or borrowed, which TBV can't fetch.
    pub not_free: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpdsFile {
    pub url: String,
    pub mime: String,
    /// TBV's name for the format ("epub"), when it can open it.
    pub format: Option<String>,
    pub label: Option<String>,
}

/// TBV's format for a file type. EPUB first: what readers handle best.
fn format_of(mime: &str) -> Option<&'static str> {
    let mime = mime.split(';').next().unwrap_or("").trim().to_ascii_lowercase();
    Some(match mime.as_str() {
        "application/epub+zip" => "epub",
        "application/kepub+zip" => "kepub",
        "application/x-mobipocket-ebook" | "application/x-mobi8-ebook" => "mobi",
        "application/vnd.amazon.ebook" => "azw3",
        "application/pdf" => "pdf",
        "application/x-fictionbook+xml" | "text/fb2+xml" => "fb2",
        "application/vnd.comicbook+zip" | "application/x-cbz" => "cbz",
        "application/vnd.comicbook-rar" | "application/x-cbr" => "cbr",
        "text/plain" => "txt",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" => "docx",
        _ => return None,
    })
}

fn rank(format: Option<&str>) -> usize {
    ["epub", "kepub", "azw3", "mobi", "fb2", "pdf", "cbz", "cbr", "docx", "txt"]
        .iter()
        .position(|f| Some(*f) == format)
        .unwrap_or(usize::MAX)
}

fn is_acquisition(rel: &str) -> bool {
    rel.starts_with("http://opds-spec.org/acquisition")
}

fn is_open(rel: &str) -> bool {
    rel == "http://opds-spec.org/acquisition" || rel == "http://opds-spec.org/acquisition/open-access"
}

fn is_feed_type(mime: &str) -> bool {
    let mime = mime.to_ascii_lowercase();
    mime.contains("profile=opds-catalog") || mime.starts_with("application/atom+xml") || mime.starts_with("application/opds+json")
}

fn resolve(base: &Url, href: &str) -> Option<String> {
    base.join(href.trim()).ok().filter(|u| matches!(u.scheme(), "http" | "https")).map(String::from)
}

/// Text with any HTML taken out and its spaces tidied.
fn plain(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut in_tag = false;
    for c in text.chars() {
        match c {
            '<' => {
                in_tag = true;
                out.push(' ');
            }
            '>' if in_tag => in_tag = false,
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    let out = out.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&#39;", "'").replace("&nbsp;", " ");
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn attr(e: &BytesStart, name: &[u8]) -> Option<String> {
    e.attributes()
        .flatten()
        .find(|a| a.key.local_name().as_ref() == name)
        .and_then(|a| a.unescape_value().ok())
        .map(|v| v.into_owned())
}

/// How a feed says to search it.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum SearchLink {
    /// An address with `{searchTerms}` in it.
    Template(String),
    /// An OpenSearch description to read the address from.
    Description(String),
}

/// Reads an OPDS 1 (Atom) page. `search_link` comes back separately, since
/// it may need one more page fetched to become an address.
pub(crate) fn parse_atom(xml: &str, base: &Url) -> Result<(OpdsFeed, Option<SearchLink>)> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);
    let mut feed = OpdsFeed { url: base.to_string(), ..Default::default() };
    let mut search = None;
    let mut entry: Option<OpdsEntry> = None;
    // Elements open now, by local name.
    let mut path: Vec<String> = Vec::new();
    // Each open element's text so far, its children's included.
    let mut texts: Vec<String> = Vec::new();
    let mut saw_feed = false;
    let link = |e: &BytesStart, entry: &mut Option<OpdsEntry>, feed: &mut OpdsFeed, search: &mut Option<SearchLink>| {
        let rel = attr(e, b"rel").unwrap_or_default();
        let mime = attr(e, b"type").unwrap_or_default();
        let Some(href) = attr(e, b"href") else { return };
        match entry {
            Some(entry) => {
                if is_acquisition(&rel) {
                    if let Some(url) = resolve(base, &href) {
                        if is_open(&rel) {
                            let format = format_of(&mime).map(str::to_string);
                            entry.files.push(OpdsFile { url, mime, format, label: attr(e, b"title") });
                        } else {
                            entry.not_free = true;
                        }
                    }
                } else if rel == "http://opds-spec.org/image/thumbnail"
                    || rel == "http://opds-spec.org/thumbnail"
                    // The full-size picture, only until a small one turns up.
                    || ((rel == "http://opds-spec.org/image" || rel == "http://opds-spec.org/cover") && entry.cover.is_none())
                {
                    entry.cover = resolve(base, &href);
                } else if (is_feed_type(&mime) && !rel.contains("alternate") && !rel.contains("related")) || rel == "subsection" {
                    entry.navigation = entry.navigation.take().or_else(|| resolve(base, &href));
                }
            }
            None => match rel.as_str() {
                "next" => feed.next = resolve(base, &href),
                "previous" | "prev" => feed.previous = resolve(base, &href),
                "search" => {
                    let found = if href.contains("{searchTerms}") {
                        // Braces would be escaped by joining as a URL.
                        let url = if href.starts_with("http") { Some(href.clone()) } else { resolve(base, &href).map(|u| u.replace("%7BsearchTerms%7D", "{searchTerms}")) };
                        url.map(SearchLink::Template)
                    } else {
                        resolve(base, &href).map(SearchLink::Description)
                    };
                    // A template for these feeds beats an OpenSearch description.
                    if matches!(found, Some(SearchLink::Template(_))) || search.is_none() {
                        *search = found;
                    }
                }
                _ => {}
            },
        }
    };
    loop {
        match reader.read_event() {
            Err(e) => return Err(Error::Unsuitable(format!("This catalog page couldn't be read ({e})."))),
            Ok(Event::Eof) => break,
            Ok(Event::Start(e)) => {
                let name = String::from_utf8_lossy(e.local_name().as_ref()).into_owned();
                if name == "feed" {
                    saw_feed = true;
                }
                if name == "entry" {
                    entry = Some(OpdsEntry::default());
                } else if name == "link" {
                    link(&e, &mut entry, &mut feed, &mut search);
                }
                path.push(name);
                texts.push(String::new());
            }
            Ok(Event::Empty(e)) => {
                if e.local_name().as_ref() == b"link" {
                    link(&e, &mut entry, &mut feed, &mut search);
                }
            }
            Ok(Event::Text(t)) => {
                if let (Ok(t), Some(text)) = (t.unescape(), texts.last_mut()) {
                    text.push_str(&t);
                    text.push(' ');
                }
            }
            Ok(Event::CData(t)) => {
                if let Some(text) = texts.last_mut() {
                    text.push_str(&String::from_utf8_lossy(&t));
                }
            }
            Ok(Event::End(_)) => {
                let name = path.pop().unwrap_or_default();
                let parent = path.last().map(String::as_str);
                let text = texts.pop().unwrap_or_default();
                if let Some(up) = texts.last_mut() {
                    up.push_str(&text);
                }
                let value = plain(&text);
                if let Some(e) = entry.as_mut() {
                    match (name.as_str(), parent) {
                        ("title", Some("entry")) => e.title = value,
                        ("id", Some("entry")) => e.id = value,
                        ("name", Some("author")) if !value.is_empty() => e.authors.push(value),
                        ("summary", Some("entry")) | ("content", Some("entry")) if !value.is_empty() && e.summary.is_none() => e.summary = Some(value),
                        ("language", Some("entry")) if !value.is_empty() => e.language = Some(value),
                        ("issued", Some("entry")) | ("published", Some("entry")) if !value.is_empty() => e.published = e.published.take().or(Some(value)),
                        _ => {}
                    }
                    if name == "entry" {
                        let mut done = entry.take().expect("in an entry");
                        done.files.sort_by_key(|f| rank(f.format.as_deref()));
                        if done.id.is_empty() {
                            done.id = done.navigation.clone().or_else(|| done.files.first().map(|f| f.url.clone())).unwrap_or_else(|| done.title.clone());
                        }
                        feed.entries.push(done);
                    }
                } else if name == "title" && parent == Some("feed") {
                    feed.title = value;
                }
            }
            Ok(_) => {}
        }
    }
    if !saw_feed {
        return Err(Error::Unsuitable("That address isn't an OPDS catalog.".into()));
    }
    Ok((feed, search))
}

/// The search address in an OpenSearch description, for Atom results.
pub(crate) fn parse_opensearch(xml: &str, base: &Url) -> Option<String> {
    let mut reader = Reader::from_str(xml);
    let mut best: Option<(bool, String)> = None;
    loop {
        match reader.read_event() {
            Ok(Event::Eof) | Err(_) => break,
            Ok(Event::Start(e)) | Ok(Event::Empty(e)) if e.local_name().as_ref() == b"Url" => {
                let (Some(template), mime) = (attr(&e, b"template"), attr(&e, b"type").unwrap_or_default()) else { continue };
                let atom = mime.contains("atom");
                if best.as_ref().is_none_or(|(was_atom, _)| atom && !was_atom) {
                    let url = if template.starts_with("http") { template } else { resolve(base, &template)?.replace("%7BsearchTerms%7D", "{searchTerms}") };
                    best = Some((atom, url));
                }
            }
            Ok(_) => {}
        }
    }
    best.map(|(_, url)| url)
}

fn json_text(v: &Value) -> Option<String> {
    v.as_str().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string)
}

/// Contributors in OPDS 2: a name, an object with one, or a list of either.
fn json_names(v: &Value) -> Vec<String> {
    match v {
        Value::String(s) => vec![s.trim().to_string()],
        Value::Object(o) => o.get("name").and_then(|n| json_text(n).or_else(|| n.as_object().and_then(|m| m.values().find_map(json_text)))).into_iter().collect(),
        Value::Array(a) => a.iter().flat_map(json_names).collect(),
        _ => Vec::new(),
    }
    .into_iter()
    .filter(|s| !s.is_empty())
    .collect()
}

fn json_title(v: &Value) -> String {
    match v {
        Value::Object(o) => o.get("en").or_else(|| o.values().next()).and_then(json_text).unwrap_or_default(),
        v => json_text(v).unwrap_or_default(),
    }
}

/// Reads an OPDS 2 (JSON) page. Groups are folded into one list.
pub(crate) fn parse_json(body: &str, base: &Url) -> Result<OpdsFeed> {
    let doc: Value = serde_json::from_str(body).map_err(|_| Error::Unsuitable("That address isn't an OPDS catalog.".into()))?;
    if doc.get("metadata").is_none() {
        return Err(Error::Unsuitable("That address isn't an OPDS catalog.".into()));
    }
    let mut feed = OpdsFeed { url: base.to_string(), title: json_title(&doc["metadata"]["title"]), ..Default::default() };
    for link in doc["links"].as_array().into_iter().flatten() {
        let rel = link["rel"].as_str().map(str::to_string).or_else(|| link["rel"].as_array().and_then(|a| a.first()).and_then(|r| r.as_str()).map(str::to_string)).unwrap_or_default();
        let Some(href) = link["href"].as_str() else { continue };
        match rel.as_str() {
            "next" => feed.next = resolve(base, href),
            "previous" | "prev" => feed.previous = resolve(base, href),
            "search" if href.contains("{") => {
                // A URI template: just the words, the rest of its options left out.
                let filled = href.replace("{?query}", "?query={searchTerms}").replace("{query}", "{searchTerms}");
                let url = if filled.starts_with("http") { Some(filled) } else { resolve(base, &filled).map(|u| u.replace("%7BsearchTerms%7D", "{searchTerms}")) };
                feed.search = url.filter(|u| u.contains("{searchTerms}"));
            }
            _ => {}
        }
    }
    let navigation = |list: &Value, feed: &mut OpdsFeed| {
        for n in list.as_array().into_iter().flatten() {
            let Some(url) = n["href"].as_str().and_then(|h| resolve(base, h)) else { continue };
            feed.entries.push(OpdsEntry { id: url.clone(), title: json_title(&n["title"]), navigation: Some(url), ..Default::default() });
        }
    };
    let publications = |list: &Value, feed: &mut OpdsFeed| {
        for p in list.as_array().into_iter().flatten() {
            let m = &p["metadata"];
            let mut entry = OpdsEntry {
                id: json_text(&m["identifier"]).unwrap_or_default(),
                title: json_title(&m["title"]),
                authors: json_names(&m["author"]),
                summary: json_text(&m["description"]).map(|d| plain(&d)),
                language: json_text(&m["language"]).or_else(|| m["language"].as_array().and_then(|a| a.first()).and_then(json_text)),
                published: json_text(&m["published"]),
                ..Default::default()
            };
            for link in p["links"].as_array().into_iter().flatten() {
                let rel = link["rel"].as_str().unwrap_or_default();
                let (Some(href), mime) = (link["href"].as_str(), link["type"].as_str().unwrap_or_default().to_string()) else { continue };
                if is_acquisition(rel) {
                    if is_open(rel) {
                        if let Some(url) = resolve(base, href) {
                            let format = format_of(&mime).map(str::to_string);
                            entry.files.push(OpdsFile { url, mime, format, label: json_text(&link["title"]) });
                        }
                    } else {
                        entry.not_free = true;
                    }
                }
            }
            entry.files.sort_by_key(|f| rank(f.format.as_deref()));
            // The smallest picture that isn't tiny.
            let images: Vec<&Value> = p["images"].as_array().into_iter().flatten().collect();
            let pick = images.iter().filter(|i| i["width"].as_u64().is_none_or(|w| w >= 120)).min_by_key(|i| i["width"].as_u64().unwrap_or(u64::MAX)).or(images.first());
            entry.cover = pick.and_then(|i| i["href"].as_str()).and_then(|h| resolve(base, h));
            if entry.id.is_empty() {
                entry.id = entry.files.first().map(|f| f.url.clone()).unwrap_or_else(|| entry.title.clone());
            }
            feed.entries.push(entry);
        }
    };
    navigation(&doc["navigation"], &mut feed);
    publications(&doc["publications"], &mut feed);
    for group in doc["groups"].as_array().into_iter().flatten() {
        navigation(&group["navigation"], &mut feed);
        publications(&group["publications"], &mut feed);
    }
    Ok(feed)
}

const BASE64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

fn base64(bytes: &[u8]) -> String {
    let mut out = String::new();
    for chunk in bytes.chunks(3) {
        let n = (chunk[0] as u32) << 16 | (*chunk.get(1).unwrap_or(&0) as u32) << 8 | *chunk.get(2).unwrap_or(&0) as u32;
        for i in 0..4 {
            if i <= chunk.len() {
                out.push(BASE64[(n >> (18 - 6 * i) & 63) as usize] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}

fn md5_hex(text: &str) -> String {
    hex::encode(Md5::digest(text.as_bytes()))
}

/// The value of a `Digest` sign-in challenge's field.
fn challenge_field(challenge: &str, field: &str) -> Option<String> {
    let at = challenge.find(&format!("{field}="))? + field.len() + 1;
    let rest = &challenge[at..];
    Some(match rest.strip_prefix('"') {
        Some(quoted) => quoted.split('"').next()?.to_string(),
        None => rest.split(',').next()?.trim().to_string(),
    })
}

/// An answer to an HTTP Digest challenge (how a Calibre server asks over
/// plain http), for one request.
pub(crate) fn digest_answer(challenge: &str, username: &str, password: &str, method: &str, uri: &str, cnonce: &str) -> Option<String> {
    let realm = challenge_field(challenge, "realm")?;
    let nonce = challenge_field(challenge, "nonce")?;
    let opaque = challenge_field(challenge, "opaque");
    let qop = challenge_field(challenge, "qop").filter(|q| q.split(',').any(|q| q.trim() == "auth"));
    let ha1 = md5_hex(&format!("{username}:{realm}:{password}"));
    let ha2 = md5_hex(&format!("{method}:{uri}"));
    let mut answer = format!("Digest username=\"{username}\", realm=\"{realm}\", nonce=\"{nonce}\", uri=\"{uri}\"");
    match qop {
        Some(_) => {
            let nc = "00000001";
            let response = md5_hex(&format!("{ha1}:{nonce}:{nc}:{cnonce}:auth:{ha2}"));
            answer += &format!(", qop=auth, nc={nc}, cnonce=\"{cnonce}\", response=\"{response}\"");
        }
        None => answer += &format!(", response=\"{}\"", md5_hex(&format!("{ha1}:{nonce}:{ha2}"))),
    }
    if let Some(opaque) = opaque {
        answer += &format!(", opaque=\"{opaque}\"");
    }
    Some(answer + ", algorithm=MD5")
}

/// What a catalog sent: its type, its body, and where it ended up after redirects.
struct Fetched {
    /// The address that answered, after any redirects: links in the page are relative to it.
    url: Url,
    mime: String,
    body: Box<dyn Read + Send + 'static>,
    filename: Option<String>,
}

pub(crate) const NEEDS_LOGIN: &str = "needs-login";

fn agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .timeout_connect(Some(Duration::from_secs(20)))
        .timeout_recv_response(Some(Duration::from_secs(60)))
        .http_status_as_error(false)
        .user_agent(concat!("The Bound Vigil/", env!("CARGO_PKG_VERSION"), " (eBook reader)"))
        .build()
        .into()
}

/// Where a response came from, after any redirects.
fn answered_from(response: &ureq::http::Response<ureq::Body>) -> Option<Url> {
    use ureq::ResponseExt;
    Url::parse(&response.get_uri().to_string()).ok()
}

fn get(catalog: &Saved, url: &str) -> Result<Fetched> {
    let agent = agent();
    let mut target = Url::parse(url).map_err(|_| Error::Unsuitable("That catalog address isn't a web address.".into()))?;
    // Only send the password to the catalog's own server: same scheme, host and port.
    let home = Url::parse(&catalog.url).ok();
    let may_sign_in = |u: &Url| !catalog.username.is_empty() && home.as_ref().is_some_and(|h| h.origin() == u.origin());
    let request = |to: &Url, authorization: Option<&str>| {
        let mut r = agent.get(to.as_str()).header("Accept", "application/atom+xml, application/opds+json, application/json;q=0.9, */*;q=0.5");
        if let Some(a) = authorization {
            r = r.header("Authorization", a);
        }
        r.call().map_err(|e| Error::Unsuitable(format!("The catalog couldn't be reached ({e}).")))
    };
    let basic = format!("Basic {}", base64(format!("{}:{}", catalog.username, catalog.password).as_bytes()));
    let mut response = request(&target, may_sign_in(&target).then_some(basic.as_str()))?;
    // A redirect drops the password, so a catalog that moved within its own server is asked again at the new address.
    if response.status() == 401 {
        if let Some(landed) = answered_from(&response).filter(|l| *l != target && may_sign_in(l)) {
            target = landed;
            response = request(&target, Some(&basic))?;
        }
    }
    if response.status() == 401 && may_sign_in(&target) {
        let challenge = response.headers().get_all("www-authenticate").iter().filter_map(|v| v.to_str().ok()).find(|v| v.to_ascii_lowercase().starts_with("digest")).map(str::to_string);
        if let Some(challenge) = challenge {
            let uri = match target.query() {
                Some(q) => format!("{}?{q}", target.path()),
                None => target.path().to_string(),
            };
            let cnonce = new_record_id().replace('-', "");
            if let Some(answer) = digest_answer(&challenge, &catalog.username, &catalog.password, "GET", &uri, &cnonce) {
                response = request(&target, Some(&answer))?;
            }
        }
    }
    match response.status().as_u16() {
        200..=299 => {}
        401 | 403 => return Err(Error::Unsuitable(NEEDS_LOGIN.into())),
        404 => return Err(Error::Unsuitable("The catalog says that page isn't there.".into())),
        code => return Err(Error::Unsuitable(format!("The catalog answered with an error ({code})."))),
    }
    let mime = response.headers().get("content-type").and_then(|v| v.to_str().ok()).unwrap_or_default().to_string();
    let filename = response
        .headers()
        .get("content-disposition")
        .and_then(|v| v.to_str().ok())
        .and_then(|d| d.split(';').find_map(|p| p.trim().strip_prefix("filename=").map(|f| f.trim_matches('"').to_string())));
    let url = answered_from(&response).unwrap_or(target);
    let body = Box::new(response.into_body().into_reader());
    Ok(Fetched { url, mime, body, filename })
}

fn read_text(fetched: Fetched) -> Result<String> {
    let mut bytes = Vec::new();
    fetched.body.take(MAX_FEED_BYTES).read_to_end(&mut bytes).map_err(|e| Error::Unsuitable(format!("The catalog page couldn't be read ({e}).")))?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

/// A file name safe on every computer, from a book's title.
fn safe_name(title: &str) -> String {
    let name: String = title.chars().map(|c| if c.is_alphanumeric() || " -_.,'()".contains(c) { c } else { ' ' }).collect();
    let name = name.split_whitespace().collect::<Vec<_>>().join(" ");
    let name: String = name.trim_matches('.').chars().take(80).collect();
    if name.is_empty() { "Book".into() } else { name }
}

/// The format a download is in: what the catalog said, else its name.
fn download_format(offered: Option<&str>, mime: &str, filename: Option<&str>, url: &str) -> Option<String> {
    let from_name = |name: &str| {
        let name = name.to_ascii_lowercase();
        let ext = name.rsplit('.').next().unwrap_or_default();
        // Project Gutenberg's own names: "pg1342-images-3.epub" or ".epub3.images".
        if name.contains(".epub") || name.ends_with("epub3.images") || name.ends_with(".images") {
            return Some("epub".to_string());
        }
        SUPPORTED_FORMATS.contains(&ext).then(|| ext.to_string())
    };
    format_of(mime)
        .map(str::to_string)
        .or_else(|| offered.map(str::to_string))
        .or_else(|| filename.and_then(from_name))
        .or_else(|| Url::parse(url).ok().and_then(|u| u.path_segments().and_then(|mut s| s.next_back().map(str::to_string))).and_then(|n| from_name(&n)))
        .filter(|f| SUPPORTED_FORMATS.contains(&f.as_str()) || f == "kepub")
}

impl Library {
    fn saved_catalogs(&self) -> Result<Vec<Saved>> {
        match self.setting(SETTINGS_KEY)? {
            Some(s) => Ok(serde_json::from_str::<Vec<Saved>>(&s).unwrap_or_default().into_iter().filter(|c| !(c.id == RETIRED_STARTER && c.username.is_empty())).collect()),
            None => Ok(STARTERS.iter().map(|(id, name, url)| Saved { id: id.to_string(), name: name.to_string(), url: url.to_string(), ..Default::default() }).collect()),
        }
    }

    fn write_catalogs(&self, catalogs: &[Saved]) -> Result<()> {
        self.set_setting(SETTINGS_KEY, &serde_json::to_string(catalogs)?)
    }

    pub fn catalogs(&self) -> Result<Vec<CatalogView>> {
        Ok(self.saved_catalogs()?.iter().map(CatalogView::from).collect())
    }

    fn catalog(&self, id: &str) -> Result<Saved> {
        self.saved_catalogs()?.into_iter().find(|c| c.id == id).ok_or_else(|| Error::Unsuitable("that catalog was removed".into()))
    }

    pub fn save_catalog(&self, input: &CatalogInput) -> Result<CatalogView> {
        let url = input.url.trim();
        let parsed = Url::parse(url).map_err(|_| Error::Unsuitable("Enter the catalog's whole address, starting with http:// or https://".into()))?;
        if !matches!(parsed.scheme(), "http" | "https") {
            return Err(Error::Unsuitable("Enter the catalog's whole address, starting with http:// or https://".into()));
        }
        let name = Some(input.name.trim()).filter(|n| !n.is_empty()).map(str::to_string).unwrap_or_else(|| parsed.host_str().unwrap_or("Catalog").to_string());
        let mut catalogs = self.saved_catalogs()?;
        let username = input.username.as_deref().map(str::trim).unwrap_or_default().to_string();
        let saved = match input.id.as_deref().and_then(|id| catalogs.iter_mut().find(|c| c.id == id)) {
            Some(c) => {
                // A different server must not be handed the old password.
                let same_host = Url::parse(&c.url).ok().is_some_and(|u| u.origin() == parsed.origin());
                c.name = name;
                c.url = parsed.to_string();
                if username.is_empty() || !same_host {
                    c.password.clear();
                }
                c.username = username;
                if let Some(p) = &input.password {
                    c.password = p.clone();
                }
                c.clone()
            }
            None => {
                let c = Saved { id: new_record_id(), name, url: parsed.to_string(), username, password: input.password.clone().unwrap_or_default(), ..Default::default() };
                catalogs.push(c.clone());
                c
            }
        };
        self.write_catalogs(&catalogs)?;
        Ok(CatalogView::from(&saved))
    }

    pub fn remove_catalog(&self, id: &str) -> Result<()> {
        let mut catalogs = self.saved_catalogs()?;
        catalogs.retain(|c| c.id != id);
        self.write_catalogs(&catalogs)
    }

    /// The catalog's details for reaching it, without holding the library while the network is slow.
    pub fn catalog_access(&self, id: &str) -> Result<CatalogAccess> {
        Ok(CatalogAccess(self.catalog(id)?))
    }

    /// Saves an Audiobookshelf server, signed in to already (`token`). With
    /// an `id`, changes that one; a new token replaces the old.
    pub fn save_abs_server(&self, id: Option<&str>, name: &str, base: &str, username: &str, token: Option<(String, String)>) -> Result<CatalogView> {
        let mut catalogs = self.saved_catalogs()?;
        let name = Some(name.trim()).filter(|n| !n.is_empty()).map(str::to_string).unwrap_or_else(|| "Audiobookshelf".into());
        let saved = match id.and_then(|id| catalogs.iter_mut().find(|c| c.id == id)) {
            Some(c) => {
                let same = c.url == base && c.username == username;
                c.name = name;
                c.url = base.to_string();
                c.username = username.to_string();
                c.kind = crate::audiobookshelf::KIND.into();
                c.password.clear();
                match token {
                    Some((t, r)) => (c.token, c.refresh) = (t, r),
                    // A different server or person needs signing in again.
                    None if !same => return Err(Error::Unsuitable("Enter the password to sign in to that server.".into())),
                    None => {}
                }
                c.clone()
            }
            None => {
                let (token, refresh) = token.ok_or_else(|| Error::Unsuitable("Enter the password to sign in to that server.".into()))?;
                let c = Saved { id: new_record_id(), name, url: base.to_string(), username: username.to_string(), kind: crate::audiobookshelf::KIND.into(), token, refresh, ..Default::default() };
                catalogs.push(c.clone());
                c
            }
        };
        self.write_catalogs(&catalogs)?;
        Ok(CatalogView::from(&saved))
    }

    /// The Audiobookshelf servers signed in to, for keeping listening places in step.
    pub fn abs_servers(&self) -> Result<Vec<crate::audiobookshelf::Server>> {
        Ok(self.saved_catalogs()?.iter().filter(|c| c.kind == crate::audiobookshelf::KIND && !c.token.is_empty()).map(abs_server).collect())
    }

    /// Keeps any sign-in an Audiobookshelf server renewed meanwhile.
    pub fn keep_abs_sign_ins(&self) -> Result<()> {
        let mut catalogs = self.saved_catalogs()?;
        let mut changed = false;
        for c in catalogs.iter_mut().filter(|c| c.kind == crate::audiobookshelf::KIND) {
            if let Some((token, refresh)) = crate::audiobookshelf::take_renewed(&c.id) {
                (c.token, c.refresh) = (token, refresh);
                changed = true;
            }
        }
        if changed {
            self.write_catalogs(&catalogs)?;
        }
        Ok(())
    }
}

fn abs_server(c: &Saved) -> crate::audiobookshelf::Server {
    crate::audiobookshelf::Server { id: c.id.clone(), name: c.name.clone(), base: c.url.trim_end_matches('/').to_string(), token: c.token.clone(), refresh: c.refresh.clone() }
}

/// A catalog's address and sign-in, taken out of the library for network work.
pub struct CatalogAccess(Saved);

impl CatalogAccess {
    /// A page of the catalog: its start, when `url` is none.
    pub fn feed(&self, url: Option<&str>) -> Result<OpdsFeed> {
        if self.0.kind == crate::audiobookshelf::KIND {
            return abs_server(&self.0).feed(url);
        }
        let url = url.unwrap_or(&self.0.url).to_string();
        let fetched = get(&self.0, &url)?;
        let json = fetched.mime.contains("json");
        let base = fetched.url.clone();
        let body = read_text(fetched)?;
        if json || body.trim_start().starts_with('{') {
            return parse_json(&body, &base);
        }
        let (mut feed, search) = parse_atom(&body, &base)?;
        feed.search = match search {
            Some(SearchLink::Template(t)) => Some(t),
            Some(SearchLink::Description(d)) => get(&self.0, &d).ok().and_then(|f| {
                let base = f.url.clone();
                parse_opensearch(&read_text(f).ok()?, &base)
            }),
            None => None,
        };
        if feed.title.is_empty() {
            feed.title = self.0.name.clone();
        }
        Ok(feed)
    }

    /// Search results, from a feed's search address.
    pub fn search(&self, template: &str, words: &str) -> Result<OpdsFeed> {
        if self.0.kind == crate::audiobookshelf::KIND {
            return abs_server(&self.0).search(template, words);
        }
        let encoded: String = url::form_urlencoded::byte_serialize(words.trim().as_bytes()).collect();
        let url = template.replace("{searchTerms}", &encoded).replace("{startPage?}", "1").replace("{startIndex?}", "");
        // Any other optional fields the template has are left empty.
        let url = strip_optional_fields(&url);
        self.feed(Some(&url))
    }

    /// Brings a book down into `folder` (one of its own, for the import
    /// queue), and gives the file.
    pub fn download(&self, file: &OpdsFile, title: &str, folder: &Path) -> Result<PathBuf> {
        if self.0.kind == crate::audiobookshelf::KIND {
            return abs_server(&self.0).download(file, title, folder);
        }
        let fetched = get(&self.0, &file.url)?;
        if fetched.mime.starts_with("text/html") {
            return Err(Error::Unsuitable("The catalog sent a web page instead of the book. It may need you to sign in on its website.".into()));
        }
        let format = download_format(file.format.as_deref(), &fetched.mime, fetched.filename.as_deref(), &file.url)
            .ok_or_else(|| Error::Unsuitable("TBV can't open the kind of file the catalog sent.".into()))?;
        let format = if format == "kepub" { "epub".to_string() } else { format };
        let path = folder.join(format!("{}.{format}", safe_name(title)));
        let written = (|| -> Result<u64> {
            let mut out = fs::File::create(&path)?;
            let copied = std::io::copy(&mut fetched.body.take(MAX_BOOK_BYTES + 1), &mut out)?;
            out.flush()?;
            Ok(copied)
        })();
        match written {
            Ok(n) if n > 0 && n <= MAX_BOOK_BYTES => Ok(path),
            Ok(n) => {
                let _ = fs::remove_file(&path);
                Err(Error::Unsuitable(if n == 0 { "The catalog sent an empty file.".into() } else { "That book is over 2 GB.".into() }))
            }
            Err(e) => {
                let _ = fs::remove_file(&path);
                Err(e)
            }
        }
    }
}

/// Brings a book down from any web address (Browse's Bible and browser),
/// with no sign-in. Its format comes from what the site says it is.
pub fn download_book(url: &str, title: &str, folder: &Path) -> Result<PathBuf> {
    let anyone = Saved { url: url.to_string(), ..Default::default() };
    CatalogAccess(anyone).download(&OpdsFile { url: url.to_string(), mime: String::new(), format: None, label: None }, title, folder)
}

/// A picture from a web page (for an article saved from the browser's reader
/// mode): JPEG, PNG, GIF or WebP, at most 10 MB.
pub fn fetch_picture(url: &str) -> Result<Vec<u8>> {
    const MOST: u64 = 10 * 1024 * 1024;
    let response = agent()
        .get(url)
        .header("Accept", "image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.9,*/*;q=0.5")
        .call()
        .map_err(|e| Error::Unsuitable(format!("The picture couldn't be reached ({e}).")))?;
    if !response.status().is_success() {
        return Err(Error::Unsuitable(format!("The picture's site answered {}.", response.status().as_u16())));
    }
    let mut bytes = Vec::new();
    response.into_body().into_reader().take(MOST + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MOST {
        return Err(Error::Unsuitable("That picture is over 10 MB.".into()));
    }
    let picture = bytes.starts_with(&[0xFF, 0xD8, 0xFF]) || bytes.starts_with(b"\x89PNG") || bytes.starts_with(b"GIF8") || (bytes.len() > 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP");
    if !picture {
        return Err(Error::Unsuitable("That isn't a picture TBV can keep.".into()));
    }
    Ok(bytes)
}

/// Takes `{name?}` fields out of a filled-in OpenSearch address.
fn strip_optional_fields(url: &str) -> String {
    let mut out = String::with_capacity(url.len());
    let mut rest = url;
    while let Some(start) = rest.find('{') {
        out.push_str(&rest[..start]);
        match rest[start..].find('}') {
            Some(end) => rest = &rest[start + end + 1..],
            None => {
                rest = &rest[start..];
                break;
            }
        }
    }
    out.push_str(rest);
    out
}

#[cfg(test)]
mod tests;

//! Audiobookshelf: a server people run at home for their audiobooks (and
//! ebooks). TBV signs in to it like a catalogue in Discover, so its
//! libraries can be looked through and searched there, and an audiobook or
//! ebook brought down into TBV. Where TBV has an audiobook the server has
//! too, the listening place is kept the same in both: whichever moved last
//! wins. An audiobook can also be played straight from the server without
//! bringing it down, a range at a time, with its place kept on the server.
//!
//! Only the server's sign-in token is kept, never the password.

use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use rusqlite::OptionalExtension;
use serde_json::{json, Value};
use url::Url;

use crate::error::{Error, Result};
use crate::opds::{OpdsEntry, OpdsFeed, OpdsFile};

/// What a catalogue saved for Audiobookshelf is called in its `kind`.
pub const KIND: &str = "audiobookshelf";
/// Addresses inside an Audiobookshelf catalogue start with this, not http.
const ADDRESS: &str = "abs:";
const PAGE: usize = 48;
/// The id of an audiobook played straight from a server: this, its saved
/// catalogue's id, `~`, and the server's id for the book. It isn't in the
/// library, so nothing else in TBV knows it.
pub const STREAM_PREFIX: &str = "abs~";

pub fn stream_id(catalog: &str, item: &str) -> String {
    format!("{STREAM_PREFIX}{catalog}~{item}")
}

/// The catalogue and the server's id for a book, from a stream id.
pub fn parse_stream_id(id: &str) -> Option<(String, String)> {
    let (catalog, item) = id.strip_prefix(STREAM_PREFIX)?.split_once('~')?;
    (!catalog.is_empty() && !item.is_empty()).then(|| (catalog.to_string(), item.to_string()))
}

/// An audiobook on the server, ready to play from it.
#[derive(Debug, Clone)]
pub struct RemoteBook {
    pub item: String,
    pub parts: Vec<RemotePart>,
    /// The book as the player sees it.
    pub audiobook: crate::audio::Audiobook,
}

/// One of its sound files on the server.
#[derive(Debug, Clone, PartialEq)]
pub struct RemotePart {
    pub ino: String,
    pub size: u64,
    /// Without the dot: "m4b", "mp3".
    pub ext: String,
}

/// The server's address and sign-in, out of the library for network work.
#[derive(Debug, Clone)]
pub struct Server {
    /// Which saved catalogue this is, for keeping a renewed sign-in.
    pub id: String,
    pub name: String,
    /// Without a trailing `/`.
    pub base: String,
    pub token: String,
    pub refresh: String,
}

fn agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .timeout_connect(Some(Duration::from_secs(15)))
        .timeout_recv_response(Some(Duration::from_secs(60)))
        .http_status_as_error(false)
        .user_agent(concat!("The Bound Vigil/", env!("CARGO_PKG_VERSION")))
        .build()
        .into()
}

fn offline(error: ureq::Error) -> Error {
    Error::Offline(format!("Audiobookshelf couldn't be reached ({error})"))
}

fn read_json(mut response: ureq::http::Response<ureq::Body>) -> (u16, Value) {
    let status = response.status().as_u16();
    let text = response.body_mut().with_config().limit(64 * 1024 * 1024).read_to_string().unwrap_or_default();
    (status, serde_json::from_str(&text).unwrap_or(Value::Null))
}

/// The server's address as given, tidied: `https://abs.example.com`.
pub fn tidy_address(url: &str) -> Result<String> {
    let url = url.trim();
    let url = if url.contains("://") { url.to_string() } else { format!("http://{url}") };
    let parsed = Url::parse(&url).map_err(|_| Error::Unsuitable("Enter the server's address, like http://192.168.1.20:13378".into()))?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
        return Err(Error::Unsuitable("Enter the server's address, starting with http:// or https://".into()));
    }
    let base = parsed.to_string();
    // The web app's sign-in page isn't part of the address.
    let base = base.trim_end_matches('/');
    Ok(base.strip_suffix("/login").unwrap_or(base).to_string())
}

/// Signs in, and gives the token (and, on newer servers, a refresh token).
pub fn sign_in(base: &str, username: &str, password: &str) -> Result<(String, String)> {
    let answer = agent()
        .post(format!("{base}/login"))
        .header("x-return-tokens", "true")
        .send_json(json!({ "username": username, "password": password }))
        .map_err(offline)?;
    let (status, body) = read_json(answer);
    match status {
        200..=299 => {}
        401 | 403 => return Err(Error::Unsuitable("Audiobookshelf didn't accept that username and password.".into())),
        404 => return Err(Error::Unsuitable("There's no Audiobookshelf server at that address.".into())),
        429 => return Err(Error::Unsuitable("Audiobookshelf wants a pause after several tries. Wait a few minutes, then try again.".into())),
        _ => return Err(Error::Cloud(format!("Audiobookshelf answered with status {status}"))),
    }
    tokens_from(&body).ok_or_else(|| Error::Cloud("Audiobookshelf didn't send a sign-in.".into()))
}

/// The sign-in a login or refresh answer holds. The old kind of token lasts
/// until it's taken back, so it's used when the server still gives one.
fn tokens_from(body: &Value) -> Option<(String, String)> {
    let text = |p: &str| body.pointer(p).and_then(Value::as_str).filter(|s| !s.is_empty()).map(str::to_string);
    let refresh = text("/user/refreshToken").or_else(|| text("/refreshToken")).unwrap_or_default();
    match text("/user/token") {
        Some(lasting) => Some((lasting, String::new())),
        None => text("/user/accessToken").or_else(|| text("/accessToken")).map(|t| (t, refresh)),
    }
}

/// Renewed sign-ins, by catalogue, kept until the library saves them.
static RENEWED: Mutex<Option<HashMap<String, (String, String)>>> = Mutex::new(None);

/// A renewed sign-in for the catalogue `id`, once.
pub fn take_renewed(id: &str) -> Option<(String, String)> {
    RENEWED.lock().ok()?.as_mut()?.remove(id)
}

/// The library sorts and searches titles this way, for matching books.
fn key(text: &str) -> String {
    let lower = text.to_lowercase();
    let main = lower.split(':').next().unwrap_or(&lower);
    let words: Vec<&str> = main.split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty()).collect();
    let words = match words.first() {
        Some(&("the" | "a" | "an")) if words.len() > 1 => &words[1..],
        _ => &words[..],
    };
    words.join(" ")
}

/// A surname, for matching authors written either way round.
fn surname(name: &str) -> String {
    let name = name.split(',').next().unwrap_or(name).trim();
    // "Le Guin, Ursula K." puts the surname first already.
    let last = if name.contains(',') { name } else { name.rsplit(' ').next().unwrap_or(name) };
    key(last)
}

fn meta(item: &Value, field: &str) -> Option<String> {
    item.pointer(&format!("/media/metadata/{field}")).and_then(Value::as_str).filter(|s| !s.trim().is_empty()).map(|s| s.trim().to_string())
}

fn mime_of(format: &str) -> &'static str {
    match format {
        "epub" => "application/epub+zip",
        "pdf" => "application/pdf",
        "mobi" => "application/x-mobipocket-ebook",
        "azw3" => "application/vnd.amazon.ebook",
        "cbz" => "application/vnd.comicbook+zip",
        "cbr" => "application/vnd.comicbook-rar",
        _ => "application/octet-stream",
    }
}

fn safe_name(title: &str) -> String {
    let name: String = title.chars().map(|c| if c.is_alphanumeric() || " -_.,'()".contains(c) { c } else { ' ' }).collect();
    let name = name.split_whitespace().collect::<Vec<_>>().join(" ");
    let name: String = name.trim_matches('.').chars().take(80).collect();
    if name.is_empty() {
        "Audiobook".into()
    } else {
        name
    }
}

/// One of the server's books, as a catalogue entry.
fn entry(item: &Value, cover: Option<String>) -> Option<OpdsEntry> {
    let id = item.get("id")?.as_str()?.to_string();
    let media = item.get("media")?;
    let title = meta(item, "title").unwrap_or_else(|| "Untitled".into());
    let mut summary = Vec::new();
    if let Some(n) = meta(item, "narratorName") {
        summary.push(format!("Read by {n}."));
    }
    if let Some(s) = meta(item, "seriesName") {
        summary.push(format!("Series: {s}."));
    }
    if let Some(d) = meta(item, "description") {
        summary.push(d);
    }
    let mut files = Vec::new();
    let audio = media.get("numAudioFiles").and_then(Value::as_u64).or_else(|| media.get("numTracks").and_then(Value::as_u64)).unwrap_or(0)
        + media.get("audioFiles").and_then(Value::as_array).map(|a| a.len() as u64).unwrap_or(0);
    if audio > 0 || media.get("duration").and_then(Value::as_f64).unwrap_or(0.0) > 0.0 {
        files.push(OpdsFile { url: format!("{ADDRESS}item/{id}/audio"), mime: "audio/mp4".into(), format: Some("m4b".into()), label: Some("Audiobook".into()) });
    }
    let ebook = media.get("ebookFormat").and_then(Value::as_str).or_else(|| media.pointer("/ebookFile/ebookFormat").and_then(Value::as_str));
    if let Some(format) = ebook {
        files.push(OpdsFile { url: format!("{ADDRESS}item/{id}/ebook"), mime: mime_of(format).into(), format: Some(format.to_string()), label: Some("Ebook".into()) });
    }
    Some(OpdsEntry {
        id,
        title,
        authors: meta(item, "authorName").map(|a| a.split(", ").map(str::to_string).collect()).unwrap_or_default(),
        summary: (!summary.is_empty()).then(|| summary.join(" ")),
        language: meta(item, "language"),
        published: meta(item, "publishedYear"),
        cover,
        navigation: None,
        files,
        not_free: false,
    })
}

/// An address inside the catalogue, taken apart: `abs:library/ID?page=2&q=…`.
fn parse_address(url: &str) -> (String, HashMap<String, String>) {
    let rest = url.strip_prefix(ADDRESS).unwrap_or(url);
    let (path, query) = rest.split_once('?').unwrap_or((rest, ""));
    let pairs = url::form_urlencoded::parse(query.as_bytes()).map(|(k, v)| (k.into_owned(), v.into_owned())).collect();
    (path.to_string(), pairs)
}

impl Server {
    /// Asks the server for JSON, renewing a sign-in that ran out once.
    fn call(&mut self, method: &str, path: &str, body: Option<&Value>) -> Result<Value> {
        for attempt in 0..2 {
            let url = format!("{}{path}", self.base);
            let auth = format!("Bearer {}", self.token);
            let agent = agent();
            let answer = match (method, body) {
                ("PATCH", Some(b)) => agent.patch(&url).header("Authorization", &auth).send_json(b),
                ("POST", Some(b)) => agent.post(&url).header("Authorization", &auth).send_json(b),
                _ => agent.get(&url).header("Authorization", &auth).call(),
            }
            .map_err(offline)?;
            let (status, json) = read_json(answer);
            match status {
                200..=299 => return Ok(json),
                401 if attempt == 0 && self.renew()? => continue,
                401 => return Err(Error::Unsuitable(format!("{} signed TBV out. Sign in again with Edit in Discover's catalogues.", self.name))),
                403 => return Err(Error::Unsuitable(format!("Your Audiobookshelf account isn't allowed to do that on {}.", self.name))),
                404 => return Err(Error::Unsuitable("Audiobookshelf doesn't have that any more.".into())),
                _ => return Err(Error::Cloud(format!("Audiobookshelf answered with status {status}"))),
            }
        }
        unreachable!()
    }

    /// Renews a sign-in that runs out (newer servers). False when there's
    /// nothing to renew it with.
    fn renew(&mut self) -> Result<bool> {
        if self.refresh.is_empty() {
            return Ok(false);
        }
        let answer = agent().post(format!("{}/auth/refresh", self.base)).header("x-refresh-token", &self.refresh).send_empty().map_err(offline)?;
        let (status, body) = read_json(answer);
        let Some((token, refresh)) = (200..300).contains(&status).then(|| tokens_from(&body)).flatten() else { return Ok(false) };
        self.token = token;
        if !refresh.is_empty() {
            self.refresh = refresh;
        }
        if let Ok(mut all) = RENEWED.lock() {
            all.get_or_insert_with(HashMap::new).insert(self.id.clone(), (self.token.clone(), self.refresh.clone()));
        }
        Ok(true)
    }

    fn get_raw(&mut self, path: &str) -> Result<ureq::http::Response<ureq::Body>> {
        for attempt in 0..2 {
            let answer = agent().get(format!("{}{path}", self.base)).header("Authorization", &format!("Bearer {}", self.token)).call().map_err(offline)?;
            match answer.status().as_u16() {
                200..=299 => return Ok(answer),
                401 if attempt == 0 && self.renew()? => continue,
                403 => return Err(Error::Unsuitable("Your Audiobookshelf account isn't allowed to download. Its owner can allow it in the server's Users settings.".into())),
                status => return Err(Error::Cloud(format!("Audiobookshelf wouldn't send the file (status {status})"))),
            }
        }
        unreachable!()
    }

    /// Small covers for a page of books, as pictures the page can show
    /// (the server's own address isn't one the app may load from).
    fn covers(&self, ids: &[String]) -> HashMap<String, String> {
        let found = Mutex::new(HashMap::new());
        std::thread::scope(|scope| {
            for chunk in ids.chunks(ids.len().div_ceil(6).max(1)) {
                let found = &found;
                scope.spawn(move || {
                    for id in chunk {
                        let url = format!("{}/api/items/{id}/cover?width=240&format=jpeg", self.base);
                        let Ok(mut answer) = agent().get(&url).header("Authorization", &format!("Bearer {}", self.token)).call() else { continue };
                        if !answer.status().is_success() {
                            continue;
                        }
                        let Ok(bytes) = answer.body_mut().with_config().limit(4 * 1024 * 1024).read_to_vec() else { continue };
                        let mime = if bytes.starts_with(b"\x89PNG") { "image/png" } else if bytes.starts_with(b"RIFF") { "image/webp" } else { "image/jpeg" };
                        if let Ok(mut f) = found.lock() {
                            f.insert(id.clone(), format!("data:{mime};base64,{}", base64(&bytes)));
                        }
                    }
                });
            }
        });
        found.into_inner().unwrap_or_default()
    }

    fn page_of(&self, items: &[Value]) -> Vec<OpdsEntry> {
        let ids: Vec<String> = items.iter().filter_map(|i| i.get("id").and_then(Value::as_str).map(str::to_string)).collect();
        let covers = self.covers(&ids);
        items.iter().filter_map(|i| entry(i, i.get("id").and_then(Value::as_str).and_then(|id| covers.get(id).cloned()))).collect()
    }

    /// A page of the catalogue: the libraries first, then a library's books.
    pub fn feed(&mut self, url: Option<&str>) -> Result<OpdsFeed> {
        let (path, query) = parse_address(url.unwrap_or("abs:"));
        if let Some(library) = path.strip_prefix("library/") {
            let library = library.to_string();
            if let Some(words) = query.get("q").filter(|q| !q.trim().is_empty()) {
                let found = self.call("GET", &format!("/api/libraries/{library}/search?limit=60&q={}", crate::oauth::percent_encode(words.trim())), None)?;
                let items: Vec<Value> = found.get("book").and_then(Value::as_array).into_iter().flatten().filter_map(|b| b.get("libraryItem").cloned()).collect();
                return Ok(OpdsFeed {
                    url: url.unwrap_or_default().to_string(),
                    title: format!("“{}”", words.trim()),
                    entries: self.page_of(&items),
                    search: Some(format!("{ADDRESS}library/{library}?q={{searchTerms}}")),
                    ..Default::default()
                });
            }
            let page: usize = query.get("page").and_then(|p| p.parse().ok()).unwrap_or(0);
            let body = self.call("GET", &format!("/api/libraries/{library}/items?limit={PAGE}&page={page}&minified=1&sort=media.metadata.title"), None)?;
            let items: Vec<Value> = body.get("results").and_then(Value::as_array).cloned().unwrap_or_default();
            let total = body.get("total").and_then(Value::as_u64).unwrap_or(0) as usize;
            let name = query.get("name").cloned().unwrap_or_else(|| self.name.clone());
            let at = |p: usize| format!("{ADDRESS}library/{library}?page={p}&name={}", crate::oauth::percent_encode(&name));
            return Ok(OpdsFeed {
                url: at(page),
                title: name.clone(),
                entries: self.page_of(&items),
                next: ((page + 1) * PAGE < total).then(|| at(page + 1)),
                previous: (page > 0).then(|| at(page - 1)),
                search: Some(format!("{ADDRESS}library/{library}?q={{searchTerms}}")),
            });
        }
        let body = self.call("GET", "/api/libraries", None)?;
        let libraries: Vec<&Value> = body.get("libraries").and_then(Value::as_array).into_iter().flatten().filter(|l| l.get("mediaType").and_then(Value::as_str) != Some("podcast")).collect();
        // With one library, its books straight away.
        if let [only] = libraries[..] {
            if let (Some(id), Some(name)) = (only.get("id").and_then(Value::as_str), only.get("name").and_then(Value::as_str)) {
                let mut feed = self.feed(Some(&format!("{ADDRESS}library/{id}?page=0&name={}", crate::oauth::percent_encode(name))))?;
                feed.title = self.name.clone();
                return Ok(feed);
            }
        }
        Ok(OpdsFeed {
            url: ADDRESS.to_string(),
            title: self.name.clone(),
            entries: libraries
                .iter()
                .filter_map(|l| {
                    let id = l.get("id")?.as_str()?;
                    let name = l.get("name")?.as_str()?.to_string();
                    Some(OpdsEntry { id: id.to_string(), navigation: Some(format!("{ADDRESS}library/{id}?page=0&name={}", crate::oauth::percent_encode(&name))), title: name, ..Default::default() })
                })
                .collect(),
            ..Default::default()
        })
    }

    /// Search results, from a page's search address.
    pub fn search(&mut self, template: &str, words: &str) -> Result<OpdsFeed> {
        let encoded: String = url::form_urlencoded::byte_serialize(words.trim().as_bytes()).collect();
        self.feed(Some(&template.replace("{searchTerms}", &encoded)))
    }

    /// Brings a book down into `folder`: an audiobook as a folder of its
    /// files (one file on its own), an ebook as its file.
    pub fn download(&mut self, file: &OpdsFile, title: &str, folder: &Path) -> Result<PathBuf> {
        let (path, _) = parse_address(&file.url);
        let mut parts = path.split('/');
        let (Some("item"), Some(id), Some(what)) = (parts.next(), parts.next(), parts.next()) else {
            return Err(Error::Unsuitable("That isn't a book on the server.".into()));
        };
        let id = id.to_string();
        let item = self.call("GET", &format!("/api/items/{id}?expanded=1"), None)?;
        let name = safe_name(title);
        if what == "ebook" {
            let ino = item.pointer("/media/ebookFile/ino").and_then(Value::as_str).ok_or_else(|| Error::Unsuitable("That book has no ebook on the server.".into()))?;
            let format = item.pointer("/media/ebookFile/ebookFormat").and_then(Value::as_str).unwrap_or("epub");
            let to = folder.join(format!("{name}.{format}"));
            self.save(&format!("/api/items/{id}/file/{ino}/download"), &to)?;
            return Ok(to);
        }
        let mut files: Vec<(u64, String, String)> = item
            .pointer("/media/audioFiles")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter(|f| f.get("exclude").and_then(Value::as_bool) != Some(true))
            .filter_map(|f| {
                let ino = f.get("ino")?.as_str()?.to_string();
                let filename = f.pointer("/metadata/filename").and_then(Value::as_str).unwrap_or("part.mp3").to_string();
                Some((f.get("index").and_then(Value::as_u64).unwrap_or(0), ino, filename))
            })
            .collect();
        files.sort();
        match &files[..] {
            [] => Err(Error::Unsuitable("That book has no audio on the server.".into())),
            [(_, ino, filename)] => {
                let ext = Path::new(filename).extension().and_then(|e| e.to_str()).unwrap_or("m4b");
                let to = folder.join(format!("{name}.{ext}"));
                self.save(&format!("/api/items/{id}/file/{ino}/download"), &to)?;
                Ok(to)
            }
            several => {
                let dir = folder.join(&name);
                fs::create_dir_all(&dir)?;
                for (n, (_, ino, filename)) in several.iter().enumerate() {
                    // Numbered, so the parts keep their order whatever they're called.
                    let to = dir.join(format!("{:03} {}", n + 1, safe_file(filename)));
                    self.save(&format!("/api/items/{id}/file/{ino}/download"), &to)?;
                }
                Ok(dir)
            }
        }
    }

    fn save(&mut self, path: &str, to: &Path) -> Result<()> {
        let mut answer = self.get_raw(path)?;
        let written = (|| -> Result<u64> {
            let mut out = fs::File::create(to)?;
            let n = std::io::copy(&mut answer.body_mut().with_config().limit(u64::MAX).reader(), &mut out)?;
            out.flush()?;
            Ok(n)
        })();
        match written {
            Ok(n) if n > 0 => Ok(()),
            Ok(_) => {
                let _ = fs::remove_file(to);
                Err(Error::Unsuitable("The server sent an empty file.".into()))
            }
            Err(e) => {
                let _ = fs::remove_file(to);
                Err(e)
            }
        }
    }

    /// An audiobook to play straight from the server, with where you are in it there.
    pub fn remote_book(&mut self, catalog: &str, item: &str) -> Result<RemoteBook> {
        let body = self.call("GET", &format!("/api/items/{item}?expanded=1"), None)?;
        // No place kept on the server yet is a 404.
        let seconds = self.call("GET", &format!("/api/me/progress/{item}"), None).ok().and_then(|p| p.get("currentTime").and_then(Value::as_f64)).unwrap_or(0.0);
        remote_book_from(&stream_id(catalog, item), item, &body, seconds)
    }

    /// Bytes `start..=end` of one of a book's sound files.
    pub fn read_range(&mut self, item: &str, ino: &str, start: u64, end: u64) -> Result<Vec<u8>> {
        let path = format!("/api/items/{item}/file/{ino}");
        for attempt in 0..2 {
            let answer = agent()
                .get(format!("{}{path}", self.base))
                .header("Authorization", &format!("Bearer {}", self.token))
                .header("Range", &format!("bytes={start}-{end}"))
                .call()
                .map_err(offline)?;
            let status = answer.status().as_u16();
            match status {
                206 | 200 => {
                    let want = end + 1 - start;
                    use std::io::Read;
                    let mut body = answer.into_body();
                    let mut reader = body.with_config().limit(u64::MAX).reader();
                    // A server that ignores ranges sends it all: skip to the start.
                    if status == 200 && start > 0 {
                        std::io::copy(&mut (&mut reader).take(start), &mut std::io::sink())?;
                    }
                    let mut bytes = Vec::with_capacity(want as usize);
                    reader.take(want).read_to_end(&mut bytes)?;
                    return Ok(bytes);
                }
                401 if attempt == 0 && self.renew()? => continue,
                403 => return Err(Error::Unsuitable("Your Audiobookshelf account isn't allowed to play that.".into())),
                _ => return Err(Error::Cloud(format!("Audiobookshelf wouldn't send the audio (status {status})"))),
            }
        }
        unreachable!()
    }

    /// Keeps where you are in a book played from the server, on the server.
    pub fn keep_place(&mut self, item: &str, position_ms: u64, duration_ms: u64) -> Result<()> {
        let seconds = position_ms as f64 / 1000.0;
        let duration = duration_ms as f64 / 1000.0;
        let progress = if duration > 0.0 { (seconds / duration).clamp(0.0, 1.0) } else { 0.0 };
        self.call(
            "PATCH",
            &format!("/api/me/progress/{item}"),
            Some(&json!({ "currentTime": seconds, "duration": duration, "progress": progress, "isFinished": duration > 0.0 && seconds >= duration - 1.0 })),
        )?;
        Ok(())
    }

    /// The book's cover, as the server has it.
    pub fn cover(&mut self, item: &str) -> Result<Vec<u8>> {
        let mut answer = self.get_raw(&format!("/api/items/{item}/cover?width=600&format=jpeg"))?;
        answer.body_mut().with_config().limit(8 * 1024 * 1024).read_to_vec().map_err(offline)
    }

    /// Every book on the server, for matching TBV's audiobooks to: the id,
    /// title and authors. Kept for a while, since a big server has thousands.
    fn index(&mut self) -> Result<Vec<Book>> {
        static INDEX: Mutex<Option<HashMap<String, Indexed>>> = Mutex::new(None);
        if let Some((at, list)) = INDEX.lock().ok().and_then(|i| i.as_ref()?.get(&self.id).cloned()) {
            if at.elapsed() < Duration::from_secs(6 * 3600) {
                return Ok(list);
            }
        }
        let body = self.call("GET", "/api/libraries", None)?;
        let mut list = Vec::new();
        for library in body.get("libraries").and_then(Value::as_array).into_iter().flatten() {
            if library.get("mediaType").and_then(Value::as_str) == Some("podcast") {
                continue;
            }
            let Some(id) = library.get("id").and_then(Value::as_str) else { continue };
            let items = self.call("GET", &format!("/api/libraries/{id}/items?limit=0&minified=1"), None)?;
            for item in items.get("results").and_then(Value::as_array).into_iter().flatten() {
                let audio = item.pointer("/media/duration").and_then(Value::as_f64).unwrap_or(0.0) > 0.0 || item.pointer("/media/numAudioFiles").and_then(Value::as_u64).unwrap_or(0) > 0;
                if let (true, Some(id)) = (audio, item.get("id").and_then(Value::as_str)) {
                    list.push((id.to_string(), meta(item, "title").unwrap_or_default(), meta(item, "authorName").unwrap_or_default()));
                }
            }
        }
        if let Ok(mut i) = INDEX.lock() {
            i.get_or_insert_with(HashMap::new).insert(self.id.clone(), (Instant::now(), list.clone()));
        }
        Ok(list)
    }

    /// Where you are in each book on the server: seconds, and when (ms since 1970).
    fn progress(&mut self) -> Result<HashMap<String, Progress>> {
        let me = self.call("GET", "/api/me", None)?;
        Ok(me
            .get("mediaProgress")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter(|p| p.get("episodeId").is_none_or(Value::is_null))
            .filter_map(|p| {
                Some((
                    p.get("libraryItemId")?.as_str()?.to_string(),
                    Progress {
                        seconds: p.get("currentTime").and_then(Value::as_f64).unwrap_or(0.0),
                        duration: p.get("duration").and_then(Value::as_f64).unwrap_or(0.0),
                        at_ms: p.get("lastUpdate").and_then(Value::as_i64).unwrap_or(0),
                    },
                ))
            })
            .collect())
    }
}

/// What the server says about a book, as an audiobook to play from it.
fn remote_book_from(id: &str, item: &str, body: &Value, seconds: f64) -> Result<RemoteBook> {
    let media = body.get("media").ok_or_else(|| Error::Unsuitable("That isn't a book on the server.".into()))?;
    let mut files: Vec<&Value> = media
        .get("audioFiles")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|f| f.get("exclude").and_then(Value::as_bool) != Some(true))
        .collect();
    files.sort_by_key(|f| f.get("index").and_then(Value::as_u64).unwrap_or(0));
    if files.is_empty() {
        return Err(Error::Unsuitable("That book has no audio on the server.".into()));
    }
    let mut parts = Vec::new();
    let mut player_parts = Vec::new();
    let mut at = 0u64;
    for f in files {
        let ino = f.get("ino").and_then(Value::as_str).unwrap_or_default().to_string();
        let name = f.pointer("/metadata/filename").and_then(Value::as_str).unwrap_or("part").to_string();
        let ext = f.pointer("/metadata/ext").and_then(Value::as_str).map(|e| e.trim_start_matches('.').to_ascii_lowercase()).unwrap_or_else(|| "mp3".into());
        let duration_ms = (f.get("duration").and_then(Value::as_f64).unwrap_or(0.0) * 1000.0).round() as u64;
        parts.push(RemotePart { ino, size: f.pointer("/metadata/size").and_then(Value::as_u64).unwrap_or(0), ext });
        player_parts.push(crate::audio::Part { name, start_ms: at, duration_ms });
        at += duration_ms;
    }
    let duration_ms = at;
    let mut chapters: Vec<crate::audio::Chapter> = media
        .get("chapters")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|c| Some(crate::audio::Chapter { title: c.get("title")?.as_str()?.to_string(), start_ms: (c.get("start")?.as_f64()? * 1000.0).round() as u64 }))
        .collect();
    if chapters.is_empty() {
        chapters = player_parts.iter().map(|p| crate::audio::Chapter { title: p.name.clone(), start_ms: p.start_ms }).collect();
    }
    let field = |name: &str| media.pointer(&format!("/metadata/{name}"));
    let names = |name: &str| -> Vec<String> {
        match field(name) {
            Some(Value::Array(list)) => list.iter().filter_map(|v| v.get("name").and_then(Value::as_str).or_else(|| v.as_str()).map(str::to_string)).collect(),
            Some(Value::String(s)) => s.split(", ").map(str::to_string).collect(),
            _ => Vec::new(),
        }
    };
    let authors = Some(names("authors")).filter(|a| !a.is_empty()).unwrap_or_else(|| names("authorName"));
    let narrators = Some(names("narrators")).filter(|a| !a.is_empty()).unwrap_or_else(|| names("narratorName"));
    let series = field("series").and_then(Value::as_array).and_then(|s| s.first()).and_then(|s| s.get("name")?.as_str().map(str::to_string));
    let position_ms = ((seconds.max(0.0)) * 1000.0).round() as u64;
    let book = crate::model::BookPreview {
        id: id.to_string(),
        title: field("title").and_then(Value::as_str).unwrap_or("Untitled").to_string(),
        authors,
        cover_path: None,
        format: parts[0].ext.clone(),
        synopsis: field("description").and_then(Value::as_str).map(str::to_string),
        series,
        series_index: None,
        added_at: crate::time::now_utc(),
        last_opened_at: None,
        status: if position_ms > 0 { crate::model::ReadStatus::InProgress } else { crate::model::ReadStatus::Unread },
        total_progression: (duration_ms > 0).then(|| (position_ms as f64 / duration_ms as f64).min(1.0)),
        resume_locator: None,
        availability: crate::model::Availability::Cloud,
        remote_positions: Vec::new(),
        favorite: false,
        want_to_read: false,
        rating: None,
        finished_at: None,
        tags: Vec::new(),
        in_cloud: true,
        genres: field("genres").and_then(Value::as_array).map(|g| g.iter().filter_map(|v| v.as_str().map(str::to_string)).collect()).unwrap_or_default(),
        duration_ms: Some(duration_ms),
        narrators: narrators.clone(),
        language: field("language").and_then(Value::as_str).map(str::to_string),
        paired: false,
        phone_wanted: false,
        phone_has: false,
        pinned_at: None,
    };
    Ok(RemoteBook {
        item: item.to_string(),
        parts,
        audiobook: crate::audio::Audiobook { book, narrators, duration_ms, chapters, parts: player_parts, position_ms, ebook: None },
    })
}

fn safe_file(name: &str) -> String {
    name.chars().map(|c| if c.is_alphanumeric() || " -_.,'()".contains(c) { c } else { '_' }).collect()
}

fn base64(bytes: &[u8]) -> String {
    const ABC: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len() * 4 / 3 + 4);
    for chunk in bytes.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = (b[0] as u32) << 16 | (b[1] as u32) << 8 | b[2] as u32;
        for i in 0..4 {
            out.push(if i <= chunk.len() { ABC[(n >> (18 - 6 * i) & 63) as usize] as char } else { '=' });
        }
    }
    out
}

/// A book on the server: its id, title and authors.
type Book = (String, String, String);
/// A server's books, and when they were fetched.
type Indexed = (Instant, Vec<Book>);

#[derive(Debug, Clone, Copy, PartialEq)]
struct Progress {
    seconds: f64,
    duration: f64,
    at_ms: i64,
}

/// One of TBV's audiobooks, for keeping its place in step.
#[derive(Debug, Clone)]
pub struct Listening {
    pub book_id: String,
    pub title: String,
    pub authors: Vec<String>,
    pub position_ms: u64,
    pub duration_ms: u64,
    /// When it was last listened to here, in ms since 1970.
    pub at_ms: i64,
}

/// What keeping places in step should change here.
#[derive(Debug, Clone, PartialEq)]
pub struct Moved {
    pub book_id: String,
    pub position_ms: u64,
    pub at_ms: i64,
}

/// Matches TBV's audiobooks to the server's books by title and author.
fn matches(books: &[Listening], index: &[Book]) -> HashMap<String, String> {
    let mut by_title: HashMap<String, Vec<(&str, &str)>> = HashMap::new();
    for (id, title, authors) in index {
        by_title.entry(key(title)).or_default().push((id.as_str(), authors.as_str()));
    }
    let mut found = HashMap::new();
    for book in books {
        let Some(candidates) = by_title.get(&key(&book.title)) else { continue };
        let theirs = book.authors.first().map(|a| surname(a)).unwrap_or_default();
        let hit = candidates.iter().find(|(_, authors)| theirs.is_empty() || authors.split(", ").any(|a| surname(a) == theirs)).or(if candidates.len() == 1 && theirs.is_empty() { candidates.first() } else { None });
        if let Some((id, _)) = hit {
            found.insert(book.book_id.clone(), id.to_string());
        }
    }
    found
}

/// Keeps listening places the same here and on the server: the one moved
/// last wins. Gives the places to change here.
pub fn keep_places(server: &mut Server, books: &[Listening]) -> Result<Vec<Moved>> {
    if books.is_empty() {
        return Ok(Vec::new());
    }
    let index = server.index()?;
    let pairs = matches(books, &index);
    if pairs.is_empty() {
        return Ok(Vec::new());
    }
    let progress = server.progress()?;
    let mut here = Vec::new();
    for book in books {
        let Some(item) = pairs.get(&book.book_id) else { continue };
        let theirs = progress.get(item).copied();
        let ours_s = book.position_ms as f64 / 1000.0;
        match theirs {
            // Moved there since it was last listened to here.
            Some(p) if p.at_ms > book.at_ms + 5_000 && (p.seconds - ours_s).abs() > 2.0 => {
                here.push(Moved { book_id: book.book_id.clone(), position_ms: (p.seconds * 1000.0) as u64, at_ms: p.at_ms });
            }
            // Moved here since; or not started there.
            Some(p) if book.at_ms > p.at_ms + 5_000 && (p.seconds - ours_s).abs() > 2.0 => send(server, item, ours_s, book, p.duration)?,
            None if book.position_ms > 0 => send(server, item, ours_s, book, 0.0)?,
            _ => {}
        }
    }
    Ok(here)
}

fn send(server: &mut Server, item: &str, seconds: f64, book: &Listening, their_duration: f64) -> Result<()> {
    let duration = if book.duration_ms > 0 { book.duration_ms as f64 / 1000.0 } else { their_duration };
    let progress = if duration > 0.0 { (seconds / duration).clamp(0.0, 1.0) } else { 0.0 };
    server.call("PATCH", &format!("/api/me/progress/{item}"), Some(&json!({ "currentTime": seconds, "duration": duration, "progress": progress })))?;
    Ok(())
}

impl crate::library::Library {
    /// TBV's audiobooks, with where each is up to, for keeping places in step.
    pub fn listening_places(&self) -> Result<Vec<Listening>> {
        let mut statement = self.conn.prepare(
            "SELECT b.id, b.title, b.authors, b.resume_locator, b.last_opened_at, a.duration_ms
             FROM books b JOIN audiobooks a ON a.book_id = b.id
             WHERE b.deleted_at IS NULL AND b.same_as IS NULL",
        )?;
        let rows = statement.query_map([], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, Option<String>>(2)?, r.get::<_, Option<String>>(3)?, r.get::<_, Option<String>>(4)?, r.get::<_, i64>(5)?))
        })?;
        let mut books = Vec::new();
        for row in rows {
            let (book_id, title, authors, locator, opened, duration) = row?;
            let position_ms = locator.and_then(|l| serde_json::from_str::<crate::model::ReaderLocator>(&l).ok()).and_then(|l| l.audio_ms).unwrap_or(0);
            let at_ms = opened.and_then(|o| chrono::DateTime::parse_from_rfc3339(&o).ok()).map(|t| t.timestamp_millis()).unwrap_or(0);
            books.push(Listening { book_id, title, authors: authors.and_then(|a| serde_json::from_str(&a).ok()).unwrap_or_default(), position_ms, duration_ms: duration.max(0) as u64, at_ms });
        }
        Ok(books)
    }

    /// Takes a listening place from the server, dated when it moved there,
    /// unless the book was listened to here since (while TBV was asking).
    pub fn take_listening_place(&self, moved: &Moved) -> Result<()> {
        let opened: Option<String> = self.conn.query_row("SELECT last_opened_at FROM books WHERE id = ?1", [&moved.book_id], |r| r.get(0)).optional()?.flatten();
        let here_ms = opened.and_then(|o| chrono::DateTime::parse_from_rfc3339(&o).ok()).map(|t| t.timestamp_millis()).unwrap_or(0);
        if here_ms >= moved.at_ms {
            return Ok(());
        }
        self.save_listening(&moved.book_id, moved.position_ms, None)?;
        let at = chrono::DateTime::from_timestamp_millis(moved.at_ms).map(|t| t.to_rfc3339_opts(chrono::SecondsFormat::Millis, true)).unwrap_or_else(crate::time::now_utc);
        self.conn.execute("UPDATE books SET last_opened_at = ?2 WHERE id = ?1", rusqlite::params![moved.book_id, at])?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn book(id: &str, title: &str, author: &str, position_ms: u64, at_ms: i64) -> Listening {
        Listening { book_id: id.into(), title: title.into(), authors: vec![author.into()], position_ms, duration_ms: 3_600_000, at_ms }
    }

    #[test]
    fn a_server_book_plays_from_its_files_in_order() {
        assert_eq!(parse_stream_id(&stream_id("cat1", "li_9")), Some(("cat1".into(), "li_9".into())));
        assert_eq!(parse_stream_id("abs~nothing"), None);
        let body = json!({
            "media": {
                "metadata": { "title": "Dracula", "authors": [{ "name": "Bram Stoker" }], "narrators": ["Greg Wagland"], "genres": ["Horror"] },
                "chapters": [],
                "audioFiles": [
                    { "index": 2, "ino": "b", "duration": 60.5, "metadata": { "filename": "02.mp3", "ext": ".mp3", "size": 900 } },
                    { "index": 1, "ino": "a", "duration": 30.0, "metadata": { "filename": "01.mp3", "ext": ".mp3", "size": 450 } },
                    { "index": 3, "ino": "x", "duration": 5.0, "exclude": true, "metadata": { "filename": "extra.mp3" } }
                ]
            }
        });
        let book = remote_book_from("abs~c~i", "i", &body, 45.0).unwrap();
        assert_eq!(book.parts.iter().map(|p| p.ino.as_str()).collect::<Vec<_>>(), ["a", "b"]);
        assert_eq!(book.audiobook.duration_ms, 90_500);
        assert_eq!(book.audiobook.parts[1].start_ms, 30_000);
        assert_eq!(book.audiobook.chapters.len(), 2, "one chapter per file when the server has none");
        assert_eq!(book.audiobook.position_ms, 45_000);
        assert_eq!(book.audiobook.book.authors, ["Bram Stoker"]);
        assert_eq!(book.audiobook.book.narrators, ["Greg Wagland"]);
        assert_eq!(book.audiobook.book.format, "mp3");
    }

    #[test]
    fn ranges_come_from_the_server_even_when_it_sends_the_whole_file() {
        use std::io::{BufRead, BufReader, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let file = b"0123456789";
        std::thread::spawn(move || {
            for (n, stream) in listener.incoming().take(2).enumerate() {
                let mut stream = stream.unwrap();
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut range = String::new();
                loop {
                    let mut line = String::new();
                    reader.read_line(&mut line).unwrap();
                    if line.to_ascii_lowercase().starts_with("range:") {
                        range = line.trim().to_string();
                    }
                    if line == "\r\n" || line.is_empty() {
                        break;
                    }
                }
                assert_eq!(range.to_ascii_lowercase(), "range: bytes=3-5");
                // The first answers with the range; the second ignores it.
                let (status, body): (&str, &[u8]) = if n == 0 { ("206 Partial Content", &file[3..6]) } else { ("200 OK", file) };
                write!(stream, "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len()).unwrap();
                stream.write_all(body).unwrap();
            }
        });
        let mut server = Server { id: "c".into(), name: "Home".into(), base: format!("http://127.0.0.1:{port}"), token: "t".into(), refresh: String::new() };
        assert_eq!(server.read_range("li", "1", 3, 5).unwrap(), b"345");
        assert_eq!(server.read_range("li", "1", 3, 5).unwrap(), b"345");
    }

    #[test]
    fn addresses_and_sign_ins_are_read() {
        assert_eq!(tidy_address("192.168.1.20:13378/").unwrap(), "http://192.168.1.20:13378");
        assert_eq!(tidy_address("https://abs.example.com/login").unwrap(), "https://abs.example.com");
        assert!(tidy_address("ftp://x").is_err());
        assert_eq!(tokens_from(&json!({ "user": { "token": "old", "accessToken": "new", "refreshToken": "r" } })), Some(("old".into(), String::new())));
        assert_eq!(tokens_from(&json!({ "user": { "accessToken": "new", "refreshToken": "r" } })), Some(("new".into(), "r".into())));
        let (path, q) = parse_address("abs:library/lib1?page=2&q=dune%20messiah");
        assert_eq!((path.as_str(), q["page"].as_str(), q["q"].as_str()), ("library/lib1", "2", "dune messiah"));
    }

    #[test]
    fn server_books_become_entries_with_their_files() {
        let item = json!({ "id": "li_1", "media": { "metadata": { "title": "Dune", "authorName": "Frank Herbert", "narratorName": "Scott Brick", "seriesName": "Dune #1" }, "numAudioFiles": 3, "ebookFormat": "epub", "duration": 75000.0 } });
        let e = entry(&item, None).unwrap();
        assert_eq!(e.authors, ["Frank Herbert"]);
        assert_eq!(e.files.iter().map(|f| f.label.clone().unwrap()).collect::<Vec<_>>(), ["Audiobook", "Ebook"]);
        assert!(e.summary.unwrap().starts_with("Read by Scott Brick. Series: Dune #1."));
    }

    #[test]
    fn audiobooks_are_matched_by_title_and_author() {
        let index = vec![
            ("li_1".to_string(), "Dune".to_string(), "Frank Herbert".to_string()),
            ("li_2".to_string(), "The Left Hand of Darkness".to_string(), "Ursula K. Le Guin".to_string()),
            ("li_3".to_string(), "Dune".to_string(), "Someone Else".to_string()),
        ];
        let books = vec![book("b1", "Dune", "Herbert, Frank", 0, 0), book("b2", "Left Hand of Darkness: A Novel", "Ursula K. Le Guin", 0, 0), book("b3", "Emma", "Jane Austen", 0, 0)];
        let found = matches(&books, &index);
        assert_eq!(found.get("b1").map(String::as_str), Some("li_1"));
        assert_eq!(found.get("b2").map(String::as_str), Some("li_2"));
        assert!(!found.contains_key("b3"));
    }
}

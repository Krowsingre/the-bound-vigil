//! "Use on my phone at home": the computer serves TBV to a phone on the same
//! Wi-Fi. The phone opens the computer's address in its browser and gets
//! the same pages, reading the library straight from this computer, so books
//! and audiobooks in a cloud app's folder (iCloud, say) reach it without
//! going through Supabase.
//!
//! A phone pairs once with a short code shown here (the QR code carries it)
//! and is given a key it sends with every request after. Without a key only
//! the pages themselves load. Only reading and listening are offered:
//! changing the library is left to the computer.

use std::io::{BufReader, Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream, UdpSocket};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};
use tbv_core::http::{body_reader, read_head, Request};

use crate::AppLibrary;

/// The port phones reach TBV on.
pub const PORT: u16 = 53318;
const ON: &str = "home.on";
const PHONES: &str = "home.phones";
/// Wrong codes allowed before the code stops working.
const TRIES: u32 = 5;
const MAX_BODY: u64 = 8 * 1024 * 1024;

/// What Settings shows.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HomeStatus {
    pub on: bool,
    /// Addresses to open on the phone, best first.
    pub addresses: Vec<String>,
    /// The pairing code, while one is offered.
    pub code: Option<String>,
    /// A QR code (SVG) that opens the first address and pairs.
    pub qr: Option<String>,
    pub phones: usize,
    /// Why it couldn't start, in words.
    pub problem: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Phone {
    key: String,
    paired_at: String,
}

struct Running {
    stop: Arc<AtomicBool>,
}

impl Drop for Running {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        let _ = TcpStream::connect_timeout(&SocketAddr::from((Ipv4Addr::LOCALHOST, PORT)), Duration::from_millis(200));
    }
}

#[derive(Default)]
pub struct Home {
    running: Mutex<Option<Running>>,
    code: Mutex<Option<(String, u32)>>,
    problem: Mutex<Option<String>>,
}

fn new_code() -> String {
    let n = uuid::Uuid::new_v4().as_u128() % 1_000_000;
    format!("{n:06}")
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// This computer's address on the home network.
fn lan_address() -> Option<Ipv4Addr> {
    // No packet is sent: connecting a UDP socket only picks the way out.
    let socket = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0)).ok()?;
    socket.connect((Ipv4Addr::new(192, 168, 255, 255), 9)).or_else(|_| socket.connect((Ipv4Addr::new(8, 8, 8, 8), 80))).ok()?;
    match socket.local_addr().ok()?.ip() {
        std::net::IpAddr::V4(ip) if !ip.is_loopback() && !ip.is_unspecified() => Some(ip),
        _ => None,
    }
}

fn qr_svg(text: &str) -> Option<String> {
    let code = qrcode::QrCode::new(text.as_bytes()).ok()?;
    Some(code.render::<qrcode::render::svg::Color>().min_dimensions(220, 220).quiet_zone(true).build())
}

impl Home {
    fn phones(app: &AppHandle) -> Vec<Phone> {
        let library = app.state::<AppLibrary>().0.clone();
        let saved = library.lock().ok().and_then(|l| l.setting(PHONES).ok().flatten());
        saved.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
    }

    pub fn status(&self, app: &AppHandle) -> HomeStatus {
        let on = lock(&self.running).is_some();
        let addresses: Vec<String> = if on { lan_address().into_iter().map(|ip| format!("http://{ip}:{PORT}/")).collect() } else { Vec::new() };
        let code = if on { lock(&self.code).as_ref().map(|(c, _)| c.clone()) } else { None };
        let qr = match (addresses.first(), &code) {
            (Some(address), Some(code)) => qr_svg(&format!("{address}#pair={code}")),
            _ => None,
        };
        HomeStatus { on, addresses, code, qr, phones: Self::phones(app).len(), problem: lock(&self.problem).clone() }
    }

    /// Starts serving if it was left on.
    pub fn resume(self: &Arc<Self>, app: &AppHandle) {
        let library = app.state::<AppLibrary>().0.clone();
        let on = library.lock().ok().and_then(|l| l.setting(ON).ok().flatten()).is_some_and(|v| v == "1");
        if on {
            let _ = self.set(app, true);
        }
    }

    pub fn set(self: &Arc<Self>, app: &AppHandle, on: bool) -> HomeStatus {
        let library = app.state::<AppLibrary>().0.clone();
        if let Ok(l) = library.lock() {
            let _ = l.set_setting(ON, if on { "1" } else { "0" });
        }
        *lock(&self.running) = None;
        *lock(&self.problem) = None;
        if on {
            match self.start(app) {
                Ok(running) => {
                    *lock(&self.running) = Some(running);
                    *lock(&self.code) = Some((new_code(), 0));
                }
                Err(e) => *lock(&self.problem) = Some(format!("TBV couldn't open port {PORT} for the phone: {e}")),
            }
        }
        self.status(app)
    }

    /// A new pairing code, for another phone.
    pub fn new_code(&self, app: &AppHandle) -> HomeStatus {
        if lock(&self.running).is_some() {
            *lock(&self.code) = Some((new_code(), 0));
        }
        self.status(app)
    }

    /// Every paired phone has to pair again.
    pub fn forget_phones(&self, app: &AppHandle) -> HomeStatus {
        let library = app.state::<AppLibrary>().0.clone();
        if let Ok(l) = library.lock() {
            let _ = l.set_setting(PHONES, "[]");
        }
        self.status(app)
    }

    fn start(self: &Arc<Self>, app: &AppHandle) -> std::io::Result<Running> {
        let listener = TcpListener::bind((Ipv4Addr::UNSPECIFIED, PORT))?;
        let stop = Arc::new(AtomicBool::new(false));
        let (home, app, stopping) = (self.clone(), app.clone(), stop.clone());
        thread::spawn(move || {
            for stream in listener.incoming() {
                if stopping.load(Ordering::SeqCst) {
                    break;
                }
                let Ok(stream) = stream else { continue };
                let (home, app, stopped) = (home.clone(), app.clone(), stopping.clone());
                thread::spawn(move || {
                    let _ = home.serve(&app, stream, &stopped);
                });
            }
        });
        Ok(Running { stop })
    }

    /// Answers requests on one connection until the phone closes it, or
    /// serving is turned off.
    fn serve(&self, app: &AppHandle, stream: TcpStream, stopped: &AtomicBool) -> std::io::Result<()> {
        stream.set_read_timeout(Some(Duration::from_secs(15)))?;
        let mut reader = BufReader::new(stream.try_clone()?);
        let mut out = stream;
        loop {
            let Ok(Some(request)) = read_head(&mut reader) else { return Ok(()) };
            if stopped.load(Ordering::SeqCst) {
                return Ok(());
            }
            let mut body = Vec::new();
            body_reader(&request, &mut reader).take(MAX_BODY).read_to_end(&mut body)?;
            let reply = self.route(app, &request, &body);
            let close = request.headers.get("connection").is_some_and(|c| c.eq_ignore_ascii_case("close"));
            reply.write(&mut out, request.method == "HEAD")?;
            if close {
                return Ok(());
            }
        }
    }

    fn key_of(request: &Request) -> Option<String> {
        request
            .headers
            .get("authorization")
            .and_then(|a| a.strip_prefix("Bearer "))
            .map(str::to_string)
            .or_else(|| request.query.get("t").cloned())
    }

    fn paired(app: &AppHandle, request: &Request) -> bool {
        let Some(key) = Self::key_of(request) else { return false };
        Self::phones(app).iter().any(|p| p.key == key)
    }

    fn route(&self, app: &AppHandle, request: &Request, body: &[u8]) -> Reply {
        let path = request.path.as_str();
        if request.method == "POST" && path == "/tbv/pair" {
            return self.pair(app, body);
        }
        if let Some(rest) = path.strip_prefix("/tbv/") {
            if !Self::paired(app, request) {
                return Reply::json(401, &json!({ "error": "Pair this phone again in TBV on the computer (Preferences › Sync › Use on your phone at home)." }));
            }
            if let Some(command) = rest.strip_prefix("invoke/") {
                let args: Value = serde_json::from_slice(body).unwrap_or(Value::Null);
                return match tauri::async_runtime::block_on(dispatch(app, command, args)) {
                    Ok(Answer::Json(value)) => Reply::json(200, &value),
                    Ok(Answer::Bytes(bytes)) => Reply::new(200, "application/octet-stream", bytes),
                    Err(e) => Reply::json(400, &json!({ "error": e })),
                };
            }
            if rest == "file" {
                return file(app, request.query.get("path").map(String::as_str).unwrap_or_default());
            }
            if let Some(part) = rest.strip_prefix("audio/") {
                return audio(app, request, part);
            }
            return Reply::json(404, &json!({ "error": "not found" }));
        }
        page(app, path)
    }

    /// Checks a code a phone sent. Each code pairs one phone, and too many
    /// wrong ones end it.
    fn take_code(&self, tried: &str) -> Result<(), &'static str> {
        let mut code = lock(&self.code);
        let Some((wanted, wrong)) = code.as_mut() else {
            return Err("Ask TBV on the computer for a new code (Preferences › Sync › Use on your phone at home).");
        };
        if tried.trim() == wanted.as_str() {
            *code = None;
            return Ok(());
        }
        *wrong += 1;
        if *wrong >= TRIES {
            *code = None;
            return Err("Too many wrong codes. Ask TBV on the computer for a new one.");
        }
        Err("That code isn't right. Check the one TBV shows on the computer.")
    }

    fn pair(&self, app: &AppHandle, body: &[u8]) -> Reply {
        let tried: String = serde_json::from_slice::<Value>(body).ok().and_then(|v| v["code"].as_str().map(str::to_string)).unwrap_or_default();
        if let Err(why) = self.take_code(&tried) {
            return Reply::json(403, &json!({ "error": why }));
        }
        let key = format!("{}{}", uuid::Uuid::new_v4().simple(), uuid::Uuid::new_v4().simple());
        let mut phones = Self::phones(app);
        phones.push(Phone { key: key.clone(), paired_at: tbv_core::time::now_utc().to_string() });
        let library = app.state::<AppLibrary>().0.clone();
        let saved = library.lock().ok().map(|l| l.set_setting(PHONES, &serde_json::to_string(&phones).unwrap_or_default()));
        if !matches!(saved, Some(Ok(()))) {
            return Reply::json(500, &json!({ "error": "TBV couldn't remember this phone." }));
        }
        // Settings shows the phone straight away.
        let _ = app.emit("home-changed", ());
        Reply::json(200, &json!({ "key": key }))
    }
}

/// An HTTP answer.
struct Reply {
    status: u16,
    mime: String,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
}

impl Reply {
    fn new(status: u16, mime: &str, body: Vec<u8>) -> Self {
        Self { status, mime: mime.into(), headers: Vec::new(), body }
    }

    fn json(status: u16, value: &Value) -> Self {
        Self::new(status, "application/json", serde_json::to_vec(value).unwrap_or_default())
    }

    fn write(&self, out: &mut TcpStream, head_only: bool) -> std::io::Result<()> {
        let reason = match self.status {
            200 => "OK",
            206 => "Partial Content",
            401 => "Unauthorized",
            403 => "Forbidden",
            404 => "Not Found",
            416 => "Range Not Satisfiable",
            _ => "Error",
        };
        let mut head = format!(
            "HTTP/1.1 {} {reason}\r\nContent-Type: {}\r\nContent-Length: {}\r\nX-Content-Type-Options: nosniff\r\n",
            self.status,
            self.mime,
            self.body.len()
        );
        for (name, value) in &self.headers {
            head.push_str(&format!("{name}: {value}\r\n"));
        }
        head.push_str("\r\n");
        out.write_all(head.as_bytes())?;
        if !head_only {
            out.write_all(&self.body)?;
        }
        out.flush()
    }
}

/// The app's own pages and their scripts, as built into TBV.
fn page(app: &AppHandle, path: &str) -> Reply {
    let resolver = app.asset_resolver();
    let wanted = path.trim_start_matches('/');
    let asset = (!wanted.is_empty()).then(|| resolver.get(wanted.to_string())).flatten();
    match asset {
        Some(asset) => {
            let mut reply = Reply::new(200, &asset.mime_type, asset.bytes);
            if wanted.starts_with("assets/") {
                reply.headers.push(("Cache-Control".into(), "max-age=31536000, immutable".into()));
            }
            reply
        }
        None => {
            // Everything else is the app itself, marked as served to a phone.
            let Some(index) = resolver.get("index.html".to_string()) else { return Reply::json(404, &json!({ "error": "not found" })) };
            let html = mark_index(&String::from_utf8_lossy(&index.bytes));
            let mut reply = Reply::new(200, "text/html; charset=utf-8", html.into_bytes());
            reply.headers.push(("Cache-Control".into(), "no-cache".into()));
            reply
        }
    }
}

/// The file, if it's inside one of the folders.
fn allowed(path: &str, roots: &[std::path::PathBuf]) -> Option<std::path::PathBuf> {
    let real = std::fs::canonicalize(path).ok()?;
    roots.iter().filter_map(|r| std::fs::canonicalize(r).ok()).any(|root| real.starts_with(root)).then_some(real)
}

/// The app's page, marked as served to a phone so it pairs and talks to this computer.
fn mark_index(html: &str) -> String {
    html.replacen("<head>", "<head><meta name=\"tbv-home\" content=\"1\">", 1)
}

/// A cover or picture TBV keeps, and nothing else on the computer.
fn file(app: &AppHandle, path: &str) -> Reply {
    let library = app.state::<AppLibrary>().0.clone();
    let roots = match library.lock() {
        Ok(l) => {
            let p = l.paths();
            vec![p.covers_dir.clone(), p.pictures_dir.clone(), p.profile_dir.clone()]
        }
        Err(_) => return Reply::json(503, &json!({ "error": "the library is unavailable" })),
    };
    let Some(real) = allowed(path, &roots) else { return Reply::json(404, &json!({ "error": "not found" })) };
    let mime = match real.extension().map(|e| e.to_string_lossy().to_ascii_lowercase()).as_deref() {
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("png") => "image/png",
        Some("webp") => "image/webp",
        Some("gif") => "image/gif",
        _ => "application/octet-stream",
    };
    match std::fs::read(&real) {
        Ok(bytes) => {
            let mut reply = Reply::new(200, mime, bytes);
            reply.headers.push(("Cache-Control".into(), "max-age=86400".into()));
            reply
        }
        Err(_) => Reply::json(404, &json!({ "error": "not found" })),
    }
}

/// Part of an audiobook, the same way the computer's own player gets it.
fn audio(app: &AppHandle, request: &Request, part: &str) -> Reply {
    let library = app.state::<AppLibrary>().0.clone();
    let mut asked = tauri::http::Request::builder().uri(format!("http://tbvaudio.localhost/{part}"));
    if let Some(range) = request.headers.get("range") {
        asked = asked.header(tauri::http::header::RANGE, range);
    }
    let Ok(asked) = asked.body(Vec::new()) else { return Reply::json(400, &json!({ "error": "bad request" })) };
    match crate::audio::answer(&library, &asked) {
        Ok(answer) => {
            let mime = answer.headers().get(tauri::http::header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).unwrap_or("audio/mpeg").to_string();
            let mut reply = Reply::new(answer.status().as_u16(), &mime, answer.body().clone());
            for name in [tauri::http::header::CONTENT_RANGE, tauri::http::header::ACCEPT_RANGES] {
                if let Some(value) = answer.headers().get(&name).and_then(|v| v.to_str().ok()) {
                    reply.headers.push((name.to_string(), value.to_string()));
                }
            }
            reply
        }
        Err((status, why)) => Reply::new(status.as_u16(), "text/plain", why.into_bytes()),
    }
}

enum Answer {
    Json(Value),
    Bytes(Vec<u8>),
}

fn arg<T: serde::de::DeserializeOwned>(args: &Value, name: &str) -> Result<T, String> {
    serde_json::from_value(args.get(name).cloned().unwrap_or(Value::Null)).map_err(|e| format!("{name}: {e}"))
}

fn answer<T: Serialize>(result: crate::CommandResult<T>) -> Result<Answer, String> {
    result.and_then(|v| serde_json::to_value(v).map_err(|e| e.to_string())).map(Answer::Json)
}

/// The commands a phone may use: reading, listening, notes and your own
/// marks on books. Anything else is done on the computer.
async fn dispatch(app: &AppHandle, command: &str, a: Value) -> Result<Answer, String> {
    use crate::*;
    let s = || app.state::<AppLibrary>();
    match command {
        "get_home" => answer(get_home(s()).await),
        "get_library" => answer(get_library(s(), arg(&a, "query")?).await),
        "get_collections" => answer(get_collections(s()).await),
        "get_collections_overview" => answer(get_collections_overview(s()).await),
        "get_collection" => answer(get_collection(s(), arg(&a, "collection")?).await),
        "collections_for_book" => answer(collections_for_book(s(), arg(&a, "bookId")?).await),
        "book_details" => answer(book_details(s(), arg(&a, "bookId")?).await),
        "open_book" => answer(open_book(s(), arg(&a, "bookId")?).await),
        "read_book_file" => book_bytes(s(), arg(&a, "bookId")?).await.map(Answer::Bytes),
        "book_text" => answer(book_text(s(), arg(&a, "bookId")?).await),
        "save_position" => answer(save_position(s(), arg(&a, "bookId")?, arg(&a, "locator")?).await),
        "get_annotations" => answer(get_annotations(s(), arg(&a, "bookId")?).await),
        "save_annotation" => answer(save_annotation(s(), arg(&a, "annotation")?).await),
        "delete_annotation" => answer(delete_annotation(s(), arg(&a, "id")?).await),
        "set_annotation_note" => answer(set_annotation_note(s(), arg(&a, "id")?, arg(&a, "note")?).await),
        "get_notes" => answer(get_notes(s(), arg(&a, "query")?).await),
        "save_book_note" => answer(save_book_note(s(), arg(&a, "bookId")?, arg(&a, "id")?, arg(&a, "text")?).await),
        "save_personal_note" => answer(save_personal_note(s(), arg(&a, "id")?, arg(&a, "title")?, arg(&a, "body")?).await),
        "delete_note" => answer(delete_note(s(), arg(&a, "id")?, arg(&a, "kind")?).await),
        "audiobook" => answer(audiobook(s(), arg(&a, "bookId")?).await),
        "prepare_stream" => answer(prepare_stream(s(), arg(&a, "bookId")?).await),
        "save_listening" => answer(save_listening(s(), arg(&a, "bookId")?, arg(&a, "positionMs")?, arg(&a, "chapter")?).await),
        "add_time" => answer(add_time(s(), arg(&a, "day")?, arg(&a, "kind")?, arg(&a, "seconds")?).await),
        "time_spent" => answer(time_spent(s()).await),
        "link_ebook" => answer(link_ebook(s(), arg(&a, "audiobookId")?, arg(&a, "ebookId")?).await),
        "audiobook_for_ebook" => answer(audiobook_for_ebook(s(), arg(&a, "ebookId")?).await),
        "set_book_status" => answer(set_book_status(s(), arg(&a, "bookId")?, arg(&a, "status")?).await),
        "set_favorite" => answer(set_favorite(s(), arg(&a, "bookId")?, arg(&a, "favorite")?).await),
        "set_want_to_read" => answer(set_want_to_read(s(), arg(&a, "bookId")?, arg(&a, "want")?).await),
        "set_rating" => answer(set_rating(app.clone(), app.state(), s(), arg(&a, "bookId")?, arg(&a, "rating")?).await),
        "get_profile" => answer(get_profile(s()).await),
        "get_setting" => answer(get_setting(s(), arg(&a, "key")?).await),
        // The phone's own choices (theme, text size) stay on the phone.
        "set_setting" => Ok(Answer::Json(Value::Null)),
        "all_tags" => answer(all_tags(s()).await),
        "cover_accent" => answer(cover_accent(s(), arg(&a, "bookId")?).await),
        "series_review" => answer(series_review(s(), arg(&a, "name")?).await),
        "library_info" => answer(library_info(s()).await),
        _ => Err("This is done in TBV on the computer.".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_code_pairs_one_phone_and_wrong_ones_run_out() {
        let home = Home::default();
        assert!(home.take_code("123456").is_err(), "no code offered yet");
        *lock(&home.code) = Some(("482913".into(), 0));
        assert!(home.take_code("000000").is_err());
        assert!(home.take_code(" 482913 ").is_ok());
        assert!(home.take_code("482913").is_err(), "each code pairs one phone");

        *lock(&home.code) = Some(("111111".into(), 0));
        for _ in 0..TRIES {
            assert!(home.take_code("222222").is_err());
        }
        assert!(home.take_code("111111").is_err(), "too many wrong codes end it");
        assert_eq!(new_code().len(), 6);
    }

    #[test]
    fn only_tbvs_own_pictures_are_served() {
        let dir = tempfile::tempdir().unwrap();
        let covers = dir.path().join("covers");
        std::fs::create_dir(&covers).unwrap();
        std::fs::write(covers.join("a.jpg"), b"jpg").unwrap();
        std::fs::write(dir.path().join("secret.txt"), b"no").unwrap();
        let roots = vec![covers.clone()];
        assert!(allowed(covers.join("a.jpg").to_str().unwrap(), &roots).is_some());
        assert!(allowed(dir.path().join("secret.txt").to_str().unwrap(), &roots).is_none());
        assert!(allowed(covers.join("../secret.txt").to_str().unwrap(), &roots).is_none());
        assert!(allowed("", &roots).is_none());
    }

    #[test]
    fn the_page_is_marked_for_the_phone_and_commands_read_their_arguments() {
        assert_eq!(mark_index("<html><head><title>T</title>"), "<html><head><meta name=\"tbv-home\" content=\"1\"><title>T</title>");
        let args = json!({ "bookId": "sha256:1", "positionMs": 5 });
        assert_eq!(arg::<String>(&args, "bookId").unwrap(), "sha256:1");
        assert_eq!(arg::<u64>(&args, "positionMs").unwrap(), 5);
        assert_eq!(arg::<Option<String>>(&args, "chapter").unwrap(), None);
        assert!(arg::<String>(&args, "missing").is_err());
        assert!(qr_svg("http://192.168.1.2:53318/#pair=123456").is_some_and(|svg| svg.contains("<svg")));
    }
}

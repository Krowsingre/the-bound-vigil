//! Receiving books from LocalSend (localsend.org), the free app for sending
//! files between devices on the same Wi-Fi. TBV shows up in LocalSend's list
//! of nearby devices; what someone sends is offered to the person first, and
//! the books they accept go into the import queue.
//!
//! This follows LocalSend's open protocol (version 2): devices find each
//! other by announcing themselves on the local network (UDP multicast), and
//! files are sent over HTTP: `prepare-upload` lists the files and waits for
//! an answer, then each accepted file is `upload`ed. TBV only receives, so it
//! needs no more than a small HTTP server of its own.

use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4, TcpListener, TcpStream, UdpSocket};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use serde::Serialize;
use serde_json::{json, Value};

use crate::error::{Error, Result};

pub const PORT: u16 = 53317;
const MULTICAST: Ipv4Addr = Ipv4Addr::new(224, 0, 0, 167);
/// How long a sender is kept waiting for the person to answer.
const ANSWER_WITHIN: Duration = Duration::from_secs(120);
/// A request or upload that goes quiet this long is given up on.
const IDLE: Duration = Duration::from_secs(60);
/// Requests' own lines and JSON bodies; files are streamed, not held.
const MAX_HEADER: usize = 16 * 1024;
const MAX_JSON: usize = 4 * 1024 * 1024;

/// How TBV shows itself to LocalSend.
#[derive(Debug, Clone)]
pub struct Identity {
    /// The name in LocalSend's device list.
    pub alias: String,
    /// LocalSend tells devices apart by this; kept the same between runs.
    pub fingerprint: String,
    pub port: u16,
}

impl Identity {
    fn info(&self) -> Value {
        json!({
            "alias": self.alias,
            "version": "2.1",
            "deviceModel": "The Bound Vigil",
            "deviceType": "desktop",
            "fingerprint": self.fingerprint,
            "port": self.port,
            "protocol": "http",
            "download": false,
        })
    }
}

/// One file someone wants to send.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OfferedFile {
    pub id: String,
    pub name: String,
    pub size: u64,
    /// Whether TBV can import it. Others are turned down without asking.
    pub importable: bool,
}

/// Files someone wants to send, for the person to accept or turn down.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Offer {
    pub session: String,
    /// The sending device's name, as LocalSend shows it.
    pub from: String,
    pub files: Vec<OfferedFile>,
}

/// What the app does with offers and what arrives.
pub trait Host: Send + Sync {
    /// Asks the person about an offer; true to accept its importable files.
    /// Returning nothing within `ANSWER_WITHIN` turns it down.
    fn ask(&self, offer: Offer, answer: Box<dyn FnOnce(bool) + Send>);
    /// A file has arrived (or a session ended, with `done`), for progress.
    fn progress(&self, session: &str, received: usize, of: usize);
    /// Everything accepted has arrived (or the sender stopped part-way):
    /// `folder` holds what did, to import and then delete.
    fn received(&self, session: &str, folder: PathBuf, files: Vec<PathBuf>);
}

struct Session {
    folder: PathBuf,
    /// Accepted files by LocalSend's id: their name and the token they must come with.
    files: HashMap<String, (String, String)>,
    arrived: Vec<PathBuf>,
}

/// The receiver while it's switched on. Dropping it stops it.
pub struct Receiver {
    stop: Arc<AtomicBool>,
    port: u16,
}

impl Receiver {
    pub fn port(&self) -> u16 {
        self.port
    }
}

impl Drop for Receiver {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        // Wakes the listener so it notices.
        let _ = TcpStream::connect_timeout(&SocketAddr::from((Ipv4Addr::LOCALHOST, self.port)), Duration::from_millis(200));
    }
}

struct State {
    me: Identity,
    host: Arc<dyn Host>,
    /// Where each session's files are put.
    inbox: PathBuf,
    sessions: Mutex<HashMap<String, Session>>,
    stop: Arc<AtomicBool>,
}

/// Starts receiving: listens for LocalSend on `identity.port` and tells
/// nearby devices TBV is here. Files land in folders under `inbox`.
/// `announce` false leaves out the network announcements (for tests).
pub fn start(identity: Identity, inbox: &Path, host: Arc<dyn Host>, announce: bool) -> Result<Receiver> {
    let listener = TcpListener::bind(("0.0.0.0", identity.port)).map_err(|e| {
        Error::Unsuitable(format!(
            "TBV couldn't listen for LocalSend on port {} ({e}). If LocalSend itself is open on this computer, close it and try again.",
            identity.port
        ))
    })?;
    let port = listener.local_addr()?.port();
    let identity = Identity { port, ..identity };
    fs::create_dir_all(inbox)?;
    let stop = Arc::new(AtomicBool::new(false));
    let state = Arc::new(State { me: identity, host, inbox: inbox.to_path_buf(), sessions: Mutex::new(HashMap::new()), stop: stop.clone() });
    {
        let state = state.clone();
        thread::spawn(move || {
            for stream in listener.incoming() {
                if state.stop.load(Ordering::SeqCst) {
                    break;
                }
                let Ok(stream) = stream else { continue };
                let state = state.clone();
                thread::spawn(move || {
                    let _ = serve(&state, stream);
                });
            }
        });
    }
    if announce {
        let state = state.clone();
        thread::spawn(move || discovery(&state));
    }
    Ok(Receiver { stop, port })
}

/// Says TBV is here, and answers devices that announce themselves (a phone
/// opening LocalSend's Send screen, say), as the protocol asks.
fn discovery(state: &State) {
    let socket = (|| -> std::io::Result<UdpSocket> {
        let socket = UdpSocket::bind(SocketAddrV4::new(Ipv4Addr::UNSPECIFIED, state.me.port))?;
        socket.join_multicast_v4(&MULTICAST, &Ipv4Addr::UNSPECIFIED)?;
        socket.set_read_timeout(Some(Duration::from_secs(1)))?;
        Ok(socket)
    })();
    let Ok(socket) = socket else { return };
    let to = SocketAddrV4::new(MULTICAST, state.me.port);
    let message = |announce: bool| {
        let mut info = state.me.info();
        info["announce"] = json!(announce);
        info["announcement"] = json!(announce);
        serde_json::to_vec(&info).unwrap_or_default()
    };
    let _ = socket.send_to(&message(true), to);
    let mut buffer = [0u8; 8192];
    let mut quiet = 0u32;
    while !state.stop.load(Ordering::SeqCst) {
        match socket.recv_from(&mut buffer) {
            Ok((n, _)) => {
                let Ok(heard) = serde_json::from_slice::<Value>(&buffer[..n]) else { continue };
                if heard["fingerprint"].as_str() == Some(state.me.fingerprint.as_str()) {
                    continue;
                }
                let announced = heard["announce"].as_bool().or(heard["announcement"].as_bool()).unwrap_or(false);
                if announced {
                    let _ = socket.send_to(&message(false), to);
                }
            }
            Err(_) => {
                // Now and then, in case a device missed the first announcement.
                quiet += 1;
                if quiet % 30 == 0 {
                    let _ = socket.send_to(&message(true), to);
                }
            }
        }
    }
}

struct Request {
    method: String,
    path: String,
    query: HashMap<String, String>,
    headers: HashMap<String, String>,
}

fn serve(state: &State, stream: TcpStream) -> Result<()> {
    stream.set_read_timeout(Some(IDLE))?;
    let mut reader = BufReader::new(stream.try_clone()?);
    let mut out = stream;
    // One request per connection is plenty: LocalSend opens a fresh one each time.
    let Some(request) = read_head(&mut reader)? else { return Ok(()) };
    let (status, body) = route(state, &request, &mut reader);
    respond(&mut out, status, &body)
}

fn read_head(reader: &mut impl BufRead) -> Result<Option<Request>> {
    let mut line = String::new();
    let mut read = 0;
    if reader.read_line(&mut line)? == 0 {
        return Ok(None);
    }
    let mut parts = line.split_whitespace();
    let (Some(method), Some(target)) = (parts.next(), parts.next()) else { return Ok(None) };
    let (path, query) = target.split_once('?').unwrap_or((target, ""));
    let request_method = method.to_ascii_uppercase();
    let request_path = path.to_string();
    let query = query
        .split('&')
        .filter_map(|pair| pair.split_once('='))
        .map(|(k, v)| (unescape(k), unescape(v)))
        .collect();
    let mut headers = HashMap::new();
    loop {
        let mut header = String::new();
        let n = reader.read_line(&mut header)?;
        read += n;
        if n == 0 || header == "\r\n" || header == "\n" || read > MAX_HEADER {
            break;
        }
        if let Some((name, value)) = header.split_once(':') {
            headers.insert(name.trim().to_ascii_lowercase(), value.trim().to_string());
        }
    }
    Ok(Some(Request { method: request_method, path: request_path, query, headers }))
}

/// `%20` and `+` back into what they stand for.
fn unescape(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => out.push(b' '),
            b'%' if i + 2 < bytes.len() => {
                match u8::from_str_radix(std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or(""), 16) {
                    Ok(b) => {
                        out.push(b);
                        i += 2;
                    }
                    Err(_) => out.push(b'%'),
                }
            }
            b => out.push(b),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// The request's body, whole: sent with a length or in chunks.
fn body_reader<'r>(request: &Request, reader: &'r mut dyn BufRead) -> Box<dyn Read + 'r> {
    if request.headers.get("transfer-encoding").is_some_and(|t| t.eq_ignore_ascii_case("chunked")) {
        Box::new(Chunked { inner: reader, left: 0, done: false })
    } else {
        let length = request.headers.get("content-length").and_then(|l| l.parse::<u64>().ok()).unwrap_or(0);
        Box::new(reader.take(length))
    }
}

struct Chunked<'r> {
    inner: &'r mut dyn BufRead,
    left: u64,
    done: bool,
}

impl Read for Chunked<'_> {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        if self.done {
            return Ok(0);
        }
        if self.left == 0 {
            let mut line = String::new();
            self.inner.read_line(&mut line)?;
            if line.trim().is_empty() {
                // The line ending after the previous chunk.
                line.clear();
                self.inner.read_line(&mut line)?;
            }
            let size = u64::from_str_radix(line.trim().split(';').next().unwrap_or("0"), 16)
                .map_err(|_| std::io::Error::new(std::io::ErrorKind::InvalidData, "bad chunk"))?;
            if size == 0 {
                self.done = true;
                return Ok(0);
            }
            self.left = size;
        }
        let want = buf.len().min(self.left as usize);
        let n = self.inner.read(&mut buf[..want])?;
        if n == 0 {
            return Err(std::io::ErrorKind::UnexpectedEof.into());
        }
        self.left -= n as u64;
        Ok(n)
    }
}

fn read_json(request: &Request, reader: &mut dyn BufRead) -> Option<Value> {
    let mut bytes = Vec::new();
    body_reader(request, reader).take(MAX_JSON as u64).read_to_end(&mut bytes).ok()?;
    serde_json::from_slice(&bytes).ok()
}

fn route(state: &State, request: &Request, reader: &mut dyn BufRead) -> (u16, Value) {
    let path = request.path.trim_end_matches('/');
    match (request.method.as_str(), path) {
        ("POST", "/api/localsend/v2/register") | ("POST", "/api/localsend/v1/register") => {
            let _ = read_json(request, reader);
            (200, state.me.info())
        }
        ("GET", "/api/localsend/v2/info") | ("GET", "/api/localsend/v1/info") => (200, state.me.info()),
        ("POST", "/api/localsend/v2/prepare-upload") => prepare(state, read_json(request, reader)),
        ("POST", "/api/localsend/v2/upload") => upload(state, request, reader),
        ("POST", "/api/localsend/v2/cancel") => {
            if let Some(id) = request.query.get("sessionId") {
                finish(state, id);
            }
            (200, Value::Null)
        }
        _ => (404, json!({ "message": "Not found" })),
    }
}

/// Someone wants to send files: ask the person, and wait for the answer.
fn prepare(state: &State, body: Option<Value>) -> (u16, Value) {
    let Some(body) = body else { return (400, json!({ "message": "Invalid body" })) };
    if state.sessions.lock().map(|s| !s.is_empty()).unwrap_or(true) {
        return (409, json!({ "message": "Blocked by another session" }));
    }
    let from = body["info"]["alias"].as_str().unwrap_or("A nearby device").to_string();
    let mut files: Vec<OfferedFile> = body["files"]
        .as_object()
        .map(|files| {
            files
                .iter()
                .map(|(key, f)| {
                    let name = clean_name(f["fileName"].as_str().unwrap_or(""));
                    OfferedFile {
                        id: f["id"].as_str().unwrap_or(key).to_string(),
                        importable: crate::servers::importable(&name),
                        name,
                        size: f["size"].as_u64().unwrap_or(0),
                    }
                })
                .collect()
        })
        .unwrap_or_default();
    files.sort_by(|a, b| a.name.cmp(&b.name));
    if !files.iter().any(|f| f.importable) {
        return (403, json!({ "message": "TBV only takes books, documents and audiobooks." }));
    }
    let session = crate::ids::new_record_id();
    let (tx, rx) = std::sync::mpsc::channel();
    state.host.ask(
        Offer { session: session.clone(), from, files: files.clone() },
        Box::new(move |yes| {
            let _ = tx.send(yes);
        }),
    );
    if !rx.recv_timeout(ANSWER_WITHIN).unwrap_or(false) {
        return (403, json!({ "message": "Declined" }));
    }
    let folder = state.inbox.join(&session);
    if fs::create_dir_all(&folder).is_err() {
        return (500, json!({ "message": "TBV couldn't make room for the files." }));
    }
    let accepted: HashMap<String, (String, String)> = files
        .into_iter()
        .filter(|f| f.importable)
        .map(|f| (f.id, (f.name, crate::ids::new_record_id())))
        .collect();
    let tokens: serde_json::Map<String, Value> = accepted.iter().map(|(id, (_, token))| (id.clone(), json!(token))).collect();
    if let Ok(mut sessions) = state.sessions.lock() {
        sessions.insert(session.clone(), Session { folder, files: accepted, arrived: Vec::new() });
    }
    (200, json!({ "sessionId": session, "files": tokens }))
}

/// One accepted file arriving.
fn upload(state: &State, request: &Request, reader: &mut dyn BufRead) -> (u16, Value) {
    let q = |k: &str| request.query.get(k).cloned().unwrap_or_default();
    let (session, file, token) = (q("sessionId"), q("fileId"), q("token"));
    let target = {
        let Ok(sessions) = state.sessions.lock() else { return (500, Value::Null) };
        let Some(s) = sessions.get(&session) else { return (403, json!({ "message": "No such session" })) };
        match s.files.get(&file) {
            Some((name, expected)) if *expected == token => unique_in(&s.folder, name),
            _ => return (403, json!({ "message": "Invalid token" })),
        }
    };
    let partial = target.with_file_name(format!("{}.part", target.file_name().unwrap_or_default().to_string_lossy()));
    let written = (|| -> std::io::Result<()> {
        let mut out = fs::File::create(&partial)?;
        std::io::copy(&mut body_reader(request, reader), &mut out)?;
        out.flush()?;
        drop(out);
        fs::rename(&partial, &target)
    })();
    if written.is_err() {
        let _ = fs::remove_file(&partial);
        return (500, json!({ "message": "The file didn't arrive whole." }));
    }
    let (arrived, of, complete) = {
        let Ok(mut sessions) = state.sessions.lock() else { return (500, Value::Null) };
        let Some(s) = sessions.get_mut(&session) else { return (200, Value::Null) };
        s.files.remove(&file);
        s.arrived.push(target);
        (s.arrived.len(), s.arrived.len() + s.files.len(), s.files.is_empty())
    };
    state.host.progress(&session, arrived, of);
    if complete {
        finish(state, &session);
    }
    (200, Value::Null)
}

/// A session is over: what arrived goes to the app.
fn finish(state: &State, session: &str) {
    let Some(s) = state.sessions.lock().ok().and_then(|mut all| all.remove(session)) else { return };
    if s.arrived.is_empty() {
        let _ = fs::remove_dir_all(&s.folder);
        return;
    }
    state.host.received(session, s.folder, s.arrived);
}

/// A sent name made safe to save: no folders, nothing hidden.
fn clean_name(name: &str) -> String {
    let base = name.rsplit(['/', '\\']).next().unwrap_or("").trim().trim_start_matches('.');
    let cleaned: String = base.chars().map(|c| if c.is_control() || r#"<>:"|?*"#.contains(c) { '_' } else { c }).collect();
    if cleaned.is_empty() {
        "file".into()
    } else {
        cleaned
    }
}

/// `name` in `folder`, or `name (2)` if two sent files share a name.
fn unique_in(folder: &Path, name: &str) -> PathBuf {
    let mut path = folder.join(name);
    let (stem, ext) = match name.rsplit_once('.') {
        Some((s, e)) => (s.to_string(), format!(".{e}")),
        None => (name.to_string(), String::new()),
    };
    let mut n = 2;
    while path.exists() {
        path = folder.join(format!("{stem} ({n}){ext}"));
        n += 1;
    }
    path
}

fn respond(out: &mut TcpStream, status: u16, body: &Value) -> Result<()> {
    let reason = match status {
        200 => "OK",
        204 => "No Content",
        400 => "Bad Request",
        403 => "Forbidden",
        404 => "Not Found",
        409 => "Conflict",
        _ => "Internal Server Error",
    };
    let text = if body.is_null() { String::new() } else { body.to_string() };
    write!(
        out,
        "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{text}",
        text.len()
    )?;
    out.flush()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Default)]
    struct Fake {
        accept: bool,
        offers: Mutex<Vec<Offer>>,
        received: Mutex<Vec<(PathBuf, Vec<PathBuf>)>>,
    }

    impl Host for Fake {
        fn ask(&self, offer: Offer, answer: Box<dyn FnOnce(bool) + Send>) {
            self.offers.lock().unwrap().push(offer);
            answer(self.accept);
        }
        fn progress(&self, _: &str, _: usize, _: usize) {}
        fn received(&self, _: &str, folder: PathBuf, files: Vec<PathBuf>) {
            self.received.lock().unwrap().push((folder, files));
        }
    }

    fn post(port: u16, path: &str, body: &[u8], chunked: bool) -> (u16, Value) {
        let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
        if chunked {
            write!(stream, "POST {path} HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\n\r\n").unwrap();
            for piece in body.chunks(5) {
                write!(stream, "{:x}\r\n", piece.len()).unwrap();
                stream.write_all(piece).unwrap();
                write!(stream, "\r\n").unwrap();
            }
            write!(stream, "0\r\n\r\n").unwrap();
        } else {
            write!(stream, "POST {path} HTTP/1.1\r\nHost: x\r\nContent-Length: {}\r\n\r\n", body.len()).unwrap();
            stream.write_all(body).unwrap();
        }
        let mut reply = String::new();
        stream.read_to_string(&mut reply).unwrap();
        let status = reply.split_whitespace().nth(1).unwrap().parse().unwrap();
        let body = reply.split("\r\n\r\n").nth(1).unwrap_or("");
        (status, serde_json::from_str(body).unwrap_or(Value::Null))
    }

    fn receiver(accept: bool) -> (tempfile::TempDir, Arc<Fake>, Receiver) {
        let dir = tempfile::tempdir().unwrap();
        let host = Arc::new(Fake { accept, ..Default::default() });
        let me = Identity { alias: "TBV on test".into(), fingerprint: "tbv-test".into(), port: 0 };
        let receiver = start(me, &dir.path().join("inbox"), host.clone(), false).unwrap();
        (dir, host, receiver)
    }

    fn offer() -> Vec<u8> {
        json!({
            "info": { "alias": "Wren's iPhone", "version": "2.1", "deviceType": "mobile", "fingerprint": "phone" },
            "files": {
                "a": { "id": "a", "fileName": "Dracula.epub", "size": 7, "fileType": "application/epub+zip" },
                "b": { "id": "b", "fileName": "../holiday.jpg", "size": 3, "fileType": "image/jpeg" }
            }
        })
        .to_string()
        .into_bytes()
    }

    #[test]
    fn books_sent_from_localsend_arrive_once_accepted() {
        let (_dir, host, receiver) = receiver(true);
        let port = receiver.port();
        let (status, info) = post(port, "/api/localsend/v2/register", b"{}", false);
        assert_eq!((status, info["alias"].as_str()), (200, Some("TBV on test")));

        let (status, reply) = post(port, "/api/localsend/v2/prepare-upload", &offer(), false);
        assert_eq!(status, 200);
        let offered = host.offers.lock().unwrap()[0].clone();
        assert_eq!(offered.from, "Wren's iPhone");
        assert_eq!(offered.files.iter().map(|f| (f.name.as_str(), f.importable)).collect::<Vec<_>>(), [("Dracula.epub", true), ("holiday.jpg", false)]);
        let session = reply["sessionId"].as_str().unwrap().to_string();
        assert!(reply["files"].get("b").is_none(), "only what TBV can import is asked for");
        let token = reply["files"]["a"].as_str().unwrap();

        let (status, _) = post(port, &format!("/api/localsend/v2/upload?sessionId={session}&fileId=a&token=wrong"), b"nope", false);
        assert_eq!(status, 403);
        let (status, _) = post(port, &format!("/api/localsend/v2/upload?sessionId={session}&fileId=a&token={token}"), b"dracula", true);
        assert_eq!(status, 200);
        let received = host.received.lock().unwrap();
        assert_eq!(received.len(), 1, "the session ends with its last file");
        assert_eq!(fs::read_to_string(&received[0].1[0]).unwrap(), "dracula");
    }

    #[test]
    fn turned_down_offers_send_nothing() {
        let (_dir, host, receiver) = receiver(false);
        let (status, _) = post(receiver.port(), "/api/localsend/v2/prepare-upload", &offer(), false);
        assert_eq!(status, 403);
        assert!(host.received.lock().unwrap().is_empty());
    }

    #[test]
    fn names_from_other_devices_stay_inside_the_folder() {
        assert_eq!(clean_name("../../etc/passwd"), "passwd");
        assert_eq!(clean_name("C:\\Books\\Dracula?.epub"), "Dracula_.epub");
        assert_eq!(clean_name(".hidden"), "hidden");
        assert_eq!(unescape("The%20Monk+%28Lewis%29.pdf"), "The Monk (Lewis).pdf");
    }
}

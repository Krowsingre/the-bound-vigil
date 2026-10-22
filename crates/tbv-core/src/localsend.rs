//! Receiving books from LocalSend (localsend.org), the free app for sending
//! files between devices on the same Wi-Fi. TBV shows up in LocalSend's list
//! of nearby devices; what someone sends is offered to the person first, and
//! the books they accept go into the import queue.
//!
//! This follows LocalSend's open protocol (version 2): devices find each
//! other by announcing themselves on the local network (UDP multicast), and
//! files are sent over HTTP: `prepare-upload` lists the files and waits for
//! an answer, then each accepted file is `upload`ed. Receiving needs no more
//! than a small HTTP server of its own; sending (see `find_nearby` and
//! `send`) is the same conversation the other way round.

use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, SocketAddrV4, TcpListener, TcpStream, UdpSocket};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::{json, Value};

use crate::error::{Error, Result};
use crate::http::{body_reader, read_head, Request};

pub const PORT: u16 = 53317;
const MULTICAST: Ipv4Addr = Ipv4Addr::new(224, 0, 0, 167);
/// How long a sender is kept waiting for the person to answer.
const ANSWER_WITHIN: Duration = Duration::from_secs(120);
/// A session nothing has arrived for in this long, with nothing arriving now,
/// was abandoned (the sender lost Wi-Fi or quit) and makes way for the next.
#[cfg(not(test))]
const ABANDONED: Duration = Duration::from_secs(120);
#[cfg(test)]
const ABANDONED: Duration = Duration::from_millis(800);
/// A request or upload that goes quiet this long is given up on.
const IDLE: Duration = Duration::from_secs(60);
/// Requests' own lines and JSON bodies; files are streamed, not held.
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

/// Where one sent file has got to, for the person to follow in TBV.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum FileState {
    Waiting,
    Arriving,
    Arrived,
    Failed,
    /// Not taken: TBV can't import it, or the offer was turned down.
    Skipped,
}

/// One sent file, as TBV shows it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SentFile {
    pub session: String,
    pub id: String,
    pub from: String,
    pub name: String,
    /// The size the sender gave, and how much has come so far.
    pub size: u64,
    pub bytes: u64,
    pub state: FileState,
    /// Why it failed or was skipped, in plain words.
    pub reason: Option<String>,
}

/// What the app does with offers and what arrives.
pub trait Host: Send + Sync {
    /// Asks the person about an offer; true to accept its importable files.
    /// Returning nothing within `ANSWER_WITHIN` turns it down.
    fn ask(&self, offer: Offer, answer: Box<dyn FnOnce(bool) + Send>);
    /// A file's state or progress changed.
    fn file(&self, file: &SentFile);
    /// A book has arrived whole and can be imported now (then deleted).
    fn arrived(&self, path: PathBuf);
    /// The session is over. Audiobook parts wait for this, so the parts of
    /// one audiobook become one book: `folder` holds them, to import and then
    /// delete. Empty when no audio came.
    fn finished(&self, folder: PathBuf, audio: Vec<PathBuf>);
}

struct Accepted {
    file: SentFile,
    token: String,
}

struct Session {
    folder: PathBuf,
    /// Accepted files by LocalSend's id.
    files: HashMap<String, Accepted>,
    /// Audio that has arrived, held until the session ends.
    audio: Vec<PathBuf>,
    /// When something last arrived, and how many files are arriving now.
    touched: Instant,
    arriving: usize,
}

impl Session {
    fn pending(&self) -> bool {
        self.files.values().any(|f| matches!(f.file.state, FileState::Waiting | FileState::Arriving))
    }
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
    {
        let state = state.clone();
        thread::spawn(move || {
            while !state.stop.load(Ordering::SeqCst) {
                thread::sleep(Duration::from_millis(250));
                sweep(&state);
            }
        });
    }
    Ok(Receiver { stop, port })
}

/// Says TBV is here, and answers devices that announce themselves (a phone
/// opening LocalSend's Send screen, say), as the protocol asks.
fn discovery(state: &State) {
    let Ok(socket) = listening(state.me.port, Duration::from_secs(1)) else { return };
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
            Ok((n, from)) => {
                let Ok(heard) = serde_json::from_slice::<Value>(&buffer[..n]) else { continue };
                if heard["fingerprint"].as_str() == Some(state.me.fingerprint.as_str()) {
                    continue;
                }
                note_heard(&heard, from.ip(), &state.me.fingerprint);
                let announced = heard["announce"].as_bool().or(heard["announcement"].as_bool()).unwrap_or(false);
                if announced {
                    let _ = socket.send_to(&message(false), to);
                }
            }
            Err(_) => {
                // Now and then, in case a device missed the first announcement.
                quiet += 1;
                if quiet.is_multiple_of(30) {
                    let _ = socket.send_to(&message(true), to);
                }
            }
        }
    }
}

fn serve(state: &State, stream: TcpStream) -> Result<()> {
    stream.set_read_timeout(Some(IDLE))?;
    let mut reader = BufReader::new(stream.try_clone()?);
    let mut out = stream;
    // One request per connection is plenty: LocalSend opens a fresh one each time.
    let Some(request) = read_head(&mut reader)? else { return Ok(()) };
    let from = out.peer_addr().ok().map(|a| a.ip());
    let (status, body) = route(state, &request, &mut reader, from);
    respond(&mut out, status, &body)?;
    // A refused request's body may still be on its way. Closing with it
    // unread resets the connection, and the sender can lose the answer, so
    // finish sending first and let the rest arrive (within reason).
    let _ = out.shutdown(std::net::Shutdown::Write);
    let _ = out.set_read_timeout(Some(Duration::from_secs(2)));
    let _ = std::io::copy(&mut reader.take(64 * 1024 * 1024), &mut std::io::sink());
    Ok(())
}

fn read_json(request: &Request, reader: &mut dyn BufRead) -> Option<Value> {
    let mut bytes = Vec::new();
    body_reader(request, reader).take(MAX_JSON as u64).read_to_end(&mut bytes).ok()?;
    serde_json::from_slice(&bytes).ok()
}

fn route(state: &State, request: &Request, reader: &mut dyn BufRead, from: Option<IpAddr>) -> (u16, Value) {
    let path = request.path.trim_end_matches('/');
    match (request.method.as_str(), path) {
        ("POST", "/api/localsend/v2/register") | ("POST", "/api/localsend/v1/register") => {
            // A device answering TBV's announcement: one TBV can send to.
            if let (Some(info), Some(from)) = (read_json(request, reader), from) {
                note_heard(&info, from, &state.me.fingerprint);
            }
            (200, state.me.info())
        }
        ("GET", "/api/localsend/v2/info") | ("GET", "/api/localsend/v1/info") => (200, state.me.info()),
        ("POST", "/api/localsend/v2/prepare-upload") => prepare(state, read_json(request, reader)),
        ("POST", "/api/localsend/v2/upload") => upload(state, request, reader),
        ("POST", "/api/localsend/v2/cancel") => {
            if let Some(id) = request.query.get("sessionId") {
                finish(state, id, Some("Cancelled on the sending device"));
            }
            (200, Value::Null)
        }
        _ => (404, json!({ "message": "Not found" })),
    }
}

/// Someone wants to send files: ask the person, and wait for the answer.
fn prepare(state: &State, body: Option<Value>) -> (u16, Value) {
    let Some(body) = body else { return (400, json!({ "message": "Invalid body" })) };
    sweep(state);
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
    let session = crate::ids::new_record_id();
    let row = |f: &OfferedFile, state: FileState, reason: Option<String>| SentFile {
        session: session.clone(),
        id: f.id.clone(),
        from: from.clone(),
        name: f.name.clone(),
        size: f.size,
        bytes: 0,
        state,
        reason,
    };
    for f in files.iter().filter(|f| !f.importable) {
        state.host.file(&row(f, FileState::Skipped, Some(not_taken(&f.name))));
    }
    if !files.iter().any(|f| f.importable) {
        return (403, json!({ "message": "TBV only takes books, documents and audiobooks." }));
    }
    let (tx, rx) = std::sync::mpsc::channel();
    state.host.ask(
        Offer { session: session.clone(), from: from.clone(), files: files.clone() },
        Box::new(move |yes| {
            let _ = tx.send(yes);
        }),
    );
    let accepted = rx.recv_timeout(ANSWER_WITHIN).unwrap_or(false);
    let folder = state.inbox.join(&session);
    if accepted && fs::create_dir_all(&folder).is_err() {
        return (500, json!({ "message": "TBV couldn't make room for the files." }));
    }
    let mut taken = HashMap::new();
    for f in files.into_iter().filter(|f| f.importable) {
        if !accepted {
            state.host.file(&row(&f, FileState::Skipped, Some("Turned down".into())));
            continue;
        }
        let file = row(&f, FileState::Waiting, None);
        state.host.file(&file);
        taken.insert(f.id.clone(), Accepted { file, token: crate::ids::new_record_id() });
    }
    if !accepted {
        return (403, json!({ "message": "Declined" }));
    }
    let tokens: serde_json::Map<String, Value> = taken.iter().map(|(id, a)| (id.clone(), json!(a.token))).collect();
    if let Ok(mut sessions) = state.sessions.lock() {
        sessions.insert(session.clone(), Session { folder, files: taken, audio: Vec::new(), touched: Instant::now(), arriving: 0 });
    }
    (200, json!({ "sessionId": session, "files": tokens }))
}

/// Why a file wasn't taken, in plain words.
fn not_taken(name: &str) -> String {
    match name.rsplit_once('.') {
        Some((_, ext)) if !ext.is_empty() => format!("TBV doesn't take .{} files", ext.to_ascii_lowercase()),
        _ => "TBV can't tell what kind of file this is".into(),
    }
}

/// Changes one file's row and tells the app.
fn update(state: &State, session: &str, id: &str, change: impl FnOnce(&mut SentFile)) {
    let row = state.sessions.lock().ok().and_then(|mut all| {
        let file = &mut all.get_mut(session)?.files.get_mut(id)?.file;
        change(file);
        Some(file.clone())
    });
    if let Some(row) = row {
        state.host.file(&row);
    }
}

/// Copies a body into `out`, telling the app how far it has got now and then.
fn copy_counting(from: &mut dyn Read, out: &mut impl Write, mut told: impl FnMut(u64)) -> std::io::Result<u64> {
    let mut buffer = vec![0u8; 256 * 1024];
    let (mut total, mut last) = (0u64, Instant::now());
    loop {
        let n = match from.read(&mut buffer) {
            Ok(0) => return Ok(total),
            Ok(n) => n,
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(e) => return Err(e),
        };
        out.write_all(&buffer[..n])?;
        total += n as u64;
        if last.elapsed() > Duration::from_millis(250) {
            told(total);
            last = Instant::now();
        }
    }
}

/// A finished file into place. Antivirus software sometimes holds a new
/// file for a moment on Windows, so it's tried again, then copied instead.
fn put_in_place(from: &Path, to: &Path) -> std::io::Result<()> {
    for _ in 0..10 {
        if fs::rename(from, to).is_ok() {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(200));
    }
    fs::copy(from, to)?;
    let _ = fs::remove_file(from);
    Ok(())
}

fn size_text(bytes: u64) -> String {
    if bytes >= 1024 * 1024 {
        format!("{:.1} MB", bytes as f64 / 1024.0 / 1024.0)
    } else {
        format!("{} KB", bytes.div_ceil(1024))
    }
}

/// One accepted file arriving.
fn upload(state: &State, request: &Request, reader: &mut dyn BufRead) -> (u16, Value) {
    let q = |k: &str| request.query.get(k).cloned().unwrap_or_default();
    let (session, file, token) = (q("sessionId"), q("fileId"), q("token"));
    let target = {
        let Ok(mut sessions) = state.sessions.lock() else { return (500, Value::Null) };
        let Some(s) = sessions.get_mut(&session) else { return (403, json!({ "message": "No such session" })) };
        let target = match s.files.get(&file) {
            Some(a) if a.token == token && a.file.state != FileState::Arrived => unique_in(&s.folder, &a.file.name),
            _ => return (403, json!({ "message": "Invalid token" })),
        };
        s.arriving += 1;
        s.touched = Instant::now();
        target
    };
    update(state, &session, &file, |f| {
        f.state = FileState::Arriving;
        f.bytes = 0;
        f.reason = None;
    });
    // HTTP says how long the body is (or sends it in chunks that end with a
    // marker), so a connection that drops part way is caught here. The size
    // the sender announced beforehand is only shown: some phones announce
    // a slightly different one.
    let declared = request.headers.get("content-length").and_then(|l| l.parse::<u64>().ok());
    let partial = target.with_file_name(format!("{}.part", target.file_name().unwrap_or_default().to_string_lossy()));
    let written = (|| -> std::result::Result<u64, String> {
        let mut out = fs::File::create(&partial).map_err(|e| format!("TBV couldn't save it ({e})"))?;
        // A body with neither a length nor chunks runs until the sender closes.
        let chunked = request.headers.contains_key("transfer-encoding");
        let mut body: Box<dyn Read + '_> = if declared.is_none() && !chunked { Box::new(&mut *reader) } else { body_reader(request, reader) };
        let copied = copy_counting(&mut body, &mut out, |bytes| {
            update(state, &session, &file, |f| f.bytes = bytes);
        })
        .map_err(|e| format!("The connection dropped part way ({e})"))?;
        if let Some(d) = declared.filter(|d| *d != copied) {
            return Err(format!("The connection dropped after {} of {}", size_text(copied), size_text(d)));
        }
        out.flush().map_err(|e| format!("TBV couldn't save it ({e})"))?;
        drop(out);
        put_in_place(&partial, &target).map_err(|e| format!("TBV couldn't save it ({e})"))?;
        Ok(copied)
    })();
    let complete = {
        let Ok(mut sessions) = state.sessions.lock() else { return (500, Value::Null) };
        let Some(s) = sessions.get_mut(&session) else { return (200, Value::Null) };
        s.arriving = s.arriving.saturating_sub(1);
        s.touched = Instant::now();
        if written.is_ok() && crate::audio::is_part(&target) {
            s.audio.push(target.clone());
        }
        let row = s.files.get_mut(&file).map(|a| {
            match &written {
                Ok(bytes) => {
                    a.file.state = FileState::Arrived;
                    a.file.bytes = *bytes;
                }
                Err(why) => {
                    a.file.state = FileState::Failed;
                    a.file.reason = Some(why.clone());
                }
            }
            a.file.clone()
        });
        if let Some(row) = row {
            state.host.file(&row);
        }
        !s.pending()
    };
    if let Err(why) = &written {
        let _ = fs::remove_file(&partial);
        if complete {
            finish(state, &session, None);
        }
        return (500, json!({ "message": why }));
    }
    if !crate::audio::is_part(&target) {
        state.host.arrived(target);
    }
    if complete {
        finish(state, &session, None);
    }
    (200, Value::Null)
}

/// A session is over: audio that arrived goes to the app, and anything still
/// to come is marked with `unsent` (the sender cancelled or vanished).
fn finish(state: &State, session: &str, unsent: Option<&str>) {
    let Some(s) = state.sessions.lock().ok().and_then(|mut all| all.remove(session)) else { return };
    for a in s.files.into_values().filter(|a| matches!(a.file.state, FileState::Waiting | FileState::Arriving)) {
        let mut row = a.file;
        row.state = FileState::Failed;
        row.reason = Some(unsent.unwrap_or("The sender stopped before sending it").to_string());
        state.host.file(&row);
    }
    state.host.finished(s.folder, s.audio);
}

/// Ends sessions whose sender has gone quiet.
fn sweep(state: &State) {
    let abandoned: Vec<String> = match state.sessions.lock() {
        Ok(sessions) => sessions.iter().filter(|(_, s)| s.arriving == 0 && s.touched.elapsed() > ABANDONED).map(|(id, _)| id.clone()).collect(),
        Err(_) => return,
    };
    for id in abandoned {
        finish(state, &id, Some("The sender stopped before sending it"));
    }
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

/// A UDP socket on `port` that hears LocalSend's announcements.
fn listening(port: u16, wait: Duration) -> std::io::Result<UdpSocket> {
    let socket = UdpSocket::bind(SocketAddrV4::new(Ipv4Addr::UNSPECIFIED, port))?;
    socket.join_multicast_v4(&MULTICAST, &Ipv4Addr::UNSPECIFIED)?;
    socket.set_read_timeout(Some(wait))?;
    Ok(socket)
}

// Sending.

/// A device nearby that TBV can send to: LocalSend on a phone or computer,
/// or another TBV with LocalSend on.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Nearby {
    pub alias: String,
    pub fingerprint: String,
    /// "mobile", "desktop", "web", "headless" or "server", as the device says.
    pub device_type: String,
    pub address: String,
    pub port: u16,
    pub https: bool,
}

/// Devices heard lately, newest last.
static HEARD: Mutex<Vec<(Nearby, Instant)>> = Mutex::new(Vec::new());
/// A device not heard from in this long is taken to have gone.
const FORGOTTEN: Duration = Duration::from_secs(5 * 60);

fn note_heard(info: &Value, from: IpAddr, me: &str) {
    let Some(fingerprint) = info["fingerprint"].as_str().filter(|f| !f.is_empty() && *f != me) else { return };
    let device = Nearby {
        alias: info["alias"].as_str().filter(|a| !a.trim().is_empty()).unwrap_or("A nearby device").to_string(),
        fingerprint: fingerprint.to_string(),
        device_type: info["deviceType"].as_str().unwrap_or("desktop").to_string(),
        address: from.to_string(),
        port: info["port"].as_u64().and_then(|p| u16::try_from(p).ok()).unwrap_or(PORT),
        https: info["protocol"].as_str() != Some("http"),
    };
    if let Ok(mut heard) = HEARD.lock() {
        heard.retain(|(d, _)| d.fingerprint != device.fingerprint);
        heard.push((device, Instant::now()));
    }
}

/// Looks for devices to send to: says TBV is here, then listens for `wait`
/// for the answers. While receiving is on, its own listening hears them.
pub fn find_nearby(me: &Identity, wait: Duration) -> Vec<Nearby> {
    let started = Instant::now();
    let mut info = me.info();
    info["announce"] = json!(true);
    info["announcement"] = json!(true);
    let hello = serde_json::to_vec(&info).unwrap_or_default();
    let group = SocketAddrV4::new(MULTICAST, PORT);
    match listening(PORT, Duration::from_millis(250)) {
        // Nothing else here is listening: devices answer by multicast when
        // they can't reach TBV's own server, so hear them here.
        Ok(socket) => {
            let _ = socket.send_to(&hello, group);
            let mut buffer = [0u8; 8192];
            while started.elapsed() < wait {
                if let Ok((n, from)) = socket.recv_from(&mut buffer) {
                    if let Ok(heard) = serde_json::from_slice::<Value>(&buffer[..n]) {
                        note_heard(&heard, from.ip(), &me.fingerprint);
                    }
                }
            }
        }
        Err(_) => {
            if let Ok(socket) = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0)) {
                let _ = socket.send_to(&hello, group);
            }
            thread::sleep(wait);
        }
    }
    let mut found: Vec<Nearby> = HEARD
        .lock()
        .map(|heard| heard.iter().filter(|(_, at)| at.elapsed() < FORGOTTEN).map(|(d, _)| d.clone()).collect())
        .unwrap_or_default();
    found.sort_by_key(|d| d.alias.to_lowercase());
    found
}

/// The device at an address LocalSend shows (on its Receive screen), for
/// when it isn't found by looking: some networks keep devices from hearing
/// each other's announcements.
pub fn device_at(address: &str) -> Result<Nearby> {
    let address = address.trim().trim_start_matches("https://").trim_start_matches("http://").trim_end_matches('/');
    let (host, port) = match address.rsplit_once(':') {
        Some((h, p)) if !h.contains(':') => (h, p.parse().map_err(|_| Error::Unsuitable("That address's port isn't a number.".into()))?),
        _ => (address, PORT),
    };
    let ip: IpAddr = host.trim_matches(['[', ']']).parse().map_err(|_| Error::Unsuitable("Type the address as LocalSend shows it, like 192.168.1.20.".into()))?;
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(5)))
        .tls_config(ureq::tls::TlsConfig::builder().disable_verification(true).build())
        .build()
        .into();
    for https in [true, false] {
        let url = format!("{}://{}:{port}/api/localsend/v2/info", if https { "https" } else { "http" }, host_part(&ip.to_string()));
        if let Ok(mut response) = agent.get(&url).call() {
            if let Ok(info) = response.body_mut().read_json::<Value>() {
                let mut info = info;
                info["port"] = json!(port);
                info["protocol"] = json!(if https { "https" } else { "http" });
                note_heard(&info, ip, "");
                if let Some(found) = HEARD.lock().ok().and_then(|h| h.iter().rev().find(|(d, _)| d.address == ip.to_string()).map(|(d, _)| d.clone())) {
                    return Ok(found);
                }
            }
        }
    }
    Err(Error::Unsuitable(format!("Nothing answered at {address}. Check LocalSend is open on that device and it's on the same Wi-Fi.")))
}

/// One file to send.
#[derive(Debug, Clone)]
pub struct ToSend {
    pub path: PathBuf,
    /// The name the other device saves it as.
    pub name: String,
    pub size: u64,
}

fn file_type(name: &str) -> &'static str {
    let ext = name.rsplit_once('.').map(|(_, e)| e.to_lowercase()).unwrap_or_default();
    match ext.as_str() {
        "epub" => "application/epub+zip",
        "pdf" => "application/pdf",
        "mobi" | "azw" | "azw3" => "application/x-mobipocket-ebook",
        "txt" => "text/plain",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "doc" => "application/msword",
        "cbz" => "application/vnd.comicbook+zip",
        "mp3" => "audio/mpeg",
        "m4b" | "m4a" => "audio/mp4",
        _ => "application/octet-stream",
    }
}

/// Counts what's read, and stops when asked.
struct Counting<'a, R> {
    inner: R,
    sent: u64,
    stop: &'a AtomicBool,
    told: &'a mut dyn FnMut(u64),
}

impl<R: Read> Read for Counting<'_, R> {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        if self.stop.load(Ordering::SeqCst) {
            return Err(std::io::Error::other("stopped"));
        }
        let n = self.inner.read(buf)?;
        self.sent += n as u64;
        (self.told)(self.sent);
        Ok(n)
    }
}

/// Sends `files` to `to`, which first asks its person to accept them.
/// `told(file, bytes)` follows each file's progress. Returns how many the
/// other device took (it may already have some). `stop` gives up.
pub fn send(me: &Identity, to: &Nearby, files: &[ToSend], stop: &AtomicBool, mut told: impl FnMut(usize, u64)) -> Result<usize> {
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_connect(Some(Duration::from_secs(10)))
        // The other device waits for its person to accept before answering.
        .timeout_recv_response(Some(Duration::from_secs(5 * 60)))
        .http_status_as_error(false)
        // LocalSend's devices make their own certificates, so there's none to check.
        .tls_config(ureq::tls::TlsConfig::builder().disable_verification(true).build())
        .build()
        .into();
    let base = format!("{}://{}:{}/api/localsend/v2", if to.https { "https" } else { "http" }, host_part(&to.address), to.port);
    let offline = |e: ureq::Error| Error::Unsuitable(format!("{} couldn't be reached ({e}). Check it's on the same Wi-Fi with LocalSend open.", to.alias));
    let listed: serde_json::Map<String, Value> = files
        .iter()
        .enumerate()
        .map(|(i, f)| (i.to_string(), json!({ "id": i.to_string(), "fileName": f.name, "size": f.size, "fileType": file_type(&f.name) })))
        .collect();
    let mut response = agent
        .post(&format!("{base}/prepare-upload"))
        .send_json(json!({ "info": me.info(), "files": listed }))
        .map_err(offline)?;
    let status = response.status().as_u16();
    match status {
        200 => {}
        204 => return Ok(0),
        401 => return Err(Error::Unsuitable(format!("{} asks for a PIN. Turn the PIN off in its LocalSend settings and try again.", to.alias))),
        403 => return Err(Error::Unsuitable(format!("{} turned them down.", to.alias))),
        409 => return Err(Error::Unsuitable(format!("{} is busy with another transfer. Try again once it's done.", to.alias))),
        429 => return Err(Error::Unsuitable(format!("{} is getting too many requests. Wait a moment and try again.", to.alias))),
        _ => return Err(Error::Unsuitable(format!("{} didn't take them (it answered {status}).", to.alias))),
    }
    let answer: Value = response.body_mut().read_json().map_err(|e| Error::Unsuitable(format!("{} answered in a way TBV doesn't understand ({e}).", to.alias)))?;
    let session = answer["sessionId"].as_str().unwrap_or_default().to_string();
    let tokens = answer["files"].as_object().cloned().unwrap_or_default();
    let mut sent = 0;
    for (i, file) in files.iter().enumerate() {
        let Some(token) = tokens.get(&i.to_string()).and_then(Value::as_str) else { continue };
        let opened = fs::File::open(&file.path)?;
        let mut progress = |bytes: u64| told(i, bytes);
        let mut body = Counting { inner: opened, sent: 0, stop, told: &mut progress };
        let url = format!("{base}/upload?sessionId={}&fileId={i}&token={}", query_part(&session), query_part(token));
        let result = agent
            .post(&url)
            .header("Content-Type", file_type(&file.name))
            .header("Content-Length", file.size.to_string())
            .send(ureq::SendBody::from_reader(&mut body));
        let ok = matches!(&result, Ok(r) if r.status().is_success());
        if !ok {
            let _ = agent.post(&format!("{base}/cancel?sessionId={}", query_part(&session))).send_empty();
            if stop.load(Ordering::SeqCst) {
                return Err(Error::Unsuitable("Sending was stopped.".into()));
            }
            return Err(match result {
                Err(e) => offline(e),
                Ok(r) => Error::Unsuitable(format!("{} stopped taking {} (it answered {}).", to.alias, file.name, r.status().as_u16())),
            });
        }
        sent += 1;
    }
    Ok(sent)
}

fn host_part(address: &str) -> String {
    if address.contains(':') {
        format!("[{address}]")
    } else {
        address.to_string()
    }
}

fn query_part(text: &str) -> String {
    url::form_urlencoded::byte_serialize(text.as_bytes()).collect()
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
        rows: Mutex<HashMap<String, SentFile>>,
        arrived: Mutex<Vec<PathBuf>>,
        finished: Mutex<Vec<Vec<PathBuf>>>,
    }

    impl Host for Fake {
        fn ask(&self, offer: Offer, answer: Box<dyn FnOnce(bool) + Send>) {
            self.offers.lock().unwrap().push(offer);
            answer(self.accept);
        }
        fn file(&self, file: &SentFile) {
            self.rows.lock().unwrap().insert(file.name.clone(), file.clone());
        }
        fn arrived(&self, path: PathBuf) {
            self.arrived.lock().unwrap().push(path);
        }
        fn finished(&self, _: PathBuf, audio: Vec<PathBuf>) {
            self.finished.lock().unwrap().push(audio);
        }
    }

    impl Fake {
        fn row(&self, name: &str) -> (FileState, Option<String>) {
            let rows = self.rows.lock().unwrap();
            let row = rows.get(name).unwrap_or_else(|| panic!("no row for {name}"));
            (row.state, row.reason.clone())
        }
    }

    /// An upload whose connection drops: says `length` bytes, sends `body`, stops.
    fn cut_short(port: u16, path: &str, length: usize, body: &[u8]) -> u16 {
        let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
        write!(stream, "POST {path} HTTP/1.1\r\nHost: x\r\nContent-Length: {length}\r\n\r\n").unwrap();
        stream.write_all(body).unwrap();
        stream.shutdown(std::net::Shutdown::Write).unwrap();
        let mut reply = String::new();
        let _ = stream.read_to_string(&mut reply);
        reply.split_whitespace().nth(1).and_then(|s| s.parse().ok()).unwrap_or(0)
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
                "c": { "id": "c", "fileName": "Carmilla.epub", "size": 999, "fileType": "application/epub+zip" },
                "b": { "id": "b", "fileName": "../holiday.jpg", "size": 3, "fileType": "image/jpeg" }
            }
        })
        .to_string()
        .into_bytes()
    }

    #[test]
    fn tbv_sends_books_to_a_nearby_device() {
        let (dir, host, desk) = receiver(true);
        let book = dir.path().join("dracula.epub");
        fs::write(&book, b"vampire").unwrap();
        let me = Identity { alias: "TBV sender".into(), fingerprint: "sender".into(), port: 1 };
        let to = Nearby {
            alias: "Desk".into(),
            fingerprint: "tbv-test".into(),
            device_type: "desktop".into(),
            address: "127.0.0.1".into(),
            port: desk.port(),
            https: false,
        };
        let files = [ToSend { path: book, name: "Dracula - Bram Stoker.epub".into(), size: 7 }];
        let mut progress = Vec::new();
        let sent = send(&me, &to, &files, &AtomicBool::new(false), |i, bytes| progress.push((i, bytes))).unwrap();
        assert_eq!(sent, 1);
        assert_eq!(progress.last(), Some(&(0, 7)));
        assert_eq!(host.offers.lock().unwrap()[0].from, "TBV sender");
        assert_eq!(host.row("Dracula - Bram Stoker.epub").0, FileState::Arrived);

        // Turned down: said plainly.
        let (_dir2, _host2, refusing) = receiver(false);
        let to = Nearby { port: refusing.port(), ..to };
        let refused = send(&me, &to, &files, &AtomicBool::new(false), |_, _| {}).unwrap_err().to_string();
        assert!(refused.contains("turned them down"), "{refused}");
    }

    #[test]
    fn devices_answering_tbv_are_remembered() {
        let (_dir, _host, receiver) = receiver(true);
        let hello = json!({ "alias": "Wren's iPhone", "fingerprint": "wren-phone", "deviceType": "mobile", "port": 53317, "protocol": "https" });
        assert_eq!(post(receiver.port(), "/api/localsend/v2/register", hello.to_string().as_bytes(), false).0, 200);
        let heard = HEARD.lock().unwrap().iter().find(|(d, _)| d.fingerprint == "wren-phone").map(|(d, _)| d.clone()).unwrap();
        assert_eq!((heard.alias.as_str(), heard.address.as_str(), heard.https), ("Wren's iPhone", "127.0.0.1", true));

        // Typed in by hand: found by asking it.
        let typed = device_at(&format!("127.0.0.1:{}", receiver.port())).unwrap();
        assert_eq!((typed.alias.as_str(), typed.fingerprint.as_str(), typed.https), ("TBV on test", "tbv-test", false));
        assert!(device_at("not an address").is_err());
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
        assert_eq!(
            offered.files.iter().map(|f| (f.name.as_str(), f.importable)).collect::<Vec<_>>(),
            [("Carmilla.epub", true), ("Dracula.epub", true), ("holiday.jpg", false)]
        );
        assert_eq!(host.row("holiday.jpg"), (FileState::Skipped, Some("TBV doesn't take .jpg files".into())));
        assert_eq!(host.row("Dracula.epub").0, FileState::Waiting);
        let session = reply["sessionId"].as_str().unwrap().to_string();
        assert!(reply["files"].get("b").is_none(), "only what TBV can import is asked for");
        let token = reply["files"]["a"].as_str().unwrap();
        let upload = |id: &str, token: &str| format!("/api/localsend/v2/upload?sessionId={session}&fileId={id}&token={token}");

        assert_eq!(post(port, &upload("a", "wrong"), b"nope", false).0, 403);
        assert_eq!(cut_short(port, &upload("a", token), 7, b"dra"), 500);
        let (state, reason) = host.row("Dracula.epub");
        assert_eq!(state, FileState::Failed);
        assert!(reason.unwrap().contains("dropped"), "the person is told why");
        assert!(host.arrived.lock().unwrap().is_empty());

        // Sent again, whole: it's handed on at once, without waiting for the rest.
        assert_eq!(post(port, &upload("a", token), b"dracula", true).0, 200);
        assert_eq!(host.row("Dracula.epub").0, FileState::Arrived);
        assert_eq!(fs::read_to_string(&host.arrived.lock().unwrap()[0]).unwrap(), "dracula");
        assert!(host.finished.lock().unwrap().is_empty(), "Carmilla is still to come");

        // The phone said 999 bytes but sends 8: what arrived whole counts.
        let carmilla = reply["files"]["c"].as_str().unwrap();
        assert_eq!(post(port, &upload("c", carmilla), b"carmilla", false).0, 200);
        assert_eq!(host.row("Carmilla.epub").0, FileState::Arrived);
        assert_eq!(host.arrived.lock().unwrap().len(), 2);
        assert_eq!(host.finished.lock().unwrap().len(), 1, "the session ends with its last file");
    }

    #[test]
    fn audiobook_parts_wait_for_the_rest_of_the_delivery() {
        let (_dir, host, receiver) = receiver(true);
        let port = receiver.port();
        let offer = json!({
            "info": { "alias": "Phone" },
            "files": {
                "1": { "id": "1", "fileName": "01.mp3", "size": 3 },
                "2": { "id": "2", "fileName": "02.mp3", "size": 3 }
            }
        });
        let (_, reply) = post(port, "/api/localsend/v2/prepare-upload", offer.to_string().as_bytes(), false);
        let session = reply["sessionId"].as_str().unwrap().to_string();
        for id in ["1", "2"] {
            let token = reply["files"][id].as_str().unwrap();
            assert_eq!(post(port, &format!("/api/localsend/v2/upload?sessionId={session}&fileId={id}&token={token}"), b"mp3", false).0, 200);
        }
        assert!(host.arrived.lock().unwrap().is_empty());
        assert_eq!(host.finished.lock().unwrap()[0].len(), 2, "both parts, together");
    }

    #[test]
    fn a_sender_that_vanishes_makes_way_for_the_next() {
        let (_dir, host, receiver) = receiver(true);
        let port = receiver.port();
        assert_eq!(post(port, "/api/localsend/v2/prepare-upload", &offer(), false).0, 200);
        assert_eq!(post(port, "/api/localsend/v2/prepare-upload", &offer(), false).0, 409, "one sender at a time");
        thread::sleep(ABANDONED * 3);
        assert_eq!(host.row("Dracula.epub"), (FileState::Failed, Some("The sender stopped before sending it".into())));
        assert_eq!(post(port, "/api/localsend/v2/prepare-upload", &offer(), false).0, 200);
    }

    #[test]
    fn turned_down_offers_send_nothing() {
        let (_dir, host, receiver) = receiver(false);
        let (status, _) = post(receiver.port(), "/api/localsend/v2/prepare-upload", &offer(), false);
        assert_eq!(status, 403);
        assert!(host.arrived.lock().unwrap().is_empty());
        assert_eq!(host.row("Dracula.epub"), (FileState::Skipped, Some("Turned down".into())));
    }

    #[test]
    fn names_from_other_devices_stay_inside_the_folder() {
        assert_eq!(clean_name("../../etc/passwd"), "passwd");
        assert_eq!(clean_name("C:\\Books\\Dracula?.epub"), "Dracula_.epub");
        assert_eq!(clean_name(".hidden"), "hidden");
        assert_eq!(crate::http::unescape("The%20Monk+%28Lewis%29.pdf"), "The Monk (Lewis).pdf");
    }
}

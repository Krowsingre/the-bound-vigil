//! Supabase as a place to keep a library: records in one table (set up by
//! `supabase/setup.sql`), files in one private storage bucket, both visible
//! only to the signed-in person.

use std::collections::HashMap;
use std::fs::File;
use std::io::{self, Read, Write};
use std::path::Path;
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use ureq::http::Response;
use ureq::{Agent, Body};

use super::{seq_after, Page, Record, Remote, Session, SupabaseProject};
use crate::error::{Error, Result};

const BUCKET: &str = "tbv-files";

/// Supabase's free plan takes files of up to 50 MB, so a bigger one (most
/// audiobooks) goes up in pieces: `<path>.pieces/0000`, `0001`… and last an
/// index, `<path>.pieces/pieces.json`. Everything above this file reads it
/// as the one file at `<path>`. The phone version joins pieces the same way.
pub const PIECE_BYTES: u64 = 45 * 1024 * 1024;
const PIECES: &str = ".pieces";
const PIECE_INDEX: &str = "pieces.json";

/// A file kept in pieces, as its index says.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Pieces {
    /// The whole file's size.
    pub size: u64,
    pub count: u64,
    /// Each piece's size; the last may be smaller.
    pub piece: u64,
}

impl Pieces {
    fn of(size: u64) -> Self {
        Pieces { size, count: size.div_ceil(PIECE_BYTES).max(1), piece: PIECE_BYTES }
    }

    /// The pieces holding bytes `start..=end`, each with the stretch of it wanted.
    fn covering(&self, start: u64, end: u64) -> Vec<(u64, u64, u64)> {
        let end = end.min(self.size.saturating_sub(1));
        let mut out = Vec::new();
        let mut at = start;
        while at <= end && at < self.size {
            let index = at / self.piece;
            let from = at - index * self.piece;
            let to = (end - index * self.piece).min(self.piece - 1);
            out.push((index, from, to));
            at = (index + 1) * self.piece;
        }
        out
    }
}

fn piece_path(path: &str, index: u64) -> String {
    format!("{path}{PIECES}/{index:04}")
}
const SETUP_HINT: &str = "TBV's tables aren't in this Supabase project yet. Run the setup script from Preferences › Sync, then try again";

fn agent() -> Agent {
    Agent::config_builder()
        .http_status_as_error(false)
        .timeout_connect(Some(Duration::from_secs(15)))
        .timeout_recv_response(Some(Duration::from_secs(90)))
        .build()
        .into()
}

fn now_secs() -> i64 {
    chrono::Utc::now().timestamp()
}

/// Transport trouble (no connection, a timeout) means offline, not broken.
fn transport(error: ureq::Error) -> Error {
    match error {
        ureq::Error::Io(e) => Error::Offline(e.to_string()),
        ureq::Error::Timeout(_) => Error::Offline("it took too long to answer".into()),
        ureq::Error::HostNotFound => Error::Offline("the project's address couldn't be found".into()),
        ureq::Error::ConnectionFailed => Error::Offline("the connection failed".into()),
        other => Error::Cloud(other.to_string()),
    }
}

/// How many requests this app has with Supabase at once, across every sync
/// lane, stream and download. The free plan's file service shares a small
/// pool of database connections, and too many at once get turned away.
const AT_ONCE: usize = 3;
static IN_FLIGHT: (Mutex<usize>, Condvar) = (Mutex::new(0), Condvar::new());

/// One of the AT_ONCE places, held for as long as it lives.
struct Turn;

impl Turn {
    fn wait() -> Self {
        let (count, freed) = &IN_FLIGHT;
        let mut count = count.lock().unwrap_or_else(|e| e.into_inner());
        while *count >= AT_ONCE {
            count = freed.wait(count).unwrap_or_else(|e| e.into_inner());
        }
        *count += 1;
        Turn
    }
}

impl Drop for Turn {
    fn drop(&mut self) {
        let (count, freed) = &IN_FLIGHT;
        *count.lock().unwrap_or_else(|e| e.into_inner()) -= 1;
        freed.notify_one();
    }
}

/// Tries before giving up on a busy Supabase, waiting longer each time.
const BUSY_TRIES: u32 = 6;

/// Whether an answer means "too busy, try again soon" rather than a real
/// problem. Supabase's file service sometimes puts its real status (and
/// "too many connections") inside a 400 or 500 answer's body.
fn busy(status: u16, body: &str) -> bool {
    if matches!(status, 429 | 502 | 503 | 504 | 544) {
        return true;
    }
    if !matches!(status, 400 | 500) {
        return false;
    }
    let body = body.to_lowercase();
    ["too many connections", "timeout", "timed out", "rate limit", "\"statuscode\":\"429\"", "\"statuscode\":\"503\"", "\"statuscode\":\"544\""]
        .iter()
        .any(|w| body.contains(w))
}

/// The readable part of an error answer from any Supabase service.
fn message(response: &mut Response<Body>) -> String {
    let status = response.status().as_u16();
    let body = response.body_mut().read_to_string().unwrap_or_default();
    let parsed: Value = serde_json::from_str(&body).unwrap_or(Value::Null);
    ["msg", "message", "error_description", "error"]
        .iter()
        .find_map(|k| parsed.get(*k).and_then(Value::as_str))
        .map(str::to_string)
        .unwrap_or_else(|| format!("status {status}"))
}

/// Turns an error from the project's Data API (PostgREST) into a next step.
/// A 404 has several causes that need different fixes, so the text names
/// the one Supabase reported, with its own words after it for anyone helping.
fn rest_problem(response: &mut Response<Body>) -> Error {
    let status = response.status().as_u16();
    let body = response.body_mut().read_to_string().unwrap_or_default();
    let parsed: Value = serde_json::from_str(&body).unwrap_or(Value::Null);
    let code = parsed.get("code").and_then(Value::as_str).unwrap_or_default();
    let said = ["message", "msg", "error"]
        .iter()
        .find_map(|k| parsed.get(*k).and_then(Value::as_str))
        .map(str::to_string)
        .unwrap_or_else(|| {
            let text = body.trim();
            if text.is_empty() || text.len() > 200 { format!("status {status}") } else { text.to_string() }
        });
    let hint = match code {
        // The table or function isn't there, or the API hasn't noticed it yet.
        "PGRST205" | "PGRST202" | "42P01" | "42883" => SETUP_HINT,
        // The project only shares other schemas (Supabase's "dedicated API schema" choice).
        "PGRST106" => "This Supabase project's Data API doesn't include the public schema, where TBV's table lives. In Supabase, open Project Settings › Data API, add public to Exposed schemas and save, then try again",
        "42501" => "TBV's table is there, but signed-in accounts aren't allowed to use it. Run the setup script from Preferences › Sync again, then try again",
        _ if status == 404 => "Supabase's Data API didn't answer. In Supabase, open Project Settings › Data API and check it's turned on, and that the setup script ran without errors, then try again",
        _ => return Error::Cloud(said),
    };
    Error::Cloud(format!("{hint}. (Supabase said: {said})"))
}

#[derive(Deserialize)]
struct TokenAnswer {
    access_token: String,
    refresh_token: String,
    expires_in: i64,
    user: UserAnswer,
}

#[derive(Deserialize)]
struct UserAnswer {
    id: String,
    #[serde(default)]
    email: Option<String>,
}

impl TokenAnswer {
    fn session(self, email: &str) -> Session {
        Session {
            user_id: self.user.id,
            email: self.user.email.unwrap_or_else(|| email.to_string()),
            access_token: self.access_token,
            refresh_token: self.refresh_token,
            expires_at: now_secs() + self.expires_in,
        }
    }
}

fn auth_post(project: &SupabaseProject, path: &str, body: Value) -> Result<Response<Body>> {
    agent()
        .post(&format!("{}/auth/v1/{path}", project.url))
        .header("apikey", &project.anon_key)
        .send_json(body)
        .map_err(transport)
}

/// Signs in with email and password.
pub fn sign_in(project: &SupabaseProject, email: &str, password: &str) -> Result<Session> {
    let mut answer = auth_post(project, "token?grant_type=password", json!({ "email": email, "password": password }))?;
    if !answer.status().is_success() {
        let why = message(&mut answer);
        return Err(Error::Unsuitable(if why.contains("Email not confirmed") {
            "Confirm your email first: open the link Supabase sent you, then sign in.".into()
        } else if why.contains("Invalid login credentials") {
            "That email and password don't match an account in this project.".into()
        } else {
            why
        }));
    }
    let token: TokenAnswer = answer.body_mut().read_json().map_err(|e| Error::Cloud(e.to_string()))?;
    Ok(token.session(email))
}

/// Makes an account. `None` means Supabase sent a confirmation email first.
pub fn sign_up(project: &SupabaseProject, email: &str, password: &str) -> Result<Option<Session>> {
    let mut answer = auth_post(project, "signup", json!({ "email": email, "password": password }))?;
    if !answer.status().is_success() {
        return Err(Error::Unsuitable(message(&mut answer)));
    }
    let body: Value = answer.body_mut().read_json().map_err(|e| Error::Cloud(e.to_string()))?;
    if body.get("access_token").is_some() {
        let token: TokenAnswer = serde_json::from_value(body)?;
        return Ok(Some(token.session(email)));
    }
    Ok(None)
}

/// Signs out on the server too, so the sign-in can't be reused. Best effort.
pub fn sign_out(project: &SupabaseProject, session: &Session) {
    let _ = agent()
        .post(&format!("{}/auth/v1/logout", project.url))
        .header("apikey", &project.anon_key)
        .header("Authorization", &format!("Bearer {}", session.access_token))
        .send_empty();
}

/// Sends one request, given the agent, project URL and `Bearer …` header.
type Request<'a> = dyn Fn(&Agent, &str, &str) -> std::result::Result<Response<Body>, ureq::Error> + 'a;

/// A signed-in connection to one project.
/// Where the sign-in is saved. Supabase hands out a new renewal token each
/// time one is used and refuses the old one, so every connection reads the
/// newest sign-in before renewing and saves a renewed one straight away.
pub trait SessionKeeper: Send + Sync {
    fn latest(&self) -> Option<Session>;
    fn save(&self, session: &Session);
}

/// One renewal at a time across every connection in the app.
static RENEWING: Mutex<()> = Mutex::new(());

pub struct Supabase {
    project: SupabaseProject,
    session: Session,
    device_id: String,
    agent: Agent,
    renewed: bool,
    keeper: Option<Arc<dyn SessionKeeper>>,
    /// What each big file's piece index says, once read.
    pieces: HashMap<String, Pieces>,
}

impl Supabase {
    pub fn new(project: SupabaseProject, session: Session, device_id: String) -> Self {
        Self { project, session, device_id, agent: agent(), renewed: false, keeper: None, pieces: HashMap::new() }
    }

    pub fn keep_session_with(&mut self, keeper: Arc<dyn SessionKeeper>) {
        self.keeper = Some(keeper);
    }

    /// The sign-in, renewed if it ran out during this connection.
    pub fn session(&self) -> &Session {
        &self.session
    }

    /// True if the sign-in was renewed and should be saved.
    pub fn renewed(&self) -> bool {
        self.renewed
    }

    /// Whether another device has saved a change since `seen`, the newest
    /// change number looked at so far: one small question, for between
    /// syncs. The first ask only notes the newest number.
    pub fn news(&mut self, seen: &mut Option<i64>) -> Result<bool> {
        let key = self.project.anon_key.clone();
        let filter = match *seen {
            None => String::new(),
            Some(n) => format!("&seq=gt.{n}&device_id=neq.{}", crate::oauth::percent_encode(&self.device_id)),
        };
        let mut answer = self.call(&|agent, url, bearer| {
            agent
                .get(&format!("{url}/rest/v1/tbv_records?select=seq{filter}&order=seq.desc&limit=1"))
                .header("apikey", &key)
                .header("Authorization", bearer)
                .call()
        })?;
        if !answer.status().is_success() {
            return Err(rest_problem(&mut answer));
        }
        let rows: Vec<Value> = answer.body_mut().read_json().map_err(|e| Error::Cloud(e.to_string()))?;
        let newest = rows.first().and_then(|r| r.get("seq")).and_then(Value::as_i64);
        let first = seen.is_none();
        if first {
            *seen = Some(newest.unwrap_or(0));
        } else if let Some(n) = newest {
            *seen = Some(n);
        }
        Ok(!first && newest.is_some())
    }

    /// The access token in use now, for a live connection to send along.
    pub fn access_token(&self) -> &str {
        &self.session.access_token
    }

    fn renew(&mut self) -> Result<()> {
        let _one = RENEWING.lock().unwrap_or_else(|e| e.into_inner());
        // Another connection may have renewed already; its sign-in is the one
        // Supabase still accepts.
        if let Some(latest) = self.keeper.as_ref().and_then(|k| k.latest()) {
            if latest.user_id == self.session.user_id && latest.refresh_token != self.session.refresh_token {
                self.session = latest;
                if self.session.expires_at - 60 > now_secs() {
                    return Ok(());
                }
            }
        }
        let mut answer = auth_post(&self.project, "token?grant_type=refresh_token", json!({ "refresh_token": self.session.refresh_token }))?;
        if !answer.status().is_success() {
            let status = answer.status().as_u16();
            return Err(if (400..500).contains(&status) { Error::SignedOut } else { Error::Cloud(message(&mut answer)) });
        }
        let token: TokenAnswer = answer.body_mut().read_json().map_err(|e| Error::Cloud(e.to_string()))?;
        self.session = token.session(&self.session.email);
        self.renewed = true;
        if let Some(keeper) = &self.keeper {
            keeper.save(&self.session);
        }
        Ok(())
    }

    /// Sends a request with the current sign-in, renewing it once if it has
    /// run out.
    /// Waits and tries again (up to BUSY_TRIES times) when Supabase is too
    /// busy, rather than failing the whole sync.
    fn call(&mut self, send: &Request<'_>) -> Result<Response<Body>> {
        if self.session.expires_at - 60 < now_secs() {
            self.renew()?;
        }
        let mut renewed = false;
        let mut tries = 0;
        loop {
            let bearer = format!("Bearer {}", self.session.access_token);
            let mut answer = {
                let _turn = Turn::wait();
                send(&self.agent, &self.project.url, &bearer).map_err(transport)?
            };
            let status = answer.status().as_u16();
            if status == 401 {
                if renewed {
                    return Err(Error::SignedOut);
                }
                renewed = true;
                self.renew()?;
                continue;
            }
            if !matches!(status, 400 | 429 | 500..=599) {
                return Ok(answer);
            }
            let body = answer.body_mut().read_to_string().unwrap_or_default();
            tries += 1;
            if !busy(status, &body) || tries >= BUSY_TRIES {
                // Hand the answer back as it came, for the caller to read.
                let mut again = Response::new(Body::builder().mime_type("application/json").data(body));
                *again.status_mut() = answer.status();
                return Ok(again);
            }
            std::thread::sleep(Duration::from_millis(500 << tries));
        }
    }

    /// What a file's piece index says, or None if it isn't kept in pieces.
    fn pieces_of(&mut self, path: &str) -> Result<Option<Pieces>> {
        if let Some(known) = self.pieces.get(path) {
            return Ok(Some(*known));
        }
        let index = format!("{path}{PIECES}/{PIECE_INDEX}");
        let found = match self.read_range_whole(&index, 0, 64 * 1024)? {
            Some((bytes, _)) => serde_json::from_slice::<Pieces>(&bytes).ok().filter(|p| p.piece > 0),
            None => None,
        };
        if let Some(pieces) = found {
            self.pieces.insert(path.to_string(), pieces);
        }
        Ok(found)
    }

    fn object_url(&self, path: &str) -> String {
        format!("{BUCKET}/{}/{path}", self.session.user_id)
    }
}

/// How much of a Supabase project TBV is using.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    /// Every file this account keeps there, in bytes and count.
    pub file_bytes: u64,
    pub files: u64,
    /// Book files, audiobook files, and covers plus pictures.
    pub book_bytes: u64,
    pub audio_bytes: u64,
    pub picture_bytes: u64,
    /// The whole database. Unknown until the setup script is run again.
    pub database_bytes: Option<u64>,
}

impl Usage {
    fn add(&mut self, folder: &str, bytes: u64, files: u64) {
        self.file_bytes += bytes;
        self.files += files;
        match folder {
            "books" => self.book_bytes += bytes,
            "audio" => self.audio_bytes += bytes,
            _ => self.picture_bytes += bytes,
        }
    }

    /// Reads what `tbv_usage()` answers.
    fn from_answer(answer: &Value) -> Self {
        let mut usage = Usage { database_bytes: answer.get("database_bytes").and_then(Value::as_u64), ..Usage::default() };
        if let Some(folders) = answer.get("folders").and_then(Value::as_object) {
            for (folder, row) in folders {
                let n = |k: &str| row.get(k).and_then(Value::as_u64).unwrap_or(0);
                usage.add(folder, n("bytes"), n("files"));
            }
        }
        usage
    }
}

impl Supabase {
    /// Asks the project how much TBV keeps there. Projects set up before the
    /// gauge existed lack `tbv_usage`, so their files are counted by listing
    /// them and the database size is left unknown.
    pub fn usage(&mut self) -> Result<Usage> {
        let key = self.project.anon_key.clone();
        let mut answer = self.call(&|agent, url, bearer| {
            agent
                .post(&format!("{url}/rest/v1/rpc/tbv_usage"))
                .header("apikey", &key)
                .header("Authorization", bearer)
                .send_json(json!({}))
        })?;
        if answer.status().is_success() {
            let found: Value = answer.body_mut().read_json().map_err(|e| Error::Cloud(e.to_string()))?;
            return Ok(Usage::from_answer(&found));
        }
        if !matches!(answer.status().as_u16(), 404 | 400) {
            return Err(rest_problem(&mut answer));
        }
        let mut usage = Usage::default();
        for folder in ["books", "audio", "covers", "pictures"] {
            let (bytes, files) = self.walk(&format!("{folder}/"))?;
            usage.add(folder, bytes, files);
        }
        Ok(usage)
    }

    /// Adds up the files in a folder and the folders inside it.
    fn walk(&mut self, folder: &str) -> Result<(u64, u64)> {
        let (mut bytes, mut files) = (0, 0);
        for (name, size) in self.list_sizes(folder)? {
            match size {
                Some(size) => {
                    bytes += size;
                    files += 1;
                }
                None => {
                    let (b, f) = self.walk(&format!("{folder}{name}/"))?;
                    bytes += b;
                    files += f;
                }
            }
        }
        Ok((bytes, files))
    }
}

impl Supabase {
    fn upload_whole(&mut self, path: &str, file: &Path) -> Result<()> {
        let file = file.to_path_buf();
        self.upload_with(path, &|| Ok(Box::new(File::open(&file)?) as Box<dyn Read>))
    }

    fn upload_with(&mut self, path: &str, open: &dyn Fn() -> io::Result<Box<dyn Read>>) -> Result<()> {
        let object = self.object_url(path);
        let key = self.project.anon_key.clone();
        let mut answer = self.call(&|agent, url, bearer| {
            let body = ureq::SendBody::from_owned_reader(open().map_err(ureq::Error::Io)?);
            agent
                .post(&format!("{url}/storage/v1/object/{object}"))
                .header("apikey", &key)
                .header("Authorization", bearer)
                .header("x-upsert", "true")
                .content_type("application/octet-stream")
                .send(body)
        })?;
        match answer.status().as_u16() {
            200..=299 => Ok(()),
            413 => Err(Error::Rejected("too big for this Supabase project's file size limit".into())),
            status => {
                let why = message(&mut answer);
                if why.contains("Bucket not found") {
                    Err(Error::Cloud(SETUP_HINT.into()))
                } else if why.to_lowercase().contains("exceeded the maximum allowed size") || why.contains("Payload too large") {
                    Err(Error::Rejected("too big for this Supabase project's file size limit".into()))
                } else if status == 400 || status == 415 {
                    Err(Error::Rejected(why))
                } else {
                    Err(Error::Cloud(why))
                }
            }
        }
    }

    fn download_whole(&mut self, path: &str, to: &Path) -> Result<bool> {
        let object = self.object_url(path);
        let key = self.project.anon_key.clone();
        let mut answer = self.call(&|agent, url, bearer| {
            agent
                .get(&format!("{url}/storage/v1/object/authenticated/{object}"))
                .header("apikey", &key)
                .header("Authorization", bearer)
                .call()
        })?;
        match answer.status().as_u16() {
            200..=299 => {
                let mut out = File::create(to)?;
                let mut body = answer.body_mut().with_config().limit(u64::MAX).reader();
                io::copy(&mut body, &mut out).map_err(|e| Error::Offline(e.to_string()))?;
                Ok(true)
            }
            400 | 404 => {
                let why = message(&mut answer);
                if why.contains("Bucket not found") {
                    Err(Error::Cloud(SETUP_HINT.into()))
                } else {
                    Ok(false)
                }
            }
            _ => Err(Error::Cloud(message(&mut answer))),
        }
    }

    fn read_range_whole(&mut self, path: &str, start: u64, end: u64) -> Result<Option<(Vec<u8>, u64)>> {
        let object = self.object_url(path);
        let key = self.project.anon_key.clone();
        let range = format!("bytes={start}-{end}");
        let mut answer = self.call(&|agent, url, bearer| {
            agent
                .get(&format!("{url}/storage/v1/object/authenticated/{object}"))
                .header("apikey", &key)
                .header("Authorization", bearer)
                .header("Range", &range)
                .call()
        })?;
        match answer.status().as_u16() {
            200..=299 | 416 => super::ranged_answer(&mut answer, start, end).map(Some),
            400 | 404 => Ok(None),
            _ => Err(Error::Cloud(message(&mut answer))),
        }
    }


    fn remove_whole(&mut self, path: &str) -> Result<()> {
        let object = self.object_url(path);
        let key = self.project.anon_key.clone();
        let mut answer = self.call(&|agent, url, bearer| {
            agent
                .delete(&format!("{url}/storage/v1/object/{object}"))
                .header("apikey", &key)
                .header("Authorization", bearer)
                .call()
        })?;
        match answer.status().as_u16() {
            200..=299 | 404 => Ok(()),
            400 if !message(&mut answer).contains("Bucket not found") => Ok(()),
            400 => Err(Error::Cloud(SETUP_HINT.into())),
            _ => Err(Error::Cloud(message(&mut answer))),
        }
    }

    /// Storage lists each file's size in its metadata (folders have none).
    fn list_raw(&mut self, folder: &str) -> Result<Vec<(String, Option<u64>)>> {
        #[derive(Deserialize)]
        struct Item {
            name: String,
            #[serde(default)]
            metadata: Option<Value>,
        }
        let prefix = format!("{}/{}", self.session.user_id, folder.trim_end_matches('/'));
        let key = self.project.anon_key.clone();
        let mut names = Vec::new();
        loop {
            let body = json!({ "prefix": prefix, "limit": 1000, "offset": names.len(), "sortBy": { "column": "name", "order": "asc" } });
            let mut answer = self.call(&|agent, url, bearer| {
                agent
                    .post(&format!("{url}/storage/v1/object/list/{BUCKET}"))
                    .header("apikey", &key)
                    .header("Authorization", bearer)
                    .send_json(&body)
            })?;
            if !answer.status().is_success() {
                let why = message(&mut answer);
                return Err(Error::Cloud(if why.contains("Bucket not found") { SETUP_HINT.into() } else { why }));
            }
            let page: Vec<Item> = answer.body_mut().read_json().map_err(|e| Error::Cloud(e.to_string()))?;
            let full = page.len() == 1000;
            names.extend(page.into_iter().map(|i| {
                let size = i.metadata.as_ref().and_then(|m| m.get("size")).and_then(Value::as_u64);
                (i.name, size)
            }));
            if !full {
                return Ok(names);
            }
        }
    }
}

impl Remote for Supabase {
    /// Made from the project and the person signed in, which every one of
    /// their devices shares.
    fn wake_key(&mut self) -> Result<Option<String>> {
        use sha2::Digest;
        let hash = sha2::Sha256::digest(format!("tbv-wake\n{}\n{}", self.project.url.trim_end_matches('/'), self.session.user_id));
        Ok(Some(hex::encode(&hash[..16])))
    }
    fn upload(&mut self, path: &str, file: &Path) -> Result<()> {
        let size = std::fs::metadata(file)?.len();
        self.pieces.remove(path);
        if size <= PIECE_BYTES {
            return self.upload_whole(path, file);
        }
        // Pieces first and the index last, so a half-sent file is never read as whole.
        let pieces = Pieces::of(size);
        for index in 0..pieces.count {
            if super::winding_down() {
                return Err(Error::Offline("TBV is closing".into()));
            }
            let file = file.to_path_buf();
            let start = index * pieces.piece;
            self.upload_with(&piece_path(path, index), &|| {
                let mut f = File::open(&file)?;
                io::Seek::seek(&mut f, io::SeekFrom::Start(start))?;
                Ok(Box::new(f.take(PIECE_BYTES)) as Box<dyn Read>)
            })?;
        }
        let index = serde_json::to_vec(&pieces)?;
        self.upload_with(&format!("{path}{PIECES}/{PIECE_INDEX}"), &|| Ok(Box::new(io::Cursor::new(index.clone())) as Box<dyn Read>))?;
        // A copy kept whole before (a paid plan, say) would be read first.
        self.remove_whole(path)?;
        self.pieces.insert(path.to_string(), pieces);
        Ok(())
    }

    fn download(&mut self, path: &str, to: &Path) -> Result<bool> {
        if self.download_whole(path, to)? {
            return Ok(true);
        }
        let Some(pieces) = self.pieces_of(path)? else { return Ok(false) };
        let mut out = File::create(to)?;
        for index in 0..pieces.count {
            let piece = to.with_extension("piece");
            let found = self.download_whole(&piece_path(path, index), &piece);
            let joined = found.and_then(|found| {
                if !found {
                    return Err(Error::Cloud("a piece of this file is missing from Supabase".into()));
                }
                io::copy(&mut File::open(&piece)?, &mut out)?;
                Ok(())
            });
            let _ = std::fs::remove_file(&piece);
            joined?;
        }
        out.flush()?;
        if out.metadata()?.len() != pieces.size {
            return Err(Error::Cloud("this file's pieces in Supabase don't add up".into()));
        }
        Ok(true)
    }

    fn read_range(&mut self, path: &str, start: u64, end: u64) -> Result<Option<(Vec<u8>, u64)>> {
        // Known to be in pieces: no need to ask for it whole each time.
        if !self.pieces.contains_key(path) {
            if let Some(found) = self.read_range_whole(path, start, end)? {
                return Ok(Some(found));
            }
        }
        let Some(pieces) = self.pieces_of(path)? else { return Ok(None) };
        let mut bytes = Vec::new();
        for (index, from, to) in pieces.covering(start, end) {
            match self.read_range_whole(&piece_path(path, index), from, to)? {
                Some((part, _)) => bytes.extend_from_slice(&part),
                None => return Err(Error::Cloud("a piece of this file is missing from Supabase".into())),
            }
        }
        Ok(Some((bytes, pieces.size)))
    }

    fn remove(&mut self, path: &str) -> Result<()> {
        self.remove_whole(path)?;
        self.pieces.remove(path);
        let folder = format!("{path}{PIECES}/");
        for (name, _) in self.list_raw(&folder)? {
            self.remove_whole(&format!("{folder}{name}"))?;
        }
        Ok(())
    }

    /// A file kept in pieces is listed as the one file, once its index is there.
    fn list_sizes(&mut self, folder: &str) -> Result<Vec<(String, Option<u64>)>> {
        let folder = format!("{}/", folder.trim_end_matches('/'));
        let mut out = Vec::new();
        for (name, size) in self.list_raw(&folder)? {
            match name.strip_suffix(PIECES) {
                Some(whole) if size.is_none() => {
                    let inside = self.list_raw(&format!("{folder}{name}/"))?;
                    if inside.iter().any(|(n, _)| n == PIECE_INDEX) {
                        let bytes = inside.iter().filter(|(n, _)| n != PIECE_INDEX).filter_map(|(_, s)| *s).sum();
                        out.push((whole.to_string(), Some(bytes)));
                    }
                }
                _ => out.push((name, size)),
            }
        }
        Ok(out)
    }

    fn covers_follow_files(&self) -> bool {
        true
    }

    fn push(&mut self, records: &[Record]) -> Result<()> {
        let device = self.device_id.clone();
        let rows: Vec<Value> = records
            .iter()
            .map(|r| json!({ "kind": r.kind, "key": r.key, "data": r.data, "changed_at": r.changed_at, "device_id": device }))
            .collect();
        let body = json!({ "records": rows });
        let key = self.project.anon_key.clone();
        let mut answer = self.call(&|agent, url, bearer| {
            agent
                .post(&format!("{url}/rest/v1/rpc/tbv_push"))
                .header("apikey", &key)
                .header("Authorization", bearer)
                .send_json(&body)
        })?;
        match answer.status().as_u16() {
            200..=299 => Ok(()),
            _ => Err(rest_problem(&mut answer)),
        }
    }

    fn pull(&mut self, after: &str, limit: usize) -> Result<Page> {
        let start = after;
        let after = seq_after(after);
        #[derive(Deserialize)]
        struct Row {
            seq: i64,
            #[serde(flatten)]
            record: Record,
        }
        let key = self.project.anon_key.clone();
        let mut answer = self.call(&|agent, url, bearer| {
            agent
                .get(&format!(
                    "{url}/rest/v1/tbv_records?select=seq,kind,key,data,changed_at&seq=gt.{after}&order=seq.asc&limit={limit}"
                ))
                .header("apikey", &key)
                .header("Authorization", bearer)
                .call()
        })?;
        match answer.status().as_u16() {
            200..=299 => {
                let rows: Vec<Row> = answer
                    .body_mut()
                    .with_config()
                    .limit(256 * 1024 * 1024)
                    .read_json()
                    .map_err(|e| Error::Cloud(e.to_string()))?;
                Ok(Page::numbered(rows.into_iter().map(|r| (r.seq, r.record)).collect(), start))
            }
            _ => Err(rest_problem(&mut answer)),
        }
    }



    fn list(&mut self, folder: &str) -> Result<Vec<String>> {
        Ok(self.list_sizes(folder)?.into_iter().map(|(name, _)| name).collect())
    }

}

/// How a live connection ended.
#[derive(Debug, PartialEq, Eq)]
pub enum Hung {
    /// Told to stop.
    Stopped,
    /// The connection dropped; worth trying again.
    Dropped,
    /// The project hasn't turned on live updates for TBV's table (the setup
    /// script from 1.35 does). Checking now and then carries on instead.
    NotSetUp,
}

/// The live-updates address of a project, like
/// `wss://abc.supabase.co/realtime/v1/websocket?apikey=…&vsn=1.0.0`.
pub(crate) fn realtime_url(project: &SupabaseProject) -> String {
    let base = project.url.trim().trim_end_matches('/');
    let base = base.strip_prefix("https://").map(|b| format!("wss://{b}")).or_else(|| base.strip_prefix("http://").map(|b| format!("ws://{b}"))).unwrap_or_else(|| base.to_string());
    format!("{base}/realtime/v1/websocket?apikey={}&vsn=1.0.0", crate::oauth::percent_encode(&project.anon_key))
}

/// What a live message means for TBV.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Heard {
    /// Another device saved a change.
    News,
    /// TBV's own change, or nothing to do with records.
    Nothing,
    /// The project said it can't send changes for TBV's table.
    NotSetUp,
    /// The project turned the connection down (a sign-in it won't take).
    TurnedDown,
}

pub(crate) fn heard(message: &Value, mine: &str) -> Heard {
    let event = message.get("event").and_then(Value::as_str).unwrap_or("");
    let payload = message.get("payload").cloned().unwrap_or(Value::Null);
    let status = payload.get("status").and_then(Value::as_str);
    match event {
        "postgres_changes" => {
            let device = payload.pointer("/data/record/device_id").and_then(Value::as_str);
            if device == Some(mine) {
                Heard::Nothing
            } else {
                Heard::News
            }
        }
        "system" if status == Some("error") => Heard::NotSetUp,
        "phx_reply" if status == Some("error") && message.get("topic").and_then(Value::as_str) != Some("phoenix") => Heard::TurnedDown,
        "phx_error" | "phx_close" => Heard::TurnedDown,
        _ => Heard::Nothing,
    }
}

/// Listens for other devices' changes the moment Supabase saves them, and
/// calls `news` for each. `token` gives the latest sign-in (it's renewed
/// elsewhere, by the regular checks) and `stop` ends the listening.
pub fn listen(project: &SupabaseProject, mine: &str, token: &dyn Fn() -> Option<String>, news: &mut dyn FnMut(), stop: &dyn Fn() -> bool) -> Result<Hung> {
    use tungstenite::stream::MaybeTlsStream;
    use tungstenite::Message;

    let Some(mut sent_token) = token() else { return Ok(Hung::Dropped) };
    let (mut socket, _) = tungstenite::connect(realtime_url(project)).map_err(|e| Error::Offline(e.to_string()))?;
    // Short waits for each message, so a heartbeat (or a stop) goes out on time.
    let wait = Some(Duration::from_secs(5));
    match socket.get_ref() {
        MaybeTlsStream::Plain(s) => s.set_read_timeout(wait)?,
        MaybeTlsStream::Rustls(s) => s.sock.set_read_timeout(wait)?,
        _ => {}
    }
    const TOPIC: &str = "realtime:tbv-records";
    let mut number = 1u64;
    let mut send = |socket: &mut tungstenite::WebSocket<_>, topic: &str, event: &str, payload: Value| -> Result<()> {
        number += 1;
        let text = json!({ "topic": topic, "event": event, "payload": payload, "ref": number.to_string(), "join_ref": "1" }).to_string();
        socket.send(Message::text(text)).map_err(|e| Error::Offline(e.to_string()))
    };
    let join = json!({
        "config": {
            "broadcast": { "self": false },
            "presence": { "key": "" },
            "postgres_changes": [{ "event": "*", "schema": "public", "table": "tbv_records" }],
        },
        "access_token": sent_token,
    });
    send(&mut socket, TOPIC, "phx_join", join)?;
    let mut beat = std::time::Instant::now();
    loop {
        if stop() {
            let _ = socket.close(None);
            return Ok(Hung::Stopped);
        }
        if beat.elapsed() >= Duration::from_secs(25) {
            beat = std::time::Instant::now();
            send(&mut socket, "phoenix", "heartbeat", json!({}))?;
            // A renewed sign-in is passed on before the old one runs out.
            if let Some(latest) = token().filter(|t| *t != sent_token) {
                send(&mut socket, TOPIC, "access_token", json!({ "access_token": latest }))?;
                sent_token = latest;
            }
        }
        match socket.read() {
            Ok(Message::Text(text)) => {
                let message: Value = serde_json::from_str(text.as_str()).unwrap_or(Value::Null);
                match heard(&message, mine) {
                    Heard::News => news(),
                    Heard::Nothing => {}
                    Heard::NotSetUp => return Ok(Hung::NotSetUp),
                    Heard::TurnedDown => return Ok(Hung::Dropped),
                }
            }
            Ok(Message::Close(_)) => return Ok(Hung::Dropped),
            Ok(_) => {}
            Err(tungstenite::Error::Io(e)) if matches!(e.kind(), io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut) => {}
            Err(_) => return Ok(Hung::Dropped),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn answer(status: u16, body: &str) -> Response<Body> {
        let body = Body::builder().mime_type("application/json").data(body.to_owned());
        let mut response = Response::new(body);
        *response.status_mut() = ureq::http::StatusCode::from_u16(status).unwrap();
        response
    }

    #[test]
    fn live_messages_are_told_apart() {
        let project = SupabaseProject { url: "https://abc.supabase.co/".into(), anon_key: "sb_publishable_x".into() };
        assert_eq!(realtime_url(&project), "wss://abc.supabase.co/realtime/v1/websocket?apikey=sb_publishable_x&vsn=1.0.0");
        let change = |device: &str| json!({ "event": "postgres_changes", "payload": { "data": { "type": "UPDATE", "record": { "device_id": device } } } });
        assert_eq!(heard(&change("phone"), "desk"), Heard::News);
        assert_eq!(heard(&change("desk"), "desk"), Heard::Nothing);
        assert_eq!(heard(&json!({ "event": "phx_reply", "topic": "phoenix", "payload": { "status": "ok" } }), "desk"), Heard::Nothing);
        assert_eq!(heard(&json!({ "event": "phx_reply", "topic": "realtime:tbv-records", "payload": { "status": "error" } }), "desk"), Heard::TurnedDown);
        assert_eq!(heard(&json!({ "event": "system", "payload": { "status": "error", "message": "Unable to subscribe" } }), "desk"), Heard::NotSetUp);
    }

    #[test]
    fn big_files_are_read_back_across_their_pieces() {
        let pieces = Pieces::of(PIECE_BYTES * 2 + 10);
        assert_eq!(pieces.count, 3);
        assert_eq!(Pieces::of(PIECE_BYTES).count, 1);
        // Within one piece, across two, and past the end.
        assert_eq!(pieces.covering(5, 9), vec![(0, 5, 9)]);
        assert_eq!(pieces.covering(PIECE_BYTES - 2, PIECE_BYTES + 1), vec![(0, PIECE_BYTES - 2, PIECE_BYTES - 1), (1, 0, 1)]);
        assert_eq!(pieces.covering(PIECE_BYTES * 2 + 5, u64::MAX - 1), vec![(2, 5, 9)]);
        assert!(pieces.covering(PIECE_BYTES * 3, PIECE_BYTES * 3 + 5).is_empty());
        assert_eq!(piece_path("books/ab.m4b", 2), "books/ab.m4b.pieces/0002");
    }

    #[test]
    fn usage_is_read_by_folder() {
        let found = json!({
            "database_bytes": 12_000_000,
            "folders": { "books": { "bytes": 700, "files": 2 }, "audio": { "bytes": 200, "files": 1 }, "covers": { "bytes": 50, "files": 5 }, "pictures": { "bytes": 5, "files": 1 } }
        });
        let usage = Usage::from_answer(&found);
        assert_eq!(usage.file_bytes, 955);
        assert_eq!(usage.files, 9);
        assert_eq!((usage.book_bytes, usage.audio_bytes, usage.picture_bytes), (700, 200, 55));
        assert_eq!(usage.database_bytes, Some(12_000_000));
        assert_eq!(Usage::from_answer(&json!({})), Usage::default());
    }

    #[test]
    fn busy_answers_are_told_apart_from_real_problems() {
        assert!(busy(503, ""));
        assert!(busy(400, r#"{"statusCode":"500","error":"internal","message":"too many connections issued to the database"}"#));
        assert!(busy(500, "Too many connections"));
        assert!(!busy(400, r#"{"statusCode":"404","error":"not_found","message":"Object not found"}"#));
        assert!(!busy(413, "Payload too large"));
        assert!(!busy(404, "timeout"));
    }

    #[test]
    fn data_api_errors_name_the_fix() {
        let text = |status, body| rest_problem(&mut answer(status, body)).to_string();
        let missing = text(404, r#"{"code":"PGRST205","message":"Could not find the table 'public.tbv_records' in the schema cache"}"#);
        assert!(missing.contains("Run the setup script"), "{missing}");
        assert!(missing.contains("schema cache"), "Supabase's own words are kept: {missing}");
        let hidden = text(406, r#"{"code":"PGRST106","message":"Invalid schema: public"}"#);
        assert!(hidden.contains("Exposed schemas"), "{hidden}");
        let off = text(404, "");
        assert!(off.contains("turned on"), "{off}");
        let other = text(500, r#"{"message":"boom"}"#);
        assert_eq!(other, "the cloud said: boom");
    }
}

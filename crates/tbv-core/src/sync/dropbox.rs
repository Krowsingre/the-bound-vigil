//! Dropbox as a `Store`, through its own API. TBV's library is the app
//! folder Dropbox gives it (`Apps/The Bound Vigil`).

use std::fs::File;
use std::io::{self, Read};
use std::path::Path;

use serde_json::{json, Value};
use ureq::http::{Request, Response};
use ureq::{Agent, Body};

use super::cloud::{self, agent, read_json, signed_out, transport, wait_if_busy, CloudAccount, Http, Service};
use super::files::Store;
use crate::error::{Error, Result};

const API: &str = "https://api.dropboxapi.com/2";
const CONTENT: &str = "https://content.dropboxapi.com/2";
/// Files bigger than this go up in pieces (Dropbox takes up to 150 MB at once).
const ONE_GO: u64 = 128 * 1024 * 1024;
const PIECE: usize = 64 * 1024 * 1024;

pub struct Dropbox {
    agent: Agent,
    account: CloudAccount,
    /// Where the last look for other devices' changes left off.
    cursor: Option<String>,
}

/// How long one wait for changes lasts. Dropbox adds up to 90 seconds of its
/// own, so the wait's connection allows for more than both.
const WAIT_SECS: u64 = 60;

/// `"covers/a.jpg"` as Dropbox writes it: `"/covers/a.jpg"`, and the app
/// folder itself as `""`.
fn dropbox_path(path: &str) -> String {
    let path = path.trim_matches('/');
    if path.is_empty() {
        String::new()
    } else {
        format!("/{path}")
    }
}

/// JSON for the Dropbox-API-Arg header, which must be plain ASCII.
pub(crate) fn header_json(value: &Value) -> String {
    let text = value.to_string();
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        if c.is_ascii() {
            out.push(c);
        } else {
            let mut units = [0u16; 2];
            for unit in c.encode_utf16(&mut units) {
                out.push_str(&format!("\\u{unit:04x}"));
            }
        }
    }
    out
}

/// Whether a 409 answer means there's no such file or folder.
fn not_found(body: &Value) -> bool {
    body.get("error_summary").and_then(Value::as_str).is_some_and(|s| s.contains("not_found"))
}

fn problem(status: u16, body: &Value, doing: &str) -> Error {
    let summary = body.get("error_summary").and_then(Value::as_str).unwrap_or("");
    if summary.contains("insufficient_space") {
        return Error::Rejected("your Dropbox is full".into());
    }
    if status == 401 {
        return signed_out(Service::Dropbox);
    }
    Error::Cloud(format!("Dropbox wouldn't {doing} (status {status}{})", if summary.is_empty() { String::new() } else { format!(": {summary}") }))
}

impl Dropbox {
    /// Checks the sign-in still works.
    pub fn open(account: &CloudAccount) -> Result<Self> {
        cloud::access_token(&Http, account)?;
        Ok(Self { agent: agent(), account: account.clone(), cursor: None })
    }

    /// Sends a request with a fresh sign-in, trying again once if the access
    /// token had stopped working and when Dropbox asks TBV to slow down.
    fn send(&self, build: impl Fn(&str) -> Result<Request<Vec<u8>>>) -> Result<Response<Body>> {
        let mut attempt = 0;
        let mut refreshed = false;
        loop {
            let token = cloud::access_token(&Http, &self.account)?;
            let answer = self.agent.run(build(&format!("Bearer {token}"))?).map_err(transport)?;
            if answer.status().as_u16() == 401 && !refreshed {
                cloud::forget_access(&self.account);
                refreshed = true;
                continue;
            }
            if wait_if_busy(&answer, attempt) {
                attempt += 1;
                continue;
            }
            return Ok(answer);
        }
    }

    fn rpc(&self, endpoint: &str, args: &Value) -> Result<(u16, Value)> {
        let body = args.to_string();
        read_json(self.send(|auth| {
            Request::post(format!("{API}{endpoint}"))
                .header("Authorization", auth)
                .header("Content-Type", "application/json")
                .body(body.clone().into_bytes())
                .map_err(|e| Error::Cloud(e.to_string()))
        })?)
    }

    fn download(&self, path: &str, range: Option<(u64, u64)>) -> Result<Option<Response<Body>>> {
        let arg = header_json(&json!({ "path": dropbox_path(path) }));
        let answer = self.send(|auth| {
            let mut request = Request::post(format!("{CONTENT}/files/download")).header("Authorization", auth).header("Dropbox-API-Arg", &arg);
            if let Some((start, end)) = range {
                request = request.header("Range", format!("bytes={start}-{end}"));
            }
            request.body(Vec::new()).map_err(|e| Error::Cloud(e.to_string()))
        })?;
        match answer.status().as_u16() {
            200..=299 | 416 => Ok(Some(answer)),
            409 => {
                let (status, body) = read_json(answer)?;
                if not_found(&body) {
                    Ok(None)
                } else {
                    Err(problem(status, &body, "send a file"))
                }
            }
            status => {
                let (_, body) = read_json(answer)?;
                Err(problem(status, &body, "send a file"))
            }
        }
    }

    fn upload_bytes(&self, endpoint: &str, arg: &Value, bytes: Vec<u8>) -> Result<(u16, Value)> {
        let arg = header_json(arg);
        read_json(self.send(|auth| {
            Request::post(format!("{CONTENT}{endpoint}"))
                .header("Authorization", auth)
                .header("Dropbox-API-Arg", &arg)
                .header("Content-Type", "application/octet-stream")
                .body(bytes.clone())
                .map_err(|e| Error::Cloud(e.to_string()))
        })?)
    }

    fn commit(path: &str) -> Value {
        json!({ "path": dropbox_path(path), "mode": "overwrite", "autorename": false, "mute": true })
    }

    /// A big file, in pieces read from disk as they go.
    fn upload_in_pieces(&self, path: &str, file: &Path) -> Result<()> {
        let mut reader = File::open(file)?;
        let mut piece = vec![0u8; PIECE];
        let mut offset: u64 = 0;
        let mut session: Option<String> = None;
        loop {
            let mut filled = 0;
            while filled < PIECE {
                let n = reader.read(&mut piece[filled..])?;
                if n == 0 {
                    break;
                }
                filled += n;
            }
            let last = filled < PIECE;
            let bytes = piece[..filled].to_vec();
            let (status, body) = match &session {
                None => self.upload_bytes("/files/upload_session/start", &json!({ "close": false }), bytes)?,
                Some(id) if last => self.upload_bytes(
                    "/files/upload_session/finish",
                    &json!({ "cursor": { "session_id": id, "offset": offset }, "commit": Self::commit(path) }),
                    bytes,
                )?,
                Some(id) => self.upload_bytes("/files/upload_session/append_v2", &json!({ "cursor": { "session_id": id, "offset": offset }, "close": false }), bytes)?,
            };
            if !(200..300).contains(&status) {
                return Err(problem(status, &body, "save a file"));
            }
            if session.is_none() {
                session = Some(body.get("session_id").and_then(Value::as_str).ok_or_else(|| Error::Cloud("Dropbox didn't start the upload".into()))?.to_string());
                if last {
                    // The whole file fitted in the first piece after all.
                    let (status, body) = self.upload_bytes(
                        "/files/upload_session/finish",
                        &json!({ "cursor": { "session_id": session, "offset": filled as u64 }, "commit": Self::commit(path) }),
                        Vec::new(),
                    )?;
                    if !(200..300).contains(&status) {
                        return Err(problem(status, &body, "save a file"));
                    }
                    return Ok(());
                }
            }
            offset += filled as u64;
            if last {
                return Ok(());
            }
        }
    }

    fn list_entries(&self, folder: &str) -> Result<Vec<(String, Option<u64>)>> {
        let (mut status, mut body) = self.rpc("/files/list_folder", &json!({ "path": dropbox_path(folder), "limit": 2000 }))?;
        let mut names = Vec::new();
        loop {
            if status == 409 && not_found(&body) {
                return Ok(Vec::new());
            }
            if !(200..300).contains(&status) {
                return Err(problem(status, &body, "list a folder"));
            }
            for entry in body.get("entries").and_then(Value::as_array).into_iter().flatten() {
                let Some(name) = entry.get("name").and_then(Value::as_str) else { continue };
                if name.starts_with('.') {
                    continue;
                }
                names.push((name.to_string(), entry.get("size").and_then(Value::as_u64)));
            }
            if body.get("has_more").and_then(Value::as_bool) != Some(true) {
                return Ok(names);
            }
            let cursor = body.get("cursor").cloned().unwrap_or(Value::Null);
            (status, body) = self.rpc("/files/list_folder/continue", &json!({ "cursor": cursor }))?;
        }
    }
}

impl Dropbox {
    /// Waits (up to a minute or so) for anything in TBV's folder to change.
    /// Dropbox answers the moment something does. The wait itself needs no
    /// sign-in: the cursor says which folder.
    fn wait_for_change(&self, cursor: &str) -> Result<bool> {
        let waiting: Agent = Agent::config_builder()
            .http_status_as_error(false)
            .timeout_connect(Some(std::time::Duration::from_secs(15)))
            .timeout_recv_response(Some(std::time::Duration::from_secs(WAIT_SECS + 120)))
            .build()
            .into();
        let answer = waiting
            .post("https://notify.dropboxapi.com/2/files/list_folder/longpoll")
            .header("Content-Type", "application/json")
            .send(json!({ "cursor": cursor, "timeout": WAIT_SECS }).to_string())
            .map_err(transport)?;
        let (status, body) = read_json(answer)?;
        if !(200..300).contains(&status) {
            return Err(problem(status, &body, "say whether anything changed"));
        }
        // Dropbox can ask for a pause before the next wait.
        if let Some(backoff) = body.get("backoff").and_then(Value::as_u64) {
            std::thread::sleep(std::time::Duration::from_secs(backoff.min(300)));
        }
        Ok(body.get("changes").and_then(Value::as_bool) == Some(true))
    }
}

impl Store for Dropbox {
    fn news(&mut self, mine: &str) -> Result<Option<bool>> {
        let Some(mut cursor) = self.cursor.clone() else {
            let (status, body) = self.rpc("/files/list_folder/get_latest_cursor", &json!({ "path": "", "recursive": true }))?;
            if !(200..300).contains(&status) {
                return Err(problem(status, &body, "say whether anything changed"));
            }
            self.cursor = body.get("cursor").and_then(Value::as_str).map(str::to_string);
            return Ok(Some(false));
        };
        if !self.wait_for_change(&cursor)? {
            return Ok(Some(false));
        }
        // Something changed: what, and was it another device's?
        let mut news = false;
        loop {
            let (status, body) = self.rpc("/files/list_folder/continue", &json!({ "cursor": cursor }))?;
            if status == 409 {
                // The cursor is too old; start again from now, and sync to be sure.
                self.cursor = None;
                return Ok(Some(true));
            }
            if !(200..300).contains(&status) {
                return Err(problem(status, &body, "say what changed"));
            }
            for entry in body.get("entries").and_then(Value::as_array).into_iter().flatten() {
                let Some(path) = entry.get("path_display").and_then(Value::as_str) else { continue };
                news |= super::files::is_news_from_elsewhere(Path::new(path.trim_start_matches('/')), mine);
            }
            cursor = body.get("cursor").and_then(Value::as_str).unwrap_or(&cursor).to_string();
            if body.get("has_more").and_then(Value::as_bool) != Some(true) {
                break;
            }
        }
        self.cursor = Some(cursor);
        Ok(Some(news))
    }


    fn read(&mut self, path: &str) -> Result<Option<Vec<u8>>> {
        let Some(mut answer) = self.download(path, None)? else { return Ok(None) };
        Ok(Some(answer.body_mut().with_config().limit(64 * 1024 * 1024).read_to_vec().map_err(transport)?))
    }

    fn write(&mut self, path: &str, bytes: &[u8]) -> Result<()> {
        let (status, body) = self.upload_bytes("/files/upload", &Self::commit(path), bytes.to_vec())?;
        if (200..300).contains(&status) {
            Ok(())
        } else {
            Err(problem(status, &body, "save a file"))
        }
    }

    fn put_file(&mut self, path: &str, file: &Path) -> Result<()> {
        if std::fs::metadata(file)?.len() > ONE_GO {
            return self.upload_in_pieces(path, file);
        }
        self.write(path, &std::fs::read(file)?)
    }

    fn get_file(&mut self, path: &str, to: &Path) -> Result<bool> {
        let Some(mut answer) = self.download(path, None)? else { return Ok(false) };
        let mut out = File::create(to)?;
        io::copy(&mut answer.body_mut().with_config().limit(u64::MAX).reader(), &mut out)?;
        Ok(true)
    }

    fn list(&mut self, folder: &str) -> Result<Vec<String>> {
        Ok(self.list_entries(folder)?.into_iter().map(|(name, _)| name).collect())
    }

    fn list_sizes(&mut self, folder: &str) -> Result<Vec<(String, Option<u64>)>> {
        self.list_entries(folder)
    }

    fn remove(&mut self, path: &str) -> Result<()> {
        let (status, body) = self.rpc("/files/delete_v2", &json!({ "path": dropbox_path(path) }))?;
        match status {
            200..=299 => Ok(()),
            409 if not_found(&body) => Ok(()),
            _ => Err(problem(status, &body, "erase a file")),
        }
    }

    fn read_range(&mut self, path: &str, start: u64, end: u64) -> Result<Option<(Vec<u8>, u64)>> {
        let Some(mut answer) = self.download(path, Some((start, end)))? else { return Ok(None) };
        super::ranged_answer(&mut answer, start, end).map(Some)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paths_and_headers_are_written_the_way_dropbox_expects() {
        assert_eq!(dropbox_path(""), "");
        assert_eq!(dropbox_path("covers/"), "/covers");
        assert_eq!(dropbox_path("changes/a/1.json"), "/changes/a/1.json");
        assert_eq!(header_json(&json!({ "path": "/d\u{e9}j\u{e0} \u{1f4da}" })), "{\"path\":\"/d\\u00e9j\\u00e0 \\ud83d\\udcda\"}");
        assert!(not_found(&json!({ "error_summary": "path/not_found/.." })));
    }
}

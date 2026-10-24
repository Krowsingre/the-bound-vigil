//! Google Drive as a `Store`, through its own API. TBV only asks to see the
//! files it made itself, so the library is a "The Bound Vigil" folder TBV
//! makes in My Drive, and nothing else in the Drive is visible to it.
//!
//! Drive finds files by id, not by path, so each path's id is looked up a
//! folder at a time and remembered while the connection is open.

use std::collections::HashMap;
use std::fs::File;
use std::io::{self, Read};
use std::path::Path;

use serde_json::{json, Value};
use ureq::http::{Method, Request, Response};
use ureq::{Agent, Body};

use super::cloud::{self, agent, read_json, signed_out, transport, wait_if_busy, CloudAccount, Http, Service};
use super::files::{Store, LIBRARY_FOLDER};
use crate::error::{Error, Result};
use crate::oauth::percent_encode;

const FILES: &str = "https://www.googleapis.com/drive/v3/files";
const UPLOAD: &str = "https://www.googleapis.com/upload/drive/v3/files";
const FOLDER: &str = "application/vnd.google-apps.folder";
/// Pieces of a big upload must be a multiple of 256 KiB.
const PIECE: usize = 256 * 1024 * 128;

pub struct GoogleDrive {
    agent: Agent,
    account: CloudAccount,
    /// Ids by path inside the library folder; "" is the library folder.
    ids: HashMap<String, String>,
}

/// A name as Drive's search wants it, inside single quotes.
fn quoted(name: &str) -> String {
    format!("'{}'", name.replace('\\', "\\\\").replace('\'', "\\'"))
}

fn problem(status: u16, body: &Value, doing: &str) -> Error {
    let reason = body.pointer("/error/errors/0/reason").and_then(Value::as_str).unwrap_or("");
    if reason == "storageQuotaExceeded" || reason == "quotaExceeded" {
        return Error::Rejected("your Google Drive is full".into());
    }
    if status == 401 {
        return signed_out(Service::GoogleDrive);
    }
    Error::Cloud(format!("Google Drive wouldn't {doing} (status {status}{})", if reason.is_empty() { String::new() } else { format!(": {reason}") }))
}

fn split(path: &str) -> (&str, &str) {
    let path = path.trim_matches('/');
    match path.rfind('/') {
        Some(at) => (&path[..at], &path[at + 1..]),
        None => ("", path),
    }
}

impl GoogleDrive {
    /// Checks the sign-in, and finds (or makes) TBV's folder.
    pub fn open(account: &CloudAccount) -> Result<Self> {
        let mut drive = Self { agent: agent(), account: account.clone(), ids: HashMap::new() };
        let root = match drive.find("root", LIBRARY_FOLDER)? {
            Some((id, _)) => id,
            None => drive.make_folder("root", LIBRARY_FOLDER)?,
        };
        drive.ids.insert(String::new(), root);
        Ok(drive)
    }

    fn send(&self, method: Method, url: &str, headers: &[(&str, String)], body: Vec<u8>) -> Result<Response<Body>> {
        let mut attempt = 0;
        let mut refreshed = false;
        loop {
            let token = cloud::access_token(&Http, &self.account)?;
            let mut request = Request::builder().method(method.clone()).uri(url).header("Authorization", format!("Bearer {token}"));
            for (name, value) in headers {
                request = request.header(*name, value);
            }
            let request = request.body(body.clone()).map_err(|e| Error::Cloud(e.to_string()))?;
            let answer = self.agent.run(request).map_err(transport)?;
            if answer.status().as_u16() == 401 && !refreshed {
                cloud::forget_access(&self.account);
                refreshed = true;
                continue;
            }
            // Drive says "slow down" with a 403 too.
            let limited = answer.status().as_u16() == 403 && answer.headers().get("retry-after").is_some();
            if (limited || matches!(answer.status().as_u16(), 429 | 503)) && attempt < 4 {
                if !wait_if_busy(&answer, attempt) {
                    std::thread::sleep(std::time::Duration::from_secs(2u64 << attempt));
                }
                attempt += 1;
                continue;
            }
            return Ok(answer);
        }
    }

    fn json(&self, method: Method, url: &str, body: Option<&Value>) -> Result<(u16, Value)> {
        let (headers, bytes) = match body {
            Some(b) => (vec![("Content-Type", "application/json; charset=UTF-8".to_string())], b.to_string().into_bytes()),
            None => (Vec::new(), Vec::new()),
        };
        read_json(self.send(method, url, &headers, bytes)?)
    }

    /// The newest file or folder called `name` in the folder `parent`.
    fn find(&self, parent: &str, name: &str) -> Result<Option<(String, bool)>> {
        let q = format!("{} in parents and name = {} and trashed = false", quoted(parent), quoted(name));
        let url = format!("{FILES}?q={}&fields=files(id,mimeType)&orderBy=modifiedTime%20desc&pageSize=10&spaces=drive", percent_encode(&q));
        let (status, body) = self.json(Method::GET, &url, None)?;
        if !(200..300).contains(&status) {
            return Err(problem(status, &body, "look for a file"));
        }
        Ok(body.pointer("/files/0").and_then(|f| {
            let id = f.get("id")?.as_str()?.to_string();
            Some((id, f.get("mimeType").and_then(Value::as_str) == Some(FOLDER)))
        }))
    }

    fn make_folder(&self, parent: &str, name: &str) -> Result<String> {
        let (status, body) = self.json(Method::POST, &format!("{FILES}?fields=id"), Some(&json!({ "name": name, "mimeType": FOLDER, "parents": [parent] })))?;
        if !(200..300).contains(&status) {
            return Err(problem(status, &body, "make a folder"));
        }
        body.get("id").and_then(Value::as_str).map(str::to_string).ok_or_else(|| Error::Cloud("Google Drive didn't make the folder".into()))
    }

    /// The id of `path`, looked up a folder at a time. Folders on the way
    /// are made when `make` is set.
    fn id(&mut self, path: &str, make: bool) -> Result<Option<String>> {
        let path = path.trim_matches('/').to_string();
        if let Some(id) = self.ids.get(&path) {
            return Ok(Some(id.clone()));
        }
        let (parent_path, name) = split(&path);
        let Some(parent) = self.id(parent_path, make)? else { return Ok(None) };
        let found = match self.find(&parent, name)? {
            Some((id, _)) => Some(id),
            None if make => Some(self.make_folder(&parent, name)?),
            None => None,
        };
        if let Some(id) = &found {
            self.ids.insert(path, id.clone());
        }
        Ok(found)
    }

    /// The id of a file, or None. A remembered id that has since gone is looked up again.
    fn file_id(&mut self, path: &str) -> Result<Option<String>> {
        self.id(path, false)
    }

    fn media(&mut self, path: &str, range: Option<(u64, u64)>) -> Result<Option<Response<Body>>> {
        for attempt in 0..2 {
            let Some(id) = self.file_id(path)? else { return Ok(None) };
            let headers: Vec<(&str, String)> = range.map(|(s, e)| ("Range", format!("bytes={s}-{e}"))).into_iter().collect();
            let answer = self.send(Method::GET, &format!("{FILES}/{id}?alt=media"), &headers, Vec::new())?;
            match answer.status().as_u16() {
                200..=299 | 416 => return Ok(Some(answer)),
                404 if attempt == 0 => {
                    self.ids.remove(path.trim_matches('/'));
                }
                404 => return Ok(None),
                status => {
                    let (_, body) = read_json(answer)?;
                    return Err(problem(status, &body, "send a file"));
                }
            }
        }
        Ok(None)
    }

    /// Starts a resumable upload, of a new file or over an existing one, and
    /// gives the address to send the bytes to.
    fn start_upload(&mut self, path: &str, size: u64) -> Result<String> {
        let (parent_path, name) = split(path);
        let existing = self.file_id(path)?;
        let headers = vec![("Content-Type", "application/json; charset=UTF-8".to_string()), ("X-Upload-Content-Length", size.to_string())];
        let answer = match &existing {
            Some(id) => self.send(Method::PATCH, &format!("{UPLOAD}/{id}?uploadType=resumable&fields=id"), &headers, b"{}".to_vec())?,
            None => {
                let parent = self.id(parent_path, true)?.ok_or_else(|| Error::Cloud("Google Drive didn't make the folder".into()))?;
                let meta = json!({ "name": name, "parents": [parent] }).to_string().into_bytes();
                self.send(Method::POST, &format!("{UPLOAD}?uploadType=resumable&fields=id"), &headers, meta)?
            }
        };
        let status = answer.status().as_u16();
        if status == 404 && existing.is_some() {
            // Gone since it was looked up: make it afresh.
            self.ids.remove(path.trim_matches('/'));
            return self.start_upload(path, size);
        }
        if !(200..300).contains(&status) {
            let (_, body) = read_json(answer)?;
            return Err(problem(status, &body, "save a file"));
        }
        answer.headers().get("location").and_then(|v| v.to_str().ok()).map(str::to_string).ok_or_else(|| Error::Cloud("Google Drive didn't start the upload".into()))
    }

    fn finish_upload(&mut self, path: &str, answer: Response<Body>) -> Result<()> {
        let (status, body) = read_json(answer)?;
        if !(200..300).contains(&status) {
            return Err(problem(status, &body, "save a file"));
        }
        if let Some(id) = body.get("id").and_then(Value::as_str) {
            self.ids.insert(path.trim_matches('/').to_string(), id.to_string());
        }
        Ok(())
    }

    fn children(&mut self, folder: &str) -> Result<Vec<(String, Option<u64>)>> {
        let Some(parent) = self.id(folder, false)? else { return Ok(Vec::new()) };
        let q = format!("{} in parents and trashed = false", quoted(&parent));
        let mut token: Option<String> = None;
        let mut seen = HashMap::new();
        let mut names = Vec::new();
        loop {
            let mut url = format!("{FILES}?q={}&fields=nextPageToken,files(id,name,size,mimeType)&pageSize=1000&spaces=drive&orderBy=modifiedTime%20desc", percent_encode(&q));
            if let Some(t) = &token {
                url.push_str(&format!("&pageToken={}", percent_encode(t)));
            }
            let (status, body) = self.json(Method::GET, &url, None)?;
            if status == 404 {
                return Ok(Vec::new());
            }
            if !(200..300).contains(&status) {
                return Err(problem(status, &body, "list a folder"));
            }
            for f in body.get("files").and_then(Value::as_array).into_iter().flatten() {
                let (Some(name), Some(id)) = (f.get("name").and_then(Value::as_str), f.get("id").and_then(Value::as_str)) else { continue };
                // Two files of one name: the newest (listed first) counts.
                if name.starts_with('.') || seen.insert(name.to_string(), ()).is_some() {
                    continue;
                }
                let folder_path = folder.trim_matches('/');
                let key = if folder_path.is_empty() { name.to_string() } else { format!("{folder_path}/{name}") };
                self.ids.insert(key, id.to_string());
                let size = f.get("size").and_then(|s| s.as_str().and_then(|s| s.parse().ok()).or_else(|| s.as_u64()));
                names.push((name.to_string(), size));
            }
            token = body.get("nextPageToken").and_then(Value::as_str).map(str::to_string);
            if token.is_none() {
                return Ok(names);
            }
        }
    }
}

impl Store for GoogleDrive {
    fn read(&mut self, path: &str) -> Result<Option<Vec<u8>>> {
        let Some(mut answer) = self.media(path, None)? else { return Ok(None) };
        Ok(Some(answer.body_mut().with_config().limit(64 * 1024 * 1024).read_to_vec().map_err(transport)?))
    }

    fn write(&mut self, path: &str, bytes: &[u8]) -> Result<()> {
        let url = self.start_upload(path, bytes.len() as u64)?;
        let request = Request::put(&url).body(bytes.to_vec()).map_err(|e| Error::Cloud(e.to_string()))?;
        let answer = self.agent.run(request).map_err(transport)?;
        self.finish_upload(path, answer)
    }

    fn put_file(&mut self, path: &str, file: &Path) -> Result<()> {
        let size = std::fs::metadata(file)?.len();
        if size <= PIECE as u64 {
            return self.write(path, &std::fs::read(file)?);
        }
        let url = self.start_upload(path, size)?;
        let mut reader = File::open(file)?;
        let mut piece = vec![0u8; PIECE];
        let mut offset: u64 = 0;
        loop {
            let mut filled = 0;
            while filled < PIECE {
                let n = reader.read(&mut piece[filled..])?;
                if n == 0 {
                    break;
                }
                filled += n;
            }
            if filled == 0 {
                return Err(Error::Cloud("the file got shorter while it was being sent".into()));
            }
            let end = offset + filled as u64 - 1;
            let request = Request::put(&url)
                .header("Content-Range", format!("bytes {offset}-{end}/{size}"))
                .body(piece[..filled].to_vec())
                .map_err(|e| Error::Cloud(e.to_string()))?;
            let answer = self.agent.run(request).map_err(transport)?;
            match answer.status().as_u16() {
                // 308: more to come.
                308 => offset = end + 1,
                200..=299 => return self.finish_upload(path, answer),
                status => {
                    let (_, body) = read_json(answer)?;
                    return Err(problem(status, &body, "save a file"));
                }
            }
        }
    }

    fn get_file(&mut self, path: &str, to: &Path) -> Result<bool> {
        let Some(mut answer) = self.media(path, None)? else { return Ok(false) };
        let mut out = File::create(to)?;
        io::copy(&mut answer.body_mut().with_config().limit(u64::MAX).reader(), &mut out)?;
        Ok(true)
    }

    fn list(&mut self, folder: &str) -> Result<Vec<String>> {
        Ok(self.children(folder)?.into_iter().map(|(name, _)| name).collect())
    }

    fn list_sizes(&mut self, folder: &str) -> Result<Vec<(String, Option<u64>)>> {
        self.children(folder)
    }

    fn remove(&mut self, path: &str) -> Result<()> {
        let Some(id) = self.file_id(path)? else { return Ok(()) };
        self.ids.remove(path.trim_matches('/'));
        let answer = self.send(Method::DELETE, &format!("{FILES}/{id}"), &[], Vec::new())?;
        match answer.status().as_u16() {
            200..=299 | 404 => Ok(()),
            status => {
                let (_, body) = read_json(answer)?;
                Err(problem(status, &body, "erase a file"))
            }
        }
    }

    fn read_range(&mut self, path: &str, start: u64, end: u64) -> Result<Option<(Vec<u8>, u64)>> {
        let Some(mut answer) = self.media(path, Some((start, end)))? else { return Ok(None) };
        super::ranged_answer(&mut answer, start, end).map(Some)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_are_searched_for_safely() {
        assert_eq!(quoted("The Bound Vigil"), "'The Bound Vigil'");
        assert_eq!(quoted("Wren's \\ book"), r"'Wren\'s \\ book'");
        assert_eq!(split("covers/a.jpg"), ("covers", "a.jpg"));
        assert_eq!(split("marker.json"), ("", "marker.json"));
        assert_eq!(split("changes/dev/"), ("changes", "dev"));
        assert_eq!(PIECE % (256 * 1024), 0);
    }
}

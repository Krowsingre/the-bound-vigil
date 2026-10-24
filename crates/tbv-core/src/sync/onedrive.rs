//! OneDrive as a `Store`, through Microsoft Graph. TBV's library is the app
//! folder OneDrive gives it (`Apps/The Bound Vigil`).

use std::fs::File;
use std::io::{self, Read};
use std::path::Path;

use serde_json::{json, Value};
use ureq::http::{Method, Request, Response};
use ureq::{Agent, Body};

use super::cloud::{self, agent, read_json, signed_out, transport, wait_if_busy, CloudAccount, Http, Service};
use super::files::Store;
use crate::error::{Error, Result};
use crate::oauth::percent_encode;

const ROOT: &str = "https://graph.microsoft.com/v1.0/me/drive/special/approot";
/// Files up to this go up in one request (Graph takes up to 250 MB).
const ONE_GO: u64 = 16 * 1024 * 1024;
/// Pieces must be a multiple of 320 KiB.
const PIECE: usize = 320 * 1024 * 32;

pub struct OneDrive {
    agent: Agent,
    account: CloudAccount,
}

/// The Graph address of an item by its path in the app folder.
fn item(path: &str) -> String {
    let path = path.trim_matches('/');
    if path.is_empty() {
        return ROOT.to_string();
    }
    let encoded: Vec<String> = path.split('/').map(percent_encode).collect();
    format!("{ROOT}:/{}:", encoded.join("/"))
}

fn problem(status: u16, body: &Value, doing: &str) -> Error {
    let code = body.pointer("/error/code").and_then(Value::as_str).unwrap_or("");
    if code == "quotaLimitReached" || status == 507 {
        return Error::Rejected("your OneDrive is full".into());
    }
    if status == 401 {
        return signed_out(Service::OneDrive);
    }
    if status == 413 {
        return Error::Rejected("too big for OneDrive".into());
    }
    Error::Cloud(format!("OneDrive wouldn't {doing} (status {status}{})", if code.is_empty() { String::new() } else { format!(": {code}") }))
}

impl OneDrive {
    /// Checks the sign-in still works.
    pub fn open(account: &CloudAccount) -> Result<Self> {
        cloud::access_token(&Http, account)?;
        Ok(Self { agent: agent(), account: account.clone() })
    }

    /// Sends a request with a fresh sign-in, trying again once if the access
    /// token had stopped working and when OneDrive asks TBV to slow down.
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
            if wait_if_busy(&answer, attempt) {
                attempt += 1;
                continue;
            }
            return Ok(answer);
        }
    }

    fn content(&self, path: &str) -> Result<Option<Response<Body>>> {
        // Graph answers with a pre-signed address the download follows to.
        let answer = self.send(Method::GET, &format!("{}/content", item(path)), &[], Vec::new())?;
        match answer.status().as_u16() {
            200..=299 => Ok(Some(answer)),
            404 => Ok(None),
            status => {
                let (_, body) = read_json(answer)?;
                Err(problem(status, &body, "send a file"))
            }
        }
    }

    fn upload_in_pieces(&self, path: &str, file: &Path, size: u64) -> Result<()> {
        let body = json!({ "item": { "@microsoft.graph.conflictBehavior": "replace" } }).to_string().into_bytes();
        let answer = self.send(Method::POST, &format!("{}/createUploadSession", item(path)), &[("Content-Type", "application/json".into())], body)?;
        let (status, session) = read_json(answer)?;
        if !(200..300).contains(&status) {
            return Err(problem(status, &session, "save a file"));
        }
        let url = session.get("uploadUrl").and_then(Value::as_str).ok_or_else(|| Error::Cloud("OneDrive didn't start the upload".into()))?.to_string();
        let mut reader = File::open(file)?;
        let mut piece = vec![0u8; PIECE];
        let mut offset: u64 = 0;
        while offset < size {
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
            // The upload address carries its own permission: no sign-in header.
            let request = Request::put(&url)
                .header("Content-Range", format!("bytes {offset}-{end}/{size}"))
                .body(piece[..filled].to_vec())
                .map_err(|e| Error::Cloud(e.to_string()))?;
            let answer = self.agent.run(request).map_err(transport)?;
            let status = answer.status().as_u16();
            if !(200..300).contains(&status) {
                let (_, body) = read_json(answer)?;
                return Err(problem(status, &body, "save a file"));
            }
            offset = end + 1;
        }
        Ok(())
    }

    fn children(&self, folder: &str) -> Result<Vec<(String, Option<u64>)>> {
        let mut url = format!("{}/children?$select=name,size,folder&$top=999", item(folder));
        let mut names = Vec::new();
        loop {
            let (status, body) = read_json(self.send(Method::GET, &url, &[], Vec::new())?)?;
            if status == 404 {
                return Ok(Vec::new());
            }
            if !(200..300).contains(&status) {
                return Err(problem(status, &body, "list a folder"));
            }
            for entry in body.get("value").and_then(Value::as_array).into_iter().flatten() {
                let Some(name) = entry.get("name").and_then(Value::as_str) else { continue };
                if name.starts_with('.') {
                    continue;
                }
                let size = if entry.get("folder").is_some() { None } else { entry.get("size").and_then(Value::as_u64) };
                names.push((name.to_string(), size));
            }
            match body.get("@odata.nextLink").and_then(Value::as_str) {
                Some(next) => url = next.to_string(),
                None => return Ok(names),
            }
        }
    }
}

impl Store for OneDrive {
    fn read(&mut self, path: &str) -> Result<Option<Vec<u8>>> {
        let Some(mut answer) = self.content(path)? else { return Ok(None) };
        Ok(Some(answer.body_mut().with_config().limit(64 * 1024 * 1024).read_to_vec().map_err(transport)?))
    }

    fn write(&mut self, path: &str, bytes: &[u8]) -> Result<()> {
        let answer = self.send(Method::PUT, &format!("{}/content", item(path)), &[("Content-Type", "application/octet-stream".into())], bytes.to_vec())?;
        let status = answer.status().as_u16();
        if (200..300).contains(&status) {
            return Ok(());
        }
        let (_, body) = read_json(answer)?;
        Err(problem(status, &body, "save a file"))
    }

    fn put_file(&mut self, path: &str, file: &Path) -> Result<()> {
        let size = std::fs::metadata(file)?.len();
        if size > ONE_GO {
            return self.upload_in_pieces(path, file, size);
        }
        self.write(path, &std::fs::read(file)?)
    }

    fn get_file(&mut self, path: &str, to: &Path) -> Result<bool> {
        let Some(mut answer) = self.content(path)? else { return Ok(false) };
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
        let answer = self.send(Method::DELETE, &item(path), &[], Vec::new())?;
        match answer.status().as_u16() {
            200..=299 | 404 => Ok(()),
            status => {
                let (_, body) = read_json(answer)?;
                Err(problem(status, &body, "erase a file"))
            }
        }
    }

    fn read_range(&mut self, path: &str, start: u64, end: u64) -> Result<Option<(Vec<u8>, u64)>> {
        // The pre-signed address takes a range itself, and needs no sign-in.
        let (status, meta) = read_json(self.send(Method::GET, &format!("{}?$select=size,@microsoft.graph.downloadUrl", item(path)), &[], Vec::new())?)?;
        if status == 404 {
            return Ok(None);
        }
        if !(200..300).contains(&status) {
            return Err(problem(status, &meta, "send a file"));
        }
        let url = meta.get("@microsoft.graph.downloadUrl").and_then(Value::as_str).ok_or_else(|| Error::Cloud("OneDrive didn't give the file's address".into()))?;
        let request = Request::get(url).header("Range", format!("bytes={start}-{end}")).body(Vec::<u8>::new()).map_err(|e| Error::Cloud(e.to_string()))?;
        let mut answer = self.agent.run(request).map_err(transport)?;
        match answer.status().as_u16() {
            200..=299 | 416 => super::ranged_answer(&mut answer, start, end).map(Some),
            404 => Ok(None),
            status => Err(Error::Cloud(format!("OneDrive wouldn't send a file (status {status})"))),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn items_are_addressed_by_path_in_the_app_folder() {
        assert_eq!(item(""), ROOT);
        assert_eq!(item("covers/"), format!("{ROOT}:/covers:"));
        assert_eq!(item("changes/dev 1/0001.json"), format!("{ROOT}:/changes/dev%201/0001.json:"));
        assert_eq!(PIECE % (320 * 1024), 0);
    }
}

//! A WebDAV server as a `Store`: Nextcloud, ownCloud, Koofr, pCloud, a NAS
//! and many more speak it. Only plain requests are used (GET, PUT, MKCOL,
//! and PROPFIND to list a folder), which every server supports.

use std::fs::File;
use std::io;
use std::path::Path;
use std::time::Duration;

use quick_xml::events::Event;
use quick_xml::Reader;
use serde::{Deserialize, Serialize};
use ureq::http::{Method, Request, Response};
use ureq::{Agent, AsSendBody, Body};

use super::files::{Store, LIBRARY_FOLDER};
use crate::error::{Error, Result};

/// Where the server is, and who to sign in as. Kept on this device only.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebDavAccount {
    /// The folder to keep the library in, like
    /// `https://cloud.example.com/remote.php/dav/files/wren/`.
    pub url: String,
    pub username: String,
    pub password: String,
}

pub struct WebDav {
    agent: Agent,
    /// The library folder's address, ending in `/`.
    base: String,
    auth: String,
}

fn agent() -> Agent {
    Agent::config_builder()
        .http_status_as_error(false)
        .allow_non_standard_methods(true)
        .timeout_connect(Some(Duration::from_secs(15)))
        .timeout_recv_response(Some(Duration::from_secs(120)))
        .build()
        .into()
}

fn transport(error: ureq::Error) -> Error {
    match error {
        ureq::Error::Io(e) => Error::Offline(e.to_string()),
        ureq::Error::Timeout(_) => Error::Offline("the server took too long to answer".into()),
        ureq::Error::HostNotFound => Error::Offline("the server's address couldn't be found".into()),
        ureq::Error::ConnectionFailed => Error::Offline("the connection to the server failed".into()),
        other => Error::Cloud(other.to_string()),
    }
}

fn base64(bytes: &[u8]) -> String {
    const ABC: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for chunk in bytes.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = (b[0] as u32) << 16 | (b[1] as u32) << 8 | b[2] as u32;
        for i in 0..4 {
            if i <= chunk.len() {
                out.push(ABC[(n >> (18 - 6 * i) & 63) as usize] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}

/// Percent-encodes one path segment.
fn encode(segment: &str) -> String {
    segment
        .bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

fn decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok().and_then(|h| u8::from_str_radix(h, 16).ok());
            if let Some(n) = hex {
                out.push(n);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// The names a PROPFIND answer lists: the last part of each `href`, leaving
/// out the folder that was asked about.
pub(crate) fn listed_names(xml: &str, folder_path: &str) -> Vec<String> {
    let mut reader = Reader::from_str(xml);
    let mut in_href = false;
    let mut names = Vec::new();
    let asked = decode(folder_path).trim_end_matches('/').to_string();
    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) if e.local_name().as_ref().eq_ignore_ascii_case(b"href") => in_href = true,
            Ok(Event::End(e)) if e.local_name().as_ref().eq_ignore_ascii_case(b"href") => in_href = false,
            Ok(Event::Text(t)) if in_href => {
                let href = t.unescape().map(|s| s.into_owned()).unwrap_or_default();
                // Some servers answer with whole addresses, some with paths.
                let path = match href.find("://") {
                    Some(at) => href[at + 3..].find('/').map(|p| href[at + 3 + p..].to_string()).unwrap_or_default(),
                    None => href,
                };
                let path = decode(&path);
                let trimmed = path.trim_end_matches('/');
                if trimmed == asked || trimmed.is_empty() {
                    continue;
                }
                if let Some(name) = trimmed.rsplit('/').next().filter(|n| !n.is_empty()) {
                    names.push(name.to_string());
                }
            }
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
    }
    names
}

impl WebDav {
    /// Connects, checks the sign-in, and makes the library folder if needed.
    pub fn open(account: &WebDavAccount) -> Result<Self> {
        let url = account.url.trim();
        if !(url.starts_with("https://") || url.starts_with("http://")) {
            return Err(Error::Unsuitable("the WebDAV address should start with https://".into()));
        }
        let base = format!("{}/{}/", url.trim_end_matches('/'), encode(LIBRARY_FOLDER));
        let auth = format!("Basic {}", base64(format!("{}:{}", account.username, account.password).as_bytes()));
        let dav = Self { agent: agent(), base, auth };
        // The folder the person gave must be there; TBV's own folder is made inside it.
        let parent = format!("{}/", url.trim_end_matches('/'));
        let status = dav.propfind_status(&parent)?;
        match status {
            200..=299 => {}
            401 | 403 => return Err(Error::Unsuitable("the server didn't accept that username and password".into())),
            404 => return Err(Error::Unsuitable("there's no folder at that WebDAV address".into())),
            405 => return Err(Error::Unsuitable("that address isn't a WebDAV folder".into())),
            other => return Err(Error::Cloud(format!("the server answered with status {other}"))),
        }
        dav.make_folders("")?;
        Ok(dav)
    }

    fn url(&self, path: &str) -> String {
        let encoded: Vec<String> = path.split('/').map(encode).collect();
        format!("{}{}", self.base, encoded.join("/"))
    }

    fn send(&self, method: &str, url: &str, depth: Option<&str>, body: impl AsSendBody) -> Result<Response<Body>> {
        let method = Method::from_bytes(method.as_bytes()).map_err(|e| Error::Cloud(e.to_string()))?;
        let mut request = Request::builder().method(method).uri(url).header("Authorization", &self.auth);
        if let Some(depth) = depth {
            request = request.header("Depth", depth).header("Content-Type", "application/xml");
        }
        let request = request.body(body).map_err(|e| Error::Cloud(e.to_string()))?;
        self.agent.run(request).map_err(transport)
    }

    fn propfind_status(&self, url: &str) -> Result<u16> {
        let body = br#"<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>"#;
        Ok(self.send("PROPFIND", url, Some("0"), body.to_vec())?.status().as_u16())
    }

    /// Makes each folder on the way to `path` (a folder path ending in `/`,
    /// or "" for the library folder itself). Ones already there are fine.
    fn make_folders(&self, path: &str) -> Result<()> {
        let mut at = String::new();
        let parts: Vec<&str> = path.split('/').filter(|p| !p.is_empty()).collect();
        let mut folders = vec![self.base.clone()];
        for part in parts {
            at.push_str(&encode(part));
            at.push('/');
            folders.push(format!("{}{at}", self.base));
        }
        for folder in folders {
            let mut answer = self.send("MKCOL", &folder, None, Vec::new())?;
            match answer.status().as_u16() {
                // Made, or already there.
                200..=299 | 405 => {}
                401 | 403 => return Err(Error::Unsuitable("the server didn't accept that username and password".into())),
                507 => return Err(Error::Rejected("the server is full".into())),
                status => {
                    let _ = answer.body_mut().read_to_string();
                    return Err(Error::Cloud(format!("the server wouldn't make a folder (status {status})")));
                }
            }
        }
        Ok(())
    }

    fn parent_of(path: &str) -> &str {
        path.rfind('/').map(|i| &path[..=i]).unwrap_or("")
    }

    /// Sends a file's bytes. `body` is called again if the folder had to be
    /// made first, so a book file is read from disk as it goes, not held.
    fn put<B: AsSendBody>(&self, path: &str, body: impl Fn() -> Result<B>) -> Result<()> {
        let mut answer = self.send("PUT", &self.url(path), None, body()?)?;
        if answer.status().as_u16() == 409 {
            // The folder isn't there yet.
            self.make_folders(Self::parent_of(path))?;
            answer = self.send("PUT", &self.url(path), None, body()?)?;
        }
        match answer.status().as_u16() {
            200..=299 => Ok(()),
            413 => Err(Error::Rejected("too big for this server".into())),
            507 => Err(Error::Rejected("the server is full".into())),
            401 | 403 => Err(Error::Cloud("the server didn't accept the sign-in. Check it in Settings › Sync".into())),
            status => Err(Error::Cloud(format!("the server wouldn't save a file (status {status})"))),
        }
    }

    fn get(&self, path: &str) -> Result<Option<Response<Body>>> {
        let answer = self.send("GET", &self.url(path), None, Vec::new())?;
        match answer.status().as_u16() {
            200..=299 => Ok(Some(answer)),
            404 | 410 => Ok(None),
            401 | 403 => Err(Error::Cloud("the server didn't accept the sign-in. Check it in Settings › Sync".into())),
            status => Err(Error::Cloud(format!("the server wouldn't send a file (status {status})"))),
        }
    }
}

impl Store for WebDav {
    fn read(&mut self, path: &str) -> Result<Option<Vec<u8>>> {
        let Some(mut answer) = self.get(path)? else { return Ok(None) };
        let bytes = answer.body_mut().with_config().limit(64 * 1024 * 1024).read_to_vec().map_err(transport)?;
        Ok(Some(bytes))
    }

    fn write(&mut self, path: &str, bytes: &[u8]) -> Result<()> {
        self.put(path, || Ok(bytes))
    }

    fn put_file(&mut self, path: &str, file: &Path) -> Result<()> {
        self.put(path, || Ok(File::open(file)?))
    }

    fn get_file(&mut self, path: &str, to: &Path) -> Result<bool> {
        let Some(mut answer) = self.get(path)? else { return Ok(false) };
        let mut out = File::create(to)?;
        io::copy(&mut answer.body_mut().as_reader(), &mut out)?;
        Ok(true)
    }

    fn list(&mut self, folder: &str) -> Result<Vec<String>> {
        let url = self.url(folder);
        let body = br#"<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>"#;
        let mut answer = self.send("PROPFIND", &url, Some("1"), body.to_vec())?;
        match answer.status().as_u16() {
            200..=299 => {
                let xml = answer.body_mut().with_config().limit(32 * 1024 * 1024).read_to_string().map_err(transport)?;
                let asked = url.find("://").and_then(|at| url[at + 3..].find('/').map(|p| url[at + 3 + p..].to_string())).unwrap_or_default();
                Ok(listed_names(&xml, &asked).into_iter().filter(|n| !n.starts_with('.')).collect())
            }
            404 => Ok(Vec::new()),
            status => Err(Error::Cloud(format!("the server wouldn't list a folder (status {status})"))),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sign_ins_and_names_are_written_the_way_servers_expect() {
        assert_eq!(base64(b"wren:lamps"), "d3JlbjpsYW1wcw==");
        assert_eq!(base64(b"ab"), "YWI=");
        assert_eq!(base64(b"abc"), "YWJj");
        assert_eq!(encode("The Bound Vigil"), "The%20Bound%20Vigil");
        assert_eq!(decode("The%20Bound%20Vigil"), "The Bound Vigil");
        assert_eq!(decode("100%"), "100%");
    }

    /// Against a real server: `TBV_WEBDAV=https://host/folder/ user password`.
    #[test]
    #[ignore]
    fn a_real_server_carries_a_library() {
        use super::super::files::FileRemote;
        use super::super::{Record, Remote};
        let spec = std::env::var("TBV_WEBDAV").expect("TBV_WEBDAV");
        let parts: Vec<&str> = spec.split_whitespace().collect();
        let account = WebDavAccount { url: parts[0].into(), username: parts[1].into(), password: parts[2].into() };
        let wrong = WebDavAccount { password: "wrong".into(), ..account.clone() };
        assert!(WebDav::open(&wrong).is_err());
        let mut a = FileRemote::new(WebDav::open(&account).unwrap(), "device-a".into());
        let mut b = FileRemote::new(WebDav::open(&account).unwrap(), "device-b".into());
        a.prepare().unwrap();
        assert!(b.prepare().unwrap());
        let record = Record { kind: "book".into(), key: "[\"sha256:1\"]".into(), data: None, changed_at: "2026-10-17T00:00:00.000Z".into() };
        a.push(std::slice::from_ref(&record)).unwrap();
        let page = b.pull("", 500).unwrap();
        assert_eq!(page.records, [record]);
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("cover one.jpg");
        std::fs::write(&file, b"picture").unwrap();
        a.upload("covers/cover one.jpg", &file).unwrap();
        assert_eq!(b.list("covers/").unwrap(), ["cover one.jpg"]);
        let back = dir.path().join("back");
        assert!(b.download("covers/cover one.jpg", &back).unwrap());
        assert_eq!(std::fs::read(&back).unwrap(), b"picture");
        assert!(!b.download("covers/missing.jpg", &back).unwrap());
    }

    #[test]
    fn folder_listings_are_read_from_any_server() {
        let xml = r#"<?xml version="1.0"?>
            <d:multistatus xmlns:d="DAV:">
              <d:response><d:href>/dav/The%20Bound%20Vigil/covers/</d:href></d:response>
              <d:response><d:href>/dav/The%20Bound%20Vigil/covers/abc.jpg</d:href></d:response>
              <d:response><d:href>https://cloud.example.com/dav/The%20Bound%20Vigil/covers/d%C3%A9f.png</d:href></d:response>
              <d:response><D:href xmlns:D="DAV:">/dav/The%20Bound%20Vigil/covers/sub/</D:href></d:response>
            </d:multistatus>"#;
        assert_eq!(listed_names(xml, "/dav/The%20Bound%20Vigil/covers/"), ["abc.jpg", "déf.png", "sub"]);
    }
}

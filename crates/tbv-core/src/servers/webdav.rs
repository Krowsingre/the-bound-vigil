//! WebDAV: a folder shared over the web, such as a NAS, Nextcloud or
//! ownCloud. Plain WebDAV over http, or WebDAVS over https (checked
//! against the system's certificates like any website).

use std::io::{Read, Write};
use std::time::Duration;

use base64::Engine;
use url::Url;

use super::{Connection, Protocol, RemoteEntry, Server, CONNECT_TIMEOUT, READ_TIMEOUT};
use crate::error::{Error, Result};

pub(crate) struct WebdavConnection {
    server: Server,
    agent: ureq::Agent,
    /// scheme://host:port, no slash at the end.
    origin: String,
}

impl WebdavConnection {
    pub(crate) fn open(server: &Server) -> Result<Self> {
        let scheme = if server.protocol == Protocol::Webdavs { "https" } else { "http" };
        let origin = format!("{scheme}://{}:{}", server.host, server.port);
        Url::parse(&origin).map_err(|_| Error::Unsuitable("That isn't a server address.".into()))?;
        let agent = ureq::Agent::config_builder()
            .timeout_connect(Some(CONNECT_TIMEOUT))
            .timeout_recv_response(Some(READ_TIMEOUT))
            .timeout_recv_body(Some(Duration::from_secs(60 * 60 * 6)))
            .http_status_as_error(false)
            .user_agent(concat!("The Bound Vigil/", env!("CARGO_PKG_VERSION")))
            .build()
            .into();
        let mut connection = Self { server: server.clone(), agent, origin };
        // Signing in is checked with the first look at a folder.
        let start = if server.folder.is_empty() { "/".to_string() } else { super::normalise(&format!("/{}", server.folder.trim_start_matches('/'))) };
        connection.list(&start)?;
        Ok(connection)
    }

    fn address(&self, path: &str, folder: bool) -> String {
        let mut out = self.origin.clone();
        for part in path.split('/').filter(|p| !p.is_empty()) {
            out.push('/');
            out.extend(url::form_urlencoded::byte_serialize(part.as_bytes()).map(|s| s.replace('+', "%20")));
        }
        if folder || out == self.origin {
            out.push('/');
        }
        out
    }

    fn login(&self) -> Option<String> {
        (!self.server.username.is_empty() && !self.server.username.eq_ignore_ascii_case("anonymous")).then(|| {
            format!("Basic {}", base64::engine::general_purpose::STANDARD.encode(format!("{}:{}", self.server.username, self.server.password)))
        })
    }

    fn send(&self, request: ureq::http::request::Builder, body: String) -> Result<ureq::http::Response<ureq::Body>> {
        let request = match self.login() {
            Some(auth) => request.header("Authorization", auth),
            None => request,
        };
        let request = request.body(body).map_err(|e| Error::Unsuitable(e.to_string()))?;
        self.agent.run(request).map_err(|e| self.unreachable(e))
    }

    fn unreachable(&self, e: ureq::Error) -> Error {
        match e {
            ureq::Error::Io(io) => super::network_problem(&io, &self.server),
            ureq::Error::HostNotFound => Error::Unsuitable(format!(
                "TBV couldn't find a server called {}. Check the spelling of the address and your internet connection.",
                self.server.host
            )),
            ureq::Error::Timeout(_) => Error::Unsuitable(format!("{} didn't answer in time. Check the address and port, and your internet connection.", self.server.host)),
            other => Error::Unsuitable(format!("TBV couldn't connect to {} (port {}): {other}.", self.server.host, self.server.port)),
        }
    }

    fn refused(&self, status: u16, path: &str) -> Error {
        Error::Unsuitable(match status {
            401 | 403 => "The server turned the sign-in down. Check the username and password.".into(),
            404 => format!("There's nothing at {path} on the server."),
            405 | 501 => "That address doesn't share files over WebDAV. Nextcloud's, for example, ends in /remote.php/dav/files/your-name.".into(),
            s => format!("The server said something went wrong ({s})."),
        })
    }
}

impl Connection for WebdavConnection {
    fn home(&mut self) -> Result<String> {
        Ok("/".into())
    }

    fn list(&mut self, path: &str) -> Result<Vec<RemoteEntry>> {
        let at = self.address(path, true);
        let body = r#"<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getcontentlength/></d:prop></d:propfind>"#;
        let method = ureq::http::Method::from_bytes(b"PROPFIND").map_err(|e| Error::Unsuitable(e.to_string()))?;
        let request = ureq::http::Request::builder().method(method).uri(&at).header("Depth", "1").header("Content-Type", "application/xml");
        let mut answer = self.send(request, body.into())?;
        let status = answer.status().as_u16();
        if !matches!(status, 207 | 200) {
            return Err(self.refused(status, path));
        }
        let xml = answer.body_mut().with_config().limit(32 * 1024 * 1024).read_to_string().map_err(|e| Error::Unsuitable(e.to_string()))?;
        let at = Url::parse(&at).map_err(|_| Error::Unsuitable("That isn't a server address.".into()))?;
        Ok(parse_propfind(&xml, &at))
    }

    fn fetch(&mut self, path: &str, from: u64, out: &mut dyn Write, progress: &mut dyn FnMut(u64) -> bool) -> Result<u64> {
        let mut request = ureq::http::Request::builder().method("GET").uri(self.address(path, false));
        if from > 0 {
            request = request.header("Range", format!("bytes={from}-"));
        }
        let mut answer = self.send(request, String::new())?;
        let status = answer.status().as_u16();
        match status {
            206 => {}
            200 if from == 0 => {}
            200 => return Err(Error::CantResume),
            s => return Err(self.refused(s, path)),
        }
        let mut reader = answer.body_mut().with_config().limit(u64::MAX).reader();
        let mut buffer = vec![0u8; 256 * 1024];
        let mut total = 0u64;
        loop {
            let n = match reader.read(&mut buffer) {
                Ok(0) => return Ok(total),
                Ok(n) => n,
                Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
                Err(e) => return Err(super::network_problem(&e, &self.server)),
            };
            out.write_all(&buffer[..n])?;
            total += n as u64;
            if !progress(n as u64) {
                return Ok(total);
            }
        }
    }
}

/// What's in a folder, from a PROPFIND answer: everything but the folder itself.
fn parse_propfind(xml: &str, at: &Url) -> Vec<RemoteEntry> {
    use quick_xml::events::Event;
    let mut reader = quick_xml::Reader::from_str(xml);
    let mut out = Vec::new();
    let (mut href, mut folder, mut size, mut field) = (String::new(), false, 0u64, String::new());
    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) => {
                let name = String::from_utf8_lossy(e.local_name().as_ref()).to_string();
                match name.as_str() {
                    "response" => (href, folder, size) = (String::new(), false, 0),
                    "collection" => folder = true,
                    _ => {}
                }
                field = name;
            }
            Ok(Event::Empty(e)) if e.local_name().as_ref() == b"collection" => folder = true,
            Ok(Event::Text(t)) if field == "href" => href.push_str(&t.unescape().unwrap_or_default()),
            Ok(Event::Text(t)) if field == "getcontentlength" => size = t.unescape().unwrap_or_default().trim().parse().unwrap_or(0),
            Ok(Event::End(e)) => {
                if e.local_name().as_ref() == b"response" && !href.is_empty() {
                    if let Ok(full) = at.join(href.trim()) {
                        let same = full.path().trim_end_matches('/') == at.path().trim_end_matches('/');
                        let inside = full.host_str() == at.host_str() && full.path().starts_with(at.path());
                        if !same && inside {
                            let path = decode(full.path().trim_end_matches('/'));
                            let name = path.rsplit('/').next().unwrap_or_default().to_string();
                            if !name.is_empty() {
                                out.push(RemoteEntry { name, path, is_dir: folder, size: if folder { 0 } else { size } });
                            }
                        }
                    }
                }
                field.clear();
            }
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
    }
    out
}

fn decode(text: &str) -> String {
    url::form_urlencoded::parse(format!("x={}", text.replace('+', "%2B")).as_bytes()).next().map(|(_, v)| v.into_owned()).unwrap_or_else(|| text.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn listings_keep_what_is_inside_the_folder() {
        let at = Url::parse("https://dav.example:443/media/Books/").unwrap();
        let xml = r#"<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">
          <d:response><d:href>/media/Books/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>
          <d:response><d:href>/media/Books/Old%20Ones/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>
          <d:response><d:href>https://dav.example/media/Books/Dracula%20(1897).epub</d:href><d:propstat><d:prop><d:resourcetype/><d:getcontentlength>1234</d:getcontentlength></d:prop></d:propstat></d:response>
          <d:response><d:href>/elsewhere/x.epub</d:href><d:propstat><d:prop><d:resourcetype/></d:prop></d:propstat></d:response>
        </d:multistatus>"#;
        let found = parse_propfind(xml, &at);
        assert_eq!(found.len(), 2);
        assert_eq!(found[0], RemoteEntry { name: "Old Ones".into(), path: "/media/Books/Old Ones".into(), is_dir: true, size: 0 });
        assert_eq!(found[1], RemoteEntry { name: "Dracula (1897).epub".into(), path: "/media/Books/Dracula (1897).epub".into(), is_dir: false, size: 1234 });
    }

    #[test]
    fn addresses_are_encoded_part_by_part() {
        let server = Server {
            id: "s".into(),
            name: "n".into(),
            protocol: Protocol::Webdavs,
            host: "dav.example".into(),
            port: 443,
            username: String::new(),
            password: String::new(),
            login: Default::default(),
            key_file: None,
            folder: String::new(),
            host_key: None,
        };
        let c = WebdavConnection { agent: ureq::Agent::new_with_defaults(), origin: "https://dav.example:443".into(), server };
        assert_eq!(c.address("/media/Old Ones", true), "https://dav.example:443/media/Old%20Ones/");
        assert_eq!(c.address("/a/b&c#1.epub", false), "https://dav.example:443/a/b%26c%231.epub");
        assert_eq!(c.address("/", true), "https://dav.example:443/");
    }
}

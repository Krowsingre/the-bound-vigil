//! Signing in through the browser (OAuth with PKCE), shared by Hardcover and
//! the cloud services. TBV opens the service's sign-in page, the person
//! approves, and the browser hands a one-time code back to TBV on this
//! device (a loopback address), which TBV trades for a token. No password
//! ever passes through TBV.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::time::{Duration, Instant};

use crate::error::{Error, Result};

pub(crate) fn base64url(bytes: &[u8]) -> String {
    const ABC: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = String::new();
    for chunk in bytes.chunks(3) {
        let n = chunk.iter().enumerate().fold(0u32, |n, (i, b)| n | (u32::from(*b) << (16 - 8 * i)));
        for i in 0..=chunk.len() {
            out.push(ABC[((n >> (18 - 6 * i)) & 63) as usize] as char);
        }
    }
    out
}

pub(crate) fn random_token() -> String {
    format!("{}{}", uuid::Uuid::new_v4().simple(), uuid::Uuid::new_v4().simple())
}

pub(crate) fn percent_encode(value: &str) -> String {
    value
        .bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

pub(crate) fn percent_decode(value: &str) -> String {
    let bytes = value.replace('+', " ").into_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(b) = u8::from_str_radix(std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or(""), 16) {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

pub(crate) fn parse_query(query: &str) -> HashMap<String, String> {
    query
        .split('&')
        .filter(|pair| !pair.is_empty())
        .filter_map(|pair| pair.split_once('=').or(Some((pair, ""))))
        .map(|(k, v)| (percent_decode(k), percent_decode(v)))
        .collect()
}

/// `key=value&…`, encoded for a sign-in page's address.
pub(crate) fn query(pairs: &[(&str, &str)]) -> String {
    pairs.iter().map(|(k, v)| format!("{k}={}", percent_encode(v))).collect::<Vec<_>>().join("&")
}

/// Waits for the browser to come back to TBV with the sign-in's answer, and
/// tells the browser it can be closed. Gives up after `timeout`.
pub fn wait_for_callback(listener: &TcpListener, timeout: Duration) -> Result<HashMap<String, String>> {
    wait_for_any(std::slice::from_ref(listener), timeout)
}

/// As [`wait_for_callback`], hearing on several listeners at once (the same
/// port on both of this device's loopback addresses, for `localhost`). The
/// answer may come to `/callback` or to `/`.
pub fn wait_for_any(listeners: &[TcpListener], timeout: Duration) -> Result<HashMap<String, String>> {
    for listener in listeners {
        listener.set_nonblocking(true)?;
    }
    let deadline = Instant::now() + timeout;
    loop {
        for listener in listeners {
            match listener.accept() {
                Ok((mut stream, _)) => {
                    stream.set_nonblocking(false)?;
                    stream.set_read_timeout(Some(Duration::from_secs(10)))?;
                    let mut line = String::new();
                    BufReader::new(&stream).read_line(&mut line)?;
                    // "GET /callback?code=…&state=… HTTP/1.1"
                    let target = line.split_whitespace().nth(1).unwrap_or("");
                    let (path, query) = target.split_once('?').unwrap_or((target, ""));
                    if !(path == "/callback" || path == "/") || (path == "/" && query.is_empty()) {
                        let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                        continue;
                    }
                    let page = "<!doctype html><meta charset=utf-8><title>The Bound Vigil</title>\
                        <body style=\"font:16px system-ui;margin:4em auto;max-width:28em;text-align:center\">\
                        <h1 style=\"font:500 24px Georgia,serif\">You can close this tab</h1>\
                        <p>Go back to The Bound Vigil to carry on.</p></body>";
                    let _ = write!(
                        stream,
                        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{page}",
                        page.len()
                    );
                    return Ok(parse_query(query));
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
                Err(e) => return Err(e.into()),
            }
        }
        if Instant::now() > deadline {
            return Err(Error::Unsuitable("The sign-in timed out. Try again when you're ready.".into()));
        }
        std::thread::sleep(Duration::from_millis(150));
    }
}

/// The parts of a sign-in page's answer given as a whole address, like
/// `com.example:/oauth2redirect?code=…` on iPhone.
pub fn answer_from_url(url: &str) -> HashMap<String, String> {
    let query = url.split_once('?').map(|(_, q)| q).unwrap_or("");
    parse_query(query.split('#').next().unwrap_or(""))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn answers_are_read_from_either_path_and_whole_addresses() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let browser = std::thread::spawn(move || {
            let mut s = std::net::TcpStream::connect(("127.0.0.1", port)).unwrap();
            s.write_all(b"GET /?code=M.1&state=s HTTP/1.1\r\nHost: x\r\n\r\n").unwrap();
        });
        let answer = wait_for_any(&[listener], Duration::from_secs(5)).unwrap();
        browser.join().unwrap();
        assert_eq!(answer["code"], "M.1");
        let answer = answer_from_url("com.googleusercontent.apps.1:/oauth2redirect?state=s&code=4%2F0A");
        assert_eq!(answer["code"], "4/0A");
        assert_eq!(query(&[("a", "b c"), ("d", "e/f")]), "a=b%20c&d=e%2Ff");
    }
}

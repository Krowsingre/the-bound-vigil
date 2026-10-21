//! Just enough HTTP/1.1 for TBV's own small servers on the home network:
//! the LocalSend receiver and the phone version served from the computer.

use std::collections::HashMap;
use std::io::{BufRead, Read};

use crate::error::Result;

const MAX_HEADER: usize = 16 * 1024;

/// A request's first line and headers. The body is left to read.
pub struct Request {
    pub method: String,
    pub path: String,
    pub query: HashMap<String, String>,
    /// Names in lower case.
    pub headers: HashMap<String, String>,
}

/// Reads a request's head. None when the connection closed first.
pub fn read_head(reader: &mut impl BufRead) -> Result<Option<Request>> {
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
pub fn unescape(text: &str) -> String {
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
pub fn body_reader<'r>(request: &Request, reader: &'r mut dyn BufRead) -> Box<dyn Read + 'r> {
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


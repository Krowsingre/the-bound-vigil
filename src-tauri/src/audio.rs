//! Plays audiobooks: their files are streamed to the player through the
//! `tbvaudio://` address (`http://tbvaudio.localhost` on Windows), a part at a
//! time and in ranges, so even a large book starts at once and seeks freely.

use std::io::{Read, Seek, SeekFrom};

use tauri::http::{header, Request, Response, StatusCode};
use tauri::{Manager, Runtime, UriSchemeContext, UriSchemeResponder};

use crate::AppLibrary;

/// The most sent per answer; the player asks again for the rest.
const CHUNK: u64 = 2 * 1024 * 1024;

/// Answers `tbvaudio://localhost/<book id>/<part>`, off the UI thread.
pub fn serve<R: Runtime>(ctx: UriSchemeContext<'_, R>, request: Request<Vec<u8>>, responder: UriSchemeResponder) {
    let library = ctx.app_handle().state::<AppLibrary>().0.clone();
    std::thread::spawn(move || {
        let response = answer(&library, &request).unwrap_or_else(|(status, why)| {
            Response::builder().status(status).header(header::CONTENT_TYPE, "text/plain").body(why.into_bytes()).unwrap_or_default()
        });
        responder.respond(response);
    });
}

type Failure = (StatusCode, String);

fn answer(library: &std::sync::Mutex<tbv_core::Library>, request: &Request<Vec<u8>>) -> Result<Response<Vec<u8>>, Failure> {
    let path = request.uri().path().trim_start_matches('/');
    let (book_id, part) = path.rsplit_once('/').ok_or((StatusCode::NOT_FOUND, "no such audio".into()))?;
    let book_id = percent_decode(book_id);
    let part: usize = part.parse().map_err(|_| (StatusCode::NOT_FOUND, "no such part".to_string()))?;
    // The library is needed only to find the file.
    let (file, format) = library
        .lock()
        .map_err(|_| (StatusCode::SERVICE_UNAVAILABLE, "library is unavailable".to_string()))?
        .audio_file(&book_id)
        .map_err(|e| (StatusCode::NOT_FOUND, e.to_string()))?;
    let (mut slice, ext) = tbv_core::audio::open_part(&file, &format, part).map_err(|e| (StatusCode::NOT_FOUND, e.to_string()))?;
    let len = slice.len();
    let mime = tbv_core::audio::mime_of(&ext);

    let range = request.headers().get(header::RANGE).and_then(|v| v.to_str().ok()).and_then(|v| parse_range(v, len));
    let Some((start, end)) = range else {
        if request.headers().contains_key(header::RANGE) {
            return Response::builder()
                .status(StatusCode::RANGE_NOT_SATISFIABLE)
                .header(header::CONTENT_RANGE, format!("bytes */{len}"))
                .body(Vec::new())
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()));
        }
        // No range asked for: say the size and send the start; the player asks for more.
        let end = len.min(CHUNK).saturating_sub(1);
        return send(&mut slice, 0, end, len, mime, StatusCode::PARTIAL_CONTENT);
    };
    let end = end.min(start + CHUNK - 1);
    send(&mut slice, start, end, len, mime, StatusCode::PARTIAL_CONTENT)
}

fn send(
    slice: &mut tbv_core::audio::Slice,
    start: u64,
    end: u64,
    len: u64,
    mime: &str,
    status: StatusCode,
) -> Result<Response<Vec<u8>>, Failure> {
    let io = |e: std::io::Error| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string());
    let mut body = vec![0u8; (end + 1).saturating_sub(start) as usize];
    if len > 0 {
        slice.seek(SeekFrom::Start(start)).map_err(io)?;
        slice.read_exact(&mut body).map_err(io)?;
    }
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, mime)
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CONTENT_LENGTH, body.len())
        .header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{len}"))
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .body(body)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

/// `bytes=a-b`, `bytes=a-` or `bytes=-n`, as (first, last) byte, inclusive.
fn parse_range(value: &str, len: u64) -> Option<(u64, u64)> {
    let spec = value.strip_prefix("bytes=")?.split(',').next()?.trim();
    let (a, b) = spec.split_once('-')?;
    if len == 0 {
        return None;
    }
    let (start, end) = match (a.trim(), b.trim()) {
        ("", n) => {
            let n: u64 = n.parse().ok()?;
            (len.saturating_sub(n), len - 1)
        }
        (a, "") => (a.parse().ok()?, len - 1),
        (a, b) => (a.parse().ok()?, b.parse::<u64>().ok()?.min(len - 1)),
    };
    (start <= end && start < len).then_some((start, end))
}

fn percent_decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Some(n) = std::str::from_utf8(&bytes[i + 1..i + 3]).ok().and_then(|h| u8::from_str_radix(h, 16).ok()) {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ranges_are_read_the_way_players_ask() {
        assert_eq!(parse_range("bytes=0-", 100), Some((0, 99)));
        assert_eq!(parse_range("bytes=10-19", 100), Some((10, 19)));
        assert_eq!(parse_range("bytes=90-200", 100), Some((90, 99)));
        assert_eq!(parse_range("bytes=-10", 100), Some((90, 99)));
        assert_eq!(parse_range("bytes=100-", 100), None);
        assert_eq!(parse_range("items=0-1", 100), None);
    }

    #[test]
    fn book_ids_come_back_from_addresses() {
        assert_eq!(percent_decode("sha256%3Aabc"), "sha256:abc");
        assert_eq!(percent_decode("plain"), "plain");
        assert_eq!(percent_decode("bad%zz"), "bad%zz");
    }
}

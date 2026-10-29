//! Plays audiobooks: their files are streamed to the player through the
//! `tbvaudio://` address (`http://tbvaudio.localhost` on Windows), a part at a
//! time and in ranges, so even a large book starts at once and seeks freely.
//! An audiobook that isn't on this computer is streamed from the cloud the
//! same way, a range at a time, without downloading it.

use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom};
use std::sync::{Arc, LazyLock, Mutex};

use tauri::http::{header, Request, Response, StatusCode};
use tauri::{Manager, Runtime, UriSchemeContext, UriSchemeResponder};

use crate::AppLibrary;

/// The most sent per answer; the player asks again for the rest.
const CHUNK: u64 = 2 * 1024 * 1024;

/// Audiobooks being streamed, by book id, each with its cloud connection.
static STREAMS: LazyLock<Mutex<HashMap<String, Arc<Mutex<tbv_core::audio::Stream>>>>> = LazyLock::new(Default::default);

/// Gets an audiobook that isn't on this computer ready to stream from the
/// first sync place that has it.
pub fn prepare(library: &Arc<Mutex<tbv_core::Library>>, book_id: &str) -> tbv_core::Result<()> {
    stream(library, book_id).map(|_| ())
}

fn stream(library: &Arc<Mutex<tbv_core::Library>>, book_id: &str) -> tbv_core::Result<Arc<Mutex<tbv_core::audio::Stream>>> {
    if let Some(found) = STREAMS.lock().ok().and_then(|s| s.get(book_id).cloned()) {
        return Ok(found);
    }
    let unavailable = || tbv_core::Error::Unsuitable("the library is unavailable".into());
    let (path, format) = {
        let l = library.lock().map_err(|_| unavailable())?;
        let format = l.book(book_id)?.map(|b| b.format).ok_or_else(|| tbv_core::Error::Unsuitable("That audiobook isn't in your library.".into()))?;
        let path = l.cloud_book_path(book_id)?.ok_or_else(|| tbv_core::Error::Unsuitable("That audiobook isn't in your library.".into()))?;
        (path, format)
    };
    let mut trouble = None;
    for cloud in crate::sync::stream_places(library) {
        match tbv_core::audio::Stream::open(cloud, &path, &format) {
            Ok(Some(found)) => {
                let found = Arc::new(Mutex::new(found));
                if let Ok(mut streams) = STREAMS.lock() {
                    streams.insert(book_id.to_string(), found.clone());
                }
                return Ok(found);
            }
            Ok(None) => {}
            Err(e) => trouble = trouble.or(Some(e)),
        }
    }
    Err(trouble.unwrap_or_else(|| {
        tbv_core::Error::Unsuitable("This audiobook isn't in the cloud, so it can only play on the device that has it.".into())
    }))
}

/// Stops streaming a book (it was downloaded, say, or sync changed).
pub fn forget(book_id: Option<&str>) {
    if let Ok(mut streams) = STREAMS.lock() {
        match book_id {
            Some(id) => {
                streams.remove(id);
            }
            None => streams.clear(),
        }
    }
}

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

pub(crate) type Failure = (StatusCode, String);

pub(crate) fn answer(library: &Arc<Mutex<tbv_core::Library>>, request: &Request<Vec<u8>>) -> Result<Response<Vec<u8>>, Failure> {
    let path = request.uri().path().trim_start_matches('/');
    let (book_id, part) = path.rsplit_once('/').ok_or((StatusCode::NOT_FOUND, "no such audio".into()))?;
    let book_id = percent_decode(book_id);
    let part: usize = part.parse().map_err(|_| (StatusCode::NOT_FOUND, "no such part".to_string()))?;
    // Straight from an Audiobookshelf server.
    if book_id.starts_with(tbv_core::audiobookshelf::STREAM_PREFIX) {
        let playing = crate::abs_stream::find(library, &book_id).map_err(|e| (StatusCode::NOT_FOUND, e.to_string()))?;
        let mut source = Source::Server(playing, part);
        return respond(&mut source, request);
    }
    // The library is needed only to find the file.
    let here = library
        .lock()
        .map_err(|_| (StatusCode::SERVICE_UNAVAILABLE, "library is unavailable".to_string()))?
        .audio_file(&book_id);
    let mut source = match here {
        Ok((file, format)) => {
            forget(Some(&book_id));
            let (slice, ext) = tbv_core::audio::open_part(&file, &format, part).map_err(|e| (StatusCode::NOT_FOUND, e.to_string()))?;
            Source::Here(slice, ext)
        }
        // Not on this computer: from the cloud.
        Err(_) => Source::Cloud(stream(library, &book_id).map_err(|e| (StatusCode::NOT_FOUND, e.to_string()))?, part),
    };
    respond(&mut source, request)
}

/// Answers a request for part of a sound file, in ranges.
fn respond(source: &mut Source, request: &Request<Vec<u8>>) -> Result<Response<Vec<u8>>, Failure> {
    let (len, ext) = source.info().ok_or((StatusCode::NOT_FOUND, "no such part".to_string()))?;
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
        return send(source, 0, end, len, mime, StatusCode::PARTIAL_CONTENT);
    };
    let end = end.min(start + CHUNK - 1);
    send(source, start, end, len, mime, StatusCode::PARTIAL_CONTENT)
}

/// Where a part's bytes come from.
enum Source {
    Here(tbv_core::audio::Slice, String),
    Cloud(Arc<Mutex<tbv_core::audio::Stream>>, usize),
    Server(Arc<Mutex<crate::abs_stream::Playing>>, usize),
}

impl Source {
    /// The part's length and extension.
    fn info(&self) -> Option<(u64, String)> {
        match self {
            Source::Here(slice, ext) => Some((slice.len(), ext.clone())),
            Source::Cloud(stream, part) => stream.lock().ok()?.part(*part).map(|(len, ext)| (len, ext.to_string())),
            Source::Server(playing, part) => playing.lock().ok()?.book.parts.get(*part).map(|p| (p.size, p.ext.clone())),
        }
    }

    fn bytes(&mut self, start: u64, end: u64) -> std::io::Result<Vec<u8>> {
        match self {
            Source::Here(slice, _) => {
                let mut body = vec![0u8; (end + 1).saturating_sub(start) as usize];
                slice.seek(SeekFrom::Start(start))?;
                slice.read_exact(&mut body)?;
                Ok(body)
            }
            Source::Cloud(stream, part) => {
                let mut stream = stream.lock().map_err(|_| std::io::Error::other("the stream is unavailable"))?;
                let bytes = stream.read(*part, start, end).map_err(|e| std::io::Error::other(e.to_string()))?;
                if bytes.len() as u64 != end + 1 - start {
                    return Err(std::io::Error::other("the cloud sent less than asked for"));
                }
                Ok(bytes)
            }
            Source::Server(playing, part) => {
                let mut playing = playing.lock().map_err(|_| std::io::Error::other("the server is unavailable"))?;
                let (item, ino) = {
                    let p = playing.book.parts.get(*part).ok_or_else(|| std::io::Error::other("no such part"))?;
                    (playing.book.item.clone(), p.ino.clone())
                };
                let bytes = playing.server.read_range(&item, &ino, start, end).map_err(|e| std::io::Error::other(e.to_string()))?;
                if bytes.len() as u64 != end + 1 - start {
                    return Err(std::io::Error::other("the server sent less than asked for"));
                }
                Ok(bytes)
            }
        }
    }
}

fn send(source: &mut Source, start: u64, end: u64, len: u64, mime: &str, status: StatusCode) -> Result<Response<Vec<u8>>, Failure> {
    let io = |e: std::io::Error| (StatusCode::BAD_GATEWAY, e.to_string());
    let body = if len > 0 { source.bytes(start, end).map_err(io)? } else { Vec::new() };
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

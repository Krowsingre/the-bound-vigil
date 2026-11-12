//! Discover's video reader view: plays a video from a web page in TBV's own
//! player, away from the page's adverts and redirects. The player reaches the
//! video through the `tbvvideo://` address (`http://tbvvideo.localhost` on
//! Windows and Android), which fetches it from the site as the page would
//! (saying which page it's on), a part at a time, as a normal player does:
//! nothing is saved to the computer. A stream's playlist (HLS, `.m3u8`) has
//! its addresses pointed back through here too.
//!
//! Only TBV's own screen knows the key each address carries, so a web page in
//! Discover can't use this to fetch things.

use std::io::Read;
use std::sync::LazyLock;
use std::time::Duration;

use tauri::http::{header, Request, Response, StatusCode};
use tauri::{Runtime, UriSchemeContext, UriSchemeResponder, Url};

/// The most sent per answer to the player; it asks again for the rest.
const CHUNK: u64 = 4 * 1024 * 1024;
/// The most sent for something asked for whole (a stream's short pieces).
const WHOLE: u64 = 64 * 1024 * 1024;
/// The longest playlist read.
const PLAYLIST: u64 = 8 * 1024 * 1024;
/// Sites often turn away anything that doesn't look like a browser.
const BROWSER: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

static KEY: LazyLock<String> = LazyLock::new(|| uuid::Uuid::new_v4().simple().to_string());

fn base() -> &'static str {
    if cfg!(any(windows, target_os = "android")) {
        "http://tbvvideo.localhost"
    } else {
        "tbvvideo://localhost"
    }
}

/// The address TBV's player uses for a video on a page.
pub fn address(url: &str, page: &str) -> String {
    format!("{}/v?k={}&r={}&u={}", base(), *KEY, encode(page), encode(url))
}

/// Answers the player, off the UI thread.
pub fn serve<R: Runtime>(_ctx: UriSchemeContext<'_, R>, request: Request<Vec<u8>>, responder: UriSchemeResponder) {
    std::thread::spawn(move || {
        let response = answer(&request).unwrap_or_else(|(status, why)| {
            Response::builder()
                .status(status)
                .header(header::CONTENT_TYPE, "text/plain")
                .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                .body(why.into_bytes())
                .unwrap_or_default()
        });
        responder.respond(response);
    });
}

type Failure = (StatusCode, String);

fn answer(request: &Request<Vec<u8>>) -> Result<Response<Vec<u8>>, Failure> {
    let refused = || (StatusCode::FORBIDDEN, "not for this page".to_string());
    let asked = Url::parse(&format!("http://x{}", request.uri().path_and_query().map(|p| p.as_str()).unwrap_or("/"))).map_err(|_| refused())?;
    let mut key = None;
    let mut target = None;
    let mut page = String::new();
    for (name, value) in asked.query_pairs() {
        match &*name {
            "k" => key = Some(value.into_owned()),
            "u" => target = Some(value.into_owned()),
            "r" => page = value.into_owned(),
            _ => {}
        }
    }
    if key.as_deref() != Some(KEY.as_str()) {
        return Err(refused());
    }
    let target = target.and_then(|t| Url::parse(&t).ok()).filter(|u| matches!(u.scheme(), "http" | "https")).ok_or_else(refused)?;
    if !page.starts_with("http://") && !page.starts_with("https://") {
        page.clear();
    }

    // A range is passed on, a part at a time; a whole thing is asked for whole.
    let wanted = request.headers().get(header::RANGE).and_then(|v| v.to_str().ok()).and_then(capped);
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_connect(Some(Duration::from_secs(15)))
        .timeout_recv_response(Some(Duration::from_secs(30)))
        .http_status_as_error(false)
        .user_agent(BROWSER)
        .build()
        .into();
    let mut ask = agent.get(target.as_str()).header("Accept", "*/*");
    if !page.is_empty() {
        ask = ask.header("Referer", &page);
        if let Ok(from) = Url::parse(&page) {
            ask = ask.header("Origin", &from.origin().ascii_serialization());
        }
    }
    if let Some((start, end)) = wanted {
        ask = ask.header("Range", &format!("bytes={start}-{end}"));
    }
    let reply = ask.call().map_err(|e| (StatusCode::BAD_GATEWAY, format!("The site couldn't be reached ({e}).")))?;
    let status = reply.status().as_u16();
    if !(200..300).contains(&status) {
        return Err((StatusCode::BAD_GATEWAY, format!("The site said no ({status}).")));
    }
    let header_of = |name: &str| reply.headers().get(name).and_then(|v| v.to_str().ok()).map(str::to_owned);
    let kind = header_of("content-type").unwrap_or_default();
    let length: Option<u64> = header_of("content-length").and_then(|v| v.parse().ok());
    let range = header_of("content-range");
    let mut body = reply.into_body();
    let mut reader = body.with_config().limit(u64::MAX).reader();

    // A stream's playlist: its addresses come back through here.
    let playlist = kind.to_ascii_lowercase().contains("mpegurl") || target.path().to_ascii_lowercase().ends_with(".m3u8");
    if playlist && wanted.is_none() {
        let mut text = Vec::new();
        (&mut reader).take(PLAYLIST).read_to_end(&mut text).map_err(io)?;
        let text = String::from_utf8_lossy(&text);
        if text.trim_start().starts_with("#EXTM3U") {
            return reply_with(StatusCode::OK, "application/vnd.apple.mpegurl", None, rewrite(&text, &target, &page).into_bytes());
        }
        return reply_with(StatusCode::OK, &kind, None, text.into_owned().into_bytes());
    }

    let kind = if kind.is_empty() { "application/octet-stream".to_string() } else { kind };
    match (wanted, status) {
        // The site sent the part asked for.
        (Some(_), 206) => {
            let mut bytes = Vec::new();
            (&mut reader).take(CHUNK + 1024).read_to_end(&mut bytes).map_err(io)?;
            let range = range.unwrap_or_else(|| format!("bytes 0-{}/*", bytes.len().saturating_sub(1)));
            reply_with(StatusCode::PARTIAL_CONTENT, &kind, Some(range), bytes)
        }
        // The site sent it all although a part was asked for: skip to the part.
        (Some((start, end)), _) => {
            std::io::copy(&mut (&mut reader).take(start), &mut std::io::sink()).map_err(io)?;
            let mut bytes = Vec::new();
            (&mut reader).take(end + 1 - start).read_to_end(&mut bytes).map_err(io)?;
            if bytes.is_empty() {
                return Err((StatusCode::RANGE_NOT_SATISFIABLE, "past the end".into()));
            }
            let total = length.map(|l| l.to_string()).unwrap_or_else(|| "*".into());
            let last = start + bytes.len() as u64 - 1;
            reply_with(StatusCode::PARTIAL_CONTENT, &kind, Some(format!("bytes {start}-{last}/{total}")), bytes)
        }
        // Asked for whole (a stream's piece): sent whole, unless it's huge,
        // when the start is sent and the player asks for the rest.
        (None, _) => {
            let mut bytes = Vec::new();
            (&mut reader).take(WHOLE + 1).read_to_end(&mut bytes).map_err(io)?;
            if bytes.len() as u64 > WHOLE {
                bytes.truncate(CHUNK as usize);
                let total = length.map(|l| l.to_string()).unwrap_or_else(|| "*".into());
                return reply_with(StatusCode::PARTIAL_CONTENT, &kind, Some(format!("bytes 0-{}/{total}", CHUNK - 1)), bytes);
            }
            reply_with(StatusCode::OK, &kind, None, bytes)
        }
    }
}

fn io(e: std::io::Error) -> Failure {
    (StatusCode::BAD_GATEWAY, e.to_string())
}

fn reply_with(status: StatusCode, kind: &str, range: Option<String>, body: Vec<u8>) -> Result<Response<Vec<u8>>, Failure> {
    let mut response = Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, kind)
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CONTENT_LENGTH, body.len())
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::CACHE_CONTROL, "no-store");
    if let Some(range) = range {
        response = response.header(header::CONTENT_RANGE, range);
    }
    response.body(body).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

/// The player's range, kept to one part: `bytes=a-b` or `bytes=a-`.
fn capped(value: &str) -> Option<(u64, u64)> {
    let spec = value.strip_prefix("bytes=")?.split(',').next()?.trim();
    let (a, b) = spec.split_once('-')?;
    let start: u64 = a.trim().parse().ok()?;
    let most = start + CHUNK - 1;
    let end = match b.trim() {
        "" => most,
        b => b.parse::<u64>().ok()?.min(most),
    };
    (start <= end).then_some((start, end))
}

/// A playlist with each address (lines, and URI="..." in its notes) pointed
/// back through TBV.
fn rewrite(text: &str, from: &Url, page: &str) -> String {
    let through = |link: &str| from.join(link.trim()).map(|u| address(u.as_str(), page)).unwrap_or_else(|_| link.to_string());
    let mut out = String::with_capacity(text.len() * 2);
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
        } else if trimmed.starts_with('#') {
            let mut rest = trimmed;
            while let Some(at) = rest.find("URI=\"") {
                let (before, after) = rest.split_at(at + 5);
                out.push_str(before);
                let Some(close) = after.find('"') else {
                    rest = after;
                    break;
                };
                out.push_str(&through(&after[..close]));
                rest = &after[close..];
            }
            out.push_str(rest);
        } else {
            out.push_str(&through(trimmed));
        }
        out.push('\n');
    }
    out
}

fn encode(text: &str) -> String {
    let mut out = String::with_capacity(text.len() * 3);
    for b in text.bytes() {
        if b.is_ascii_alphanumeric() || b"-_.~".contains(&b) {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ranges_are_kept_to_one_part() {
        assert_eq!(capped("bytes=0-"), Some((0, CHUNK - 1)));
        assert_eq!(capped("bytes=10-19"), Some((10, 19)));
        assert_eq!(capped("bytes=5-999999999"), Some((5, 5 + CHUNK - 1)));
        assert_eq!(capped("bytes=-10"), None);
    }

    #[test]
    fn playlists_point_back_through_tbv() {
        let from = Url::parse("https://cdn.example/a/master.m3u8?t=1").unwrap();
        let text = "#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"key.bin\"\n#EXTINF:4,\nseg1.ts\n\nhttps://other.example/seg2.ts\n";
        let out = rewrite(text, &from, "https://site.example/watch");
        let lines: Vec<&str> = out.lines().collect();
        assert_eq!(lines[0], "#EXTM3U");
        assert!(lines[1].starts_with("#EXT-X-KEY:METHOD=AES-128,URI=\"") && lines[1].contains(&encode("https://cdn.example/a/key.bin")) && lines[1].ends_with('"'));
        assert_eq!(lines[2], "#EXTINF:4,");
        assert_eq!(lines[3], address("https://cdn.example/a/seg1.ts", "https://site.example/watch"));
        assert_eq!(lines[5], address("https://other.example/seg2.ts", "https://site.example/watch"));
    }

    #[test]
    fn addresses_carry_the_key_and_come_back_whole() {
        let made = address("https://cdn.example/v.mp4?a=1&b=2", "https://site.example/");
        let url = Url::parse(&made.replace("tbvvideo://localhost", "http://x").replace("http://tbvvideo.localhost", "http://x")).unwrap();
        let pairs: std::collections::HashMap<_, _> = url.query_pairs().into_owned().collect();
        assert_eq!(pairs["u"], "https://cdn.example/v.mp4?a=1&b=2");
        assert_eq!(pairs["r"], "https://site.example/");
        assert_eq!(pairs["k"], *KEY);
    }
}

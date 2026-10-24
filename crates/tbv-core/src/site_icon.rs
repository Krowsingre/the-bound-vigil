//! A website's own small icon (its favicon), for Discover's start page.
//! Looked for in the page's <link rel="icon"> tags, then at /favicon.ico.

use std::io::Read;

use url::Url;

use crate::error::{Error, Result};
use crate::opds::{agent, base64};

/// Icons are small: anything bigger isn't one.
const MOST: u64 = 512 * 1024;
/// Enough of a page to read its <head>.
const HEAD: u64 = 256 * 1024;

fn fetch(url: &str, most: u64) -> Result<(Vec<u8>, String)> {
    let response = agent().get(url).call().map_err(|e| Error::Unsuitable(format!("The site couldn't be reached ({e}).")))?;
    if !response.status().is_success() {
        return Err(Error::Unsuitable(format!("The site answered {}.", response.status().as_u16())));
    }
    let kind = response.headers().get("content-type").and_then(|v| v.to_str().ok()).unwrap_or("").to_ascii_lowercase();
    let mut bytes = Vec::new();
    response.into_body().into_reader().take(most).read_to_end(&mut bytes)?;
    Ok((bytes, kind))
}

/// What kind of picture the bytes are, if they're one.
fn picture_kind(bytes: &[u8], said: &str) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG") {
        Some("image/png")
    } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("image/jpeg")
    } else if bytes.starts_with(b"GIF8") {
        Some("image/gif")
    } else if bytes.len() > 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("image/webp")
    } else if bytes.starts_with(&[0, 0, 1, 0]) {
        Some("image/x-icon")
    } else if said.contains("svg") || String::from_utf8_lossy(&bytes[..bytes.len().min(512)]).contains("<svg") {
        Some("image/svg+xml")
    } else {
        None
    }
}

/// The value of one attribute in a tag's text.
fn attribute(tag: &str, name: &str) -> Option<String> {
    let lower = tag.to_ascii_lowercase();
    let mut from = 0;
    while let Some(at) = lower[from..].find(name) {
        let start = from + at;
        from = start + name.len();
        // A whole attribute name, followed by =.
        if start > 0 && !lower.as_bytes()[start - 1].is_ascii_whitespace() {
            continue;
        }
        let rest = tag[from..].trim_start();
        let Some(rest) = rest.strip_prefix('=') else { continue };
        let rest = rest.trim_start();
        let value = match rest.chars().next() {
            Some(q @ ('"' | '\'')) => rest[1..].split(q).next().unwrap_or(""),
            _ => rest.split(|c: char| c.is_whitespace() || c == '>').next().unwrap_or(""),
        };
        return Some(value.trim().to_string());
    }
    None
}

/// The icons a page names, best first: big Apple ones, then sized ones, then any.
fn icons_in(html: &str, base: &Url) -> Vec<Url> {
    let mut found: Vec<(u32, Url)> = Vec::new();
    let lower = html.to_ascii_lowercase();
    let head_ends = lower.find("</head").unwrap_or(lower.len());
    let mut from = 0;
    while let Some(at) = lower[from..].find("<link") {
        let start = from + at;
        // Past the page's head: what's in the body isn't the site's icon.
        if start > head_ends {
            break;
        }
        let end = lower[start..].find('>').map(|e| start + e).unwrap_or(lower.len());
        let tag = &html[start..end];
        from = end;
        let rel = attribute(tag, "rel").unwrap_or_default().to_ascii_lowercase();
        if !rel.split_whitespace().any(|r| r == "icon" || r == "apple-touch-icon") {
            continue;
        }
        let Some(href) = attribute(tag, "href").filter(|h| !h.is_empty()) else { continue };
        let Ok(url) = base.join(&href) else { continue };
        if !matches!(url.scheme(), "http" | "https") {
            continue;
        }
        let size = attribute(tag, "sizes").and_then(|s| s.split(['x', 'X']).next().and_then(|n| n.parse::<u32>().ok())).unwrap_or(0);
        let score = if rel.contains("apple-touch-icon") { 1000 } else { size.min(512) };
        found.push((score, url));
    }
    found.sort_by_key(|a| std::cmp::Reverse(a.0));
    found.into_iter().map(|(_, u)| u).collect()
}

/// A site's icon, as a data address a page can show.
pub fn site_icon(page: &str) -> Result<String> {
    let base = Url::parse(page).map_err(|_| Error::Unsuitable("That isn't a web address.".into()))?;
    if !matches!(base.scheme(), "http" | "https") {
        return Err(Error::Unsuitable("That isn't a web address.".into()));
    }
    let mut tries = Vec::new();
    if let Ok((html, _)) = fetch(base.as_str(), HEAD) {
        tries.extend(icons_in(&String::from_utf8_lossy(&html), &base));
    }
    if let Ok(root) = base.join("/favicon.ico") {
        tries.push(root);
    }
    for url in tries.into_iter().take(4) {
        let Ok((bytes, said)) = fetch(url.as_str(), MOST + 1) else { continue };
        if bytes.is_empty() || bytes.len() as u64 > MOST {
            continue;
        }
        if let Some(kind) = picture_kind(&bytes, &said) {
            return Ok(format!("data:{kind};base64,{}", base64(&bytes)));
        }
    }
    Err(Error::Unsuitable("The site has no icon TBV can show.".into()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn icons_are_found_in_a_page_head() {
        let base = Url::parse("https://www.example.org/books/").unwrap();
        let html = r#"<html><head>
            <link rel="stylesheet" href="/a.css">
            <link rel="icon" type="image/png" sizes="32x32" href="/icon-32.png">
            <link href='//cdn.example.org/touch.png' rel='apple-touch-icon'>
            <link rel="shortcut icon" href="favicon.ico">
            </head><body><link rel="icon" href="/late.png"></body></html>"#;
        let found: Vec<String> = icons_in(html, &base).into_iter().map(|u| u.to_string()).collect();
        assert_eq!(
            found,
            ["https://cdn.example.org/touch.png", "https://www.example.org/icon-32.png", "https://www.example.org/books/favicon.ico"]
        );
        assert_eq!(picture_kind(&[0, 0, 1, 0, 1], ""), Some("image/x-icon"));
        assert_eq!(picture_kind(b"<?xml?><svg xmlns=", ""), Some("image/svg+xml"));
        assert_eq!(picture_kind(b"<html>", "text/html"), None);
    }
}

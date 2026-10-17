//! Reads the details (title, authors, cover and so on) from each kind of
//! book file TBV imports. Like the EPUB reader, nothing here changes a file.

mod comic;
pub mod doc;
mod docx;
mod fb2;
mod mobi;
mod pdf;

use std::path::Path;

use crate::epub::{read_epub_metadata, BookMetadata, Cover};
use crate::error::Result;

/// The book's own details, as far as its format records them. EPUBs that
/// can't be read are refused; for other formats a file whose details can't
/// be read still imports, named after the file, because the reader may open
/// what a quick look at the details could not.
pub fn read_metadata(path: &Path, format: &str) -> Result<BookMetadata> {
    let read = match format {
        "epub" => return read_epub_metadata(path),
        "fb2" => fb2::read(path, false),
        "fbz" => fb2::read(path, true),
        "cbz" => comic::read(path),
        "mobi" | "azw" | "azw3" => mobi::read(path),
        "docx" => docx::read(path),
        "doc" => doc::read_metadata(path),
        "pdf" => pdf::read(path),
        f if crate::audio::is_audio(f) => crate::audio::read(path, f).map(|(metadata, _)| metadata),
        _ => Ok(BookMetadata::default()),
    };
    Ok(read.unwrap_or_default())
}

#[cfg(test)]
pub(crate) use mobi::tests::sample_mobi as mobi_sample;

/// A cover from raw image bytes, named by what the bytes are rather than
/// what a file claims to be.
pub(crate) fn cover_from_bytes(bytes: Vec<u8>) -> Option<Cover> {
    let extension = match bytes.as_slice() {
        [0xFF, 0xD8, 0xFF, ..] => "jpg",
        [0x89, b'P', b'N', b'G', ..] => "png",
        [b'G', b'I', b'F', b'8', ..] => "gif",
        [b'R', b'I', b'F', b'F', _, _, _, _, b'W', b'E', b'B', b'P', ..] => "webp",
        _ => return None,
    };
    Some(Cover {
        bytes,
        extension: extension.into(),
    })
}

/// Orders names the way people number pages: "page 2" before "page 10".
pub(crate) fn natural_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    let (mut a, mut b) = (a.chars().peekable(), b.chars().peekable());
    loop {
        match (a.peek().copied(), b.peek().copied()) {
            (None, None) => return std::cmp::Ordering::Equal,
            (None, Some(_)) => return std::cmp::Ordering::Less,
            (Some(_), None) => return std::cmp::Ordering::Greater,
            (Some(x), Some(y)) if x.is_ascii_digit() && y.is_ascii_digit() => {
                let take = |it: &mut std::iter::Peekable<std::str::Chars>| {
                    let mut n = String::new();
                    while let Some(c) = it.peek().copied().filter(char::is_ascii_digit) {
                        n.push(c);
                        it.next();
                    }
                    n
                };
                let (na, nb) = (take(&mut a), take(&mut b));
                let (ta, tb) = (na.trim_start_matches('0'), nb.trim_start_matches('0'));
                let order = ta.len().cmp(&tb.len()).then_with(|| ta.cmp(tb));
                if order != std::cmp::Ordering::Equal {
                    return order;
                }
            }
            (Some(x), Some(y)) => {
                let order = x.to_lowercase().cmp(y.to_lowercase());
                if order != std::cmp::Ordering::Equal {
                    return order;
                }
                a.next();
                b.next();
            }
        }
    }
}

/// Decodes base64 (as FB2 stores its pictures), skipping line breaks.
pub(crate) fn decode_base64(text: &str) -> Option<Vec<u8>> {
    let value = |c: u8| match c {
        b'A'..=b'Z' => Some(c - b'A'),
        b'a'..=b'z' => Some(c - b'a' + 26),
        b'0'..=b'9' => Some(c - b'0' + 52),
        b'+' | b'-' => Some(62),
        b'/' | b'_' => Some(63),
        _ => None,
    };
    let mut out = Vec::with_capacity(text.len() * 3 / 4);
    let (mut buffer, mut bits) = (0u32, 0);
    for c in text.bytes() {
        if c == b'=' {
            break;
        }
        if c.is_ascii_whitespace() {
            continue;
        }
        buffer = (buffer << 6) | u32::from(value(c)?);
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((buffer >> bits) as u8);
        }
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pages_sort_by_number() {
        let mut names = vec!["p10.jpg", "p2.jpg", "P1.jpg", "cover.jpg"];
        names.sort_by(|a, b| natural_cmp(a, b));
        assert_eq!(names, ["cover.jpg", "P1.jpg", "p2.jpg", "p10.jpg"]);
    }

    #[test]
    fn base64_and_image_kinds() {
        assert_eq!(decode_base64("aGVs\nbG8=").unwrap(), b"hello");
        assert_eq!(cover_from_bytes(vec![0x89, b'P', b'N', b'G', 0]).unwrap().extension, "png");
        assert!(cover_from_bytes(b"not a picture".to_vec()).is_none());
    }
}

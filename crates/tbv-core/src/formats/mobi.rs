//! Kindle books without DRM: MOBI, AZW and AZW3 (KF8). They share one
//! container, a Palm database whose first record holds a MOBI header and,
//! usually, an EXTH block with the book's details.

use std::fs;
use std::path::Path;

use super::cover_from_bytes;
use crate::epub::{clean_isbn, collapse_whitespace, strip_html, BookMetadata};
use crate::error::{Error, Result};

pub(super) fn read(path: &Path) -> Result<BookMetadata> {
    parse(&fs::read(path)?)
}

fn u16_at(b: &[u8], at: usize) -> Option<usize> {
    Some(u16::from_be_bytes(b.get(at..at + 2)?.try_into().ok()?) as usize)
}

fn u32_at(b: &[u8], at: usize) -> Option<usize> {
    Some(u32::from_be_bytes(b.get(at..at + 4)?.try_into().ok()?) as usize)
}

fn bad(why: &str) -> Error {
    Error::BadBook(why.into())
}

fn parse(file: &[u8]) -> Result<BookMetadata> {
    if file.get(60..68) != Some(b"BOOKMOBI") {
        return Err(bad("not a Kindle book"));
    }
    let count = u16_at(file, 76).ok_or_else(|| bad("short file"))?;
    let offsets: Vec<usize> = (0..count).filter_map(|i| u32_at(file, 78 + i * 8)).collect();
    let record = |i: usize| -> Option<&[u8]> {
        let start = *offsets.get(i)?;
        let end = offsets.get(i + 1).copied().unwrap_or(file.len());
        file.get(start..end)
    };
    let header = record(0).ok_or_else(|| bad("no header"))?;
    if header.get(16..20) != Some(b"MOBI") {
        return Err(bad("no MOBI header"));
    }
    let header_len = u32_at(header, 20).ok_or_else(|| bad("short header"))?;
    let utf8 = u32_at(header, 28) == Some(65001);
    let text = |bytes: &[u8]| -> String {
        if utf8 {
            String::from_utf8_lossy(bytes).into_owned()
        } else {
            encoding_rs::WINDOWS_1252.decode(bytes).0.into_owned()
        }
    };

    let mut metadata = BookMetadata::default();
    let full_name = u32_at(header, 84).zip(u32_at(header, 88)).and_then(|(at, len)| header.get(at..at + len));
    let first_image = u32_at(header, 108);
    let mut cover_offset = None;
    let mut updated_title = None;

    let has_exth = u32_at(header, 128).is_some_and(|flags| flags & 0x40 != 0);
    let exth = 16 + header_len;
    if has_exth && header.get(exth..exth + 4) == Some(b"EXTH") {
        let records = u32_at(header, exth + 8).unwrap_or(0);
        let mut at = exth + 12;
        for _ in 0..records {
            let (Some(kind), Some(len)) = (u32_at(header, at), u32_at(header, at + 4)) else { break };
            let Some(data) = header.get(at + 8..at + len.max(8)) else { break };
            let value = || collapse_whitespace(&text(data));
            match kind {
                100 => {
                    let name = value();
                    if !name.is_empty() {
                        metadata.authors.push(name);
                    }
                }
                101 => metadata.publisher = Some(value()).filter(|v| !v.is_empty()),
                103 => metadata.synopsis = Some(strip_html(&text(data))).filter(|v| !v.is_empty()),
                104 => {
                    if let Some(isbn) = clean_isbn(&value()) {
                        metadata.isbn = Some(isbn);
                    }
                }
                201 => cover_offset = u32_at(data, 0),
                503 => updated_title = Some(value()).filter(|v| !v.is_empty()),
                524 => metadata.language = Some(value()).filter(|v| !v.is_empty()),
                _ => {}
            }
            at += len.max(8);
        }
    }
    metadata.title = updated_title.or_else(|| full_name.map(|n| collapse_whitespace(&text(n))).filter(|n| !n.is_empty()));
    // 0xFFFFFFFF means "no cover".
    if let (Some(first), Some(offset)) = (first_image, cover_offset.filter(|&o| o != 0xFFFF_FFFF)) {
        metadata.cover = record(first + offset).map(<[u8]>::to_vec).and_then(cover_from_bytes);
    }
    Ok(metadata)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// A tiny Kindle book: a header record with EXTH details, one text
    /// record, and one picture.
    pub(crate) fn sample_mobi(title: &str, author: &str) -> Vec<u8> {
        let exth_records: Vec<(u32, Vec<u8>)> = vec![
            (100, author.as_bytes().to_vec()),
            (101, b"Penguin".to_vec()),
            (103, b"<p>A <b>great</b> book.</p>".to_vec()),
            (104, b"978-0-14-143951-8".to_vec()),
            (201, 0u32.to_be_bytes().to_vec()),
            (503, title.as_bytes().to_vec()),
        ];
        let mut exth = b"EXTH".to_vec();
        let body: Vec<u8> = exth_records
            .iter()
            .flat_map(|(k, d)| [k.to_be_bytes().to_vec(), ((d.len() + 8) as u32).to_be_bytes().to_vec(), d.clone()].concat())
            .collect();
        exth.extend(((body.len() + 12) as u32).to_be_bytes());
        exth.extend((exth_records.len() as u32).to_be_bytes());
        exth.extend(body);

        let header_len = 232usize;
        let mut rec0 = vec![0u8; 16 + header_len];
        rec0[16..20].copy_from_slice(b"MOBI");
        rec0[20..24].copy_from_slice(&(header_len as u32).to_be_bytes());
        rec0[28..32].copy_from_slice(&65001u32.to_be_bytes());
        rec0[108..112].copy_from_slice(&2u32.to_be_bytes()); // first image record
        rec0[128..132].copy_from_slice(&0x40u32.to_be_bytes());
        rec0.extend(exth);
        let name_at = rec0.len();
        rec0.extend(b"Short Name");
        rec0[84..88].copy_from_slice(&(name_at as u32).to_be_bytes());
        rec0[88..92].copy_from_slice(&10u32.to_be_bytes());

        let records = [rec0, b"text".to_vec(), vec![0xFF, 0xD8, 0xFF, 9]];
        let mut file = vec![0u8; 78 + records.len() * 8 + 2];
        file[60..68].copy_from_slice(b"BOOKMOBI");
        file[76..78].copy_from_slice(&(records.len() as u16).to_be_bytes());
        let mut at = file.len();
        for (i, r) in records.iter().enumerate() {
            file[78 + i * 8..82 + i * 8].copy_from_slice(&(at as u32).to_be_bytes());
            at += r.len();
        }
        for r in records {
            file.extend(r);
        }
        file
    }

    #[test]
    fn kindle_details_and_cover() {
        let m = parse(&sample_mobi("Bleak House", "Charles Dickens")).unwrap();
        assert_eq!(m.title.as_deref(), Some("Bleak House"));
        assert_eq!(m.authors, ["Charles Dickens"]);
        assert_eq!(m.publisher.as_deref(), Some("Penguin"));
        assert_eq!(m.synopsis.as_deref(), Some("A great book."));
        assert_eq!(m.isbn.as_deref(), Some("9780141439518"));
        assert_eq!(m.cover.unwrap().extension, "jpg");
    }

    #[test]
    fn other_files_are_not_kindle_books() {
        assert!(parse(b"hello").is_err());
    }
}

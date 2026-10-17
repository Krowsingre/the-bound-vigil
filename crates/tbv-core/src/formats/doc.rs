//! Older Word documents (DOC, Word 97 to 2003). These are a little file
//! system of their own. TBV reads the document's text, without its
//! formatting, and the title and author from its summary information.

use std::io::Read;
use std::path::Path;

use crate::epub::{collapse_whitespace, BookMetadata};
use crate::error::{Error, Result};

fn bad(why: &str) -> Error {
    Error::BadBook(why.into())
}

fn u16_at(b: &[u8], at: usize) -> Option<usize> {
    Some(u16::from_le_bytes(b.get(at..at + 2)?.try_into().ok()?) as usize)
}

fn u32_at(b: &[u8], at: usize) -> Option<usize> {
    Some(u32::from_le_bytes(b.get(at..at + 4)?.try_into().ok()?) as usize)
}

fn read_stream(file: &mut cfb::CompoundFile<std::fs::File>, name: &str) -> Result<Vec<u8>> {
    let mut stream = file.open_stream(name).map_err(|_| bad("not a Word document"))?;
    let mut bytes = Vec::new();
    stream.read_to_end(&mut bytes)?;
    Ok(bytes)
}

pub(super) fn read_metadata(path: &Path) -> Result<BookMetadata> {
    let mut file = cfb::open(path).map_err(|e| Error::BadBook(e.to_string()))?;
    if !file.is_stream("/WordDocument") {
        return Err(bad("not a Word document"));
    }
    let Ok(summary) = read_stream(&mut file, "/\u{5}SummaryInformation") else {
        return Ok(BookMetadata::default());
    };
    let properties = summary_properties(&summary).unwrap_or_default();
    let get = |id: usize| {
        properties
            .iter()
            .find(|(pid, _)| *pid == id)
            .map(|(_, v)| collapse_whitespace(v))
            .filter(|v| !v.is_empty())
    };
    Ok(BookMetadata {
        title: get(2),
        synopsis: get(3),
        authors: get(4).map(|a| a.split(';').map(collapse_whitespace).filter(|a| !a.is_empty()).collect()).unwrap_or_default(),
        ..Default::default()
    })
}

/// The text properties of a summary information stream, by property id.
fn summary_properties(stream: &[u8]) -> Option<Vec<(usize, String)>> {
    let set = u32_at(stream, 44)?;
    let count = u32_at(stream, set + 4)?;
    let entries: Vec<(usize, usize)> =
        (0..count.min(64)).filter_map(|i| Some((u32_at(stream, set + 8 + i * 8)?, u32_at(stream, set + 12 + i * 8)?))).collect();
    let code_page = entries
        .iter()
        .find(|(pid, _)| *pid == 1)
        .and_then(|(_, at)| u16_at(stream, set + at + 4))
        .unwrap_or(1252);
    let encoding = codepage_encoding(code_page);
    let mut out = Vec::new();
    for (pid, at) in entries {
        let at = set + at;
        let (Some(kind), Some(len)) = (u32_at(stream, at), u32_at(stream, at + 4)) else { continue };
        let text = match kind {
            // VT_LPSTR, in the stream's code page, ending in a zero byte.
            0x1E => stream.get(at + 8..at + 8 + len).map(|b| encoding.decode(b).0.into_owned()),
            // VT_LPWSTR, UTF-16.
            0x1F => stream.get(at + 8..at + 8 + len * 2).map(|b| {
                let units: Vec<u16> = b.as_chunks::<2>().0.iter().map(|c| u16::from_le_bytes(*c)).collect();
                String::from_utf16_lossy(&units)
            }),
            _ => None,
        };
        if let Some(text) = text {
            out.push((pid, text.trim_end_matches('\0').to_string()));
        }
    }
    Some(out)
}

fn codepage_encoding(code_page: usize) -> &'static encoding_rs::Encoding {
    match code_page {
        65001 => encoding_rs::UTF_8,
        1250 => encoding_rs::WINDOWS_1250,
        1251 => encoding_rs::WINDOWS_1251,
        1253 => encoding_rs::WINDOWS_1253,
        1254 => encoding_rs::WINDOWS_1254,
        1255 => encoding_rs::WINDOWS_1255,
        1256 => encoding_rs::WINDOWS_1256,
        _ => encoding_rs::WINDOWS_1252,
    }
}

/// The document's main text, one paragraph per line.
pub fn read_text(path: &Path) -> Result<String> {
    let mut file = cfb::open(path).map_err(|e| Error::BadBook(e.to_string()))?;
    let word = read_stream(&mut file, "/WordDocument")?;
    if u16_at(&word, 0) != Some(0xA5EC) {
        return Err(bad("not a Word document"));
    }
    if u16_at(&word, 2).is_some_and(|n| n < 0x00C1) {
        return Err(Error::Unsuitable(
            "This Word document is from before Word 97. Open it in Word or LibreOffice and save it as DOCX to read it here.".into(),
        ));
    }
    let flags = u16_at(&word, 0x0A).ok_or_else(|| bad("short file"))?;
    if flags & 0x0100 != 0 {
        return Err(Error::Unsuitable("This Word document has a password, so TBV can't read it.".into()));
    }
    let table = read_stream(&mut file, if flags & 0x0200 != 0 { "/1Table" } else { "/0Table" })?;
    let main_text_len = u32_at(&word, 0x4C).ok_or_else(|| bad("short file"))?;
    let (clx_at, clx_len) = (u32_at(&word, 0x1A2), u32_at(&word, 0x1A6));
    let clx = clx_at
        .zip(clx_len)
        .and_then(|(at, len)| table.get(at..at + len))
        .ok_or_else(|| bad("no text table"))?;

    // Skip formatting records (0x01) to reach the piece table (0x02).
    let mut at = 0;
    while clx.get(at) == Some(&0x01) {
        at += 3 + u16_at(clx, at + 1).ok_or_else(|| bad("bad text table"))?;
    }
    if clx.get(at) != Some(&0x02) {
        return Err(bad("bad text table"));
    }
    let pieces_len = u32_at(clx, at + 1).ok_or_else(|| bad("bad text table"))?;
    let pieces = clx.get(at + 5..at + 5 + pieces_len).ok_or_else(|| bad("bad text table"))?;
    // n+1 character positions, then n 8-byte piece descriptors.
    let n = (pieces_len - 4) / 12;
    let mut raw = String::new();
    for i in 0..n {
        let (Some(start), Some(end)) = (u32_at(pieces, i * 4), u32_at(pieces, i * 4 + 4)) else { break };
        if start >= main_text_len {
            break;
        }
        let chars = end.min(main_text_len).saturating_sub(start);
        let fc = u32_at(pieces, (n + 1) * 4 + i * 8 + 2).ok_or_else(|| bad("bad text table"))?;
        if fc & 0x4000_0000 != 0 {
            let offset = (fc & !0x4000_0000) / 2;
            if let Some(bytes) = word.get(offset..offset + chars) {
                raw.push_str(&encoding_rs::WINDOWS_1252.decode(bytes).0);
            }
        } else if let Some(bytes) = word.get(fc..fc + chars * 2) {
            let units: Vec<u16> = bytes.as_chunks::<2>().0.iter().map(|c| u16::from_le_bytes(*c)).collect();
            raw.push_str(&String::from_utf16_lossy(&units));
        }
    }
    Ok(clean_text(&raw))
}

/// Turns Word's marks into plain text: paragraph and cell ends become line
/// breaks, field codes are dropped (their shown results are kept), and
/// pictures and other placeholders disappear.
fn clean_text(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    // Depth of nested fields, and whether we're in a field's code part.
    let mut in_code: Vec<bool> = Vec::new();
    for c in raw.chars() {
        match c {
            '\u{13}' => in_code.push(true),
            '\u{14}' => {
                if let Some(top) = in_code.last_mut() {
                    *top = false;
                }
            }
            '\u{15}' => {
                in_code.pop();
            }
            _ if in_code.last() == Some(&true) => {}
            '\r' | '\u{07}' | '\u{0C}' => out.push('\n'),
            '\u{0B}' => out.push('\n'),
            '\u{1E}' => out.push('-'),
            '\u{1F}' => {}
            '\t' => out.push('\t'),
            c if (c as u32) < 0x20 => {}
            c => out.push(c),
        }
    }
    let lines: Vec<&str> = out.lines().map(str::trim_end).collect();
    let mut tidy = Vec::with_capacity(lines.len());
    for line in lines {
        if line.trim().is_empty() && tidy.last().is_none_or(|l: &&str| l.trim().is_empty()) {
            continue;
        }
        tidy.push(line);
    }
    tidy.join("\n").trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn word_marks_become_plain_text() {
        let raw = "Title\r\rFirst para\u{13} PAGE \u{14}3\u{15} ends.\rCell\u{07}Next\u{0B}line\u{01}\r";
        assert_eq!(clean_text(raw), "Title\n\nFirst para3 ends.\nCell\nNext\nline");
    }

    #[test]
    fn a_word_97_document_is_read() {
        // Made with LibreOffice from a short document (Word 97-2003 format).
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/lamps.doc");
        let text = read_text(&path).unwrap();
        assert!(text.contains("Chapter One"), "{text}");
        assert!(text.contains("The lamps along the harbour wall were lit one by one."), "{text}");
        let m = read_metadata(&path).unwrap();
        assert_eq!(m.title.as_deref(), Some("Lamps at Dusk"));
        assert_eq!(m.authors, ["Wren Hale"]);
    }

    #[test]
    fn other_files_are_refused() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("x.doc");
        std::fs::write(&path, b"plain text pretending").unwrap();
        assert!(read_text(&path).is_err());
    }
}

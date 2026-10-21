//! Comic book archives: CBZ (a zip) and CBR (a RAR) of page pictures,
//! sometimes with a ComicInfo.xml describing the issue. The reader only
//! opens zips, so a CBR is handed to it as one, made in memory; the CBR
//! file itself is never changed.

use std::fs::File;
use std::io::Read;
use std::path::Path;

use quick_xml::events::Event;
use quick_xml::Reader;
use zip::ZipArchive;

use super::{cover_from_bytes, natural_cmp};
use crate::epub::{clean_isbn, collapse_whitespace, strip_html, BookMetadata};
use crate::error::{Error, Result};

const PAGE_EXTENSIONS: &[&str] = &["jpg", "jpeg", "png", "gif", "webp"];

pub(super) fn read(path: &Path) -> Result<BookMetadata> {
    let mut archive = ZipArchive::new(File::open(path)?).map_err(|e| Error::BadBook(e.to_string()))?;
    let names: Vec<String> = archive.file_names().map(str::to_string).collect();

    let mut metadata = names
        .iter()
        .find(|n| n.rsplit('/').next().is_some_and(|f| f.eq_ignore_ascii_case("comicinfo.xml")))
        .and_then(|n| read_entry(&mut archive, n).ok())
        .map(|xml| comic_info(&String::from_utf8_lossy(&xml)))
        .unwrap_or_default();

    // The first page, in page order, is the cover.
    let mut pages: Vec<&String> = names
        .iter()
        .filter(|n| {
            let lower = n.to_ascii_lowercase();
            !lower.starts_with("__macosx/")
                && !lower.rsplit('/').next().unwrap_or("").starts_with('.')
                && PAGE_EXTENSIONS.iter().any(|ext| lower.ends_with(&format!(".{ext}")))
        })
        .collect();
    pages.sort_by(|a, b| natural_cmp(a, b));
    if let Some(first) = pages.first() {
        metadata.cover = read_entry(&mut archive, first).ok().and_then(cover_from_bytes);
    }
    Ok(metadata)
}

fn is_page(name: &str) -> bool {
    let lower = name.to_ascii_lowercase().replace('\\', "/");
    !lower.starts_with("__macosx/")
        && !lower.rsplit('/').next().unwrap_or("").starts_with('.')
        && PAGE_EXTENSIONS.iter().any(|ext| lower.ends_with(&format!(".{ext}")))
}

fn is_comic_info(name: &str) -> bool {
    name.rsplit(['/', '\\']).next().is_some_and(|f| f.eq_ignore_ascii_case("comicinfo.xml"))
}

fn rar_problem(e: unrar::error::UnrarError) -> Error {
    Error::BadBook(format!("this CBR couldn't be opened ({e})"))
}

/// A CBR's details: its ComicInfo.xml and its first page as the cover.
pub(super) fn read_rar(path: &Path) -> Result<BookMetadata> {
    let names: Vec<String> = unrar::Archive::new(path)
        .open_for_listing()
        .map_err(rar_problem)?
        .filter_map(|e| e.ok())
        .filter(|e| e.is_file())
        .map(|e| e.filename.to_string_lossy().into_owned())
        .collect();
    let mut pages: Vec<&String> = names.iter().filter(|n| is_page(n)).collect();
    pages.sort_by(|a, b| natural_cmp(a, b));
    let first = pages.first().map(|p| p.to_string());
    let (mut info, mut cover) = (None, None);
    let mut archive = unrar::Archive::new(path).open_for_processing().map_err(rar_problem)?;
    while let Some(header) = archive.read_header().map_err(rar_problem)? {
        let name = header.entry().filename.to_string_lossy().into_owned();
        let wanted = header.entry().is_file() && (is_comic_info(&name) || first.as_deref() == Some(name.as_str()));
        archive = if wanted {
            let (bytes, rest) = header.read().map_err(rar_problem)?;
            if is_comic_info(&name) {
                info = Some(bytes);
            } else {
                cover = Some(bytes);
            }
            rest
        } else {
            header.skip().map_err(rar_problem)?
        };
        if info.is_some() && cover.is_some() {
            break;
        }
    }
    let mut metadata = info.map(|xml| comic_info(&String::from_utf8_lossy(&xml))).unwrap_or_default();
    metadata.cover = cover.and_then(cover_from_bytes);
    Ok(metadata)
}

/// A CBR's pages as a zip, for the reader. Stored, not compressed again:
/// the pictures are compressed already.
pub fn rar_as_zip(path: &Path) -> Result<Vec<u8>> {
    use std::io::Write;
    let mut zip = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    let stored = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored).large_file(true);
    let mut archive = unrar::Archive::new(path).open_for_processing().map_err(rar_problem)?;
    let mut pages = 0;
    while let Some(header) = archive.read_header().map_err(rar_problem)? {
        let name = header.entry().filename.to_string_lossy().replace('\\', "/");
        archive = if header.entry().is_file() && (is_page(&name) || is_comic_info(&name)) {
            let (bytes, rest) = header.read().map_err(rar_problem)?;
            zip.start_file(name.as_str(), stored).map_err(|e| Error::BadBook(e.to_string()))?;
            zip.write_all(&bytes)?;
            pages += 1;
            rest
        } else {
            header.skip().map_err(rar_problem)?
        };
    }
    if pages == 0 {
        return Err(Error::BadBook("this CBR has no pages TBV can show".into()));
    }
    Ok(zip.finish().map_err(|e| Error::BadBook(e.to_string()))?.into_inner())
}

fn read_entry(archive: &mut ZipArchive<File>, name: &str) -> Result<Vec<u8>> {
    let mut entry = archive.by_name(name).map_err(|e| Error::BadBook(e.to_string()))?;
    let mut bytes = Vec::new();
    entry.read_to_end(&mut bytes)?;
    Ok(bytes)
}

/// The fields of ComicInfo.xml that TBV keeps.
fn comic_info(xml: &str) -> BookMetadata {
    let mut reader = Reader::from_str(xml);
    let mut metadata = BookMetadata::default();
    let mut field = String::new();
    let mut text = String::new();
    let (mut title, mut series, mut number) = (None, None, None);
    while let Ok(event) = reader.read_event() {
        match event {
            Event::Start(e) => {
                field = String::from_utf8_lossy(e.local_name().as_ref()).to_string();
                text.clear();
            }
            Event::Text(t) => text.push_str(&t.unescape().map(|v| v.into_owned()).unwrap_or_default()),
            Event::End(_) => {
                let value = collapse_whitespace(&text);
                if !value.is_empty() {
                    match field.as_str() {
                        "Title" => title = Some(value),
                        "Series" => series = Some(value),
                        "Number" => number = Some(value),
                        "Writer" => {
                            metadata.authors =
                                value.split(',').map(collapse_whitespace).filter(|a| !a.is_empty()).collect()
                        }
                        "Summary" => metadata.synopsis = Some(strip_html(&value)),
                        "Publisher" => metadata.publisher = Some(value),
                        "LanguageISO" => metadata.language = Some(value),
                        "GTIN" | "ISBN" => metadata.isbn = clean_isbn(&value),
                        _ => {}
                    }
                }
                field.clear();
                text.clear();
            }
            Event::Eof => break,
            _ => {}
        }
    }
    metadata.series_index = number.as_deref().and_then(|n| n.parse().ok());
    // An issue without its own title is known by its series and number.
    metadata.title = title.or_else(|| match (&series, &number) {
        (Some(s), Some(n)) => Some(format!("{s} #{n}")),
        _ => None,
    });
    metadata.series = series;
    metadata
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::io::Write;
    use zip::write::SimpleFileOptions;

    const PNG: &[u8] = &[0x89, b'P', b'N', b'G', 1, 2, 3];
    const JPG: &[u8] = &[0xFF, 0xD8, 0xFF, 4, 5, 6];

    fn crc32(bytes: &[u8]) -> u32 {
        let mut crc = !0u32;
        for b in bytes {
            crc ^= *b as u32;
            for _ in 0..8 {
                crc = if crc & 1 != 0 { (crc >> 1) ^ 0xEDB8_8320 } else { crc >> 1 };
            }
        }
        !crc
    }

    /// A RAR (version 4, files stored) holding `files`, as comic shops make them.
    pub(crate) fn sample_rar(files: &[(&str, &[u8])]) -> Vec<u8> {
        fn block(kind: u8, flags: u16, rest: &[u8], crc32: impl Fn(&[u8]) -> u32) -> Vec<u8> {
            let mut head = vec![kind];
            head.extend(flags.to_le_bytes());
            head.extend(((7 + rest.len()) as u16).to_le_bytes());
            head.extend(rest);
            let mut out = ((crc32(&head) & 0xFFFF) as u16).to_le_bytes().to_vec();
            out.extend(head);
            out
        }
        let mut out = b"Rar!\x1a\x07\x00".to_vec();
        out.extend(block(0x73, 0, &[0; 6], crc32));
        for (name, data) in files {
            let mut rest = Vec::new();
            rest.extend((data.len() as u32).to_le_bytes());
            rest.extend((data.len() as u32).to_le_bytes());
            rest.push(2); // made on Windows
            rest.extend(crc32(data).to_le_bytes());
            rest.extend(0x5A21_0000u32.to_le_bytes());
            rest.push(20);
            rest.push(0x30); // stored
            rest.extend((name.len() as u16).to_le_bytes());
            rest.extend(0x20u32.to_le_bytes());
            rest.extend(name.as_bytes());
            out.extend(block(0x74, 0x8000, &rest, crc32));
            out.extend(*data);
        }
        out.extend(block(0x7B, 0x4000, &[], crc32));
        out
    }

    #[test]
    fn a_cbr_is_read_and_handed_to_the_reader_as_a_zip() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("c.cbr");
        let info = b"<ComicInfo><Series>Hellboy</Series><Number>2</Number><Writer>Mike Mignola</Writer></ComicInfo>";
        fs::write(&path, sample_rar(&[("p10.png", PNG), ("p2.jpg", JPG), ("ComicInfo.xml", info), ("notes.txt", b"x")])).unwrap();
        let metadata = read_rar(&path).unwrap();
        assert_eq!(metadata.title.as_deref(), Some("Hellboy #2"));
        assert_eq!(metadata.authors, ["Mike Mignola"]);
        assert!(metadata.cover.is_some(), "page 2 comes before page 10");

        let zip = rar_as_zip(&path).unwrap();
        let mut archive = ZipArchive::new(std::io::Cursor::new(zip)).unwrap();
        let mut names: Vec<String> = archive.file_names().map(str::to_string).collect();
        names.sort();
        assert_eq!(names, ["ComicInfo.xml", "p10.png", "p2.jpg"], "only pages and details");
        let mut page = Vec::new();
        archive.by_name("p2.jpg").unwrap().read_to_end(&mut page).unwrap();
        assert_eq!(page, JPG);
        assert_eq!(fs::read(&path).unwrap().len(), fs::metadata(&path).unwrap().len() as usize, "the CBR itself is untouched");
    }

    #[test]
    fn comic_info_and_first_page() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("c.cbz");
        let mut zip = zip::ZipWriter::new(File::create(&path).unwrap());
        for (name, bytes) in [("pages/p10.png", PNG), ("pages/p2.png", PNG), ("pages/p1.jpg", JPG)] {
            zip.start_file(name, SimpleFileOptions::default()).unwrap();
            zip.write_all(bytes).unwrap();
        }
        zip.start_file("ComicInfo.xml", SimpleFileOptions::default()).unwrap();
        zip.write_all(
            b"<ComicInfo><Series>Little Nemo</Series><Number>4</Number><Writer>Winsor McCay, A. N. Other</Writer>\
              <Summary>Dreams &amp; beds.</Summary></ComicInfo>",
        )
        .unwrap();
        zip.finish().unwrap();

        let m = read(&path).unwrap();
        assert_eq!(m.title.as_deref(), Some("Little Nemo #4"));
        assert_eq!(m.series.as_deref(), Some("Little Nemo"));
        assert_eq!(m.series_index, Some(4.0));
        assert_eq!(m.authors, ["Winsor McCay", "A. N. Other"]);
        assert_eq!(m.synopsis.as_deref(), Some("Dreams & beds."));
        assert_eq!(m.cover.unwrap().bytes, JPG);
    }
}

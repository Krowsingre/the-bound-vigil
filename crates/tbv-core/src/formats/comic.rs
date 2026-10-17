//! Comic book archives (CBZ): a zip of page pictures, sometimes with a
//! ComicInfo.xml describing the issue.

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
    use std::io::Write;
    use zip::write::SimpleFileOptions;

    const PNG: &[u8] = &[0x89, b'P', b'N', b'G', 1, 2, 3];
    const JPG: &[u8] = &[0xFF, 0xD8, 0xFF, 4, 5, 6];

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

//! FictionBook (FB2), and FB2 inside a zip (FBZ).

use std::fs::{self, File};
use std::io::Read;
use std::path::Path;

use quick_xml::events::Event;
use quick_xml::Reader;
use zip::ZipArchive;

use super::{cover_from_bytes, decode_base64};
use crate::epub::{attribute, clean_isbn, collapse_whitespace, BookMetadata};
use crate::error::{Error, Result};

pub(super) fn read(path: &Path, zipped: bool) -> Result<BookMetadata> {
    let bytes = if zipped {
        let mut archive = ZipArchive::new(File::open(path)?).map_err(|e| Error::BadBook(e.to_string()))?;
        let name = archive
            .file_names()
            .find(|n| n.to_ascii_lowercase().ends_with(".fb2"))
            .map(str::to_string)
            .ok_or_else(|| Error::BadBook("no FB2 file inside".into()))?;
        let mut entry = archive.by_name(&name).map_err(|e| Error::BadBook(e.to_string()))?;
        let mut bytes = Vec::new();
        entry.read_to_end(&mut bytes)?;
        bytes
    } else {
        fs::read(path)?
    };
    parse(&decode(&bytes))
}

/// FB2 files are often in an older encoding (Windows-1251 for Russian books),
/// named in the XML declaration.
pub(super) fn decode(bytes: &[u8]) -> String {
    let head = String::from_utf8_lossy(&bytes[..bytes.len().min(200)]).to_ascii_lowercase();
    let label = head
        .split("encoding=")
        .nth(1)
        .and_then(|rest| rest.trim_start_matches(['"', '\'']).split(['"', '\'']).next())
        .unwrap_or("utf-8");
    let encoding = encoding_rs::Encoding::for_label(label.as_bytes()).unwrap_or(encoding_rs::UTF_8);
    encoding.decode(bytes).0.into_owned()
}

#[derive(Default)]
struct Person {
    first: String,
    middle: String,
    last: String,
    nickname: String,
}

impl Person {
    fn name(&self) -> String {
        let full = collapse_whitespace(&format!("{} {} {}", self.first, self.middle, self.last));
        if full.is_empty() {
            collapse_whitespace(&self.nickname)
        } else {
            full
        }
    }
}

fn parse(xml: &str) -> Result<BookMetadata> {
    let mut reader = Reader::from_str(xml);
    let mut metadata = BookMetadata::default();
    let mut path: Vec<String> = Vec::new();
    let mut author: Option<Person> = None;
    let mut text = String::new();
    let mut annotation = String::new();
    let mut cover_id: Option<String> = None;
    // The picture being read, while inside its <binary>.
    let mut binary: Option<(String, String)> = None;

    loop {
        let event = reader.read_event().map_err(|e| Error::BadBook(e.to_string()))?;
        match event {
            Event::Start(ref e) | Event::Empty(ref e) => {
                let name = String::from_utf8_lossy(e.local_name().as_ref()).to_string();
                let empty = matches!(event, Event::Empty(_));
                let inside = |p: &[String], parent: &str| p.iter().any(|n| n == parent);
                match name.as_str() {
                    "author" if path.last().is_some_and(|p| p == "title-info") => author = Some(Person::default()),
                    "sequence" if inside(&path, "title-info") && metadata.series.is_none() => {
                        metadata.series = attribute(e, b"name").filter(|n| !n.is_empty());
                        metadata.series_index = attribute(e, b"number").and_then(|n| n.parse().ok());
                    }
                    "image" if inside(&path, "coverpage") && cover_id.is_none() => {
                        cover_id = attribute(e, b"href").map(|h| h.trim_start_matches('#').to_string());
                    }
                    "binary" => {
                        let id = attribute(e, b"id").unwrap_or_default();
                        if cover_id.as_deref() == Some(id.as_str()) && !empty {
                            binary = Some((id, String::new()));
                        }
                    }
                    // Paragraph breaks in the blurb.
                    "p" if inside(&path, "annotation") && !annotation.is_empty() => annotation.push_str("\n\n"),
                    _ => {}
                }
                if !empty {
                    path.push(name);
                    text.clear();
                }
            }
            Event::Text(t) => {
                let value = t.unescape().map(|v| v.into_owned()).unwrap_or_default();
                if let Some((_, data)) = binary.as_mut() {
                    data.push_str(&value);
                } else if path.iter().any(|n| n == "annotation") {
                    annotation.push_str(&value);
                } else {
                    text.push_str(&value);
                }
            }
            Event::CData(t) => text.push_str(&String::from_utf8_lossy(&t)),
            Event::End(_) => {
                let Some(name) = path.pop() else { continue };
                let parent = path.last().map(String::as_str).unwrap_or("");
                let value = collapse_whitespace(&text);
                match (parent, name.as_str()) {
                    ("title-info", "book-title") if metadata.title.is_none() && !value.is_empty() => {
                        metadata.title = Some(value)
                    }
                    ("title-info", "lang") if !value.is_empty() => metadata.language = Some(value),
                    ("publish-info", "publisher") if !value.is_empty() => metadata.publisher = Some(value),
                    ("publish-info", "isbn") => metadata.isbn = clean_isbn(&value),
                    ("author", field) => {
                        if let Some(person) = author.as_mut() {
                            match field {
                                "first-name" => person.first = value,
                                "middle-name" => person.middle = value,
                                "last-name" => person.last = value,
                                "nickname" => person.nickname = value,
                                _ => {}
                            }
                        }
                    }
                    ("title-info", "author") => {
                        let name = author.take().map(|p| p.name()).unwrap_or_default();
                        if !name.is_empty() {
                            metadata.authors.push(name);
                        }
                    }
                    (_, "binary") => {
                        if let Some((_, data)) = binary.take() {
                            metadata.cover = decode_base64(&data).and_then(cover_from_bytes);
                            break;
                        }
                    }
                    _ => {}
                }
                text.clear();
            }
            Event::Eof => break,
            _ => {}
        }
    }
    let blurb: Vec<String> = annotation
        .split("\n\n")
        .map(collapse_whitespace)
        .filter(|p| !p.is_empty())
        .collect();
    if !blurb.is_empty() {
        metadata.synopsis = Some(blurb.join("\n\n"));
    }
    Ok(metadata)
}

#[cfg(test)]
mod tests {
    use super::*;

    const PNG_BASE64: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

    fn sample() -> String {
        format!(
            r##"<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
<description>
  <title-info>
    <genre>sf</genre>
    <author><first-name>Ursula</first-name><middle-name>K.</middle-name><last-name>Le Guin</last-name></author>
    <author><nickname>Anon</nickname></author>
    <book-title>The  Lathe of Heaven</book-title>
    <annotation><p>A man whose dreams</p><p>change the world.</p></annotation>
    <lang>en</lang>
    <coverpage><image l:href="#cover.png"/></coverpage>
    <sequence name="Standalones" number="3"/>
  </title-info>
  <publish-info><publisher>Avon</publisher><isbn>978-0-06-112130-7</isbn></publish-info>
</description>
<body><section><p>Text</p></section></body>
<binary id="cover.png" content-type="image/png">{PNG_BASE64}</binary>
</FictionBook>"##
        )
    }

    #[test]
    fn fb2_details_and_cover_are_read() {
        let m = parse(&sample()).unwrap();
        assert_eq!(m.title.as_deref(), Some("The Lathe of Heaven"));
        assert_eq!(m.authors, ["Ursula K. Le Guin", "Anon"]);
        assert_eq!(m.synopsis.as_deref(), Some("A man whose dreams\n\nchange the world."));
        assert_eq!(m.language.as_deref(), Some("en"));
        assert_eq!(m.publisher.as_deref(), Some("Avon"));
        assert_eq!(m.isbn.as_deref(), Some("9780061121307"));
        assert_eq!(m.series.as_deref(), Some("Standalones"));
        assert_eq!(m.series_index, Some(3.0));
        assert_eq!(m.cover.unwrap().extension, "png");
    }

    #[test]
    fn older_encodings_are_honoured() {
        let (bytes, _, _) = encoding_rs::WINDOWS_1251.encode("<?xml version=\"1.0\" encoding=\"windows-1251\"?><a>Война</a>");
        assert!(decode(&bytes).contains("Война"));
    }

    #[test]
    fn fbz_reads_the_book_inside() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("b.fbz");
        let mut zip = zip::ZipWriter::new(File::create(&path).unwrap());
        zip.start_file("book.fb2", zip::write::SimpleFileOptions::default()).unwrap();
        std::io::Write::write_all(&mut zip, sample().as_bytes()).unwrap();
        zip.finish().unwrap();
        assert_eq!(read(&path, true).unwrap().title.as_deref(), Some("The Lathe of Heaven"));
    }
}

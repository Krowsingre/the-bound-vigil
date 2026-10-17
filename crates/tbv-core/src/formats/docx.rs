//! Word documents (DOCX). Their details live in `docProps/core.xml`.

use std::fs::File;
use std::io::Read;
use std::path::Path;

use quick_xml::events::Event;
use quick_xml::Reader;
use zip::ZipArchive;

use crate::epub::{collapse_whitespace, BookMetadata};
use crate::error::{Error, Result};

pub(super) fn read(path: &Path) -> Result<BookMetadata> {
    let mut archive = ZipArchive::new(File::open(path)?).map_err(|e| Error::BadBook(e.to_string()))?;
    if archive.by_name("word/document.xml").is_err() {
        return Err(Error::BadBook("not a Word document".into()));
    }
    let Ok(mut core) = archive.by_name("docProps/core.xml") else {
        return Ok(BookMetadata::default());
    };
    let mut xml = String::new();
    core.read_to_string(&mut xml)?;
    Ok(core_properties(&xml))
}

fn core_properties(xml: &str) -> BookMetadata {
    let mut reader = Reader::from_str(xml);
    let mut metadata = BookMetadata::default();
    let (mut field, mut text) = (String::new(), String::new());
    let mut subject = None;
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
                        "title" => metadata.title = Some(value),
                        // Several authors are usually written "A; B".
                        "creator" => {
                            metadata.authors =
                                value.split(';').map(collapse_whitespace).filter(|a| !a.is_empty()).collect()
                        }
                        "description" => metadata.synopsis = Some(value),
                        "subject" => subject = Some(value),
                        "language" => metadata.language = Some(value),
                        _ => {}
                    }
                }
                field.clear();
            }
            Event::Eof => break,
            _ => {}
        }
    }
    metadata.synopsis = metadata.synopsis.or(subject);
    metadata
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use zip::write::SimpleFileOptions;

    #[test]
    fn word_document_details() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("d.docx");
        let mut zip = zip::ZipWriter::new(File::create(&path).unwrap());
        zip.start_file("word/document.xml", SimpleFileOptions::default()).unwrap();
        zip.write_all(b"<w:document/>").unwrap();
        zip.start_file("docProps/core.xml", SimpleFileOptions::default()).unwrap();
        zip.write_all(
            br#"<cp:coreProperties xmlns:cp="x" xmlns:dc="http://purl.org/dc/elements/1.1/">
                <dc:title>My Draft</dc:title><dc:creator>Wren Hale; Ash Pale</dc:creator>
                <dc:subject>A story about lamps</dc:subject></cp:coreProperties>"#,
        )
        .unwrap();
        zip.finish().unwrap();
        let m = read(&path).unwrap();
        assert_eq!(m.title.as_deref(), Some("My Draft"));
        assert_eq!(m.authors, ["Wren Hale", "Ash Pale"]);
        assert_eq!(m.synopsis.as_deref(), Some("A story about lamps"));
    }
}

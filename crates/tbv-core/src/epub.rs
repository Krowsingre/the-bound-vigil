//! Reads the metadata and cover from an EPUB without modifying it.

use std::fs::File;
use std::io::Read;
use std::path::Path;

use quick_xml::events::{BytesStart, Event};
use quick_xml::Reader;
use zip::ZipArchive;

use crate::error::{Error, Result};

#[derive(Debug, Default, Clone, PartialEq)]
pub struct BookMetadata {
    pub title: Option<String>,
    pub authors: Vec<String>,
    pub synopsis: Option<String>,
    pub publisher: Option<String>,
    pub language: Option<String>,
    pub series: Option<String>,
    pub series_index: Option<f64>,
    /// The ISBN-13 (or ISBN-10) printed in the book's identifiers, digits only.
    pub isbn: Option<String>,
    /// `dc:subject`s, which publishers use for genres.
    pub subjects: Vec<String>,
    /// When it was published, as the book gives it (often a year or a date).
    pub published: Option<String>,
    pub cover: Option<Cover>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Cover {
    pub bytes: Vec<u8>,
    /// Lowercase extension without the dot, e.g. `jpg`.
    pub extension: String,
}

struct ManifestItem {
    id: String,
    href: String,
    media_type: String,
    properties: String,
}

#[derive(Clone, Copy, PartialEq)]
enum Field {
    Title,
    Creator,
    Description,
    Publisher,
    Language,
    /// `dc:identifier`, read for an ISBN.
    Identifier,
    Subject,
    Date,
    /// Calibre's `calibre:series`.
    Series,
    /// Calibre's `calibre:series_index`.
    SeriesIndex,
    /// EPUB 3 `<meta property="belongs-to-collection">`.
    Collection,
    /// Any other EPUB 3 `<meta refines="#id" property="…">`, such as a
    /// collection's `collection-type` or `group-position`.
    Refinement,
}

/// An element whose text is being read, with the attributes needed to place it.
struct Capture {
    field: Field,
    id: Option<String>,
    refines: Option<String>,
    property: Option<String>,
    text: String,
}

/// EPUB 3 collections and the refinements that describe them. A book can
/// belong to several (a set and a series, say), so they are kept until the
/// whole package is read and then matched up by id.
#[derive(Default)]
struct Collections {
    named: Vec<(Option<String>, String)>,
    refinements: Vec<(String, String, String)>,
}

impl Collections {
    fn refinement(&self, id: &str, property: &str) -> Option<&str> {
        self.refinements
            .iter()
            .find(|(target, p, _)| target == id && p == property)
            .map(|(_, _, value)| value.as_str())
    }

    fn kind(&self, id: Option<&str>) -> Option<&str> {
        id.and_then(|id| self.refinement(id, "collection-type"))
    }

    /// The collection marked as a series, else the first one not marked as
    /// some other kind (a `set`), with the position refined onto that one.
    fn series(&self) -> Option<(String, Option<f64>)> {
        let (id, name) = self
            .named
            .iter()
            .find(|(id, _)| self.kind(id.as_deref()) == Some("series"))
            .or_else(|| {
                self.named
                    .iter()
                    .find(|(id, _)| self.kind(id.as_deref()).is_none())
            })?;
        let position = id
            .as_deref()
            .and_then(|id| self.refinement(id, "group-position"))
            .and_then(|p| p.parse().ok());
        Some((name.clone(), position))
    }
}

pub fn read_epub_metadata(path: &Path) -> Result<BookMetadata> {
    let mut archive =
        ZipArchive::new(File::open(path)?).map_err(|e| Error::BadBook(e.to_string()))?;

    let container = read_entry(&mut archive, "META-INF/container.xml")?;
    let opf_path = find_rootfile(&container)
        .ok_or_else(|| Error::BadBook("the EPUB has no package file".into()))?;
    let opf = read_entry(&mut archive, &opf_path)?;

    let mut metadata = BookMetadata::default();
    let mut manifest: Vec<ManifestItem> = Vec::new();
    let mut cover_id: Option<String> = None;

    let mut reader = Reader::from_reader(opf.as_slice());
    reader.config_mut().trim_text(true);
    let mut buf = Vec::new();
    let mut capturing: Option<Capture> = None;
    let mut collections = Collections::default();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => {
                if let Some(field) = metadata_field(&e) {
                    capturing = Some(Capture {
                        field,
                        id: attribute(&e, b"id"),
                        refines: attribute(&e, b"refines"),
                        property: attribute(&e, b"property"),
                        text: String::new(),
                    });
                } else {
                    collect_opf_element(&e, &mut manifest, &mut cover_id, &mut metadata);
                }
            }
            Ok(Event::Empty(e)) => {
                collect_opf_element(&e, &mut manifest, &mut cover_id, &mut metadata)
            }
            Ok(Event::Text(t)) => {
                if let Some(capture) = capturing.as_mut() {
                    if let Ok(value) = t.unescape() {
                        capture.text.push_str(&value);
                    }
                }
            }
            Ok(Event::CData(t)) => {
                if let Some(capture) = capturing.as_mut() {
                    capture.text.push_str(&String::from_utf8_lossy(&t));
                }
            }
            Ok(Event::End(_)) => {
                if let Some(capture) = capturing.take() {
                    match capture.field {
                        Field::Collection => {
                            let name = collapse_whitespace(&capture.text);
                            if !name.is_empty() {
                                collections.named.push((capture.id, name));
                            }
                        }
                        Field::Refinement => {
                            if let (Some(target), Some(property)) =
                                (capture.refines, capture.property)
                            {
                                let target = target.trim_start_matches('#').to_string();
                                let value = collapse_whitespace(&capture.text);
                                collections.refinements.push((target, property, value));
                            }
                        }
                        field => store_field(&mut metadata, field, capture.text),
                    }
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(Error::BadBook(format!("unreadable package file: {e}"))),
            _ => {}
        }
        buf.clear();
    }

    // Calibre's own series fields win; otherwise use the EPUB 3 collection.
    if metadata.series.is_none() {
        if let Some((name, position)) = collections.series() {
            metadata.series = Some(name);
            metadata.series_index = position;
        }
    }

    if let Some(href) = find_cover_href(&manifest, cover_id.as_deref()) {
        let entry = join_archive_path(&opf_path, &href);
        if let Ok(bytes) = read_entry(&mut archive, &entry) {
            let extension = image_extension(&entry);
            metadata.cover = Some(Cover { bytes, extension });
        }
    }

    Ok(metadata)
}

fn read_entry(archive: &mut ZipArchive<File>, name: &str) -> Result<Vec<u8>> {
    let mut entry = archive
        .by_name(name)
        .map_err(|_| Error::BadBook(format!("missing {name}")))?;
    let mut bytes = Vec::with_capacity(entry.size() as usize);
    entry.read_to_end(&mut bytes)?;
    Ok(bytes)
}

fn find_rootfile(container: &[u8]) -> Option<String> {
    let mut reader = Reader::from_reader(container);
    let mut buf = Vec::new();
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) | Ok(Event::Empty(e)) if e.local_name().as_ref() == b"rootfile" => {
                return attribute(&e, b"full-path");
            }
            Ok(Event::Eof) | Err(_) => return None,
            _ => {}
        }
        buf.clear();
    }
}

fn metadata_field(e: &BytesStart) -> Option<Field> {
    match e.local_name().as_ref() {
        b"title" => Some(Field::Title),
        b"creator" => Some(Field::Creator),
        b"description" => Some(Field::Description),
        b"publisher" => Some(Field::Publisher),
        b"language" => Some(Field::Language),
        b"identifier" => Some(Field::Identifier),
        b"subject" => Some(Field::Subject),
        b"date" => Some(Field::Date),
        b"meta" => match attribute(e, b"property").as_deref() {
            Some("belongs-to-collection") => Some(Field::Collection),
            Some(_) if attribute(e, b"refines").is_some() => Some(Field::Refinement),
            _ => None,
        },
        _ => None,
    }
}

fn collect_opf_element(
    e: &BytesStart,
    manifest: &mut Vec<ManifestItem>,
    cover_id: &mut Option<String>,
    metadata: &mut BookMetadata,
) {
    match e.local_name().as_ref() {
        b"item" => {
            if let (Some(id), Some(href)) = (attribute(e, b"id"), attribute(e, b"href")) {
                manifest.push(ManifestItem {
                    id,
                    href,
                    media_type: attribute(e, b"media-type").unwrap_or_default(),
                    properties: attribute(e, b"properties").unwrap_or_default(),
                });
            }
        }
        b"meta" if attribute(e, b"name").is_some_and(|n| n.eq_ignore_ascii_case("cover")) => {
            *cover_id = attribute(e, b"content");
        }
        // Calibre writes series as <meta name="calibre:series" content="…"/>.
        b"meta" => match (attribute(e, b"name").as_deref(), attribute(e, b"content")) {
            (Some("calibre:series"), Some(value)) => store_field(metadata, Field::Series, value),
            (Some("calibre:series_index"), Some(value)) => {
                store_field(metadata, Field::SeriesIndex, value)
            }
            _ => {}
        },
        _ => {}
    }
}

fn store_field(metadata: &mut BookMetadata, field: Field, raw: String) {
    let text = match field {
        Field::Description => strip_html(&raw),
        _ => collapse_whitespace(&raw),
    };
    if text.is_empty() {
        return;
    }
    match field {
        Field::Title if metadata.title.is_none() => metadata.title = Some(text),
        Field::Creator => metadata.authors.push(text),
        Field::Description if metadata.synopsis.is_none() => metadata.synopsis = Some(text),
        Field::Publisher if metadata.publisher.is_none() => metadata.publisher = Some(text),
        Field::Language if metadata.language.is_none() => metadata.language = Some(text),
        Field::Series if metadata.series.is_none() => metadata.series = Some(text),
        Field::SeriesIndex if metadata.series_index.is_none() => {
            metadata.series_index = text.parse().ok()
        }
        Field::Subject if !metadata.subjects.iter().any(|s| s.eq_ignore_ascii_case(&text)) && metadata.subjects.len() < 20 => {
            metadata.subjects.push(text)
        }
        Field::Date if metadata.published.is_none() => metadata.published = Some(text.chars().take(10).collect()),
        // A 13-digit ISBN beats a 10-digit one if the book lists both.
        Field::Identifier => {
            if let Some(isbn) = clean_isbn(&text) {
                if metadata.isbn.as_ref().is_none_or(|old| old.len() < isbn.len()) {
                    metadata.isbn = Some(isbn);
                }
            }
        }
        _ => {}
    }
}

/// The digits of an ISBN written as `urn:isbn:978-…`, `ISBN 0-…` or bare.
/// Anything else (a UUID, a store's own id) isn't one.
pub(crate) fn clean_isbn(raw: &str) -> Option<String> {
    let lower = raw.trim().to_ascii_lowercase();
    let rest = lower
        .strip_prefix("urn:isbn:")
        .or_else(|| lower.strip_prefix("isbn:"))
        .or_else(|| lower.strip_prefix("isbn"))
        .unwrap_or(&lower)
        .trim();
    if rest.chars().any(|c| !(c.is_ascii_digit() || matches!(c, '-' | ' ' | 'x'))) {
        return None;
    }
    let digits: String = rest.chars().filter(|c| c.is_ascii_digit() || *c == 'x').collect::<String>().to_uppercase();
    let ok = match digits.len() {
        13 => digits.chars().all(|c| c.is_ascii_digit()) && (digits.starts_with("978") || digits.starts_with("979")),
        10 => digits[..9].chars().all(|c| c.is_ascii_digit()),
        _ => false,
    };
    ok.then_some(digits)
}

fn find_cover_href(manifest: &[ManifestItem], cover_id: Option<&str>) -> Option<String> {
    // EPUB 3 marks the cover image directly.
    if let Some(item) = manifest
        .iter()
        .find(|i| i.properties.split_whitespace().any(|p| p == "cover-image"))
    {
        return Some(item.href.clone());
    }
    // EPUB 2 points at it from <meta name="cover" content="id">.
    if let Some(id) = cover_id {
        if let Some(item) = manifest.iter().find(|i| i.id == id) {
            return Some(item.href.clone());
        }
    }
    // Last resort: an image whose id or file name says "cover".
    manifest
        .iter()
        .find(|i| {
            i.media_type.starts_with("image/")
                && (i.id.to_ascii_lowercase().contains("cover")
                    || i.href.to_ascii_lowercase().contains("cover"))
        })
        .map(|i| i.href.clone())
}

pub(crate) fn attribute(e: &BytesStart, name: &[u8]) -> Option<String> {
    e.attributes()
        .flatten()
        .find(|a| a.key.local_name().as_ref() == name)
        .and_then(|a| a.unescape_value().ok())
        .map(|v| v.trim().to_string())
}

/// Resolves a manifest href against the package file's folder inside the zip.
fn join_archive_path(opf_path: &str, href: &str) -> String {
    let href = percent_decode(href.split('#').next().unwrap_or(href));
    let mut parts: Vec<&str> = match opf_path.rfind('/') {
        Some(i) => opf_path[..i].split('/').collect(),
        None => Vec::new(),
    };
    for segment in href.split('/') {
        match segment {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            other => parts.push(other),
        }
    }
    parts.join("/")
}

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let digits = std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or("");
            if let Ok(byte) = u8::from_str_radix(digits, 16) {
                out.push(byte);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn image_extension(entry: &str) -> String {
    let ext = entry.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    match ext.as_str() {
        "jpg" | "jpeg" | "png" | "gif" | "webp" | "svg" => ext,
        _ => "jpg".into(),
    }
}

pub(crate) fn collapse_whitespace(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Descriptions are often HTML; keep the words, drop the markup.
pub(crate) fn strip_html(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    let mut in_tag = false;
    for ch in value.chars() {
        match ch {
            '<' => {
                in_tag = true;
                out.push(' ');
            }
            '>' => in_tag = false,
            _ if !in_tag => out.push(ch),
            _ => {}
        }
    }
    let text = out
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">");
    collapse_whitespace(&text)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::io::Write;
    use zip::write::SimpleFileOptions;

    /// Builds a small but valid EPUB for tests.
    pub fn write_test_epub(path: &Path, title: &str, author: &str, with_cover: bool) {
        write_test_epub_with(path, title, author, with_cover, "");
    }

    /// Like `write_test_epub`, with extra elements inside `<metadata>`.
    pub fn write_test_epub_with(
        path: &Path,
        title: &str,
        author: &str,
        with_cover: bool,
        extra_metadata: &str,
    ) {
        let file = File::create(path).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        let stored =
            SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
        zip.start_file("mimetype", stored).unwrap();
        zip.write_all(b"application/epub+zip").unwrap();
        zip.start_file("META-INF/container.xml", stored).unwrap();
        zip.write_all(br#"<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>"#).unwrap();
        let cover_item = if with_cover {
            r#"<item id="cover" href="images/cover%20art.png" media-type="image/png" properties="cover-image"/>"#
        } else {
            ""
        };
        let opf = format!(
            r#"<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>{title}</dc:title><dc:creator>{author}</dc:creator><dc:description>&lt;p&gt;A tale of &lt;i&gt;night&lt;/i&gt; &amp;amp; watchfulness.&lt;/p&gt;</dc:description><dc:language>en</dc:language>{extra_metadata}</metadata><manifest><item id="c1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>{cover_item}</manifest><spine><itemref idref="c1"/></spine></package>"#
        );
        zip.start_file("OEBPS/content.opf", stored).unwrap();
        zip.write_all(opf.as_bytes()).unwrap();
        zip.start_file("OEBPS/text/ch1.xhtml", stored).unwrap();
        zip.write_all(b"<html><body><p>Hello</p></body></html>")
            .unwrap();
        if with_cover {
            zip.start_file("OEBPS/images/cover art.png", stored)
                .unwrap();
            zip.write_all(b"\x89PNG fake cover").unwrap();
        }
        zip.finish().unwrap();
    }

    #[test]
    fn reads_title_author_synopsis_and_epub3_cover() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("book.epub");
        write_test_epub(&path, "Dracula", "Bram Stoker", true);

        let metadata = read_epub_metadata(&path).unwrap();
        assert_eq!(metadata.title.as_deref(), Some("Dracula"));
        assert_eq!(metadata.authors, vec!["Bram Stoker".to_string()]);
        assert_eq!(
            metadata.synopsis.as_deref(),
            Some("A tale of night & watchfulness.")
        );
        assert_eq!(metadata.language.as_deref(), Some("en"));
        let cover = metadata.cover.unwrap();
        assert_eq!(cover.extension, "png");
        assert_eq!(cover.bytes, b"\x89PNG fake cover");
    }

    #[test]
    fn reads_calibre_and_epub3_series() {
        let dir = tempfile::tempdir().unwrap();
        let calibre = dir.path().join("calibre.epub");
        write_test_epub_with(
            &calibre,
            "Words of Radiance",
            "B",
            false,
            r#"<meta name="calibre:series" content="The Stormlight Archive"/><meta name="calibre:series_index" content="2.0"/>"#,
        );
        let m = read_epub_metadata(&calibre).unwrap();
        assert_eq!(m.series.as_deref(), Some("The Stormlight Archive"));
        assert_eq!(m.series_index, Some(2.0));

        let epub3 = dir.path().join("epub3.epub");
        write_test_epub_with(
            &epub3,
            "Oathbringer",
            "B",
            false,
            r##"<meta property="belongs-to-collection" id="c1">The Stormlight Archive</meta><meta refines="#c1" property="group-position">3</meta>"##,
        );
        let m = read_epub_metadata(&epub3).unwrap();
        assert_eq!(m.series.as_deref(), Some("The Stormlight Archive"));
        assert_eq!(m.series_index, Some(3.0));
    }

    #[test]
    fn picks_the_series_collection_and_its_own_position() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("both.epub");
        write_test_epub_with(
            &path,
            "Oathbringer",
            "B",
            false,
            concat!(
                r##"<meta property="belongs-to-collection" id="set">Cosmere Box Set</meta>"##,
                r##"<meta refines="#set" property="collection-type">set</meta>"##,
                r##"<meta refines="#set" property="group-position">9</meta>"##,
                r##"<meta property="belongs-to-collection" id="s">The Stormlight Archive</meta>"##,
                r##"<meta refines="#s" property="collection-type">series</meta>"##,
                r##"<meta refines="#s" property="group-position">3</meta>"##,
            ),
        );
        let m = read_epub_metadata(&path).unwrap();
        assert_eq!(m.series.as_deref(), Some("The Stormlight Archive"));
        assert_eq!(m.series_index, Some(3.0));

        let only_set = dir.path().join("set.epub");
        write_test_epub_with(
            &only_set,
            "Box",
            "B",
            false,
            concat!(
                r##"<meta property="belongs-to-collection" id="set">Cosmere Box Set</meta>"##,
                r##"<meta refines="#set" property="collection-type">set</meta>"##,
            ),
        );
        assert_eq!(read_epub_metadata(&only_set).unwrap().series, None);
    }

    #[test]
    fn missing_cover_is_fine() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("book.epub");
        write_test_epub(&path, "Carmilla", "J. Sheridan Le Fanu", false);
        assert!(read_epub_metadata(&path).unwrap().cover.is_none());
    }

    #[test]
    fn not_a_zip_is_a_bad_book() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("broken.epub");
        std::fs::write(&path, b"not a zip").unwrap();
        assert!(matches!(read_epub_metadata(&path), Err(Error::BadBook(_))));
    }

    #[test]
    fn joins_relative_paths() {
        assert_eq!(
            join_archive_path("OEBPS/content.opf", "../images/c.jpg"),
            "images/c.jpg"
        );
        assert_eq!(
            join_archive_path("content.opf", "img/c%20d.jpg"),
            "img/c d.jpg"
        );
    }
}

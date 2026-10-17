//! PDFs. The title and author come from the document's information
//! dictionary; the cover, a picture of the first page, is drawn by the
//! reader's PDF engine (see `Library::fill_cover`).

use std::path::Path;

use crate::epub::{collapse_whitespace, BookMetadata};
use crate::error::{Error, Result};

pub(super) fn read(path: &Path) -> Result<BookMetadata> {
    let info = lopdf::Document::load_metadata(path).map_err(|e| Error::BadBook(e.to_string()))?;
    Ok(BookMetadata {
        title: info.title.as_deref().and_then(clean_title),
        authors: info
            .author
            .map(|a| a.split(';').map(collapse_whitespace).filter(|a| !a.is_empty()).collect())
            .unwrap_or_default(),
        synopsis: info.subject.map(|s| collapse_whitespace(&s)).filter(|s| !s.is_empty()),
        ..Default::default()
    })
}

/// Many PDFs carry the name of the file they were made from as their title
/// ("Microsoft Word - draft3.docx"), which is no better than the file name.
fn clean_title(raw: &str) -> Option<String> {
    let title = collapse_whitespace(raw);
    let title = title.strip_prefix("Microsoft Word - ").unwrap_or(&title).to_string();
    let lower = title.to_ascii_lowercase();
    let looks_like_file = [".doc", ".docx", ".pdf", ".odt", ".rtf", ".txt", ".indd", ".tex", ".dvi"]
        .iter()
        .any(|ext| lower.ends_with(ext));
    (!title.is_empty() && !looks_like_file && lower != "untitled").then_some(title)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_names_are_not_titles() {
        assert_eq!(clean_title("  The  Moonstone "), Some("The Moonstone".into()));
        assert_eq!(clean_title("Microsoft Word - draft3.docx"), None);
        assert_eq!(clean_title("Untitled"), None);
    }

    #[test]
    fn pdf_information_is_read() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("p.pdf");
        std::fs::write(&path, minimal_pdf()).unwrap();
        let m = read(&path).unwrap();
        assert_eq!(m.title.as_deref(), Some("Lamps at Dusk"));
        assert_eq!(m.authors, ["Wren Hale"]);
    }

    /// A one-page PDF with an information dictionary and a correct xref table.
    fn minimal_pdf() -> Vec<u8> {
        let objects = [
            "<< /Type /Catalog /Pages 2 0 R >>",
            "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>",
            "<< /Title (Lamps at Dusk) /Author (Wren Hale) >>",
        ];
        let mut out = b"%PDF-1.4\n".to_vec();
        let mut offsets = Vec::new();
        for (i, body) in objects.iter().enumerate() {
            offsets.push(out.len());
            out.extend(format!("{} 0 obj\n{body}\nendobj\n", i + 1).as_bytes());
        }
        let xref = out.len();
        out.extend(format!("xref\n0 {}\n0000000000 65535 f \n", objects.len() + 1).as_bytes());
        for o in offsets {
            out.extend(format!("{o:010} 00000 n \n").as_bytes());
        }
        out.extend(
            format!("trailer\n<< /Size {} /Root 1 0 R /Info 4 0 R >>\nstartxref\n{xref}\n%%EOF\n", objects.len() + 1)
                .as_bytes(),
        );
        out
    }
}

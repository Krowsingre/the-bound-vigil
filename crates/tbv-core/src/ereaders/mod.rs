//! Sending books to e-readers. A reader plugged in by cable shows up as a
//! drive; TBV recognises it by the folders it keeps there and copies the
//! book's file across. Kindles can also be sent books by email (see
//! `email`). The library's own copy of a book is only ever read.

pub mod email;

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::{params, OptionalExtension};
use serde::Serialize;

use crate::error::{Error, Result};
use crate::library::Library;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ReaderKind {
    Kindle,
    Kobo,
    PocketBook,
    Nook,
    Sony,
    /// A drive with a books folder that may or may not be a reader.
    Other,
}

/// A reader (or a drive that might be one) connected to this computer.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Ereader {
    pub kind: ReaderKind,
    /// "Kindle", or for a drive TBV isn't sure about, its name.
    pub name: String,
    /// Where the drive is, e.g. `E:\`. It also names the reader when sending.
    pub root: String,
    /// Where books go on it.
    pub books_folder: String,
    /// Formats it can open when copied by cable. Empty when TBV can't know.
    pub formats: Vec<String>,
}

impl ReaderKind {
    fn label(self) -> &'static str {
        match self {
            ReaderKind::Kindle => "Kindle",
            ReaderKind::Kobo => "Kobo",
            ReaderKind::PocketBook => "PocketBook",
            ReaderKind::Nook => "Nook",
            ReaderKind::Sony => "Sony Reader",
            ReaderKind::Other => "Drive",
        }
    }

    /// What each reader opens from its own storage. Kindles stopped taking
    /// EPUB by cable; Amazon converts EPUB only when it arrives by email.
    fn formats(self) -> &'static [&'static str] {
        match self {
            ReaderKind::Kindle => &["mobi", "azw", "azw3", "pdf", "txt"],
            ReaderKind::Kobo => &["epub", "pdf", "mobi", "txt", "cbz", "cbr"],
            ReaderKind::PocketBook => &["epub", "pdf", "mobi", "azw3", "fb2", "fbz", "txt", "doc", "docx", "cbz", "cbr"],
            ReaderKind::Nook => &["epub", "pdf"],
            ReaderKind::Sony => &["epub", "pdf", "txt"],
            ReaderKind::Other => &[],
        }
    }
}

/// The names in a folder, by their lower-case spelling, so `Documents` and
/// `documents` are found alike (reader drives differ, and so do computers).
fn entries(dir: &Path) -> HashMap<String, PathBuf> {
    let Ok(read) = fs::read_dir(dir) else { return HashMap::new() };
    read.flatten().map(|e| (e.file_name().to_string_lossy().to_lowercase(), e.path())).collect()
}

fn subfolder(dir: &Path, name: &str) -> Option<PathBuf> {
    entries(dir).remove(&name.to_lowercase()).filter(|p| p.is_dir())
}

/// What's plugged in at `root`, if it looks like a reader or holds a books
/// folder. `volume` is the drive's name, where the system tells it.
pub fn detect(root: &Path, volume: Option<&str>) -> Option<Ereader> {
    let top = entries(root);
    let dir = |name: &str| top.get(name).filter(|p| p.is_dir()).cloned();
    let volume = volume.unwrap_or_default().to_lowercase();
    let system = dir("system");
    let (kind, books) = if let (Some(documents), true) = (dir("documents"), system.is_some() || volume.contains("kindle")) {
        (ReaderKind::Kindle, documents)
    } else if dir(".kobo").is_some() {
        (ReaderKind::Kobo, root.to_path_buf())
    } else if volume.contains("pocketbook")
        || system.as_ref().is_some_and(|s| subfolder(s, "config").is_some() || subfolder(s, "explorer-3").is_some())
    {
        (ReaderKind::PocketBook, dir("books").unwrap_or_else(|| root.to_path_buf()))
    } else if let Some(files) = dir("my files").or_else(|| volume.contains("nook").then(|| root.to_path_buf())) {
        (ReaderKind::Nook, subfolder(&files, "books").unwrap_or(files))
    } else if dir("sony_reader").is_some() || dir("sony reader").is_some() || dir("database").is_some_and(|d| subfolder(&d, "media").is_some()) {
        let books = ["database/media/books", "sony_reader/media/books"]
            .iter()
            .find_map(|p| p.split('/').try_fold(root.to_path_buf(), |at, part| subfolder(&at, part)))
            .unwrap_or_else(|| root.to_path_buf());
        (ReaderKind::Sony, books)
    } else {
        // Anything else is offered only if it has a books folder.
        (ReaderKind::Other, ["ebooks", "books", "documents"].iter().find_map(|name| dir(name))?)
    };
    let name = match kind {
        ReaderKind::Other => drive_name(root),
        other => other.label().to_string(),
    };
    Some(Ereader {
        kind,
        name,
        root: root.display().to_string(),
        books_folder: books.display().to_string(),
        formats: kind.formats().iter().map(|f| f.to_string()).collect(),
    })
}

/// What's plugged in at `root`, by its folders and (outside Windows) the
/// name its folder carries.
pub fn at(root: &Path) -> Option<Ereader> {
    detect(root, root.file_name().and_then(|n| n.to_str()))
}

/// `E:\` stays `E:\`; `/media/me/SDCARD` becomes `SDCARD`.
fn drive_name(root: &Path) -> String {
    root.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| root.display().to_string())
}

/// Every reader plugged in now. Only drives are looked at, never the
/// computer's own disk, and nothing on them is changed.
pub fn connected() -> Vec<Ereader> {
    mounted().into_iter().filter_map(|(root, volume)| detect(&root, volume.as_deref())).collect()
}

/// The places drives appear, with their names where known.
#[cfg(windows)]
fn mounted() -> Vec<(PathBuf, Option<String>)> {
    // A and B were floppy drives; the system drive is the computer's own.
    let system = std::env::var("SystemDrive").unwrap_or_else(|_| "C:".into()).to_uppercase();
    ('C'..='Z')
        .filter(|d| !system.starts_with(*d))
        .map(|d| PathBuf::from(format!("{d}:\\")))
        .filter(|p| p.is_dir())
        .map(|p| (p, None))
        .collect()
}

#[cfg(not(windows))]
fn mounted() -> Vec<(PathBuf, Option<String>)> {
    let user = std::env::var("USER").unwrap_or_default();
    let bases = [PathBuf::from("/Volumes"), PathBuf::from("/media"), PathBuf::from("/media").join(&user), PathBuf::from("/run/media").join(&user)];
    mounted_under(&bases)
}

/// The drives inside these folders (one level down). On Linux and macOS a
/// drive's folder carries its name, which helps tell a Kindle apart.
#[cfg_attr(windows, allow(dead_code))]
fn mounted_under(bases: &[PathBuf]) -> Vec<(PathBuf, Option<String>)> {
    let mut found = Vec::new();
    for base in bases {
        let Ok(read) = fs::read_dir(base) else { continue };
        for entry in read.flatten() {
            // macOS lists its own disk in /Volumes as a link to `/`.
            let is_link = entry.file_type().is_ok_and(|t| t.is_symlink());
            let path = entry.path();
            if is_link || !path.is_dir() || bases.contains(&path) || found.iter().any(|(p, _)| p == &path) {
                continue;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            found.push((path, Some(name)));
        }
    }
    found
}

/// The format's name as people know it.
pub fn format_label(format: &str) -> String {
    format.to_uppercase()
}

/// Why this reader can't open this format by cable, or None when it can.
pub fn cannot_open(reader: &Ereader, format: &str) -> Option<String> {
    if reader.formats.is_empty() || reader.formats.iter().any(|f| f == format) {
        return None;
    }
    Some(match (reader.kind, format) {
        (ReaderKind::Kindle, "epub") => {
            "Kindles can't open EPUB books copied by cable. Send it by email instead: Amazon turns EPUB into a Kindle book for you.".into()
        }
        (ReaderKind::Kindle, "docx" | "doc") => {
            "Kindles can't open Word documents copied by cable. Send it by email instead: Amazon turns it into a Kindle book for you.".into()
        }
        _ => format!("{} can't open {} books.", reader.name, format_label(format)),
    })
}

/// A book ready to leave TBV: its file here, and a friendly name for the copy.
#[derive(Debug, Clone)]
pub struct Outgoing {
    pub title: String,
    pub path: PathBuf,
    pub format: String,
    /// "Title - Author.epub".
    pub file_name: String,
    pub size: u64,
}

/// What a copy did.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Copied {
    pub path: String,
    /// The same book was there already, so nothing was copied.
    pub already_there: bool,
}

/// A file name that every reader's drive accepts.
pub fn safe_file_name(title: &str, author: Option<&str>, format: &str) -> String {
    let mut stem = match author.filter(|a| !a.trim().is_empty()) {
        Some(author) => format!("{} - {}", title.trim(), author.trim()),
        None => title.trim().to_string(),
    };
    stem = stem.chars().map(|c| if "\\/:*?\"<>|".contains(c) || c.is_control() { '_' } else { c }).collect();
    let stem: String = stem.trim_end_matches(['.', ' ']).chars().take(120).collect();
    let stem = if stem.trim().is_empty() { "Book".to_string() } else { stem };
    format!("{stem}.{format}")
}

/// Copies a book onto a reader. A file of the same name and size is taken
/// to be this book already; a different file keeps its name and the copy
/// gets a number. The copy is written under a temporary name first, so a
/// reader unplugged halfway never shows a broken book.
pub fn copy_to(reader: &Ereader, book: &Outgoing) -> Result<Copied> {
    if let Some(reason) = cannot_open(reader, &book.format) {
        return Err(Error::Unsuitable(reason));
    }
    let folder = PathBuf::from(&reader.books_folder);
    if !Path::new(&reader.root).is_dir() {
        return Err(Error::Unsuitable(format!("{} isn't connected any more. Plug it in again and try once more.", reader.name)));
    }
    copy_into(book, &folder, &reader.name)
}

/// Saves a copy of a book, named "Title - Author", into a folder of your
/// choosing, to share or keep. The library's own copy is only read.
pub fn save_copy(book: &Outgoing, folder: &Path) -> Result<Copied> {
    if !folder.is_dir() {
        return Err(Error::Unsuitable(format!("The folder {} can't be found.", folder.display())));
    }
    copy_into(book, folder, &folder.display().to_string())
}

/// Copies beside the target and renames, never replacing a different file
/// of the same name. One of the same size is taken to be this book already.
fn copy_into(book: &Outgoing, folder: &Path, place: &str) -> Result<Copied> {
    fs::create_dir_all(folder)?;
    let (stem, ext) = book.file_name.rsplit_once('.').unwrap_or((&book.file_name, &book.format));
    let mut target = folder.join(&book.file_name);
    let mut n = 2;
    while let Ok(there) = fs::metadata(&target) {
        if there.len() == book.size {
            return Ok(Copied { path: target.display().to_string(), already_there: true });
        }
        target = folder.join(format!("{stem} ({n}).{ext}"));
        n += 1;
    }
    let partial = folder.join(format!(".{}.tbv-partial", book.file_name));
    let copied = fs::copy(&book.path, &partial).and_then(|_| fs::rename(&partial, &target));
    if let Err(e) = copied {
        let _ = fs::remove_file(&partial);
        return Err(match e.kind() {
            std::io::ErrorKind::StorageFull => Error::Unsuitable(format!("{place} is full. Make some room on it and try again.")),
            _ => Error::Unsuitable(format!("The book couldn't be copied to {place}: {e}")),
        });
    }
    Ok(Copied { path: target.display().to_string(), already_there: false })
}

impl Library {
    /// What sending a book needs, read in one go so the library is free
    /// again before any copying or sending starts.
    pub fn outgoing_book(&self, book_id: &str) -> Result<Outgoing> {
        let format: Option<String> = self
            .conn
            .query_row("SELECT format FROM books WHERE id = ?1 AND deleted_at IS NULL", params![book_id], |r| r.get(0))
            .optional()?;
        let format = format.ok_or_else(|| Error::Unsuitable("This book is no longer in your library.".into()))?.to_lowercase();
        let facts = self.book_facts(book_id)?.ok_or_else(|| Error::Unsuitable("This book is no longer in your library.".into()))?;
        let path = self.book_file(book_id)?;
        let size = fs::metadata(&path)?.len();
        Ok(Outgoing {
            file_name: safe_file_name(&facts.title, facts.authors.first().map(String::as_str), &format),
            title: facts.title,
            path,
            format,
            size,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn drive(folders: &[&str]) -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        for f in folders {
            fs::create_dir_all(dir.path().join(f)).unwrap();
        }
        dir
    }

    fn kind(folders: &[&str], volume: Option<&str>) -> Option<ReaderKind> {
        let d = drive(folders);
        detect(d.path(), volume).map(|r| r.kind)
    }

    #[test]
    fn recognises_each_reader_by_its_folders() {
        assert_eq!(kind(&["documents", "system"], None), Some(ReaderKind::Kindle));
        assert_eq!(kind(&["documents"], Some("Kindle")), Some(ReaderKind::Kindle));
        assert_eq!(kind(&[".kobo", "Digital Editions"], None), Some(ReaderKind::Kobo));
        assert_eq!(kind(&["system/config", "Books"], None), Some(ReaderKind::PocketBook));
        assert_eq!(kind(&["My Files/Books"], None), Some(ReaderKind::Nook));
        assert_eq!(kind(&["Sony_Reader"], None), Some(ReaderKind::Sony));
        assert_eq!(kind(&["database/media/books"], None), Some(ReaderKind::Sony));
        // A drive with only a books folder could be anything; it's offered, not named.
        assert_eq!(kind(&["eBooks"], None), Some(ReaderKind::Other));
        assert_eq!(kind(&["documents"], None), Some(ReaderKind::Other));
        assert_eq!(kind(&["Photos", "Music"], None), None);
        assert_eq!(kind(&[], None), None);
    }

    #[test]
    fn finds_folders_whatever_their_case() {
        let d = drive(&["Documents", "System"]);
        let kindle = detect(d.path(), None).unwrap();
        assert_eq!(kindle.kind, ReaderKind::Kindle);
        assert_eq!(kindle.name, "Kindle");
        assert_eq!(Path::new(&kindle.books_folder), d.path().join("Documents"));
    }

    #[test]
    fn each_reader_has_its_books_folder() {
        let d = drive(&["My Files/Books"]);
        assert_eq!(Path::new(&detect(d.path(), None).unwrap().books_folder), d.path().join("My Files").join("Books"));
        let d = drive(&[".kobo"]);
        assert_eq!(Path::new(&detect(d.path(), None).unwrap().books_folder), d.path());
        let d = drive(&["database/media/books"]);
        let sony = detect(d.path(), None).unwrap();
        assert_eq!(Path::new(&sony.books_folder), d.path().join("database").join("media").join("books"));
        let d = drive(&["eBooks"]);
        let other = detect(d.path(), None).unwrap();
        assert!(other.formats.is_empty());
        assert_eq!(other.name, d.path().file_name().unwrap().to_string_lossy());
    }

    #[test]
    fn looks_one_level_inside_the_places_drives_appear() {
        let media = drive(&["KINDLE/documents", "KINDLE/system", "SDCARD/Books", "EMPTY"]);
        let mut found: Vec<_> = mounted_under(&[media.path().to_path_buf()])
            .into_iter()
            .filter_map(|(root, volume)| detect(&root, volume.as_deref()))
            .map(|r| (r.name, r.kind))
            .collect();
        found.sort_by(|a, b| a.0.cmp(&b.0));
        assert_eq!(found, vec![("Kindle".to_string(), ReaderKind::Kindle), ("SDCARD".to_string(), ReaderKind::Other)]);
        assert!(mounted_under(&[media.path().join("missing")]).is_empty());
    }

    #[test]
    fn says_plainly_when_a_reader_cant_open_a_format() {
        let d = drive(&["documents", "system"]);
        let kindle = detect(d.path(), None).unwrap();
        assert!(cannot_open(&kindle, "epub").unwrap().contains("by email"));
        assert!(cannot_open(&kindle, "azw3").is_none());
        let d = drive(&["My Files"]);
        let nook = detect(d.path(), None).unwrap();
        assert_eq!(cannot_open(&nook, "mobi").as_deref(), Some("Nook can't open MOBI books."));
        let d = drive(&["Books"]);
        assert!(cannot_open(&detect(d.path(), None).unwrap(), "fb2").is_none());
    }

    #[test]
    fn names_copies_safely() {
        assert_eq!(safe_file_name("Carmilla", Some("J. Sheridan Le Fanu"), "epub"), "Carmilla - J. Sheridan Le Fanu.epub");
        assert_eq!(safe_file_name("What? A/B: \"C\"", None, "pdf"), "What_ A_B_ _C_.pdf");
        assert_eq!(safe_file_name("  ", Some(""), "txt"), "Book.txt");
        assert_eq!(safe_file_name("Ends with dots...", None, "txt"), "Ends with dots.txt");
    }

    fn outgoing(dir: &Path, name: &str, body: &[u8], format: &str) -> Outgoing {
        let path = dir.join(format!("source.{format}"));
        fs::write(&path, body).unwrap();
        Outgoing { title: "T".into(), path, format: format.into(), file_name: name.into(), size: body.len() as u64 }
    }

    #[test]
    fn copies_without_touching_the_library_copy() {
        let library = tempfile::tempdir().unwrap();
        let book = outgoing(library.path(), "Carmilla - Le Fanu.azw3", b"kindle book", "azw3");
        let d = drive(&["documents", "system"]);
        let kindle = detect(d.path(), None).unwrap();

        let first = copy_to(&kindle, &book).unwrap();
        assert!(!first.already_there);
        assert_eq!(Path::new(&first.path), d.path().join("documents").join("Carmilla - Le Fanu.azw3"));
        assert_eq!(fs::read(&first.path).unwrap(), b"kindle book");
        assert_eq!(fs::read(&book.path).unwrap(), b"kindle book");
        // No temporary file is left behind.
        assert_eq!(fs::read_dir(d.path().join("documents")).unwrap().count(), 1);

        // The same book again is left as it is.
        assert!(copy_to(&kindle, &book).unwrap().already_there);

        // A different file of that name keeps its place; the copy is numbered.
        let other = outgoing(library.path(), "Carmilla - Le Fanu.azw3", b"a longer, different book", "azw3");
        let second = copy_to(&kindle, &other).unwrap();
        assert!(second.path.ends_with("Carmilla - Le Fanu (2).azw3"));
        assert_eq!(fs::read(d.path().join("documents").join("Carmilla - Le Fanu.azw3")).unwrap(), b"kindle book");
    }

    #[test]
    fn refuses_formats_the_reader_cant_open_and_readers_that_left() {
        let library = tempfile::tempdir().unwrap();
        let epub = outgoing(library.path(), "Book.epub", b"epub", "epub");
        let d = drive(&["documents", "system"]);
        let kindle = detect(d.path(), None).unwrap();
        assert!(matches!(copy_to(&kindle, &epub), Err(Error::Unsuitable(m)) if m.contains("EPUB")));
        assert_eq!(fs::read_dir(d.path().join("documents")).unwrap().count(), 0);

        let kobo_drive = drive(&[".kobo"]);
        let kobo = detect(kobo_drive.path(), None).unwrap();
        drop(kobo_drive);
        assert!(matches!(copy_to(&kobo, &epub), Err(Error::Unsuitable(m)) if m.contains("isn't connected")));
    }

    #[test]
    fn reads_what_sending_needs_from_the_library() {
        use crate::epub::tests::write_test_epub;
        use crate::model::ImportResult;
        let (dir, mut library) = crate::library::tests::open_temp_library();
        let source = dir.path().join("in.epub");
        write_test_epub(&source, "Uncle Silas", "Le Fanu", false);
        let ImportResult::Imported { book_id, .. } = &library.import_files(&[source])[0] else { panic!() };
        let book = library.outgoing_book(book_id).unwrap();
        assert_eq!(book.file_name, "Uncle Silas - Le Fanu.epub");
        assert_eq!(book.format, "epub");
        assert_eq!(book.size, fs::metadata(&book.path).unwrap().len());
        assert!(matches!(library.outgoing_book("sha256:nope"), Err(Error::Unsuitable(_))));
    }
}

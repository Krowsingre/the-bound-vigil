//! What a sync place holds, file by file and by type, for Attune › Sync ›
//! What's in Supabase: each file says which book it belongs to and whether
//! a copy is kept anywhere else, and any of them can be removed.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use serde::Serialize;

use super::Remote;
use crate::error::{Error, Result};
use crate::home::DOCUMENT_FORMATS;
use crate::library::Library;

/// The folders TBV keeps files in.
const FOLDERS: &[&str] = &["books", "audio", "covers", "pictures"];

/// One file in the place.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredFile {
    /// Like `books/<hash>.epub`.
    pub path: String,
    /// `ebook`, `document`, `audiobook`, `cover`, `picture` or `other`.
    pub kind: &'static str,
    /// The book it belongs to, if it's one in the library.
    pub book_id: Option<String>,
    pub title: Option<String>,
    pub bytes: Option<u64>,
    /// Whether this computer or the other sync place keeps a copy, so
    /// removing it here loses nothing.
    pub elsewhere: bool,
}

/// How removing went.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoveReport {
    pub removed: u32,
    pub failed: u32,
    pub stopped: bool,
}

struct Known {
    title: String,
    format: String,
    file_here: bool,
    cover_here: bool,
}

fn lock(library: &Mutex<Library>) -> Result<std::sync::MutexGuard<'_, Library>> {
    library.lock().map_err(|_| Error::Unsuitable("the library is unavailable".into()))
}

/// The book a file in the cloud is for: the start of its hash, so names
/// from before 0.107 (the whole hash) and covers' whole-hash names match.
fn hex_of(name: &str) -> &str {
    crate::ids::book_key(name.split('.').next().unwrap_or_default())
}

impl Library {
    /// Each book by its hash, with whether this computer has its file and cover.
    fn known_books(&self) -> Result<HashMap<String, (String, Known)>> {
        let rows = self
            .conn
            .prepare(
                "SELECT b.id, b.title, b.format, lf.path, lf.cover_path FROM books b LEFT JOIN local_files lf ON lf.book_id = b.id
                 WHERE b.deleted_at IS NULL",
            )?
            .query_map([], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, Option<String>>(3)?, r.get::<_, Option<String>>(4)?))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let exists = |p: &Option<String>| p.as_deref().is_some_and(|p| Path::new(p).exists());
        Ok(rows
            .into_iter()
            .map(|(id, title, format, path, cover)| {
                let known = Known { title, format, file_here: exists(&path), cover_here: exists(&cover) };
                (crate::ids::cloud_name(&id).to_string(), (id, known))
            })
            .collect())
    }
}

/// Everything TBV keeps in `place`. `other` is the second sync place, if
/// there is one. The library is only locked while it's read.
pub fn list_contents(library: &Mutex<Library>, place: &mut dyn Remote, mut other: Option<&mut dyn Remote>) -> Result<Vec<StoredFile>> {
    let (books, pictures_dir, profile_dir) = {
        let l = lock(library)?;
        (l.known_books()?, l.paths.pictures_dir.clone(), l.paths.profile_dir.clone())
    };
    let mut out = Vec::new();
    for folder in FOLDERS {
        let listed = place.list_sizes(&format!("{folder}/"))?;
        if listed.is_empty() {
            continue;
        }
        let there: HashSet<String> = match other.as_deref_mut() {
            Some(other) => other.list(&format!("{folder}/"))?.into_iter().collect(),
            None => HashSet::new(),
        };
        let there_hex: HashSet<&str> = there.iter().map(|n| hex_of(n)).collect();
        for (name, bytes) in listed {
            if name.starts_with('.') || name.ends_with('/') || name.is_empty() {
                continue;
            }
            let book = books.get(hex_of(&name));
            let kind = match (*folder, book) {
                ("covers", _) => "cover",
                ("pictures", _) => "picture",
                ("audio", _) => "audiobook",
                (_, Some((_, b))) if crate::audio::is_audio(&b.format) => "audiobook",
                (_, Some((_, b))) if DOCUMENT_FORMATS.contains(&b.format.as_str()) => "document",
                (_, Some(_)) => "ebook",
                (_, None) => kind_of_name(&name),
            };
            let here = match (kind, book) {
                ("picture", _) => pictures_dir.join(&name).exists() || profile_dir.join(&name).exists(),
                ("cover", Some((_, b))) => b.cover_here,
                (_, Some((_, b))) => b.file_here,
                _ => false,
            };
            let elsewhere = here || if kind == "picture" { there.contains(&name) } else { there_hex.contains(hex_of(&name)) };
            out.push(StoredFile {
                path: format!("{folder}/{name}"),
                kind,
                book_id: book.map(|(id, _)| id.clone()),
                title: book.map(|(_, b)| b.title.clone()),
                bytes,
                elsewhere,
            });
        }
    }
    out.sort_by(|a, b| a.kind.cmp(b.kind).then_with(|| a.title.cmp(&b.title)).then_with(|| a.path.cmp(&b.path)));
    Ok(out)
}

/// Removes `paths` from `place`. This computer still counts them as sent,
/// so sync doesn't put them back.
pub fn remove_contents(place: &mut dyn Remote, paths: &[String], cancel: &AtomicBool, progress: &mut dyn FnMut(u32, u32)) -> Result<RemoveReport> {
    let mut report = RemoveReport::default();
    let total = paths.len() as u32;
    for (done, path) in paths.iter().enumerate() {
        if cancel.load(Ordering::Relaxed) {
            report.stopped = true;
            break;
        }
        progress(done as u32, total);
        // Only TBV's own files, never anything else in the bucket.
        let folder = path.split('/').next().unwrap_or_default();
        if !FOLDERS.contains(&folder) || path.contains("..") {
            report.failed += 1;
            continue;
        }
        match place.remove(path) {
            Ok(()) => report.removed += 1,
            Err(Error::Offline(e)) => return Err(Error::Offline(e)),
            Err(_) => report.failed += 1,
        }
    }
    progress(total, total);
    Ok(report)
}

/// What a file is by its name alone: `ebook`, `document`, `audiobook` or `other`.
fn kind_of_name(name: &str) -> &'static str {
    let extension = Path::new(name).extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    if crate::audio::is_audio(&extension) {
        "audiobook"
    } else if DOCUMENT_FORMATS.contains(&extension.as_str()) {
        "document"
    } else if ["epub", "mobi", "azw", "azw3", "fb2", "cbz", "cbr", "kepub"].contains(&extension.as_str()) {
        "ebook"
    } else {
        "other"
    }
}

/// How much room TBV's content takes, by type (Attunement › Storage & Backup, embre 28 November).
/// Covers, pictures, the library's own data and anything else are Other.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Space {
    pub ebooks: u64,
    pub documents: u64,
    pub audiobooks: u64,
    pub other: u64,
}

impl Space {
    fn add(&mut self, kind: &str, bytes: u64) {
        match kind {
            "ebook" => self.ebooks += bytes,
            "document" => self.documents += bytes,
            "audiobook" => self.audiobooks += bytes,
            _ => self.other += bytes,
        }
    }

    /// A sync place's files, added up by type.
    pub fn of(files: &[StoredFile]) -> Space {
        let mut space = Space::default();
        for file in files {
            space.add(file.kind, file.bytes.unwrap_or(0));
        }
        space
    }
}

/// Adds up the files under `dir` by type.
fn add_folder(space: &mut Space, dir: &Path) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(kind) = entry.file_type() else { continue };
        if kind.is_symlink() {
            continue;
        }
        if kind.is_dir() {
            add_folder(space, &path);
        } else if let Ok(meta) = entry.metadata() {
            space.add(kind_of_name(&entry.file_name().to_string_lossy()), meta.len());
        }
    }
}

impl Library {
    /// What TBV keeps on this device, by type (see `space_in`).
    pub fn space_here(&self) -> Space {
        space_in(&self.paths)
    }
}

/// What TBV keeps on this device, by type: its book files and everything
/// else in its own folders (the library, covers, pictures). Each folder is
/// counted once, even when one sits inside another. Needs no lock on the library.
pub fn space_in(paths: &crate::library::LibraryPaths) -> Space {
    let mut roots: Vec<PathBuf> = [paths.database.parent().map(Path::to_path_buf), Some(paths.books_dir.clone()), Some(paths.covers_dir.clone()), Some(paths.profile_dir.clone()), Some(paths.pictures_dir.clone())]
        .into_iter()
        .flatten()
        .filter_map(|p| p.canonicalize().ok())
        .collect();
    roots.sort();
    roots.dedup();
    let kept: Vec<&PathBuf> = roots.iter().filter(|r| !roots.iter().any(|o| o != *r && r.starts_with(o))).collect();
    let mut space = Space::default();
    for root in kept {
        add_folder(&mut space, root);
    }
    space
}

#[cfg(test)]
mod space_tests {
    use super::*;

    #[test]
    fn files_are_counted_by_type() {
        let mut space = Space::default();
        for (name, bytes) in [("a.epub", 10), ("b.PDF", 20), ("c.m4b", 30), ("d.jpg", 4), ("library.sqlite", 6)] {
            space.add(kind_of_name(name), bytes);
        }
        assert_eq!(space, Space { ebooks: 10, documents: 20, audiobooks: 30, other: 10 });
    }

    #[test]
    fn a_folder_inside_another_is_counted_once() {
        let dir = tempfile::tempdir().unwrap();
        let books = dir.path().join("books");
        std::fs::create_dir_all(&books).unwrap();
        std::fs::write(books.join("x.epub"), [0u8; 100]).unwrap();
        std::fs::write(dir.path().join("notes.json"), [0u8; 7]).unwrap();
        let paths = crate::library::LibraryPaths {
            database: dir.path().join("library.sqlite"),
            books_dir: books.clone(),
            covers_dir: dir.path().join("covers"),
            profile_dir: dir.path().join("profile"),
            pictures_dir: dir.path().join("pictures"),
        };
        let library = Library::open(paths).unwrap();
        let space = library.space_here();
        assert_eq!(space.ebooks, 100);
        assert!(space.other >= 7, "the library's own files are Other");
    }
}

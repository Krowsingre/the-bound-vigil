//! Audiobooks: reading their details, chapters and lengths, and keeping a
//! folder of audio files (one file per chapter or per CD) as one book.
//!
//! A folder becomes a bundle: an uncompressed ZIP of its audio files in
//! name order, written the same way every time, so the same folder always
//! gives the same book id. Uncompressed means each file sits whole inside the
//! bundle, so the player streams straight from it. A single file (an M4B,
//! one long MP3) is kept as it is.

use std::fs::{self, File};
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::epub::{BookMetadata, Cover};
use crate::error::{Error, Result};

/// The format of a folder of audio files kept as one book.
pub const BUNDLE: &str = "tbvaudio";

/// Audio formats TBV imports as audiobooks.
pub const AUDIO_FORMATS: &[&str] = &["m4b", "m4a", "mp3", "aac", "ogg", "oga", "opus", "flac", BUNDLE];

/// Formats that can be parts of a folder audiobook.
const PART_FORMATS: &[&str] = &["m4b", "m4a", "mp3", "aac", "ogg", "oga", "opus", "flac"];

/// Pictures a folder audiobook may keep its cover in.
const COVER_NAMES: &[&str] = &["cover", "folder", "front", "album", "artwork"];

pub fn is_audio(format: &str) -> bool {
    AUDIO_FORMATS.contains(&format)
}

pub(crate) fn is_part(path: &Path) -> bool {
    extension(path).is_some_and(|e| PART_FORMATS.contains(&e.as_str()))
}

fn extension(path: &Path) -> Option<String> {
    path.extension().map(|e| e.to_string_lossy().to_ascii_lowercase())
}

/// A chapter, by where it starts in the whole book.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Chapter {
    pub title: String,
    pub start_ms: u64,
}

/// One audio file of a book, by where it starts in the whole book.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Part {
    pub name: String,
    pub start_ms: u64,
    pub duration_ms: u64,
}

/// What an audiobook's files say beyond the usual book details.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct AudioDetails {
    pub narrators: Vec<String>,
    pub duration_ms: u64,
    pub chapters: Vec<Chapter>,
    pub parts: Vec<Part>,
}

/// One file's tags and length.
#[derive(Debug, Default)]
struct PartInfo {
    title: Option<String>,
    album: Option<String>,
    artists: Vec<String>,
    narrators: Vec<String>,
    genres: Vec<String>,
    published: Option<String>,
    synopsis: Option<String>,
    publisher: Option<String>,
    duration_ms: u64,
    /// Chapters inside this file, from its start.
    chapters: Vec<Chapter>,
    cover: Option<Cover>,
}

/// A stretch of a file, read as if it were a file of its own: one part of a bundle.
pub struct Slice {
    file: File,
    start: u64,
    len: u64,
    pos: u64,
}

impl Slice {
    pub fn new(mut file: File, start: u64, len: u64) -> io::Result<Self> {
        file.seek(SeekFrom::Start(start))?;
        Ok(Self { file, start, len, pos: 0 })
    }

    pub fn len(&self) -> u64 {
        self.len
    }

    pub fn is_empty(&self) -> bool {
        self.len == 0
    }
}

impl Read for Slice {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let left = self.len.saturating_sub(self.pos);
        let take = buf.len().min(left as usize);
        if take == 0 {
            return Ok(0);
        }
        let read = self.file.read(&mut buf[..take])?;
        self.pos += read as u64;
        Ok(read)
    }
}

impl Seek for Slice {
    fn seek(&mut self, to: SeekFrom) -> io::Result<u64> {
        let target = match to {
            SeekFrom::Start(n) => n as i64,
            SeekFrom::End(n) => self.len as i64 + n,
            SeekFrom::Current(n) => self.pos as i64 + n,
        };
        if target < 0 {
            return Err(io::Error::new(io::ErrorKind::InvalidInput, "seek before the start"));
        }
        self.pos = target as u64;
        self.file.seek(SeekFrom::Start(self.start + self.pos.min(self.len)))?;
        Ok(self.pos)
    }
}

/// A part's place inside a bundle.
#[derive(Debug, Clone, PartialEq)]
pub struct Entry {
    pub name: String,
    pub start: u64,
    pub len: u64,
}

/// The parts of a bundle, in playing order.
pub fn bundle_entries(path: &Path) -> Result<Vec<Entry>> {
    bundle_entries_in(File::open(path)?)
}

/// As `bundle_entries`, for a bundle read some other way (from the cloud, say).
pub fn bundle_entries_in<R: Read + Seek>(reader: R) -> Result<Vec<Entry>> {
    let mut archive = zip::ZipArchive::new(reader).map_err(|e| Error::Unsuitable(format!("this audiobook couldn't be read: {e}")))?;
    let mut entries = Vec::new();
    for i in 0..archive.len() {
        let file = archive.by_index_raw(i).map_err(|e| Error::Unsuitable(format!("this audiobook couldn't be read: {e}")))?;
        if file.is_dir() {
            continue;
        }
        if file.compression() != zip::CompressionMethod::Stored {
            return Err(Error::Unsuitable("this audiobook's files are compressed, so they can't be played".into()));
        }
        entries.push(Entry { name: file.name().to_string(), start: file.data_start(), len: file.size() });
    }
    Ok(entries)
}

/// One part of a book as a readable file: the file itself, or a stretch of a bundle.
pub fn open_part(path: &Path, format: &str, index: usize) -> Result<(Slice, String)> {
    if format == BUNDLE {
        let entry = bundle_entries(path)?
            .into_iter()
            .nth(index)
            .ok_or_else(|| Error::Unsuitable("that part of the audiobook isn't there".into()))?;
        let ext = extension(Path::new(&entry.name)).unwrap_or_default();
        return Ok((Slice::new(File::open(path)?, entry.start, entry.len)?, ext));
    }
    if index != 0 {
        return Err(Error::Unsuitable("that part of the audiobook isn't there".into()));
    }
    let len = fs::metadata(path)?.len();
    Ok((Slice::new(File::open(path)?, 0, len)?, format.to_string()))
}

/// A file read in pieces through `fetch(start, end)`, which gives the
/// bytes from `start` to `end` inclusive. The last few pieces are kept, so
/// reading a ZIP's index costs only a request or two.
pub struct Ranged<F: FnMut(u64, u64) -> io::Result<Vec<u8>>> {
    fetch: F,
    len: u64,
    pos: u64,
    blocks: Vec<(u64, Vec<u8>)>,
}

const BLOCK: u64 = 256 * 1024;

impl<F: FnMut(u64, u64) -> io::Result<Vec<u8>>> Ranged<F> {
    pub fn new(len: u64, fetch: F) -> Self {
        Self { fetch, len, pos: 0, blocks: Vec::new() }
    }

    fn block(&mut self, index: u64) -> io::Result<&[u8]> {
        if let Some(at) = self.blocks.iter().position(|(i, _)| *i == index) {
            let kept = self.blocks.remove(at);
            self.blocks.push(kept);
        } else {
            let start = index * BLOCK;
            let bytes = (self.fetch)(start, (start + BLOCK).min(self.len) - 1)?;
            if self.blocks.len() >= 8 {
                self.blocks.remove(0);
            }
            self.blocks.push((index, bytes));
        }
        Ok(self.blocks.last().map(|(_, b)| b.as_slice()).unwrap_or_default())
    }
}

impl<F: FnMut(u64, u64) -> io::Result<Vec<u8>>> Read for Ranged<F> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        if self.pos >= self.len || buf.is_empty() {
            return Ok(0);
        }
        let (index, within) = (self.pos / BLOCK, (self.pos % BLOCK) as usize);
        let block = self.block(index)?;
        let n = block.len().saturating_sub(within).min(buf.len());
        if n == 0 {
            return Err(io::Error::new(io::ErrorKind::UnexpectedEof, "the cloud sent less than the file holds"));
        }
        buf[..n].copy_from_slice(&block[within..within + n]);
        self.pos += n as u64;
        Ok(n)
    }
}

impl<F: FnMut(u64, u64) -> io::Result<Vec<u8>>> Seek for Ranged<F> {
    fn seek(&mut self, to: SeekFrom) -> io::Result<u64> {
        let next = match to {
            SeekFrom::Start(n) => n as i128,
            SeekFrom::End(n) => self.len as i128 + n as i128,
            SeekFrom::Current(n) => self.pos as i128 + n as i128,
        };
        if next < 0 {
            return Err(io::Error::new(io::ErrorKind::InvalidInput, "before the start of the file"));
        }
        self.pos = next as u64;
        Ok(self.pos)
    }
}

/// An audiobook played straight from the cloud, without downloading it:
/// each part is a stretch of the cloud file, fetched a piece at a time as
/// the player asks.
pub struct Stream {
    cloud: crate::sync::Cloud,
    path: String,
    len: u64,
    /// Each part's (start, length, extension) in the cloud file.
    parts: Vec<(u64, u64, String)>,
}

impl Stream {
    /// None if this place doesn't have the book's file.
    pub fn open(mut cloud: crate::sync::Cloud, path: &str, format: &str) -> Result<Option<Self>> {
        let Some((_, len)) = cloud.read_range(path, 0, 0)? else { return Ok(None) };
        let parts = if format == BUNDLE {
            let reader = Ranged::new(len, |start, end| {
                cloud
                    .read_range(path, start, end)
                    .map_err(|e| io::Error::other(e.to_string()))?
                    .map(|(bytes, _)| bytes)
                    .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "the file left the cloud"))
            });
            bundle_entries_in(reader)?
                .into_iter()
                .map(|e| (e.start, e.len, extension(Path::new(&e.name)).unwrap_or_default()))
                .collect()
        } else {
            vec![(0, len, format.to_string())]
        };
        Ok(Some(Self { cloud, path: path.to_string(), len, parts }))
    }

    /// A part's length and extension.
    pub fn part(&self, index: usize) -> Option<(u64, &str)> {
        self.parts.get(index).map(|(_, len, ext)| (*len, ext.as_str()))
    }

    /// Bytes `start..=end` of one part.
    pub fn read(&mut self, index: usize, start: u64, end: u64) -> Result<Vec<u8>> {
        let (offset, len, _) = self.parts.get(index).cloned().ok_or_else(|| Error::Unsuitable("that part of the audiobook isn't there".into()))?;
        if len == 0 || start >= len {
            return Ok(Vec::new());
        }
        let (from, to) = (offset + start, (offset + end.min(len - 1)).min(self.len.saturating_sub(1)));
        let (bytes, _) = self.cloud.read_range(&self.path, from, to)?.ok_or_else(|| Error::Unsuitable("the audiobook is no longer in the cloud".into()))?;
        Ok(bytes)
    }

    /// The connection, to save a renewed sign-in from.
    pub fn cloud(&self) -> &crate::sync::Cloud {
        &self.cloud
    }
}

/// The MIME type to play a part with.
pub fn mime_of(ext: &str) -> &'static str {
    match ext {
        "mp3" => "audio/mpeg",
        "m4a" | "m4b" => "audio/mp4",
        "aac" => "audio/aac",
        "ogg" | "oga" => "audio/ogg",
        "opus" => "audio/ogg; codecs=opus",
        "flac" => "audio/flac",
        _ => "application/octet-stream",
    }
}

/// The audio files directly in `dir`, in the order they play.
pub fn folder_parts(dir: &Path) -> Vec<PathBuf> {
    let mut parts: Vec<PathBuf> = fs::read_dir(dir)
        .map(|entries| {
            entries
                .flatten()
                .filter(|e| e.file_type().is_ok_and(|t| t.is_file()) && !e.file_name().to_string_lossy().starts_with('.'))
                .map(|e| e.path())
                .filter(|p| is_part(p))
                .collect()
        })
        .unwrap_or_default();
    parts.sort_by(|a, b| natural_cmp(&a.file_name().unwrap_or_default().to_string_lossy(), &b.file_name().unwrap_or_default().to_string_lossy()));
    parts
}

/// Compares names the way people number things: "Part 2" before "Part 10".
fn natural_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    // Names that read the same ("Part 2", "part 02") still need one order,
    // so the same folder always makes the same bundle.
    natural_key_cmp(a, b).then_with(|| a.cmp(b))
}

fn natural_key_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    let chunks = |s: &str| -> Vec<(bool, String)> {
        let mut out: Vec<(bool, String)> = Vec::new();
        for c in s.to_lowercase().chars() {
            let digit = c.is_ascii_digit();
            match out.last_mut() {
                Some((d, text)) if *d == digit => text.push(c),
                _ => out.push((digit, c.to_string())),
            }
        }
        out
    };
    let (a, b) = (chunks(a), chunks(b));
    for (x, y) in a.iter().zip(b.iter()) {
        let order = match (x.0, y.0) {
            (true, true) => {
                let (xn, yn) = (x.1.trim_start_matches('0'), y.1.trim_start_matches('0'));
                xn.len().cmp(&yn.len()).then_with(|| xn.cmp(yn))
            }
            _ => x.1.cmp(&y.1),
        };
        if order.is_ne() {
            return order;
        }
    }
    a.len().cmp(&b.len())
}

/// Marks a path that stands for some of a folder's audio files: one of
/// several audiobooks kept in the same folder. No real file name starts so.
const GROUP: &str = "\u{1}audiobook ";

/// The path standing for one audiobook among several in `dir`.
pub fn group_path(dir: &Path, name: &str) -> PathBuf {
    dir.join(format!("{GROUP}{name}"))
}

/// The folder and audiobook a `group_path` stands for.
pub fn parse_group(path: &Path) -> Option<(PathBuf, String)> {
    let name = path.file_name()?.to_str()?.strip_prefix(GROUP)?;
    Some((path.parent()?.to_path_buf(), name.to_string()))
}

/// What a path shows as on the Imports page: a group by its audiobook's name.
pub fn display_name(path: &Path) -> String {
    match parse_group(path) {
        Some((_, name)) => name,
        None => path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
    }
}

/// The audiobooks among a folder's audio files, each named and in play order.
/// One folder can hold one book in many parts (the usual case) or several
/// books. They're told apart by their album tags; failing those, files that
/// are whole books by themselves (M4B and M4A files, or files with their own
/// chapters) are each a book. Anything else stays one book, as before.
pub fn folder_books(dir: &Path) -> Vec<(String, Vec<PathBuf>)> {
    let parts = folder_parts(dir);
    let stem = |p: &Path| p.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let folder_name = || dir.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "Audiobook".into());
    if parts.len() < 2 {
        return if parts.is_empty() { Vec::new() } else { vec![(folder_name(), parts)] };
    }
    let infos: Vec<(Option<String>, bool)> = parts
        .iter()
        .map(|p| {
            let ext = extension(p).unwrap_or_default();
            let Ok(len) = fs::metadata(p).map(|m| m.len()) else { return (None, false) };
            let Ok(mut slice) = File::open(p).and_then(|f| Slice::new(f, 0, len)) else { return (None, false) };
            let info = read_part(&mut slice, &ext);
            let whole = matches!(ext.as_str(), "m4b" | "m4a") || info.chapters.len() > 1;
            (info.album, whole)
        })
        .collect();
    let mut albums: Vec<String> = Vec::new();
    for album in infos.iter().filter_map(|(a, _)| a.as_ref()) {
        if !albums.iter().any(|seen| seen.eq_ignore_ascii_case(album)) {
            albums.push(album.clone());
        }
    }
    let mut books: Vec<(String, Vec<PathBuf>)> = Vec::new();
    let mut add = |name: String, part: &PathBuf| match books.iter_mut().find(|(n, _)| n.eq_ignore_ascii_case(&name)) {
        Some((_, list)) => list.push(part.clone()),
        None => books.push((name, vec![part.clone()])),
    };
    if albums.len() > 1 {
        for (part, (album, _)) in parts.iter().zip(&infos) {
            add(album.clone().unwrap_or_else(|| stem(part)), part);
        }
    } else if albums.is_empty() && infos.iter().all(|(_, whole)| *whole) {
        for part in &parts {
            add(stem(part), part);
        }
    } else {
        return vec![(folder_name(), parts)];
    }
    books
}

/// The audio files a source stands for: a folder's, or one group's.
pub fn source_parts(source: &Path) -> Vec<PathBuf> {
    match parse_group(source) {
        Some((dir, name)) => folder_books(&dir).into_iter().find(|(n, _)| *n == name).map(|(_, parts)| parts).unwrap_or_default(),
        None => folder_parts(source),
    }
}

/// Writes a folder's audio files (and its cover picture, if any) into one
/// bundle at `out`. The same folder always makes the same bytes.
pub fn write_bundle(dir: &Path, out: &Path) -> Result<()> {
    write_parts_bundle(&folder_parts(dir), dir, out)
}

/// As `write_bundle`, for the given parts of `dir`: one of several audiobooks
/// in it. The folder's cover picture goes with each.
pub fn write_parts_bundle(parts: &[PathBuf], dir: &Path, out: &Path) -> Result<()> {
    if parts.is_empty() {
        return Err(Error::Unsuitable("there are no audio files in that folder".into()));
    }
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Stored)
        .last_modified_time(zip::DateTime::default())
        .unix_permissions(0o644)
        .large_file(true);
    let partial = out.with_extension(format!("{BUNDLE}.partial"));
    let result = (|| -> Result<()> {
        let mut writer = zip::ZipWriter::new(File::create(&partial)?);
        let width = parts.len().to_string().len().max(3);
        for (i, part) in parts.iter().enumerate() {
            let name = part.file_name().unwrap_or_default().to_string_lossy().replace(['/', '\\'], " ");
            writer
                .start_file(format!("{:0width$} {name}", i + 1), options)
                .map_err(|e| Error::Unsuitable(e.to_string()))?;
            io::copy(&mut File::open(part)?, &mut writer)?;
        }
        if let Some(cover) = folder_cover(dir) {
            let ext = extension(&cover).unwrap_or_else(|| "jpg".into());
            writer.start_file(format!("cover.{ext}"), options).map_err(|e| Error::Unsuitable(e.to_string()))?;
            io::copy(&mut File::open(&cover)?, &mut writer)?;
        }
        let mut file = writer.finish().map_err(|e| Error::Unsuitable(e.to_string()))?;
        file.flush()?;
        Ok(())
    })();
    match result {
        Ok(()) => {
            fs::rename(&partial, out)?;
            Ok(())
        }
        Err(e) => {
            let _ = fs::remove_file(&partial);
            Err(e)
        }
    }
}

/// A cover picture kept beside the audio files.
fn folder_cover(dir: &Path) -> Option<PathBuf> {
    let mut pictures: Vec<PathBuf> = fs::read_dir(dir)
        .ok()?
        .flatten()
        .map(|e| e.path())
        .filter(|p| extension(p).is_some_and(|e| matches!(e.as_str(), "jpg" | "jpeg" | "png" | "webp")))
        .collect();
    pictures.sort();
    let stem = |p: &PathBuf| p.file_stem().map(|s| s.to_string_lossy().to_lowercase()).unwrap_or_default();
    pictures
        .iter()
        .find(|p| COVER_NAMES.contains(&stem(p).as_str()))
        .or_else(|| (pictures.len() == 1).then(|| &pictures[0]))
        .cloned()
}

/// An audiobook's details: from its one file, or from every part of a bundle.
pub fn read(path: &Path, format: &str) -> Result<(BookMetadata, AudioDetails)> {
    let mut infos = Vec::new();
    let mut names = Vec::new();
    let mut bundle_cover = None;
    if format == BUNDLE {
        for entry in bundle_entries(path)? {
            let ext = extension(Path::new(&entry.name)).unwrap_or_default();
            let mut slice = Slice::new(File::open(path)?, entry.start, entry.len)?;
            if PART_FORMATS.contains(&ext.as_str()) {
                infos.push(read_part(&mut slice, &ext));
                names.push(entry.name.split_once(' ').map(|(_, n)| n.to_string()).unwrap_or(entry.name.clone()));
            } else if bundle_cover.is_none() {
                let mut bytes = Vec::new();
                slice.read_to_end(&mut bytes)?;
                bundle_cover = crate::formats::cover_from_bytes(bytes);
            }
        }
    } else {
        let len = fs::metadata(path)?.len();
        infos.push(read_part(&mut Slice::new(File::open(path)?, 0, len)?, format));
        names.push(path.file_name().unwrap_or_default().to_string_lossy().to_string());
    }
    if infos.is_empty() {
        return Err(Error::Unsuitable("there are no audio files in this audiobook".into()));
    }
    Ok(combine(infos, names, bundle_cover))
}

/// One book from its parts: the first part's tags speak for the book, and
/// every part adds its chapters (or is a chapter itself).
fn combine(infos: Vec<PartInfo>, names: Vec<String>, bundle_cover: Option<Cover>) -> (BookMetadata, AudioDetails) {
    let many = infos.len() > 1;
    let first = &infos[0];
    let title = if many { first.album.clone().or(first.title.clone()) } else { first.title.clone().or(first.album.clone()) };
    let mut details = AudioDetails::default();
    let mut at = 0u64;
    for (info, name) in infos.iter().zip(&names) {
        details.parts.push(Part { name: name.clone(), start_ms: at, duration_ms: info.duration_ms });
        if info.chapters.is_empty() {
            let title = info
                .title
                .clone()
                .filter(|t| many && Some(t) != title.as_ref())
                .unwrap_or_else(|| strip_extension(name));
            details.chapters.push(Chapter { title, start_ms: at });
        } else {
            details.chapters.extend(info.chapters.iter().map(|c| Chapter { title: c.title.clone(), start_ms: at + c.start_ms }));
        }
        at += info.duration_ms;
    }
    details.duration_ms = at;
    details.narrators = first.narrators.clone();
    let metadata = BookMetadata {
        title,
        authors: first.artists.clone(),
        synopsis: first.synopsis.clone(),
        publisher: first.publisher.clone(),
        subjects: first.genres.clone(),
        published: first.published.clone(),
        cover: bundle_cover.or_else(|| infos.iter().find_map(|i| i.cover.clone())),
        audio: Some(details.clone()),
        ..Default::default()
    };
    (metadata, details)
}

fn strip_extension(name: &str) -> String {
    let stem = Path::new(name).file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| name.to_string());
    stem.replace('_', " ").trim().to_string()
}

/// Splits "A; B / C" style name lists.
fn names(values: impl IntoIterator<Item = String>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for value in values {
        for name in value.split([';', '/', '\0']).map(str::trim).filter(|n| !n.is_empty()) {
            if !out.iter().any(|o| o.eq_ignore_ascii_case(name)) {
                out.push(name.to_string());
            }
        }
    }
    out
}

fn read_part(reader: &mut Slice, ext: &str) -> PartInfo {
    use lofty::file::{AudioFile, TaggedFileExt};
    use lofty::tag::{Accessor, ItemKey};

    let mut info = PartInfo::default();
    let _ = reader.seek(SeekFrom::Start(0));
    if let Ok(probe) = lofty::probe::Probe::new(&mut *reader).guess_file_type() {
        if let Ok(tagged) = probe.read() {
            info.duration_ms = tagged.properties().duration().as_millis() as u64;
            if let Some(tag) = tagged.primary_tag().or_else(|| tagged.first_tag()) {
                let text = |key: &ItemKey| tag.get_string(key).map(str::trim).filter(|s| !s.is_empty()).map(String::from);
                info.title = tag.title().map(|t| t.trim().to_string()).filter(|t| !t.is_empty());
                info.album = tag.album().map(|t| t.trim().to_string()).filter(|t| !t.is_empty());
                let artists = text(&ItemKey::AlbumArtist).into_iter().chain(tag.artist().map(|a| a.to_string()));
                info.artists = names(artists).into_iter().take(1).chain(names(tag.artist().map(|a| a.to_string()))).collect();
                info.artists.dedup();
                let narrator = tag.get_string(&ItemKey::Unknown("NARRATOR".into())).map(String::from);
                info.narrators = names(narrator.into_iter().chain(text(&ItemKey::Composer)));
                info.genres = names(tag.genre().map(|g| g.to_string()));
                info.published = text(&ItemKey::RecordingDate).or_else(|| text(&ItemKey::Year)).or_else(|| tag.year().map(|y| y.to_string()));
                info.synopsis = text(&ItemKey::Description).or_else(|| text(&ItemKey::PodcastDescription)).or_else(|| tag.comment().map(|c| c.to_string()));
                info.publisher = text(&ItemKey::Publisher).or_else(|| text(&ItemKey::Label));
                info.cover = tag.pictures().first().and_then(|p| crate::formats::cover_from_bytes(p.data().to_vec()));
            }
        }
    }
    // Lofty knows tags; chapters and narrators live in format-specific places.
    let _ = reader.seek(SeekFrom::Start(0));
    match ext {
        "m4b" | "m4a" | "aac" => {
            if let Ok(tag) = mp4ameta::Tag::read_from(reader) {
                info.chapters = tag
                    .chapters()
                    .iter()
                    .map(|c| Chapter { title: c.title.trim().to_string(), start_ms: c.start.as_millis() as u64 })
                    .collect();
                let narrators: Vec<String> = tag.strings_of(&mp4ameta::Fourcc(*b"\xa9nrt")).map(String::from).collect();
                if !narrators.is_empty() {
                    info.narrators = names(narrators);
                }
                if info.duration_ms == 0 {
                    info.duration_ms = tag.duration().as_millis() as u64;
                }
            }
        }
        "mp3" => {
            if let Ok(tag) = id3::Tag::read_from2(&mut *reader) {
                let mut chapters: Vec<Chapter> = tag
                    .chapters()
                    .map(|c| Chapter {
                        title: c
                            .frames
                            .iter()
                            .find(|f| f.id() == "TIT2")
                            .and_then(|f| f.content().text())
                            .map(|t| t.trim().to_string())
                            .unwrap_or_default(),
                        start_ms: c.start_time as u64,
                    })
                    .collect();
                chapters.sort_by_key(|c| c.start_ms);
                info.chapters = chapters;
                let narrators: Vec<String> = tag
                    .extended_texts()
                    .filter(|t| t.description.eq_ignore_ascii_case("narrator") || t.description.eq_ignore_ascii_case("narrated by"))
                    .map(|t| t.value.clone())
                    .collect();
                if !narrators.is_empty() {
                    info.narrators = names(narrators);
                }
            }
        }
        _ => {}
    }
    // Chapters without names get numbers; ones past the end are dropped.
    if info.duration_ms > 0 {
        let end = info.duration_ms;
        info.chapters.retain(|c| c.start_ms < end);
    }
    for (i, c) in info.chapters.iter_mut().enumerate() {
        if c.title.is_empty() {
            c.title = format!("Chapter {}", i + 1);
        }
    }
    info
}


/// An ebook and its audiobook, paired for reading along.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadAlongPair {
    pub ebook_id: String,
    pub audiobook_id: String,
    pub ebook_format: String,
    /// Both files are on this device, so it can line them up.
    pub here: bool,
    /// Both files are on this device or another one, so it can converge somewhere.
    pub somewhere: bool,
    /// The timing kept for the pair (JSON), if any.
    pub timing: Option<String>,
    /// How many pieces are lined up so far.
    pub pieces: i64,
    /// Waiting its turn to line up (the person can leave a pair out).
    pub queued: bool,
}

/// An audiobook as its page and the player show it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Audiobook {
    pub book: crate::model::BookPreview,
    pub narrators: Vec<String>,
    pub duration_ms: u64,
    pub chapters: Vec<Chapter>,
    pub parts: Vec<Part>,
    /// Where you are, from the start.
    pub position_ms: u64,
    /// The ebook it's linked to, for reading along.
    pub ebook: Option<crate::details::NamedRef>,
}

impl crate::library::Library {
    /// Keeps what an audiobook's files say, so devices without the files can
    /// show it too. A link to an ebook stays as it is.
    pub(crate) fn keep_audio_details(&self, book_id: &str, audio: &AudioDetails) -> Result<()> {
        self.conn.execute(
            "INSERT INTO audiobooks (book_id, narrators, duration_ms, chapters, parts, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(book_id) DO UPDATE SET narrators = excluded.narrators, duration_ms = excluded.duration_ms,
                chapters = excluded.chapters, parts = excluded.parts, updated_at = excluded.updated_at
             WHERE narrators IS NOT excluded.narrators OR duration_ms IS NOT excluded.duration_ms
                OR chapters IS NOT excluded.chapters OR parts IS NOT excluded.parts",
            rusqlite::params![
                book_id,
                serde_json::to_string(&audio.narrators)?,
                audio.duration_ms as i64,
                serde_json::to_string(&audio.chapters)?,
                serde_json::to_string(&audio.parts)?,
                crate::time::now_utc()
            ],
        )?;
        Ok(())
    }

    pub fn audiobook(&self, book_id: &str) -> Result<Audiobook> {
        use rusqlite::OptionalExtension;
        let book = self.book(book_id)?.ok_or_else(|| Error::Unsuitable("This audiobook is no longer in your library.".into()))?;
        if !is_audio(&book.format) {
            return Err(Error::Unsuitable("That isn't an audiobook.".into()));
        }
        let row: Option<(i64, String, String, Option<String>)> = self
            .conn
            .query_row(
                "SELECT duration_ms, chapters, parts, ebook_id FROM audiobooks WHERE book_id = ?1",
                rusqlite::params![book_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .optional()?;
        let (duration, chapters, parts, ebook_id) = row.unwrap_or((0, "[]".into(), "[]".into(), None));
        let ebook = match ebook_id {
            Some(id) => self.book(&id)?.map(|b| crate::details::NamedRef { id: b.id, name: b.title }),
            None => None,
        };
        let position_ms = book.resume_locator.as_ref().and_then(|l| l.audio_ms).unwrap_or(0);
        Ok(Audiobook {
            narrators: book.narrators.clone(),
            duration_ms: duration.max(0) as u64,
            chapters: serde_json::from_str(&chapters).unwrap_or_default(),
            parts: serde_json::from_str(&parts).unwrap_or_default(),
            position_ms,
            ebook,
            book,
        })
    }

    /// Remembers where you are in an audiobook. Starting one puts it in
    /// progress; finishing is still your call.
    pub fn save_listening(&self, book_id: &str, position_ms: u64, chapter: Option<String>) -> Result<()> {
        let duration: i64 = self
            .conn
            .query_row("SELECT duration_ms FROM audiobooks WHERE book_id = ?1", rusqlite::params![book_id], |r| r.get(0))
            .unwrap_or(0);
        let progression = (duration > 0).then(|| (position_ms as f64 / duration as f64).clamp(0.0, 1.0));
        let locator = crate::model::ReaderLocator { audio_ms: Some(position_ms), total_progression: progression, chapter, ..Default::default() };
        let now = crate::time::now_utc();
        self.conn.execute(
            "UPDATE books SET resume_locator = ?2, total_progression = COALESCE(?3, total_progression), last_opened_at = ?4,
                status = CASE WHEN status = 'unread' AND ?5 > 0 THEN 'in_progress' ELSE status END
             WHERE id = ?1 AND deleted_at IS NULL",
            rusqlite::params![book_id, serde_json::to_string(&locator)?, progression, now, position_ms as i64],
        )?;
        Ok(())
    }

    /// Links an audiobook to its ebook for reading along, or unlinks it.
    pub fn link_ebook(&self, audiobook_id: &str, ebook_id: Option<&str>) -> Result<()> {
        if let Some(ebook) = ebook_id {
            let format: Option<String> = self.book(ebook)?.map(|b| b.format);
            if format.as_deref().is_none_or(is_audio) {
                return Err(Error::Unsuitable("Choose an ebook to read along with.".into()));
            }
        }
        // Unlinking by hand leaves an empty link, so it isn't linked again
        // automatically (see `auto_link_audiobooks`).
        let ebook_id = Some(ebook_id.unwrap_or(""));
        let changed = self.conn.execute(
            "UPDATE audiobooks SET ebook_id = ?2, updated_at = ?3 WHERE book_id = ?1 AND ebook_id IS NOT ?2",
            rusqlite::params![audiobook_id, ebook_id, crate::time::now_utc()],
        )?;
        let exists: bool = self
            .conn
            .query_row("SELECT EXISTS (SELECT 1 FROM audiobooks WHERE book_id = ?1)", rusqlite::params![audiobook_id], |r| r.get(0))?;
        if changed == 0 && !exists {
            return Err(Error::Unsuitable("That audiobook's details haven't arrived on this device yet.".into()));
        }
        Ok(())
    }

    /// Links each audiobook not linked yet to the ebook in the library with
    /// the same title and author, when there's exactly one, so both show
    /// they have the other and read-along works without choosing. Never
    /// touches an audiobook whose link was set or removed by hand. Returns
    /// how many were linked.
    pub fn auto_link_audiobooks(&self) -> Result<usize> {
        let unlinked: Vec<String> = {
            let mut stmt = self.conn.prepare(
                "SELECT ab.book_id FROM audiobooks ab JOIN books b ON b.id = ab.book_id
                 WHERE ab.ebook_id IS NULL AND b.deleted_at IS NULL",
            )?;
            let rows = stmt.query_map([], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?;
            rows
        };
        if unlinked.is_empty() {
            return Ok(0);
        }
        // Every book's title and first author as they compare, with its format.
        let sql = format!(
            "SELECT b.id, b.format, COALESCE(o_title.value, f_title.value, b.title), COALESCE(o_authors.value, f_authors.value, b.authors) {}",
            crate::home::BOOK_FROM
        );
        let mut stmt = self.conn.prepare(&sql)?;
        let rows: Vec<(String, String, String, String)> =
            stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?.collect::<rusqlite::Result<_>>()?;
        let key = |title: &str, authors: &str| {
            let authors: Vec<String> = serde_json::from_str(authors).unwrap_or_default();
            // "Stoker, Bram" and "Bram Stoker" alike.
            let author = crate::manage::author_key(&authors);
            (crate::manage::title_key(title), author)
        };
        let mut ebooks: std::collections::HashMap<(String, String), Vec<(&str, &str)>> = std::collections::HashMap::new();
        let mut audio: std::collections::HashMap<&str, (&str, (String, String))> = std::collections::HashMap::new();
        for (id, format, title, authors) in &rows {
            let k = key(title, authors);
            if k.0.is_empty() || k.1.is_empty() {
                continue;
            }
            if is_audio(format) {
                audio.insert(id, (title, k));
            } else if !crate::home::DOCUMENT_FORMATS.contains(&format.as_str()) {
                ebooks.entry(k).or_default().push((id, title));
            }
        }
        let mut linked = 0;
        let now = crate::time::now_utc();
        for id in &unlinked {
            let Some((title, k)) = audio.get(id.as_str()) else { continue };
            // "Book 2" never pairs with "Book 3", though their titles compare alike.
            let matches: Vec<&str> = ebooks
                .get(k)
                .map(|list| list.iter().filter(|(_, t)| !crate::manage::numbered_apart(title, t)).map(|(e, _)| *e).collect())
                .unwrap_or_default();
            if let [ebook] = matches[..] {
                linked += self.conn.execute(
                    "UPDATE audiobooks SET ebook_id = ?2, updated_at = ?3 WHERE book_id = ?1 AND ebook_id IS NULL",
                    rusqlite::params![id, ebook, now],
                )?;
            }
        }
        Ok(linked)
    }

    /// Read-along timing for an ebook and its audiobook, if worked out yet.
    pub fn read_along_timing(&self, ebook_id: &str, audiobook_id: &str) -> Result<Option<String>> {
        use rusqlite::OptionalExtension;
        Ok(self
            .conn
            .query_row(
                "SELECT timing FROM read_along WHERE ebook_id = ?1 AND audiobook_id = ?2",
                rusqlite::params![ebook_id, audiobook_id],
                |r| r.get(0),
            )
            .optional()?)
    }

    /// Keeps read-along timing, which syncs to other devices.
    pub fn save_read_along_timing(&self, ebook_id: &str, audiobook_id: &str, timing: &str) -> Result<()> {
        serde_json::from_str::<serde_json::Value>(timing).map_err(|_| Error::Unsuitable("That read-along timing isn't readable.".into()))?;
        self.conn.execute(
            "INSERT INTO read_along (ebook_id, audiobook_id, timing, updated_at) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(ebook_id, audiobook_id) DO UPDATE SET timing = excluded.timing, updated_at = excluded.updated_at",
            rusqlite::params![ebook_id, audiobook_id, timing, crate::time::now_utc()],
        )?;
        Ok(())
    }

    /// The pieces of read-along timing lined up so far, by any device, as
    /// (piece, anchors JSON) in order.
    pub fn read_along_pieces(&self, ebook_id: &str, audiobook_id: &str) -> Result<Vec<(i64, String)>> {
        let mut stmt = self
            .conn
            .prepare("SELECT piece, anchors FROM read_along_pieces WHERE ebook_id = ?1 AND audiobook_id = ?2 ORDER BY piece")?;
        let rows = stmt.query_map(rusqlite::params![ebook_id, audiobook_id], |r| Ok((r.get(0)?, r.get(1)?)))?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    /// Keeps one lined-up piece, which syncs on its own. A piece is the same
    /// whichever device lined it up, so one that's already here is left alone.
    pub fn save_read_along_piece(&self, ebook_id: &str, audiobook_id: &str, piece: i64, anchors: &str) -> Result<()> {
        if !serde_json::from_str::<serde_json::Value>(anchors).is_ok_and(|v| v.is_array()) {
            return Err(Error::Unsuitable("That piece of read-along timing isn't readable.".into()));
        }
        self.conn.execute(
            "INSERT OR IGNORE INTO read_along_pieces (ebook_id, audiobook_id, piece, anchors, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![ebook_id, audiobook_id, piece, anchors, crate::time::now_utc()],
        )?;
        Ok(())
    }

    /// Starts lining up a pair again from nothing (the ebook changed, say).
    pub fn clear_read_along_pieces(&self, ebook_id: &str, audiobook_id: &str) -> Result<()> {
        self.conn.execute(
            "DELETE FROM read_along_pieces WHERE ebook_id = ?1 AND audiobook_id = ?2",
            rusqlite::params![ebook_id, audiobook_id],
        )?;
        Ok(())
    }

    /// Every ebook and audiobook paired for reading along, with whether both
    /// files are on this device (so this device can line them up) and the
    /// timing so far, for lining up in the background.
    pub fn read_along_pairs(&self) -> Result<Vec<ReadAlongPair>> {
        let mut stmt = self.conn.prepare(
            "SELECT ab.ebook_id, ab.book_id, e.format, ra.timing, COALESCE(q.queued, 1) FROM audiobooks ab
             JOIN books a ON a.id = ab.book_id AND a.deleted_at IS NULL
             JOIN books e ON e.id = ab.ebook_id AND e.deleted_at IS NULL
             LEFT JOIN read_along ra ON ra.ebook_id = ab.ebook_id AND ra.audiobook_id = ab.book_id
             LEFT JOIN read_along_queue q ON q.ebook_id = ab.ebook_id AND q.audiobook_id = ab.book_id
             ORDER BY COALESCE(q.queued, 1) DESC, q.position IS NULL, q.position, ab.updated_at DESC",
        )?;
        let rows = stmt
            .query_map([], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, Option<String>>(3)?, r.get::<_, bool>(4)?))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let me = self.device_id()?;
        let mut pairs = Vec::new();
        for (ebook_id, audiobook_id, ebook_format, timing, queued) in rows {
            let here = self.has_local_file(&ebook_id)? && self.has_local_file(&audiobook_id)?;
            let somewhere = here
                || self.conn.query_row(
                    "SELECT EXISTS (SELECT 1 FROM read_along_holders WHERE ebook_id = ?1 AND audiobook_id = ?2 AND held = 1 AND device_id != ?3)",
                    rusqlite::params![ebook_id, audiobook_id, me],
                    |r| r.get(0),
                )?;
            let pieces: i64 = self.conn.query_row(
                "SELECT COUNT(*) FROM read_along_pieces WHERE ebook_id = ?1 AND audiobook_id = ?2",
                rusqlite::params![ebook_id, audiobook_id],
                |r| r.get(0),
            )?;
            pairs.push(ReadAlongPair { ebook_id, audiobook_id, ebook_format, here, somewhere, timing, pieces, queued });
        }
        Ok(pairs)
    }

    /// Notes which read-along pairs this device has both halves of, for the
    /// other devices. Only rows that changed are written, so syncing sends
    /// just those.
    pub fn note_read_along_holdings(&self) -> Result<()> {
        let me = self.device_id()?;
        let pairs: Vec<(String, String)> = self
            .conn
            .prepare(
                "SELECT ab.ebook_id, ab.book_id FROM audiobooks ab
                 JOIN books a ON a.id = ab.book_id AND a.deleted_at IS NULL
                 JOIN books e ON e.id = ab.ebook_id AND e.deleted_at IS NULL",
            )?
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<rusqlite::Result<_>>()?;
        for (ebook_id, audiobook_id) in pairs {
            let held = self.has_local_file(&ebook_id)? && self.has_local_file(&audiobook_id)?;
            self.conn.execute(
                "INSERT INTO read_along_holders (device_id, ebook_id, audiobook_id, held, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT (device_id, ebook_id, audiobook_id) DO UPDATE SET held = excluded.held, updated_at = excluded.updated_at
                 WHERE held != excluded.held",
                rusqlite::params![me, ebook_id, audiobook_id, held, crate::time::now_utc()],
            )?;
        }
        Ok(())
    }

    /// Puts a pair in the queue to line up (at the back) or leaves it out.
    pub fn set_read_along_queued(&self, ebook_id: &str, audiobook_id: &str, queued: bool) -> Result<()> {
        use rusqlite::OptionalExtension;
        let now: Option<(Option<f64>, bool)> = self
            .conn
            .query_row(
                "SELECT position, queued FROM read_along_queue WHERE ebook_id = ?1 AND audiobook_id = ?2",
                rusqlite::params![ebook_id, audiobook_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        if now.is_none_or(|(_, q)| q) == queued {
            return Ok(());
        }
        // Back of the queue: after every pair given a place, if any are.
        let position: Option<f64> = if queued {
            self.conn.query_row("SELECT MAX(position) + 1 FROM read_along_queue WHERE queued = 1", [], |r| r.get(0))?
        } else {
            now.and_then(|(p, _)| p)
        };
        self.conn.execute(
            "INSERT INTO read_along_queue (ebook_id, audiobook_id, position, queued, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT (ebook_id, audiobook_id) DO UPDATE SET position = excluded.position, queued = excluded.queued, updated_at = excluded.updated_at",
            rusqlite::params![ebook_id, audiobook_id, position, queued, crate::time::now_utc()],
        )?;
        Ok(())
    }

    /// The queue in the person's order, as (ebook, audiobook) pairs. Every
    /// pair given is queued; only places that moved are written, so syncing
    /// sends just those.
    pub fn order_read_along_queue(&self, order: &[(String, String)]) -> Result<()> {
        let now = crate::time::now_utc();
        for (index, (ebook_id, audiobook_id)) in order.iter().enumerate() {
            self.conn.execute(
                "INSERT INTO read_along_queue (ebook_id, audiobook_id, position, queued, updated_at) VALUES (?1, ?2, ?3, 1, ?4)
                 ON CONFLICT (ebook_id, audiobook_id) DO UPDATE SET position = excluded.position, queued = 1, updated_at = excluded.updated_at
                 WHERE position IS NOT excluded.position OR queued <> 1",
                rusqlite::params![ebook_id, audiobook_id, index as f64, now],
            )?;
        }
        Ok(())
    }

    /// The audiobook linked to an ebook, if any, for the reader.
    pub fn audiobook_for_ebook(&self, ebook_id: &str) -> Result<Option<String>> {
        use rusqlite::OptionalExtension;
        Ok(self
            .conn
            .query_row(
                "SELECT ab.book_id FROM audiobooks ab JOIN books b ON b.id = ab.book_id
                 WHERE ab.ebook_id = ?1 AND b.deleted_at IS NULL ORDER BY ab.updated_at DESC LIMIT 1",
                rusqlite::params![ebook_id],
                |r| r.get(0),
            )
            .optional()?)
    }

    /// Where a book's audio is on this device, and its format, for playing.
    pub fn audio_file(&self, book_id: &str) -> Result<(PathBuf, String)> {
        let format = self.book(book_id)?.map(|b| b.format).ok_or_else(|| Error::Unsuitable("That audiobook isn't in your library.".into()))?;
        Ok((self.book_file(book_id)?, format))
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// A tiny but real MP3: silent MPEG-1 Layer III frames at 128 kbps, 44.1 kHz.
    pub(crate) fn silent_mp3(frames: usize, title: &str, album: &str, artist: &str) -> Vec<u8> {
        use id3::TagLike;
        let mut tag = id3::Tag::new();
        tag.set_title(title);
        tag.set_album(album);
        tag.set_artist(artist);
        tag.add_frame(id3::frame::ExtendedText { description: "NARRATOR".into(), value: "Ann Reader".into() });
        let mut out = Vec::new();
        tag.write_to(&mut out, id3::Version::Id3v24).unwrap();
        // 128 kbps at 44.1 kHz: 417 bytes per frame, 1152 samples (about 26 ms).
        let mut frame = vec![0u8; 417];
        frame[..4].copy_from_slice(&[0xFF, 0xFB, 0x90, 0x64]);
        for _ in 0..frames {
            out.extend_from_slice(&frame);
        }
        out
    }

    #[test]
    fn names_that_read_the_same_still_have_one_order() {
        assert_eq!(natural_cmp("Part 2.mp3", "Part 02.mp3"), "Part 2.mp3".cmp("Part 02.mp3"));
        assert_ne!(natural_cmp("part 1.mp3", "Part 1.mp3"), std::cmp::Ordering::Equal);
        assert_eq!(natural_cmp("Part 2.mp3", "Part 10.mp3"), std::cmp::Ordering::Less);
        assert_eq!(mime_of("aac"), "audio/aac");
    }

    #[test]
    fn names_sort_the_way_people_number_them() {
        let mut names = vec!["Part 10.mp3", "Part 2.mp3", "part 1.mp3", "Intro.mp3"];
        names.sort_by(|a, b| natural_cmp(a, b));
        assert_eq!(names, vec!["Intro.mp3", "part 1.mp3", "Part 2.mp3", "Part 10.mp3"]);
    }

    #[test]
    fn a_folder_becomes_one_book_the_same_way_every_time() {
        let dir = tempfile::tempdir().unwrap();
        let folder = dir.path().join("The Moonstone");
        fs::create_dir(&folder).unwrap();
        fs::write(folder.join("02 Second.mp3"), silent_mp3(80, "The Second Period", "The Moonstone", "Wilkie Collins")).unwrap();
        fs::write(folder.join("01 First.mp3"), silent_mp3(40, "The First Period", "The Moonstone", "Wilkie Collins")).unwrap();
        fs::write(folder.join("cover.jpg"), [0xFF, 0xD8, 0xFF, 0xE0, 0, 0]).unwrap();
        fs::write(folder.join("notes.txt"), "not audio").unwrap();

        let a = dir.path().join("a.tbvaudio");
        let b = dir.path().join("b.tbvaudio");
        write_bundle(&folder, &a).unwrap();
        write_bundle(&folder, &b).unwrap();
        assert_eq!(fs::read(&a).unwrap(), fs::read(&b).unwrap(), "same folder, same bytes, same book");

        let entries = bundle_entries(&a).unwrap();
        assert_eq!(entries.iter().map(|e| e.name.as_str()).collect::<Vec<_>>(), vec!["001 01 First.mp3", "002 02 Second.mp3", "cover.jpg"]);

        let (metadata, audio) = read(&a, BUNDLE).unwrap();
        assert_eq!(metadata.title.as_deref(), Some("The Moonstone"));
        assert_eq!(metadata.authors, vec!["Wilkie Collins".to_string()]);
        assert_eq!(metadata.cover.as_ref().map(|c| c.extension.as_str()), Some("jpg"));
        assert_eq!(audio.narrators, vec!["Ann Reader".to_string()]);
        assert_eq!(audio.parts.len(), 2);
        assert_eq!(audio.chapters.iter().map(|c| c.title.as_str()).collect::<Vec<_>>(), vec!["The First Period", "The Second Period"]);
        let first = audio.parts[0].duration_ms;
        assert!(first > 900 && first < 1200, "about a second: {first}");
        assert_eq!(audio.chapters[1].start_ms, first);
        assert_eq!(audio.duration_ms, first + audio.parts[1].duration_ms);

        // A part reads back byte for byte from inside the bundle.
        let (mut part, ext) = open_part(&a, BUNDLE, 0).unwrap();
        assert_eq!(ext, "mp3");
        let mut bytes = Vec::new();
        part.read_to_end(&mut bytes).unwrap();
        assert_eq!(bytes, fs::read(folder.join("01 First.mp3")).unwrap());
        part.seek(SeekFrom::Start(10)).unwrap();
        let mut ten = [0u8; 10];
        part.read_exact(&mut ten).unwrap();
        assert_eq!(&ten, &bytes[10..20]);
    }

    #[test]
    fn a_bundle_streams_from_a_cloud_folder_byte_for_byte() {
        let dir = tempfile::tempdir().unwrap();
        let folder = dir.path().join("The Moonstone");
        fs::create_dir(&folder).unwrap();
        fs::write(folder.join("01 First.mp3"), silent_mp3(1000, "The First Period", "The Moonstone", "Wilkie Collins")).unwrap();
        fs::write(folder.join("02 Second.mp3"), silent_mp3(30, "The Second Period", "The Moonstone", "Wilkie Collins")).unwrap();
        let cloud_dir = dir.path().join("iCloud");
        fs::create_dir(&cloud_dir).unwrap();
        let store = crate::sync::files::FolderStore::open(&cloud_dir).unwrap();
        let local = dir.path().join("a.tbvaudio");
        write_bundle(&folder, &local).unwrap();
        let in_cloud = cloud_dir.join(crate::sync::files::LIBRARY_FOLDER).join("books");
        fs::create_dir_all(&in_cloud).unwrap();
        fs::copy(&local, in_cloud.join("x.tbvaudio")).unwrap();
        let cloud = crate::sync::Cloud::Files(crate::sync::files::FileRemote::new(Box::new(store), "pc".into()));

        let mut stream = Stream::open(cloud, "books/x.tbvaudio", BUNDLE).unwrap().unwrap();
        for index in 0..2 {
            let (mut part, ext) = open_part(&local, BUNDLE, index).unwrap();
            let mut whole = Vec::new();
            part.read_to_end(&mut whole).unwrap();
            assert_eq!(stream.part(index), Some((whole.len() as u64, ext.as_str())));
            assert_eq!(stream.read(index, 0, whole.len() as u64 + 99).unwrap(), whole);
            assert_eq!(stream.read(index, 10, 19).unwrap(), &whole[10..20]);
        }
        let empty = crate::sync::Cloud::Files(crate::sync::files::FileRemote::new(
            Box::new(crate::sync::files::FolderStore::open(&cloud_dir).unwrap()),
            "pc".into(),
        ));
        assert!(Stream::open(empty, "books/missing.mp3", "mp3").unwrap().is_none());
    }

    #[test]
    fn a_folder_of_several_audiobooks_is_told_apart() {
        let dir = tempfile::tempdir().unwrap();
        let mixed = dir.path().join("Audiobooks");
        fs::create_dir(&mixed).unwrap();
        fs::write(mixed.join("Dracula 1.mp3"), silent_mp3(10, "Chapter 1", "Dracula", "Bram Stoker")).unwrap();
        fs::write(mixed.join("Dracula 2.mp3"), silent_mp3(10, "Chapter 2", "Dracula", "Bram Stoker")).unwrap();
        fs::write(mixed.join("Carmilla.mp3"), silent_mp3(10, "Carmilla", "Carmilla", "Sheridan Le Fanu")).unwrap();
        let books = folder_books(&mixed);
        assert_eq!(books.iter().map(|(n, p)| (n.as_str(), p.len())).collect::<Vec<_>>(), vec![("Carmilla", 1), ("Dracula", 2)]);

        // A book in parts, every part tagged with the same album, stays one book.
        let one = dir.path().join("The Moonstone");
        fs::create_dir(&one).unwrap();
        fs::write(one.join("01.mp3"), silent_mp3(10, "First", "The Moonstone", "Wilkie Collins")).unwrap();
        fs::write(one.join("02.mp3"), silent_mp3(10, "Second", "The Moonstone", "Wilkie Collins")).unwrap();
        assert_eq!(folder_books(&one).len(), 1);

        // Found as separate books, a two-part one bundled on its own.
        let found = crate::library::find_book_files(std::slice::from_ref(&mixed), &dir.path().join("Library"));
        assert_eq!(found.len(), 2);
        let group = found.iter().find(|p| parse_group(p).is_some()).expect("Dracula is a group");
        assert_eq!(display_name(group), "Dracula");
        assert_eq!(source_parts(group).len(), 2);
        let out = dir.path().join("dracula.tbvaudio");
        write_parts_bundle(&source_parts(group), &mixed, &out).unwrap();
        assert_eq!(bundle_entries(&out).unwrap().len(), 2);

        let (_library_dir, mut library) = crate::library::tests::open_temp_library();
        let results = library.import_files(&[mixed]);
        let titles: Vec<String> = results
            .iter()
            .map(|r| match r {
                crate::model::ImportResult::Imported { title, .. } => title.clone(),
                other => panic!("{other:?}"),
            })
            .collect();
        assert_eq!(titles.len(), 2, "two audiobooks, not one: {titles:?}");
    }

    #[test]
    fn one_file_with_chapters_keeps_them() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("book.mp3");
        let mut bytes = silent_mp3(0, "Dracula", "Dracula", "Bram Stoker");
        // Rewrite the tag with two chapters.
        {
            use id3::TagLike;
            let mut tag = id3::Tag::read_from2(std::io::Cursor::new(&bytes)).unwrap();
            for (i, (start, title)) in [(0u32, "Jonathan Harker's Journal"), (600, "Letter")].iter().enumerate() {
                tag.add_frame(id3::frame::Chapter {
                    element_id: format!("ch{i}"),
                    start_time: *start,
                    end_time: start + 600,
                    start_offset: u32::MAX,
                    end_offset: u32::MAX,
                    frames: vec![id3::Frame::text("TIT2", *title)],
                });
            }
            let mut out = Vec::new();
            tag.write_to(&mut out, id3::Version::Id3v24).unwrap();
            let mut frame = vec![0u8; 417];
            frame[..4].copy_from_slice(&[0xFF, 0xFB, 0x90, 0x64]);
            for _ in 0..50 {
                out.extend_from_slice(&frame);
            }
            bytes = out;
        }
        fs::write(&path, bytes).unwrap();
        let (metadata, audio) = read(&path, "mp3").unwrap();
        assert_eq!(metadata.title.as_deref(), Some("Dracula"));
        assert_eq!(audio.parts.len(), 1);
        assert_eq!(audio.chapters, vec![
            Chapter { title: "Jonathan Harker's Journal".into(), start_ms: 0 },
            Chapter { title: "Letter".into(), start_ms: 600 }
        ]);
    }

    #[test]
    fn an_audiobook_folder_imports_as_one_book_on_its_own_page() {
        use crate::model::{ItemKind, LibraryQuery, ReadStatus};
        let (dir, mut library) = crate::library::tests::open_temp_library();
        let source = dir.path().join("incoming");
        let folder = source.join("Persuasion");
        fs::create_dir_all(&folder).unwrap();
        fs::write(folder.join("Chapter 1.mp3"), silent_mp3(40, "Chapter 1", "Persuasion", "Jane Austen")).unwrap();
        fs::write(folder.join("Chapter 2.mp3"), silent_mp3(40, "Chapter 2", "Persuasion", "Jane Austen")).unwrap();
        fs::write(source.join("notes.nfo"), "not a book").unwrap();
        crate::epub::tests::write_test_epub(&source.join("persuasion.epub"), "Persuasion", "Austen, Jane", false);

        let results = library.import_files(std::slice::from_ref(&source));
        assert_eq!(results.len(), 2, "the folder is one book, beside the ebook: {results:?}");
        let audio_id = match &results[0] {
            crate::model::ImportResult::Imported { book_id, path, .. } => {
                assert!(path.ends_with("Persuasion"), "reported by the folder: {path}");
                book_id.clone()
            }
            other => panic!("{other:?}"),
        };
        assert!(!library.paths.books_dir.join(".incoming").read_dir().is_ok_and(|mut d| d.next().is_some()), "the bundle made on the way is gone");

        let page = |kind| library.library_page(&LibraryQuery { kind: Some(kind), ..Default::default() }).unwrap();
        assert_eq!(page(ItemKind::Audiobooks).books.iter().map(|b| b.id.clone()).collect::<Vec<_>>(), vec![audio_id.clone()]);
        assert_eq!(page(ItemKind::Books).total, 1, "the ebook stays in the Library");
        assert!(library.home().unwrap().recently_added.iter().all(|b| b.id != audio_id), "Home is for reading");

        let book = library.audiobook(&audio_id).unwrap();
        assert_eq!(book.book.title, "Persuasion");
        assert_eq!(book.narrators, vec!["Ann Reader".to_string()]);
        assert_eq!(book.chapters.len(), 2);
        assert_eq!(book.parts.len(), 2);
        assert!(book.duration_ms > 1500);
        assert_eq!(book.book.duration_ms, Some(book.duration_ms));

        library.save_listening(&audio_id, book.duration_ms / 2, Some("Chapter 2".into())).unwrap();
        let book = library.audiobook(&audio_id).unwrap();
        assert_eq!(book.position_ms, book.duration_ms / 2);
        assert_eq!(book.book.status, ReadStatus::InProgress);
        assert!((book.book.total_progression.unwrap() - 0.5).abs() < 0.01);

        let ebook_id = page(ItemKind::Books).books[0].id.clone();
        assert!(library.link_ebook(&audio_id, Some(&audio_id)).is_err(), "an audiobook can't read along with itself");
        // Same title and author ("Austen, Jane" on the ebook): linked without asking, and both covers say so.
        assert_eq!(library.auto_link_audiobooks().unwrap(), 1);
        assert_eq!(library.audiobook_for_ebook(&ebook_id).unwrap(), Some(audio_id.clone()));
        assert!(page(ItemKind::Books).books[0].paired && page(ItemKind::Audiobooks).books[0].paired);
        // Resonance's switch: Paired, or Audiobooks only.
        let audio_paired = |paired| library.library_page(&LibraryQuery { kind: Some(ItemKind::Audiobooks), paired: Some(paired), ..Default::default() }).unwrap().total;
        assert_eq!((audio_paired(true), audio_paired(false)), (1, 0));
        // Unlinked by hand: left alone from then on.
        library.link_ebook(&audio_id, None).unwrap();
        assert_eq!(library.auto_link_audiobooks().unwrap(), 0);
        assert!(!page(ItemKind::Books).books[0].paired);
        assert_eq!((audio_paired(true), audio_paired(false)), (0, 1));
        library.link_ebook(&audio_id, Some(&ebook_id)).unwrap();
        assert_eq!(library.audiobook_for_ebook(&ebook_id).unwrap(), Some(audio_id.clone()));
        assert_eq!(library.audiobook(&audio_id).unwrap().ebook.map(|e| e.name), Some("Persuasion".into()));
        // Paired with both files here, so this device can line them up.
        library.save_read_along_piece(&ebook_id, &audio_id, 0, "[]").unwrap();
        let pairs = library.read_along_pairs().unwrap();
        assert_eq!(pairs.len(), 1);
        assert_eq!((pairs[0].ebook_id.as_str(), pairs[0].audiobook_id.as_str(), pairs[0].here, pairs[0].pieces), (ebook_id.as_str(), audio_id.as_str(), true, 1));
        assert_eq!(pairs[0].timing, None);
        assert!(pairs[0].queued, "a new pair lines up without asking");
        library.set_read_along_queued(&ebook_id, &audio_id, false).unwrap();
        assert!(!library.read_along_pairs().unwrap()[0].queued);
        library.order_read_along_queue(&[(ebook_id.clone(), audio_id.clone())]).unwrap();
        assert!(library.read_along_pairs().unwrap()[0].queued, "ordering a pair queues it");
        // Other devices learn this one holds both halves, once, and only a change writes again.
        assert!(library.read_along_pairs().unwrap()[0].somewhere);
        library.note_read_along_holdings().unwrap();
        library.note_read_along_holdings().unwrap();
        let held: Vec<(String, bool, String)> = library
            .conn
            .prepare("SELECT device_id, held, updated_at FROM read_along_holders")
            .unwrap()
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap();
        assert_eq!(held.len(), 1);
        assert_eq!((held[0].0.as_str(), held[0].1), (library.device_id().unwrap().as_str(), true));

        // The same folder again is the same book.
        let again = library.import_files(&[folder]);
        assert!(matches!(&again[0], crate::model::ImportResult::AlreadyInLibrary { book_id, .. } if *book_id == audio_id), "{again:?}");

        // Narrators can be corrected like any detail.
        library
            .edit_details(std::slice::from_ref(&audio_id), &[crate::details::DetailChange { field: "narrators".into(), value: Some(r#"["Juliet Stevenson"]"#.into()) }])
            .unwrap();
        assert_eq!(library.audiobook(&audio_id).unwrap().narrators, vec!["Juliet Stevenson".to_string()]);
        let by = library
            .library_page(&LibraryQuery { kind: Some(ItemKind::Audiobooks), narrators: vec!["juliet stevenson".into()], ..Default::default() })
            .unwrap();
        assert_eq!(by.total, 1);
        assert_eq!(by.narrators, vec!["Juliet Stevenson".to_string()]);
    }
}

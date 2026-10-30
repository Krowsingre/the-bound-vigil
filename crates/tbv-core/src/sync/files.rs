//! Sync through plain files: a folder that a cloud app keeps in step (iCloud
//! Drive, Dropbox, Google Drive, OneDrive, MEGA and the like), or a WebDAV
//! server. There is no server to number changes, so each device writes only
//! its own numbered change files, and never edits or deletes another
//! device's. Two devices can't write the same file at once, which is what
//! keeps a synced folder from making "conflicted copies".
//!
//! ```text
//! The Bound Vigil/
//!   library.json              marks the folder as a TBV library, with its wake-up name
//!   changes/<device>/0000000001.json   a batch of records, never changed
//!   devices/<device>.json     how many batches the device has written, and its book count
//!   books/<hash>.epub         book files (when Sync book files is on)
//!   covers/<hash>.jpg         covers, and collection pictures under pictures/
//! ```

use std::collections::BTreeMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::{Page, Record, Remote};
use crate::error::{Error, Result};

/// The folder TBV makes inside the one the person chooses.
pub const LIBRARY_FOLDER: &str = "The Bound Vigil";
const MARKER: &str = "library.json";
const CHANGES: &str = "changes/";
const DEVICES: &str = "devices/";

/// Brings down a file the cloud app hasn't kept here yet, waiting until it
/// arrives (true once it has). On iPhone, iCloud leaves a small
/// `.<name>.icloud` stand-in in a file's place until it's asked for.
static FETCH: std::sync::OnceLock<fn(&Path) -> bool> = std::sync::OnceLock::new();

/// How to bring down a file that only has a stand-in (the iPhone app's).
pub fn set_fetcher(fetch: fn(&Path) -> bool) {
    let _ = FETCH.set(fetch);
}

/// Asks the cloud app for the latest of a folder or file (the iPhone app's),
/// since iCloud on a phone doesn't always notice new files by itself.
static REFRESH: std::sync::OnceLock<fn(&Path)> = std::sync::OnceLock::new();

/// How to ask the cloud app for the latest of a folder or file.
pub fn set_refresher(refresh: fn(&Path)) {
    let _ = REFRESH.set(refresh);
}

fn refresh(path: &Path) {
    if let Some(refresh) = REFRESH.get() {
        refresh(path);
    }
}

/// Whether a path is sync bookkeeping that must be read fresh: the change
/// folders and the devices' notes.
fn kept_fresh(path: &str) -> bool {
    path.starts_with(CHANGES) || path.starts_with(DEVICES)
}

/// iCloud's stand-in for a file it hasn't brought down.
fn stand_in(path: &Path) -> Option<PathBuf> {
    let name = path.file_name()?.to_string_lossy();
    Some(path.with_file_name(format!(".{name}.icloud")))
}

/// The file's name if `name` is iCloud's stand-in for it.
fn stood_in_for(name: &str) -> Option<&str> {
    name.strip_prefix('.')?.strip_suffix(".icloud").filter(|n| !n.is_empty())
}

/// Makes sure the file is really here, bringing it down if only its
/// stand-in is.
fn bring_down(path: &Path) {
    if path.exists() {
        return;
    }
    if let (Some(fetch), Some(stand_in)) = (FETCH.get(), stand_in(path)) {
        if stand_in.exists() {
            fetch(path);
        }
    }
}

/// When to ask the cloud about a folder again: listing a big one is slow.
const FOLDER_ASKED_AGAIN: std::time::Duration = std::time::Duration::from_secs(10 * 60);
static FOLDERS_ASKED: std::sync::Mutex<BTreeMap<PathBuf, std::time::Instant>> = std::sync::Mutex::new(BTreeMap::new());

/// As `bring_down`, for a file TBV knows should be there. iCloud on a phone
/// may not have heard of it yet (no file and no stand-in), so it's asked
/// about the file, then its folder, before the file counts as missing.
fn bring_down_expected(path: &Path) {
    bring_down(path);
    if path.exists() || REFRESH.get().is_none() {
        return;
    }
    let here = |p: &Path| p.exists() || stand_in(p).is_some_and(|s| s.exists());
    refresh(path);
    if !here(path) {
        if let Some(folder) = path.parent() {
            let due = FOLDERS_ASKED.lock().map(|mut asked| {
                let due = asked.get(folder).is_none_or(|at| at.elapsed() >= FOLDER_ASKED_AGAIN);
                if due {
                    asked.insert(folder.to_path_buf(), std::time::Instant::now());
                }
                due
            });
            if due.unwrap_or(true) {
                refresh(folder);
            }
        }
    }
    bring_down(path);
}

/// Brings down every file in a folder (and those inside it) that iCloud has
/// only a stand-in for. Does nothing where there are no stand-ins.
pub fn bring_down_folder(dir: &Path) {
    if FETCH.get().is_none() {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        if path.is_dir() {
            bring_down_folder(&path);
        } else if let Some(real) = stood_in_for(&name) {
            bring_down(&dir.join(real));
        }
    }
}

/// A place files can be kept: paths are relative and use `/`.
pub trait Store {
    /// The file's bytes, or `None` if there's no such file.
    fn read(&mut self, path: &str) -> Result<Option<Vec<u8>>>;
    /// Writes a whole file, replacing any there.
    fn write(&mut self, path: &str, bytes: &[u8]) -> Result<()>;
    /// Copies a file from this computer in.
    fn put_file(&mut self, path: &str, file: &Path) -> Result<()>;
    /// Copies a file out to this computer. False if there's no such file.
    fn get_file(&mut self, path: &str, to: &Path) -> Result<bool>;
    /// Names in a folder (files and folders), like `covers/`. Empty if the
    /// folder doesn't exist yet.
    fn list(&mut self, folder: &str) -> Result<Vec<String>>;
    /// As `list`, with sizes where the store knows them.
    fn list_sizes(&mut self, folder: &str) -> Result<Vec<(String, Option<u64>)>> {
        Ok(self.list(folder)?.into_iter().map(|name| (name, None)).collect())
    }
    /// Erases a file. Fine if there's no such file.
    fn remove(&mut self, path: &str) -> Result<()>;
    /// Part of a file and its whole size, for streaming. None if there's no such file.
    fn read_range(&mut self, _path: &str, _start: u64, _end: u64) -> Result<Option<(Vec<u8>, u64)>> {
        Err(Error::Unsuitable("This place can't play a file without downloading it.".into()))
    }
    /// Whether another device has written here since the last time this was
    /// asked, found out cheaply from the service. The first ask only notes
    /// how things stand. None when this place can't tell: a folder on this
    /// computer, which is watched on disk instead.
    fn news(&mut self, _mine: &str) -> Result<Option<bool>> {
        Ok(None)
    }
}

/// For `Store::news` by looking: what each of another device's folders and
/// notes looks like now (its size, date or tag), against how it looked
/// last time. Something new or changed is news; something gone isn't.
pub(crate) fn stamps_changed(seen: &mut Option<BTreeMap<String, String>>, now: BTreeMap<String, String>) -> bool {
    match seen.replace(now) {
        None => false,
        Some(was) => seen.as_ref().is_some_and(|now| now.iter().any(|(k, v)| was.get(k) != Some(v))),
    }
}

/// Whether a device folder under `changes/` (or a note under `devices/`)
/// named `name` is another device's, so its stamp is worth watching.
pub(crate) fn watched(folder: &str, name: &str, mine: &str) -> bool {
    match folder {
        "changes" => is_news_from_elsewhere(Path::new(&format!("changes/{name}/0.json")), mine),
        "devices" => is_news_from_elsewhere(Path::new(&format!("devices/{name}")), mine),
        _ => false,
    }
}

impl<T: Store + ?Sized> Store for Box<T> {
    fn read(&mut self, path: &str) -> Result<Option<Vec<u8>>> {
        (**self).read(path)
    }
    fn write(&mut self, path: &str, bytes: &[u8]) -> Result<()> {
        (**self).write(path, bytes)
    }
    fn put_file(&mut self, path: &str, file: &Path) -> Result<()> {
        (**self).put_file(path, file)
    }
    fn get_file(&mut self, path: &str, to: &Path) -> Result<bool> {
        (**self).get_file(path, to)
    }
    fn list(&mut self, folder: &str) -> Result<Vec<String>> {
        (**self).list(folder)
    }
    fn list_sizes(&mut self, folder: &str) -> Result<Vec<(String, Option<u64>)>> {
        (**self).list_sizes(folder)
    }
    fn remove(&mut self, path: &str) -> Result<()> {
        (**self).remove(path)
    }
    fn read_range(&mut self, path: &str, start: u64, end: u64) -> Result<Option<(Vec<u8>, u64)>> {
        (**self).read_range(path, start, end)
    }
    fn news(&mut self, mine: &str) -> Result<Option<bool>> {
        (**self).news(mine)
    }
}

#[derive(Serialize, Deserialize)]
struct Marker {
    tbv: u32,
    /// The library's wake-up name for the push server (see `Remote::wake_key`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    wake: Option<String>,
}

/// A fresh wake-up name: 32 random letters and digits.
fn new_wake_key() -> String {
    uuid::Uuid::new_v4().simple().to_string()
}

#[derive(Serialize, Deserialize)]
struct Batch {
    records: Vec<Record>,
}

/// What a device tells the others: how far its changes go, and how many
/// books it has, so another device can tell when it's behind.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct DeviceNote {
    written: u64,
    books: u64,
    #[serde(default)]
    label: String,
    at: String,
}

/// Change file names: numbers padded so they sort as text too.
fn batch_name(n: u64) -> String {
    format!("{n:010}.json")
}

fn batch_number(name: &str) -> Option<u64> {
    name.strip_suffix(".json")?.parse().ok()
}

/// Whether a name in changes/ or devices/ is a device TBV made (its ids are
/// letters, digits and dashes). A cloud app's copy of a file it thinks
/// clashed ("<id> (1).json", "<id> 2.json") isn't one, and that copy would
/// never catch up.
fn is_device(name: &str) -> bool {
    !name.is_empty() && !name.starts_with('.') && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Whether a file that changed in a synced library folder is news from
/// another device: a change batch or device note of a device other than
/// `mine`. TBV's own writes, half-written files and cloud apps' clash
/// copies aren't, so watching the folder never sets off sync by itself.
pub fn is_news_from_elsewhere(path: &Path, mine: &str) -> bool {
    let parts: Vec<String> = path.components().map(|c| c.as_os_str().to_string_lossy().into_owned()).collect();
    let Some(at) = parts.iter().rposition(|p| p == "changes" || p == "devices") else { return false };
    let rest = &parts[at + 1..];
    let (device, file) = match (parts[at].as_str(), rest) {
        ("changes", [device, file]) => (device.as_str(), file.as_str()),
        ("devices", [file]) => (file.strip_suffix(".json").unwrap_or(""), file.as_str()),
        _ => return false,
    };
    is_device(device) && device != mine && file.ends_with(".json") && !file.starts_with('.')
}

/// The `Remote` the sync engine talks to, over any `Store`.
pub struct FileRemote<S: Store> {
    store: S,
    device: String,
    /// The number the next batch from this device gets, once known.
    next: Option<u64>,
    /// The library's wake-up name, once read.
    wake: Option<String>,
}

impl<S: Store> FileRemote<S> {
    pub fn new(store: S, device: String) -> Self {
        Self { store, device, next: None, wake: None }
    }

    /// Makes sure the place is a TBV library, marking it as one if it's new.
    /// Returns whether it already held a library (from another device).
    pub fn prepare(&mut self) -> Result<bool> {
        if let Some(bytes) = self.store.read(MARKER)? {
            let marker = serde_json::from_slice::<Marker>(&bytes)
                .map_err(|_| Error::Unsuitable("that folder has a library.json TBV didn't write. Choose another folder.".into()))?;
            self.wake = marker.wake;
            return Ok(true);
        }
        let marker = Marker { tbv: 1, wake: Some(new_wake_key()) };
        self.store.write(MARKER, &serde_json::to_vec(&marker)?)?;
        self.wake = marker.wake;
        Ok(false)
    }

    fn next_number(&mut self) -> Result<u64> {
        if let Some(n) = self.next {
            return Ok(n);
        }
        let mine = self.store.list(&format!("{CHANGES}{}/", self.device))?;
        let n = mine.iter().filter_map(|name| batch_number(name)).max().unwrap_or(0) + 1;
        self.next = Some(n);
        Ok(n)
    }
}

impl<S: Store + Send> Remote for FileRemote<S> {
    fn wake_key(&mut self) -> Result<Option<String>> {
        if self.wake.is_none() {
            // A library made before wake-up names: it gets one now. Should
            // two devices do this at once, the one written last stands, and
            // both read it next time.
            let marker = Marker { tbv: 1, wake: Some(new_wake_key()) };
            self.store.write(MARKER, &serde_json::to_vec(&marker)?)?;
            self.wake = marker.wake;
        }
        Ok(self.wake.clone())
    }
    fn push(&mut self, records: &[Record]) -> Result<()> {
        if records.is_empty() {
            return Ok(());
        }
        let n = self.next_number()?;
        let path = format!("{CHANGES}{}/{}", self.device, batch_name(n));
        self.store.write(&path, &serde_json::to_vec(&Batch { records: records.to_vec() })?)?;
        self.next = Some(n + 1);
        Ok(())
    }

    /// The cursor is each other device's last batch read, as JSON. A batch
    /// that's missing or can't be read yet (its cloud app is still bringing
    /// it down) stops that device there until next time.
    fn pull(&mut self, after: &str, limit: usize) -> Result<Page> {
        let mut read: BTreeMap<String, u64> = if after.is_empty() { BTreeMap::new() } else { serde_json::from_str(after).unwrap_or_default() };
        let mut records = Vec::new();
        let mut devices: Vec<String> = self.store.list(CHANGES)?.into_iter().map(|d| d.trim_end_matches('/').to_string()).collect();
        devices.retain(|d| *d != self.device && is_device(d));
        devices.sort();
        'devices: for device in devices {
            let done = read.get(&device).copied().unwrap_or(0);
            let mut waiting: Vec<u64> =
                self.store.list(&format!("{CHANGES}{device}/"))?.iter().filter_map(|name| batch_number(name)).filter(|&n| n > done).collect();
            waiting.sort_unstable();
            for n in waiting {
                if records.len() >= limit {
                    break 'devices;
                }
                // A gap means a batch hasn't arrived yet; wait for it rather
                // than read past it.
                if n != read.get(&device).copied().unwrap_or(0) + 1 {
                    break;
                }
                let Some(bytes) = self.store.read(&format!("{CHANGES}{device}/{}", batch_name(n)))? else { break };
                let Ok(batch) = serde_json::from_slice::<Batch>(&bytes) else { break };
                records.extend(batch.records);
                read.insert(device.clone(), n);
            }
        }
        Ok(Page { records, cursor: serde_json::to_string(&read)? })
    }

    fn upload(&mut self, path: &str, file: &Path) -> Result<()> {
        self.store.put_file(path, file)
    }

    fn download(&mut self, path: &str, to: &Path) -> Result<bool> {
        self.store.get_file(path, to)
    }

    fn list(&mut self, folder: &str) -> Result<Vec<String>> {
        self.store.list(folder)
    }

    fn list_sizes(&mut self, folder: &str) -> Result<Vec<(String, Option<u64>)>> {
        self.store.list_sizes(folder)
    }

    fn remove(&mut self, path: &str) -> Result<()> {
        self.store.remove(path)
    }

    fn read_range(&mut self, path: &str, start: u64, end: u64) -> Result<Option<(Vec<u8>, u64)>> {
        self.store.read_range(path, start, end)
    }

    fn note_this_device(&mut self, books: u64, label: &str) -> Result<()> {
        let written = self.next_number()? - 1;
        let path = format!("{DEVICES}{}.json", self.device);
        let before = self.store.read(&path)?.and_then(|b| serde_json::from_slice::<DeviceNote>(&b).ok());
        if before.is_some_and(|b| b.written == written && b.books == books && b.label == label) {
            return Ok(());
        }
        let note = DeviceNote { written, books, label: label.into(), at: crate::time::now_utc() };
        self.store.write(&path, &serde_json::to_vec(&note)?)
    }

    fn behind(&mut self, cursor: &str) -> Result<Vec<super::Behind>> {
        let read: BTreeMap<String, u64> = serde_json::from_str(cursor).unwrap_or_default();
        let mut behind = Vec::new();
        for name in self.store.list(DEVICES)? {
            let Some(device) = name.strip_suffix(".json") else { continue };
            if device == self.device || !is_device(device) {
                continue;
            }
            let Some(note) = self.store.read(&format!("{DEVICES}{name}"))?.and_then(|b| serde_json::from_slice::<DeviceNote>(&b).ok()) else {
                continue;
            };
            let done = read.get(device).copied().unwrap_or(0);
            if note.written > done {
                behind.push(super::Behind { label: note.label, read: done, written: note.written, books: note.books });
            }
        }
        Ok(behind)
    }
}

/// A folder on this computer, usually one a cloud app keeps in sync.
pub struct FolderStore {
    root: PathBuf,
}

/// TBV's library folder for a chosen folder: the one inside it, or the
/// chosen folder itself when that is a library folder.
fn root_in(chosen: &Path) -> PathBuf {
    let inside = chosen.join(LIBRARY_FOLDER);
    let is_library = chosen.file_name().is_some_and(|n| n == LIBRARY_FOLDER) && !inside.exists();
    if is_library { chosen.to_path_buf() } else { inside }
}

/// The library folder in `chosen`, if it's there now.
pub fn library_root(chosen: &Path) -> Option<PathBuf> {
    Some(root_in(chosen)).filter(|root| root.is_dir())
}

impl FolderStore {
    /// TBV's library folder inside `chosen`. The chosen folder must exist,
    /// since a missing one usually means its cloud app isn't running.
    /// The library folder itself can be chosen too (the iPhone app can only
    /// open the folder picked in Files).
    pub fn open(chosen: &Path) -> Result<Self> {
        if !chosen.is_dir() {
            return Err(Error::Offline(format!(
                "the folder {} can't be found. Is its cloud app installed and signed in?",
                chosen.display()
            )));
        }
        let root = root_in(chosen);
        fs::create_dir_all(&root)?;
        Ok(Self { root })
    }

    fn at(&self, path: &str) -> PathBuf {
        path.split('/').filter(|p| !p.is_empty() && *p != "..").fold(self.root.clone(), |acc, p| acc.join(p))
    }

    /// Writes beside the target and renames, so the cloud app never picks
    /// up half a file.
    fn replace(&self, path: &str, write: impl FnOnce(&Path) -> Result<()>) -> Result<()> {
        let target = self.at(path);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)?;
        }
        let name = target.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        let partial = target.with_file_name(format!(".{name}.tbv-partial"));
        let written = write(&partial).and_then(|_| fs::rename(&partial, &target).map_err(Error::from));
        if written.is_err() {
            let _ = fs::remove_file(&partial);
        }
        written
    }
}

impl Store for FolderStore {
    fn read(&mut self, path: &str) -> Result<Option<Vec<u8>>> {
        let at = self.at(path);
        if path.starts_with(DEVICES) {
            refresh(&at);
        }
        bring_down(&at);
        match fs::read(at) {
            Ok(bytes) => Ok(Some(bytes)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    fn write(&mut self, path: &str, bytes: &[u8]) -> Result<()> {
        self.replace(path, |to| {
            let mut file = fs::File::create(to)?;
            file.write_all(bytes)?;
            file.sync_all()?;
            Ok(())
        })
    }

    fn put_file(&mut self, path: &str, file: &Path) -> Result<()> {
        self.replace(path, |to| {
            fs::copy(file, to)?;
            Ok(())
        })
    }

    fn get_file(&mut self, path: &str, to: &Path) -> Result<bool> {
        let from = self.at(path);
        // A book is asked about by name; other files (covers) just as they are.
        if path.starts_with("books/") {
            bring_down_expected(&from);
        } else {
            bring_down(&from);
        }
        if !from.is_file() {
            return Ok(false);
        }
        fs::copy(from, to)?;
        Ok(true)
    }

    fn list(&mut self, folder: &str) -> Result<Vec<String>> {
        if kept_fresh(folder) {
            refresh(&self.at(folder));
        }
        let entries = match fs::read_dir(self.at(folder)) {
            Ok(entries) => entries,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(e) => return Err(e.into()),
        };
        let mut names = Vec::new();
        let mut not_here = Vec::new();
        for entry in entries {
            let name = entry?.file_name().to_string_lossy().into_owned();
            if let Some(real) = stood_in_for(&name) {
                not_here.push(real.to_string());
            // Half-written files, and the cloud apps' own bookkeeping.
            } else if !name.starts_with('.') && !name.ends_with(".tbv-partial") && !name.eq_ignore_ascii_case("desktop.ini") {
                names.push(name);
            }
        }
        // Files iCloud hasn't brought down yet are still there.
        for real in not_here {
            if !real.ends_with(".tbv-partial") && !names.contains(&real) {
                names.push(real);
            }
        }
        Ok(names)
    }

    fn list_sizes(&mut self, folder: &str) -> Result<Vec<(String, Option<u64>)>> {
        let dir = self.at(folder);
        Ok(self.list(folder)?.into_iter().map(|name| {
            let size = fs::metadata(dir.join(&name)).ok().filter(|m| m.is_file()).map(|m| m.len());
            (name, size)
        }).collect())
    }

    fn remove(&mut self, path: &str) -> Result<()> {
        match fs::remove_file(self.at(path)) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.into()),
            _ => Ok(()),
        }
    }

    /// Reading part of a file in a cloud app's folder makes that app fetch
    /// it, as it would for any program; TBV doesn't keep a copy.
    fn read_range(&mut self, path: &str, start: u64, end: u64) -> Result<Option<(Vec<u8>, u64)>> {
        use std::io::{Read, Seek, SeekFrom};
        let at = self.at(path);
        bring_down(&at);
        let mut file = match fs::File::open(at) {
            Ok(file) => file,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(e) => return Err(e.into()),
        };
        let len = file.metadata()?.len();
        if start >= len {
            return Ok(Some((Vec::new(), len)));
        }
        file.seek(SeekFrom::Start(start))?;
        let mut bytes = Vec::new();
        file.take(end.min(len - 1) + 1 - start).read_to_end(&mut bytes)?;
        Ok(Some((bytes, len)))
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::model::IsoUtc;

    fn record(n: u32) -> Record {
        Record { kind: "book".into(), key: format!("[\"sha256:{n}\"]"), data: None, changed_at: IsoUtc::from(format!("2026-10-17T00:00:{n:02}.000Z")) }
    }

    #[test]
    fn a_device_knows_when_another_has_changes_it_hasnt_read() {
        let dir = tempfile::tempdir().unwrap();
        let mut a = FileRemote::new(FolderStore::open(dir.path()).unwrap(), "device-a".into());
        let mut b = FileRemote::new(FolderStore::open(dir.path()).unwrap(), "device-b".into());
        a.prepare().unwrap();
        a.push(&[record(1)]).unwrap();
        a.push(&[record(2)]).unwrap();
        a.note_this_device(3050, "Windows PC").unwrap();

        let page = b.pull("", 500).unwrap();
        assert!(b.behind(&page.cursor).unwrap().is_empty(), "read everything");

        // A batch the cloud app hasn't brought here yet.
        a.push(&[record(3)]).unwrap();
        a.note_this_device(3049, "Windows PC").unwrap();
        fs::remove_file(dir.path().join(LIBRARY_FOLDER).join("changes/device-a/0000000003.json")).unwrap();
        let page = b.pull(&page.cursor, 500).unwrap();
        assert!(page.records.is_empty());
        let behind = b.behind(&page.cursor).unwrap();
        assert_eq!((behind.len(), behind[0].read, behind[0].written, behind[0].books), (1, 2, 3, 3049));
    }

    #[test]
    fn only_other_devices_files_count_as_news() {
        let root = Path::new("/cloud/The Bound Vigil");
        assert!(is_news_from_elsewhere(&root.join("changes/device-b/0000000004.json"), "device-a"));
        assert!(is_news_from_elsewhere(&root.join("devices/device-b.json"), "device-a"));
        assert!(!is_news_from_elsewhere(&root.join("changes/device-a/0000000004.json"), "device-a"));
        assert!(!is_news_from_elsewhere(&root.join("devices/device-a.json"), "device-a"));
        assert!(!is_news_from_elsewhere(&root.join("changes/device-b/.0000000004.json.tbv-partial"), "device-a"));
        assert!(!is_news_from_elsewhere(&root.join("devices/device-b (1).json"), "device-a"));
        assert!(!is_news_from_elsewhere(&root.join("covers/abc.jpg"), "device-a"));
        assert!(!is_news_from_elsewhere(&root.join("changes/device-b"), "device-a"));
    }

    #[test]
    fn a_change_in_another_devices_stamp_is_news() {
        let stamp = |pairs: &[(&str, &str)]| pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect::<BTreeMap<_, _>>();
        let mut seen = None;
        assert!(!stamps_changed(&mut seen, stamp(&[("changes/device-b", "10")])), "the first look only notes things");
        assert!(!stamps_changed(&mut seen, stamp(&[("changes/device-b", "10")])));
        assert!(stamps_changed(&mut seen, stamp(&[("changes/device-b", "12")])));
        assert!(stamps_changed(&mut seen, stamp(&[("changes/device-b", "12"), ("devices/device-c.json", "1")])));
        assert!(!stamps_changed(&mut seen, stamp(&[("changes/device-b", "12")])), "something gone isn't news");
        assert!(watched("changes", "device-b", "device-a"));
        assert!(!watched("changes", "device-a", "device-a"));
        assert!(!watched("changes", "device-b (1)", "device-a"));
        assert!(watched("devices", "device-b.json", "device-a"));
        assert!(!watched("devices", "device-a.json", "device-a"));
    }

    #[test]
    fn a_cloud_apps_copy_of_a_device_note_is_not_another_device() {
        let dir = tempfile::tempdir().unwrap();
        let mut a = FileRemote::new(FolderStore::open(dir.path()).unwrap(), "device-a".into());
        let mut b = FileRemote::new(FolderStore::open(dir.path()).unwrap(), "device-b".into());
        a.prepare().unwrap();
        a.push(&[record(1)]).unwrap();
        a.note_this_device(10, "Windows PC").unwrap();
        let root = dir.path().join(LIBRARY_FOLDER);
        fs::copy(root.join("devices/device-a.json"), root.join("devices/device-a (1).json")).unwrap();
        fs::copy(root.join("devices/device-a.json"), root.join("devices/device-b 2.json")).unwrap();
        fs::create_dir_all(root.join("changes/device-a (1)")).unwrap();
        fs::copy(root.join("changes/device-a/0000000001.json"), root.join("changes/device-a (1)/0000000001.json")).unwrap();

        let page = b.pull("", 500).unwrap();
        assert_eq!(page.records.len(), 1, "the copy's changes aren't read twice");
        assert!(b.behind(&page.cursor).unwrap().is_empty(), "nor counted as a device that's ahead");
        assert!(a.behind("").unwrap().is_empty(), "a's own copy doesn't make a look behind itself");
    }

    #[test]
    fn devices_read_each_others_changes_once() {
        let dir = tempfile::tempdir().unwrap();
        let mut a = FileRemote::new(FolderStore::open(dir.path()).unwrap(), "device-a".into());
        let mut b = FileRemote::new(FolderStore::open(dir.path()).unwrap(), "device-b".into());
        assert!(!a.prepare().unwrap(), "a new folder");
        assert!(b.prepare().unwrap(), "the library a made");

        a.push(&[record(1), record(2)]).unwrap();
        a.push(&[record(3)]).unwrap();
        b.push(&[record(4)]).unwrap();

        let page = b.pull("", 500).unwrap();
        assert_eq!(page.records, [record(1), record(2), record(3)], "b reads a's changes, not its own");
        assert!(b.pull(&page.cursor, 500).unwrap().records.is_empty());
        let page = a.pull("", 500).unwrap();
        assert_eq!(page.records, [record(4)]);

        // A batch still on its way down (half there) waits for next time.
        fs::write(dir.path().join(LIBRARY_FOLDER).join("changes/device-a/0000000003.json"), b"{\"rec").unwrap();
        let cursor = b.pull("", 500).unwrap().cursor;
        assert_eq!(cursor, r#"{"device-a":2}"#);

        // A batch that turns up before an earlier one waits for it.
        fs::remove_file(dir.path().join(LIBRARY_FOLDER).join("changes/device-a/0000000003.json")).unwrap();
        a.push(&[record(6)]).unwrap();
        let batches = dir.path().join(LIBRARY_FOLDER).join("changes/device-a");
        fs::rename(batches.join("0000000003.json"), dir.path().join("held.json")).unwrap();
        a.push(&[record(7)]).unwrap();
        let page = b.pull(r#"{"device-a":2}"#, 500).unwrap();
        assert!(page.records.is_empty(), "batch 4 isn't read past the missing 3");
        assert_eq!(page.cursor, r#"{"device-a":2}"#);
        fs::rename(dir.path().join("held.json"), batches.join("0000000003.json")).unwrap();
        assert_eq!(b.pull(&page.cursor, 500).unwrap().records, [record(6), record(7)]);

        // Numbering carries on after a restart.
        let mut again = FileRemote::new(FolderStore::open(dir.path()).unwrap(), "device-b".into());
        again.push(&[record(5)]).unwrap();
        assert!(dir.path().join(LIBRARY_FOLDER).join("changes/device-b/0000000002.json").is_file());
    }

    #[test]
    fn every_device_shares_one_wake_up_name() {
        let dir = tempfile::tempdir().unwrap();
        let mut first = FileRemote::new(FolderStore::open(dir.path()).unwrap(), "device-a".into());
        assert!(!first.prepare().unwrap());
        let key = first.wake_key().unwrap().unwrap();
        assert_eq!(key.len(), 32);
        let mut second = FileRemote::new(FolderStore::open(dir.path()).unwrap(), "device-b".into());
        assert!(second.prepare().unwrap());
        assert_eq!(second.wake_key().unwrap(), Some(key));

        // A library from before wake-up names gets one, kept from then on.
        let old = tempfile::tempdir().unwrap();
        FolderStore::open(old.path()).unwrap().write(MARKER, br#"{"tbv":1}"#).unwrap();
        let mut device = FileRemote::new(FolderStore::open(old.path()).unwrap(), "device-a".into());
        assert!(device.prepare().unwrap());
        let made = device.wake_key().unwrap().unwrap();
        let mut later = FileRemote::new(FolderStore::open(old.path()).unwrap(), "device-b".into());
        later.prepare().unwrap();
        assert_eq!(later.wake_key().unwrap(), Some(made));
    }

    #[test]
    fn files_go_in_whole_and_come_back() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = FolderStore::open(dir.path()).unwrap();
        let source = dir.path().join("cover.jpg");
        fs::write(&source, b"picture").unwrap();
        store.put_file("covers/abc.jpg", &source).unwrap();
        assert_eq!(store.list("covers/").unwrap(), ["abc.jpg"]);
        let back = dir.path().join("back.jpg");
        assert!(store.get_file("covers/abc.jpg", &back).unwrap());
        assert_eq!(fs::read(back).unwrap(), b"picture");
        assert!(!store.get_file("covers/none.jpg", &dir.path().join("x")).unwrap());
        assert!(store.list("books/").unwrap().is_empty());
        assert!(FolderStore::open(&dir.path().join("missing")).is_err());
    }

    #[test]
    fn the_library_folder_itself_can_be_chosen() {
        let dir = tempfile::tempdir().unwrap();
        let library = dir.path().join(LIBRARY_FOLDER);
        fs::create_dir(&library).unwrap();
        let mut store = FolderStore::open(&library).unwrap();
        store.write("library.json", b"{}").unwrap();
        assert!(library.join("library.json").is_file());
        assert!(!library.join(LIBRARY_FOLDER).exists());
    }

    #[test]
    fn files_icloud_has_not_brought_down_are_listed_and_fetched() {
        // Stands in for iCloud: bringing a file down replaces its stand-in.
        fn fetch(path: &Path) -> bool {
            fs::rename(stand_in(path).unwrap(), path).is_ok()
        }
        set_fetcher(fetch);
        let dir = tempfile::tempdir().unwrap();
        let mut store = FolderStore::open(dir.path()).unwrap();
        let covers = dir.path().join(LIBRARY_FOLDER).join("covers");
        fs::create_dir_all(&covers).unwrap();
        fs::write(covers.join("here.jpg"), b"here").unwrap();
        fs::write(covers.join(".away.jpg.icloud"), b"away").unwrap();
        let mut names = store.list("covers/").unwrap();
        names.sort();
        assert_eq!(names, ["away.jpg", "here.jpg"]);
        assert_eq!(store.read("covers/away.jpg").unwrap().unwrap(), b"away");
    }
}

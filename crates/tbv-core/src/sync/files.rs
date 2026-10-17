//! Sync through plain files: a folder that a cloud app keeps in step (iCloud
//! Drive, Dropbox, Google Drive, OneDrive, MEGA and the like), or a WebDAV
//! server. There is no server to number changes, so each device writes only
//! its own numbered change files, and never edits or deletes another
//! device's. Two devices can't write the same file at once, which is what
//! keeps a synced folder from making "conflicted copies".
//!
//! ```text
//! The Bound Vigil/
//!   library.json              marks the folder as a TBV library
//!   changes/<device>/0000000001.json   a batch of records, never changed
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
}

#[derive(Serialize, Deserialize)]
struct Marker {
    tbv: u32,
}

#[derive(Serialize, Deserialize)]
struct Batch {
    records: Vec<Record>,
}

/// Change file names: numbers padded so they sort as text too.
fn batch_name(n: u64) -> String {
    format!("{n:010}.json")
}

fn batch_number(name: &str) -> Option<u64> {
    name.strip_suffix(".json")?.parse().ok()
}

/// The `Remote` the sync engine talks to, over any `Store`.
pub struct FileRemote<S: Store> {
    store: S,
    device: String,
    /// The number the next batch from this device gets, once known.
    next: Option<u64>,
}

impl<S: Store> FileRemote<S> {
    pub fn new(store: S, device: String) -> Self {
        Self { store, device, next: None }
    }

    /// Makes sure the place is a TBV library, marking it as one if it's new.
    /// Returns whether it already held a library (from another device).
    pub fn prepare(&mut self) -> Result<bool> {
        if let Some(bytes) = self.store.read(MARKER)? {
            serde_json::from_slice::<Marker>(&bytes)
                .map_err(|_| Error::Unsuitable("that folder has a library.json TBV didn't write. Choose another folder.".into()))?;
            return Ok(true);
        }
        self.store.write(MARKER, &serde_json::to_vec(&Marker { tbv: 1 })?)?;
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

impl<S: Store> Remote for FileRemote<S> {
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
    /// that can't be read yet (its cloud app is still bringing it down) stops
    /// that device there until next time.
    fn pull(&mut self, after: &str, limit: usize) -> Result<Page> {
        let mut read: BTreeMap<String, u64> = if after.is_empty() { BTreeMap::new() } else { serde_json::from_str(after).unwrap_or_default() };
        let mut records = Vec::new();
        let mut devices: Vec<String> = self.store.list(CHANGES)?.into_iter().map(|d| d.trim_end_matches('/').to_string()).collect();
        devices.retain(|d| *d != self.device && !d.is_empty() && !d.starts_with('.'));
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
}

/// A folder on this computer, usually one a cloud app keeps in sync.
pub struct FolderStore {
    root: PathBuf,
}

impl FolderStore {
    /// TBV's library folder inside `chosen`. The chosen folder must exist,
    /// since a missing one usually means its cloud app isn't running.
    pub fn open(chosen: &Path) -> Result<Self> {
        if !chosen.is_dir() {
            return Err(Error::Offline(format!(
                "the folder {} can't be found. Is its cloud app installed and signed in?",
                chosen.display()
            )));
        }
        let root = chosen.join(LIBRARY_FOLDER);
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
        match fs::read(self.at(path)) {
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
        if !from.is_file() {
            return Ok(false);
        }
        fs::copy(from, to)?;
        Ok(true)
    }

    fn list(&mut self, folder: &str) -> Result<Vec<String>> {
        let entries = match fs::read_dir(self.at(folder)) {
            Ok(entries) => entries,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(e) => return Err(e.into()),
        };
        let mut names = Vec::new();
        for entry in entries {
            let name = entry?.file_name().to_string_lossy().into_owned();
            // Half-written files, and the cloud apps' own bookkeeping.
            if !name.starts_with('.') && !name.ends_with(".tbv-partial") && !name.eq_ignore_ascii_case("desktop.ini") {
                names.push(name);
            }
        }
        Ok(names)
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

        // Numbering carries on after a restart.
        let mut again = FileRemote::new(FolderStore::open(dir.path()).unwrap(), "device-b".into());
        again.push(&[record(5)]).unwrap();
        assert!(dir.path().join(LIBRARY_FOLDER).join("changes/device-b/0000000002.json").is_file());
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
}

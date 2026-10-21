//! The list of files being brought down from servers, kept on disk so a
//! crash loses nothing: after one, files already down are added to the
//! library, and the rest are fetched again. A downloaded file is only deleted
//! once its book is in the library.
//!
//! This is the bookkeeping only; the app runs the downloads (a few at once)
//! and hands what's ready to the import queue.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::Planned;
use crate::error::Result;
use crate::model::IsoUtc;

const FILE: &str = "queue.json";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FileState {
    Waiting,
    Downloading,
    /// Down, and waiting for the rest of its audiobook.
    Downloaded,
    /// With the import queue.
    Importing,
    /// In the library (or found there already); its download is gone.
    Done,
    Failed,
}

/// One file from a server.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueuedFile {
    pub id: u64,
    /// The "Bring in" it came from: its own folder under the downloads folder.
    pub batch: String,
    pub server_id: String,
    pub server_name: String,
    pub remote: String,
    /// Where it goes, inside the batch's folder.
    pub local: PathBuf,
    /// Its name, for the page.
    pub name: String,
    pub size: u64,
    pub bytes_done: u64,
    pub state: FileState,
    pub error: Option<String>,
    pub started_at: Option<IsoUtc>,
    pub finished_at: Option<IsoUtc>,
}

/// Something ready for the import queue: a file, a folder that's one
/// audiobook, or one audiobook among several in a folder. `ids` are the
/// queued files it's made of.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Ready {
    pub source: PathBuf,
    pub ids: Vec<u64>,
}

/// How the list stands, in counts.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueCounts {
    pub total: usize,
    pub waiting: usize,
    pub downloading: usize,
    /// Down and on their way into the library.
    pub downloaded: usize,
    pub done: usize,
    pub failed: usize,
    pub bytes_total: u64,
    pub bytes_done: u64,
}

#[derive(Debug, Default)]
pub struct Queue {
    dir: PathBuf,
    files: Vec<QueuedFile>,
    next_id: u64,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Saved {
    next_id: u64,
    files: Vec<QueuedFile>,
}

impl Queue {
    /// The list as it was left in `dir` (TBV's "Server downloads" folder).
    /// Downloads cut off part-way start again, files waiting to be added are
    /// added again, and folders nothing refers to are removed.
    pub fn open(dir: &Path) -> Self {
        let saved: Option<Saved> = fs::read(dir.join(FILE)).ok().and_then(|b| serde_json::from_slice(&b).ok());
        let mut queue = Self { dir: dir.to_path_buf(), ..Default::default() };
        if let Some(saved) = saved {
            queue.next_id = saved.next_id;
            queue.files = saved.files.into_iter().filter(|f| f.state != FileState::Done).collect();
        }
        for file in &mut queue.files {
            let path = dir.join(&file.batch).join(&file.local);
            match file.state {
                FileState::Downloading => {
                    let _ = fs::remove_file(partial(&path));
                    file.state = FileState::Waiting;
                    file.bytes_done = 0;
                    file.started_at = None;
                }
                FileState::Downloaded | FileState::Importing if !path.exists() => {
                    file.state = FileState::Waiting;
                    file.bytes_done = 0;
                }
                FileState::Importing => file.state = FileState::Downloaded,
                _ => {}
            }
        }
        // Anything else in the folder is left from an older TBV, or finished.
        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().into_owned();
                if name != FILE && !queue.files.iter().any(|f| f.batch == name) {
                    let _ = fs::remove_dir_all(entry.path()).or_else(|_| fs::remove_file(entry.path()));
                }
            }
        }
        let _ = queue.save();
        queue
    }

    pub fn save(&self) -> Result<()> {
        fs::create_dir_all(&self.dir)?;
        let saved = Saved { next_id: self.next_id, files: self.files.clone() };
        let temp = self.dir.join(format!("{FILE}.new"));
        fs::write(&temp, serde_json::to_vec(&saved)?)?;
        fs::rename(&temp, self.dir.join(FILE))?;
        Ok(())
    }

    pub fn files(&self) -> &[QueuedFile] {
        &self.files
    }

    pub fn file(&self, id: u64) -> Option<&QueuedFile> {
        self.files.iter().find(|f| f.id == id)
    }

    /// Where a queued file goes on this computer.
    pub fn path_of(&self, file: &QueuedFile) -> PathBuf {
        self.dir.join(&file.batch).join(&file.local)
    }

    /// Adds what a "Bring in" found, all waiting. Returns how many.
    pub fn add(&mut self, server_id: &str, server_name: &str, planned: Vec<Planned>) -> Result<usize> {
        let batch = crate::ids::new_record_id();
        fs::create_dir_all(self.dir.join(&batch))?;
        let count = planned.len();
        for p in planned {
            self.next_id += 1;
            self.files.push(QueuedFile {
                id: self.next_id,
                batch: batch.clone(),
                server_id: server_id.to_string(),
                server_name: server_name.to_string(),
                name: p.local.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
                remote: p.remote,
                local: p.local,
                size: p.size,
                bytes_done: 0,
                state: FileState::Waiting,
                error: None,
                started_at: None,
                finished_at: None,
            });
        }
        self.save()?;
        Ok(count)
    }

    /// The next file to bring down, now marked as coming down.
    pub fn claim(&mut self) -> Option<QueuedFile> {
        let file = self.files.iter_mut().find(|f| f.state == FileState::Waiting)?;
        file.state = FileState::Downloading;
        file.bytes_done = 0;
        file.error = None;
        file.started_at = Some(crate::time::now_utc());
        file.finished_at = None;
        let claimed = file.clone();
        let _ = self.save();
        Some(claimed)
    }

    /// How much of a file has come down. Not saved: a cut-off download starts over anyway.
    /// False if the file is no longer wanted, so the download should stop.
    pub fn progress(&mut self, id: u64, bytes: u64) -> bool {
        match self.files.iter_mut().find(|f| f.id == id) {
            Some(f) if f.state == FileState::Downloading => {
                f.bytes_done = bytes;
                f.size = f.size.max(bytes);
                true
            }
            _ => false,
        }
    }

    /// A download ended: with the file's size, or why it couldn't come down.
    pub fn finished(&mut self, id: u64, outcome: std::result::Result<u64, String>) {
        let Some(file) = self.files.iter_mut().find(|f| f.id == id) else { return };
        if file.state != FileState::Downloading {
            return;
        }
        file.finished_at = Some(crate::time::now_utc());
        match outcome {
            Ok(size) => {
                file.state = FileState::Downloaded;
                file.size = size;
                file.bytes_done = size;
            }
            Err(why) => {
                file.state = FileState::Failed;
                file.error = Some(why);
            }
        }
        let _ = self.save();
    }

    /// What's down and can go to the import queue now, marked as importing.
    /// The parts of an audiobook wait for each other, so it's added whole;
    /// a folder holding several audiobooks gives each its own.
    pub fn ready(&mut self) -> Vec<Ready> {
        let mut out = Vec::new();
        let downloaded: Vec<QueuedFile> = self.files.iter().filter(|f| f.state == FileState::Downloaded).cloned().collect();
        let mut seen_folders: Vec<(String, PathBuf)> = Vec::new();
        // Files moved into a folder of their own, with where they are now.
        let mut moved: Vec<(u64, PathBuf)> = Vec::new();
        for file in downloaded {
            let path = self.path_of(&file);
            if !crate::audio::is_part(&path) {
                out.push(Ready { source: path, ids: vec![file.id] });
                continue;
            }
            let folder = file.local.parent().map(Path::to_path_buf).unwrap_or_default();
            if seen_folders.iter().any(|(b, f)| *b == file.batch && *f == folder) {
                continue;
            }
            seen_folders.push((file.batch.clone(), folder.clone()));
            let siblings: Vec<&QueuedFile> = self
                .files
                .iter()
                .filter(|f| f.batch == file.batch && f.local.parent() == Some(folder.as_path()) && crate::audio::is_part(&f.local))
                .collect();
            // Wait for the other parts; one that failed holds them all until it's tried again or removed.
            if siblings.iter().any(|f| !matches!(f.state, FileState::Downloaded)) {
                continue;
            }
            let dir = self.dir.join(&file.batch).join(&folder);
            let id_of = |part: &Path| siblings.iter().find(|f| self.path_of(f) == part).map(|f| f.id);
            let books = crate::audio::folder_books(&dir);
            let several = books.len() > 1;
            for (name, parts) in books {
                let ids: Vec<u64> = parts.iter().filter_map(|p| id_of(p)).collect();
                let source = match parts.len() {
                    1 => parts[0].clone(),
                    // Each of several audiobooks gets a folder of its own now,
                    // so one being added (and its files going) can't change
                    // how the folder's others are told apart.
                    _ if several => match own_folder(&dir, &name, &parts) {
                        Some((sub, now)) => {
                            for (part, at) in parts.iter().zip(now) {
                                if let Some(id) = id_of(part) {
                                    moved.push((id, folder.join(sub.file_name().unwrap_or_default()).join(at.file_name().unwrap_or_default())));
                                }
                            }
                            sub
                        }
                        None => crate::audio::group_path(&dir, &name),
                    },
                    _ => dir.clone(),
                };
                out.push(Ready { source, ids });
            }
        }
        for (id, local) in moved {
            if let Some(file) = self.files.iter_mut().find(|f| f.id == id) {
                file.local = local;
            }
        }
        let handed: Vec<u64> = out.iter().flat_map(|r| r.ids.iter().copied()).collect();
        for file in self.files.iter_mut().filter(|f| handed.contains(&f.id)) {
            file.state = FileState::Importing;
        }
        if !out.is_empty() {
            let _ = self.save();
        }
        out
    }

    /// These files' books are in the library: their downloads go, and a
    /// batch's folder goes with its last file.
    pub fn imported(&mut self, ids: &[u64]) {
        for file in self.files.iter_mut().filter(|f| ids.contains(&f.id) && f.state == FileState::Importing) {
            file.state = FileState::Done;
            let _ = fs::remove_file(self.dir.join(&file.batch).join(&file.local));
        }
        self.tidy_batches();
        let _ = self.save();
    }

    /// Tries a failed file again.
    pub fn retry(&mut self, id: u64) {
        if let Some(file) = self.files.iter_mut().find(|f| f.id == id && f.state == FileState::Failed) {
            file.state = FileState::Waiting;
            file.error = None;
            file.bytes_done = 0;
        }
        let _ = self.save();
    }

    /// Takes a file off the list (one waiting, coming down or failed).
    pub fn remove(&mut self, id: u64) {
        self.drop_where(|f| f.id == id && matches!(f.state, FileState::Waiting | FileState::Downloading | FileState::Failed));
    }

    /// Takes every file not yet down off the list.
    pub fn cancel(&mut self) {
        self.drop_where(|f| matches!(f.state, FileState::Waiting | FileState::Downloading));
    }

    /// Clears finished files (and failed ones) from the list.
    pub fn clear_finished(&mut self) {
        self.drop_where(|f| matches!(f.state, FileState::Done | FileState::Failed));
    }

    fn drop_where(&mut self, gone: impl Fn(&QueuedFile) -> bool) {
        let (dropped, kept): (Vec<_>, Vec<_>) = std::mem::take(&mut self.files).into_iter().partition(|f| gone(f));
        self.files = kept;
        for file in dropped {
            let path = self.path_of(&file);
            let _ = fs::remove_file(partial(&path));
            if file.state != FileState::Done {
                let _ = fs::remove_file(&path);
            }
        }
        self.tidy_batches();
        let _ = self.save();
    }

    /// Removes the folders of batches with nothing left to add.
    fn tidy_batches(&self) {
        let Ok(entries) = fs::read_dir(&self.dir) else { return };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if name == FILE || !entry.path().is_dir() {
                continue;
            }
            let live = self.files.iter().any(|f| f.batch == name && f.state != FileState::Done);
            if !live {
                let _ = fs::remove_dir_all(entry.path());
            }
        }
    }

    pub fn counts(&self) -> QueueCounts {
        let mut c = QueueCounts { total: self.files.len(), ..Default::default() };
        for f in &self.files {
            match f.state {
                FileState::Waiting => c.waiting += 1,
                FileState::Downloading => c.downloading += 1,
                FileState::Downloaded | FileState::Importing => c.downloaded += 1,
                FileState::Done => c.done += 1,
                FileState::Failed => c.failed += 1,
            }
            c.bytes_total += f.size;
            c.bytes_done += match f.state {
                FileState::Waiting | FileState::Failed => 0,
                FileState::Downloading => f.bytes_done,
                _ => f.size,
            };
        }
        c
    }

    pub fn has_waiting(&self) -> bool {
        self.files.iter().any(|f| f.state == FileState::Waiting)
    }
}

/// Moves one audiobook's parts into a new folder inside `dir`, named after
/// it. Gives the folder and where each part is now, or nothing if they
/// couldn't all be moved (any that were are put back).
fn own_folder(dir: &Path, name: &str, parts: &[PathBuf]) -> Option<(PathBuf, Vec<PathBuf>)> {
    let clean: String = name.chars().map(|c| if c.is_control() || r#"/\<>:"|?*"#.contains(c) { '_' } else { c }).collect();
    let clean = clean.trim().trim_matches('.');
    let clean = if clean.is_empty() { "Audiobook" } else { clean };
    let mut sub = dir.join(clean);
    let mut n = 2;
    while sub.exists() {
        sub = dir.join(format!("{clean} ({n})"));
        n += 1;
    }
    fs::create_dir(&sub).ok()?;
    let mut now = Vec::new();
    for part in parts {
        let at = sub.join(part.file_name()?);
        if fs::rename(part, &at).is_err() {
            for (back, from) in now.iter().zip(parts) {
                let _ = fs::rename(back, from);
            }
            let _ = fs::remove_dir(&sub);
            return None;
        }
        now.push(at);
    }
    Some((sub, now))
}

/// Where a download is written until it's whole.
pub fn partial(path: &Path) -> PathBuf {
    path.with_file_name(format!("{}.part", path.file_name().unwrap_or_default().to_string_lossy()))
}

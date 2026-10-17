//! The import queue behind the Imports page. A few books are added at once,
//! each on its own thread. The slow parts (reading the file, which also
//! brings it down from a cloud app, then copying it in and saving its cover)
//! happen without the library locked; it is only taken for a quick look
//! first and to write the book's entry at the end, so every page keeps
//! working while a big import runs.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tbv_core::ids::book_id_for_file_with_progress;
use tbv_core::library::{find_book_files, ImportPlan};
use tbv_core::model::ImportResult;
use tbv_core::{Library, SUPPORTED_FORMATS};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Stage {
    Waiting,
    /// Reading the file (and fetching it, for a cloud app's folder).
    Reading,
    Adding,
    Done,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportItem {
    pub id: u64,
    pub path: String,
    pub name: String,
    pub bytes: u64,
    pub bytes_read: u64,
    pub stage: Stage,
    pub result: Option<ImportResult>,
}

#[derive(Default)]
struct Queue {
    items: Vec<ImportItem>,
    next_id: u64,
    /// Threads adding books right now.
    workers: usize,
}

/// Books added at once. More would mostly wait on the same disk or network.
const WORKERS: usize = 3;

#[derive(Default)]
pub struct Imports {
    queue: Mutex<Queue>,
    /// When the page was last told, so a fast import doesn't flood it.
    told: Mutex<Option<Instant>>,
}

/// How often the page hears about progress, at most.
const TELL_EVERY: Duration = Duration::from_millis(250);

impl Imports {
    pub fn list(&self) -> Vec<ImportItem> {
        self.queue.lock().map(|q| q.items.clone()).unwrap_or_default()
    }

    /// Finds the book files in `paths` and queues them. Returns how many.
    pub fn add(self: &Arc<Self>, app: &AppHandle, library: &Arc<Mutex<Library>>, paths: Vec<PathBuf>) -> usize {
        let books_dir = match library.lock() {
            Ok(l) => l.books_dir().to_path_buf(),
            Err(_) => return 0,
        };
        let files = find_book_files(&paths, &books_dir);
        let added = files.len();
        let start = {
            let Ok(mut queue) = self.queue.lock() else { return 0 };
            for file in files {
                queue.next_id += 1;
                let id = queue.next_id;
                queue.items.push(ImportItem {
                    id,
                    name: file.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
                    bytes: std::fs::metadata(&file).map(|m| m.len()).unwrap_or(0),
                    path: file.display().to_string(),
                    bytes_read: 0,
                    stage: Stage::Waiting,
                    result: None,
                });
            }
            let waiting = queue.items.iter().filter(|i| i.stage == Stage::Waiting).count();
            let start = waiting.min(WORKERS.saturating_sub(queue.workers));
            queue.workers += start;
            start
        };
        self.tell(app, true);
        for _ in 0..start {
            let (imports, app, library) = (self.clone(), app.clone(), library.clone());
            thread::spawn(move || imports.work(&app, &library));
        }
        added
    }

    /// Takes the books still waiting off the list.
    pub fn cancel(&self, app: &AppHandle) {
        if let Ok(mut queue) = self.queue.lock() {
            queue.items.retain(|i| i.stage != Stage::Waiting);
        }
        self.tell(app, true);
    }

    /// Clears finished books from the list.
    pub fn clear_finished(&self, app: &AppHandle) {
        if let Ok(mut queue) = self.queue.lock() {
            queue.items.retain(|i| i.stage != Stage::Done);
        }
        self.tell(app, true);
    }

    fn work(&self, app: &AppHandle, library: &Arc<Mutex<Library>>) {
        let mut changed_at = Instant::now();
        loop {
            let next = self.queue.lock().ok().and_then(|mut queue| {
                let Some(item) = queue.items.iter_mut().find(|i| i.stage == Stage::Waiting) else {
                    queue.workers = queue.workers.saturating_sub(1);
                    return None;
                };
                item.stage = Stage::Reading;
                Some((item.id, PathBuf::from(&item.path)))
            });
            let Some((id, path)) = next else { break };
            self.tell(app, false);

            let result = self.import(id, &path, app, library).unwrap_or_else(|e| failed(&path, &e.to_string()));
            let added = matches!(result, ImportResult::Imported { .. } | ImportResult::AlreadyInLibrary { .. });
            self.update(id, |item| {
                item.stage = Stage::Done;
                item.bytes_read = item.bytes;
                item.result = Some(result);
            });
            self.tell(app, false);
            // Pages refresh to show new books, a few times a second at most.
            if added && changed_at.elapsed() >= Duration::from_secs(1) {
                let _ = app.emit("library-changed", ());
                changed_at = Instant::now();
            }
        }
        // The last thread out tells the pages.
        if self.queue.lock().is_ok_and(|q| q.workers == 0) {
            self.tell(app, true);
            let _ = app.emit("library-changed", ());
        }
    }

    fn import(&self, id: u64, path: &Path, app: &AppHandle, library: &Mutex<Library>) -> tbv_core::Result<ImportResult> {
        let lock = || library.lock().map_err(|_| tbv_core::Error::Unsuitable("the library is unavailable".into()));
        let display = path.display().to_string();
        let Some(format) = path
            .extension()
            .map(|e| e.to_string_lossy().to_ascii_lowercase())
            .filter(|ext| SUPPORTED_FORMATS.contains(&ext.as_str()))
        else {
            return Ok(ImportResult::Unsupported { path: display });
        };
        let book_id = book_id_for_file_with_progress(path, &mut |read| {
            self.update(id, |item| item.bytes_read = read);
            self.tell(app, false);
        })?;
        self.update(id, |item| item.stage = Stage::Adding);
        self.tell(app, false);
        let job = match lock()?.import_plan(path, &format, book_id)? {
            ImportPlan::Finished(result) => return Ok(result),
            ImportPlan::Prepare(job) => job,
        };
        let paths = lock()?.paths().clone();
        let prepared = job.prepare(&paths)?;
        lock()?.finish_import(prepared)
    }

    fn update(&self, id: u64, change: impl FnOnce(&mut ImportItem)) {
        if let Ok(mut queue) = self.queue.lock() {
            if let Some(item) = queue.items.iter_mut().find(|i| i.id == id) {
                change(item);
            }
        }
    }

    fn tell(&self, app: &AppHandle, always: bool) {
        let Ok(mut told) = self.told.lock() else { return };
        if !always && told.is_some_and(|at| at.elapsed() < TELL_EVERY) {
            return;
        }
        *told = Some(Instant::now());
        let _ = app.emit("imports-changed", self.list());
    }
}

fn failed(path: &Path, reason: &str) -> ImportResult {
    ImportResult::Failed { path: path.display().to_string(), reason: reason.into() }
}

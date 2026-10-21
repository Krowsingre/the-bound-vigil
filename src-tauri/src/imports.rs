//! The import queue behind the Imports page. A few books are added at once,
//! each on its own thread. The slow parts (reading the file, which also
//! brings it down from a cloud app, then copying it in and saving its cover)
//! happen without the library locked; it is only taken for a quick look
//! first and to write the book's entry at the end, so every page keeps
//! working while a big import runs.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tbv_core::ids::book_id_for_file_with_progress;
use tbv_core::library::{find_book_files, stage_source, ImportPlan, Staged};
use tbv_core::model::ImportResult;
use tbv_core::servers::TempFolder;
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

/// What the Imports page shows. A big import can hold tens of thousands of
/// books, so the page gets counts and a window of the list, never all of it:
/// sending everything a few times a second left the window unable to keep up.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportsView {
    pub total: usize,
    pub done: usize,
    pub added: usize,
    pub already: usize,
    pub unsupported: usize,
    pub failed: usize,
    /// The title when exactly one book was added.
    pub only_added: Option<String>,
    /// The reason when exactly one file couldn't be read.
    pub only_failure: Option<String>,
    pub waiting_count: usize,
    pub current: Vec<ImportItem>,
    /// The first few waiting, in order.
    pub waiting: Vec<ImportItem>,
    /// The latest few finished, newest first.
    pub finished: Vec<ImportItem>,
    /// Bytes read so far of the books under way, out of their sizes.
    pub current_read: u64,
    pub current_bytes: u64,
    /// Added PDFs whose covers the page should draw (see `take_pdf_covers`).
    pub pdf_covers: usize,
}

/// Waiting and finished books listed on the page; the rest are counted.
const SHOW: usize = 100;

#[derive(Default)]
struct Queue {
    items: Vec<ImportItem>,
    /// Added PDFs waiting for the page to draw their covers.
    pdf_covers: Vec<String>,
    next_id: u64,
    /// Threads adding books right now.
    workers: usize,
    /// What the waiting books need kept (a folder of downloads, say), let go
    /// as each is done.
    holds: HashMap<u64, Hold>,
}

/// Kept while a book is in the queue, and dropped once it's done.
pub type Hold = Arc<dyn Send + Sync>;

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
    pub fn view(&self) -> ImportsView {
        let Ok(queue) = self.queue.lock() else { return ImportsView::default() };
        let mut view = ImportsView { total: queue.items.len(), pdf_covers: queue.pdf_covers.len(), ..Default::default() };
        for item in &queue.items {
            match item.stage {
                Stage::Waiting => {
                    view.waiting_count += 1;
                    if view.waiting.len() < SHOW {
                        view.waiting.push(item.clone());
                    }
                }
                Stage::Reading | Stage::Adding => {
                    view.current_read += item.bytes_read;
                    view.current_bytes += item.bytes;
                    view.current.push(item.clone());
                }
                Stage::Done => {
                    view.done += 1;
                    match &item.result {
                        Some(ImportResult::Imported { title, .. }) => {
                            view.added += 1;
                            view.only_added = Some(title.clone());
                        }
                        Some(ImportResult::AlreadyInLibrary { .. }) => view.already += 1,
                        Some(ImportResult::Unsupported { .. }) => view.unsupported += 1,
                        Some(ImportResult::Failed { reason, .. }) => {
                            view.failed += 1;
                            view.only_failure = Some(reason.clone());
                        }
                        None => {}
                    }
                }
            }
        }
        if view.added != 1 {
            view.only_added = None;
        }
        if view.failed != 1 {
            view.only_failure = None;
        }
        // Books finish in the order they're listed, near enough.
        view.finished = queue.items.iter().rev().filter(|i| i.stage == Stage::Done).take(SHOW).cloned().collect();
        view
    }

    /// The added PDFs still needing a cover, handed over once.
    pub fn take_pdf_covers(&self) -> Vec<String> {
        self.queue.lock().map(|mut q| std::mem::take(&mut q.pdf_covers)).unwrap_or_default()
    }

    /// Finds the book files in `paths` and queues them. Returns how many.
    pub fn add(self: &Arc<Self>, app: &AppHandle, library: &Arc<Mutex<Library>>, paths: Vec<PathBuf>) -> usize {
        self.add_holding(app, library, paths, None)
    }

    /// Like `add`, keeping `hold` (a folder of downloads) until the last of
    /// these books is in, when it is deleted.
    pub fn add_holding(
        self: &Arc<Self>,
        app: &AppHandle,
        library: &Arc<Mutex<Library>>,
        paths: Vec<PathBuf>,
        hold: Option<Arc<TempFolder>>,
    ) -> usize {
        let books_dir = match library.lock() {
            Ok(l) => l.books_dir().to_path_buf(),
            Err(_) => return 0,
        };
        let hold = hold.map(|h| h as Hold);
        let files = find_book_files(&paths, &books_dir).into_iter().map(|f| (f, hold.clone())).collect();
        self.queue_sources(app, library, files)
    }

    /// Queues each source as it is (a file, an audiobook's folder or a group
    /// within one), each keeping its own hold until it's done.
    pub fn queue_sources(self: &Arc<Self>, app: &AppHandle, library: &Arc<Mutex<Library>>, sources: Vec<(PathBuf, Option<Hold>)>) -> usize {
        let added = sources.len();
        let start = {
            let Ok(mut queue) = self.queue.lock() else { return 0 };
            for (file, hold) in sources {
                queue.next_id += 1;
                let id = queue.next_id;
                if let Some(hold) = hold {
                    queue.holds.insert(id, hold);
                }
                queue.items.push(ImportItem {
                    id,
                    name: tbv_core::audio::display_name(&file),
                    bytes: size_of(&file),
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
        // Holds are let go with the queue unlocked: letting go can tell others.
        let _released: Vec<Hold> = match self.queue.lock() {
            Ok(mut queue) => {
                queue.items.retain(|i| i.stage != Stage::Waiting);
                let left: Vec<u64> = queue.items.iter().map(|i| i.id).collect();
                let gone: Vec<u64> = queue.holds.keys().copied().filter(|id| !left.contains(id)).collect();
                gone.iter().filter_map(|id| queue.holds.remove(id)).collect()
            }
            Err(_) => Vec::new(),
        };
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
            if let ImportResult::Imported { book_id, path, .. } = &result {
                if path.to_ascii_lowercase().ends_with(".pdf") {
                    if let Ok(mut queue) = self.queue.lock() {
                        queue.pdf_covers.push(book_id.to_string());
                    }
                }
            }
            self.update(id, |item| {
                item.stage = Stage::Done;
                item.bytes_read = item.bytes;
                item.result = Some(result);
            });
            let released = self.queue.lock().ok().and_then(|mut queue| queue.holds.remove(&id));
            drop(released);
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
        let supported = path
            .extension()
            .map(|e| e.to_string_lossy().to_ascii_lowercase())
            .is_some_and(|ext| SUPPORTED_FORMATS.contains(&ext.as_str()));
        if !supported && !path.is_dir() && tbv_core::audio::parse_group(path).is_none() {
            return Ok(ImportResult::Unsupported { path: display });
        }
        // A folder of audio files is bundled into one audiobook first.
        let paths = lock()?.paths().clone();
        let staged = stage_source(&paths, path)?;
        let result = self.import_staged(id, &staged, app, library);
        staged.clean_up();
        result.map(|r| r.from_path(display))
    }

    fn import_staged(&self, id: u64, staged: &Staged, app: &AppHandle, library: &Mutex<Library>) -> tbv_core::Result<ImportResult> {
        let lock = || library.lock().map_err(|_| tbv_core::Error::Unsuitable("the library is unavailable".into()));
        let book_id = book_id_for_file_with_progress(&staged.file, &mut |read| {
            self.update(id, |item| item.bytes_read = read);
            self.tell(app, false);
        })?;
        self.update(id, |item| item.stage = Stage::Adding);
        self.tell(app, false);
        let job = match lock()?.import_plan(&staged.file, &staged.format, book_id)? {
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
        let _ = app.emit("imports-changed", self.view());
    }
}

/// How much there is to read: a file's size, or a folder audiobook's audio.
fn size_of(path: &Path) -> u64 {
    if path.is_dir() || tbv_core::audio::parse_group(path).is_some() {
        return tbv_core::audio::source_parts(path).iter().filter_map(|p| std::fs::metadata(p).ok()).map(|m| m.len()).sum();
    }
    std::fs::metadata(path).map(|m| m.len()).unwrap_or(0)
}

fn failed(path: &Path, reason: &str) -> ImportResult {
    ImportResult::Failed { path: path.display().to_string(), reason: reason.into() }
}

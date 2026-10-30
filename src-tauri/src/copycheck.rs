//! The plagiarism check: the book being written looked for, word for word,
//! in every library book on this device. Several books are read at once, the
//! page hears how far it's got, and it can be stopped.

use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tbv_core::copycheck::{check_book, CopyMatch, Section, Writing};

use crate::{AppLibrary, CommandResult};

static STOP: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Serialize)]
struct Progress {
    done: usize,
    total: usize,
}

/// Looks for the writing's passages in the library's books. Answers with the books that share any, most first.
#[tauri::command]
pub async fn copy_check(app: AppHandle, state: State<'_, AppLibrary>, sections: Vec<Section>, leave_out_title: String) -> CommandResult<Vec<CopyMatch>> {
    let library = state.0.clone();
    STOP.store(false, Ordering::SeqCst);
    tauri::async_runtime::spawn_blocking(move || {
        // The list is read with the library held; the books themselves without, so the app carries on as usual.
        let books = library.lock().map_err(|_| "library is unavailable".to_string())?.copy_check_books(&leave_out_title).map_err(|e| e.to_string())?;
        let writing = Writing::new(sections);
        if writing.is_empty() {
            return Err("There aren't enough words to check yet.".to_string());
        }
        let total = books.len();
        let next = AtomicUsize::new(0);
        let done = AtomicUsize::new(0);
        let found = Mutex::new(Vec::new());
        let workers = std::thread::available_parallelism().map_or(2, |n| n.get().clamp(1, 6));
        let _ = app.emit("copy-check-progress", Progress { done: 0, total });
        std::thread::scope(|scope| {
            for _ in 0..workers {
                scope.spawn(|| loop {
                    if STOP.load(Ordering::SeqCst) {
                        break;
                    }
                    let i = next.fetch_add(1, Ordering::SeqCst);
                    let Some(book) = books.get(i) else { break };
                    if let Some(m) = check_book(&writing, book) {
                        if let Ok(mut f) = found.lock() {
                            f.push(m);
                        }
                    }
                    let n = done.fetch_add(1, Ordering::SeqCst) + 1;
                    if n.is_multiple_of(5) || n == total {
                        let _ = app.emit("copy-check-progress", Progress { done: n, total });
                    }
                });
            }
        });
        let mut found = found.into_inner().map_err(|e| e.to_string())?;
        found.sort_by_key(|m| std::cmp::Reverse(m.words));
        Ok(found)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Stops a check part-way; what was found so far comes back.
#[tauri::command]
pub fn copy_check_stop() {
    STOP.store(true, Ordering::SeqCst);
}

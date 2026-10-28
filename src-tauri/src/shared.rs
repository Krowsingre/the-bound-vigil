//! Books shared to TBV from another app on iPhone and iPad ("Open in", or
//! TBV in the share sheet). iOS hands each one over as a copy in the app's
//! Inbox; it comes in like any other import, and the copy goes once the
//! book is in the library. Ones handed over before TBV has opened its
//! library (TBV started by the share) wait for it.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tbv_core::servers::TempFolder;

use crate::{imports::Imports, AppLibrary};

/// Shared before the library was open.
static WAITING: Mutex<Vec<PathBuf>> = Mutex::new(Vec::new());

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Shared {
    message: String,
}

/// Takes the files of `urls`, now or once the library is open.
pub fn opened(app: &AppHandle, urls: &[tauri::Url]) {
    let files: Vec<PathBuf> = urls.iter().filter(|u| u.scheme() == "file").filter_map(|u| u.to_file_path().ok()).collect();
    if files.is_empty() {
        return;
    }
    if app.try_state::<Arc<Imports>>().is_none() {
        if let Ok(mut waiting) = WAITING.lock() {
            waiting.extend(files);
        }
        return;
    }
    bring_in(app, files, Vec::new());
}

/// Brings in what was shared while TBV was starting, and clears copies an
/// earlier run never got to.
pub fn ready(app: &AppHandle, data_dir: &std::path::Path) {
    let _ = std::fs::remove_dir_all(holding_dir(data_dir));
    let files = WAITING.lock().map(|mut w| std::mem::take(&mut *w)).unwrap_or_default();
    if !files.is_empty() {
        bring_in(app, files, Vec::new());
    }
}

/// Share batches being brought in now, so a second look doesn't take them
/// twice. One that fails stays in the shared folder, out of this list, and
/// is tried again the next time TBV looks.
static TAKING: Mutex<Vec<PathBuf>> = Mutex::new(Vec::new());
/// Tries a batch gets before it's given up on.
#[cfg(target_os = "ios")]
const TRIES: u32 = 3;

/// Brings in what TBV's share-sheet add-on has left for it. iOS doesn't
/// always open TBV when a share finishes, so this runs when TBV opens and
/// each time it comes back on screen.
#[cfg(target_os = "ios")]
pub fn check(app: &AppHandle) {
    let Ok(batches) = tauri_plugin_tbv_ios::pending_shares() else { return };
    for batch in batches {
        let Ok(mut taking) = TAKING.lock() else { return };
        if taking.contains(&batch) {
            continue;
        }
        let tries_file = batch.join(".tries");
        let tries: u32 = std::fs::read_to_string(&tries_file).ok().and_then(|t| t.trim().parse().ok()).unwrap_or(0);
        let mut files = Vec::new();
        collect_files(&batch, &mut files);
        if files.is_empty() || tries >= TRIES {
            let _ = std::fs::remove_dir_all(&batch);
            if !files.is_empty() {
                let _ = app.emit("shared-books", Shared { message: "A shared book couldn't be added, so TBV stopped trying.".into() });
            }
            continue;
        }
        let _ = std::fs::write(&tries_file, (tries + 1).to_string());
        taking.push(batch.clone());
        drop(taking);
        bring_in(app, files, vec![batch]);
    }
}

/// The books in a share batch: its files, and any unpacked EPUB folder as
/// one book (Apple Books shares its books that way), never its pages.
#[cfg(target_os = "ios")]
fn collect_files(folder: &std::path::Path, out: &mut Vec<PathBuf>) {
    if let Ok(entries) = std::fs::read_dir(folder) {
        for entry in entries.flatten() {
            let path = entry.path();
            // Hidden ones are TBV's own notes (how often a batch was tried).
            if entry.file_name().to_string_lossy().starts_with('.') {
                continue;
            }
            if tbv_core::epub::is_epub_folder(&path) {
                out.push(path);
            } else if path.is_dir() {
                collect_files(&path, out);
            } else if path.is_file() {
                out.push(path);
            }
        }
    }
}

fn holding_dir(data_dir: &std::path::Path) -> PathBuf {
    data_dir.join("Shared books")
}

fn bring_in(app: &AppHandle, files: Vec<PathBuf>, completed_batches: Vec<PathBuf>) {
    let (Some(library), Some(imports), Ok(data_dir)) = (app.try_state::<AppLibrary>(), app.try_state::<Arc<Imports>>(), app.path().app_data_dir()) else {
        if let Ok(mut taking) = TAKING.lock() {
            taking.retain(|b| !completed_batches.contains(b));
        }
        return;
    };
    // Only iOS's own copies in TBV's Inbox are moved; anything else is copied and left where it is.
    let inbox = app.path().document_dir().ok().map(|d| d.join("Inbox"));
    let (library, imports, app) = (library.0.clone(), imports.inner().clone(), app.clone());
    // Off the main thread: moving a big audiobook can take a moment.
    std::thread::spawn(move || {
        let mut count = 0;
        let mut name = None;
        let mut all_staged = true;
        // What did come in, so a batch tried again only holds what didn't.
        let mut staged = Vec::new();
        for file in files {
            // Each in a folder of its own, cleared once its book is in.
            let Ok(hold) = TempFolder::new(&holding_dir(&data_dir)) else { all_staged = false; continue };
            let Some(file_name) = file.file_name() else { all_staged = false; continue };
            let target = hold.path().join(file_name);
            let ours = inbox.as_ref().is_some_and(|inbox| file.starts_with(inbox));
            if ours {
                if std::fs::rename(&file, &target).is_err() {
                    if copy_any(&file, &target).is_err() {
                        all_staged = false;
                        continue;
                    }
                    let _ = if file.is_dir() { std::fs::remove_dir_all(&file) } else { std::fs::remove_file(&file) };
                }
            } else if copy_any(&file, &target).is_err() {
                all_staged = false;
                continue;
            }
            staged.push(file);
            name = Some(tbv_core::audio::display_name(&target));
            count += imports.add_holding(&app, &library, vec![target], Some(Arc::new(hold)));
        }
        // Keep the original batch if any file could not be staged.
        // The import queue owns successful copies from this point onward.
        for batch in &completed_batches {
            if all_staged {
                let _ = std::fs::remove_dir_all(batch);
            } else {
                for file in staged.iter().filter(|f| f.starts_with(batch)) {
                    let _ = if file.is_dir() { std::fs::remove_dir_all(file) } else { std::fs::remove_file(file) };
                }
            }
        }
        if let Ok(mut taking) = TAKING.lock() {
            taking.retain(|b| !completed_batches.contains(b));
        }
        let message = match (count, name) {
            (0, _) => "TBV can't read that file, so it wasn't added.".to_string(),
            (1, Some(name)) => format!("Adding {name} to your library."),
            (n, _) => format!("Adding {n} books to your library."),
        };
        let _ = app.emit("shared-books", Shared { message });
    });
}

/// Copies a file, or a folder (an EPUB kept unpacked) with everything in it.
fn copy_any(from: &std::path::Path, to: &std::path::Path) -> std::io::Result<()> {
    if !from.is_dir() {
        return std::fs::copy(from, to).map(|_| ());
    }
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        // file_type() doesn't follow links, so a link loop can't trap the copy.
        if entry.file_type()?.is_symlink() {
            continue;
        }
        copy_any(&entry.path(), &to.join(entry.file_name()))?;
    }
    Ok(())
}

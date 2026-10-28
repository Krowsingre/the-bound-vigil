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

/// Poll while the app is running: iOS does not necessarily open the host
/// when a Share Extension finishes, so new batches must also be discovered
/// when TBV returns to the foreground or remains open.
#[cfg(target_os = "ios")]
pub fn watch(app: AppHandle) {
    std::thread::spawn(move || {
        let mut active = std::collections::HashSet::<PathBuf>::new();
        loop {
            if let Ok(batches) = tauri_plugin_tbv_ios::pending_shares() {
                active.retain(|path| path.is_dir());
                for batch in batches {
                    if !active.insert(batch.clone()) { continue; }
                    let mut files = Vec::new();
                    collect_files(&batch, &mut files);
                    if files.is_empty() {
                        let _ = std::fs::remove_dir_all(&batch);
                        active.remove(&batch);
                        continue;
                    }
                    bring_in(&app, files, vec![batch]);
                }
            }
            std::thread::sleep(std::time::Duration::from_secs(3));
        }
    });
}

/// The books in a share batch: its files, and any unpacked EPUB folder as
/// one book (Apple Books shares its books that way), never its pages.
#[cfg(target_os = "ios")]
fn collect_files(folder: &std::path::Path, out: &mut Vec<PathBuf>) {
    if let Ok(entries) = std::fs::read_dir(folder) {
        for entry in entries.flatten() {
            let path = entry.path();
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
            name = Some(tbv_core::audio::display_name(&target));
            count += imports.add_holding(&app, &library, vec![target], Some(Arc::new(hold)));
        }
        // Keep the original batch if any file could not be staged.
        // The import queue owns successful copies from this point onward.
        if all_staged {
            for batch in completed_batches {
                let _ = std::fs::remove_dir_all(batch);
            }
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

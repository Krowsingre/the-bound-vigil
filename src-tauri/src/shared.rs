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
    bring_in(app, files);
}

/// Brings in what was shared while TBV was starting, and clears copies an
/// earlier run never got to.
pub fn ready(app: &AppHandle, data_dir: &std::path::Path) {
    let _ = std::fs::remove_dir_all(holding_dir(data_dir));
    let files = WAITING.lock().map(|mut w| std::mem::take(&mut *w)).unwrap_or_default();
    if !files.is_empty() {
        bring_in(app, files);
    }
}

fn holding_dir(data_dir: &std::path::Path) -> PathBuf {
    data_dir.join("Shared books")
}

fn bring_in(app: &AppHandle, files: Vec<PathBuf>) {
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
        for file in files {
            // Each in a folder of its own, cleared once its book is in.
            let Ok(hold) = TempFolder::new(&holding_dir(&data_dir)) else { continue };
            let Some(file_name) = file.file_name() else { continue };
            let target = hold.path().join(file_name);
            let ours = inbox.as_ref().is_some_and(|inbox| file.starts_with(inbox));
            if ours {
                if std::fs::rename(&file, &target).is_err() {
                    if std::fs::copy(&file, &target).is_err() {
                        continue;
                    }
                    let _ = std::fs::remove_file(&file);
                }
            } else if std::fs::copy(&file, &target).is_err() {
                continue;
            }
            name = Some(tbv_core::audio::display_name(&target));
            count += imports.add_holding(&app, &library, vec![target], Some(Arc::new(hold)));
        }
        let message = match (count, name) {
            (0, _) => "TBV can't read that file, so it wasn't added.".to_string(),
            (1, Some(name)) => format!("Adding {name} to your library."),
            (n, _) => format!("Adding {n} books to your library."),
        };
        let _ = app.emit("shared-books", Shared { message });
    });
}

//! Tauri shell: wires the UI to `tbv-core`. Commands stay thin; all logic and
//! file work lives in the core, and blocking work runs off the UI thread.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use tauri::{Manager, State};
use tbv_core::model::{HomeViewModel, ImportResult, ReadStatus};
use tbv_core::{Library, LibraryPaths, SUPPORTED_FORMATS};

struct AppLibrary(Arc<Mutex<Library>>);

type CommandResult<T> = Result<T, String>;

async fn with_library<T, F>(state: State<'_, AppLibrary>, work: F) -> CommandResult<T>
where
    T: Send + 'static,
    F: FnOnce(&mut Library) -> tbv_core::Result<T> + Send + 'static,
{
    let library = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut guard = library
            .lock()
            .map_err(|_| "library is unavailable".to_string())?;
        work(&mut guard).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn get_home(state: State<'_, AppLibrary>) -> CommandResult<HomeViewModel> {
    with_library(state, |library| library.home()).await
}

#[tauri::command]
async fn import_books(
    state: State<'_, AppLibrary>,
    paths: Vec<String>,
) -> CommandResult<Vec<ImportResult>> {
    let paths: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).collect();
    with_library(state, move |library| Ok(library.import_files(&paths))).await
}

#[tauri::command]
async fn set_book_status(
    state: State<'_, AppLibrary>,
    book_id: String,
    status: ReadStatus,
) -> CommandResult<()> {
    with_library(state, move |library| library.set_status(&book_id, status)).await
}

#[tauri::command]
fn supported_formats() -> Vec<&'static str> {
    SUPPORTED_FORMATS.to_vec()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let cache_dir = app.path().app_cache_dir()?;
            let library = Library::open(LibraryPaths::new(&data_dir, &cache_dir))?;
            app.manage(AppLibrary(Arc::new(Mutex::new(library))));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_home,
            import_books,
            set_book_status,
            supported_formats
        ])
        .run(tauri::generate_context!())
        .expect("error while running The Bound Vigil");
}

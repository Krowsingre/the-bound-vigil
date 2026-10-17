//! Tauri shell: wires the UI to `tbv-core`. Commands stay thin; all logic and
//! file work lives in the core, and blocking work runs off the UI thread.

mod sync;

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::{Emitter, Manager, State};
use tbv_core::model::{
    Annotation, AnnotationInput, BookId, CollectionDetail, CollectionInput, CollectionPreview,
    CollectionRef, CollectionSummary, CollectionsOverview, HomeViewModel, ImportResult,
    LibraryPage, LibraryQuery, NoteItem, NoteKind, NotesPage, NotesQuery, Profile, ReadStatus,
    ReaderBook, ReaderLocator,
};
use tbv_core::data::LibraryInfo;
use tbv_core::sync::{SupabaseProject, SyncOverview};
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
async fn get_library(
    state: State<'_, AppLibrary>,
    query: LibraryQuery,
) -> CommandResult<LibraryPage> {
    with_library(state, move |library| library.library_page(&query)).await
}

#[tauri::command]
async fn get_collections(state: State<'_, AppLibrary>) -> CommandResult<Vec<CollectionPreview>> {
    with_library(state, |library| library.collections(u32::MAX)).await
}

#[tauri::command]
async fn set_favorite(
    state: State<'_, AppLibrary>,
    book_id: String,
    favorite: bool,
) -> CommandResult<()> {
    with_library(state, move |library| {
        library.set_favorite(&book_id, favorite)
    })
    .await
}

#[tauri::command]
async fn set_rating(state: State<'_, AppLibrary>, book_id: String, rating: Option<u8>) -> CommandResult<()> {
    with_library(state, move |library| library.set_rating(&book_id, rating)).await
}

/// The plain text of an old Word document, for the reader.
#[tauri::command]
async fn book_text(state: State<'_, AppLibrary>, book_id: String) -> CommandResult<String> {
    with_library(state, move |library| library.book_text(&book_id)).await
}

/// A cover the reader drew (a PDF's first page). The picture arrives as raw
/// bytes, with the book named in a header.
#[tauri::command]
async fn fill_cover(state: State<'_, AppLibrary>, request: tauri::ipc::Request<'_>) -> CommandResult<bool> {
    let tauri::ipc::InvokeBody::Raw(picture) = request.body() else {
        return Err("expected a picture".into());
    };
    let book_id = request
        .headers()
        .get("book-id")
        .and_then(|v| v.to_str().ok())
        .ok_or("which book?")?
        .to_string();
    let picture = picture.clone();
    with_library(state, move |library| library.fill_cover(&book_id, &picture)).await
}

#[tauri::command]
async fn import_goodreads(
    state: State<'_, AppLibrary>,
    path: String,
) -> CommandResult<tbv_core::goodreads::GoodreadsImport> {
    with_library(state, move |library| library.import_goodreads(std::path::Path::new(&path))).await
}

#[tauri::command]
async fn set_want_to_read(
    state: State<'_, AppLibrary>,
    book_id: String,
    want: bool,
) -> CommandResult<()> {
    with_library(state, move |library| {
        library.set_want_to_read(&book_id, want)
    })
    .await
}

#[tauri::command]
async fn get_profile(state: State<'_, AppLibrary>) -> CommandResult<Profile> {
    with_library(state, |library| library.profile()).await
}

#[tauri::command]
async fn set_avatar(state: State<'_, AppLibrary>, path: String) -> CommandResult<Profile> {
    with_library(state, move |library| {
        library.set_avatar(&PathBuf::from(path))
    })
    .await
}

#[tauri::command]
async fn clear_avatar(state: State<'_, AppLibrary>) -> CommandResult<Profile> {
    with_library(state, |library| library.clear_avatar()).await
}

#[tauri::command]
fn supported_formats() -> Vec<&'static str> {
    SUPPORTED_FORMATS.to_vec()
}

/// Ends the whole app, not just the window. The close button uses this so
/// nothing is left running in the background after the window goes away.
/// A last sync gets a moment to finish first, if the user wants one.
#[tauri::command]
async fn quit_app(app: tauri::AppHandle, worker: State<'_, Arc<sync::SyncWorker>>) -> CommandResult<()> {
    let worker = worker.inner().clone();
    let _ = tauri::async_runtime::spawn_blocking(move || worker.finish(Duration::from_secs(15))).await;
    app.exit(0);
    Ok(())
}

#[tauri::command]
async fn open_book(state: State<'_, AppLibrary>, book_id: String) -> CommandResult<ReaderBook> {
    with_library(state, move |library| library.open_book(&book_id)).await
}

/// The book's bytes, sent as raw binary rather than JSON so large books load quickly.
#[tauri::command]
async fn read_book_file(
    state: State<'_, AppLibrary>,
    book_id: String,
) -> CommandResult<tauri::ipc::Response> {
    let library = state.0.clone();
    let id = book_id.clone();
    let path = match with_library(state, move |library| library.book_file(&id)).await {
        Ok(path) => path,
        // Only in the cloud (or gone from here): fetch it, then open it.
        Err(_) => tauri::async_runtime::spawn_blocking(move || {
            sync::download(&library, &book_id)?;
            library
                .lock()
                .map_err(|_| tbv_core::Error::Unsuitable("the library is unavailable".into()))?
                .book_file(&book_id)
        })
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?,
    };
    let bytes = tauri::async_runtime::spawn_blocking(move || std::fs::read(path))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| format!("the book file couldn't be read: {e}"))?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
async fn save_position(
    state: State<'_, AppLibrary>,
    book_id: String,
    locator: ReaderLocator,
) -> CommandResult<()> {
    with_library(state, move |library| {
        library.save_position(&book_id, &locator)
    })
    .await
}

#[tauri::command]
async fn get_annotations(
    state: State<'_, AppLibrary>,
    book_id: String,
) -> CommandResult<Vec<Annotation>> {
    with_library(state, move |library| library.book_annotations(&book_id)).await
}

#[tauri::command]
async fn save_annotation(
    state: State<'_, AppLibrary>,
    annotation: AnnotationInput,
) -> CommandResult<Annotation> {
    with_library(state, move |library| library.save_annotation(&annotation)).await
}

#[tauri::command]
async fn delete_annotation(state: State<'_, AppLibrary>, id: String) -> CommandResult<()> {
    with_library(state, move |library| library.delete_annotation(&id)).await
}

#[tauri::command]
async fn get_setting(state: State<'_, AppLibrary>, key: String) -> CommandResult<Option<String>> {
    with_library(state, move |library| library.setting(&key)).await
}

#[tauri::command]
async fn set_setting(
    state: State<'_, AppLibrary>,
    key: String,
    value: String,
) -> CommandResult<()> {
    with_library(state, move |library| library.set_setting(&key, &value)).await
}

#[tauri::command]
async fn get_collections_overview(
    state: State<'_, AppLibrary>,
) -> CommandResult<CollectionsOverview> {
    with_library(state, |library| library.collections_overview()).await
}

#[tauri::command]
async fn get_collection(
    state: State<'_, AppLibrary>,
    collection: CollectionRef,
) -> CommandResult<CollectionDetail> {
    with_library(state, move |library| library.collection_detail(&collection)).await
}

#[tauri::command]
async fn create_collection(
    state: State<'_, AppLibrary>,
    input: CollectionInput,
) -> CommandResult<CollectionSummary> {
    with_library(state, move |library| library.create_collection(&input)).await
}

#[tauri::command]
async fn update_collection(
    state: State<'_, AppLibrary>,
    id: String,
    input: CollectionInput,
) -> CommandResult<CollectionSummary> {
    with_library(state, move |library| library.update_collection(&id, &input)).await
}

#[tauri::command]
async fn delete_collection(state: State<'_, AppLibrary>, id: String) -> CommandResult<()> {
    with_library(state, move |library| library.delete_collection(&id)).await
}

#[tauri::command]
async fn set_collection_picture(
    state: State<'_, AppLibrary>,
    id: String,
    picture: Option<String>,
) -> CommandResult<CollectionSummary> {
    with_library(state, move |library| {
        library.set_collection_picture(&id, picture.as_deref())
    })
    .await
}

#[tauri::command]
async fn set_collection_picture_file(
    state: State<'_, AppLibrary>,
    id: String,
    path: String,
) -> CommandResult<CollectionSummary> {
    with_library(state, move |library| {
        library.set_collection_picture_file(&id, &PathBuf::from(path))
    })
    .await
}

#[tauri::command]
async fn add_to_collection(
    state: State<'_, AppLibrary>,
    id: String,
    book_ids: Vec<BookId>,
) -> CommandResult<()> {
    with_library(state, move |library| {
        library.add_to_collection(&id, &book_ids)
    })
    .await
}

#[tauri::command]
async fn remove_from_collection(
    state: State<'_, AppLibrary>,
    id: String,
    book_id: String,
) -> CommandResult<()> {
    with_library(state, move |library| {
        library.remove_from_collection(&id, &book_id)
    })
    .await
}

#[tauri::command]
async fn move_collection(
    state: State<'_, AppLibrary>,
    id: String,
    to_index: usize,
) -> CommandResult<()> {
    with_library(state, move |library| library.move_collection(&id, to_index)).await
}

#[tauri::command]
async fn move_in_collection(
    state: State<'_, AppLibrary>,
    id: String,
    book_id: String,
    to_index: usize,
) -> CommandResult<()> {
    with_library(state, move |library| {
        library.move_in_collection(&id, &book_id, to_index)
    })
    .await
}

#[tauri::command]
async fn collections_for_book(
    state: State<'_, AppLibrary>,
    book_id: String,
) -> CommandResult<Vec<String>> {
    with_library(state, move |library| library.collections_for_book(&book_id)).await
}

#[tauri::command]
async fn get_notes(state: State<'_, AppLibrary>, query: NotesQuery) -> CommandResult<NotesPage> {
    with_library(state, move |library| library.notes_page(&query)).await
}

#[tauri::command]
async fn save_book_note(
    state: State<'_, AppLibrary>,
    book_id: String,
    id: Option<String>,
    text: String,
) -> CommandResult<NoteItem> {
    with_library(state, move |library| {
        library.save_book_note(&book_id, id.as_deref(), &text)
    })
    .await
}

#[tauri::command]
async fn save_personal_note(
    state: State<'_, AppLibrary>,
    id: Option<String>,
    title: Option<String>,
    body: String,
) -> CommandResult<NoteItem> {
    with_library(state, move |library| {
        library.save_personal_note(id.as_deref(), title.as_deref(), &body)
    })
    .await
}

#[tauri::command]
async fn set_annotation_note(
    state: State<'_, AppLibrary>,
    id: String,
    note: Option<String>,
) -> CommandResult<NoteItem> {
    with_library(state, move |library| {
        library.set_annotation_note(&id, note.as_deref())
    })
    .await
}

#[tauri::command]
async fn delete_note(
    state: State<'_, AppLibrary>,
    id: String,
    kind: NoteKind,
) -> CommandResult<()> {
    with_library(state, move |library| library.delete_note(&id, kind)).await
}

#[tauri::command]
async fn library_info(state: State<'_, AppLibrary>) -> CommandResult<LibraryInfo> {
    with_library(state, |library| library.library_info()).await
}

#[tauri::command]
async fn export_library(state: State<'_, AppLibrary>, path: String) -> CommandResult<()> {
    with_library(state, move |library| library.export_library(&PathBuf::from(path))).await
}

#[tauri::command]
async fn export_notes_markdown(state: State<'_, AppLibrary>, path: String) -> CommandResult<()> {
    with_library(state, move |library| {
        library.export_notes_markdown(&PathBuf::from(path))
    })
    .await
}

#[tauri::command]
async fn create_backup(state: State<'_, AppLibrary>, path: String) -> CommandResult<()> {
    with_library(state, move |library| library.create_backup(&PathBuf::from(path))).await
}

#[tauri::command]
async fn restore_backup(state: State<'_, AppLibrary>, path: String) -> CommandResult<()> {
    with_library(state, move |library| library.restore_backup(&PathBuf::from(path))).await
}

#[tauri::command]
async fn cover_accent(
    state: State<'_, AppLibrary>,
    book_id: String,
) -> CommandResult<Option<String>> {
    with_library(state, move |library| library.cover_accent(&book_id)).await
}

#[tauri::command]
async fn sync_overview(
    state: State<'_, AppLibrary>,
    worker: State<'_, Arc<sync::SyncWorker>>,
) -> CommandResult<SyncOverview> {
    let busy = worker.is_busy();
    with_library(state, move |library| {
        let mut overview = library.sync_overview()?;
        overview.status = sync::status(library, busy);
        Ok(overview)
    })
    .await
}

#[tauri::command]
fn sync_now(worker: State<'_, Arc<sync::SyncWorker>>) {
    worker.sync_now();
}

/// Signs in (or makes an account). False means Supabase emailed a link to
/// confirm the address first.
#[tauri::command]
async fn sync_sign_in(
    state: State<'_, AppLibrary>,
    worker: State<'_, Arc<sync::SyncWorker>>,
    email: String,
    password: String,
    create: bool,
) -> CommandResult<bool> {
    let library = state.0.clone();
    let signed_in = tauri::async_runtime::spawn_blocking(move || sync::sign_in(&library, &email, &password, create))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
    if signed_in {
        worker.sync_now();
    }
    Ok(signed_in)
}

#[tauri::command]
async fn sync_sign_out(app: tauri::AppHandle, state: State<'_, AppLibrary>) -> CommandResult<()> {
    let library = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        sync::sign_out(&library)?;
        announce(&app, &library);
        Ok::<_, tbv_core::Error>(())
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

/// Tells the window sync's state changed (the header circle listens).
fn announce(app: &tauri::AppHandle, library: &Mutex<Library>) {
    if let Ok(library) = library.lock() {
        let _ = app.emit("sync-status", sync::status(&library, false));
    }
}

/// Saves which Supabase project to use. A different project signs out first.
#[tauri::command]
async fn set_supabase_project(
    app: tauri::AppHandle,
    state: State<'_, AppLibrary>,
    project: Option<SupabaseProject>,
) -> CommandResult<()> {
    let library = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || -> tbv_core::Result<()> {
        let current = library
            .lock()
            .map_err(|_| tbv_core::Error::Unsuitable("the library is unavailable".into()))?
            .supabase_project()?;
        if current.as_ref().map(|p| &p.url) != project.as_ref().map(|p| &p.url) {
            sync::sign_out(&library)?;
        }
        let json = serde_json::to_string(&project)?;
        library
            .lock()
            .map_err(|_| tbv_core::Error::Unsuitable("the library is unavailable".into()))?
            .set_setting("sync.supabase", &json)?;
        announce(&app, &library);
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

#[tauri::command]
async fn resolve_sync_conflict(
    state: State<'_, AppLibrary>,
    worker: State<'_, Arc<sync::SyncWorker>>,
    kind: String,
    key: String,
    keep_cloud: bool,
) -> CommandResult<()> {
    with_library(state, move |library| library.resolve_sync_conflict(&kind, &key, keep_cloud)).await?;
    worker.sync_now();
    Ok(())
}

/// Fetches a book that's only in the cloud onto this device.
#[tauri::command]
async fn download_book(state: State<'_, AppLibrary>, book_id: String) -> CommandResult<()> {
    let library = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || sync::download(&library, &book_id))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

/// Opens File Explorer at a file or folder TBV keeps.
#[tauri::command]
fn show_folder(path: String) -> CommandResult<()> {
    tauri_plugin_opener::reveal_item_in_dir(path).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let cache_dir = app.path().app_cache_dir()?;
            let library = Arc::new(Mutex::new(Library::open(LibraryPaths::new(&data_dir, &cache_dir))?));
            app.manage(Arc::new(sync::SyncWorker::start(app.handle().clone(), library.clone())));
            app.manage(AppLibrary(library));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_home,
            import_books,
            book_text,
            fill_cover,
            set_book_status,
            get_library,
            get_collections,
            set_favorite,
            set_want_to_read,
            set_rating,
            import_goodreads,
            get_profile,
            set_avatar,
            clear_avatar,
            supported_formats,
            quit_app,
            open_book,
            read_book_file,
            save_position,
            get_annotations,
            save_annotation,
            delete_annotation,
            get_setting,
            set_setting,
            get_collections_overview,
            get_collection,
            create_collection,
            update_collection,
            delete_collection,
            set_collection_picture,
            set_collection_picture_file,
            add_to_collection,
            remove_from_collection,
            move_collection,
            move_in_collection,
            collections_for_book,
            get_notes,
            save_book_note,
            save_personal_note,
            set_annotation_note,
            delete_note,
            library_info,
            export_library,
            export_notes_markdown,
            create_backup,
            restore_backup,
            cover_accent,
            show_folder,
            sync_overview,
            sync_now,
            sync_sign_in,
            sync_sign_out,
            set_supabase_project,
            resolve_sync_conflict,
            download_book,
        ])
        // Alt+F4 or closing from the taskbar ends the app the same way. The
        // page gets a moment to save the reading position first; then the
        // last sync gets its chance, and the app quits regardless after that.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.emit("tbv://quit-requested", ());
                let app = window.app_handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_secs(2));
                    if let Some(worker) = app.try_state::<Arc<sync::SyncWorker>>() {
                        worker.finish(Duration::from_secs(15));
                    }
                    app.exit(0);
                });
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running The Bound Vigil");
}

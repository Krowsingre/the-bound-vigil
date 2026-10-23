//! Tauri shell: wires the UI to `tbv-core`. Commands stay thin; all logic and
//! file work lives in the core, and blocking work runs off the UI thread.

mod activity;
mod audio;
mod browser;
mod hardcover;
mod home;
mod imports;
mod localsend;
mod moving;
mod servers;
mod sync;
mod writing;

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::{Emitter, Manager, State};
use tbv_core::model::{
    Annotation, AnnotationInput, BookId, CollectionDetail, CollectionInput, CollectionPreview,
    CollectionRef, CollectionSummary, CollectionsOverview, HomeViewModel,
    LibraryPage, LibraryQuery, NoteItem, NoteKind, NotesPage, NotesQuery, Profile, ReadStatus,
    ReaderBook, ReaderLocator,
};
use tbv_core::data::LibraryInfo;
use tbv_core::ereaders::{self, email};
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

/// Queues book files (and folders of them) on the Imports page. Returns how
/// many books were found.
#[tauri::command]
async fn queue_imports(
    app: tauri::AppHandle,
    state: State<'_, AppLibrary>,
    imports: State<'_, Arc<imports::Imports>>,
    paths: Vec<String>,
) -> CommandResult<usize> {
    let paths: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).collect();
    let (library, imports) = (state.0.clone(), imports.inner().clone());
    // Looking through a big folder can take a while; not on the UI thread.
    tauri::async_runtime::spawn_blocking(move || {
        // On iPhone, a folder in iCloud Drive holds only stand-ins for files
        // iCloud hasn't brought down; they come down before the books are found.
        for path in paths.iter().filter(|p| p.is_dir()) {
            tbv_core::sync::files::bring_down_folder(path);
        }
        imports.add(&app, &library, paths)
    })
    .await
    .map_err(|e| e.to_string())
}

// Off the window's thread, so a busy queue never freezes the app.
#[tauri::command(async)]
fn import_queue(imports: State<'_, Arc<imports::Imports>>) -> imports::ImportsView {
    imports.view()
}

#[tauri::command(async)]
fn take_pdf_covers(imports: State<'_, Arc<imports::Imports>>) -> Vec<String> {
    imports.take_pdf_covers()
}

#[tauri::command(async)]
fn cancel_imports(app: tauri::AppHandle, imports: State<'_, Arc<imports::Imports>>) {
    imports.cancel(&app);
}

#[tauri::command(async)]
fn clear_finished_imports(app: tauri::AppHandle, imports: State<'_, Arc<imports::Imports>>) {
    imports.clear_finished(&app);
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
async fn set_rating(
    app: tauri::AppHandle,
    sends: State<'_, Arc<hardcover::Sends>>,
    state: State<'_, AppLibrary>,
    book_id: String,
    rating: Option<u8>,
) -> CommandResult<()> {
    let library = state.0.clone();
    let id = book_id.clone();
    with_library(state, move |library| library.set_rating(&id, rating)).await?;
    hardcover::send_in_background(library, app, sends.inner().clone(), book_id);
    Ok(())
}

#[tauri::command]
async fn export_goodreads(state: State<'_, AppLibrary>, path: String) -> CommandResult<u32> {
    with_library(state, move |library| library.export_goodreads(std::path::Path::new(&path))).await
}

#[tauri::command]
async fn hardcover_status(state: State<'_, AppLibrary>) -> CommandResult<tbv_core::hardcover::HardcoverStatus> {
    with_library(state, |library| library.hardcover_status()).await
}

#[tauri::command]
async fn hardcover_set_sending(
    state: State<'_, AppLibrary>,
    on: bool,
) -> CommandResult<tbv_core::hardcover::HardcoverStatus> {
    with_library(state, move |library| {
        library.set_hardcover_sending(on)?;
        library.hardcover_status()
    })
    .await
}

/// These wait on the browser or on Hardcover, so they run off the library's lock.
async fn blocking<T: Send + 'static>(
    state: State<'_, AppLibrary>,
    work: impl FnOnce(&Mutex<Library>) -> tbv_core::Result<T> + Send + 'static,
) -> CommandResult<T> {
    let library = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || work(&library).map_err(|e| e.to_string()))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn hardcover_sign_in(state: State<'_, AppLibrary>) -> CommandResult<tbv_core::hardcover::HardcoverStatus> {
    blocking(state, hardcover::sign_in).await
}

#[tauri::command]
async fn hardcover_sign_out(state: State<'_, AppLibrary>) -> CommandResult<tbv_core::hardcover::HardcoverStatus> {
    blocking(state, hardcover::sign_out).await
}

#[tauri::command]
async fn hardcover_send_all(state: State<'_, AppLibrary>) -> CommandResult<tbv_core::hardcover::SendAllReport> {
    blocking(state, hardcover::send_all).await
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
async fn audiobook(state: State<'_, AppLibrary>, book_id: String) -> CommandResult<tbv_core::audio::Audiobook> {
    with_library(state, move |library| library.audiobook(&book_id)).await
}

/// The audiobook being listened to for read-along timing, kept open so
/// stretch after stretch through it stays quick.
static LISTENING: std::sync::Mutex<Option<(String, tbv_core::listen::Listener)>> = std::sync::Mutex::new(None);

/// A stretch of an audiobook on this computer as 16 kHz mono samples
/// (little-endian 32-bit floats), for read-along timing. An empty answer
/// means the book has ended.
#[tauri::command]
async fn audio_clip(state: State<'_, AppLibrary>, book_id: String, start_ms: u64, len_ms: u64) -> CommandResult<tauri::ipc::Response> {
    let library = state.0.clone();
    let samples = tauri::async_runtime::spawn_blocking(move || -> tbv_core::Result<Vec<f32>> {
        let mut listening = LISTENING.lock().unwrap_or_else(|e| e.into_inner());
        if listening.as_ref().is_none_or(|(id, _)| *id != book_id) {
            let (path, format, parts) = {
                let l = library.lock().map_err(|_| tbv_core::Error::Unsuitable("the library is unavailable".into()))?;
                let (path, format) = l.audio_file(&book_id)?;
                (path, format, l.audiobook(&book_id)?.parts)
            };
            *listening = Some((book_id.clone(), tbv_core::listen::Listener::open(&path, &format, &parts)?));
        }
        let (_, listener) = listening.as_mut().expect("opened above");
        listener.clip(start_ms, len_ms)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;
    Ok(tauri::ipc::Response::new(samples.iter().flat_map(|s| s.to_le_bytes()).collect::<Vec<u8>>()))
}

/// Lets go of the audiobook read for timing, so its file can be moved or deleted.
#[tauri::command]
fn audio_clips_done() {
    *LISTENING.lock().unwrap_or_else(|e| e.into_inner()) = None;
}

#[tauri::command]
async fn read_along_timing(state: State<'_, AppLibrary>, ebook_id: String, audiobook_id: String) -> CommandResult<Option<String>> {
    with_library(state, move |library| library.read_along_timing(&ebook_id, &audiobook_id)).await
}

#[tauri::command]
async fn save_read_along_timing(state: State<'_, AppLibrary>, ebook_id: String, audiobook_id: String, timing: String) -> CommandResult<()> {
    with_library(state, move |library| library.save_read_along_timing(&ebook_id, &audiobook_id, &timing)).await
}

/// Gets an audiobook that isn't on this computer ready to play straight
/// from the cloud, without downloading it.
#[tauri::command]
async fn prepare_stream(state: State<'_, AppLibrary>, book_id: String) -> CommandResult<()> {
    let library = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || audio::prepare(&library, &book_id))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn save_listening(state: State<'_, AppLibrary>, book_id: String, position_ms: u64, chapter: Option<String>) -> CommandResult<()> {
    with_library(state, move |library| library.save_listening(&book_id, position_ms, chapter)).await
}

#[tauri::command]
async fn add_time(state: State<'_, AppLibrary>, day: String, kind: String, seconds: u32) -> CommandResult<()> {
    with_library(state, move |library| library.add_time(&day, &kind, seconds)).await
}

#[tauri::command]
async fn time_spent(state: State<'_, AppLibrary>) -> CommandResult<Vec<tbv_core::time_log::TimeSpent>> {
    with_library(state, |library| library.time_spent()).await
}

#[tauri::command]
async fn link_ebook(state: State<'_, AppLibrary>, audiobook_id: String, ebook_id: Option<String>) -> CommandResult<()> {
    with_library(state, move |library| library.link_ebook(&audiobook_id, ebook_id.as_deref())).await
}

#[tauri::command]
async fn audiobook_for_ebook(state: State<'_, AppLibrary>, ebook_id: String) -> CommandResult<Option<String>> {
    with_library(state, move |library| library.audiobook_for_ebook(&ebook_id)).await
}

/// A cover found online, in place of the book's own (kept, for a reset).
#[tauri::command]
async fn fetch_cover(state: State<'_, AppLibrary>, book_id: String, url: String) -> CommandResult<bool> {
    let picture = tauri::async_runtime::spawn_blocking(move || tbv_core::details::download_cover(&url))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
    with_library(state, move |library| library.replace_cover(&book_id, &picture)).await
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
async fn set_phone_wanted(state: State<'_, AppLibrary>, book_ids: Vec<String>, wanted: bool) -> CommandResult<()> {
    with_library(state, move |library| library.set_phone_wanted(&book_ids, wanted)).await
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

/// The account's name, the same on every device.
#[tauri::command]
async fn set_account_name(state: State<'_, AppLibrary>, name: String) -> CommandResult<Profile> {
    with_library(state, move |library| library.set_account_name(&name)).await
}

/// What this device is called, in Grimoire's list and in sync's notes.
/// Grimoire starts again under the new name, so other devices see it.
#[tauri::command]
async fn set_device_name(
    app: tauri::AppHandle,
    state: State<'_, AppLibrary>,
    imports: State<'_, Arc<imports::Imports>>,
    localsend: State<'_, Arc<localsend::LocalSend>>,
    name: String,
) -> CommandResult<Profile> {
    let (library, imports, localsend) = (state.0.clone(), imports.inner().clone(), localsend.inner().clone());
    let profile = with_library(state, move |l| l.set_device_name(&name)).await?;
    let inbox = localsend_inbox(&app)?;
    tauri::async_runtime::spawn_blocking(move || localsend.restart(&app, &library, &imports, inbox)).await.map_err(|e| e.to_string())?;
    Ok(profile)
}

#[tauri::command]
fn supported_formats() -> Vec<&'static str> {
    SUPPORTED_FORMATS.to_vec()
}

/// Ends the whole app, not just the window. The close button uses this so
/// nothing is left running in the background after the window goes away.
/// A last sync gets a moment to finish first, if the user wants one.
#[tauri::command]
async fn quit_app(
    app: tauri::AppHandle,
    worker: State<'_, Arc<sync::SyncWorker>>,
    sends: State<'_, Arc<hardcover::Sends>>,
) -> CommandResult<()> {
    // The window goes at once; what's left finishes out of sight.
    for window in app.webview_windows().values() {
        let _ = window.hide();
    }
    let worker = worker.inner().clone();
    let sends = sends.inner().clone();
    let _ = tauri::async_runtime::spawn_blocking(move || {
        let ratings = std::thread::spawn(move || sends.finish(Duration::from_secs(5)));
        worker.finish(Duration::from_secs(8));
        let _ = ratings.join();
    })
    .await;
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
    Ok(tauri::ipc::Response::new(book_bytes(state, book_id).await?))
}

/// A book's bytes, fetched from the cloud first if it's only there.
async fn book_bytes(state: State<'_, AppLibrary>, book_id: String) -> CommandResult<Vec<u8>> {
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
    // The reader opens comics as zips; a CBR is made into one in memory.
    let bytes = tauri::async_runtime::spawn_blocking(move || -> std::io::Result<Vec<u8>> {
        if path.extension().is_some_and(|e| e.eq_ignore_ascii_case("cbr")) {
            return tbv_core::formats::comic::rar_as_zip(&path).map_err(std::io::Error::other);
        }
        std::fs::read(path)
    })
    .await
        .map_err(|e| e.to_string())?
        .map_err(|e| format!("the book file couldn't be read: {e}"))?;
    Ok(bytes)
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
    if tbv_core::data::is_secret_setting(&key) {
        return Err("That setting can't be read from here.".into());
    }
    with_library(state, move |library| library.setting(&key)).await
}

#[tauri::command]
async fn set_setting(
    state: State<'_, AppLibrary>,
    key: String,
    value: String,
) -> CommandResult<()> {
    if tbv_core::data::is_secret_setting(&key) {
        return Err("That setting can't be changed from here.".into());
    }
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
async fn count_rule_matches(
    state: State<'_, AppLibrary>,
    rules: tbv_core::rules::CollectionRules,
) -> CommandResult<u32> {
    with_library(state, move |library| library.count_rule_matches(&rules)).await
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

/// What sync is doing now, and the files it moved lately.
#[tauri::command(async)]
fn sync_activity() -> activity::SyncActivity {
    activity::current()
}

#[tauri::command(async)]
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
        audio::forget(None);
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

/// Chooses the service that carries the library. True when the folder or
/// server already held a library, which this device now joins.
#[tauri::command]
async fn set_sync_provider(
    app: tauri::AppHandle,
    state: State<'_, AppLibrary>,
    worker: State<'_, Arc<sync::SyncWorker>>,
    provider: tbv_core::sync::Provider,
) -> CommandResult<bool> {
    let joined = blocking(state, move |library| {
        let joined = sync::choose(library, provider)?;
        audio::forget(None);
        announce(&app, library);
        Ok(joined)
    })
    .await?;
    worker.sync_now();
    Ok(joined)
}

/// Chooses (or, with none, stops) a second place to sync with. True when
/// the folder or server already held a library.
#[tauri::command]
async fn set_also_sync(
    app: tauri::AppHandle,
    state: State<'_, AppLibrary>,
    worker: State<'_, Arc<sync::SyncWorker>>,
    provider: Option<tbv_core::sync::Provider>,
) -> CommandResult<bool> {
    let joined = blocking(state, move |library| {
        let joined = sync::choose_also(library, provider)?;
        audio::forget(None);
        announce(&app, library);
        Ok(joined)
    })
    .await?;
    worker.sync_now();
    Ok(joined)
}

/// How moving or backing up the library to another service stands.
#[tauri::command(async)]
fn move_status(mover: State<'_, Arc<moving::Mover>>) -> moving::MoveStatus {
    mover.status()
}

/// Signs in to the Supabase project the library is moving to, without
/// touching the sign-in sync uses. False means Supabase emailed a link first.
#[tauri::command]
async fn move_sign_in(
    mover: State<'_, Arc<moving::Mover>>,
    project: SupabaseProject,
    email: String,
    password: String,
    create: bool,
) -> CommandResult<bool> {
    let mover = mover.inner().clone();
    tauri::async_runtime::spawn_blocking(move || mover.sign_in(project, &email, &password, create))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn move_sign_out(mover: State<'_, Arc<moving::Mover>>) {
    mover.sign_out();
}

/// Starts copying the library to another service, in the background.
#[tauri::command]
async fn start_move(
    app: tauri::AppHandle,
    state: State<'_, AppLibrary>,
    mover: State<'_, Arc<moving::Mover>>,
    worker: State<'_, Arc<sync::SyncWorker>>,
    mode: tbv_core::sync::moving::MoveMode,
    scope: tbv_core::sync::moving::MoveScope,
    to: tbv_core::sync::Provider,
) -> CommandResult<()> {
    let (library, mover, worker) = (state.0.clone(), mover.inner().clone(), worker.inner().clone());
    tauri::async_runtime::spawn_blocking(move || mover.start(&app, &library, &worker, mode, scope, to))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

/// Runs the last move again; only what's still missing is copied.
#[tauri::command]
async fn retry_move(
    app: tauri::AppHandle,
    state: State<'_, AppLibrary>,
    mover: State<'_, Arc<moving::Mover>>,
    worker: State<'_, Arc<sync::SyncWorker>>,
) -> CommandResult<()> {
    let (library, mover, worker) = (state.0.clone(), mover.inner().clone(), worker.inner().clone());
    tauri::async_runtime::spawn_blocking(move || mover.again(&app, &library, &worker))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command(async)]
fn cancel_move(mover: State<'_, Arc<moving::Mover>>) {
    mover.cancel();
}

#[tauri::command(async)]
fn clear_move(app: tauri::AppHandle, mover: State<'_, Arc<moving::Mover>>) {
    mover.clear(&app);
}

/// Where a cloud app usually keeps its folder on this computer, if it's there.
#[tauri::command]
fn suggest_sync_folder(service: String) -> Option<String> {
    sync::likely_folder(&service).map(|p| p.display().to_string())
}

/// What tidying up Supabase would remove.
#[tauri::command]
async fn plan_tidy_cloud(state: State<'_, AppLibrary>) -> CommandResult<tbv_core::sync::tidy::TidyPlan> {
    let library = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || sync::plan_tidy(&library))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

/// Removes Supabase's copies of books that aren't on this computer.
#[tauri::command]
async fn tidy_cloud(app: tauri::AppHandle, state: State<'_, AppLibrary>) -> CommandResult<tbv_core::sync::tidy::TidyReport> {
    let library = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || sync::tidy(&app, &library))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

/// Every file TBV keeps in Supabase, for choosing what to remove.
#[tauri::command]
async fn supabase_contents(state: State<'_, AppLibrary>) -> CommandResult<Vec<tbv_core::sync::contents::StoredFile>> {
    let library = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || sync::supabase_contents(&library))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

/// Removes the chosen files from Supabase.
#[tauri::command]
async fn remove_supabase_files(
    app: tauri::AppHandle,
    state: State<'_, AppLibrary>,
    paths: Vec<String>,
) -> CommandResult<tbv_core::sync::contents::RemoveReport> {
    let library = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || sync::remove_supabase_files(&app, &library, &paths))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

/// Where every book's file is: here, and in each sync place.
#[tauri::command]
async fn book_places(state: State<'_, AppLibrary>) -> CommandResult<tbv_core::sync::places::PlacesView> {
    let library = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || sync::book_places(&library))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

/// How much of the Supabase project this library is using.
#[tauri::command]
async fn supabase_usage(state: State<'_, AppLibrary>) -> CommandResult<tbv_core::sync::supabase::Usage> {
    let library = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || sync::supabase_usage(&library))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
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

#[tauri::command]
async fn all_tags(state: State<'_, AppLibrary>) -> CommandResult<Vec<tbv_core::manage::TagCount>> {
    with_library(state, |library| library.all_tags()).await
}

#[tauri::command]
async fn add_tag(
    state: State<'_, AppLibrary>,
    book_ids: Vec<String>,
    tag: String,
) -> CommandResult<String> {
    with_library(state, move |library| library.add_tag(&book_ids, &tag)).await
}

#[tauri::command]
async fn remove_tag(
    state: State<'_, AppLibrary>,
    book_ids: Vec<String>,
    tag: String,
) -> CommandResult<()> {
    with_library(state, move |library| library.remove_tag(&book_ids, &tag)).await
}

#[tauri::command]
async fn set_book_tags(
    state: State<'_, AppLibrary>,
    book_id: String,
    tags: Vec<String>,
) -> CommandResult<Vec<String>> {
    with_library(state, move |library| library.set_book_tags(&book_id, &tags)).await
}

#[tauri::command]
async fn book_details(
    state: State<'_, AppLibrary>,
    book_id: String,
) -> CommandResult<tbv_core::details::BookDetails> {
    with_library(state, move |library| library.book_details(&book_id)).await
}

#[tauri::command]
async fn edit_details(
    state: State<'_, AppLibrary>,
    book_ids: Vec<String>,
    changes: Vec<tbv_core::details::DetailChange>,
) -> CommandResult<()> {
    with_library(state, move |library| library.edit_details(&book_ids, &changes)).await
}

#[tauri::command]
async fn reset_details(state: State<'_, AppLibrary>, book_id: String, fetched: bool) -> CommandResult<()> {
    with_library(state, move |library| library.reset_details(&book_id, fetched)).await
}

#[tauri::command]
async fn save_fetched(
    state: State<'_, AppLibrary>,
    book_id: String,
    source: String,
    values: std::collections::BTreeMap<String, String>,
) -> CommandResult<()> {
    with_library(state, move |library| library.save_fetched(&book_id, &source, &values)).await
}

#[tauri::command]
async fn delete_book(state: State<'_, AppLibrary>, book_id: String) -> CommandResult<()> {
    with_library(state, move |library| library.delete_book(&book_id)).await
}

#[tauri::command]
async fn remove_from_library(state: State<'_, AppLibrary>, book_id: String) -> CommandResult<()> {
    with_library(state, move |library| library.remove_from_library(&book_id)).await
}

/// Saves copies of books, named "Title - Author", into a folder. Cloud-only
/// books are fetched first; the library's own copies are only read.
#[tauri::command]
async fn save_copies(state: State<'_, AppLibrary>, book_ids: Vec<String>, folder: String) -> CommandResult<usize> {
    let folder = PathBuf::from(folder);
    let mut saved = 0;
    for id in book_ids {
        let book = outgoing(state.clone(), id).await?;
        let to = folder.clone();
        tauri::async_runtime::spawn_blocking(move || tbv_core::ereaders::save_copy(&book, &to))
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e| e.to_string())?;
        saved += 1;
    }
    Ok(saved)
}

/// Moves everything of yours from a copy of a book that's about to go to the one that stays.
#[tauri::command]
async fn merge_reading(state: State<'_, AppLibrary>, keep_id: String, from_id: String) -> CommandResult<()> {
    with_library(state, move |library| library.merge_reading_into(&keep_id, &from_id)).await
}

/// Makes copies more files of one book, listed as that book.
#[tauri::command]
async fn keep_together(state: State<'_, AppLibrary>, main_id: String, other_ids: Vec<String>) -> CommandResult<()> {
    with_library(state, move |library| library.keep_together(&main_id, &other_ids)).await
}

#[tauri::command]
async fn keep_apart(state: State<'_, AppLibrary>, book_id: String) -> CommandResult<()> {
    with_library(state, move |library| library.keep_apart(&book_id)).await
}

#[tauri::command]
async fn book_files(state: State<'_, AppLibrary>, book_id: String) -> CommandResult<Vec<tbv_core::model::BookFile>> {
    with_library(state, move |library| library.book_files(&book_id)).await
}

#[tauri::command]
async fn remove_download(state: State<'_, AppLibrary>, book_id: String) -> CommandResult<()> {
    with_library(state, move |library| library.remove_download(&book_id)).await
}

#[tauri::command]
async fn find_duplicates(
    state: State<'_, AppLibrary>,
) -> CommandResult<Vec<tbv_core::manage::DuplicateGroup>> {
    with_library(state, |library| library.find_duplicates()).await
}

#[tauri::command]
async fn share_best_cover(state: State<'_, AppLibrary>, book_ids: Vec<String>) -> CommandResult<u32> {
    with_library(state, move |library| library.share_best_cover(&book_ids)).await
}

#[tauri::command]
async fn dismiss_duplicates(state: State<'_, AppLibrary>, key: String) -> CommandResult<()> {
    with_library(state, move |library| library.dismiss_duplicates(&key)).await
}

/// E-readers plugged in by cable. Looking at the drives can take a moment,
/// so it happens off the UI thread, and never holds the library.
#[tauri::command]
async fn list_ereaders() -> CommandResult<Vec<ereaders::Ereader>> {
    tauri::async_runtime::spawn_blocking(ereaders::connected).await.map_err(|e| e.to_string())
}

/// What sending a book needs, fetching it first if it's only in the cloud.
/// The library is held just while the book is looked up.
async fn outgoing(state: State<'_, AppLibrary>, book_id: String) -> CommandResult<ereaders::Outgoing> {
    let library = state.0.clone();
    let id = book_id.clone();
    match with_library(state, move |library| library.outgoing_book(&id)).await {
        Ok(book) => Ok(book),
        Err(_) => tauri::async_runtime::spawn_blocking(move || {
            sync::download(&library, &book_id)?;
            library
                .lock()
                .map_err(|_| tbv_core::Error::Unsuitable("the library is unavailable".into()))?
                .outgoing_book(&book_id)
        })
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string()),
    }
}

/// Copies a book onto the reader plugged in at `root`. The library's own
/// copy is only read.
#[tauri::command]
async fn copy_to_ereader(state: State<'_, AppLibrary>, book_id: String, root: String) -> CommandResult<ereaders::Copied> {
    let book = outgoing(state, book_id).await?;
    tauri::async_runtime::spawn_blocking(move || {
        let reader = ereaders::at(std::path::Path::new(&root))
            .ok_or_else(|| tbv_core::Error::Unsuitable("That reader isn't connected any more. Plug it in again and try once more.".into()))?;
        ereaders::copy_to(&reader, &book)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

#[tauri::command]
async fn kindle_email_settings(state: State<'_, AppLibrary>) -> CommandResult<Option<email::KindleEmailView>> {
    with_library(state, |library| library.kindle_email_view()).await
}

#[tauri::command]
async fn save_kindle_email(state: State<'_, AppLibrary>, settings: email::KindleEmailInput) -> CommandResult<email::KindleEmailView> {
    with_library(state, move |library| library.save_kindle_email(&settings)).await
}

#[tauri::command]
async fn forget_kindle_email(state: State<'_, AppLibrary>) -> CommandResult<()> {
    with_library(state, |library| library.forget_kindle_email()).await
}

async fn kindle_settings(state: State<'_, AppLibrary>) -> CommandResult<email::KindleEmail> {
    with_library(state, |library| library.kindle_email())
        .await?
        .ok_or_else(|| "Set up Kindle by email first, in Preferences › E-readers.".to_string())
}

/// Emails a book to the person's Kindle. The email service is waited on
/// away from the library's lock.
#[tauri::command]
async fn send_to_kindle(state: State<'_, AppLibrary>, book_id: String) -> CommandResult<()> {
    let settings = kindle_settings(state.clone()).await?;
    let book = outgoing(state, book_id).await?;
    tauri::async_runtime::spawn_blocking(move || email::send_book(&settings, &book))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

/// Sends a small test document to the Kindle with the saved settings.
#[tauri::command]
async fn send_kindle_test(state: State<'_, AppLibrary>) -> CommandResult<()> {
    let settings = kindle_settings(state).await?;
    tauri::async_runtime::spawn_blocking(move || email::send_test(&settings))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn list_servers(state: State<'_, AppLibrary>) -> CommandResult<Vec<tbv_core::servers::ServerView>> {
    with_library(state, |library| library.server_views()).await
}

#[tauri::command]
async fn save_server(
    state: State<'_, AppLibrary>,
    queue: State<'_, Arc<servers::ServerImports>>,
    server: tbv_core::servers::ServerInput,
) -> CommandResult<tbv_core::servers::ServerView> {
    let saved = with_library(state, move |library| library.save_server(&server)).await?;
    queue.forget(&saved.id);
    Ok(saved)
}

#[tauri::command]
async fn remove_server(
    state: State<'_, AppLibrary>,
    queue: State<'_, Arc<servers::ServerImports>>,
    id: String,
) -> CommandResult<()> {
    queue.forget(&id);
    with_library(state, move |library| library.remove_server(&id)).await
}

/// Remembers an SFTP server's key once the person has said it's theirs.
#[tauri::command]
async fn trust_server_key(
    state: State<'_, AppLibrary>,
    id: String,
    fingerprint: String,
) -> CommandResult<tbv_core::servers::ServerView> {
    with_library(state, move |library| library.trust_server_key(&id, &fingerprint)).await
}

/// Runs `work` against a saved server, off the UI thread and without the
/// library held while the server is waited on.
async fn on_server<T, F>(state: State<'_, AppLibrary>, id: String, work: F) -> CommandResult<T>
where
    T: Send + 'static,
    F: FnOnce(&tbv_core::servers::Server) -> tbv_core::Result<T> + Send + 'static,
{
    let library = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || work(&servers::saved(&library, &id)?))
        .await
        .map_err(|e| e.to_string())?
        .map_err(servers::problem)
}

/// Connects to a saved server and says what's there.
#[tauri::command]
async fn test_server(state: State<'_, AppLibrary>, id: String) -> CommandResult<String> {
    on_server(state, id, tbv_core::servers::test).await
}

/// A folder on a server: its folders and the files TBV can import. No path
/// means where browsing starts. The connection stays open for the next folder.
#[tauri::command]
async fn browse_server(
    state: State<'_, AppLibrary>,
    queue: State<'_, Arc<servers::ServerImports>>,
    id: String,
    path: Option<String>,
) -> CommandResult<tbv_core::servers::Listing> {
    let queue = queue.inner().clone();
    on_server(state, id, move |server| queue.browse(server, path)).await
}

/// Lists every file in what was ticked and starts bringing them down; each
/// joins the import queue as it arrives.
#[tauri::command]
async fn download_from_server(
    app: tauri::AppHandle,
    state: State<'_, AppLibrary>,
    imports: State<'_, Arc<imports::Imports>>,
    queue: State<'_, Arc<servers::ServerImports>>,
    id: String,
    chosen: Vec<tbv_core::servers::Chosen>,
) -> CommandResult<()> {
    if chosen.is_empty() {
        return Err("Tick the files or folders to bring in first.".into());
    }
    let library = state.0.clone();
    let server = {
        let library = library.clone();
        tauri::async_runtime::spawn_blocking(move || servers::saved(&library, &id))
            .await
            .map_err(|e| e.to_string())?
            .map_err(servers::problem)?
    };
    queue.inner().bring_in(app, library, imports.inner().clone(), server, chosen);
    Ok(())
}

#[tauri::command]
async fn server_queue(state: State<'_, AppLibrary>, queue: State<'_, Arc<servers::ServerImports>>) -> CommandResult<servers::ServerQueueView> {
    let (library, queue) = (state.0.clone(), queue.inner().clone());
    tauri::async_runtime::spawn_blocking(move || queue.view(&library)).await.map_err(|e| e.to_string())
}

#[tauri::command(async)]
fn server_queue_page(
    queue: State<'_, Arc<servers::ServerImports>>,
    offset: usize,
    limit: usize,
) -> Vec<tbv_core::servers::queue::QueuedFile> {
    queue.page(offset, limit)
}

#[tauri::command]
async fn retry_server_file(
    app: tauri::AppHandle,
    state: State<'_, AppLibrary>,
    imports: State<'_, Arc<imports::Imports>>,
    queue: State<'_, Arc<servers::ServerImports>>,
    id: u64,
) -> CommandResult<()> {
    let (library, imports, queue) = (state.0.clone(), imports.inner().clone(), queue.inner().clone());
    tauri::async_runtime::spawn_blocking(move || queue.retry(&app, &library, &imports, id)).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn remove_server_file(
    app: tauri::AppHandle,
    state: State<'_, AppLibrary>,
    imports: State<'_, Arc<imports::Imports>>,
    queue: State<'_, Arc<servers::ServerImports>>,
    id: u64,
) -> CommandResult<()> {
    let (library, imports, queue) = (state.0.clone(), imports.inner().clone(), queue.inner().clone());
    tauri::async_runtime::spawn_blocking(move || queue.remove(&app, &library, &imports, id)).await.map_err(|e| e.to_string())
}

#[tauri::command(async)]
fn cancel_server_queue(app: tauri::AppHandle, queue: State<'_, Arc<servers::ServerImports>>) {
    queue.cancel(&app);
}

#[tauri::command(async)]
fn clear_server_finished(app: tauri::AppHandle, queue: State<'_, Arc<servers::ServerImports>>) {
    queue.clear_finished(&app);
}

/// How many files come down from servers at once, 1 to 5.
#[tauri::command]
async fn set_server_connections(
    app: tauri::AppHandle,
    state: State<'_, AppLibrary>,
    imports: State<'_, Arc<imports::Imports>>,
    queue: State<'_, Arc<servers::ServerImports>>,
    count: usize,
) -> CommandResult<()> {
    let (library, imports, queue) = (state.0.clone(), imports.inner().clone(), queue.inner().clone());
    tauri::async_runtime::spawn_blocking(move || {
        let count = count.clamp(1, servers::MAX_CONNECTIONS);
        library.lock().map_err(|_| "TBV is busy. Try again.".to_string())?.set_setting(servers::CONNECTIONS_KEY, &count.to_string()).map_err(|e| e.to_string())?;
        // Fewer: downloads under way finish, and the extra ones stop after.
        queue.start_workers(&app, &library, &imports);
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Looks a book up in Audible's catalogue, or on Hardcover when it's
/// connected (nothing otherwise), for Find details online.
#[tauri::command]
async fn search_details_more(
    state: State<'_, AppLibrary>,
    source: String,
    title: String,
    author: String,
) -> CommandResult<Vec<tbv_core::lookup::Found>> {
    let library = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || match source.as_str() {
        "audible" => tbv_core::lookup::search_audible(&title, &author),
        "hardcover" => hardcover::lookup(&library, &title, &author).map(Option::unwrap_or_default),
        other => Err(tbv_core::Error::Unsuitable(format!("unknown source {other}"))),
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

/// Looks the books of a series up online, in every source at once
/// (Hardcover when it's connected, Wikidata, the ISFDB, Audible and Google
/// Books), and keeps the merged list, for showing what's missing.
#[tauri::command]
async fn find_series_books(state: State<'_, AppLibrary>, name: String, author: String) -> CommandResult<tbv_core::series::SeriesReview> {
    let library = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        use tbv_core::series::{search_audible_series, SeriesEntry};
        use tbv_core::series_sources::{search_google_series, search_isfdb_series, search_wikidata_series};
        type Found = tbv_core::Result<Vec<SeriesEntry>>;
        let (name, author) = (name.as_str(), author.as_str());
        // Earlier sources' numbers win when they disagree.
        let results: Vec<Found> = std::thread::scope(|scope| {
            let hardcover = scope.spawn(|| hardcover::series(&library, name).map(Option::unwrap_or_default));
            let others: Vec<_> = [
                search_wikidata_series as fn(&str, &str) -> Found,
                search_isfdb_series,
                search_audible_series,
                search_google_series,
            ]
            .into_iter()
            .map(|search| scope.spawn(move || search(name, author)))
            .collect();
            std::iter::once(hardcover)
                .chain(others)
                .map(|h| h.join().unwrap_or_else(|_| Err(tbv_core::Error::Offline("a search stopped unexpectedly".into()))))
                .collect()
        });
        let problem = results.iter().all(Result::is_err).then(|| results.iter().find_map(|r| r.as_ref().err().map(ToString::to_string))).flatten();
        let lists: Vec<Vec<SeriesEntry>> = results.into_iter().map(Result::unwrap_or_default).collect();
        let books = tbv_core::series::merge(lists);
        if books.is_empty() {
            return Err(tbv_core::Error::Unsuitable(
                problem.unwrap_or_else(|| format!("No list of the books in {name} was found online.")),
            ));
        }
        hardcover::lock(&library)?.save_series_found(name, books)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

#[tauri::command]
async fn series_review(state: State<'_, AppLibrary>, name: String) -> CommandResult<tbv_core::series::SeriesReview> {
    with_library(state, move |library| library.series_review(&name)).await
}

#[tauri::command]
async fn hide_series_book(state: State<'_, AppLibrary>, name: String, key: String, hidden: bool) -> CommandResult<tbv_core::series::SeriesReview> {
    with_library(state, move |library| library.hide_series_book(&name, &key, hidden)).await
}

#[tauri::command]
async fn mark_series_book_read(state: State<'_, AppLibrary>, name: String, key: String, read: bool) -> CommandResult<tbv_core::series::SeriesReview> {
    with_library(state, move |library| library.mark_series_book_read(&name, &key, read)).await
}

#[tauri::command]
async fn add_series_book(
    state: State<'_, AppLibrary>,
    name: String,
    title: String,
    position: Option<f64>,
    authors: Vec<String>,
) -> CommandResult<tbv_core::series::SeriesReview> {
    with_library(state, move |library| library.add_series_book(&name, &title, position, authors)).await
}

#[tauri::command]
async fn remove_series_book(state: State<'_, AppLibrary>, name: String, key: String) -> CommandResult<tbv_core::series::SeriesReview> {
    with_library(state, move |library| library.remove_series_book(&name, &key)).await
}

#[tauri::command]
async fn approve_series_matches(
    state: State<'_, AppLibrary>,
    name: String,
    approvals: Vec<tbv_core::series::Approval>,
) -> CommandResult<tbv_core::series::SeriesReview> {
    with_library(state, move |library| library.approve_series_matches(&name, &approvals)).await
}

#[tauri::command]
async fn deny_series_matches(state: State<'_, AppLibrary>, name: String, book_ids: Vec<String>) -> CommandResult<tbv_core::series::SeriesReview> {
    with_library(state, move |library| library.deny_series_matches(&name, &book_ids)).await
}

#[tauri::command]
async fn home_status(app: tauri::AppHandle, home: State<'_, Arc<home::Home>>) -> CommandResult<home::HomeStatus> {
    let home = home.inner().clone();
    tauri::async_runtime::spawn_blocking(move || home.status(&app)).await.map_err(|e| e.to_string())
}

/// Turns "Use on your phone at home" on or off.
#[tauri::command]
async fn set_home(app: tauri::AppHandle, home: State<'_, Arc<home::Home>>, on: bool) -> CommandResult<home::HomeStatus> {
    let home = home.inner().clone();
    tauri::async_runtime::spawn_blocking(move || home.set(&app, on)).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn new_home_code(app: tauri::AppHandle, home: State<'_, Arc<home::Home>>) -> CommandResult<home::HomeStatus> {
    let home = home.inner().clone();
    tauri::async_runtime::spawn_blocking(move || home.new_code(&app)).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn forget_home_phones(app: tauri::AppHandle, home: State<'_, Arc<home::Home>>) -> CommandResult<home::HomeStatus> {
    let home = home.inner().clone();
    tauri::async_runtime::spawn_blocking(move || home.forget_phones(&app)).await.map_err(|e| e.to_string())
}

fn localsend_inbox(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join("LocalSend inbox"))
}

#[tauri::command]
async fn localsend_status(state: State<'_, AppLibrary>, localsend: State<'_, Arc<localsend::LocalSend>>) -> CommandResult<localsend::LocalSendStatus> {
    let (library, localsend) = (state.0.clone(), localsend.inner().clone());
    tauri::async_runtime::spawn_blocking(move || localsend.status(&library)).await.map_err(|e| e.to_string())
}

/// Switches receiving from LocalSend on or off.
#[tauri::command]
async fn set_localsend(
    app: tauri::AppHandle,
    state: State<'_, AppLibrary>,
    imports: State<'_, Arc<imports::Imports>>,
    localsend: State<'_, Arc<localsend::LocalSend>>,
    on: bool,
) -> CommandResult<localsend::LocalSendStatus> {
    let (library, imports, localsend) = (state.0.clone(), imports.inner().clone(), localsend.inner().clone());
    let inbox = localsend_inbox(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        localsend.set(&app, &library, &imports, inbox, on).map_err(|e| e.to_string())?;
        Ok(localsend.status(&library))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Accepts or turns down what someone is sending with LocalSend.
/// Every file sent with LocalSend this run, for the Imports page.
#[tauri::command(async)]
fn localsend_files(localsend: State<'_, Arc<localsend::LocalSend>>) -> Vec<tbv_core::localsend::SentFile> {
    localsend.rows()
}

#[tauri::command(async)]
fn clear_localsend_finished(app: tauri::AppHandle, localsend: State<'_, Arc<localsend::LocalSend>>) {
    localsend.clear_finished(&app);
}

#[tauri::command(async)]
fn answer_localsend(localsend: State<'_, Arc<localsend::LocalSend>>, session: String, accept: bool) {
    localsend.answer(&session, accept);
}

/// Devices nearby with LocalSend open, to send books to.
#[tauri::command]
async fn localsend_nearby(state: State<'_, AppLibrary>, localsend: State<'_, Arc<localsend::LocalSend>>) -> CommandResult<Vec<tbv_core::localsend::Nearby>> {
    let (library, localsend) = (state.0.clone(), localsend.inner().clone());
    tauri::async_runtime::spawn_blocking(move || localsend.nearby(&library)).await.map_err(|e| e.to_string())?.map_err(|e| e.to_string())
}

/// The device at an address LocalSend shows, typed in by hand.
#[tauri::command]
async fn localsend_device_at(localsend: State<'_, Arc<localsend::LocalSend>>, address: String) -> CommandResult<tbv_core::localsend::Nearby> {
    let localsend = localsend.inner().clone();
    tauri::async_runtime::spawn_blocking(move || localsend.device_at(&address)).await.map_err(|e| e.to_string())?.map_err(|e| e.to_string())
}

/// What sending with LocalSend did.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SentWithLocalSend {
    sent: usize,
    /// Books that couldn't go, and why.
    skipped: Vec<(String, String)>,
}

/// Sends books to a device nearby with LocalSend. Cloud-only books are
/// fetched first; the library's own copies are only read.
#[tauri::command]
async fn localsend_send(
    app: tauri::AppHandle,
    state: State<'_, AppLibrary>,
    localsend: State<'_, Arc<localsend::LocalSend>>,
    device: tbv_core::localsend::Nearby,
    book_ids: Vec<String>,
) -> CommandResult<SentWithLocalSend> {
    let mut books = Vec::new();
    let mut skipped = Vec::new();
    for id in book_ids {
        match outgoing(state.clone(), id.clone()).await {
            Ok(book) => books.push((book.title, tbv_core::localsend::ToSend { path: book.path, name: book.file_name, size: book.size })),
            Err(e) => {
                let title = with_library(state.clone(), move |l| Ok(l.book_facts(&id)?.map(|f| f.title))).await.ok().flatten().unwrap_or_else(|| "A book".into());
                skipped.push((title, e));
            }
        }
    }
    if books.is_empty() {
        return Ok(SentWithLocalSend { sent: 0, skipped });
    }
    let (library, localsend) = (state.0.clone(), localsend.inner().clone());
    let sent = tauri::async_runtime::spawn_blocking(move || localsend.send(&app, &library, &device, &books))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
    Ok(SentWithLocalSend { sent, skipped })
}

#[tauri::command(async)]
fn localsend_stop_sending(localsend: State<'_, Arc<localsend::LocalSend>>) {
    localsend.stop_sending();
}

/// Opens File Explorer at a file or folder TBV keeps.
#[tauri::command]
fn show_folder(path: String) -> CommandResult<()> {
    tauri_plugin_opener::reveal_item_in_dir(path).map_err(|e| e.to_string())
}

/// Asks for a folder in the iPhone's Files app (the iCloud Drive library
/// folder). TBV can open it again after a restart. None if cancelled.
#[tauri::command]
async fn ios_pick_folder() -> CommandResult<Option<String>> {
    #[cfg(target_os = "ios")]
    {
        tauri::async_runtime::spawn_blocking(tauri_plugin_tbv_ios::pick_folder).await.map_err(|e| e.to_string())?
    }
    #[cfg(not(target_os = "ios"))]
    Err("Choosing a folder this way only works on iPhone.".into())
}

/// Asks for files in the iPhone's Files app, copied into TBV's own folder so
/// they're there to import. Empty if cancelled.
#[tauri::command]
async fn ios_pick_files(keep: Option<bool>) -> CommandResult<Vec<String>> {
    #[cfg(target_os = "ios")]
    {
        let keep = keep.unwrap_or(false);
        tauri::async_runtime::spawn_blocking(move || tauri_plugin_tbv_ios::pick_files(keep)).await.map_err(|e| e.to_string())?
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = keep;
        Err("Choosing files this way only works on iPhone.".into())
    }
}

/// A picture from Photos on iPhone and iPad; None if cancelled.
#[tauri::command]
async fn ios_pick_photo() -> CommandResult<Option<String>> {
    #[cfg(target_os = "ios")]
    {
        tauri::async_runtime::spawn_blocking(tauri_plugin_tbv_ios::pick_photo).await.map_err(|e| e.to_string())?
    }
    #[cfg(not(target_os = "ios"))]
    Err("Choosing from Photos only works on iPhone and iPad.".into())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init());
    #[cfg(target_os = "ios")]
    let builder = builder.plugin(tauri_plugin_tbv_ios::init());
    builder
        .register_asynchronous_uri_scheme_protocol("tbvaudio", audio::serve)
        .setup(|app| {
            // iCloud on iPhone keeps only stand-ins for files until asked.
            #[cfg(target_os = "ios")]
            tbv_core::sync::files::set_fetcher(tauri_plugin_tbv_ios::fetch);
            #[cfg(target_os = "ios")]
            tbv_core::sync::files::set_refresher(tauri_plugin_tbv_ios::refresh);
            // An iPad says it's an iPad, not an iPhone.
            #[cfg(target_os = "ios")]
            std::thread::spawn(|| {
                if let Some(kind) = tauri_plugin_tbv_ios::device_kind() {
                    tbv_core::profile::set_device_kind(&kind);
                }
            });
            let data_dir = app.path().app_data_dir()?;
            let cache_dir = app.path().app_cache_dir()?;
            let library = Arc::new(Mutex::new(Library::open(LibraryPaths::new(&data_dir, &cache_dir))?));
            // Audiobooks and ebooks already here find their other half.
            let linking = library.clone();
            std::thread::spawn(move || {
                if let Ok(library) = linking.lock() {
                    let _ = library.auto_link_audiobooks();
                }
            });
            app.manage(Arc::new(sync::SyncWorker::start(app.handle().clone(), library.clone())));
            app.manage(AppLibrary(library));
            app.manage(Arc::new(hardcover::Sends::default()));
            let imports = Arc::new(imports::Imports::default());
            app.manage(imports.clone());
            app.manage(Arc::new(moving::Mover::default()));
            // Files from servers that were coming down, or waiting to be
            // added, when TBV last closed carry on where they were.
            let server_imports = Arc::new(servers::ServerImports::open(&tbv_core::servers::downloads_dir(&data_dir)));
            app.manage(server_imports.clone());
            let library = app.state::<AppLibrary>().0.clone();
            server_imports.resume(app.handle(), &library, &imports);
            let receiving = Arc::new(localsend::LocalSend::default());
            app.manage(receiving.clone());
            // iPhones and iPads take books with Grimoire too, while TBV is open.
            receiving.start(app.handle(), &library, &imports, data_dir.join("LocalSend inbox"));
            #[cfg(mobile)]
            browser::listen(app.handle().clone());
            // A book half brought down from a catalog when TBV closed isn't kept.
            let _ = std::fs::remove_dir_all(writing::downloads_dir(&data_dir));
            let home = Arc::new(home::Home::default());
            app.manage(home.clone());
            #[cfg(desktop)]
            home.resume(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ios_pick_folder,
            ios_pick_files,
            ios_pick_photo,
            browser::browser_show,
            browser::browser_place,
            browser::browser_hide,
            browser::browser_act,
            browser::browser_add_download,
            browser::browser_keep_download,
            browser::browser_discard_download,
            browser::download_web_book,
            browser::bookmarks,
            browser::add_bookmark,
            browser::rename_bookmark,
            browser::remove_bookmark,
            writing::catalogs,
            writing::save_catalog,
            writing::remove_catalog,
            writing::catalog_feed,
            writing::catalog_search,
            writing::download_from_catalog,
            writing::writing_projects,
            writing::writing_project,
            writing::create_writing_project,
            writing::update_writing_details,
            writing::set_writing_export,
            writing::set_writing_cover,
            writing::set_writing_cover_bytes,
            writing::set_writing_chapter_role,
            writing::delete_writing_project,
            writing::add_writing_chapter,
            writing::save_writing_chapter,
            writing::order_writing_chapters,
            writing::delete_writing_chapter,
            writing::writing_cover,
            writing::save_writing_epub,
            get_home,
            all_tags,
            add_tag,
            remove_tag,
            set_book_tags,
            delete_book,
            remove_download,
            remove_from_library,
            save_copies,
            merge_reading,
            keep_together,
            keep_apart,
            book_files,
            find_duplicates,
            find_series_books,
            prepare_stream,
            audio_clip,
            audio_clips_done,
            read_along_timing,
            save_read_along_timing,
            home_status,
            set_home,
            new_home_code,
            forget_home_phones,
            series_review,
            hide_series_book,
            mark_series_book_read,
            add_series_book,
            remove_series_book,
            approve_series_matches,
            deny_series_matches,
            dismiss_duplicates,
            share_best_cover,
            book_details,
            edit_details,
            reset_details,
            save_fetched,
            queue_imports,
            import_queue,
            take_pdf_covers,
            cancel_imports,
            clear_finished_imports,
            export_goodreads,
            hardcover_status,
            hardcover_set_sending,
            hardcover_sign_in,
            hardcover_sign_out,
            hardcover_send_all,
            book_text,
            fill_cover,
            fetch_cover,
            audiobook,
            save_listening,
            add_time,
            time_spent,
            link_ebook,
            audiobook_for_ebook,
            set_book_status,
            get_library,
            get_collections,
            set_favorite,
            set_want_to_read,
            set_phone_wanted,
            set_rating,
            import_goodreads,
            get_profile,
            set_avatar,
            clear_avatar,
            set_account_name,
            set_device_name,
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
            count_rule_matches,
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
            set_sync_provider,
            set_also_sync,
            sync_activity,
            suggest_sync_folder,
            resolve_sync_conflict,
            download_book,
            plan_tidy_cloud,
            tidy_cloud,
            supabase_usage,
            supabase_contents,
            book_places,
            remove_supabase_files,
            list_ereaders,
            copy_to_ereader,
            kindle_email_settings,
            save_kindle_email,
            forget_kindle_email,
            send_to_kindle,
            send_kindle_test,
            move_status,
            move_sign_in,
            move_sign_out,
            start_move,
            retry_move,
            cancel_move,
            clear_move,
            list_servers,
            save_server,
            remove_server,
            trust_server_key,
            test_server,
            browse_server,
            download_from_server,
            server_queue,
            server_queue_page,
            retry_server_file,
            remove_server_file,
            cancel_server_queue,
            clear_server_finished,
            set_server_connections,
            search_details_more,
            localsend_status,
            set_localsend,
            answer_localsend,
            localsend_nearby,
            localsend_device_at,
            localsend_send,
            localsend_stop_sending,
            localsend_files,
            clear_localsend_finished,
        ])
        // Alt+F4 or closing from the taskbar ends the app the same way. The
        // page gets a moment to save the reading position first; then ratings
        // on their way to Hardcover and the last sync get their chance, and
        // the app quits regardless after that.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.emit("tbv://quit-requested", ());
                let app = window.app_handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_secs(2));
                    for window in app.webview_windows().values() {
                        let _ = window.hide();
                    }
                    let sends = app.try_state::<Arc<hardcover::Sends>>().map(|s| s.inner().clone());
                    let ratings = std::thread::spawn(move || {
                        if let Some(sends) = sends {
                            sends.finish(Duration::from_secs(5));
                        }
                    });
                    if let Some(worker) = app.try_state::<Arc<sync::SyncWorker>>() {
                        worker.finish(Duration::from_secs(8));
                    }
                    let _ = ratings.join();
                    app.exit(0);
                });
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running The Bound Vigil");
}

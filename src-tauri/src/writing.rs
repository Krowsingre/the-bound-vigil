//! Commands for OPDS catalogs and the Writing page. Catalog pages and
//! downloads are fetched without holding the library, so browsing a slow
//! catalog never holds up the rest of the app; books brought down join the
//! import queue like any others.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use tauri::{Emitter, Manager, State};
use tbv_core::opds::{CatalogInput, CatalogView, OpdsFeed, OpdsFile};
use tbv_core::servers::TempFolder;
use tbv_core::writing::{WritingChapter, WritingDetails, WritingDraft, WritingProject, WritingProjectView};

use crate::{imports, with_library, AppLibrary, CommandResult};

/// Where books from catalogs wait for the import queue.
pub fn downloads_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("Catalog downloads")
}

#[tauri::command]
pub async fn catalogs(state: State<'_, AppLibrary>) -> CommandResult<Vec<CatalogView>> {
    with_library(state, |library| library.catalogs()).await
}

#[tauri::command]
pub async fn save_catalog(state: State<'_, AppLibrary>, catalog: CatalogInput) -> CommandResult<CatalogView> {
    with_library(state, move |library| library.save_catalog(&catalog)).await
}

/// Signs in to an Audiobookshelf server and saves it as a catalogue. With
/// no password, an existing one keeps its sign-in.
#[tauri::command]
pub async fn save_abs_server(
    state: State<'_, AppLibrary>,
    id: Option<String>,
    name: String,
    url: String,
    username: String,
    password: Option<String>,
) -> CommandResult<CatalogView> {
    let base = tbv_core::audiobookshelf::tidy_address(&url).map_err(|e| e.to_string())?;
    let username = username.trim().to_string();
    let token = match password.filter(|p| !p.is_empty()) {
        Some(password) => {
            let (base, username) = (base.clone(), username.clone());
            Some(
                tauri::async_runtime::spawn_blocking(move || tbv_core::audiobookshelf::sign_in(&base, &username, &password))
                    .await
                    .map_err(|e| e.to_string())?
                    .map_err(|e| e.to_string())?,
            )
        }
        None => None,
    };
    with_library(state, move |library| library.save_abs_server(id.as_deref(), &name, &base, &username, token)).await
}

#[tauri::command]
pub async fn remove_catalog(state: State<'_, AppLibrary>, id: String) -> CommandResult<()> {
    with_library(state, move |library| library.remove_catalog(&id)).await
}

/// A page of a catalog: where it starts, when `url` is none.
#[tauri::command]
pub async fn catalog_feed(state: State<'_, AppLibrary>, id: String, url: Option<String>) -> CommandResult<OpdsFeed> {
    let library = state.0.clone();
    let access = with_library(state, move |library| library.catalog_access(&id)).await?;
    let feed = tauri::async_runtime::spawn_blocking(move || access.feed(url.as_deref()).map_err(|e| e.to_string())).await.map_err(|e| e.to_string())?;
    keep_sign_ins(&library);
    feed
}

/// Saves a sign-in an Audiobookshelf server renewed while it was being used.
fn keep_sign_ins(library: &std::sync::Mutex<tbv_core::Library>) {
    if let Ok(l) = library.lock() {
        let _ = l.keep_abs_sign_ins();
    }
}

#[tauri::command]
pub async fn catalog_search(state: State<'_, AppLibrary>, id: String, search: String, words: String) -> CommandResult<OpdsFeed> {
    let library = state.0.clone();
    let access = with_library(state, move |library| library.catalog_access(&id)).await?;
    let feed = tauri::async_runtime::spawn_blocking(move || access.search(&search, &words).map_err(|e| e.to_string())).await.map_err(|e| e.to_string())?;
    keep_sign_ins(&library);
    feed
}

/// Brings a book down from a catalog and hands it to the import queue.
#[tauri::command]
pub async fn download_from_catalog(
    app: tauri::AppHandle,
    state: State<'_, AppLibrary>,
    imports: State<'_, Arc<imports::Imports>>,
    id: String,
    file: OpdsFile,
    title: String,
) -> CommandResult<()> {
    let library = state.0.clone();
    let access = with_library(state, move |library| library.catalog_access(&id)).await?;
    let downloads = downloads_dir(&app.path().app_data_dir().map_err(|e| e.to_string())?);
    let imports = imports.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let folder = Arc::new(TempFolder::new(&downloads).map_err(|e| e.to_string())?);
        let path = access.download(&file, &title, folder.path());
        keep_sign_ins(&library);
        imports.add_holding(&app, &library, vec![path.map_err(|e| e.to_string())?], Some(folder));
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn writing_projects(state: State<'_, AppLibrary>) -> CommandResult<Vec<WritingProject>> {
    with_library(state, |library| library.writing_projects()).await
}

#[tauri::command]
pub async fn writing_project(state: State<'_, AppLibrary>, id: String) -> CommandResult<WritingProjectView> {
    with_library(state, move |library| library.writing_project(&id)).await
}

#[tauri::command]
pub async fn create_writing_project(state: State<'_, AppLibrary>, title: String, author: Option<String>) -> CommandResult<WritingProjectView> {
    with_library(state, move |library| library.create_writing_project(&title, author.as_deref())).await
}

#[tauri::command]
pub async fn update_writing_details(state: State<'_, AppLibrary>, id: String, details: WritingDetails) -> CommandResult<WritingProject> {
    with_library(state, move |library| library.update_writing_details(&id, &details)).await
}

#[tauri::command]
pub async fn set_writing_export(state: State<'_, AppLibrary>, id: String, export: String) -> CommandResult<()> {
    with_library(state, move |library| library.set_writing_export(&id, &export)).await
}

#[tauri::command]
pub async fn set_writing_cover(state: State<'_, AppLibrary>, id: String, path: Option<String>) -> CommandResult<WritingProject> {
    with_library(state, move |library| library.set_writing_cover(&id, path.as_deref().map(Path::new))).await
}

/// A cover made in TBV, sent as the picture's raw bytes with its id and kind of file in headers.
#[tauri::command]
pub async fn set_writing_cover_bytes(state: State<'_, AppLibrary>, request: tauri::ipc::Request<'_>) -> CommandResult<WritingProject> {
    let tauri::ipc::InvokeBody::Raw(picture) = request.body() else {
        return Err("expected a picture".into());
    };
    let header = |name: &str| request.headers().get(name).and_then(|v| v.to_str().ok()).map(str::to_string);
    let id = header("project-id").ok_or("which book?")?;
    let extension = header("extension").unwrap_or_else(|| "png".into());
    let picture = picture.clone();
    with_library(state, move |library| library.set_writing_cover_bytes(&id, &picture, &extension)).await
}

#[tauri::command]
pub async fn set_writing_chapter_role(state: State<'_, AppLibrary>, id: String, role: String) -> CommandResult<WritingChapter> {
    with_library(state, move |library| library.set_writing_chapter_role(&id, &role)).await
}

#[tauri::command]
pub async fn delete_writing_project(state: State<'_, AppLibrary>, id: String) -> CommandResult<()> {
    with_library(state, move |library| library.delete_writing_project(&id)).await
}

#[tauri::command]
pub async fn add_writing_chapter(state: State<'_, AppLibrary>, project_id: String, title: String, after: Option<String>) -> CommandResult<WritingChapter> {
    with_library(state, move |library| library.add_writing_chapter(&project_id, &title, after.as_deref())).await
}

#[tauri::command]
pub async fn save_writing_chapter(state: State<'_, AppLibrary>, id: String, title: String, body: String) -> CommandResult<WritingChapter> {
    with_library(state, move |library| library.save_writing_chapter(&id, &title, &body)).await
}

#[tauri::command]
pub async fn order_writing_chapters(state: State<'_, AppLibrary>, project_id: String, order: Vec<String>) -> CommandResult<Vec<WritingChapter>> {
    with_library(state, move |library| library.order_writing_chapters(&project_id, &order)).await
}

#[tauri::command]
pub async fn delete_writing_chapter(state: State<'_, AppLibrary>, id: String) -> CommandResult<()> {
    with_library(state, move |library| library.delete_writing_chapter(&id)).await
}

/// The cover picture's bytes, sent as raw binary for the EPUB.
#[tauri::command]
pub async fn writing_cover(state: State<'_, AppLibrary>, id: String) -> CommandResult<tauri::ipc::Response> {
    let cover = with_library(state, move |library| library.writing_cover_bytes(&id)).await?;
    Ok(tauri::ipc::Response::new(cover.map(|(bytes, _)| bytes).unwrap_or_default()))
}

/// A finished EPUB, sent as raw bytes: saved where the person chose (the
/// `path` header) and/or added to the library (`add` header "1", named by
/// the `file-name` header).
#[tauri::command]
pub async fn save_writing_epub(
    app: tauri::AppHandle,
    state: State<'_, AppLibrary>,
    imports: State<'_, Arc<imports::Imports>>,
    request: tauri::ipc::Request<'_>,
) -> CommandResult<()> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected the book's bytes".into());
    };
    let header = |name: &str| request.headers().get(name).and_then(|v| v.to_str().ok()).map(percent_decode);
    let path = header("path").filter(|p| !p.is_empty()).map(PathBuf::from);
    let add = header("add").as_deref() == Some("1");
    let name = header("file-name").filter(|n| !n.is_empty() && !n.contains(['/', '\\'])).unwrap_or_else(|| "Book.epub".into());
    let bytes = bytes.clone();
    let library = state.0.clone();
    let downloads = downloads_dir(&app.path().app_data_dir().map_err(|e| e.to_string())?);
    let imports = imports.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(path) = &path {
            std::fs::write(path, &bytes).map_err(|e| format!("The EPUB couldn't be saved there ({e})."))?;
        }
        if add {
            let folder = Arc::new(TempFolder::new(&downloads).map_err(|e| e.to_string())?);
            let file = folder.path().join(&name);
            std::fs::write(&file, &bytes).map_err(|e| e.to_string())?;
            imports.add_holding(&app, &library, vec![file], Some(folder));
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Keeps the book as it stands as its next draft. The page sends the EPUB it
/// made as raw bytes, with the book's id in the `project-id` header.
#[tauri::command]
pub async fn save_writing_draft(app: tauri::AppHandle, state: State<'_, AppLibrary>, request: tauri::ipc::Request<'_>) -> CommandResult<WritingDraft> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected the draft's bytes".into());
    };
    let id = request.headers().get("project-id").and_then(|v| v.to_str().ok()).ok_or("which book?")?.to_string();
    let downloads = downloads_dir(&app.path().app_data_dir().map_err(|e| e.to_string())?);
    let folder = TempFolder::new(&downloads).map_err(|e| e.to_string())?;
    let file = folder.path().join("Draft.epub");
    std::fs::write(&file, bytes).map_err(|e| e.to_string())?;
    let draft = with_library(state, move |library| library.save_writing_draft(&id, &file)).await;
    drop(folder);
    let _ = app.emit("library-changed", ());
    draft
}

#[tauri::command]
pub async fn writing_drafts(state: State<'_, AppLibrary>, project_id: String) -> CommandResult<Vec<WritingDraft>> {
    with_library(state, move |library| library.writing_drafts(&project_id)).await
}

#[tauri::command]
pub async fn delete_writing_draft(state: State<'_, AppLibrary>, id: String) -> CommandResult<()> {
    with_library(state, move |library| library.delete_writing_draft(&id)).await
}

#[tauri::command]
pub async fn set_writing_cover_page(state: State<'_, AppLibrary>, id: String, page: Option<String>) -> CommandResult<WritingProject> {
    with_library(state, move |library| library.set_writing_cover_page(&id, page.as_deref())).await
}

#[tauri::command]
pub async fn set_writing_chapter_part(state: State<'_, AppLibrary>, id: String, part: Option<String>) -> CommandResult<WritingChapter> {
    with_library(state, move |library| library.set_writing_chapter_part(&id, part.as_deref())).await
}

#[tauri::command]
pub async fn reading_history(state: State<'_, AppLibrary>) -> CommandResult<Vec<tbv_core::history::HistoryEntry>> {
    with_library(state, |library| library.reading_history()).await
}

#[tauri::command]
pub async fn forget_reading(state: State<'_, AppLibrary>, book_id: String) -> CommandResult<()> {
    with_library(state, move |library| library.forget_reading(&book_id)).await
}

/// Headers carry only ASCII, so the page percent-encodes names and paths.
fn percent_decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Some(b) = std::str::from_utf8(&bytes[i + 1..i + 3]).ok().and_then(|h| u8::from_str_radix(h, 16).ok()) {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    #[test]
    fn header_names_come_back_whole() {
        assert_eq!(super::percent_decode("C%3A%5CBooks%5CL%C3%A9a.epub"), "C:\\Books\\Léa.epub");
        assert_eq!(super::percent_decode("50%"), "50%");
    }
}

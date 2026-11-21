//! Find alike (tbv-core's alike.rs): groups of alike books, keeping books out
//! of a group, and a series' list online to suggest names and order.

use tauri::State;

use crate::{with_library, AppLibrary, CommandResult};

#[tauri::command]
pub async fn find_alike(
    state: State<'_, AppLibrary>,
    kind: tbv_core::model::ItemKind,
    options: Option<tbv_core::alike::AlikeOptions>,
) -> CommandResult<Vec<tbv_core::alike::AlikeGroup>> {
    with_library(state, move |library| library.find_alike(kind, &options.unwrap_or_default())).await
}

#[tauri::command]
pub async fn keep_out_of_alike(state: State<'_, AppLibrary>, book_ids: Vec<String>, keys: Vec<String>, out: bool) -> CommandResult<()> {
    with_library(state, move |library| library.keep_out_of_alike(&book_ids, &keys, out)).await
}

#[tauri::command]
pub async fn kept_out_of_alike(state: State<'_, AppLibrary>, book_id: String) -> CommandResult<bool> {
    with_library(state, move |library| library.kept_out_of_alike(&book_id)).await
}

#[tauri::command]
pub async fn kept_out_books(state: State<'_, AppLibrary>, kind: tbv_core::model::ItemKind) -> CommandResult<Vec<tbv_core::model::BookPreview>> {
    with_library(state, move |library| library.kept_out_books(kind)).await
}

#[tauri::command]
pub async fn include_in_alike(state: State<'_, AppLibrary>, book_id: String) -> CommandResult<()> {
    with_library(state, move |library| library.include_in_alike(&book_id)).await
}

/// The books of a series as listed online, without keeping the list: Find alike
/// only suggests from it.
#[tauri::command]
pub async fn series_list_online(state: State<'_, AppLibrary>, name: String, author: String) -> CommandResult<Vec<tbv_core::series::SeriesEntry>> {
    let library = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || crate::search_series_online(&library, &name, &author))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

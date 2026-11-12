//! Discover's media servers (Plex, Jellyfin, Emby, WebDAV): signing in,
//! browsing and playing. The work is in `tbv_core::media`; the library is
//! locked only to read or keep a server, never while the server is asked.
//! Pictures and videos reach TBV's page through its own proxy (video_proxy.rs).

use tauri::State;
use tbv_core::media::{self, MediaItem, MediaKind, MediaServer, MediaServerView, PlexPin};

use crate::{with_library, AppLibrary, CommandResult};

async fn server_and_device(state: State<'_, AppLibrary>, id: String) -> CommandResult<(MediaServer, String)> {
    with_library(state, move |library| Ok((library.media_server(&id)?, library.device_id()?))).await
}

async fn device(state: State<'_, AppLibrary>) -> CommandResult<String> {
    with_library(state, |library| library.device_id()).await
}

async fn off_thread<T: Send + 'static>(work: impl FnOnce() -> tbv_core::Result<T> + Send + 'static) -> CommandResult<T> {
    tauri::async_runtime::spawn_blocking(move || work().map_err(|e| e.to_string())).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn media_servers(state: State<'_, AppLibrary>) -> CommandResult<Vec<MediaServerView>> {
    with_library(state, |library| library.media_servers()).await
}

/// Jellyfin or Emby (username and password), or a WebDAV folder.
#[tauri::command]
pub async fn media_sign_in(state: State<'_, AppLibrary>, kind: MediaKind, url: String, username: String, password: String, name: Option<String>) -> CommandResult<Vec<MediaServerView>> {
    let device = device(state.clone()).await?;
    let server = off_thread(move || match kind {
        MediaKind::Jellyfin | MediaKind::Emby => media::sign_in_jellyfin(kind, &url, username.trim(), &password, &device),
        MediaKind::Webdav => media::connect_webdav(&url, &username, &password, name.as_deref().unwrap_or_default()),
        MediaKind::Plex => Err(tbv_core::Error::Unsuitable("Plex signs in through plex.tv.".into())),
    })
    .await?;
    with_library(state, move |library| library.save_media_servers(vec![server])).await
}

#[tauri::command]
pub async fn media_plex_start(state: State<'_, AppLibrary>) -> CommandResult<PlexPin> {
    let device = device(state).await?;
    off_thread(move || media::plex_start(&device)).await
}

/// None until the sign-in is approved on plex.tv.
#[tauri::command]
pub async fn media_plex_finish(state: State<'_, AppLibrary>, pin: String) -> CommandResult<Option<Vec<MediaServerView>>> {
    let device = device(state.clone()).await?;
    let Some(servers) = off_thread(move || media::plex_finish(&pin, &device)).await? else { return Ok(None) };
    with_library(state, move |library| library.save_media_servers(servers)).await.map(Some)
}

#[tauri::command]
pub async fn media_remove(state: State<'_, AppLibrary>, id: String) -> CommandResult<()> {
    with_library(state, move |library| library.remove_media_server(&id)).await
}

/// A server's libraries (no folder) or a folder's contents; pictures come through TBV.
#[tauri::command]
pub async fn media_list(state: State<'_, AppLibrary>, id: String, folder: Option<String>) -> CommandResult<Vec<MediaItem>> {
    let (server, device) = server_and_device(state, id).await?;
    let mut items = off_thread(move || media::list(&server, folder.as_deref().unwrap_or_default(), &device)).await?;
    for item in &mut items {
        item.image = item.image.take().map(|image| crate::video_proxy::address(&image, ""));
    }
    Ok(items)
}

/// What TBV's player plays for an item, shaped like video reader view's video.
#[tauri::command]
pub async fn media_play(state: State<'_, AppLibrary>, id: String, item: String, title: String, audio: bool) -> CommandResult<serde_json::Value> {
    let (server, device) = server_and_device(state, id).await?;
    let found = off_thread(move || media::play(&server, &item, &title, audio, &device)).await?;
    Ok(serde_json::json!({
        "src": crate::video_proxy::address(&found.url, ""),
        "kind": if found.hls { "hls" } else { "file" },
        "title": found.title,
        "page": "",
        "time": 0,
    }))
}

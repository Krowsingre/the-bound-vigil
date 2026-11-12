//! Discover's media servers: Plex, Jellyfin, Emby, and other servers that
//! share a folder over WebDAV. TBV signs in, lists their libraries and
//! folders, and gives the address each film, episode or song plays from.
//! Sign-ins are kept on this device only (device settings), never synced.

use std::time::Duration;

use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use url::Url;

use crate::{Error, Library, Result};

const SETTINGS_KEY: &str = "media.servers";
const PRODUCT: &str = "The Bound Vigil";
const VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MediaKind {
    Plex,
    Jellyfin,
    Emby,
    Webdav,
}

/// A media server signed in to, as kept on this device.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaServer {
    pub id: String,
    pub name: String,
    pub kind: MediaKind,
    /// Where the server is (for Plex, the connection that answered).
    pub url: String,
    #[serde(default)]
    pub username: String,
    /// The sign-in's token (Plex, Jellyfin, Emby).
    #[serde(default)]
    pub token: String,
    /// Jellyfin and Emby: the account's id.
    #[serde(default)]
    pub user_id: String,
    /// WebDAV: its password.
    #[serde(default)]
    pub password: String,
}

/// What TBV's page sees of a server: no token or password.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaServerView {
    pub id: String,
    pub name: String,
    pub kind: MediaKind,
    pub url: String,
    pub username: String,
}

impl From<&MediaServer> for MediaServerView {
    fn from(s: &MediaServer) -> Self {
        MediaServerView { id: s.id.clone(), name: s.name.clone(), kind: s.kind, url: s.url.clone(), username: s.username.clone() }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ItemKind {
    Folder,
    Video,
    Audio,
}

/// A library, folder, show, season, film, episode or song.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaItem {
    pub id: String,
    pub title: String,
    pub kind: ItemKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    /// The server's picture for it (an address TBV fetches through its own proxy).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image: Option<String>,
}

/// How an item plays: a stream (HLS) or a plain file.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaPlay {
    pub url: String,
    pub hls: bool,
    pub title: String,
}

impl Library {
    pub fn media_servers_saved(&self) -> Result<Vec<MediaServer>> {
        Ok(self.setting(SETTINGS_KEY)?.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default())
    }

    pub fn media_servers(&self) -> Result<Vec<MediaServerView>> {
        Ok(self.media_servers_saved()?.iter().map(MediaServerView::from).collect())
    }

    pub fn media_server(&self, id: &str) -> Result<MediaServer> {
        self.media_servers_saved()?.into_iter().find(|s| s.id == id).ok_or_else(|| Error::Unsuitable("That media server isn't connected any more.".into()))
    }

    /// Adds servers, or replaces ones at the same address for the same account.
    pub fn save_media_servers(&self, servers: Vec<MediaServer>) -> Result<Vec<MediaServerView>> {
        let mut all = self.media_servers_saved()?;
        let mut views = Vec::new();
        for mut server in servers {
            if let Some(old) = all.iter_mut().find(|s| s.kind == server.kind && s.url == server.url && s.username == server.username) {
                server.id = old.id.clone();
                *old = server.clone();
            } else {
                all.push(server.clone());
            }
            views.push(MediaServerView::from(&server));
        }
        self.set_setting(SETTINGS_KEY, &serde_json::to_string(&all)?)?;
        Ok(views)
    }

    pub fn remove_media_server(&self, id: &str) -> Result<()> {
        let all: Vec<MediaServer> = self.media_servers_saved()?.into_iter().filter(|s| s.id != id).collect();
        self.set_setting(SETTINGS_KEY, &serde_json::to_string(&all)?)
    }
}

fn agent(wait: u64) -> ureq::Agent {
    ureq::Agent::config_builder()
        .timeout_connect(Some(Duration::from_secs(wait.min(15))))
        .timeout_recv_response(Some(Duration::from_secs(wait)))
        .http_status_as_error(false)
        .user_agent(concat!("The Bound Vigil/", env!("CARGO_PKG_VERSION")))
        .build()
        .into()
}

fn unreachable(what: &str) -> impl Fn(ureq::Error) -> Error + '_ {
    move |e| Error::Offline(format!("{what} couldn't be reached ({e})"))
}

fn json(mut answer: ureq::http::Response<ureq::Body>, what: &str) -> Result<Value> {
    let status = answer.status().as_u16();
    match status {
        200..=299 => answer.body_mut().read_json::<Value>().map_err(|e| Error::Unsuitable(format!("{what} sent something TBV can't read ({e})."))),
        401 | 403 => Err(Error::Unsuitable(format!("{what} turned the sign-in down. Check the username and password."))),
        404 => Err(Error::Unsuitable(format!("{what} isn't at that address."))),
        _ => Err(Error::Unsuitable(format!("{what} said something went wrong ({status})."))),
    }
}

/// An address as typed: http(s), no slash at the end.
pub fn tidy_address(text: &str) -> Result<String> {
    let text = text.trim();
    let text = if text.contains("://") { text.to_string() } else { format!("http://{text}") };
    let url = Url::parse(&text).map_err(|_| Error::Unsuitable("That isn't a server address.".into()))?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err(Error::Unsuitable("That isn't a server address.".into()));
    }
    Ok(url.as_str().trim_end_matches('/').to_string())
}

fn enc(text: &str) -> String {
    url::form_urlencoded::byte_serialize(text.as_bytes()).collect()
}

fn text(v: &Value, key: &str) -> Option<String> {
    match v.get(key)? {
        Value::String(s) if !s.is_empty() => Some(s.clone()),
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

// ---- Jellyfin and Emby ----

fn emby_auth(device: &str, token: Option<&str>) -> String {
    let mut auth = format!(r#"MediaBrowser Client="{PRODUCT}", Device="{PRODUCT}", DeviceId="{device}", Version="{VERSION}""#);
    if let Some(token) = token {
        auth.push_str(&format!(r#", Token="{token}""#));
    }
    auth
}

/// Signs in to a Jellyfin or Emby server with its username and password.
pub fn sign_in_jellyfin(kind: MediaKind, url: &str, username: &str, password: &str, device: &str) -> Result<MediaServer> {
    let base = tidy_address(url)?;
    let what = if kind == MediaKind::Emby { "The Emby server" } else { "The Jellyfin server" };
    let auth = emby_auth(device, None);
    let answer = agent(30)
        .post(format!("{base}/Users/AuthenticateByName"))
        .header("Authorization", &auth)
        .header("X-Emby-Authorization", &auth)
        .send_json(serde_json::json!({ "Username": username, "Pw": password }))
        .map_err(unreachable(what))?;
    let found = json(answer, what)?;
    let token = text(&found, "AccessToken").ok_or_else(|| Error::Unsuitable(format!("{what} didn't sign in.")))?;
    let user_id = found.get("User").and_then(|u| text(u, "Id")).unwrap_or_default();
    let name = found.get("ServerName").and_then(|v| v.as_str()).map(str::to_owned);
    let name = match name {
        Some(n) => n,
        None => server_name(&base, &token, device).unwrap_or_else(|| if kind == MediaKind::Emby { "Emby".into() } else { "Jellyfin".into() }),
    };
    Ok(MediaServer { id: crate::ids::new_record_id(), name, kind, url: base, username: username.to_string(), token, user_id, password: String::new() })
}

fn server_name(base: &str, token: &str, device: &str) -> Option<String> {
    let answer = agent(10).get(format!("{base}/System/Info/Public")).header("Authorization", &emby_auth(device, Some(token))).call().ok()?;
    text(&json(answer, "").ok()?, "ServerName")
}

fn jellyfin_get(server: &MediaServer, path: &str, device: &str) -> Result<Value> {
    let what = if server.kind == MediaKind::Emby { "The Emby server" } else { "The Jellyfin server" };
    let answer = agent(30)
        .get(format!("{}{path}", server.url))
        .header("X-Emby-Token", &server.token)
        .header("Authorization", &emby_auth(device, Some(&server.token)))
        .call()
        .map_err(unreachable(what))?;
    json(answer, what)
}

fn jellyfin_items(server: &MediaServer, found: &Value) -> Vec<MediaItem> {
    let items = found.get("Items").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    items
        .iter()
        .filter_map(|item| {
            let id = text(item, "Id")?;
            let kind = match (item.get("IsFolder").and_then(|v| v.as_bool()).unwrap_or(false), item.get("MediaType").and_then(|v| v.as_str())) {
                (true, _) => ItemKind::Folder,
                (false, Some("Video")) => ItemKind::Video,
                (false, Some("Audio")) => ItemKind::Audio,
                _ => return None,
            };
            let mut title = text(item, "Name").unwrap_or_else(|| "Untitled".into());
            if item.get("Type").and_then(|v| v.as_str()) == Some("Episode") {
                if let Some(n) = text(item, "IndexNumber") {
                    title = format!("{n}. {title}");
                }
            }
            let detail = text(item, "ProductionYear").or_else(|| text(item, "SeriesName")).or_else(|| text(item, "AlbumArtist"));
            let image = item.get("ImageTags").and_then(|t| text(t, "Primary")).map(|tag| format!("{}/Items/{id}/Images/Primary?maxHeight=360&tag={tag}&api_key={}", server.url, server.token));
            Some(MediaItem { id, title, kind, detail, image })
        })
        .collect()
}

// ---- Plex ----

fn plex(request: ureq::RequestBuilder<ureq::typestate::WithoutBody>, device: &str) -> ureq::RequestBuilder<ureq::typestate::WithoutBody> {
    request
        .header("Accept", "application/json")
        .header("X-Plex-Product", PRODUCT)
        .header("X-Plex-Version", VERSION)
        .header("X-Plex-Client-Identifier", device)
}

/// Plex sign-in, step one: a code to approve on plex.tv, and the page to approve it on.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlexPin {
    pub id: String,
    pub url: String,
}

pub fn plex_start(device: &str) -> Result<PlexPin> {
    let answer = agent(20)
        .post("https://plex.tv/api/v2/pins?strong=true")
        .header("Accept", "application/json")
        .header("X-Plex-Product", PRODUCT)
        .header("X-Plex-Version", VERSION)
        .header("X-Plex-Client-Identifier", device)
        .send_empty()
        .map_err(unreachable("Plex"))?;
    let found = json(answer, "Plex")?;
    let id = text(&found, "id").ok_or_else(|| Error::Unsuitable("Plex didn't start the sign-in.".into()))?;
    let code = text(&found, "code").ok_or_else(|| Error::Unsuitable("Plex didn't start the sign-in.".into()))?;
    let url = format!("https://app.plex.tv/auth#?clientID={}&code={}&context%5Bdevice%5D%5Bproduct%5D={}", enc(device), enc(&code), enc(PRODUCT));
    Ok(PlexPin { id, url })
}

/// Plex sign-in, step two: once approved, the servers the account can use
/// (each at the first of its addresses that answers). None while waiting.
pub fn plex_finish(pin: &str, device: &str) -> Result<Option<Vec<MediaServer>>> {
    if !pin.chars().all(|c| c.is_ascii_digit()) {
        return Err(Error::Unsuitable("That isn't a Plex sign-in.".into()));
    }
    let answer = plex(agent(20).get(format!("https://plex.tv/api/v2/pins/{pin}")), device).call().map_err(unreachable("Plex"))?;
    let found = json(answer, "Plex")?;
    let Some(account) = text(&found, "authToken") else { return Ok(None) };
    let answer = plex(agent(30).get("https://plex.tv/api/v2/resources?includeHttps=1&includeRelay=1"), device)
        .header("X-Plex-Token", &account)
        .call()
        .map_err(unreachable("Plex"))?;
    let resources = json(answer, "Plex")?;
    let username = {
        let answer = plex(agent(20).get("https://plex.tv/api/v2/user"), device).header("X-Plex-Token", &account).call().ok();
        answer.and_then(|a| json(a, "Plex").ok()).and_then(|u| text(&u, "username").or_else(|| text(&u, "email"))).unwrap_or_default()
    };
    let mut servers = Vec::new();
    for resource in resources.as_array().into_iter().flatten() {
        if !resource.get("provides").and_then(|v| v.as_str()).unwrap_or_default().split(',').any(|p| p == "server") {
            continue;
        }
        let token = text(resource, "accessToken").unwrap_or_else(|| account.clone());
        let mut connections: Vec<&Value> = resource.get("connections").and_then(|v| v.as_array()).into_iter().flatten().collect();
        // Nearby first, then from outside, then Plex's relay (slow).
        connections.sort_by_key(|c| (c.get("relay").and_then(|v| v.as_bool()).unwrap_or(false), !c.get("local").and_then(|v| v.as_bool()).unwrap_or(false)));
        let reached = connections.iter().filter_map(|c| text(c, "uri")).find(|uri| {
            plex(agent(4).get(format!("{uri}/identity")), device).header("X-Plex-Token", &token).call().is_ok_and(|a| a.status().is_success())
        });
        if let Some(url) = reached {
            servers.push(MediaServer {
                id: crate::ids::new_record_id(),
                name: text(resource, "name").unwrap_or_else(|| "Plex".into()),
                kind: MediaKind::Plex,
                url: url.trim_end_matches('/').to_string(),
                username: username.clone(),
                token,
                user_id: String::new(),
                password: String::new(),
            });
        }
    }
    if servers.is_empty() {
        return Err(Error::Unsuitable("Signed in to Plex, but none of the account's servers answered. Check the server is on.".into()));
    }
    Ok(Some(servers))
}

fn plex_get(server: &MediaServer, path: &str, device: &str) -> Result<Value> {
    let answer = plex(agent(30).get(format!("{}{path}", server.url)), device).header("X-Plex-Token", &server.token).call().map_err(unreachable("The Plex server"))?;
    json(answer, "The Plex server")
}

fn plex_items(server: &MediaServer, found: &Value) -> Vec<MediaItem> {
    let container = found.get("MediaContainer").cloned().unwrap_or_default();
    let mut out = Vec::new();
    for dir in container.get("Directory").and_then(|v| v.as_array()).into_iter().flatten() {
        let Some(key) = text(dir, "key") else { continue };
        let id = if key.chars().all(|c| c.is_ascii_digit()) { format!("s:{key}") } else { continue };
        out.push(MediaItem { id, title: text(dir, "title").unwrap_or_default(), kind: ItemKind::Folder, detail: None, image: None });
    }
    for item in container.get("Metadata").and_then(|v| v.as_array()).into_iter().flatten() {
        let Some(key) = text(item, "ratingKey") else { continue };
        let kind = match item.get("type").and_then(|v| v.as_str()).unwrap_or_default() {
            "movie" | "episode" | "clip" => ItemKind::Video,
            "track" => ItemKind::Audio,
            "show" | "season" | "artist" | "album" | "collection" | "playlist" => ItemKind::Folder,
            _ => continue,
        };
        let mut title = text(item, "title").unwrap_or_else(|| "Untitled".into());
        if item.get("type").and_then(|v| v.as_str()) == Some("episode") {
            if let Some(n) = text(item, "index") {
                title = format!("{n}. {title}");
            }
        }
        let detail = text(item, "year").or_else(|| text(item, "grandparentTitle")).or_else(|| text(item, "parentTitle"));
        let image = text(item, "thumb").map(|thumb| format!("{}/photo/:/transcode?width=240&height=360&minSize=1&upscale=1&url={}&X-Plex-Token={}", server.url, enc(&thumb), server.token));
        out.push(MediaItem { id: format!("m:{key}"), title, kind, detail, image });
    }
    out
}

// ---- WebDAV ----

const PLAYABLE: &[(&str, ItemKind)] = &[
    ("mp4", ItemKind::Video),
    ("m4v", ItemKind::Video),
    ("webm", ItemKind::Video),
    ("mov", ItemKind::Video),
    ("mkv", ItemKind::Video),
    ("m3u8", ItemKind::Video),
    ("mp3", ItemKind::Audio),
    ("m4a", ItemKind::Audio),
    ("m4b", ItemKind::Audio),
    ("aac", ItemKind::Audio),
    ("flac", ItemKind::Audio),
    ("ogg", ItemKind::Audio),
    ("opus", ItemKind::Audio),
    ("wav", ItemKind::Audio),
];

/// Checks a WebDAV address and login, and keeps them.
pub fn connect_webdav(url: &str, username: &str, password: &str, name: &str) -> Result<MediaServer> {
    let base = tidy_address(url)?;
    let server = MediaServer {
        id: crate::ids::new_record_id(),
        name: Some(name.trim()).filter(|n| !n.is_empty()).map(str::to_owned).unwrap_or_else(|| Url::parse(&base).ok().and_then(|u| u.host_str().map(str::to_owned)).unwrap_or_else(|| "Server".into())),
        kind: MediaKind::Webdav,
        url: base,
        username: username.trim().to_string(),
        token: String::new(),
        user_id: String::new(),
        password: password.to_string(),
    };
    webdav_list(&server, "")?;
    Ok(server)
}

fn basic(server: &MediaServer) -> Option<String> {
    (!server.username.is_empty()).then(|| format!("Basic {}", base64::engine::general_purpose::STANDARD.encode(format!("{}:{}", server.username, server.password))))
}

fn webdav_list(server: &MediaServer, folder: &str) -> Result<Vec<MediaItem>> {
    let root = Url::parse(&format!("{}/", server.url)).map_err(|_| Error::Unsuitable("That isn't a server address.".into()))?;
    let at = if folder.is_empty() { root.clone() } else { root.join(folder).map_err(|_| Error::Unsuitable("That folder isn't on the server.".into()))? };
    if !at.as_str().starts_with(root.as_str()) {
        return Err(Error::Unsuitable("That folder isn't on the server.".into()));
    }
    let body = r#"<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:displayname/></d:prop></d:propfind>"#;
    let method = ureq::http::Method::from_bytes(b"PROPFIND").map_err(|e| Error::Unsuitable(e.to_string()))?;
    let mut request = ureq::http::Request::builder().method(method).uri(at.as_str()).header("Depth", "1").header("Content-Type", "application/xml");
    if let Some(auth) = basic(server) {
        request = request.header("Authorization", auth);
    }
    let request = request.body(body.to_string()).map_err(|e| Error::Unsuitable(e.to_string()))?;
    let mut answer = agent(30).run(request).map_err(unreachable("The server"))?;
    match answer.status().as_u16() {
        207 | 200 => {}
        401 | 403 => return Err(Error::Unsuitable("The server turned the sign-in down. Check the username and password.".into())),
        404 => return Err(Error::Unsuitable("There's no folder at that address.".into())),
        405 => return Err(Error::Unsuitable("That address doesn't share files over WebDAV.".into())),
        s => return Err(Error::Unsuitable(format!("The server said something went wrong ({s})."))),
    }
    let xml = answer.body_mut().with_config().limit(16 * 1024 * 1024).read_to_string().map_err(|e| Error::Unsuitable(e.to_string()))?;
    Ok(parse_propfind(&xml, &root, &at))
}

/// The entries of a WebDAV folder listing: folders, and files TBV can play.
fn parse_propfind(xml: &str, root: &Url, at: &Url) -> Vec<MediaItem> {
    use quick_xml::events::Event;
    let mut reader = quick_xml::Reader::from_str(xml);
    let mut out = Vec::new();
    let (mut href, mut folder, mut field) = (String::new(), false, String::new());
    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) => {
                let name = String::from_utf8_lossy(e.local_name().as_ref()).to_string();
                match name.as_str() {
                    "response" => (href, folder) = (String::new(), false),
                    "collection" => folder = true,
                    _ => {}
                }
                field = name;
            }
            Ok(Event::Empty(e)) => {
                if e.local_name().as_ref() == b"collection" {
                    folder = true;
                }
            }
            Ok(Event::Text(t)) if field == "href" => href.push_str(&t.unescape().unwrap_or_default()),
            Ok(Event::End(e)) => {
                if e.local_name().as_ref() == b"response" && !href.is_empty() {
                    if let Ok(full) = at.join(href.trim()) {
                        let same = full.path().trim_end_matches('/') == at.path().trim_end_matches('/');
                        if !same && full.as_str().starts_with(root.as_str()) {
                            let id = full.as_str()[root.as_str().len()..].to_string();
                            let last = full.path_segments().and_then(|mut s| s.rfind(|p| !p.is_empty())).unwrap_or_default();
                            let title = percent_decode(last);
                            let kind = if folder {
                                Some(ItemKind::Folder)
                            } else {
                                let ext = title.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase()).unwrap_or_default();
                                PLAYABLE.iter().find(|(e, _)| *e == ext).map(|(_, k)| *k)
                            };
                            if let Some(kind) = kind {
                                out.push(MediaItem { id, title, kind, detail: None, image: None });
                            }
                        }
                    }
                }
                field.clear();
            }
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
    }
    out.sort_by(|a, b| (a.kind != ItemKind::Folder).cmp(&(b.kind != ItemKind::Folder)).then_with(|| a.title.to_lowercase().cmp(&b.title.to_lowercase())));
    out
}

fn percent_decode(text: &str) -> String {
    url::form_urlencoded::parse(format!("x={}", text.replace('+', "%2B")).as_bytes()).next().map(|(_, v)| v.into_owned()).unwrap_or_else(|| text.to_string())
}

// ---- Browsing and playing, whichever the server ----

/// A server's libraries (folder empty) or what's in one of its folders.
pub fn list(server: &MediaServer, folder: &str, device: &str) -> Result<Vec<MediaItem>> {
    match server.kind {
        MediaKind::Jellyfin | MediaKind::Emby => {
            let found = if folder.is_empty() {
                jellyfin_get(server, &format!("/Users/{}/Views", server.user_id), device)?
            } else {
                jellyfin_get(server, &format!("/Users/{}/Items?ParentId={}&SortBy=SortName&SortOrder=Ascending&Fields=ProductionYear&Limit=1000", server.user_id, enc(folder)), device)?
            };
            Ok(jellyfin_items(server, &found))
        }
        MediaKind::Plex => {
            let path = match folder.split_once(':') {
                None => "/library/sections".to_string(),
                Some(("s", key)) if key.chars().all(|c| c.is_ascii_digit()) => format!("/library/sections/{key}/all"),
                Some(("m", key)) if key.chars().all(|c| c.is_ascii_digit()) => format!("/library/metadata/{key}/children"),
                _ => return Err(Error::Unsuitable("That isn't on the Plex server.".into())),
            };
            Ok(plex_items(server, &plex_get(server, &path, device)?))
        }
        MediaKind::Webdav => webdav_list(server, folder),
    }
}

/// Where an item plays from.
pub fn play(server: &MediaServer, item: &str, title: &str, audio: bool, device: &str) -> Result<MediaPlay> {
    let session = uuid::Uuid::new_v4().simple().to_string();
    let title = title.to_string();
    match server.kind {
        MediaKind::Jellyfin | MediaKind::Emby => {
            if !item.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
                return Err(Error::Unsuitable("That isn't on the server.".into()));
            }
            let url = if audio {
                format!("{}/Audio/{item}/stream?static=true&api_key={}&DeviceId={}", server.url, server.token, enc(device))
            } else {
                format!(
                    "{}/Videos/{item}/master.m3u8?api_key={}&MediaSourceId={item}&DeviceId={}&PlaySessionId={session}&VideoCodec=h264&AudioCodec=aac,mp3&TranscodingMaxAudioChannels=2&VideoBitrate=20000000&AudioBitrate=192000&SegmentContainer=ts&BreakOnNonKeyFrames=true",
                    server.url,
                    server.token,
                    enc(device)
                )
            };
            Ok(MediaPlay { url, hls: !audio, title })
        }
        MediaKind::Plex => {
            let key = item.strip_prefix("m:").filter(|k| k.chars().all(|c| c.is_ascii_digit())).ok_or_else(|| Error::Unsuitable("That isn't on the Plex server.".into()))?;
            if audio {
                let found = plex_get(server, &format!("/library/metadata/{key}"), device)?;
                let part = found
                    .pointer("/MediaContainer/Metadata/0/Media/0/Part/0/key")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| Error::Unsuitable("The Plex server didn't say where that song is.".into()))?;
                return Ok(MediaPlay { url: format!("{}{part}?X-Plex-Token={}", server.url, server.token), hls: false, title });
            }
            let url = format!(
                "{}/video/:/transcode/universal/start.m3u8?path={}&mediaIndex=0&partIndex=0&protocol=hls&fastSeek=1&directPlay=0&directStream=1&directStreamAudio=1&videoQuality=100&maxVideoBitrate=20000&subtitles=burn&location=lan&session={session}&X-Plex-Session-Identifier={session}&X-Plex-Client-Identifier={}&X-Plex-Product={}&X-Plex-Platform=Chrome&X-Plex-Token={}",
                server.url,
                enc(&format!("/library/metadata/{key}")),
                enc(device),
                enc(PRODUCT),
                server.token
            );
            Ok(MediaPlay { url, hls: true, title })
        }
        MediaKind::Webdav => {
            let root = Url::parse(&format!("{}/", server.url)).map_err(|_| Error::Unsuitable("That isn't a server address.".into()))?;
            let mut url = root.join(item).map_err(|_| Error::Unsuitable("That file isn't on the server.".into()))?;
            if !url.as_str().starts_with(root.as_str()) {
                return Err(Error::Unsuitable("That file isn't on the server.".into()));
            }
            // The login goes with the address; TBV's player passes it on as the server asks.
            if !server.username.is_empty() {
                let _ = url.set_username(&server.username);
                let _ = url.set_password(Some(&server.password));
            }
            let hls = url.path().to_ascii_lowercase().ends_with(".m3u8");
            Ok(MediaPlay { url: url.to_string(), hls, title })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn webdav_listings_keep_folders_and_playable_files() {
        let root = Url::parse("https://dav.example/media/").unwrap();
        let at = root.join("Films/").unwrap();
        let xml = r#"<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">
          <d:response><d:href>/media/Films/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>
          <d:response><d:href>/media/Films/Old%20Ones/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>
          <d:response><d:href>/media/Films/Nosferatu%20(1922).mp4</d:href><d:propstat><d:prop><d:resourcetype/></d:prop></d:propstat></d:response>
          <d:response><d:href>/media/Films/notes.txt</d:href><d:propstat><d:prop><d:resourcetype/></d:prop></d:propstat></d:response>
          <d:response><d:href>/elsewhere/x.mp4</d:href><d:propstat><d:prop><d:resourcetype/></d:prop></d:propstat></d:response>
        </d:multistatus>"#;
        let items = parse_propfind(xml, &root, &at);
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].title, "Old Ones");
        assert_eq!(items[0].kind, ItemKind::Folder);
        assert_eq!(items[0].id, "Films/Old%20Ones/");
        assert_eq!(items[1].title, "Nosferatu (1922).mp4");
        assert_eq!(items[1].kind, ItemKind::Video);
    }

    #[test]
    fn webdav_files_play_with_their_login_and_stay_on_the_server() {
        let server = MediaServer { id: "a".into(), name: "n".into(), kind: MediaKind::Webdav, url: "https://dav.example/media".into(), username: "me".into(), token: String::new(), user_id: String::new(), password: "p w".into() };
        let got = play(&server, "Films/a%20b.mp4", "a b", false, "d").unwrap();
        assert_eq!(got.url, "https://me:p%20w@dav.example/media/Films/a%20b.mp4");
        assert!(play(&server, "../../etc/passwd", "x", false, "d").is_err());
        assert!(play(&server, "https://other.example/x.mp4", "x", false, "d").is_err());
    }

    #[test]
    fn plex_lists_read_libraries_and_items() {
        let server = MediaServer { id: "a".into(), name: "n".into(), kind: MediaKind::Plex, url: "https://1-2-3-4.abc.plex.direct:32400".into(), username: String::new(), token: "T".into(), user_id: String::new(), password: String::new() };
        let found = serde_json::json!({ "MediaContainer": {
            "Directory": [{ "key": "1", "title": "Films" }],
            "Metadata": [
                { "ratingKey": "10", "type": "movie", "title": "Metropolis", "year": 1927, "thumb": "/library/metadata/10/thumb/1" },
                { "ratingKey": "11", "type": "episode", "title": "Pilot", "index": 1 },
                { "ratingKey": "12", "type": "photo", "title": "skip" }
            ] } });
        let items = plex_items(&server, &found);
        assert_eq!(items.len(), 3);
        assert_eq!(items[0].id, "s:1");
        assert_eq!(items[1].detail.as_deref(), Some("1927"));
        assert!(items[1].image.as_deref().unwrap().contains("X-Plex-Token=T"));
        assert_eq!(items[2].title, "1. Pilot");
    }

    #[test]
    fn servers_are_saved_on_this_device_without_secrets_shown() {
        let (_dir, library) = crate::library::tests::open_temp_library();
        let server = MediaServer { id: "a".into(), name: "Home".into(), kind: MediaKind::Jellyfin, url: "http://nas:8096".into(), username: "me".into(), token: "secret".into(), user_id: "u".into(), password: String::new() };
        library.save_media_servers(vec![server.clone()]).unwrap();
        // Signing in again replaces it.
        library.save_media_servers(vec![MediaServer { id: "b".into(), token: "new".into(), ..server }]).unwrap();
        let views = library.media_servers().unwrap();
        assert_eq!(views.len(), 1);
        assert_eq!(views[0].id, "a");
        assert!(!serde_json::to_string(&views).unwrap().contains("new"));
        assert_eq!(library.media_server("a").unwrap().token, "new");
        library.remove_media_server("a").unwrap();
        assert!(library.media_servers().unwrap().is_empty());
    }
}

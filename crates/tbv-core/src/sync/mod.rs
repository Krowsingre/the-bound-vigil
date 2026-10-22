//! Sync: how changes travel between devices.
//!
//! Every change to something that travels (a book's details, reading
//! progress, collections, notes) is stamped in `sync_clock` by triggers this
//! module installs, so nothing else in the core has to remember to record
//! changes. A sync run pulls what other devices changed since last time,
//! merges it record by record (the newest change wins unless the user chose
//! another rule), then pushes this device's changes. The cloud only ever
//! holds whole records with the time they changed, so any service that can
//! store them can carry a library.

pub mod contents;
pub mod files;
pub mod moving;
pub mod places;
pub mod supabase;
pub mod tidy;
pub mod webdav;

use std::thread;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::Mutex;

use chrono::{DateTime, Duration, SecondsFormat, Utc};
use rusqlite::types::Value as SqlValue;
use rusqlite::{params, params_from_iter, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::error::{Error, Result};
use crate::ids::book_id_hex;
use crate::library::Library;
use crate::model::{ImportResult, IsoUtc, SyncState, SyncStatus};
use crate::time::now_utc;

/// The groups of things the user can choose to sync (Settings › Sync options).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Category {
    /// Which books are in the library. Always synced, since everything else hangs off it.
    Library,
    Progress,
    Collections,
    Metadata,
    Notes,
}

/// One kind of record: some columns of one table.
pub(crate) struct Kind {
    pub name: &'static str,
    table: &'static str,
    keys: &'static [&'static str],
    cols: &'static [&'static str],
    category: Category,
    /// Whole rows another device can create. The rest only change rows that
    /// already exist here.
    creates: bool,
}

/// In the order they're pushed and merged, so what a record belongs to
/// usually arrives first.
///
/// Changing a kind's columns changes what is sent; old devices ignore
/// columns they don't know and kinds they've never heard of.
pub(crate) const KINDS: &[Kind] = &[
    Kind {
        name: "book",
        table: "books",
        keys: &["id"],
        cols: &[
            "title", "authors", "format", "file_size", "synopsis", "publisher", "language", "series", "series_index",
            "added_at", "deleted_at", "isbn",
        ],
        category: Category::Library,
        creates: true,
    },
    Kind {
        name: "audiobook",
        table: "audiobooks",
        keys: &["book_id"],
        cols: &["narrators", "duration_ms", "chapters", "parts", "ebook_id", "updated_at"],
        category: Category::Library,
        creates: true,
    },
    Kind {
        name: "book_progress",
        table: "books",
        keys: &["id"],
        cols: &["status", "total_progression", "resume_locator", "last_opened_at", "finished_at"],
        category: Category::Progress,
        creates: false,
    },
    Kind {
        name: "book_phone",
        table: "books",
        keys: &["id"],
        cols: &["phone_wanted", "phone_has", "from_phone"],
        category: Category::Library,
        creates: false,
    },
    Kind {
        name: "book_shelves",
        table: "books",
        keys: &["id"],
        cols: &["favorite", "want_to_read", "rating"],
        category: Category::Collections,
        creates: false,
    },
    Kind {
        name: "override",
        table: "metadata_overrides",
        keys: &["book_id", "field"],
        cols: &["value", "updated_at"],
        category: Category::Metadata,
        creates: true,
    },
    Kind {
        name: "fetched",
        table: "metadata_fetched",
        keys: &["book_id", "field"],
        cols: &["value", "source", "updated_at"],
        category: Category::Metadata,
        creates: true,
    },
    Kind {
        name: "read_along",
        table: "read_along",
        keys: &["ebook_id", "audiobook_id"],
        cols: &["timing", "updated_at"],
        category: Category::Progress,
        creates: true,
    },
    Kind {
        name: "series",
        table: "series_lists",
        keys: &["id"],
        cols: &["name", "books", "hidden", "denied", "checked_at", "updated_at", "read"],
        category: Category::Metadata,
        creates: true,
    },
    Kind {
        name: "collection",
        table: "collections",
        keys: &["id"],
        cols: &[
            "name", "created_at", "deleted_at", "description", "kind", "badge", "picture", "pinned", "position", "updated_at", "rules",
        ],
        category: Category::Collections,
        creates: true,
    },
    Kind {
        name: "collection_book",
        table: "collection_books",
        keys: &["collection_id", "book_id"],
        cols: &["added_at", "position", "removed_at", "updated_at"],
        category: Category::Collections,
        creates: true,
    },
    Kind {
        name: "book_tag",
        table: "book_tags",
        keys: &["book_id", "tag"],
        cols: &["added_at", "removed_at", "updated_at"],
        category: Category::Collections,
        creates: true,
    },
    Kind {
        name: "annotation",
        table: "annotations",
        keys: &["id"],
        cols: &["book_id", "kind", "excerpt", "note", "locator", "color", "created_at", "updated_at", "deleted_at"],
        category: Category::Notes,
        creates: true,
    },
    Kind {
        name: "profile",
        table: "profile",
        keys: &["id"],
        cols: &["avatar", "updated_at"],
        category: Category::Library,
        creates: true,
    },
    Kind {
        name: "personal_note",
        table: "personal_notes",
        keys: &["id"],
        cols: &["title", "body", "created_at", "updated_at", "deleted_at"],
        category: Category::Notes,
        creates: true,
    },
    Kind {
        name: "writing_project",
        table: "writing_projects",
        keys: &["id"],
        cols: &["title", "author", "series", "series_index", "language", "description", "cover", "export", "created_at", "updated_at", "deleted_at"],
        category: Category::Notes,
        creates: true,
    },
    Kind {
        name: "writing_chapter",
        table: "writing_chapters",
        keys: &["id"],
        cols: &["project_id", "title", "body", "position", "created_at", "updated_at", "deleted_at"],
        category: Category::Notes,
        creates: true,
    },
];

fn kind_named(name: &str) -> Option<&'static Kind> {
    KINDS.iter().find(|k| k.name == name)
}

/// (Re)creates the triggers that stamp `sync_clock`. Run every time the
/// library opens, so they always match `KINDS`.
pub(crate) fn install_triggers(conn: &Connection) -> Result<()> {
    let mut sql = String::new();
    for kind in KINDS {
        let n = kind.name;
        let t = kind.table;
        for when in ["ins", "upd", "del"] {
            sql += &format!("DROP TRIGGER IF EXISTS sync_{n}_{when};\n");
        }
        let stamp = |row: &str| {
            let key = kind.keys.iter().map(|c| format!("{row}.{c}")).collect::<Vec<_>>().join(", ");
            // An upsert, not INSERT OR REPLACE: a statement's own OR clause
            // (INSERT OR IGNORE, say) would override the trigger's.
            format!(
                "INSERT INTO sync_clock (kind, key, changed_at, pushed)
                 VALUES ('{n}', json_array({key}), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0)
                 ON CONFLICT(kind, key) DO UPDATE SET changed_at = excluded.changed_at, pushed = 0;"
            )
        };
        if kind.creates {
            sql += &format!("CREATE TRIGGER sync_{n}_ins AFTER INSERT ON {t} WHEN tbv_sync_live() BEGIN {} END;\n", stamp("NEW"));
            sql += &format!("CREATE TRIGGER sync_{n}_del AFTER DELETE ON {t} WHEN tbv_sync_live() BEGIN {} END;\n", stamp("OLD"));
        }
        let changed = kind.cols.iter().map(|c| format!("NEW.{c} IS NOT OLD.{c}")).collect::<Vec<_>>().join(" OR ");
        sql += &format!(
            "CREATE TRIGGER sync_{n}_upd AFTER UPDATE OF {} ON {t} WHEN tbv_sync_live() AND ({changed}) BEGIN {} END;\n",
            kind.cols.join(", "),
            stamp("NEW")
        );
    }
    conn.execute_batch(&sql)?;
    Ok(())
}

/// One record as it travels: the row's columns, or `None` once it's gone.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Record {
    pub kind: String,
    /// The row's key columns as a JSON array, e.g. `["sha256:…"]`.
    pub key: String,
    pub data: Option<Map<String, Value>>,
    pub changed_at: IsoUtc,
}

/// What to do when this device and another both changed the same thing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConflictRule {
    #[default]
    Recent,
    Ask,
    Local,
    Cloud,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize)]
pub enum Frequency {
    #[default]
    #[serde(rename = "automatic")]
    Automatic,
    #[serde(rename = "15min")]
    Every15Minutes,
    #[serde(rename = "hourly")]
    Hourly,
    #[serde(rename = "manual")]
    Manual,
}

/// The user's choices from Settings › Sync, read from `app.settings`.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct SyncOptions {
    pub progress: bool,
    pub notes: bool,
    pub collections: bool,
    pub metadata: bool,
    pub book_files: bool,
    /// Audiobook files are large, so they have a switch of their own.
    pub audio_files: bool,
    pub frequency: Frequency,
    pub on_startup: bool,
    pub on_close: bool,
    pub conflicts: ConflictRule,
    /// What the second place (see `Lane::Also`) is sent: book files…
    pub also_book_files: bool,
    /// …and audiobook files, which may not fit there.
    pub also_audio_files: bool,
    /// Supabase (the phone's place) gets only the books chosen for the
    /// phone, rather than every book on this computer.
    pub phone_chosen_only: bool,
}

impl Default for SyncOptions {
    fn default() -> Self {
        Self {
            progress: true,
            notes: true,
            collections: true,
            metadata: true,
            book_files: false,
            audio_files: false,
            frequency: Frequency::Automatic,
            on_startup: true,
            on_close: true,
            conflicts: ConflictRule::Recent,
            also_book_files: true,
            also_audio_files: false,
            phone_chosen_only: false,
        }
    }
}

impl SyncOptions {
    fn includes(&self, category: Category) -> bool {
        match category {
            Category::Library => true,
            Category::Progress => self.progress,
            Category::Collections => self.collections,
            Category::Metadata => self.metadata,
            Category::Notes => self.notes,
        }
    }

    /// Which kinds are synced, as one string. When it changes, everything is
    /// pulled again so newly included kinds catch up.
    fn scope(&self) -> String {
        KINDS.iter().filter(|k| self.includes(k.category)).map(|k| k.name).collect::<Vec<_>>().join(",")
    }

    /// The choices as they apply to one place: the second has its own file switches.
    fn for_lane(&self, lane: Lane) -> SyncOptions {
        match lane {
            Lane::Main => self.clone(),
            Lane::Also => SyncOptions { book_files: self.also_book_files, audio_files: self.also_audio_files, ..self.clone() },
        }
    }
}

/// The places a library syncs with. Most people have one; someone who keeps
/// every file in iCloud and reads on a phone through Supabase has both. Each
/// keeps its own idea of what it has been sent, so a change from either one
/// is passed on to the other.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Lane {
    /// The provider in `sync.provider`.
    Main,
    /// The second place in `sync.also`, if there is one.
    Also,
}

impl Lane {
    fn name(self) -> &'static str {
        match self {
            Lane::Main => "main",
            Lane::Also => "also",
        }
    }

    fn from_name(name: &str) -> Lane {
        if name == "also" {
            Lane::Also
        } else {
            Lane::Main
        }
    }

    fn cursor_key(self) -> &'static str {
        match self {
            Lane::Main => CURSOR,
            Lane::Also => ALSO_CURSOR,
        }
    }

    fn erase_key(self) -> &'static str {
        match self {
            Lane::Main => ERASE,
            Lane::Also => ALSO_ERASE,
        }
    }

    /// Which files this place has been sent.
    fn files_table(self) -> &'static str {
        match self {
            Lane::Main => "sync_files",
            Lane::Also => "sync_files_also",
        }
    }

    fn last_success_key(self) -> &'static str {
        match self {
            Lane::Main => LAST_SUCCESS,
            Lane::Also => ALSO_LAST_SUCCESS,
        }
    }

    fn last_error_key(self) -> &'static str {
        match self {
            Lane::Main => LAST_ERROR,
            Lane::Also => ALSO_LAST_ERROR,
        }
    }
}

/// The Supabase project the user set up (Settings › Sync › Supabase).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SupabaseProject {
    pub url: String,
    pub anon_key: String,
}

/// Which service carries the library. Kept in this device's settings only,
/// since a WebDAV one holds a password.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Provider {
    /// The Supabase project in `sync.supabase`, signed in as `sync.session`.
    Supabase,
    /// A folder a cloud app keeps in sync. `service` is which one the person
    /// picked ("icloud", "dropbox", "mega", "custom"…), for Settings to show.
    Folder { service: String, path: String },
    #[serde(rename = "webdav")]
    WebDav(webdav::WebDavAccount),
    /// Not syncing anywhere, after "Stop syncing here".
    Off,
}

/// The provider as Settings shows it: never the password.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderView {
    pub kind: &'static str,
    pub service: Option<String>,
    /// The folder, or the server's address.
    pub location: Option<String>,
    pub username: Option<String>,
}

impl Provider {
    pub fn view(&self) -> ProviderView {
        match self {
            Provider::Supabase => ProviderView { kind: "supabase", service: None, location: None, username: None },
            Provider::Folder { service, path } => {
                ProviderView { kind: "folder", service: Some(service.clone()), location: Some(path.clone()), username: None }
            }
            Provider::WebDav(account) => ProviderView {
                kind: "webdav",
                service: None,
                location: Some(account.url.clone()),
                username: Some(account.username.clone()),
            },
            Provider::Off => ProviderView { kind: "off", service: None, location: None, username: None },
        }
    }

    /// Whether two choices point at the same cloud library.
    pub fn same_place(&self, other: &Provider) -> bool {
        match (self, other) {
            (Provider::Supabase, Provider::Supabase) | (Provider::Off, Provider::Off) => true,
            (Provider::Folder { path: a, .. }, Provider::Folder { path: b, .. }) => a == b,
            (Provider::WebDav(a), Provider::WebDav(b)) => a.url == b.url && a.username == b.username,
            _ => false,
        }
    }
}

/// A connection to wherever the library is kept.
pub enum Cloud {
    Supabase(Box<supabase::Supabase>),
    Files(files::FileRemote<Box<dyn files::Store + Send>>),
}

impl Cloud {
    fn remote(&mut self) -> &mut dyn Remote {
        match self {
            Cloud::Supabase(s) => s.as_mut(),
            Cloud::Files(f) => f,
        }
    }

    /// Part of a file in the cloud, and its size, for streaming. See [`Remote::read_range`].
    pub fn read_range(&mut self, path: &str, start: u64, end: u64) -> Result<Option<(Vec<u8>, u64)>> {
        self.remote().read_range(path, start, end)
    }
}

impl Remote for Cloud {
    fn push(&mut self, records: &[Record]) -> Result<()> {
        self.remote().push(records)
    }
    fn pull(&mut self, after: &str, limit: usize) -> Result<Page> {
        self.remote().pull(after, limit)
    }
    fn upload(&mut self, path: &str, file: &Path) -> Result<()> {
        self.remote().upload(path, file)
    }
    fn download(&mut self, path: &str, to: &Path) -> Result<bool> {
        self.remote().download(path, to)
    }
    fn list(&mut self, folder: &str) -> Result<Vec<String>> {
        self.remote().list(folder)
    }
    fn list_sizes(&mut self, folder: &str) -> Result<Vec<(String, Option<u64>)>> {
        self.remote().list_sizes(folder)
    }
    fn remove(&mut self, path: &str) -> Result<()> {
        self.remote().remove(path)
    }
    fn covers_follow_files(&self) -> bool {
        matches!(self, Cloud::Supabase(_))
    }
}

/// Opens a folder or WebDAV library and makes sure it's one TBV can use.
/// Returns the connection and whether a library was already there.
pub fn open_files(provider: &Provider, device: String) -> Result<(files::FileRemote<Box<dyn files::Store + Send>>, bool)> {
    let store: Box<dyn files::Store + Send> = match provider {
        Provider::Folder { path, .. } => Box::new(files::FolderStore::open(Path::new(path))?),
        Provider::WebDav(account) => Box::new(webdav::WebDav::open(account)?),
        Provider::Supabase | Provider::Off => return Err(Error::Unsuitable("that isn't a folder".into())),
    };
    let mut remote = files::FileRemote::new(store, device);
    let existing = remote.prepare()?;
    Ok((remote, existing))
}

/// Who is signed in on this device. Kept in this device's settings only.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub user_id: String,
    pub email: String,
    pub access_token: String,
    pub refresh_token: String,
    /// When the access token runs out (seconds since 1970).
    pub expires_at: i64,
}

/// How sync stands, for Settings › Sync and the header circle.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncOverview {
    pub status: SyncStatus,
    pub provider: ProviderView,
    pub project: Option<SupabaseProject>,
    pub signed_in_as: Option<String>,
    pub last_error: Option<String>,
    /// Changes on this device the cloud doesn't have yet.
    pub waiting_to_send: u32,
    pub conflicts: Vec<SyncConflict>,
    /// The second place the library syncs with, if there is one.
    pub also: Option<AlsoOverview>,
}

/// How the second place stands.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AlsoOverview {
    pub provider: ProviderView,
    pub last_success_at: Option<IsoUtc>,
    pub last_error: Option<String>,
    pub waiting_to_send: u32,
}

/// Both devices changed the same thing; the user picks which to keep.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncConflict {
    pub kind: String,
    pub key: String,
    /// What it is, in words: "Reading progress in Dracula".
    pub what: String,
    pub here: String,
    pub cloud: String,
    pub cloud_changed_at: IsoUtc,
}

/// What one sync run did.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncReport {
    pub received: u32,
    pub sent: u32,
    pub files_sent: u32,
    pub files_received: u32,
    pub new_conflicts: u32,
    /// Files that couldn't be sent, with why (too big, say).
    pub skipped_files: Vec<String>,
}

/// Records from the cloud, and where the next pull carries on from.
#[derive(Debug, Default)]
pub struct Page {
    pub records: Vec<Record>,
    /// Opaque to the engine: a number for Supabase, each device's place for
    /// a folder. Empty means from the beginning.
    pub cursor: String,
}

impl Page {
    /// For services that number every record in one order.
    pub fn numbered(rows: Vec<(i64, Record)>, after: &str) -> Page {
        let cursor = rows.last().map(|(seq, _)| seq.to_string()).unwrap_or_else(|| after.to_string());
        Page { records: rows.into_iter().map(|(_, r)| r).collect(), cursor }
    }
}

/// A numbered cursor, as `Page::numbered` writes it.
pub fn seq_after(after: &str) -> i64 {
    after.parse().unwrap_or(0)
}

/// Where records and files are kept in the cloud. `Send`, so the two sync
/// places can each work on their own thread.
pub trait Remote: Send {
    /// Stores records. Ones older than what the cloud already has are ignored.
    fn push(&mut self, records: &[Record]) -> Result<()>;
    /// Records changed since the cursor `after`, oldest first.
    fn pull(&mut self, after: &str, limit: usize) -> Result<Page>;
    /// Puts a file at `path` (like `books/<hash>.epub`), replacing any there.
    fn upload(&mut self, path: &str, file: &Path) -> Result<()>;
    /// Fetches the file at `path`. False if the cloud doesn't have it.
    fn download(&mut self, path: &str, to: &Path) -> Result<bool>;
    /// Files in a folder, like `covers/`.
    fn list(&mut self, folder: &str) -> Result<Vec<String>>;
    /// As `list`, with each file's size where the service says it.
    fn list_sizes(&mut self, folder: &str) -> Result<Vec<(String, Option<u64>)>> {
        Ok(self.list(folder)?.into_iter().map(|name| (name, None)).collect())
    }
    /// Erases the file at `path`. Fine if it isn't there.
    fn remove(&mut self, path: &str) -> Result<()>;
    /// Bytes `start..=end` of the file at `path` (fewer at its end), and the
    /// whole file's size, for playing it without downloading it. None if
    /// the cloud doesn't have it.
    fn read_range(&mut self, _path: &str, _start: u64, _end: u64) -> Result<Option<(Vec<u8>, u64)>> {
        Err(Error::Unsuitable("This place can't play a file without downloading it.".into()))
    }
    /// True where room is short (Supabase's free plan): a book's cover is
    /// only sent along with its file, for a phone that can download it.
    /// Elsewhere every cover is sent.
    fn covers_follow_files(&self) -> bool {
        false
    }
}

const PAGE: usize = 500;

/// Reads a ranged answer: the bytes asked for and the file's whole size.
/// A server that ignores the range sends the whole file, so only the part
/// asked for is read from it.
pub(crate) fn ranged_answer(answer: &mut ureq::http::Response<ureq::Body>, start: u64, end: u64) -> Result<(Vec<u8>, u64)> {
    let header = |name: &str| answer.headers().get(name).and_then(|v| v.to_str().ok()).map(str::to_string);
    let total = header("content-range").and_then(|r| r.rsplit('/').next().and_then(|t| t.trim().parse::<u64>().ok()));
    let length = header("content-length").and_then(|l| l.parse::<u64>().ok());
    let status = answer.status().as_u16();
    if status == 416 {
        return Ok((Vec::new(), total.unwrap_or(start)));
    }
    let want = end.saturating_sub(start) + 1;
    let mut reader = answer.body_mut().with_config().limit(u64::MAX).reader();
    let mut bytes = Vec::new();
    if status == 206 {
        std::io::Read::read_to_end(&mut std::io::Read::take(&mut reader, want), &mut bytes).map_err(|e| Error::Offline(e.to_string()))?;
        let total = total.ok_or_else(|| Error::Cloud("the answer didn't say how big the file is".into()))?;
        return Ok((bytes, total));
    }
    std::io::copy(&mut std::io::Read::take(&mut reader, start), &mut std::io::sink()).map_err(|e| Error::Offline(e.to_string()))?;
    std::io::Read::read_to_end(&mut std::io::Read::take(&mut reader, want), &mut bytes).map_err(|e| Error::Offline(e.to_string()))?;
    Ok((bytes, length.unwrap_or(start + want)))
}

/// Set when the app is closing: files still waiting are left for next time,
/// so the last sync only exchanges records and the app can quit promptly.
static WINDING_DOWN: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Stops file transfers between files, for the rest of this run of the app.
pub fn wind_down() {
    WINDING_DOWN.store(true, Ordering::SeqCst);
}

fn winding_down() -> bool {
    WINDING_DOWN.load(Ordering::SeqCst)
}
/// Cloud files of deleted books, waiting to be erased at the next sync.
const ERASE: &str = "sync.erase";
const BATCH: usize = 200;
/// A file that wouldn't upload is tried again after this long.
const RETRY_FILE_HOURS: i64 = 24;

const DEVICE_ID: &str = "sync.device_id";
const CURSOR: &str = "sync.cursor";
const LAST_SUCCESS: &str = "sync.last_success_at";
const LAST_ERROR: &str = "sync.last_error";
/// The second place, as a `Provider`. Kept on this device only, like the first.
pub(crate) const ALSO: &str = "sync.also";
const ALSO_CURSOR: &str = "sync.also.cursor";
const ALSO_ERASE: &str = "sync.also.erase";
const ALSO_LAST_SUCCESS: &str = "sync.also.last_success_at";
const ALSO_LAST_ERROR: &str = "sync.also.last_error";
const SESSION: &str = "sync.session";
const PROJECT: &str = "sync.supabase";
/// Books whose cover another device replaced, so this one's copy is old.
const COVERS_STALE: &str = "sync.coversStale";
/// The detail that says a book's cover changed, so other devices fetch it again.
const COVER_REV: &str = "cover_rev";
pub(crate) const PROVIDER: &str = "sync.provider";
pub(crate) const APP_SETTINGS: &str = "app.settings";

#[derive(Debug, Default, Serialize, Deserialize)]
struct Cursor {
    scope: String,
    /// Where pulls carry on from (see `Page::cursor`).
    #[serde(default)]
    at: Option<String>,
    /// Saved by earlier versions, which only knew Supabase's numbers.
    #[serde(default)]
    seq: i64,
}

/// Puts the sync triggers to sleep while another device's changes are written.
struct Quiet<'a>(&'a Library);

impl<'a> Quiet<'a> {
    fn new(library: &'a Library) -> Self {
        library.sync_live.store(false, Ordering::Relaxed);
        Self(library)
    }
}

impl Drop for Quiet<'_> {
    fn drop(&mut self) {
        self.0.sync_live.store(true, Ordering::Relaxed);
    }
}

fn to_json(value: SqlValue) -> Value {
    match value {
        SqlValue::Null | SqlValue::Blob(_) => Value::Null,
        SqlValue::Integer(i) => Value::from(i),
        SqlValue::Real(f) => Value::from(f),
        SqlValue::Text(s) => Value::String(s),
    }
}

fn to_sql(value: &Value) -> SqlValue {
    match value {
        Value::Null => SqlValue::Null,
        Value::Bool(b) => SqlValue::Integer(*b as i64),
        Value::Number(n) => match n.as_i64() {
            Some(i) => SqlValue::Integer(i),
            None => SqlValue::Real(n.as_f64().unwrap_or(0.0)),
        },
        Value::String(s) => SqlValue::Text(s.clone()),
        other => SqlValue::Text(other.to_string()),
    }
}

/// A moment just after `at`, or now if that's later: for a change that must
/// win over one made at `at`.
fn after(at: &str) -> IsoUtc {
    let now = now_utc();
    let bumped = DateTime::parse_from_rfc3339(at)
        .map(|t| (t.with_timezone(&Utc) + Duration::milliseconds(1)).to_rfc3339_opts(SecondsFormat::Millis, true))
        .unwrap_or_else(|_| now.clone());
    now.max(bumped)
}

fn is_missing_parent(error: &rusqlite::Error) -> bool {
    matches!(error, rusqlite::Error::SqliteFailure(e, _) if e.extended_code == rusqlite::ffi::SQLITE_CONSTRAINT_FOREIGNKEY)
}

impl Library {
    fn put_setting(&self, key: &str, value: Option<&str>) -> Result<()> {
        match value {
            Some(value) => self.set_setting(key, value),
            None => {
                self.conn.execute("DELETE FROM device_settings WHERE key = ?1", params![key])?;
                Ok(())
            }
        }
    }

    /// The user's sync choices. Defaults when nothing is saved.
    pub fn sync_options(&self) -> Result<SyncOptions> {
        #[derive(Deserialize, Default)]
        #[serde(default)]
        struct App {
            sync: SyncOptions,
        }
        let saved = self.setting(APP_SETTINGS)?;
        Ok(saved.and_then(|s| serde_json::from_str::<App>(&s).ok()).unwrap_or_default().sync)
    }

    pub fn supabase_project(&self) -> Result<Option<SupabaseProject>> {
        let saved = self.setting(PROJECT)?;
        Ok(saved
            .and_then(|s| serde_json::from_str::<Option<SupabaseProject>>(&s).ok().flatten())
            .filter(|p| !p.url.is_empty() && !p.anon_key.is_empty()))
    }

    /// The chosen service. Before there was a choice, it was Supabase.
    pub fn sync_provider(&self) -> Result<Provider> {
        Ok(self.setting(PROVIDER)?.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or(Provider::Supabase))
    }

    /// Saves the chosen service. Moving to a different cloud library starts
    /// sync over with it: everything here is sent there, and all of it read.
    pub fn set_sync_provider(&mut self, provider: &Provider) -> Result<()> {
        if !self.sync_provider()?.same_place(provider) {
            self.reset_sync()?;
        }
        self.put_setting(PROVIDER, Some(&serde_json::to_string(provider)?))?;
        self.drop_also_if_same(provider)
    }

    /// The main sync moved to where the second one was: one place is enough.
    pub(crate) fn drop_also_if_same(&mut self, main: &Provider) -> Result<()> {
        if self.sync_also()?.is_some_and(|also| also.same_place(main)) {
            self.set_sync_also(None)?;
        }
        Ok(())
    }

    /// The second place the library syncs with, if there is one.
    pub fn sync_also(&self) -> Result<Option<Provider>> {
        Ok(self.setting(ALSO)?.and_then(|s| serde_json::from_str(&s).ok()).filter(|p| *p != Provider::Off))
    }

    /// Saves (or, with `None`, stops) the second place. A new place is sent
    /// everything and all of it read, as the first one was.
    pub fn set_sync_also(&mut self, provider: Option<&Provider>) -> Result<()> {
        let provider = provider.filter(|p| **p != Provider::Off);
        if let Some(provider) = provider {
            if self.sync_provider()?.same_place(provider) {
                return Err(Error::Unsuitable("Your library already syncs there. Choose a different place for the second sync.".into()));
            }
        }
        let before = self.sync_also()?;
        let same = match (&before, provider) {
            (Some(a), Some(b)) => a.same_place(b),
            (None, None) => true,
            _ => false,
        };
        if !same {
            self.reset_also_sync()?;
        }
        let json = provider.map(serde_json::to_string).transpose()?;
        self.put_setting(ALSO, json.as_deref())
    }

    /// A connection to the chosen service, if it's ready to use.
    pub fn connect(&self) -> Result<Option<Cloud>> {
        self.connect_to(&self.sync_provider()?)
    }

    /// A connection to the second place, if there is one and it's ready.
    pub fn connect_also(&self) -> Result<Option<Cloud>> {
        match self.sync_also()? {
            Some(provider) => self.connect_to(&provider),
            None => Ok(None),
        }
    }

    pub fn connect_to(&self, provider: &Provider) -> Result<Option<Cloud>> {
        match provider {
            Provider::Supabase => {
                let (Some(project), Some(session)) = (self.supabase_project()?, self.sync_session()?) else { return Ok(None) };
                Ok(Some(Cloud::Supabase(Box::new(supabase::Supabase::new(project, session, self.device_id()?)))))
            }
            Provider::Off => Ok(None),
            _ => Ok(Some(Cloud::Files(open_files(provider, self.device_id()?)?.0))),
        }
    }

    pub fn sync_session(&self) -> Result<Option<Session>> {
        Ok(self.setting(SESSION)?.and_then(|s| serde_json::from_str(&s).ok()))
    }

    pub fn set_sync_session(&self, session: Option<&Session>) -> Result<()> {
        let json = session.map(serde_json::to_string).transpose()?;
        self.put_setting(SESSION, json.as_deref())
    }

    /// This device's name in the cloud, made the first time it's needed.
    pub fn device_id(&self) -> Result<String> {
        if let Some(id) = self.setting(DEVICE_ID)? {
            return Ok(id);
        }
        let id = uuid::Uuid::now_v7().to_string();
        self.put_setting(DEVICE_ID, Some(&id))?;
        Ok(id)
    }

    /// Counts each time sync starts over. A run opened at one count stops
    /// writing once it changes.
    pub fn sync_epoch(&self) -> u64 {
        self.sync_epoch
    }

    /// Sync's state as far as the saved data knows. While a run is going,
    /// the app reports Syncing itself.
    pub fn sync_status(&self) -> Result<SyncStatus> {
        let ready = match self.sync_provider()? {
            Provider::Supabase => self.supabase_project()?.is_some() && self.sync_session()?.is_some(),
            Provider::Off => false,
            _ => true,
        };
        let last_error = self.setting(LAST_ERROR)?;
        let conflicts: i64 = self.conn.query_row("SELECT COUNT(*) FROM sync_conflicts", [], |r| r.get(0))?;
        let state = if conflicts > 0 {
            SyncState::Attention
        } else if !ready {
            SyncState::Disabled
        } else if let Some(error) = &last_error {
            if error.starts_with(OFFLINE_PREFIX) {
                SyncState::Offline
            } else {
                SyncState::Error
            }
        } else {
            SyncState::Idle
        };
        Ok(SyncStatus {
            state,
            last_success_at: self.setting(LAST_SUCCESS)?,
        })
    }

    pub fn sync_overview(&self) -> Result<SyncOverview> {
        // Only what would actually be sent: kinds switched off keep their
        // stamps for later, but aren't waiting now.
        let options = self.sync_options()?;
        let also = match self.sync_also()? {
            Some(provider) => Some(AlsoOverview {
                provider: provider.view(),
                last_success_at: self.setting(ALSO_LAST_SUCCESS)?,
                last_error: self.setting(ALSO_LAST_ERROR)?.map(|e| e.trim_start_matches(OFFLINE_PREFIX).to_string()),
                waiting_to_send: self.waiting_count(&options, Lane::Also)?,
            }),
            None => None,
        };
        Ok(SyncOverview {
            status: self.sync_status()?,
            provider: self.sync_provider()?.view(),
            project: self.supabase_project()?,
            signed_in_as: self.sync_session()?.map(|s| s.email),
            last_error: self.setting(LAST_ERROR)?.map(|e| e.trim_start_matches(OFFLINE_PREFIX).to_string()),
            waiting_to_send: self.waiting_count(&options, Lane::Main)?,
            conflicts: self.sync_conflicts()?,
            also,
        })
    }

    /// Changes one place doesn't have yet. Only what would actually be sent:
    /// kinds switched off keep their stamps for later, but aren't waiting now.
    fn waiting_count(&self, options: &SyncOptions, lane: Lane) -> Result<u32> {
        let mut waiting: i64 = 0;
        for kind in KINDS.iter().filter(|k| options.includes(k.category)) {
            waiting += self.conn.query_row(
                &format!(
                    "SELECT COUNT(*) FROM sync_clock c WHERE c.kind = ?1 AND {}
                       AND NOT EXISTS (SELECT 1 FROM sync_conflicts x WHERE x.kind = c.kind AND x.key = c.key)",
                    unsent(lane)
                ),
                params![kind.name],
                |r| r.get::<_, i64>(0),
            )?;
        }
        Ok(waiting.max(0) as u32)
    }

    fn record_result(&self, outcome: &Result<SyncReport>, lane: Lane) -> Result<()> {
        match outcome {
            Ok(_) => {
                self.put_setting(lane.last_success_key(), Some(&now_utc()))?;
                self.put_setting(lane.last_error_key(), None)
            }
            Err(error) => self.note_lane_failure(error, lane),
        }
    }

    /// Remembers why sync couldn't run, for Settings and the header circle.
    pub fn note_sync_failure(&self, error: &Error) -> Result<()> {
        self.note_lane_failure(error, Lane::Main)
    }

    /// As `note_sync_failure`, for either place.
    pub fn note_lane_failure(&self, error: &Error, lane: Lane) -> Result<()> {
        match error {
            Error::Offline(why) => self.put_setting(lane.last_error_key(), Some(&format!("{OFFLINE_PREFIX}{why}"))),
            error => self.put_setting(lane.last_error_key(), Some(&error.to_string())),
        }
    }

    /// Forgets everything sync knew about the cloud, after signing out or
    /// switching project. This device's changes are all sent again next time.
    pub fn reset_sync(&mut self) -> Result<()> {
        self.sync_epoch += 1;
        self.conn.execute_batch(
            "UPDATE sync_clock SET pushed = 0;
             DELETE FROM sync_waiting WHERE lane = 'main'; DELETE FROM sync_conflicts WHERE lane = 'main'; DELETE FROM sync_files;",
        )?;
        for key in [CURSOR, LAST_SUCCESS, LAST_ERROR] {
            self.put_setting(key, None)?;
        }
        Ok(())
    }

    /// As `reset_sync`, for the second place only.
    pub fn reset_also_sync(&mut self) -> Result<()> {
        self.sync_epoch += 1;
        self.conn.execute_batch(
            "DELETE FROM sync_clock_also; DELETE FROM sync_files_also;
             DELETE FROM sync_waiting WHERE lane = 'also'; DELETE FROM sync_conflicts WHERE lane = 'also';",
        )?;
        for key in [ALSO_CURSOR, ALSO_ERASE, ALSO_LAST_SUCCESS, ALSO_LAST_ERROR] {
            self.put_setting(key, None)?;
        }
        Ok(())
    }

    fn cursor(&self, options: &SyncOptions, lane: Lane) -> Result<String> {
        let saved: Cursor = self.setting(lane.cursor_key())?.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
        if saved.scope != options.scope() {
            return Ok(String::new());
        }
        Ok(saved.at.unwrap_or_else(|| if saved.seq > 0 { saved.seq.to_string() } else { String::new() }))
    }

    fn save_cursor(&self, options: &SyncOptions, at: &str, lane: Lane) -> Result<()> {
        let json = serde_json::to_string(&Cursor { scope: options.scope(), at: Some(at.to_string()), seq: 0 })?;
        self.put_setting(lane.cursor_key(), Some(&json))
    }

    /// The row a record stands for, as it is here now. `None` if it's gone.
    fn snapshot(&self, kind: &Kind, key: &str) -> Result<Option<Map<String, Value>>> {
        let keys: Vec<Value> = serde_json::from_str(key)?;
        if keys.len() != kind.keys.len() {
            return Ok(None);
        }
        let columns: Vec<&str> = kind.keys.iter().chain(kind.cols).copied().collect();
        let filter = kind.keys.iter().enumerate().map(|(i, k)| format!("{k} = ?{}", i + 1)).collect::<Vec<_>>().join(" AND ");
        let sql = format!("SELECT {} FROM {} WHERE {filter}", columns.join(", "), kind.table);
        let values = self
            .conn
            .query_row(&sql, params_from_iter(keys.iter().map(to_sql)), |r| {
                (0..columns.len()).map(|i| r.get::<_, SqlValue>(i)).collect::<rusqlite::Result<Vec<_>>>()
            })
            .optional()?;
        Ok(values.map(|values| columns.iter().map(|c| c.to_string()).zip(values.into_iter().map(to_json)).collect()))
    }

    /// Changes the cloud doesn't have yet, oldest first, in `KINDS` order.
    pub fn sync_outbox(&self, options: &SyncOptions, limit: usize) -> Result<Vec<Record>> {
        self.lane_outbox(options, limit, Lane::Main)
    }

    /// As `sync_outbox`, for either place.
    pub fn lane_outbox(&self, options: &SyncOptions, limit: usize, lane: Lane) -> Result<Vec<Record>> {
        let mut out = Vec::new();
        for kind in KINDS.iter().filter(|k| options.includes(k.category)) {
            let mut statement = self.conn.prepare(&format!(
                "SELECT c.key, c.changed_at FROM sync_clock c
                 WHERE c.kind = ?1 AND {}
                   AND NOT EXISTS (SELECT 1 FROM sync_conflicts x WHERE x.kind = c.kind AND x.key = c.key)
                 ORDER BY c.changed_at LIMIT ?2",
                unsent(lane)
            ))?;
            let waiting = statement
                .query_map(params![kind.name, (limit - out.len()) as i64], |r| Ok((r.get::<_, String>(0)?, r.get(1)?)))?
                .collect::<rusqlite::Result<Vec<(String, String)>>>()?;
            for (key, changed_at) in waiting {
                let data = self.snapshot(kind, &key)?;
                out.push(Record { kind: kind.name.into(), key, data, changed_at });
            }
            if out.len() >= limit {
                break;
            }
        }
        Ok(out)
    }

    /// The cloud has these now. Ones changed again meanwhile stay waiting.
    pub fn sync_mark_sent(&self, records: &[Record]) -> Result<()> {
        self.lane_mark_sent(records, Lane::Main)
    }

    /// As `sync_mark_sent`, for either place.
    pub fn lane_mark_sent(&self, records: &[Record], lane: Lane) -> Result<()> {
        let tx = self.conn.unchecked_transaction()?;
        for r in records {
            let params = params![r.kind, r.key, r.changed_at];
            match lane {
                Lane::Main => tx.execute("UPDATE sync_clock SET pushed = 1 WHERE kind = ?1 AND key = ?2 AND changed_at = ?3", params)?,
                Lane::Also => tx.execute(
                    "INSERT OR REPLACE INTO sync_clock_also (kind, key, changed_at)
                     SELECT kind, key, changed_at FROM sync_clock WHERE kind = ?1 AND key = ?2 AND changed_at = ?3",
                    params,
                )?,
            };
        }
        tx.commit()?;
        Ok(())
    }

    /// The second place has this change, so it isn't sent there again.
    fn also_has(&self, record: &Record, changed_at: &str) -> Result<()> {
        self.conn.execute(
            "INSERT OR REPLACE INTO sync_clock_also (kind, key, changed_at) VALUES (?1, ?2, ?3)",
            params![record.kind, record.key, changed_at],
        )?;
        Ok(())
    }

    /// Merges records from other devices. Returns how many changed something
    /// here and how many need the user to choose.
    pub fn sync_apply(&self, records: &[Record], options: &SyncOptions) -> Result<(u32, u32)> {
        self.lane_apply(records, options, Lane::Main)
    }

    /// As `sync_apply`, for records from either place.
    pub fn lane_apply(&self, records: &[Record], options: &SyncOptions, lane: Lane) -> Result<(u32, u32)> {
        let _quiet = Quiet::new(self);
        let tx = self.conn.unchecked_transaction()?;
        let mut applied = 0;
        let mut conflicts = 0;
        for record in records {
            match self.merge(record, options, lane)? {
                Merge::Applied => applied += 1,
                Merge::Conflict => conflicts += 1,
                Merge::Kept => {}
            }
        }
        applied += self.retry_waiting(options)?;
        tx.commit()?;
        Ok((applied, conflicts))
    }

    fn merge(&self, record: &Record, options: &SyncOptions, lane: Lane) -> Result<Merge> {
        let Some(kind) = kind_named(&record.kind) else {
            return Ok(Merge::Kept); // From a newer TBV.
        };
        if !options.includes(kind.category) {
            return Ok(Merge::Kept);
        }
        // Whether this change here was already sent to the place the record came from.
        let local: Option<(String, bool)> = self
            .conn
            .query_row(
                match lane {
                    Lane::Main => "SELECT changed_at, pushed FROM sync_clock WHERE kind = ?1 AND key = ?2",
                    Lane::Also => {
                        "SELECT c.changed_at, a.changed_at IS c.changed_at FROM sync_clock c
                         LEFT JOIN sync_clock_also a ON a.kind = c.kind AND a.key = c.key WHERE c.kind = ?1 AND c.key = ?2"
                    }
                },
                params![record.kind, record.key],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        let take = match local {
            None => true,
            Some((at, _)) if at == record.changed_at => {
                // Already the same change.
                if lane == Lane::Also {
                    self.also_has(record, &at)?;
                }
                false
            }
            Some((at, true)) => record.changed_at > at,
            Some((at, false)) => {
                // Changed here and elsewhere since the last sync.
                if self.snapshot(kind, &record.key)? == record.data {
                    self.stamp(record, at.max(record.changed_at.clone()), false)?;
                    return Ok(Merge::Kept);
                }
                match options.conflicts {
                    ConflictRule::Recent => record.changed_at > at,
                    ConflictRule::Cloud => true,
                    ConflictRule::Local => {
                        self.stamp(record, after(&record.changed_at).max(at), false)?;
                        false
                    }
                    ConflictRule::Ask => {
                        self.conn.execute(
                            "INSERT OR REPLACE INTO sync_conflicts (kind, key, remote, found_at, lane) VALUES (?1, ?2, ?3, ?4, ?5)",
                            params![record.kind, record.key, serde_json::to_string(record)?, now_utc(), lane.name()],
                        )?;
                        return Ok(Merge::Conflict);
                    }
                }
            }
        };
        if !take {
            return Ok(Merge::Kept);
        }
        if self.write(kind, record)? {
            if kind.name == "fetched" && record.data.is_some() {
                let keys: Vec<Value> = serde_json::from_str(&record.key).unwrap_or_default();
                if let [Value::String(book), Value::String(field)] = keys.as_slice() {
                    if field == COVER_REV {
                        self.cover_stale(book, true)?;
                    }
                }
            }
            // Sent on to the other place: from the first, the second hasn't
            // got it; from the second, the first hasn't.
            self.stamp(record, record.changed_at.clone(), lane == Lane::Main)?;
            if lane == Lane::Also {
                self.also_has(record, &record.changed_at)?;
            }
            self.conn.execute("DELETE FROM sync_conflicts WHERE kind = ?1 AND key = ?2", params![record.kind, record.key])?;
            self.conn.execute("DELETE FROM sync_waiting WHERE kind = ?1 AND key = ?2", params![record.kind, record.key])?;
            Ok(Merge::Applied)
        } else {
            self.conn.execute(
                "INSERT OR REPLACE INTO sync_waiting (kind, key, record, lane) VALUES (?1, ?2, ?3, ?4)",
                params![record.kind, record.key, serde_json::to_string(record)?, lane.name()],
            )?;
            Ok(Merge::Kept)
        }
    }

    fn stamp(&self, record: &Record, changed_at: IsoUtc, pushed: bool) -> Result<()> {
        self.conn.execute(
            "INSERT OR REPLACE INTO sync_clock (kind, key, changed_at, pushed) VALUES (?1, ?2, ?3, ?4)",
            params![record.kind, record.key, changed_at, pushed],
        )?;
        Ok(())
    }

    /// Writes a record's row. False if what it belongs to isn't here yet.
    fn write(&self, kind: &Kind, record: &Record) -> Result<bool> {
        let keys: Vec<Value> = serde_json::from_str(&record.key)?;
        if keys.len() != kind.keys.len() {
            return Ok(true); // Malformed; nothing sensible to do but drop it.
        }
        let filter = kind.keys.iter().enumerate().map(|(i, k)| format!("{k} = ?{}", i + 1)).collect::<Vec<_>>().join(" AND ");
        let Some(data) = &record.data else {
            let sql = format!("DELETE FROM {} WHERE {filter}", kind.table);
            self.conn.execute(&sql, params_from_iter(keys.iter().map(to_sql)))?;
            return Ok(true);
        };
        // Only columns this TBV knows, so a newer device's extras are ignored.
        let present: Vec<&str> = kind.cols.iter().copied().filter(|c| data.contains_key(*c)).collect();
        let mut values: Vec<SqlValue> = keys.iter().map(to_sql).collect();
        values.extend(present.iter().map(|c| to_sql(&data[*c])));
        let outcome = if kind.creates {
            let columns: Vec<&str> = kind.keys.iter().chain(&present).copied().collect();
            let slots = (1..=columns.len()).map(|i| format!("?{i}")).collect::<Vec<_>>().join(", ");
            let updates = present.iter().map(|c| format!("{c} = excluded.{c}")).collect::<Vec<_>>();
            let on_conflict = if updates.is_empty() {
                "DO NOTHING".to_string()
            } else {
                format!("DO UPDATE SET {}", updates.join(", "))
            };
            let sql = format!(
                "INSERT INTO {} ({}) VALUES ({slots}) ON CONFLICT({}) {on_conflict}",
                kind.table,
                columns.join(", "),
                kind.keys.join(", ")
            );
            self.conn.execute(&sql, params_from_iter(values)).map(|_| true)
        } else {
            if present.is_empty() {
                return Ok(true);
            }
            let sets = present.iter().enumerate().map(|(i, c)| format!("{c} = ?{}", kind.keys.len() + i + 1)).collect::<Vec<_>>();
            let sql = format!("UPDATE {} SET {} WHERE {filter}", kind.table, sets.join(", "));
            self.conn.execute(&sql, params_from_iter(values)).map(|n| n > 0)
        };
        match outcome {
            Ok(done) => Ok(done),
            Err(e) if is_missing_parent(&e) => Ok(false),
            Err(e) => Err(e.into()),
        }
    }

    /// Tries the records that were waiting for something to arrive.
    fn retry_waiting(&self, options: &SyncOptions) -> Result<u32> {
        let mut applied = 0;
        loop {
            let waiting = self
                .conn
                .prepare("SELECT record, lane FROM sync_waiting")?
                .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            let mut progress = false;
            for (json, lane) in waiting {
                let Ok(record) = serde_json::from_str::<Record>(&json) else { continue };
                self.conn.execute("DELETE FROM sync_waiting WHERE kind = ?1 AND key = ?2", params![record.kind, record.key])?;
                if let Merge::Applied = self.merge(&record, options, Lane::from_name(&lane))? {
                    applied += 1;
                    progress = true;
                }
            }
            if !progress {
                return Ok(applied);
            }
        }
    }

    pub fn sync_conflicts(&self) -> Result<Vec<SyncConflict>> {
        let rows = self
            .conn
            .prepare("SELECT remote FROM sync_conflicts ORDER BY found_at")?
            .query_map([], |r| r.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let mut out = Vec::new();
        for json in rows {
            let Ok(remote) = serde_json::from_str::<Record>(&json) else { continue };
            let Some(kind) = kind_named(&remote.kind) else { continue };
            let here = self.snapshot(kind, &remote.key)?;
            out.push(SyncConflict {
                what: self.describe(kind, &remote, here.as_ref())?,
                here: summarize(kind, here.as_ref()),
                cloud: summarize(kind, remote.data.as_ref()),
                cloud_changed_at: remote.changed_at.clone(),
                kind: remote.kind,
                key: remote.key,
            });
        }
        Ok(out)
    }

    /// Settles a conflict the user was asked about.
    pub fn resolve_sync_conflict(&self, kind: &str, key: &str, keep_cloud: bool) -> Result<()> {
        let remote: Option<(String, String)> = self
            .conn
            .query_row("SELECT remote, lane FROM sync_conflicts WHERE kind = ?1 AND key = ?2", params![kind, key], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .optional()?;
        let Some((remote, lane)) = remote.and_then(|(r, lane)| Some((serde_json::from_str::<Record>(&r).ok()?, lane))) else {
            return Ok(());
        };
        self.conn.execute("DELETE FROM sync_conflicts WHERE kind = ?1 AND key = ?2", params![kind, key])?;
        if keep_cloud {
            let options = SyncOptions { conflicts: ConflictRule::Cloud, ..self.sync_options()? };
            self.lane_apply(&[remote], &options, Lane::from_name(&lane))?;
        } else {
            self.stamp(&remote, after(&remote.changed_at), false)?;
        }
        Ok(())
    }

    fn book_title(&self, id: Option<&Value>) -> Result<Option<String>> {
        let Some(Value::String(id)) = id else { return Ok(None) };
        Ok(self.conn.query_row("SELECT title FROM books WHERE id = ?1", params![id], |r| r.get(0)).optional()?)
    }

    fn describe(&self, kind: &Kind, record: &Record, here: Option<&Map<String, Value>>) -> Result<String> {
        let data = record.data.as_ref().or(here);
        let key: Vec<Value> = serde_json::from_str(&record.key).unwrap_or_default();
        let field = |name: &str| data.and_then(|d| d.get(name)).and_then(Value::as_str).map(str::to_string);
        let book = |id: Option<&Value>| -> Result<String> {
            Ok(self.book_title(id)?.map(|t| format!(" in {t}")).unwrap_or_default())
        };
        Ok(match kind.name {
            "book" => format!("Details of {}", field("title").unwrap_or_else(|| "a book".into())),
            "book_progress" => format!("Reading progress{}", book(key.first())?),
            "book_shelves" => format!("Favourite and To be read{}", book(key.first())?),
            "book_phone" => format!("Whether the phone has it{}", book(key.first())?),
            "override" => format!("A corrected detail{}", book(key.first())?),
            "fetched" => format!("A detail found online{}", book(key.first())?),
            "audiobook" => format!("Chapters and narrators{}", book(key.first())?),
            "collection" => format!("The collection {}", field("name").unwrap_or_default()),
            "collection_book" => format!("A book's place in a collection{}", book(key.get(1))?),
            "annotation" => format!("A note or highlight{}", book(data.and_then(|d| d.get("book_id")))?),
            "book_tag" => format!("The tag {}{}", key.get(1).and_then(Value::as_str).unwrap_or_default(), book(key.first())?),
            "profile" => "Your profile picture".into(),
            "series" => format!("The missing books of {}", field("name").unwrap_or_default()),
            "read_along" => format!("Read-along timing{}", book(key.first())?),
            _ => format!("The note {}", field("title").filter(|t| !t.is_empty()).unwrap_or_else(|| "without a title".into())),
        })
    }

    /// Every file this device keeps in the cloud (covers, book files and
    /// collection pictures when those are synced), as (cloud path, file).
    /// With `covers_follow_files` a cover only goes with its book's file.
    pub(crate) fn files_kept(&self, options: &SyncOptions, covers_follow_files: bool) -> Result<Vec<(String, PathBuf)>> {
        let mut wanted = Vec::new();
        let rows = self
            .conn
            .prepare(
                "SELECT b.id, b.format, lf.path, lf.cover_path, b.phone_wanted OR b.phone_has
                 FROM books b JOIN local_files lf ON lf.book_id = b.id
                 WHERE b.deleted_at IS NULL",
            )?
            .query_map([], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, Option<String>>(2)?, r.get::<_, Option<String>>(3)?, r.get::<_, bool>(4)?))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        // The phone's place, when only chosen books go there.
        let chosen_only = covers_follow_files && options.phone_chosen_only;
        for (id, format, path, cover, for_phone) in rows {
            let hex = book_id_hex(&id);
            // Books chosen for the phone go whatever the file switches say.
            let wanted_here = if chosen_only || (covers_follow_files && for_phone) {
                for_phone
            } else if crate::audio::is_audio(&format) {
                options.audio_files
            } else {
                options.book_files
            };
            if let Some(cover) = cover.filter(|_| !covers_follow_files || (wanted_here && path.is_some())) {
                let extension = Path::new(&cover).extension().map(|e| e.to_string_lossy().to_string()).unwrap_or_default();
                wanted.push((format!("covers/{hex}.{extension}"), PathBuf::from(cover)));
            }
            if wanted_here {
                if let Some(path) = path {
                    wanted.push((format!("books/{hex}.{format}"), PathBuf::from(path)));
                }
            }
        }
        if let Some(name) = self.avatar_name()? {
            wanted.push((format!("pictures/{name}"), self.paths.profile_dir.join(name)));
        }
        let mut sources = Vec::new();
        if options.collections {
            sources.push("SELECT picture FROM collections WHERE deleted_at IS NULL");
        }
        // Covers of books being written travel with notes.
        if options.notes {
            sources.push("SELECT cover AS picture FROM writing_projects WHERE deleted_at IS NULL");
        }
        if !sources.is_empty() {
            let pictures = self
                .conn
                .prepare(&format!("SELECT DISTINCT picture FROM ({}) WHERE picture LIKE 'picture:%'", sources.join(" UNION ALL ")))?
                .query_map([], |r| r.get::<_, String>(0))?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            for picture in pictures {
                let name = picture.trim_start_matches("picture:");
                wanted.push((format!("pictures/{name}"), self.paths.pictures_dir.join(name)));
            }
        }
        Ok(wanted)
    }

    /// Books this device has that the cloud doesn't, as (cloud path, file).
    fn files_to_send(&self, options: &SyncOptions, lane: Lane, covers_follow_files: bool) -> Result<Vec<(String, PathBuf)>> {
        if covers_follow_files {
            // Covers sent full-size before they went phone-sized are sent again, once.
            let key = format!("sync.small_covers.{}", lane.files_table());
            if self.setting(&key)?.is_none() {
                self.conn.execute(&format!("DELETE FROM {} WHERE path LIKE 'covers/%'", lane.files_table()), [])?;
                self.set_setting(&key, "1")?;
            }
        }
        let retry_after = (Utc::now() - Duration::hours(RETRY_FILE_HOURS)).to_rfc3339_opts(SecondsFormat::Millis, true);
        let wanted = self.files_kept(options, covers_follow_files)?;
        let mut out = Vec::new();
        let sql = format!("SELECT uploaded_at, failed_at, error FROM {} WHERE path = ?1", lane.files_table());
        for (remote, file) in wanted {
            let done: Option<(Option<String>, Option<String>, Option<String>)> =
                self.conn.query_row(&sql, params![remote], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).optional()?;
            let due = match done {
                None => true,
                Some((Some(_), ..)) => false,
                // Turned away as too big before big files went to Supabase in pieces: try now.
                Some((None, _, Some(error))) if error == "too big for this Supabase plan's file size limit" => true,
                Some((None, failed, _)) => failed.is_none_or(|f| f < retry_after),
            };
            if due && file.exists() {
                out.push((remote, file));
            }
        }
        Ok(out)
    }

    /// Books chosen for the phone whose file isn't on this computer and
    /// hasn't reached the phone's place (`lane`): copied there from the other.
    pub(crate) fn phone_relays(&self, lane: Lane) -> Result<Vec<Relay>> {
        let rows = self
            .conn
            .prepare(
                "SELECT b.id, b.format, lf.cover_path FROM books b LEFT JOIN local_files lf ON lf.book_id = b.id
                 WHERE b.deleted_at IS NULL AND b.phone_wanted AND lf.path IS NULL",
            )?
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, Option<String>>(2)?)))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let retry_after = (Utc::now() - Duration::hours(RETRY_FILE_HOURS)).to_rfc3339_opts(SecondsFormat::Millis, true);
        let sql = format!("SELECT uploaded_at, failed_at FROM {} WHERE path = ?1", lane.files_table());
        // Some(true): to send now; Some(false): already there; None: failed lately, tried again later.
        let state = |path: &str| -> Result<Option<bool>> {
            let done: Option<(Option<String>, Option<String>)> = self.conn.query_row(&sql, params![path], |r| Ok((r.get(0)?, r.get(1)?))).optional()?;
            Ok(match done {
                None => Some(true),
                Some((Some(_), _)) => Some(false),
                Some((None, failed)) => failed.is_none_or(|f| f < retry_after).then_some(true),
            })
        };
        let due = |path: &str| -> Result<bool> { Ok(state(path)? == Some(true)) };
        let mut out = Vec::new();
        for (book_id, format, cover) in rows {
            let hex = book_id_hex(&book_id);
            let path = format!("books/{hex}.{format}");
            let Some(send_book) = state(&path)? else { continue };
            let cover = cover.map(PathBuf::from).map(|c| {
                let extension = c.extension().map(|e| e.to_string_lossy().to_string()).unwrap_or_default();
                (format!("covers/{hex}.{extension}"), c)
            });
            let cover = match cover {
                Some((cloud, local)) if due(&cloud)? => Some((cloud, local)),
                _ => None,
            };
            // A book already there still gets its cover if that didn't make it.
            if send_book || cover.is_some() {
                out.push(Relay { book_id, path, send_book, cover });
            }
        }
        Ok(out)
    }

    fn file_sent(&self, remote: &str, error: Option<&str>) -> Result<()> {
        self.lane_file_sent(remote, error, Lane::Main)
    }

    fn lane_file_sent(&self, remote: &str, error: Option<&str>, lane: Lane) -> Result<()> {
        let now = now_utc();
        self.conn.execute(
            &format!("INSERT OR REPLACE INTO {} (path, uploaded_at, failed_at, error) VALUES (?1, ?2, ?3, ?4)", lane.files_table()),
            params![remote, error.is_none().then(|| now.clone()), error.map(|_| now.clone()), error],
        )?;
        Ok(())
    }

    /// Collection pictures named in records that aren't on this device yet.
    fn pictures_to_fetch(&self) -> Result<Vec<(String, PathBuf)>> {
        let pictures = self
            .conn
            .prepare(
                "SELECT DISTINCT picture FROM collections WHERE deleted_at IS NULL AND picture LIKE 'picture:%'
                 UNION SELECT cover FROM writing_projects WHERE deleted_at IS NULL AND cover LIKE 'picture:%'",
            )?
            .query_map([], |r| r.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(pictures
            .iter()
            .map(|p| p.trim_start_matches("picture:"))
            .filter(|name| !name.contains(['/', '\\']) && !name.starts_with('.'))
            .map(|name| (format!("pictures/{name}"), self.paths.pictures_dir.join(name)))
            .filter(|(_, file)| !file.exists())
            .collect())
    }

    /// Books with no cover here, by their cover's file name stem (the hash).
    fn books_without_covers(&self) -> Result<Vec<(String, String)>> {
        let rows = self
            .conn
            .prepare(
                "SELECT b.id, lf.cover_path FROM books b LEFT JOIN local_files lf ON lf.book_id = b.id
                 WHERE b.deleted_at IS NULL",
            )?
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?)))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows
            .into_iter()
            .filter(|(_, cover)| cover.as_ref().is_none_or(|c| !Path::new(c).exists()))
            .map(|(id, _)| (book_id_hex(&id).to_string(), id))
            .collect())
    }

    fn set_cover(&self, book_id: &str, cover: &Path) -> Result<()> {
        self.conn.execute(
            "INSERT INTO local_files (book_id, path, cover_path) VALUES (?1, NULL, ?2)
             ON CONFLICT(book_id) DO UPDATE SET cover_path = excluded.cover_path",
            params![book_id, cover.display().to_string()],
        )?;
        Ok(())
    }

    /// Queues a deleted book's file and cover to be erased from the cloud.
    pub(crate) fn erase_from_cloud(&self, book_id: &str) -> Result<()> {
        let found: Option<(String, Option<String>)> = self
            .conn
            .query_row(
                "SELECT b.format, lf.cover_path FROM books b LEFT JOIN local_files lf ON lf.book_id = b.id WHERE b.id = ?1",
                params![book_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        let Some((format, cover)) = found else { return Ok(()) };
        let hex = book_id_hex(book_id);
        let mut gone = vec![format!("books/{hex}.{format}")];
        // The cover's name in the cloud follows the picture's own type.
        match cover.as_deref().and_then(|c| Path::new(c).extension()) {
            Some(extension) => gone.push(format!("covers/{hex}.{}", extension.to_string_lossy())),
            None => gone.extend(["jpg", "png", "webp"].map(|e| format!("covers/{hex}.{e}"))),
        }
        let lanes: &[Lane] = if self.sync_also()?.is_some() { &[Lane::Main, Lane::Also] } else { &[Lane::Main] };
        for &lane in lanes {
            let mut paths = self.files_to_erase(lane)?;
            paths.extend(gone.iter().cloned());
            paths.sort();
            paths.dedup();
            self.put_setting(lane.erase_key(), Some(&serde_json::to_string(&paths)?))?;
        }
        Ok(())
    }

    /// A book's cover changed on this computer (from `old` to `new`, local
    /// files): the new one goes up again, and a copy under another name is
    /// erased from the cloud.
    pub(crate) fn cover_changed(&self, book_id: &str, old: Option<&str>, new: Option<&str>) -> Result<()> {
        // Synced like any detail, so devices that already have a cover fetch it again.
        let now = now_utc();
        self.conn.execute(
            "INSERT INTO metadata_fetched (book_id, field, value, source, updated_at) VALUES (?1, ?2, ?3, 'cover', ?3)
             ON CONFLICT(book_id, field) DO UPDATE SET value = excluded.value, source = excluded.source, updated_at = excluded.updated_at",
            params![book_id, COVER_REV, now],
        )?;
        let hex = book_id_hex(book_id);
        let cloud = |file: Option<&str>| file.and_then(|f| Path::new(f).extension()).map(|e| format!("covers/{hex}.{}", e.to_string_lossy()));
        let (old, new) = (cloud(old), cloud(new));
        let lanes: &[Lane] = if self.sync_also()?.is_some() { &[Lane::Main, Lane::Also] } else { &[Lane::Main] };
        for &lane in lanes {
            self.conn.execute(&format!("DELETE FROM {} WHERE path LIKE ?1", lane.files_table()), params![format!("covers/{hex}.%")])?;
            if let Some(old) = old.as_ref().filter(|o| Some(*o) != new.as_ref()) {
                let mut paths = self.files_to_erase(lane)?;
                if !paths.contains(old) {
                    paths.push(old.clone());
                    self.put_setting(lane.erase_key(), Some(&serde_json::to_string(&paths)?))?;
                }
            }
        }
        Ok(())
    }

    fn covers_stale(&self) -> Result<Vec<String>> {
        Ok(self.setting(COVERS_STALE)?.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default())
    }

    fn cover_stale(&self, book_id: &str, stale: bool) -> Result<()> {
        let mut books = self.covers_stale()?;
        let had = books.iter().any(|b| b == book_id);
        if stale == had {
            return Ok(());
        }
        if stale {
            books.push(book_id.to_string());
        } else {
            books.retain(|b| b != book_id);
        }
        let saved = if books.is_empty() { None } else { Some(serde_json::to_string(&books)?) };
        self.put_setting(COVERS_STALE, saved.as_deref())
    }

    /// Books whose cover another device replaced and that have one here, by
    /// hash, with the cover to replace.
    fn stale_covers(&self) -> Result<Vec<(String, String, PathBuf)>> {
        let mut out = Vec::new();
        for book_id in self.covers_stale()? {
            let cover: Option<String> = self
                .conn
                .query_row("SELECT cover_path FROM local_files WHERE book_id = ?1", params![book_id], |r| r.get(0))
                .optional()?
                .flatten();
            match cover.filter(|c| Path::new(c).exists()) {
                Some(cover) => out.push((book_id_hex(&book_id).to_string(), book_id, PathBuf::from(cover))),
                // No cover here: the usual fetch of missing covers brings it.
                None => self.cover_stale(&book_id, false)?,
            }
        }
        Ok(out)
    }

    fn files_to_erase(&self, lane: Lane) -> Result<Vec<String>> {
        Ok(self.setting(lane.erase_key())?.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default())
    }

    /// Forgets erased files, so the same book imported again goes up afresh.
    fn files_erased(&self, done: &[String], lane: Lane) -> Result<()> {
        for path in done {
            self.conn.execute(&format!("DELETE FROM {} WHERE path = ?1", lane.files_table()), params![path])?;
        }
        let left: Vec<String> = self.files_to_erase(lane)?.into_iter().filter(|p| !done.contains(p)).collect();
        let left = if left.is_empty() { None } else { Some(serde_json::to_string(&left)?) };
        self.put_setting(lane.erase_key(), left.as_deref())
    }

    /// A cloud file in words, for the Sync activity page: "Dracula", "The
    /// cover of Dracula", "A collection picture".
    pub fn file_named(&self, path: &str) -> String {
        let hex = |rest: &str| rest.split('.').next().unwrap_or_default().to_string();
        let title = |hex: String| -> Option<String> {
            self.conn
                .query_row("SELECT title FROM books WHERE id = ?1", params![format!("sha256:{hex}")], |r| r.get(0))
                .optional()
                .ok()
                .flatten()
        };
        if let Some(rest) = path.strip_prefix("books/") {
            return title(hex(rest)).unwrap_or_else(|| "A book".into());
        }
        if let Some(rest) = path.strip_prefix("covers/") {
            return title(hex(rest)).map(|t| format!("The cover of {t}")).unwrap_or_else(|| "A cover".into());
        }
        if path.starts_with("pictures/avatar-") {
            return "Your profile picture".into();
        }
        if path.starts_with("pictures/") {
            return "A collection picture".into();
        }
        path.to_string()
    }

    /// Where a book's file is kept in the cloud, if this device knows the book.
    pub fn cloud_book_path(&self, book_id: &str) -> Result<Option<String>> {
        let format: Option<String> = self
            .conn
            .query_row("SELECT format FROM books WHERE id = ?1 AND deleted_at IS NULL", params![book_id], |r| r.get(0))
            .optional()?;
        Ok(format.map(|f| format!("books/{}.{f}", book_id_hex(book_id))))
    }

    /// Books added on a phone whose file isn't on this computer yet. Ones
    /// that are here already are marked collected on the way.
    pub(crate) fn books_from_phone(&self) -> Result<Vec<String>> {
        let mut stmt = self.conn.prepare("SELECT id FROM books WHERE from_phone AND deleted_at IS NULL")?;
        let ids = stmt.query_map([], |r| r.get(0))?.collect::<rusqlite::Result<Vec<String>>>()?;
        let mut waiting = Vec::new();
        for id in ids {
            // Already here (imported on this computer too): nothing to fetch.
            if self.has_local_file(&id)? {
                self.collected_from_phone(&id)?;
            } else {
                waiting.push(id);
            }
        }
        Ok(waiting)
    }

    /// A book added on a phone is on this computer now.
    pub(crate) fn collected_from_phone(&self, book_id: &str) -> Result<()> {
        self.conn.execute("UPDATE books SET from_phone = 0 WHERE id = ?1", params![book_id])?;
        Ok(())
    }

    /// Chooses books to be sent to the phone (when only chosen ones are),
    /// or stops choosing them.
    pub fn set_phone_wanted(&self, book_ids: &[String], wanted: bool) -> Result<()> {
        for id in book_ids {
            self.conn.execute("UPDATE books SET phone_wanted = ?2 WHERE id = ?1 AND phone_wanted IS NOT ?2", params![id, wanted])?;
        }
        Ok(())
    }

    /// A temporary file in the library folder to download into.
    pub fn download_target(&self, book_id: &str) -> PathBuf {
        self.paths.books_dir.join(format!(".{}.download", book_id_hex(book_id)))
    }

    /// Adopts a book file fetched from the cloud, then removes the download.
    pub fn adopt_download(&mut self, book_id: &str, download: &Path, format: &str) -> Result<()> {
        let named = download.with_extension(format);
        fs::rename(download, &named)?;
        let result = self.import_download(&named);
        let _ = fs::remove_file(&named);
        match Some(result) {
            Some(ImportResult::AlreadyInLibrary { book_id: got, .. } | ImportResult::Imported { book_id: got, .. }) if got == book_id => Ok(()),
            Some(ImportResult::Failed { reason, .. }) => Err(Error::Unsuitable(reason)),
            _ => Err(Error::Unsuitable("the downloaded file isn't the book that was asked for".into())),
        }
    }
}

enum Merge {
    Applied,
    Kept,
    Conflict,
}

/// A short, readable account of a record for the conflict list.
fn summarize(kind: &Kind, data: Option<&Map<String, Value>>) -> String {
    let Some(data) = data else { return "Deleted".into() };
    let text = |name: &str| data.get(name).and_then(Value::as_str).unwrap_or_default().to_string();
    let deleted = ["deleted_at", "removed_at"].iter().any(|c| data.get(*c).is_some_and(|v| !v.is_null()));
    if deleted {
        return "Deleted".into();
    }
    let short = |s: String| {
        let s = s.trim().replace('\n', " ");
        if s.chars().count() > 80 {
            format!("{}…", s.chars().take(80).collect::<String>())
        } else {
            s
        }
    };
    match kind.name {
        "book_progress" => {
            let pct = data.get("total_progression").and_then(Value::as_f64).map(|p| format!(", {:.0}% through", p * 100.0));
            let status = match text("status").as_str() {
                "read" => "Read",
                "in_progress" => "In progress",
                _ => "Unread",
            };
            format!("{status}{}", pct.unwrap_or_default())
        }
        "book_shelves" => {
            let on = |name: &str| data.get(name).and_then(Value::as_i64) == Some(1);
            match (on("favorite"), on("want_to_read")) {
                (true, true) => "Favourite, To be read".into(),
                (true, false) => "Favourite".into(),
                (false, true) => "To be read".into(),
                (false, false) => "Neither".into(),
            }
        }
        "book_phone" => {
            let on = |name: &str| data.get(name).and_then(Value::as_i64) == Some(1);
            if on("from_phone") {
                "Added on the phone".into()
            } else if on("phone_has") {
                "Downloaded on the phone".into()
            } else if on("phone_wanted") {
                "Chosen for the phone".into()
            } else {
                "Not on the phone".into()
            }
        }
        "book" => short(text("title")),
        "override" | "fetched" => short(text("value")),
        "audiobook" => if data.get("ebook_id").and_then(|v| v.as_str()).is_some_and(|v| !v.is_empty()) { "Linked to its ebook".into() } else { "Chapters and narrators".into() },
        "collection" => short(text("name")),
        "collection_book" => "In the collection".into(),
        "book_tag" => if data.get("removed_at").is_some_and(|v| !v.is_null()) { "Tag taken off".into() } else { "Tagged".into() },
        "profile" => if text("avatar").is_empty() { "No picture".into() } else { "A picture".into() },
        "series" => short(text("name")),
        "annotation" => short(if text("note").is_empty() { text("excerpt") } else { text("note") }),
        _ => short(text("body")),
    }
}

const OFFLINE_PREFIX: &str = "offline: ";

/// A `sync_clock` row (as `c`) the place hasn't been sent yet.
fn unsent(lane: Lane) -> &'static str {
    match lane {
        Lane::Main => "c.pushed = 0",
        Lane::Also => {
            "NOT EXISTS (SELECT 1 FROM sync_clock_also a WHERE a.kind = c.kind AND a.key = c.key AND a.changed_at = c.changed_at)"
        }
    }
}

/// One sync run: pull, merge, push, then files. The library is locked only
/// while reading or writing it, never while waiting on the network.
pub fn sync_once(library: &Mutex<Library>, remote: &mut dyn Remote) -> Result<SyncReport> {
    let epoch = library.lock().map_err(|_| Error::Unsuitable("the library is unavailable".into()))?.sync_epoch;
    sync_once_since(library, remote, epoch)
}

/// As `sync_once`, for a remote opened when sync was at `epoch` (see
/// `Library::sync_epoch`). If sync has started over since, nothing is written.
pub fn sync_once_since(library: &Mutex<Library>, remote: &mut dyn Remote, epoch: u64) -> Result<SyncReport> {
    sync_both_since(library, remote, None, epoch)
}

/// As `sync_both_since`, when either place may be out of reach this time.
/// A place that couldn't be connected is left alone (its trouble was noted
/// when connecting); the result is the first place's when it ran, else the second's.
pub fn sync_lanes_since(
    library: &Mutex<Library>,
    main: Option<&mut dyn Remote>,
    also: Option<&mut dyn Remote>,
    epoch: u64,
) -> Result<SyncReport> {
    sync_watched(library, main, also, epoch, &|_| {})
}

/// As `sync_lanes_since`, telling `tell` what it's doing as it goes, for the
/// Sync activity page.
pub fn sync_watched(
    library: &Mutex<Library>,
    main: Option<&mut dyn Remote>,
    also: Option<&mut dyn Remote>,
    epoch: u64,
    tell: Tell,
) -> Result<SyncReport> {
    if main.is_none() && also.is_none() {
        return Ok(SyncReport::default());
    }
    run_lanes(library, main, also, epoch, tell)
}

/// What a sync run is doing, as it happens.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SyncEvent {
    /// A place moved on to a new step.
    Step { lane: Lane, step: SyncStep },
    /// Changes so far this run, for one place.
    Records { lane: Lane, received: u32, sent: u32 },
    /// The files a place is about to send or fetch.
    FilesPlanned { lane: Lane, direction: Direction, count: u32, bytes: u64 },
    /// One file starting, or finished (`done`), or not sent (`problem`).
    File {
        lane: Lane,
        direction: Direction,
        path: String,
        /// What it is, in words: "Dracula" or "The cover of Dracula".
        what: String,
        bytes: u64,
        done: bool,
        problem: Option<String>,
    },
    /// A place has finished, well or not.
    Finished { lane: Lane, problem: Option<String> },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SyncStep {
    /// Fetching what other devices changed.
    Receiving,
    /// Sending what changed here.
    Sending,
    /// Book files, covers and pictures.
    Files,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Direction {
    Up,
    Down,
    Erase,
}

/// Hears `SyncEvent`s. Called with the library unlocked.
pub type Tell<'t> = &'t (dyn Fn(SyncEvent) + Sync);

/// One run with both places: what each has that this device doesn't comes
/// down first, then each is sent what it lacks, so a change made through
/// one (a phone on Supabase, say) reaches the other in the same run. A place
/// that can't be reached doesn't stop the other; each remembers its own
/// result. Returns the first place's, with what the second brought added.
pub fn sync_both_since(library: &Mutex<Library>, main: &mut dyn Remote, also: Option<&mut dyn Remote>, epoch: u64) -> Result<SyncReport> {
    run_lanes(library, Some(main), also, epoch, &|_| {})
}

fn run_lanes(library: &Mutex<Library>, main: Option<&mut dyn Remote>, also: Option<&mut dyn Remote>, epoch: u64, tell: Tell) -> Result<SyncReport> {
    let take = || library.lock().map_err(|_| Error::Unsuitable("the library is unavailable".into()));
    // Sync started over meanwhile (another service, or signed out): this
    // run's place is no longer the library's, so it writes nothing more.
    let lock = || {
        let library = take()?;
        if library.sync_epoch != epoch {
            return Err(Error::Superseded);
        }
        Ok(library)
    };
    let (main_outcome, also_outcome) = run_both(&lock, main, also, tell);
    for (lane, outcome) in [(Lane::Main, &main_outcome), (Lane::Also, &also_outcome)] {
        if let Some(outcome) = outcome {
            let problem = outcome.as_ref().err().filter(|e| !matches!(e, Error::Superseded)).map(|e| e.to_string());
            tell(SyncEvent::Finished { lane, problem: problem.map(|p| p.trim_start_matches(OFFLINE_PREFIX).to_string()) });
        }
    }
    let superseded = |o: &Result<SyncReport>| matches!(o, Err(Error::Superseded));
    if main_outcome.as_ref().is_some_and(superseded) || also_outcome.as_ref().is_some_and(superseded) {
        return Ok(SyncReport::default());
    }
    match lock() {
        Err(Error::Superseded) => Ok(SyncReport::default()),
        Err(e) => Err(e),
        Ok(library) => {
            if let Some(outcome) = &main_outcome {
                library.record_result(outcome, Lane::Main)?;
            }
            if let Some(outcome) = &also_outcome {
                library.record_result(outcome, Lane::Also)?;
            }
            // Books from elsewhere may be the other half of an audiobook here.
            let received = |o: &Option<Result<SyncReport>>| o.as_ref().is_some_and(|o| o.as_ref().is_ok_and(|r| r.received > 0));
            if received(&main_outcome) || received(&also_outcome) {
                let _ = library.auto_link_audiobooks();
            }
            let Some(main_outcome) = main_outcome else {
                return also_outcome.unwrap_or_else(|| Ok(SyncReport::default()));
            };
            let mut report = main_outcome?;
            if let Some(Ok(also)) = also_outcome {
                report.received += also.received;
                report.sent += also.sent;
                report.files_sent += also.files_sent;
                report.files_received += also.files_received;
                report.new_conflicts += also.new_conflicts;
                report.skipped_files.extend(also.skipped_files);
            }
            Ok(report)
        }
    }
}

type Lock<'l, 'a> = &'l (dyn Fn() -> Result<std::sync::MutexGuard<'a, Library>> + Sync);

/// Runs a step for a place that hasn't failed yet in this run.
fn step(outcome: &mut Result<SyncReport>, work: impl FnOnce(&mut SyncReport) -> Result<()>) {
    if let Ok(report) = outcome {
        if let Err(e) = work(report) {
            *outcome = Err(e);
        }
    }
}

type Outcomes = (Option<Result<SyncReport>>, Option<Result<SyncReport>>);

fn run_both(lock: Lock, mut main: Option<&mut dyn Remote>, mut also: Option<&mut dyn Remote>, tell: Tell) -> Outcomes {
    let options = match lock().and_then(|l| l.sync_options()) {
        Ok(options) => options,
        Err(e) => return (Some(Err(e)), None),
    };
    let also_options = options.for_lane(Lane::Also);
    let mut first = main.as_ref().map(|_| Ok(SyncReport::default()));
    let mut second = also.as_ref().map(|_| Ok(SyncReport::default()));
    let stopped = |a: &Option<Result<SyncReport>>, b: &Option<Result<SyncReport>>| {
        matches!(a, Some(Err(Error::Superseded))) || matches!(b, Some(Err(Error::Superseded)))
    };
    type Work = fn(Lock, Tell, &mut dyn Remote, &SyncOptions, Lane, &mut SyncReport) -> Result<()>;
    // Each step runs for both places at once, so a slow place (a big upload
    // to iCloud, say) never keeps the other waiting. Every place has received
    // before either sends, so a change made through one reaches the other in
    // the same run.
    let mut both = |work: Work, first: &mut Option<Result<SyncReport>>, second: &mut Option<Result<SyncReport>>| {
        let main = main.as_deref_mut().zip(first.as_mut());
        let also = also.as_deref_mut().zip(second.as_mut());
        match (main, also) {
            (Some((m, mo)), Some((a, ao))) => thread::scope(|scope| {
                let options = &options;
                let also_options = &also_options;
                scope.spawn(move || step(ao, |r| work(lock, tell, a, also_options, Lane::Also, r)));
                step(mo, |r| work(lock, tell, m, options, Lane::Main, r));
            }),
            (Some((m, mo)), None) => step(mo, |r| work(lock, tell, m, &options, Lane::Main, r)),
            (None, Some((a, ao))) => step(ao, |r| work(lock, tell, a, &also_options, Lane::Also, r)),
            (None, None) => {}
        }
    };

    both(pull, &mut first, &mut second);
    if stopped(&first, &second) {
        return (first, second);
    }
    both(push, &mut first, &mut second);
    if stopped(&first, &second) {
        return (first, second);
    }
    // Books added on a phone come down before either place's files are
    // sent, so the other place gets them in this same run.
    both(collect_from_phone, &mut first, &mut second);
    if stopped(&first, &second) {
        return (first, second);
    }
    both(files, &mut first, &mut second);
    if stopped(&first, &second) {
        return (first, second);
    }
    // Books chosen for the phone that are only in the other place go across
    // directly, without being kept on this computer.
    if let (Some(m), Some(a)) = (main, also) {
        match (m.covers_follow_files(), a.covers_follow_files()) {
            (false, true) => {
                if let Some(outcome) = &mut second {
                    step(outcome, |r| relay_for_phone(lock, tell, m, a, Lane::Also, r));
                }
            }
            (true, false) => {
                if let Some(outcome) = &mut first {
                    step(outcome, |r| relay_for_phone(lock, tell, a, m, Lane::Main, r));
                }
            }
            _ => {}
        }
    }
    (first, second)
}

/// Copies the files of books chosen for the phone from the other place to
/// the phone's (`lane`), for books whose file isn't on this computer. Each
/// passes through a temporary file that's removed straight after.
fn relay_for_phone(lock: Lock, tell: Tell, source: &mut dyn Remote, target: &mut dyn Remote, lane: Lane, report: &mut SyncReport) -> Result<()> {
    let wanted = lock()?.phone_relays(lane)?;
    if wanted.is_empty() {
        return Ok(());
    }
    let file = |path: &str, what: &str, done: bool, problem: Option<String>| {
        tell(SyncEvent::File { lane, direction: Direction::Up, path: path.to_string(), what: what.to_string(), bytes: 0, done, problem });
    };
    let small_dir = lock()?.paths.covers_dir.join(SMALL_COVERS);
    for relay in wanted {
        if winding_down() {
            break;
        }
        if relay.send_book {
            let (what, temp) = {
                let library = lock()?;
                (library.file_named(&relay.path), library.download_target(&relay.book_id).with_extension("relay"))
            };
            file(&relay.path, &what, false, None);
            match fetch(source, &relay.path, &temp) {
                Ok(true) => {}
                Ok(false) => {
                    let why = "not in the other sync place either".to_string();
                    lock()?.lane_file_sent(&relay.path, Some(&why), lane)?;
                    file(&relay.path, &what, true, Some(why));
                    continue;
                }
                Err(e) => {
                    // The other place can't hand it over now (an iCloud file
                    // still downloading, say): tried again at a later sync.
                    lock()?.lane_file_sent(&relay.path, Some(&e.to_string()), lane)?;
                    file(&relay.path, &what, true, Some(e.to_string()));
                    continue;
                }
            }
            let sent = target.upload(&relay.path, &temp);
            let _ = fs::remove_file(&temp);
            match sent {
                Ok(()) => {
                    lock()?.lane_file_sent(&relay.path, None, lane)?;
                    report.files_sent += 1;
                    file(&relay.path, &what, true, None);
                }
                Err(Error::Rejected(why)) => {
                    lock()?.lane_file_sent(&relay.path, Some(&why), lane)?;
                    report.skipped_files.push(format!("{what}: {why}"));
                    file(&relay.path, &what, true, Some(why));
                    continue;
                }
                Err(e) => {
                    file(&relay.path, &what, true, Some(e.to_string()));
                    return Err(e);
                }
            }
        }
        // Its cover goes with it, phone-sized.
        if let Some((cover_path, cover)) = relay.cover {
            if cover.exists() {
                let small = if target.covers_follow_files() { small_cover(&cover, &small_dir) } else { cover };
                match target.upload(&cover_path, &small) {
                    Ok(()) => lock()?.lane_file_sent(&cover_path, None, lane)?,
                    Err(Error::Rejected(why)) => lock()?.lane_file_sent(&cover_path, Some(&why), lane)?,
                    Err(e) => return Err(e),
                }
            }
        }
    }
    Ok(())
}

fn pull(lock: Lock, tell: Tell, remote: &mut dyn Remote, options: &SyncOptions, lane: Lane, report: &mut SyncReport) -> Result<()> {
    tell(SyncEvent::Step { lane, step: SyncStep::Receiving });
    let mut cursor = lock()?.cursor(options, lane)?;
    loop {
        let Page { records, cursor: next } = remote.pull(&cursor, PAGE)?;
        if records.is_empty() {
            break;
        }
        let library = lock()?;
        let (applied, conflicts) = library.lane_apply(&records, options, lane)?;
        report.received += applied;
        report.new_conflicts += conflicts;
        cursor = next;
        library.save_cursor(options, &cursor, lane)?;
        drop(library);
        tell(SyncEvent::Records { lane, received: report.received, sent: report.sent });
        if records.len() < PAGE {
            break;
        }
    }
    Ok(())
}

fn push(lock: Lock, tell: Tell, remote: &mut dyn Remote, options: &SyncOptions, lane: Lane, report: &mut SyncReport) -> Result<()> {
    tell(SyncEvent::Step { lane, step: SyncStep::Sending });
    let mut seen = HashSet::new();
    loop {
        let batch = lock()?.lane_outbox(options, BATCH, lane)?;
        // Anything changed again mid-send comes back; send it once more, not forever.
        let fresh: Vec<Record> = batch.into_iter().filter(|r| seen.insert((r.kind.clone(), r.key.clone(), r.changed_at.clone()))).collect();
        if fresh.is_empty() {
            break;
        }
        remote.push(&fresh)?;
        lock()?.lane_mark_sent(&fresh, lane)?;
        report.sent += fresh.len() as u32;
        tell(SyncEvent::Records { lane, received: report.received, sent: report.sent });
    }
    Ok(())
}

/// Fetches the books added on a phone that this computer hasn't got yet,
/// from the phone's place (Supabase), and keeps them here like any import.
/// A book whose file hasn't arrived there yet is tried again next time.
fn collect_from_phone(lock: Lock, tell: Tell, remote: &mut dyn Remote, _: &SyncOptions, lane: Lane, report: &mut SyncReport) -> Result<()> {
    if !remote.covers_follow_files() {
        return Ok(());
    }
    let waiting = lock()?.books_from_phone()?;
    for book_id in waiting {
        let (path, target, what) = {
            let library = lock()?;
            let Some(path) = library.cloud_book_path(&book_id)? else { continue };
            let what = library.file_named(&path);
            (path, library.download_target(&book_id), what)
        };
        let file = |done: bool, problem: Option<String>| {
            tell(SyncEvent::File { lane, direction: Direction::Down, path: path.clone(), what: what.clone(), bytes: 0, done, problem })
        };
        file(false, None);
        let got = fetch(remote, &path, &target);
        let kept = match got {
            Ok(true) => {
                let format = path.rsplit('.').next().unwrap_or("epub").to_string();
                let mut library = lock()?;
                let result = library.adopt_download(&book_id, &target, &format).and_then(|_| {
                    // The phone's place has it already, so it isn't sent back there.
                    library.lane_file_sent(&path, None, lane)?;
                    library.collected_from_phone(&book_id)
                });
                drop(library);
                let _ = fs::remove_file(&target);
                result.map(|_| true)
            }
            Ok(false) => Ok(false),
            Err(e) => Err(e),
        };
        match kept {
            Ok(true) => {
                report.files_received += 1;
                file(true, None);
            }
            Ok(false) => file(true, Some("Not in the cloud yet".into())),
            Err(e) => file(true, Some(e.to_string())),
        }
    }
    Ok(())
}

fn files(lock: Lock, tell: Tell, remote: &mut dyn Remote, options: &SyncOptions, lane: Lane, report: &mut SyncReport) -> Result<()> {
    tell(SyncEvent::Step { lane, step: SyncStep::Files });
    let file = |direction: Direction, path: &str, what: &str, bytes: u64, done: bool, problem: Option<String>| {
        tell(SyncEvent::File { lane, direction, path: path.to_string(), what: what.to_string(), bytes, done, problem });
    };
    let to_erase = lock()?.files_to_erase(lane)?;
    if !to_erase.is_empty() {
        for path in &to_erase {
            remote.remove(path)?;
        }
        lock()?.files_erased(&to_erase, lane)?;
    }

    let to_send = {
        let library = lock()?;
        let sending = library.files_to_send(options, lane, remote.covers_follow_files())?;
        sending
            .into_iter()
            .map(|(path, local)| {
                let what = library.file_named(&path);
                let bytes = fs::metadata(&local).map(|m| m.len()).unwrap_or(0);
                (path, local, what, bytes)
            })
            .collect::<Vec<_>>()
    };
    // Covers and pictures go first, then the cloud's covers come down, and
    // only then the book files: in a big library those take far longer, and
    // every device should show every cover meanwhile.
    let (books, small): (Vec<_>, Vec<_>) = to_send.into_iter().partition(|(path, ..)| path.starts_with("books/"));
    send(lock, tell, remote, lane, report, small)?;

    let mut fetches: Vec<(String, PathBuf, String, Option<String>)> = Vec::new();
    {
        let library = lock()?;
        if let Some((path, local)) = library.avatar_to_fetch()? {
            fetches.push((path, local, "Your profile picture".into(), None));
        }
        if options.collections {
            for (path, local) in library.pictures_to_fetch()? {
                fetches.push((path, local, "A collection picture".into(), None));
            }
        }
    }
    let (bare, stale, covers_dir) = {
        let library = lock()?;
        (library.books_without_covers()?, library.stale_covers()?, library.paths.covers_dir.clone())
    };
    // A cover another device replaced comes down under a new name, and only
    // then takes the old one's place.
    let mut replacing: HashMap<String, PathBuf> = HashMap::new();
    if !bare.is_empty() || !stale.is_empty() {
        let in_cloud = remote.list("covers/")?;
        let library = lock()?;
        // A cover this computer is about to erase (one a reset took away) stays away.
        let erasing = library.files_to_erase(lane)?;
        for (hex, book_id) in bare {
            let Some(name) = in_cloud.iter().find(|n| Path::new(n).file_stem().is_some_and(|s| s == hex.as_str())) else { continue };
            let path = format!("covers/{name}");
            if erasing.contains(&path) {
                continue;
            }
            let what = library.file_named(&path);
            fetches.push((path, covers_dir.join(name), what, Some(book_id)));
        }
        let stamp = Utc::now().timestamp_millis();
        for (hex, book_id, old) in stale {
            // Not up yet: it's tried again next time.
            let Some(name) = in_cloud.iter().find(|n| Path::new(n).file_stem().is_some_and(|s| s == hex.as_str())) else { continue };
            let path = format!("covers/{name}");
            let extension = Path::new(name).extension().map(|e| e.to_string_lossy().to_string()).unwrap_or_else(|| "jpg".into());
            let what = library.file_named(&path);
            replacing.insert(book_id.clone(), old);
            fetches.push((path, covers_dir.join(format!("{hex}.{stamp}.{extension}")), what, Some(book_id)));
        }
    }
    if !fetches.is_empty() {
        tell(SyncEvent::FilesPlanned { lane, direction: Direction::Down, count: fetches.len() as u32, bytes: 0 });
    }
    for (path, local, what, cover_of) in fetches {
        if winding_down() {
            break;
        }
        file(Direction::Down, &path, &what, 0, false, None);
        let got = fetch(remote, &path, &local);
        let problem = match &got {
            Ok(true) => None,
            Ok(false) => Some("It isn't in the cloud yet.".to_string()),
            Err(e) => Some(e.to_string()),
        };
        let bytes = fs::metadata(&local).map(|m| m.len()).unwrap_or(0);
        file(Direction::Down, &path, &what, bytes, true, problem);
        if got? {
            let library = lock()?;
            // The place has it already, so it's never sent back there.
            library.lane_file_sent(&path, None, lane)?;
            match &cover_of {
                Some(book_id) => {
                    library.set_cover(book_id, &local)?;
                    if let Some(old) = replacing.get(book_id) {
                        let _ = fs::remove_file(old);
                    }
                    library.cover_stale(book_id, false)?;
                }
                None if path.starts_with("pictures/avatar-") => library.tidy_avatars()?,
                None => {}
            }
            report.files_received += 1;
        }
    }

    send(lock, tell, remote, lane, report, books)
}

type Upload = (String, PathBuf, String, u64);

/// A book for the phone to copy from one sync place to the other.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Relay {
    pub book_id: String,
    /// Its file's path in both places.
    pub path: String,
    /// False when the book is there already and only its cover is missing.
    pub send_book: bool,
    /// Its cover: path in the cloud, and file here.
    pub cover: Option<(String, PathBuf)>,
}

/// Phone-sized copies of covers, for places where room is short.
const SMALL_COVERS: &str = "small";
/// About 25 KB a cover: a phone shows them a few centimetres tall.
const SMALL_COVER_HEIGHT: u32 = 400;

/// A phone-sized JPEG of a cover, made once and kept in `dir`. The cover
/// itself if it can't be read as a picture.
fn small_cover(cover: &Path, dir: &Path) -> PathBuf {
    let Some(stem) = cover.file_stem() else { return cover.to_path_buf() };
    let out = dir.join(stem).with_extension("jpg");
    let modified = |p: &Path| fs::metadata(p).and_then(|m| m.modified()).ok();
    if out.exists() && modified(&out) >= modified(cover) {
        return out;
    }
    let made = (|| -> Option<()> {
        let image = image::open(cover).ok()?;
        let image = if image.height() > SMALL_COVER_HEIGHT { image.resize(SMALL_COVER_HEIGHT, SMALL_COVER_HEIGHT, image::imageops::FilterType::Triangle) } else { image };
        fs::create_dir_all(dir).ok()?;
        let mut bytes = Vec::new();
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut bytes, 78).encode_image(&image.to_rgb8()).ok()?;
        // Only worth it if it came out smaller.
        if bytes.len() as u64 >= fs::metadata(cover).ok()?.len() {
            return None;
        }
        fs::write(&out, bytes).ok()
    })();
    if made.is_some() {
        out
    } else {
        cover.to_path_buf()
    }
}

/// Uploads files in turn, telling the page about each.
fn send(
    lock: Lock,
    tell: Tell,
    remote: &mut dyn Remote,
    lane: Lane,
    report: &mut SyncReport,
    to_send: Vec<Upload>,
) -> Result<()> {
    let file = |direction: Direction, path: &str, what: &str, bytes: u64, done: bool, problem: Option<String>| {
        tell(SyncEvent::File { lane, direction, path: path.to_string(), what: what.to_string(), bytes, done, problem });
    };
    if !to_send.is_empty() {
        let bytes = to_send.iter().map(|(_, _, _, b)| b).sum();
        tell(SyncEvent::FilesPlanned { lane, direction: Direction::Up, count: to_send.len() as u32, bytes });
    }
    // Where room and downloads are short (Supabase), covers go phone-sized.
    let small_covers = remote.covers_follow_files().then(|| lock().map(|l| l.paths.covers_dir.join(SMALL_COVERS))).transpose()?;
    for (path, local, what, bytes) in to_send {
        if winding_down() {
            break;
        }
        file(Direction::Up, &path, &what, bytes, false, None);
        let local = match &small_covers {
            Some(dir) if path.starts_with("covers/") => small_cover(&local, dir),
            _ => local,
        };
        match remote.upload(&path, &local) {
            Ok(()) => {
                lock()?.lane_file_sent(&path, None, lane)?;
                report.files_sent += 1;
                file(Direction::Up, &path, &what, bytes, true, None);
            }
            Err(Error::Rejected(why)) => {
                lock()?.lane_file_sent(&path, Some(&why), lane)?;
                report.skipped_files.push(format!("{}: {why}", local.file_name().unwrap_or_default().to_string_lossy()));
                file(Direction::Up, &path, &what, bytes, true, Some(why));
            }
            Err(e) => {
                file(Direction::Up, &path, &what, bytes, true, Some(e.to_string()));
                return Err(e);
            }
        }
    }

    Ok(())
}

/// Downloads to a temporary name first, so a cut-off download never looks finished.
fn fetch(remote: &mut dyn Remote, path: &str, to: &Path) -> Result<bool> {
    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent)?;
    }
    let partial = to.with_extension("partial");
    let got = remote.download(path, &partial);
    match got {
        Ok(true) => {
            fs::rename(&partial, to)?;
            Ok(true)
        }
        other => {
            let _ = fs::remove_file(&partial);
            other
        }
    }
}

/// Fetches a book's file from the cloud and adds it to this device.
pub fn download_book(library: &Mutex<Library>, remote: &mut dyn Remote, book_id: &str) -> Result<()> {
    if download_book_from(library, remote, book_id, Lane::Main)? {
        Ok(())
    } else {
        Err(not_in_cloud())
    }
}

/// The answer when no place has a book's file.
pub fn not_in_cloud() -> Error {
    Error::Unsuitable("This book's file isn't in the cloud. Turn on Sync book files on the device that has it.".into())
}

/// As `download_book`, from either place. False if that place hasn't got the file.
pub fn download_book_from(library: &Mutex<Library>, remote: &mut dyn Remote, book_id: &str, lane: Lane) -> Result<bool> {
    let lock = || library.lock().map_err(|_| Error::Unsuitable("the library is unavailable".into()));
    let (path, target) = {
        let library = lock()?;
        let path = library
            .cloud_book_path(book_id)?
            .ok_or_else(|| Error::Unsuitable("that book isn't in your library any more".into()))?;
        (path, library.download_target(book_id))
    };
    if !fetch(remote, &path, &target)? {
        return Ok(false);
    }
    let format = path.rsplit('.').next().unwrap_or("epub").to_string();
    let result = lock()?.adopt_download(book_id, &target, &format);
    let _ = fs::remove_file(&target);
    result?;
    // The cloud has it, so this copy can be removed again later, and it isn't sent back up.
    lock()?.lane_file_sent(&path, None, lane)?;
    Ok(true)
}

#[cfg(test)]
mod tests;

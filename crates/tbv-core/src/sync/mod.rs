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

pub mod files;
pub mod supabase;
pub mod webdav;

use std::collections::HashSet;
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
        name: "book_progress",
        table: "books",
        keys: &["id"],
        cols: &["status", "total_progression", "resume_locator", "last_opened_at", "finished_at"],
        category: Category::Progress,
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
        name: "collection",
        table: "collections",
        keys: &["id"],
        cols: &[
            "name", "created_at", "deleted_at", "description", "kind", "badge", "picture", "pinned", "position", "updated_at",
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
        name: "annotation",
        table: "annotations",
        keys: &["id"],
        cols: &["book_id", "kind", "excerpt", "note", "locator", "color", "created_at", "updated_at", "deleted_at"],
        category: Category::Notes,
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
    pub frequency: Frequency,
    pub on_startup: bool,
    pub on_close: bool,
    pub conflicts: ConflictRule,
}

impl Default for SyncOptions {
    fn default() -> Self {
        Self {
            progress: true,
            notes: true,
            collections: true,
            metadata: true,
            book_files: false,
            frequency: Frequency::Automatic,
            on_startup: true,
            on_close: true,
            conflicts: ConflictRule::Recent,
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
    fn same_place(&self, other: &Provider) -> bool {
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
    Supabase(supabase::Supabase),
    Files(files::FileRemote<Box<dyn files::Store + Send>>),
}

impl Cloud {
    fn remote(&mut self) -> &mut dyn Remote {
        match self {
            Cloud::Supabase(s) => s,
            Cloud::Files(f) => f,
        }
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

/// Where records and files are kept in the cloud.
pub trait Remote {
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
}

const PAGE: usize = 500;
const BATCH: usize = 200;
/// A file that wouldn't upload is tried again after this long.
const RETRY_FILE_HOURS: i64 = 24;

const DEVICE_ID: &str = "sync.device_id";
const CURSOR: &str = "sync.cursor";
const LAST_SUCCESS: &str = "sync.last_success_at";
const LAST_ERROR: &str = "sync.last_error";
const SESSION: &str = "sync.session";
const PROJECT: &str = "sync.supabase";
pub(crate) const PROVIDER: &str = "sync.provider";
const APP_SETTINGS: &str = "app.settings";

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
        self.put_setting(PROVIDER, Some(&serde_json::to_string(provider)?))
    }

    /// A connection to the chosen service, if it's ready to use.
    pub fn connect(&self) -> Result<Option<Cloud>> {
        let provider = self.sync_provider()?;
        match provider {
            Provider::Supabase => {
                let (Some(project), Some(session)) = (self.supabase_project()?, self.sync_session()?) else { return Ok(None) };
                Ok(Some(Cloud::Supabase(supabase::Supabase::new(project, session, self.device_id()?))))
            }
            Provider::Off => Ok(None),
            _ => Ok(Some(Cloud::Files(open_files(&provider, self.device_id()?)?.0))),
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
        let mut waiting: i64 = 0;
        for kind in KINDS.iter().filter(|k| options.includes(k.category)) {
            waiting += self.conn.query_row(
                "SELECT COUNT(*) FROM sync_clock c WHERE c.kind = ?1 AND c.pushed = 0
                   AND NOT EXISTS (SELECT 1 FROM sync_conflicts x WHERE x.kind = c.kind AND x.key = c.key)",
                params![kind.name],
                |r| r.get::<_, i64>(0),
            )?;
        }
        Ok(SyncOverview {
            status: self.sync_status()?,
            provider: self.sync_provider()?.view(),
            project: self.supabase_project()?,
            signed_in_as: self.sync_session()?.map(|s| s.email),
            last_error: self.setting(LAST_ERROR)?.map(|e| e.trim_start_matches(OFFLINE_PREFIX).to_string()),
            waiting_to_send: waiting.max(0) as u32,
            conflicts: self.sync_conflicts()?,
        })
    }

    fn record_result(&self, outcome: &Result<SyncReport>) -> Result<()> {
        match outcome {
            Ok(_) => {
                self.put_setting(LAST_SUCCESS, Some(&now_utc()))?;
                self.put_setting(LAST_ERROR, None)
            }
            Err(error) => self.note_sync_failure(error),
        }
    }

    /// Remembers why sync couldn't run, for Settings and the header circle.
    pub fn note_sync_failure(&self, error: &Error) -> Result<()> {
        match error {
            Error::Offline(why) => self.put_setting(LAST_ERROR, Some(&format!("{OFFLINE_PREFIX}{why}"))),
            error => self.put_setting(LAST_ERROR, Some(&error.to_string())),
        }
    }

    /// Forgets everything sync knew about the cloud, after signing out or
    /// switching project. This device's changes are all sent again next time.
    pub fn reset_sync(&mut self) -> Result<()> {
        self.sync_epoch += 1;
        self.conn.execute_batch(
            "UPDATE sync_clock SET pushed = 0;
             DELETE FROM sync_waiting; DELETE FROM sync_conflicts; DELETE FROM sync_files;",
        )?;
        for key in [CURSOR, LAST_SUCCESS, LAST_ERROR] {
            self.put_setting(key, None)?;
        }
        Ok(())
    }

    fn cursor(&self, options: &SyncOptions) -> Result<String> {
        let saved: Cursor = self.setting(CURSOR)?.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
        if saved.scope != options.scope() {
            return Ok(String::new());
        }
        Ok(saved.at.unwrap_or_else(|| if saved.seq > 0 { saved.seq.to_string() } else { String::new() }))
    }

    fn save_cursor(&self, options: &SyncOptions, at: &str) -> Result<()> {
        let json = serde_json::to_string(&Cursor { scope: options.scope(), at: Some(at.to_string()), seq: 0 })?;
        self.put_setting(CURSOR, Some(&json))
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
        let mut out = Vec::new();
        for kind in KINDS.iter().filter(|k| options.includes(k.category)) {
            let mut statement = self.conn.prepare(
                "SELECT c.key, c.changed_at FROM sync_clock c
                 WHERE c.kind = ?1 AND c.pushed = 0
                   AND NOT EXISTS (SELECT 1 FROM sync_conflicts x WHERE x.kind = c.kind AND x.key = c.key)
                 ORDER BY c.changed_at LIMIT ?2",
            )?;
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
        let tx = self.conn.unchecked_transaction()?;
        for r in records {
            tx.execute(
                "UPDATE sync_clock SET pushed = 1 WHERE kind = ?1 AND key = ?2 AND changed_at = ?3",
                params![r.kind, r.key, r.changed_at],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    /// Merges records from other devices. Returns how many changed something
    /// here and how many need the user to choose.
    pub fn sync_apply(&self, records: &[Record], options: &SyncOptions) -> Result<(u32, u32)> {
        let _quiet = Quiet::new(self);
        let tx = self.conn.unchecked_transaction()?;
        let mut applied = 0;
        let mut conflicts = 0;
        for record in records {
            match self.merge(record, options)? {
                Merge::Applied => applied += 1,
                Merge::Conflict => conflicts += 1,
                Merge::Kept => {}
            }
        }
        applied += self.retry_waiting(options)?;
        tx.commit()?;
        Ok((applied, conflicts))
    }

    fn merge(&self, record: &Record, options: &SyncOptions) -> Result<Merge> {
        let Some(kind) = kind_named(&record.kind) else {
            return Ok(Merge::Kept); // From a newer TBV.
        };
        if !options.includes(kind.category) {
            return Ok(Merge::Kept);
        }
        let local: Option<(String, bool)> = self
            .conn
            .query_row(
                "SELECT changed_at, pushed FROM sync_clock WHERE kind = ?1 AND key = ?2",
                params![record.kind, record.key],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        let take = match local {
            None => true,
            Some((at, _)) if at == record.changed_at => false, // Already the same change.
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
                            "INSERT OR REPLACE INTO sync_conflicts (kind, key, remote, found_at) VALUES (?1, ?2, ?3, ?4)",
                            params![record.kind, record.key, serde_json::to_string(record)?, now_utc()],
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
            self.stamp(record, record.changed_at.clone(), true)?;
            self.conn.execute("DELETE FROM sync_conflicts WHERE kind = ?1 AND key = ?2", params![record.kind, record.key])?;
            self.conn.execute("DELETE FROM sync_waiting WHERE kind = ?1 AND key = ?2", params![record.kind, record.key])?;
            Ok(Merge::Applied)
        } else {
            self.conn.execute(
                "INSERT OR REPLACE INTO sync_waiting (kind, key, record) VALUES (?1, ?2, ?3)",
                params![record.kind, record.key, serde_json::to_string(record)?],
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
                .prepare("SELECT record FROM sync_waiting")?
                .query_map([], |r| r.get::<_, String>(0))?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            let mut progress = false;
            for json in waiting {
                let Ok(record) = serde_json::from_str::<Record>(&json) else { continue };
                self.conn.execute("DELETE FROM sync_waiting WHERE kind = ?1 AND key = ?2", params![record.kind, record.key])?;
                if let Merge::Applied = self.merge(&record, options)? {
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
        let remote: Option<String> = self
            .conn
            .query_row("SELECT remote FROM sync_conflicts WHERE kind = ?1 AND key = ?2", params![kind, key], |r| r.get(0))
            .optional()?;
        let Some(remote) = remote.and_then(|r| serde_json::from_str::<Record>(&r).ok()) else {
            return Ok(());
        };
        self.conn.execute("DELETE FROM sync_conflicts WHERE kind = ?1 AND key = ?2", params![kind, key])?;
        if keep_cloud {
            let options = SyncOptions { conflicts: ConflictRule::Cloud, ..self.sync_options()? };
            self.sync_apply(&[remote], &options)?;
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
            "override" => format!("A corrected detail{}", book(key.first())?),
            "collection" => format!("The collection {}", field("name").unwrap_or_default()),
            "collection_book" => format!("A book's place in a collection{}", book(key.get(1))?),
            "annotation" => format!("A note or highlight{}", book(data.and_then(|d| d.get("book_id")))?),
            _ => format!("The note {}", field("title").filter(|t| !t.is_empty()).unwrap_or_else(|| "without a title".into())),
        })
    }

    /// Books this device has that the cloud doesn't, as (cloud path, file).
    fn files_to_send(&self, options: &SyncOptions) -> Result<Vec<(String, PathBuf)>> {
        let retry_after = (Utc::now() - Duration::hours(RETRY_FILE_HOURS)).to_rfc3339_opts(SecondsFormat::Millis, true);
        let mut wanted = Vec::new();
        let rows = self
            .conn
            .prepare(
                "SELECT b.id, b.format, lf.path, lf.cover_path FROM books b JOIN local_files lf ON lf.book_id = b.id
                 WHERE b.deleted_at IS NULL",
            )?
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, Option<String>>(2)?, r.get::<_, Option<String>>(3)?)))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        for (id, format, path, cover) in rows {
            let hex = book_id_hex(&id);
            if let Some(cover) = cover {
                let extension = Path::new(&cover).extension().map(|e| e.to_string_lossy().to_string()).unwrap_or_default();
                wanted.push((format!("covers/{hex}.{extension}"), PathBuf::from(cover)));
            }
            if options.book_files {
                if let Some(path) = path {
                    wanted.push((format!("books/{hex}.{format}"), PathBuf::from(path)));
                }
            }
        }
        if options.collections {
            let pictures = self
                .conn
                .prepare("SELECT DISTINCT picture FROM collections WHERE deleted_at IS NULL AND picture LIKE 'picture:%'")?
                .query_map([], |r| r.get::<_, String>(0))?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            for picture in pictures {
                let name = picture.trim_start_matches("picture:");
                wanted.push((format!("pictures/{name}"), self.paths.pictures_dir.join(name)));
            }
        }
        let mut out = Vec::new();
        for (remote, file) in wanted {
            let done: Option<(Option<String>, Option<String>)> = self
                .conn
                .query_row("SELECT uploaded_at, failed_at FROM sync_files WHERE path = ?1", params![remote], |r| Ok((r.get(0)?, r.get(1)?)))
                .optional()?;
            let due = match done {
                None => true,
                Some((Some(_), _)) => false,
                Some((None, failed)) => failed.is_none_or(|f| f < retry_after),
            };
            if due && file.exists() {
                out.push((remote, file));
            }
        }
        Ok(out)
    }

    fn file_sent(&self, remote: &str, error: Option<&str>) -> Result<()> {
        let now = now_utc();
        self.conn.execute(
            "INSERT OR REPLACE INTO sync_files (path, uploaded_at, failed_at, error) VALUES (?1, ?2, ?3, ?4)",
            params![remote, error.is_none().then(|| now.clone()), error.map(|_| now.clone()), error],
        )?;
        Ok(())
    }

    /// Collection pictures named in records that aren't on this device yet.
    fn pictures_to_fetch(&self) -> Result<Vec<(String, PathBuf)>> {
        let pictures = self
            .conn
            .prepare("SELECT DISTINCT picture FROM collections WHERE deleted_at IS NULL AND picture LIKE 'picture:%'")?
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

    /// Where a book's file is kept in the cloud, if this device knows the book.
    pub fn cloud_book_path(&self, book_id: &str) -> Result<Option<String>> {
        let format: Option<String> = self
            .conn
            .query_row("SELECT format FROM books WHERE id = ?1 AND deleted_at IS NULL", params![book_id], |r| r.get(0))
            .optional()?;
        Ok(format.map(|f| format!("books/{}.{f}", book_id_hex(book_id))))
    }

    /// A temporary file in the library folder to download into.
    pub fn download_target(&self, book_id: &str) -> PathBuf {
        self.paths.books_dir.join(format!(".{}.download", book_id_hex(book_id)))
    }

    /// Adopts a book file fetched from the cloud, then removes the download.
    pub fn adopt_download(&mut self, book_id: &str, download: &Path, format: &str) -> Result<()> {
        let named = download.with_extension(format);
        fs::rename(download, &named)?;
        let result = self.import_files(std::slice::from_ref(&named));
        let _ = fs::remove_file(&named);
        match result.into_iter().next() {
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
        "book" => short(text("title")),
        "override" => short(text("value")),
        "collection" => short(text("name")),
        "collection_book" => "In the collection".into(),
        "annotation" => short(if text("note").is_empty() { text("excerpt") } else { text("note") }),
        _ => short(text("body")),
    }
}

const OFFLINE_PREFIX: &str = "offline: ";

/// One sync run: pull, merge, push, then files. The library is locked only
/// while reading or writing it, never while waiting on the network.
pub fn sync_once(library: &Mutex<Library>, remote: &mut dyn Remote) -> Result<SyncReport> {
    let epoch = library.lock().map_err(|_| Error::Unsuitable("the library is unavailable".into()))?.sync_epoch;
    sync_once_since(library, remote, epoch)
}

/// As `sync_once`, for a remote opened when sync was at `epoch` (see
/// `Library::sync_epoch`). If sync has started over since, nothing is written.
pub fn sync_once_since(library: &Mutex<Library>, remote: &mut dyn Remote, epoch: u64) -> Result<SyncReport> {
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
    let outcome = run(&lock, remote);
    match (&outcome, lock()) {
        (Err(Error::Superseded), _) | (_, Err(Error::Superseded)) => Ok(SyncReport::default()),
        (_, Err(e)) => Err(e),
        (_, Ok(library)) => {
            library.record_result(&outcome)?;
            outcome
        }
    }
}

fn run<'a>(lock: &dyn Fn() -> Result<std::sync::MutexGuard<'a, Library>>, remote: &mut dyn Remote) -> Result<SyncReport> {
    let mut report = SyncReport::default();
    let (options, mut cursor) = {
        let library = lock()?;
        let options = library.sync_options()?;
        let cursor = library.cursor(&options)?;
        (options, cursor)
    };

    loop {
        let Page { records, cursor: next } = remote.pull(&cursor, PAGE)?;
        if records.is_empty() {
            break;
        }
        let library = lock()?;
        let (applied, conflicts) = library.sync_apply(&records, &options)?;
        report.received += applied;
        report.new_conflicts += conflicts;
        cursor = next;
        library.save_cursor(&options, &cursor)?;
        if records.len() < PAGE {
            break;
        }
    }

    let mut seen = HashSet::new();
    loop {
        let batch = lock()?.sync_outbox(&options, BATCH)?;
        // Anything changed again mid-send comes back; send it once more, not forever.
        let fresh: Vec<Record> = batch.into_iter().filter(|r| seen.insert((r.kind.clone(), r.key.clone(), r.changed_at.clone()))).collect();
        if fresh.is_empty() {
            break;
        }
        remote.push(&fresh)?;
        lock()?.sync_mark_sent(&fresh)?;
        report.sent += fresh.len() as u32;
    }

    let to_send = lock()?.files_to_send(&options)?;
    for (path, file) in to_send {
        match remote.upload(&path, &file) {
            Ok(()) => {
                lock()?.file_sent(&path, None)?;
                report.files_sent += 1;
            }
            Err(Error::Rejected(why)) => {
                lock()?.file_sent(&path, Some(&why))?;
                report.skipped_files.push(format!("{}: {why}", file.file_name().unwrap_or_default().to_string_lossy()));
            }
            Err(e) => return Err(e),
        }
    }

    if options.collections {
        let wanted = lock()?.pictures_to_fetch()?;
        for (path, file) in wanted {
            if fetch(remote, &path, &file)? {
                report.files_received += 1;
            }
        }
    }

    let (bare, covers_dir) = {
        let library = lock()?;
        (library.books_without_covers()?, library.paths.covers_dir.clone())
    };
    if !bare.is_empty() {
        let in_cloud = remote.list("covers/")?;
        for (hex, book_id) in bare {
            let Some(name) = in_cloud.iter().find(|n| Path::new(n).file_stem().is_some_and(|s| s == hex.as_str())) else { continue };
            let file = covers_dir.join(name);
            if fetch(remote, &format!("covers/{name}"), &file)? {
                lock()?.set_cover(&book_id, &file)?;
                report.files_received += 1;
            }
        }
    }
    Ok(report)
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
    let lock = || library.lock().map_err(|_| Error::Unsuitable("the library is unavailable".into()));
    let (path, target) = {
        let library = lock()?;
        let path = library
            .cloud_book_path(book_id)?
            .ok_or_else(|| Error::Unsuitable("that book isn't in your library any more".into()))?;
        (path, library.download_target(book_id))
    };
    if !fetch(remote, &path, &target)? {
        return Err(Error::Unsuitable(
            "This book's file isn't in the cloud. Turn on Sync book files on the device that has it.".into(),
        ));
    }
    let format = path.rsplit('.').next().unwrap_or("epub").to_string();
    let result = lock()?.adopt_download(book_id, &target, &format);
    let _ = fs::remove_file(&target);
    result
}

#[cfg(test)]
mod tests;

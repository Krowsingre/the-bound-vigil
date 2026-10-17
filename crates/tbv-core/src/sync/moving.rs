//! Moving a library to another cloud service, or keeping a copy there.
//!
//! What should be in the new place is worked out first: every record this
//! device knows, and any the old place has that it doesn't, with covers,
//! collection pictures and book files. A file on this device is sent from
//! here; one that's only in the cloud is fetched from the old place to a
//! temporary file on the way. What's already there from an earlier try is
//! skipped, so running it again only copies what's missing. Then the new
//! place is read back to check nothing was missed. A migration only switches
//! sync over once that check passes.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use rusqlite::params;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::{fetch, kind_named, Page, APP_SETTINGS, Provider, Record, Remote, Session, SupabaseProject, SyncOptions, BATCH, KINDS, PAGE, PROJECT, PROVIDER};
use crate::error::{Error, Result};
use crate::ids::{book_id_for_file, book_id_hex};
use crate::library::{Library, SUPPORTED_FORMATS};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MoveMode {
    /// Copy everything, then sync through the new place instead.
    Migrate,
    /// Copy everything, and keep syncing where it is now.
    Backup,
}

/// Which books go: all of them, or only those to read, or to listen to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MoveScope {
    #[default]
    All,
    /// Books and documents.
    Text,
    /// Audiobooks.
    Audio,
}

pub use crate::audio::is_audio;

/// Whether this TBV can hold audiobooks.
pub fn audio_ready() -> bool {
    SUPPORTED_FORMATS.iter().any(|f| is_audio(f))
}

impl MoveScope {
    /// Whether a book of this format goes. A book TBV can't place counts as
    /// one to read, since that's all there is so far.
    pub fn includes(self, format: Option<&str>) -> bool {
        match self {
            MoveScope::All => true,
            MoveScope::Text => !format.is_some_and(is_audio),
            MoveScope::Audio => format.is_some_and(is_audio),
        }
    }
}

/// Where the library is going.
#[derive(Debug, Clone)]
pub enum Destination {
    /// A Supabase project, already signed in to.
    Supabase { project: SupabaseProject, session: Session },
    /// A folder or a WebDAV server.
    Files(Provider),
}

impl Destination {
    /// Whether the library already syncs there.
    pub fn is_current(&self, library: &Library) -> Result<bool> {
        let current = library.sync_provider()?;
        Ok(match self {
            Destination::Supabase { project, session } => {
                current == Provider::Supabase
                    && library.supabase_project()?.is_some_and(|p| p.url == project.url)
                    && library.sync_session()?.is_some_and(|s| s.user_id == session.user_id)
            }
            Destination::Files(provider) => current.same_place(provider),
        })
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum MoveStage {
    /// Finding out what's here, in the old place and in the new.
    #[default]
    Looking,
    Records,
    Files,
    /// Reading the new place back.
    Checking,
}

/// How far a move has got.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveProgress {
    pub stage: MoveStage,
    /// Records and files copied so far, of `total`.
    pub done: u32,
    pub total: u32,
}

/// The check at the end: is everything that should be there, there?
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveCheck {
    pub records: u32,
    pub records_found: u32,
    pub files: u32,
    pub files_found: u32,
    /// What isn't there, in words ("The book file of Dracula").
    pub missing: Vec<String>,
    /// How many more are missing than `missing` names.
    pub more_missing: u32,
    /// Things that didn't go but weren't in the old place either (a file too
    /// big for the new service, say). They don't fail the check.
    pub notes: Vec<String>,
    /// What was found, so a migration can count it as sent: (kind, key, changed_at).
    #[serde(skip)]
    pub found_records: Vec<(String, String, String)>,
    #[serde(skip)]
    pub found_files: Vec<String>,
}

impl MoveCheck {
    pub fn passed(&self) -> bool {
        self.missing.is_empty() && self.more_missing == 0
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveReport {
    pub records_copied: u32,
    pub files_copied: u32,
    /// Records and files already there from an earlier try.
    pub already_there: u32,
    pub cancelled: bool,
    /// Missing when cancelled.
    pub check: Option<MoveCheck>,
}

/// One move or backup run.
pub struct MoveRun<'a> {
    pub scope: MoveScope,
    /// Where the library syncs now, if it's reachable.
    pub from: Option<&'a mut dyn Remote>,
    pub to: &'a mut dyn Remote,
    /// Reads the new place back. A folder skips a device's own changes when
    /// that device reads it, so it's read as a new device would; `None`
    /// reads through `to`.
    pub check: Option<&'a mut dyn Remote>,
    pub cancel: &'a AtomicBool,
    pub progress: &'a mut dyn FnMut(&MoveProgress),
}

/// A book as far as moving needs to know.
struct BookInfo {
    format: String,
    title: String,
    deleted: bool,
}

/// A file that should be in the new place.
struct Wanted {
    /// On this device.
    local: Option<PathBuf>,
    in_old: bool,
    size: Option<u64>,
}

const FOLDERS: [&str; 3] = ["books/", "covers/", "pictures/"];
/// How many missing things the check names; the rest are counted.
const NAMED: usize = 50;

impl Library {
    /// One page of every record this device keeps, in the order they were
    /// first stamped, and where the next page starts.
    fn clock_page(&self, options: &SyncOptions, after: i64, limit: usize) -> Result<(Vec<Record>, Option<i64>)> {
        let rows = self
            .conn
            .prepare("SELECT rowid, kind, key, changed_at FROM sync_clock WHERE rowid > ?1 ORDER BY rowid LIMIT ?2")?
            .query_map(params![after, limit as i64], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?)))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let last = rows.last().map(|r| r.0);
        let mut out = Vec::new();
        for (_, kind_name, key, changed_at) in rows {
            let Some(kind) = kind_named(&kind_name).filter(|k| options.includes(k.category)) else { continue };
            let data = self.snapshot(kind, &key)?;
            out.push(Record { kind: kind_name, key, data, changed_at });
        }
        Ok((out, last))
    }

    fn move_books(&self) -> Result<HashMap<String, BookInfo>> {
        let rows = self
            .conn
            .prepare("SELECT id, format, title, deleted_at IS NOT NULL FROM books")?
            .query_map([], |r| Ok((r.get::<_, String>(0)?, BookInfo { format: r.get(1)?, title: r.get(2)?, deleted: r.get(3)? })))?
            .collect::<rusqlite::Result<HashMap<_, _>>>()?;
        Ok(rows)
    }

    /// Syncs through the new place from now on. What the check found there
    /// counts as sent, so nothing is sent twice.
    /// A move of only some books turns off sending the other kind's files, so
    /// the first sync there doesn't send them anyway.
    pub fn adopt_move(&mut self, to: &Destination, check: &MoveCheck, scope: MoveScope) -> Result<()> {
        let left_out = match scope {
            MoveScope::All => None,
            MoveScope::Text => Some("audioFiles"),
            MoveScope::Audio => Some("bookFiles"),
        };
        if let Some(switch) = left_out {
            let mut app: Value = self.setting(APP_SETTINGS)?.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_else(|| serde_json::json!({}));
            if !app.is_object() {
                app = serde_json::json!({});
            }
            let sync = app.as_object_mut().expect("an object").entry("sync").or_insert_with(|| serde_json::json!({}));
            if let Some(sync) = sync.as_object_mut() {
                sync.insert(switch.into(), Value::Bool(false));
            }
            self.put_setting(APP_SETTINGS, Some(&app.to_string()))?;
        }
        match to {
            Destination::Supabase { project, session } => {
                self.put_setting(PROJECT, Some(&serde_json::to_string(project)?))?;
                self.set_sync_session(Some(session))?;
                self.put_setting(PROVIDER, Some(&serde_json::to_string(&Provider::Supabase)?))?;
            }
            Destination::Files(provider) => self.put_setting(PROVIDER, Some(&serde_json::to_string(provider)?))?,
        }
        self.reset_sync()?;
        let now = self.sync_provider()?;
        self.drop_also_if_same(&now)?;
        let tx = self.conn.unchecked_transaction()?;
        for (kind, key, at) in &check.found_records {
            tx.execute("UPDATE sync_clock SET pushed = 1 WHERE kind = ?1 AND key = ?2 AND changed_at <= ?3", params![kind, key, at])?;
        }
        tx.commit()?;
        for path in &check.found_files {
            self.file_sent(path, None)?;
        }
        Ok(())
    }
}

/// The book a record belongs to, if it belongs to one.
fn book_of(record: &Record) -> Option<String> {
    let key: Vec<Value> = serde_json::from_str(&record.key).unwrap_or_default();
    let id = match record.kind.as_str() {
        "collection" | "personal_note" => return None,
        "annotation" => return record.data.as_ref()?.get("book_id")?.as_str().map(str::to_string),
        "collection_book" => key.get(1),
        _ => key.first(),
    };
    id?.as_str().map(str::to_string)
}

/// Every record in a place, newest change of each.
fn read_all(remote: &mut dyn Remote) -> Result<HashMap<(String, String), Record>> {
    let mut all: HashMap<(String, String), Record> = HashMap::new();
    let mut cursor = String::new();
    loop {
        let Page { records, cursor: next } = remote.pull(&cursor, PAGE)?;
        if records.is_empty() {
            return Ok(all);
        }
        for record in records {
            let id = (record.kind.clone(), record.key.clone());
            if all.get(&id).is_none_or(|had| had.changed_at < record.changed_at) {
                all.insert(id, record);
            }
        }
        if next == cursor {
            return Ok(all);
        }
        cursor = next;
    }
}

/// Every file in a place, by its path, with its size where known.
fn files_in(remote: &mut dyn Remote) -> Result<HashMap<String, Option<u64>>> {
    let mut out = HashMap::new();
    for folder in FOLDERS {
        for (name, size) in remote.list_sizes(folder)? {
            if !name.starts_with('.') && !name.ends_with('/') {
                out.insert(format!("{folder}{name}"), size);
            }
        }
    }
    Ok(out)
}

/// Brings a file down from the old place and sends it to the new. Book
/// files are named by their contents' hash, so a damaged copy is caught.
pub(super) fn carry(from: &mut dyn Remote, to: &mut dyn Remote, path: &str, temp: &Path) -> Result<Option<u64>> {
    let name = path.rsplit('/').next().unwrap_or("file").to_string();
    let file = temp.join(&name);
    let outcome = (|| {
        if !fetch(from, path, &file)? {
            return Err(Error::Unsuitable("it isn't in the old place any more".into()));
        }
        if path.starts_with("books/") {
            let stem = Path::new(&name).file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
            if book_id_hex(&book_id_for_file(&file)?) != stem {
                return Err(Error::Unsuitable("the copy in the old place is damaged".into()));
            }
        }
        to.upload(path, &file)?;
        Ok(fs::metadata(&file).ok().map(|m| m.len()))
    })();
    let _ = fs::remove_file(&file);
    outcome
}

/// Copies the library to `run.to` and checks it all arrived. The library is
/// only locked while it's read, never while waiting on either place.
pub fn copy_library(library: &Mutex<Library>, run: MoveRun<'_>) -> Result<MoveReport> {
    let MoveRun { scope, mut from, to, mut check, cancel, progress } = run;
    let lock = || library.lock().map_err(|_| Error::Unsuitable("the library is unavailable".into()));
    let mut state = MoveProgress::default();
    progress(&state);
    let mut report = MoveReport::default();

    // What this device has.
    let (options, mut books, kept, temp) = {
        let l = lock()?;
        // Everything goes, whatever this device syncs: the scope alone decides
        // which books.
        let options = SyncOptions {
            progress: true,
            notes: true,
            collections: true,
            metadata: true,
            book_files: true,
            audio_files: true,
            ..l.sync_options()?
        };
        let kept = l.files_kept(&options)?;
        (options, l.move_books()?, kept, l.paths.books_dir.join(".moving"))
    };
    let mut records: HashMap<(String, String), Record> = HashMap::new();
    let mut after = 0;
    loop {
        let (page, last) = lock()?.clock_page(&options, after, PAGE)?;
        for record in page {
            records.insert((record.kind.clone(), record.key.clone()), record);
        }
        match last {
            Some(last) => after = last,
            None => break,
        }
    }
    let mut files: HashMap<String, Wanted> = HashMap::new();
    for (path, file) in kept {
        if let Ok(meta) = fs::metadata(&file) {
            files.insert(path, Wanted { local: Some(file), in_old: false, size: Some(meta.len()) });
        }
    }

    // What the old place has that this device doesn't know yet.
    if let Some(from) = from.as_deref_mut() {
        for (id, record) in read_all(from)? {
            if !kind_named(&record.kind).is_some_and(|k| options.includes(k.category)) {
                continue;
            }
            if record.kind == "book" {
                if let (Some(data), Ok(book)) = (&record.data, serde_json::from_str::<Vec<String>>(&record.key)) {
                    let text = |c: &str| data.get(c).and_then(Value::as_str).map(str::to_string);
                    if let (Some(id), Some(format)) = (book.first(), text("format")) {
                        books.entry(id.clone()).or_insert(BookInfo {
                            format,
                            title: text("title").unwrap_or_default(),
                            deleted: data.get("deleted_at").is_some_and(|d| !d.is_null()),
                        });
                    }
                }
            }
            if records.get(&id).is_none_or(|had| had.changed_at < record.changed_at) {
                records.insert(id, record);
            }
        }
        for (path, size) in files_in(from)? {
            let wanted = files.entry(path).or_insert(Wanted { local: None, in_old: false, size });
            wanted.in_old = true;
        }
    }

    // Only the books asked for.
    let format_of = |id: &str| books.get(id).map(|b| b.format.as_str());
    records.retain(|_, r| book_of(r).is_none_or(|id| scope.includes(format_of(&id))));
    let by_hex: HashMap<&str, &BookInfo> = books.iter().map(|(id, b)| (book_id_hex(id), b)).collect();
    let book_for = |path: &str| -> Option<&BookInfo> {
        let name = path.rsplit('/').next()?;
        by_hex.get(Path::new(name).file_stem()?.to_str()?).copied()
    };
    files.retain(|path, _| {
        if path.starts_with("pictures/") {
            return true;
        }
        let book = book_for(path);
        if book.is_some_and(|b| b.deleted) {
            return false;
        }
        let format = match path.strip_prefix("books/") {
            Some(name) => name.rsplit_once('.').map(|(_, ext)| ext),
            None => book.map(|b| b.format.as_str()),
        };
        scope.includes(format)
    });

    // What the new place has already, from an earlier try.
    let (there, there_files) = {
        let reader: &mut dyn Remote = match check.as_deref_mut() {
            Some(c) => c,
            None => &mut *to,
        };
        (read_all(reader)?, files_in(reader)?)
    };
    let mut to_push: Vec<&Record> = records
        .iter()
        .filter(|(id, r)| there.get(*id).is_none_or(|t| t.changed_at < r.changed_at))
        .map(|(_, r)| r)
        .collect();
    // What a record belongs to goes first, as in sync.
    let order = |r: &Record| KINDS.iter().position(|k| k.name == r.kind).unwrap_or(KINDS.len());
    to_push.sort_by(|a, b| order(a).cmp(&order(b)).then_with(|| a.changed_at.cmp(&b.changed_at)));
    let mut to_copy: Vec<(&String, &Wanted)> = files
        .iter()
        .filter(|(path, w)| match there_files.get(*path) {
            None => true,
            Some(size) => matches!((size, w.size), (Some(a), Some(b)) if *a != b),
        })
        .collect();
    to_copy.sort_by(|a, b| a.0.cmp(b.0));
    report.already_there = (records.len() - to_push.len() + files.len() - to_copy.len()) as u32;

    state.total = (to_push.len() + to_copy.len()) as u32;
    state.stage = MoveStage::Records;
    progress(&state);
    for batch in to_push.chunks(BATCH) {
        if cancel.load(Ordering::Relaxed) {
            report.cancelled = true;
            return Ok(report);
        }
        let batch: Vec<Record> = batch.iter().map(|r| (*r).clone()).collect();
        to.push(&batch)?;
        report.records_copied += batch.len() as u32;
        state.done += batch.len() as u32;
        progress(&state);
    }

    state.stage = MoveStage::Files;
    progress(&state);
    // Why a file didn't go, by its path.
    let mut failed: HashMap<String, String> = HashMap::new();
    let mut sizes: HashMap<String, u64> = HashMap::new();
    if to_copy.iter().any(|(_, w)| w.local.is_none()) {
        fs::create_dir_all(&temp)?;
    }
    for (path, wanted) in to_copy {
        if cancel.load(Ordering::Relaxed) {
            report.cancelled = true;
            let _ = fs::remove_dir_all(&temp);
            return Ok(report);
        }
        let sent = match (&wanted.local, from.as_deref_mut()) {
            (Some(file), _) => to.upload(path, file).map(|_| None),
            (None, Some(from)) => carry(from, to, path, &temp),
            (None, None) => Err(Error::Unsuitable("the old place can't be reached".into())),
        };
        match sent {
            Ok(size) => {
                report.files_copied += 1;
                if let Some(size) = size {
                    sizes.insert(path.clone(), size);
                }
            }
            // No connection, or signed out: nothing more will go, so stop and say so.
            Err(e @ (Error::Offline(_) | Error::SignedOut)) => {
                let _ = fs::remove_dir_all(&temp);
                return Err(e);
            }
            Err(e) => {
                failed.insert(path.clone(), e.to_string());
            }
        }
        state.done += 1;
        progress(&state);
    }
    let _ = fs::remove_dir_all(&temp);

    // Read it all back.
    state.stage = MoveStage::Checking;
    progress(&state);
    let reader: &mut dyn Remote = match check {
        Some(c) => c,
        None => to,
    };
    let (there, there_files) = (read_all(reader)?, files_in(reader)?);
    let mut result = MoveCheck { records: records.len() as u32, files: files.len() as u32, ..Default::default() };
    let mut missing_records = Vec::new();
    for (id, record) in &records {
        match there.get(id) {
            Some(t) if t.changed_at >= record.changed_at => {
                result.records_found += 1;
                result.found_records.push((id.0.clone(), id.1.clone(), t.changed_at.clone()));
            }
            _ => missing_records.push(record),
        }
    }
    let what = |path: &str| -> String {
        let title = book_for(path).map(|b| b.title.clone()).filter(|t| !t.is_empty()).unwrap_or_else(|| "a book".into());
        match path.split('/').next() {
            Some("books") => format!("The book file of {title}"),
            Some("covers") => format!("The cover of {title}"),
            _ => "A collection picture".into(),
        }
    };
    let mut missing = Vec::new();
    let mut paths: Vec<&String> = files.keys().collect();
    paths.sort();
    for path in paths {
        let wanted = &files[path];
        let expected = sizes.get(path).copied().or(wanted.size);
        let found = match there_files.get(path) {
            None => false,
            Some(size) => !matches!((size, expected), (Some(a), Some(b)) if *a != b),
        };
        if found {
            result.files_found += 1;
            result.found_files.push(path.clone());
            continue;
        }
        let why = failed.get(path).map(|w| format!(" ({w})")).unwrap_or_default();
        if let (Some(_), false) = (failed.get(path), wanted.in_old) {
            // Never in the old place either, so nothing is lost by leaving it.
            result.files -= 1;
            result.notes.push(format!("{} didn't go{why}. It wasn't in the old place either.", what(path)));
        } else if there_files.contains_key(path) {
            missing.push(format!("{} is only partly there", what(path)));
        } else {
            missing.push(format!("{}{why}", what(path)));
        }
    }
    let total = missing.len() + missing_records.len();
    missing.truncate(NAMED);
    {
        let l = lock()?;
        missing_records.sort_by_key(|r| order(r));
        for record in missing_records.iter().take(NAMED - missing.len()) {
            let Some(kind) = kind_named(&record.kind) else { continue };
            missing.push(l.describe(kind, record, None)?);
        }
    }
    result.more_missing = (total - missing.len()) as u32;
    result.missing = missing;
    report.check = Some(result);
    Ok(report)
}

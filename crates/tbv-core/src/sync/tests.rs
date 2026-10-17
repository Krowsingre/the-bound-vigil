use std::collections::{BTreeMap, HashMap};
use std::sync::{Arc, Mutex};
use std::time::Duration as StdDuration;

use super::*;
use crate::epub::tests::write_test_epub;
use crate::library::tests::open_temp_library;
use crate::model::{AnnotationInput, AnnotationKind, Availability, CollectionInput, CollectionKind, ReadStatus, ReaderLocator};

/// The cloud, as a shared map. Behaves like the Supabase table: the newer
/// change wins, and every accepted change gets a fresh place in the order.
#[derive(Default)]
struct Cloud {
    records: BTreeMap<(String, String), (i64, Record)>,
    seq: i64,
    files: HashMap<String, Vec<u8>>,
    pushes: u32,
}

#[derive(Clone, Default)]
struct FakeRemote(Arc<Mutex<Cloud>>);

impl Remote for FakeRemote {
    fn push(&mut self, records: &[Record]) -> Result<()> {
        let mut cloud = self.0.lock().unwrap();
        cloud.pushes += 1;
        for r in records {
            let id = (r.kind.clone(), r.key.clone());
            if cloud.records.get(&id).is_some_and(|(_, old)| old.changed_at >= r.changed_at) {
                continue;
            }
            cloud.seq += 1;
            let seq = cloud.seq;
            cloud.records.insert(id, (seq, r.clone()));
        }
        Ok(())
    }

    fn pull(&mut self, after: &str, limit: usize) -> Result<Page> {
        let cloud = self.0.lock().unwrap();
        let from = seq_after(after);
        let mut out: Vec<_> = cloud.records.values().filter(|(s, _)| *s > from).cloned().collect();
        out.sort_by_key(|(s, _)| *s);
        out.truncate(limit);
        Ok(Page::numbered(out, after))
    }

    fn upload(&mut self, path: &str, file: &Path) -> Result<()> {
        let bytes = fs::read(file)?;
        self.0.lock().unwrap().files.insert(path.to_string(), bytes);
        Ok(())
    }

    fn download(&mut self, path: &str, to: &Path) -> Result<bool> {
        let Some(bytes) = self.0.lock().unwrap().files.get(path).cloned() else { return Ok(false) };
        fs::write(to, bytes)?;
        Ok(true)
    }

    fn list(&mut self, folder: &str) -> Result<Vec<String>> {
        let cloud = self.0.lock().unwrap();
        Ok(cloud.files.keys().filter_map(|p| p.strip_prefix(folder)).map(str::to_string).collect())
    }

    fn list_sizes(&mut self, folder: &str) -> Result<Vec<(String, Option<u64>)>> {
        let cloud = self.0.lock().unwrap();
        Ok(cloud.files.iter().filter_map(|(p, bytes)| Some((p.strip_prefix(folder)?.to_string(), Some(bytes.len() as u64)))).collect())
    }

    fn remove(&mut self, path: &str) -> Result<()> {
        self.0.lock().unwrap().files.remove(path);
        Ok(())
    }
}

struct Device {
    _dir: tempfile::TempDir,
    library: Mutex<Library>,
}

impl Device {
    fn new() -> Self {
        let (dir, library) = open_temp_library();
        Self { _dir: dir, library: Mutex::new(library) }
    }

    fn lib(&self) -> std::sync::MutexGuard<'_, Library> {
        self.library.lock().unwrap()
    }

    fn sync(&self, cloud: &FakeRemote) -> SyncReport {
        sync_once(&self.library, &mut cloud.clone()).unwrap()
    }

    fn set_options(&self, options: serde_json::Value) {
        self.lib().set_setting(APP_SETTINGS, &json!({ "sync": options }).to_string()).unwrap();
    }

    /// A book file that was never imported here, as from another device.
    fn dir_file(&self, name: &str) -> PathBuf {
        let file = self._dir.path().join(name);
        write_test_epub(&file, "Elsewhere", "Someone", true);
        file
    }

    fn import(&self, title: &str) -> String {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join(format!("{title}.epub"));
        write_test_epub(&file, title, "Someone", true);
        match self.lib().import_files(&[file]).remove(0) {
            ImportResult::Imported { book_id, .. } => book_id,
            other => panic!("{other:?}"),
        }
    }
}

use serde_json::json;

/// Timestamps are to the millisecond; make sure two changes don't share one.
fn tick() {
    std::thread::sleep(StdDuration::from_millis(3));
}

fn locator(p: f64) -> ReaderLocator {
    ReaderLocator { cfi: Some(format!("epubcfi(/6/{})", (p * 100.0) as u32)), total_progression: Some(p), ..Default::default() }
}

#[test]
fn a_second_device_receives_the_whole_library() {
    let cloud = FakeRemote::default();
    let a = Device::new();
    let b = Device::new();

    let book = a.import("Dracula");
    {
        let lib = a.lib();
        lib.set_favorite(&book, true).unwrap();
        lib.set_status(&book, ReadStatus::InProgress).unwrap();
        lib.save_position(&book, &locator(0.4)).unwrap();
        lib.save_annotation(&AnnotationInput {
            id: None,
            book_id: book.clone(),
            kind: AnnotationKind::Highlight,
            excerpt: "Listen to them".into(),
            note: Some("The children of the night".into()),
            color: Some("amber".into()),
            locator: locator(0.3),
        })
        .unwrap();
        lib.save_personal_note(None, Some("To read"), "Carmilla next").unwrap();
        let c = lib
            .create_collection(&CollectionInput {
                name: "Gothic".into(),
                description: None,
                kind: CollectionKind::Collection,
                badge: None,
                pinned: false,
                rules: None,
            })
            .unwrap();
        lib.add_to_collection(&c.id, std::slice::from_ref(&book)).unwrap();
    }

    let sent = a.sync(&cloud);
    assert!(sent.sent >= 6, "{sent:?}");
    assert_eq!(a.lib().sync_overview().unwrap().waiting_to_send, 0);
    let got = b.sync(&cloud);
    assert!(got.received >= 6, "{got:?}");

    let lib = b.lib();
    let there = lib.book(&book).unwrap().expect("the book arrived");
    assert_eq!(there.title, "Dracula");
    assert!(there.favorite);
    assert_eq!(there.status, ReadStatus::InProgress);
    assert_eq!(there.availability, Availability::Cloud, "its file stays on the first device");
    assert!(there.cover_path.is_some(), "but its cover came along");
    assert_eq!(lib.book_annotations(&book).unwrap().len(), 1);
    assert_eq!(lib.notes_page(&Default::default()).unwrap().counts.personal, 1);
    assert_eq!(lib.collections_for_book(&book).unwrap().len(), 1);
    assert_eq!(lib.sync_overview().unwrap().waiting_to_send, 0, "what arrived isn't sent back");
}

#[test]
fn changes_go_both_ways_and_nothing_echoes() {
    let cloud = FakeRemote::default();
    let a = Device::new();
    let b = Device::new();
    let book = a.import("Carmilla");
    a.sync(&cloud);
    b.sync(&cloud);

    tick();
    b.lib().save_position(&book, &locator(0.8)).unwrap();
    assert_eq!(b.sync(&cloud).sent, 1);
    a.sync(&cloud);
    assert_eq!(a.lib().book(&book).unwrap().unwrap().total_progression, Some(0.8));

    let pushes = cloud.0.lock().unwrap().pushes;
    assert_eq!(a.sync(&cloud).sent, 0);
    assert_eq!(b.sync(&cloud).sent, 0);
    assert_eq!(cloud.0.lock().unwrap().pushes, pushes, "a quiet sync sends nothing");
}

fn conflicting(rule: &str) -> (Device, Device, String) {
    let cloud = FakeRemote::default();
    let a = Device::new();
    let b = Device::new();
    let book = a.import("Lamps");
    a.sync(&cloud);
    b.set_options(json!({ "conflicts": rule }));
    b.sync(&cloud);

    // B changes first, A later; A's change reaches the cloud first.
    b.lib().save_position(&book, &locator(0.2)).unwrap();
    tick();
    a.lib().save_position(&book, &locator(0.6)).unwrap();
    a.sync(&cloud);
    b.sync(&cloud);
    a.sync(&cloud);
    (a, b, book)
}

fn progress(device: &Device, book: &str) -> Option<f64> {
    device.lib().book(book).unwrap().unwrap().total_progression
}

#[test]
fn the_most_recent_change_wins_by_default() {
    let (a, b, book) = conflicting("recent");
    assert_eq!(progress(&b, &book), Some(0.6));
    assert_eq!(progress(&a, &book), Some(0.6));
}

#[test]
fn this_devices_or_the_clouds_version_can_be_preferred() {
    let (a, b, book) = conflicting("local");
    assert_eq!(progress(&b, &book), Some(0.2), "B keeps its own");
    assert_eq!(progress(&a, &book), Some(0.2), "and it wins everywhere");

    let (_, b, book) = conflicting("cloud");
    assert_eq!(progress(&b, &book), Some(0.6));
}

#[test]
fn asking_lists_the_conflict_until_it_is_settled() {
    let cloud = FakeRemote::default();
    let a = Device::new();
    let b = Device::new();
    let book = a.import("Lamps");
    a.sync(&cloud);
    b.set_options(json!({ "conflicts": "ask" }));
    b.sync(&cloud);
    b.lib().save_position(&book, &locator(0.2)).unwrap();
    tick();
    a.lib().save_position(&book, &locator(0.6)).unwrap();
    a.sync(&cloud);

    let report = b.sync(&cloud);
    assert_eq!(report.new_conflicts, 1);
    let overview = b.lib().sync_overview().unwrap();
    assert_eq!(overview.status.state, SyncState::Attention);
    let conflict = &overview.conflicts[0];
    assert_eq!(conflict.what, "Reading progress in Lamps");
    assert!(conflict.here.contains("20%") && conflict.cloud.contains("60%"), "{conflict:?}");
    assert_eq!(progress(&b, &book), Some(0.2), "nothing changes until the user chooses");

    b.lib().resolve_sync_conflict(&conflict.kind, &conflict.key, true).unwrap();
    assert_eq!(progress(&b, &book), Some(0.6));
    assert!(b.lib().sync_conflicts().unwrap().is_empty());
}

#[test]
fn a_kind_switched_on_later_catches_up() {
    let cloud = FakeRemote::default();
    let a = Device::new();
    let b = Device::new();
    a.lib().save_personal_note(None, None, "Remember the lamps").unwrap();
    a.sync(&cloud);

    b.set_options(json!({ "notes": false }));
    b.sync(&cloud);
    assert_eq!(b.lib().notes_page(&Default::default()).unwrap().counts.personal, 0);

    b.set_options(json!({ "notes": true }));
    b.sync(&cloud);
    assert_eq!(b.lib().notes_page(&Default::default()).unwrap().counts.personal, 1);

    // A note written while notes are off isn't "waiting", but goes once they're on.
    b.set_options(json!({ "notes": false }));
    b.lib().save_personal_note(None, None, "Kept here for now").unwrap();
    assert_eq!(b.lib().sync_overview().unwrap().waiting_to_send, 0);
    b.set_options(json!({ "notes": true }));
    assert_eq!(b.lib().sync_overview().unwrap().waiting_to_send, 1);
    assert_eq!(b.sync(&cloud).sent, 1);
}

#[test]
fn records_wait_for_what_they_belong_to() {
    let a = Device::new();
    let b = Device::new();
    let book = a.import("Wren");
    a.lib()
        .save_annotation(&AnnotationInput {
            id: None,
            book_id: book.clone(),
            kind: AnnotationKind::Bookmark,
            excerpt: String::new(),
            note: None,
            color: None,
            locator: locator(0.5),
        })
        .unwrap();
    let options = SyncOptions::default();
    let outbox = a.lib().sync_outbox(&options, 100).unwrap();
    let (books, rest): (Vec<_>, Vec<_>) = outbox.into_iter().partition(|r| r.kind == "book");

    b.lib().sync_apply(&rest, &options).unwrap();
    assert!(b.lib().book_annotations(&book).unwrap().is_empty(), "no book yet");
    b.lib().sync_apply(&books, &options).unwrap();
    assert_eq!(b.lib().book_annotations(&book).unwrap().len(), 1, "the bookmark followed its book");
}

#[test]
fn removals_travel_too() {
    let cloud = FakeRemote::default();
    let a = Device::new();
    let b = Device::new();
    let book = a.import("Gone");
    a.lib()
        .conn
        .execute("INSERT INTO metadata_overrides (book_id, field, value, updated_at) VALUES (?1, 'title', 'Renamed', ?2)", params![book, now_utc()])
        .unwrap();
    a.sync(&cloud);
    b.sync(&cloud);
    let count = |d: &Device| -> i64 { d.lib().conn.query_row("SELECT COUNT(*) FROM metadata_overrides", [], |r| r.get(0)).unwrap() };
    assert_eq!(count(&b), 1);

    tick();
    a.lib().conn.execute("DELETE FROM metadata_overrides", []).unwrap();
    a.sync(&cloud);
    b.sync(&cloud);
    assert_eq!(count(&b), 0);
}

#[test]
fn book_files_travel_when_switched_on() {
    let cloud = FakeRemote::default();
    let a = Device::new();
    let b = Device::new();
    let book = a.import("Frankenstein");
    a.sync(&cloud);
    assert!(!cloud.0.lock().unwrap().files.keys().any(|p| p.starts_with("books/")), "off by default");

    a.set_options(json!({ "bookFiles": true }));
    let report = a.sync(&cloud);
    assert_eq!(report.files_sent, 1, "only the book; its cover went already");
    assert_eq!(a.sync(&cloud).files_sent, 0, "and only once");

    b.sync(&cloud);
    assert_eq!(b.lib().book(&book).unwrap().unwrap().availability, Availability::Cloud);
    download_book(&b.library, &mut cloud.clone(), &book).unwrap();
    let lib = b.lib();
    assert_eq!(lib.book(&book).unwrap().unwrap().availability, Availability::Local);
    assert!(lib.book_file(&book).is_ok());
    let leftovers: Vec<_> = fs::read_dir(&lib.paths().books_dir)
        .unwrap()
        .filter_map(|e| e.ok()?.file_name().into_string().ok())
        .filter(|n| n.starts_with('.'))
        .collect();
    assert!(leftovers.is_empty(), "{leftovers:?}");
    let downloaded = lib.book(&book).unwrap().unwrap();
    assert!(downloaded.in_cloud, "a book fetched from the cloud is known to be there");
    lib.remove_download(&book).unwrap();
    assert_eq!(lib.book(&book).unwrap().unwrap().availability, Availability::Cloud);
}

#[test]
fn a_book_missing_from_the_cloud_says_so() {
    let a = Device::new();
    let b = Device::new();
    let cloud = FakeRemote::default();
    let book = a.import("Nowhere");
    a.sync(&cloud);
    b.sync(&cloud);
    let error = download_book(&b.library, &mut cloud.clone(), &book).unwrap_err();
    assert!(error.to_string().contains("Sync book files"), "{error}");
}

#[test]
fn signing_out_and_back_in_sends_everything_again() {
    let cloud = FakeRemote::default();
    let a = Device::new();
    a.import("Again");
    a.sync(&cloud);
    a.lib().reset_sync().unwrap();
    let fresh = FakeRemote::default();
    assert!(a.sync(&fresh).sent >= 1);
    assert_eq!(fresh.0.lock().unwrap().records.len(), cloud.0.lock().unwrap().records.len());
}

/// Against a stand-in for Supabase (auth, the setup script's table and
/// function in a real Postgres, storage). Run with
/// `TBV_SUPABASE_MOCK=http://127.0.0.1:<port> cargo test -- --ignored`.
#[test]
#[ignore = "needs the Supabase stand-in server"]
fn talks_to_supabase() {
    use super::supabase::{self, Supabase};
    let url = std::env::var("TBV_SUPABASE_MOCK").expect("TBV_SUPABASE_MOCK");
    let project = SupabaseProject { url, anon_key: "sb_publishable_test".into() };
    let email = format!("reader-{}@example.com", uuid::Uuid::now_v7());
    assert_eq!(supabase::sign_up(&project, &email, "a long password").unwrap(), None, "asks to confirm the email");
    let wrong = supabase::sign_in(&project, &email, "nope").unwrap_err();
    assert!(wrong.to_string().contains("don't match"), "{wrong}");

    let a = Device::new();
    let b = Device::new();
    a.set_options(json!({ "bookFiles": true }));
    let book = a.import("Dracula");
    a.lib().save_personal_note(None, Some("Plan"), "Carmilla next").unwrap();

    let mut to_a = Supabase::new(project.clone(), supabase::sign_in(&project, &email, "a long password").unwrap(), "a".into());
    let sent = sync_once(&a.library, &mut to_a).unwrap();
    assert!(sent.sent >= 2 && sent.files_sent == 2, "{sent:?}");
    assert!(to_a.renewed(), "the stand-in expires the first sign-in; it was renewed");

    let mut to_b = Supabase::new(project.clone(), supabase::sign_in(&project, &email, "a long password").unwrap(), "b".into());
    let got = sync_once(&b.library, &mut to_b).unwrap();
    assert!(got.received >= 2 && got.files_received == 1, "{got:?}");
    {
        let lib = b.lib();
        let there = lib.book(&book).unwrap().unwrap();
        assert_eq!(there.availability, Availability::Cloud);
        assert!(there.cover_path.is_some_and(|c| Path::new(&c).exists()));
        assert_eq!(lib.notes_page(&Default::default()).unwrap().counts.personal, 1);
    }
    download_book(&b.library, &mut to_b, &book).unwrap();
    assert_eq!(b.lib().book(&book).unwrap().unwrap().availability, Availability::Local);

    // Someone else's account sees none of it.
    let other = format!("other-{}@example.com", uuid::Uuid::now_v7());
    supabase::sign_up(&project, &other, "another password").unwrap();
    let c = Device::new();
    let mut to_c = Supabase::new(project.clone(), supabase::sign_in(&project, &other, "another password").unwrap(), "c".into());
    assert_eq!(sync_once(&c.library, &mut to_c).unwrap().received, 0);
    assert!(c.lib().book(&book).unwrap().is_none());
}

#[test]
fn a_shared_folder_carries_a_library_between_devices() {
    let folder = tempfile::tempdir().unwrap();
    let provider = Provider::Folder { service: "icloud".into(), path: folder.path().display().to_string() };
    let a = Device::new();
    let b = Device::new();
    a.set_options(json!({ "bookFiles": true }));
    for device in [&a, &b] {
        device.lib().set_sync_provider(&provider).unwrap();
        assert_eq!(device.lib().sync_status().unwrap().state, SyncState::Idle);
    }
    let sync = |device: &Device| {
        let mut cloud = device.lib().connect().unwrap().unwrap();
        sync_once(&device.library, &mut cloud).unwrap()
    };

    let book = a.import("Carmilla");
    a.lib().set_favorite(&book, true).unwrap();
    let sent = sync(&a);
    assert!(sent.sent > 0 && sent.files_sent > 0, "{sent:?}");
    let got = sync(&b);
    assert!(got.received > 0, "{got:?}");
    let there = b.lib().book(&book).unwrap().unwrap();
    assert!(there.favorite);
    assert_eq!(sync(&b).received, 0, "nothing is read twice");

    tick();
    b.lib().set_favorite(&book, false).unwrap();
    sync(&b);
    sync(&a);
    assert!(!a.lib().book(&book).unwrap().unwrap().favorite);

    // The book's file can be fetched by a device that doesn't have it.
    let mut cloud = b.lib().connect().unwrap().unwrap();
    download_book(&b.library, &mut cloud, &book).unwrap();

    // Pointing at another folder starts over there.
    let elsewhere = tempfile::tempdir().unwrap();
    b.lib().set_sync_provider(&Provider::Folder { service: "dropbox".into(), path: elsewhere.path().display().to_string() }).unwrap();
    assert!(sync(&b).sent > 0, "everything is sent to the new place");
    assert_eq!(b.lib().sync_overview().unwrap().provider.service.as_deref(), Some("dropbox"));
}

/// Moves the library elsewhere while its batch is on the way out.
struct SwitchMidPush<'a> {
    inner: super::Cloud,
    library: &'a Mutex<Library>,
    to: Provider,
}

impl Remote for SwitchMidPush<'_> {
    fn push(&mut self, records: &[Record]) -> Result<()> {
        self.inner.push(records)?;
        self.library.lock().unwrap().set_sync_provider(&self.to)
    }
    fn pull(&mut self, after: &str, limit: usize) -> Result<Page> {
        self.inner.pull(after, limit)
    }
    fn upload(&mut self, path: &str, file: &Path) -> Result<()> {
        self.inner.upload(path, file)
    }
    fn download(&mut self, path: &str, to: &Path) -> Result<bool> {
        self.inner.download(path, to)
    }
    fn list(&mut self, folder: &str) -> Result<Vec<String>> {
        self.inner.list(folder)
    }
    fn remove(&mut self, path: &str) -> Result<()> {
        self.inner.remove(path)
    }
}

#[test]
fn switching_mid_run_leaves_everything_for_the_new_place() {
    let old = tempfile::tempdir().unwrap();
    let new = tempfile::tempdir().unwrap();
    let folder = |dir: &tempfile::TempDir| Provider::Folder { service: "custom".into(), path: dir.path().display().to_string() };
    let a = Device::new();
    a.lib().set_sync_provider(&folder(&old)).unwrap();
    a.import("Carmilla");
    let waiting = a.lib().sync_outbox(&SyncOptions::default(), 500).unwrap().len();
    assert!(waiting > 0);

    let inner = a.lib().connect().unwrap().unwrap();
    let mut remote = SwitchMidPush { inner, library: &a.library, to: folder(&new) };
    sync_once(&a.library, &mut remote).unwrap();
    assert_eq!(a.lib().sync_outbox(&SyncOptions::default(), 500).unwrap().len(), waiting, "nothing marked sent by the old run");

    let mut cloud = a.lib().connect().unwrap().unwrap();
    assert_eq!(sync_once(&a.library, &mut cloud).unwrap().sent as usize, waiting);
}

#[test]
fn stopping_sync_turns_it_off() {
    let dir = tempfile::tempdir().unwrap();
    let a = Device::new();
    a.lib().set_sync_provider(&Provider::Folder { service: "mega".into(), path: dir.path().display().to_string() }).unwrap();
    a.lib().set_sync_provider(&Provider::Off).unwrap();
    assert_eq!(a.lib().sync_status().unwrap().state, SyncState::Disabled);
    assert!(a.lib().connect().unwrap().is_none());
    assert_eq!(a.lib().sync_overview().unwrap().provider.kind, "off");
}

#[test]
fn details_found_online_and_edits_travel() {
    let cloud = FakeRemote::default();
    let a = Device::new();
    let b = Device::new();
    let book = a.import("Found");
    let found = BTreeMap::from([("publisher".to_string(), "Penguin".to_string()), ("genres".to_string(), r#"["Gothic"]"#.to_string())]);
    a.lib().save_fetched(&book, "google", &found).unwrap();
    a.lib()
        .edit_details(std::slice::from_ref(&book), &[crate::details::DetailChange { field: "series".into(), value: Some("Vigil".into()) }])
        .unwrap();
    a.sync(&cloud);
    b.sync(&cloud);
    let details = b.lib().book_details(&book).unwrap();
    let get = |f: &str| details.fields.iter().find(|x| x.field == f).unwrap().clone();
    assert_eq!(get("publisher").fetched.as_deref(), Some("Penguin"));
    assert_eq!(get("publisher").fetched_from.as_deref(), Some("google"));
    assert_eq!(get("series").edited.as_deref(), Some("Vigil"));
    assert_eq!(details.book.genres, vec!["Gothic".to_string()]);

    // Showing the book's own details again reaches the other device too.
    tick();
    a.lib().reset_details(&book, true).unwrap();
    a.sync(&cloud);
    b.sync(&cloud);
    let details = b.lib().book_details(&book).unwrap();
    assert!(details.fields.iter().all(|f| f.edited.is_none() && f.fetched_from.as_deref() != Some("google")));
}

use super::moving::{self, Destination, MoveReport, MoveRun, MoveScope};
use std::sync::atomic::AtomicBool;

/// Copies a device's library from `from` to `to`, as a move or backup does.
fn copy(device: &Device, from: Option<&FakeRemote>, to: &mut dyn Remote, scope: MoveScope) -> MoveReport {
    let cancel = AtomicBool::new(false);
    let mut old = from.cloned();
    let run = MoveRun { scope, from: old.as_mut().map(|r| r as &mut dyn Remote), to, check: None, cancel: &cancel, progress: &mut |_| {} };
    moving::copy_library(&device.library, run).unwrap()
}

#[test]
fn moving_copies_records_and_files_then_switches_over() {
    let old = FakeRemote::default();
    let new = FakeRemote::default();
    let a = Device::new();
    a.set_options(json!({ "bookFiles": true }));
    let book = a.import("Dracula");
    a.lib().set_favorite(&book, true).unwrap();
    a.lib().save_personal_note(None, Some("Plan"), "Carmilla next").unwrap();
    a.sync(&old);

    let mut progress = Vec::new();
    let cancel = AtomicBool::new(false);
    let (mut from, mut to) = (old.clone(), new.clone());
    let report = moving::copy_library(
        &a.library,
        MoveRun { scope: MoveScope::All, from: Some(&mut from), to: &mut to, check: None, cancel: &cancel, progress: &mut |p| progress.push(p.clone()) },
    )
    .unwrap();
    let check = report.check.clone().expect("checked");
    assert!(check.passed(), "{check:?}");
    assert_eq!(check.records, check.records_found);
    assert_eq!(check.files, 2, "the book and its cover");
    assert_eq!(new.0.lock().unwrap().records.len(), old.0.lock().unwrap().records.len());
    let mut files: Vec<_> = new.0.lock().unwrap().files.keys().cloned().collect();
    files.sort();
    let hex = book_id_hex(&book).to_string();
    assert!(files[0] == format!("books/{hex}.epub") && files[1].starts_with(&format!("covers/{hex}.")), "{files:?}");
    assert_eq!(progress.last().unwrap().stage, moving::MoveStage::Checking);
    assert!(progress.iter().any(|p| p.total > 0 && p.done == p.total));

    // Switching counts everything there as sent: nothing goes twice.
    let folder = tempfile::tempdir().unwrap();
    let provider = Provider::Folder { service: "dropbox".into(), path: folder.path().display().to_string() };
    a.lib().adopt_move(&Destination::Files(provider.clone()), &check, MoveScope::All).unwrap();
    assert_eq!(a.lib().sync_provider().unwrap(), provider);
    assert_eq!(a.lib().sync_overview().unwrap().waiting_to_send, 0);
    let after = a.sync(&new);
    assert_eq!((after.sent, after.files_sent), (0, 0), "{after:?}");
}

#[test]
fn books_only_in_the_cloud_are_carried_across() {
    let old = FakeRemote::default();
    let new = FakeRemote::default();
    let a = Device::new();
    let b = Device::new();
    a.set_options(json!({ "bookFiles": true }));
    let book = a.import("Carmilla");
    a.sync(&old);
    b.set_options(json!({ "bookFiles": true }));
    b.sync(&old);
    assert_eq!(b.lib().book(&book).unwrap().unwrap().availability, Availability::Cloud);

    let report = copy(&b, Some(&old), &mut new.clone(), MoveScope::All);
    assert!(report.check.as_ref().unwrap().passed(), "{report:?}");
    let path = format!("books/{}.epub", book_id_hex(&book));
    assert!(new.0.lock().unwrap().files.contains_key(&path));
    assert_eq!(new.0.lock().unwrap().files.get(&path), old.0.lock().unwrap().files.get(&path), "the same bytes");
    assert_eq!(b.lib().book(&book).unwrap().unwrap().availability, Availability::Cloud, "still not kept on this device");
    let leftovers: Vec<_> = fs::read_dir(&b.lib().paths().books_dir).unwrap().filter_map(|e| e.ok()).map(|e| e.file_name()).collect();
    assert!(leftovers.is_empty(), "the temporary copy is gone: {leftovers:?}");
}

/// A service that quietly loses book files.
struct LosesBooks(FakeRemote);

impl Remote for LosesBooks {
    fn push(&mut self, records: &[Record]) -> Result<()> {
        self.0.push(records)
    }
    fn pull(&mut self, after: &str, limit: usize) -> Result<Page> {
        self.0.pull(after, limit)
    }
    fn upload(&mut self, path: &str, file: &Path) -> Result<()> {
        if path.starts_with("books/") {
            return Ok(());
        }
        self.0.upload(path, file)
    }
    fn download(&mut self, path: &str, to: &Path) -> Result<bool> {
        self.0.download(path, to)
    }
    fn list(&mut self, folder: &str) -> Result<Vec<String>> {
        self.0.list(folder)
    }
    fn list_sizes(&mut self, folder: &str) -> Result<Vec<(String, Option<u64>)>> {
        self.0.list_sizes(folder)
    }
    fn remove(&mut self, path: &str) -> Result<()> {
        self.0.remove(path)
    }
}

#[test]
fn the_check_finds_a_missing_file_and_a_second_try_fills_it() {
    let old = FakeRemote::default();
    let new = FakeRemote::default();
    let a = Device::new();
    a.set_options(json!({ "bookFiles": true }));
    a.import("Frankenstein");
    a.sync(&old);

    let report = copy(&a, Some(&old), &mut LosesBooks(new.clone()), MoveScope::All);
    let check = report.check.unwrap();
    assert!(!check.passed());
    assert_eq!(check.missing, ["The book file of Frankenstein"]);
    assert_eq!((check.files, check.files_found), (2, 1));
    assert_eq!(check.records, check.records_found, "the records all went");

    // Trying again copies only what's missing.
    let again = copy(&a, Some(&old), &mut new.clone(), MoveScope::All);
    assert!(again.check.unwrap().passed());
    assert_eq!((again.records_copied, again.files_copied), (0, 1));
}

#[test]
fn running_again_skips_what_is_already_there() {
    let old = FakeRemote::default();
    let new = FakeRemote::default();
    let a = Device::new();
    a.import("Wren");
    a.lib().save_personal_note(None, None, "Lamps").unwrap();
    a.sync(&old);

    let first = copy(&a, Some(&old), &mut new.clone(), MoveScope::All);
    assert!(first.records_copied > 0 && first.files_copied == 2, "{first:?}");
    let pushes = new.0.lock().unwrap().pushes;
    let second = copy(&a, Some(&old), &mut new.clone(), MoveScope::All);
    assert_eq!((second.records_copied, second.files_copied), (0, 0));
    assert_eq!(second.already_there, first.records_copied + first.files_copied);
    assert!(second.check.unwrap().passed());
    assert_eq!(new.0.lock().unwrap().pushes, pushes, "nothing sent the second time");

    // A change made since goes on the next try.
    tick();
    a.lib().save_personal_note(None, None, "More lamps").unwrap();
    assert_eq!(copy(&a, Some(&old), &mut new.clone(), MoveScope::All).records_copied, 1);
}

#[test]
fn text_only_leaves_audiobooks_behind() {
    let new = FakeRemote::default();
    let a = Device::new();
    let book = a.import("Dracula");
    let audio = a.import("Dracula, read aloud");
    a.lib().conn.execute("UPDATE books SET format = 'm4b' WHERE id = ?1", params![audio]).unwrap();
    a.lib().set_favorite(&audio, true).unwrap();
    a.lib().save_personal_note(None, None, "Not about a book").unwrap();

    let report = copy(&a, None, &mut new.clone(), MoveScope::Text);
    assert!(report.check.unwrap().passed());
    {
        let cloud = new.0.lock().unwrap();
        let about = |id: &str| cloud.records.values().any(|(_, r)| r.key.contains(id));
        assert!(about(&book));
        assert!(!about(&audio), "nothing about the audiobook went");
        assert!(cloud.records.values().any(|(_, r)| r.kind == "personal_note"), "notes not about a book still go");
        let files: Vec<_> = cloud.files.keys().collect();
        assert!(files.iter().all(|f| !f.contains(book_id_hex(&audio))), "{files:?}");
        assert!(files.iter().any(|f| f.contains(book_id_hex(&book))));
    }

    // Moving there turns off sending audiobook files, so the first sync doesn't send them anyway.
    let before = a.lib().sync_options().unwrap();
    let folder = tempfile::tempdir().unwrap();
    let provider = Provider::Folder { service: "dropbox".into(), path: folder.path().display().to_string() };
    let check = copy(&a, None, &mut new.clone(), MoveScope::Text).check.unwrap();
    a.lib().adopt_move(&Destination::Files(provider), &check, MoveScope::Text).unwrap();
    let after = a.lib().sync_options().unwrap();
    assert!(!after.audio_files);
    assert_eq!((after.book_files, after.notes), (before.book_files, before.notes));

    // And Audio only takes just the audiobook.
    let audio_only = FakeRemote::default();
    copy(&a, None, &mut audio_only.clone(), MoveScope::Audio);
    let cloud = audio_only.0.lock().unwrap();
    let books: Vec<_> = cloud.records.values().filter(|(_, r)| r.kind == "book").map(|(_, r)| r.key.clone()).collect();
    assert_eq!(books, [json!([audio]).to_string()]);
}

#[test]
fn stopping_part_way_leaves_the_rest_for_next_time() {
    let new = FakeRemote::default();
    let a = Device::new();
    a.import("Halfway");
    let cancel = AtomicBool::new(true);
    let mut to = new.clone();
    let run = MoveRun { scope: MoveScope::All, from: None, to: &mut to, check: None, cancel: &cancel, progress: &mut |_| {} };
    let report = moving::copy_library(&a.library, run).unwrap();
    assert!(report.cancelled && report.check.is_none());
    assert!(new.0.lock().unwrap().records.is_empty());
}

#[test]
fn a_folder_is_read_back_as_another_device_would() {
    let folder = tempfile::tempdir().unwrap();
    let provider = Provider::Folder { service: "custom".into(), path: folder.path().display().to_string() };
    let a = Device::new();
    a.import("Shelved");
    let device = a.lib().device_id().unwrap();
    let mut to = open_files(&provider, device).unwrap().0;
    let mut reader = open_files(&provider, "check".into()).unwrap().0;
    let cancel = AtomicBool::new(false);
    let run = MoveRun { scope: MoveScope::All, from: None, to: &mut to, check: Some(&mut reader), cancel: &cancel, progress: &mut |_| {} };
    let check = moving::copy_library(&a.library, run).unwrap().check.unwrap();
    assert!(check.passed() && check.records > 0 && check.files == 2, "the book and its cover: {check:?}");
}

#[test]
fn a_migration_after_a_backup_only_copies_whats_new() {
    let old = FakeRemote::default();
    let backup = FakeRemote::default();
    let a = Device::new();
    a.set_options(json!({ "bookFiles": true }));
    a.import("Dracula");
    a.import("Carmilla");
    a.sync(&old);

    // A backup leaves the new place holding everything, and nothing else behind.
    let first = copy(&a, Some(&old), &mut backup.clone(), MoveScope::All);
    assert!(first.check.unwrap().passed());
    assert_eq!(first.files_copied, 4, "two books and their covers");

    // Migrating there later finds it all already there.
    let pushes = backup.0.lock().unwrap().pushes;
    let migrate = copy(&a, Some(&old), &mut backup.clone(), MoveScope::All);
    assert_eq!((migrate.records_copied, migrate.files_copied), (0, 0), "{migrate:?}");
    assert_eq!(migrate.already_there, first.records_copied + first.files_copied);
    assert_eq!(backup.0.lock().unwrap().pushes, pushes);
    let check = migrate.check.unwrap();
    assert!(check.passed());
    let folder = tempfile::tempdir().unwrap();
    let provider = Provider::Folder { service: "mega".into(), path: folder.path().display().to_string() };
    a.lib().adopt_move(&Destination::Files(provider), &check, MoveScope::All).unwrap();
    let after = a.sync(&backup);
    assert_eq!((after.sent, after.files_sent), (0, 0), "and sync doesn't send them again");
}

/// Moving to the Supabase stand-in, from a device that has only some of its
/// books' files. Run with `TBV_SUPABASE_MOCK=http://127.0.0.1:<port> cargo test -- --ignored`.
#[test]
#[ignore = "needs the Supabase stand-in server"]
fn moves_to_supabase() {
    use super::supabase::{self, Supabase};
    let url = std::env::var("TBV_SUPABASE_MOCK").expect("TBV_SUPABASE_MOCK");
    let project = SupabaseProject { url, anon_key: "sb_publishable_test".into() };
    let old = FakeRemote::default();
    let a = Device::new();
    let b = Device::new();
    a.set_options(json!({ "bookFiles": true }));
    b.set_options(json!({ "bookFiles": true }));
    let cloud_only = a.import("Dracula");
    a.sync(&old);
    b.sync(&old);
    b.import("Carmilla");
    b.lib().save_personal_note(None, Some("Plan"), "Move it all").unwrap();

    let session = supabase::sign_in(&project, "reader@example.com", "a long password").unwrap();
    let mut to = Supabase::new(project.clone(), session.clone(), "b".into());
    let report = copy(&b, Some(&old), &mut to, MoveScope::All);
    let check = report.check.clone().unwrap();
    assert!(check.passed(), "{report:?}");
    assert_eq!(check.files, 4, "two books and two covers");
    let mut back = Supabase::new(project.clone(), session.clone(), "c".into());
    assert!(back.list("books/").unwrap().contains(&format!("{}.epub", book_id_hex(&cloud_only))));
    let again = copy(&b, Some(&old), &mut to, MoveScope::All);
    assert_eq!((again.records_copied, again.files_copied), (0, 0), "{again:?}");
    b.lib().adopt_move(&Destination::Supabase { project, session }, &check, MoveScope::All).unwrap();
    assert_eq!(b.lib().sync_provider().unwrap(), Provider::Supabase);
    assert_eq!(b.lib().sync_overview().unwrap().waiting_to_send, 0);
}

#[test]
fn removing_keeps_the_cloud_file_and_deleting_erases_it() {
    let cloud = FakeRemote::default();
    let a = Device::new();
    let b = Device::new();
    a.set_options(json!({ "bookFiles": true }));
    b.set_options(json!({ "bookFiles": true }));
    let kept = a.import("Carmilla");
    let gone = a.import("Dracula");
    a.sync(&cloud);
    let has = |book: &str| cloud.0.lock().unwrap().files.keys().any(|p| p.contains(book_id_hex(book)));
    assert!(has(&kept) && has(&gone));

    a.lib().remove_from_library(&kept).unwrap();
    a.lib().delete_book(&gone).unwrap();
    a.sync(&cloud);
    assert!(has(&kept), "a removed book's file stays in the cloud");
    assert!(!has(&gone), "a deleted book's file and cover are erased");
    assert!(a.lib().setting(super::ERASE).unwrap().is_none(), "nothing left to erase");

    b.sync(&cloud);
    assert!(b.lib().book(&kept).unwrap().is_none() && b.lib().book(&gone).unwrap().is_none(), "both leave every device");
}

/// A place that can't be reached.
struct Unreachable;

impl Remote for Unreachable {
    fn push(&mut self, _: &[Record]) -> Result<()> {
        Err(Error::Offline("no connection".into()))
    }
    fn pull(&mut self, _: &str, _: usize) -> Result<Page> {
        Err(Error::Offline("no connection".into()))
    }
    fn upload(&mut self, _: &str, _: &Path) -> Result<()> {
        Err(Error::Offline("no connection".into()))
    }
    fn download(&mut self, _: &str, _: &Path) -> Result<bool> {
        Err(Error::Offline("no connection".into()))
    }
    fn list(&mut self, _: &str) -> Result<Vec<String>> {
        Err(Error::Offline("no connection".into()))
    }
    fn remove(&mut self, _: &str) -> Result<()> {
        Err(Error::Offline("no connection".into()))
    }
}

impl Device {
    /// Syncs with a first place and a second one, as a PC with iCloud and Supabase would.
    fn sync_both(&self, main: &FakeRemote, also: &FakeRemote) -> SyncReport {
        let epoch = self.lib().sync_epoch();
        sync_both_since(&self.library, &mut main.clone(), Some(&mut also.clone()), epoch).unwrap()
    }

    fn add_second_place(&self) {
        let also = Provider::Folder { service: "icloud".into(), path: "/nowhere/iCloudDrive".into() };
        self.lib().set_sync_also(Some(&also)).unwrap();
    }
}

#[test]
fn a_second_place_passes_changes_both_ways() {
    let icloud = FakeRemote::default();
    let supabase = FakeRemote::default();
    let pc = Device::new();
    let phone = Device::new();
    let laptop = Device::new();
    pc.add_second_place();

    let book = pc.import("Dracula");
    pc.sync_both(&icloud, &supabase);
    phone.sync(&supabase);
    laptop.sync(&icloud);
    assert!(phone.lib().book(&book).unwrap().is_some(), "the phone sees the PC's book through Supabase");
    assert!(laptop.lib().book(&book).unwrap().is_some(), "the laptop sees it through iCloud");

    tick();
    phone.lib().save_position(&book, &locator(0.6)).unwrap();
    phone.sync(&supabase);
    pc.sync_both(&icloud, &supabase);
    assert_eq!(pc.lib().book(&book).unwrap().unwrap().total_progression, Some(0.6));
    laptop.sync(&icloud);
    assert_eq!(laptop.lib().book(&book).unwrap().unwrap().total_progression, Some(0.6), "passed on to iCloud in the same run");

    tick();
    laptop.lib().save_position(&book, &locator(0.9)).unwrap();
    laptop.sync(&icloud);
    pc.sync_both(&icloud, &supabase);
    phone.sync(&supabase);
    assert_eq!(phone.lib().book(&book).unwrap().unwrap().total_progression, Some(0.9), "and the other way");

    let report = pc.sync_both(&icloud, &supabase);
    assert_eq!(report.sent, 0, "a quiet run sends nothing to either place");
    let overview = pc.lib().sync_overview().unwrap();
    assert_eq!(overview.waiting_to_send, 0);
    assert_eq!(overview.also.unwrap().waiting_to_send, 0);
}

#[test]
fn each_place_has_its_own_file_switches() {
    let icloud = FakeRemote::default();
    let supabase = FakeRemote::default();
    let pc = Device::new();
    pc.add_second_place();
    pc.set_options(json!({ "bookFiles": true, "alsoBookFiles": false }));
    let book = pc.import("Carmilla");
    pc.sync_both(&icloud, &supabase);
    let books = |cloud: &FakeRemote| cloud.0.lock().unwrap().files.keys().filter(|p| p.starts_with("books/")).count();
    let covers = |cloud: &FakeRemote| cloud.0.lock().unwrap().files.keys().filter(|p| p.starts_with("covers/")).count();
    assert_eq!((books(&icloud), books(&supabase)), (1, 0));
    assert_eq!((covers(&icloud), covers(&supabase)), (1, 1), "covers go to both");

    pc.set_options(json!({ "bookFiles": true, "alsoBookFiles": true }));
    assert_eq!(pc.sync_both(&icloud, &supabase).files_sent, 1, "only the second place needed it");

    // A file in either place is enough to remove this device's copy, and to get it back.
    pc.lib().remove_download(&book).unwrap();
    icloud.0.lock().unwrap().files.clear();
    let mut first = icloud.clone();
    assert!(!download_book_from(&pc.library, &mut first, &book, Lane::Main).unwrap());
    assert!(download_book_from(&pc.library, &mut supabase.clone(), &book, Lane::Also).unwrap());
    assert_eq!(pc.lib().book(&book).unwrap().unwrap().availability, Availability::Local);
}

#[test]
fn one_place_failing_leaves_the_other_working() {
    let supabase = FakeRemote::default();
    let pc = Device::new();
    pc.add_second_place();
    let book = pc.import("Frankenstein");
    let epoch = pc.lib().sync_epoch();
    let outcome = sync_both_since(&pc.library, &mut Unreachable, Some(&mut supabase.clone()), epoch);
    assert!(matches!(outcome, Err(Error::Offline(_))));
    assert!(supabase.0.lock().unwrap().records.keys().any(|(k, key)| k == "book" && key.contains(&book)));
    let overview = pc.lib().sync_overview().unwrap();
    assert!(overview.last_error.is_some(), "the first place's trouble is noted");
    let also = overview.also.unwrap();
    assert!(also.last_error.is_none() && also.last_success_at.is_some());
    assert!(overview.waiting_to_send > 0, "and its changes wait for it");
}

#[test]
fn deleting_erases_from_both_places() {
    let icloud = FakeRemote::default();
    let supabase = FakeRemote::default();
    let pc = Device::new();
    pc.add_second_place();
    pc.set_options(json!({ "bookFiles": true }));
    let book = pc.import("Gone");
    pc.sync_both(&icloud, &supabase);
    let has = |cloud: &FakeRemote| cloud.0.lock().unwrap().files.keys().any(|p| p.contains(book_id_hex(&book)));
    assert!(has(&icloud) && has(&supabase));
    pc.lib().delete_book(&book).unwrap();
    pc.sync_both(&icloud, &supabase);
    assert!(!has(&icloud) && !has(&supabase));
}

#[test]
fn the_second_place_must_be_somewhere_else() {
    let pc = Device::new();
    let folder = Provider::Folder { service: "icloud".into(), path: "/nowhere/iCloudDrive".into() };
    pc.lib().set_sync_provider(&folder).unwrap();
    assert!(pc.lib().set_sync_also(Some(&folder)).is_err());
    pc.lib().set_sync_also(Some(&Provider::Supabase)).unwrap();
    assert_eq!(pc.lib().sync_also().unwrap(), Some(Provider::Supabase));
    pc.lib().set_sync_provider(&Provider::Supabase).unwrap();
    assert_eq!(pc.lib().sync_also().unwrap(), None, "moving the first sync there leaves one place");
}

#[test]
fn the_profile_picture_follows_the_library() {
    let cloud = FakeRemote::default();
    let a = Device::new();
    let b = Device::new();
    let dir = tempfile::tempdir().unwrap();
    let picture = dir.path().join("me.png");
    fs::write(&picture, b"png bytes").unwrap();
    a.lib().set_avatar(&picture).unwrap();
    a.sync(&cloud);
    b.sync(&cloud);
    let shown = b.lib().profile().unwrap().avatar_path.expect("the picture arrives");
    assert_eq!(fs::read(&shown).unwrap(), b"png bytes");

    tick();
    b.lib().clear_avatar().unwrap();
    b.sync(&cloud);
    a.sync(&cloud);
    assert_eq!(a.lib().profile().unwrap().avatar_path, None, "taking it away travels too");
}

#[test]
fn the_second_place_syncs_when_the_first_cannot_be_opened() {
    let supabase = FakeRemote::default();
    let pc = Device::new();
    pc.add_second_place();
    let book = pc.import("Alone");
    let epoch = pc.lib().sync_epoch();
    sync_lanes_since(&pc.library, None, Some(&mut supabase.clone()), epoch).unwrap();
    assert!(supabase.0.lock().unwrap().records.keys().any(|(k, key)| k == "book" && key.contains(&book)));
}

#[test]
fn starting_the_first_place_over_keeps_the_seconds_conflicts() {
    let pc = Device::new();
    pc.add_second_place();
    pc.lib()
        .conn
        .execute_batch("INSERT INTO sync_conflicts (kind, key, remote, found_at, lane) VALUES ('book', '[\"x\"]', '{}', 'now', 'also')")
        .unwrap();
    pc.lib().reset_sync().unwrap();
    let left: i64 = pc.lib().conn.query_row("SELECT COUNT(*) FROM sync_conflicts", [], |r| r.get(0)).unwrap();
    assert_eq!(left, 1);
}

#[test]
fn a_run_says_what_it_is_doing() {
    let cloud = FakeRemote::default();
    let a = Device::new();
    let b = Device::new();
    a.set_options(json!({ "bookFiles": true }));
    let book = a.import("Dracula");
    let heard = Mutex::new(Vec::new());
    let tell = |e: SyncEvent| heard.lock().unwrap().push(e);
    let epoch = a.lib().sync_epoch();
    sync_watched(&a.library, Some(&mut cloud.clone()), None, epoch, &tell).unwrap();
    let heard = heard.into_inner().unwrap();
    assert!(heard.contains(&SyncEvent::Step { lane: Lane::Main, step: SyncStep::Sending }));
    let sent: Vec<_> = heard
        .iter()
        .filter_map(|e| match e {
            SyncEvent::File { direction: Direction::Up, what, done: true, problem: None, .. } => Some(what.clone()),
            _ => None,
        })
        .collect();
    assert!(sent.contains(&"Dracula".to_string()) && sent.contains(&"The cover of Dracula".to_string()), "{sent:?}");
    assert_eq!(heard.last(), Some(&SyncEvent::Finished { lane: Lane::Main, problem: None }));

    let heard = Mutex::new(Vec::new());
    let tell = |e: SyncEvent| heard.lock().unwrap().push(e);
    let epoch = b.lib().sync_epoch();
    sync_watched(&b.library, Some(&mut cloud.clone()), None, epoch, &tell).unwrap();
    let got_cover = heard.into_inner().unwrap().iter().any(|e| {
        matches!(e, SyncEvent::File { direction: Direction::Down, what, done: true, problem: None, .. } if what == "The cover of Dracula")
    });
    assert!(got_cover);
    assert!(b.lib().book(&book).unwrap().is_some());
}

/// How long sync keeps the library to itself with a very large library: pages
/// wait for it, so no single hold may be long.
/// `TBV_SCALE=17000 cargo test -p tbv-core --release sync_scale -- --ignored --nocapture`
#[test]
#[ignore]
fn sync_scale_never_holds_the_library_long() {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::time::Instant;
    let count: usize = std::env::var("TBV_SCALE").ok().and_then(|n| n.parse().ok()).unwrap_or(17_000);
    let (dir, mut library) = open_temp_library();
    let source = dir.path().join("source");
    fs::create_dir_all(&source).unwrap();
    let paths: Vec<_> = (0..count)
        .map(|i| {
            let path = source.join(format!("book{i}.epub"));
            write_test_epub(&path, &format!("Book {i}"), &format!("Author {}", i % 900), true);
            path
        })
        .collect();
    for chunk in paths.chunks(500) {
        library.import_files(chunk);
    }
    let library = Mutex::new(library);
    let done = AtomicBool::new(false);
    let mut remote = FakeRemote::default();
    let (report, longest) = std::thread::scope(|s| {
        let watcher = s.spawn(|| {
            let mut longest = StdDuration::ZERO;
            while !done.load(Ordering::Relaxed) {
                let asked = Instant::now();
                drop(library.lock().unwrap());
                longest = longest.max(asked.elapsed());
                std::thread::sleep(StdDuration::from_millis(5));
            }
            longest
        });
        let started = Instant::now();
        let report = sync_once(&library, &mut remote).unwrap();
        eprintln!("sync {count}: {:?}", started.elapsed());
        done.store(true, Ordering::Relaxed);
        (report, watcher.join().unwrap())
    });
    eprintln!("sent {} records, {} files; longest wait for the library: {longest:?}", report.sent, report.files_sent);
}

#[test]
fn importing_a_book_only_in_the_cloud_leaves_it_there() {
    let cloud = FakeRemote::default();
    let (a, b) = (Device::new(), Device::new());
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("Dracula.epub");
    write_test_epub(&file, "Dracula", "Bram Stoker", true);
    let ImportResult::Imported { book_id, .. } = a.lib().import_files(std::slice::from_ref(&file)).remove(0) else { panic!() };
    a.sync(&cloud);
    b.sync(&cloud);

    assert!(matches!(b.lib().import_files(&[file]).remove(0), ImportResult::AlreadyInLibrary { .. }));
    assert_eq!(b.lib().book(&book_id).unwrap().unwrap().availability, Availability::Cloud, "not copied onto this device");
}

/// A service whose book uploads all fail, as when it's full.
struct BooksFail(FakeRemote);

impl Remote for BooksFail {
    fn push(&mut self, records: &[Record]) -> Result<()> {
        self.0.push(records)
    }
    fn pull(&mut self, after: &str, limit: usize) -> Result<Page> {
        self.0.pull(after, limit)
    }
    fn upload(&mut self, path: &str, file: &Path) -> Result<()> {
        if path.starts_with("books/") {
            return Err(Error::Cloud("the service is full".into()));
        }
        self.0.upload(path, file)
    }
    fn download(&mut self, path: &str, to: &Path) -> Result<bool> {
        self.0.download(path, to)
    }
    fn list(&mut self, folder: &str) -> Result<Vec<String>> {
        self.0.list(folder)
    }
    fn list_sizes(&mut self, folder: &str) -> Result<Vec<(String, Option<u64>)>> {
        self.0.list_sizes(folder)
    }
    fn remove(&mut self, path: &str) -> Result<()> {
        self.0.remove(path)
    }
}

#[test]
fn covers_travel_before_book_files_and_despite_them() {
    let cloud = FakeRemote::default();
    let (a, b) = (Device::new(), Device::new());
    a.set_options(json!({ "bookFiles": true }));
    let book = a.import("Frankenstein");
    assert!(sync_once(&a.library, &mut BooksFail(cloud.clone())).is_err(), "the book file couldn't go");
    assert!(cloud.0.lock().unwrap().files.keys().any(|p| p.starts_with("covers/")), "its cover went first");

    // Another device shows the cover of a book it doesn't have.
    b.sync(&cloud);
    let seen = b.lib().book(&book).unwrap().unwrap();
    assert_eq!(seen.availability, Availability::Cloud);
    assert!(seen.cover_path.is_some());
}

mod tidying {
    use super::*;
    use crate::sync::tidy::{plan_tidy, tidy, TidyPlan};
    use std::sync::atomic::AtomicBool;

    fn files(cloud: &FakeRemote) -> Vec<String> {
        let mut out: Vec<String> = cloud.0.lock().unwrap().files.keys().filter(|p| p.starts_with("books/")).cloned().collect();
        out.sort();
        out
    }

    fn book_path(id: &str) -> String {
        format!("books/{}.epub", crate::ids::book_id_hex(id))
    }

    #[test]
    fn only_books_on_this_computer_stay_and_the_rest_go_to_the_other_place_first() {
        let supabase = FakeRemote::default();
        let icloud = FakeRemote::default();
        let pc = Device::new();
        pc.set_options(json!({ "bookFiles": true }));
        let here = pc.import("Dracula");
        let gone = pc.import("Carmilla");
        pc.sync(&supabase);
        pc.lib().remove_download(&gone).unwrap();
        // iCloud already has Carmilla; a book from another device is only in Supabase.
        let carmilla = supabase.0.lock().unwrap().files[&book_path(&gone)].clone();
        icloud.0.lock().unwrap().files.insert(book_path(&gone), carmilla);
        let other_device = pc.dir_file("Camilla.epub");
        let other_id = crate::ids::book_id_for_file(&other_device).unwrap();
        supabase.0.lock().unwrap().files.insert(book_path(&other_id), fs::read(&other_device).unwrap());

        let plan = plan_tidy(&pc.library, &mut supabase.clone(), Some(&mut icloud.clone())).unwrap();
        assert_eq!(plan.keep, 1);
        assert_eq!(plan.remove, [book_path(&gone)]);
        assert_eq!(plan.copy_first, [book_path(&other_id)]);
        assert!(plan.lose.is_empty());

        let temp = tempfile::tempdir().unwrap();
        let mut seen = Vec::new();
        let report = tidy(
            &pc.library,
            &mut supabase.clone(),
            Lane::Main,
            Some((&mut icloud.clone(), Lane::Also)),
            &plan,
            temp.path(),
            &AtomicBool::new(false),
            &mut |p| seen.push(p.done),
        )
        .unwrap();
        assert_eq!((report.removed, report.copied, report.failed), (2, 1, 0));
        assert_eq!(seen.last(), Some(&2));
        assert_eq!(files(&supabase), [book_path(&here)]);
        let mut both = vec![book_path(&gone), book_path(&other_id)];
        both.sort();
        assert_eq!(files(&icloud), both);
        // Still in the library, and this computer no longer thinks Supabase has it.
        assert!(pc.lib().book(&gone).unwrap().is_some());
        let left: i64 = pc
            .lib()
            .conn
            .query_row("SELECT COUNT(*) FROM sync_files WHERE path = ?1", params![book_path(&gone)], |r| r.get(0))
            .unwrap();
        assert_eq!(left, 0);
        // Nothing left to do the second time.
        assert!(plan_tidy(&pc.library, &mut supabase.clone(), Some(&mut icloud.clone())).unwrap().is_empty());
    }

    #[test]
    fn with_no_other_place_the_copies_are_named_as_lost_and_a_failed_copy_stays() {
        let supabase = FakeRemote::default();
        let pc = Device::new();
        pc.set_options(json!({ "bookFiles": true }));
        let gone = pc.import("Carmilla");
        pc.sync(&supabase);
        pc.lib().remove_download(&gone).unwrap();
        let plan = plan_tidy(&pc.library, &mut supabase.clone(), None).unwrap();
        assert_eq!(plan.lose, [book_path(&gone)]);
        assert!(plan.bytes > 0);

        // A copy the other place won't take is left where it is.
        let failing = TidyPlan { copy_first: plan.lose.clone(), ..TidyPlan::default() };
        let temp = tempfile::tempdir().unwrap();
        let report = tidy(&pc.library, &mut supabase.clone(), Lane::Main, None, &failing, temp.path(), &AtomicBool::new(false), &mut |_| {}).unwrap();
        assert_eq!((report.removed, report.failed), (0, 1));
        assert_eq!(files(&supabase), [book_path(&gone)]);
    }
}

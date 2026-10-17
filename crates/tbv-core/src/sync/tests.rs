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

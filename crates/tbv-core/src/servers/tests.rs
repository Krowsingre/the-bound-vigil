use std::collections::BTreeMap;
use std::sync::atomic::AtomicBool;

use super::*;
use crate::library::tests::open_temp_library;

fn input() -> ServerInput {
    ServerInput {
        id: None,
        name: " Seedbox ".into(),
        protocol: Protocol::Sftp,
        host: " box.example.com ".into(),
        port: 22,
        username: " wren ".into(),
        password: Some(" secret pass ".into()),
        login: Login::Password,
        key_file: None,
        folder: "/home/wren/downloads/".into(),
    }
}

fn unsuitable<T: std::fmt::Debug>(r: Result<T>) -> String {
    match r {
        Err(Error::Unsuitable(m)) => m,
        other => panic!("{other:?}"),
    }
}

#[test]
fn servers_are_saved_on_this_device_and_never_show_the_password() {
    let (_dir, library) = open_temp_library();
    assert!(library.server_views().unwrap().is_empty());
    let view = library.save_server(&input()).unwrap();
    assert!(view.has_password);
    assert_eq!((view.name.as_str(), view.host.as_str(), view.username.as_str()), ("Seedbox", "box.example.com", "wren"));
    assert_eq!(view.folder, "/home/wren/downloads");
    assert!(!serde_json::to_string(&library.server_views().unwrap()).unwrap().contains("secret"));
    assert_eq!(library.server(&view.id).unwrap().password, " secret pass ");

    // Saving again without a password keeps it, and the learnt key too.
    library.trust_server_key(&view.id, "SHA256:abc").unwrap();
    let mut again = input();
    again.id = Some(view.id.clone());
    again.password = None;
    again.name = "".into();
    let saved = library.save_server(&again).unwrap();
    assert_eq!(saved.id, view.id);
    assert_eq!(saved.name, "box.example.com", "an empty name falls back to the address");
    assert_eq!(saved.host_key.as_deref(), Some("SHA256:abc"));
    assert_eq!(library.server(&view.id).unwrap().password, " secret pass ");
    assert_eq!(library.servers().unwrap().len(), 1);

    // A new address is a different machine: its key is learnt afresh.
    again.host = "other.example.com".into();
    assert_eq!(library.save_server(&again).unwrap().host_key, None);

    let second = library.save_server(&ServerInput { protocol: Protocol::Ftp, port: 21, ..input() }).unwrap();
    assert_eq!(library.servers().unwrap().len(), 2);
    library.remove_server(&view.id).unwrap();
    let left = library.server_views().unwrap();
    assert_eq!(left.iter().map(|s| s.id.as_str()).collect::<Vec<_>>(), [second.id.as_str()]);
}

#[test]
fn says_what_to_fix() {
    let (_dir, library) = open_temp_library();
    let wrong = |change: fn(&mut ServerInput)| {
        let mut i = input();
        change(&mut i);
        unsuitable(library.save_server(&i))
    };
    assert!(wrong(|i| i.host = "".into()).contains("address"));
    assert!(wrong(|i| i.host = "sftp://box.example.com".into()).contains("without ftp://"));
    assert!(wrong(|i| i.port = 0).contains("port"));
    assert!(wrong(|i| i.username = " ".into()).contains("username"));
    assert!(wrong(|i| i.password = None).contains("password"));
    assert!(wrong(|i| i.login = Login::Key).contains("key file"));
    assert!(wrong(|i| i.id = Some("gone".into())).contains("isn't saved"));
    assert!(library.servers().unwrap().is_empty());

    // Anonymous FTP needs no password; key files are for SFTP only.
    let anonymous = ServerInput { protocol: Protocol::Ftp, username: "anonymous".into(), password: None, ..input() };
    assert!(library.save_server(&anonymous).is_ok());
    let key = ServerInput { login: Login::Key, key_file: Some("C:\\keys\\id_ed25519".into()), password: None, ..input() };
    assert_eq!(library.save_server(&key).unwrap().login, Login::Key);
    let ftp_key = ServerInput { protocol: Protocol::Ftp, login: Login::Key, ..input() };
    assert_eq!(library.save_server(&ftp_key).unwrap().login, Login::Password, "FTP always signs in with a password");
}

#[test]
fn passwords_stay_out_of_backups_and_survive_a_restore() {
    let (dir, mut library) = open_temp_library();
    let view = library.save_server(&input()).unwrap();
    assert!(crate::data::is_secret_setting(SETTINGS_KEY));
    let backup = dir.path().join("backup.tbvbackup");
    library.create_backup(&backup).unwrap();
    let copy = rusqlite::Connection::open(&backup).unwrap();
    let kept: i64 = copy.query_row("SELECT COUNT(*) FROM device_settings WHERE key = ?1", [SETTINGS_KEY], |r| r.get(0)).unwrap();
    assert_eq!(kept, 0);
    drop(copy);

    library.restore_backup(&backup).unwrap();
    assert_eq!(library.server(&view.id).unwrap().password, " secret pass ");
}

#[test]
fn paths_are_tidied() {
    assert_eq!(normalise(""), "");
    assert_eq!(normalise("/"), "/");
    assert_eq!(normalise("/home//wren/./books/"), "/home/wren/books");
    assert_eq!(normalise("/home/wren/../../.."), "/");
    assert_eq!(normalise("downloads\\books"), "downloads/books");
    assert_eq!(normalise("./"), ".");
    assert_eq!(join("/", "a"), "/a");
    assert_eq!(join("/home", "a"), "/home/a");
    assert_eq!(join("", "a"), "a");
    assert_eq!(base_name("/home/wren/Books/"), "Books");
}

#[test]
fn names_from_a_server_are_safe_here() {
    assert_eq!(local_name("Dracula: A Novel?.epub"), "Dracula_ A Novel_.epub");
    assert_eq!(local_name("trailing dots..."), "trailing dots");
    assert_eq!(local_name(".."), "_");
    assert_eq!(local_name("CON.mp3"), "_CON.mp3");
    assert_eq!(local_name("COM1"), "_COM1");
    assert_eq!(local_name("Comet.mp3"), "Comet.mp3");
    assert!(!usable_name("../../evil.epub"));
    assert!(!usable_name("a\\b.epub"));
    assert!(importable("Carmilla.EPUB"));
    assert!(importable("01 - Chapter One.mp3"));
    assert!(!importable("cover.jpg"));
    assert!(!importable(".epub"));
    assert!(!importable(".hidden.epub"));
}

/// A pretend server: a tree of folders and files kept in memory.
#[derive(Default)]
struct Fake {
    files: BTreeMap<String, Vec<u8>>,
    /// Sizes the listing gives, when they differ from the file's.
    listed: BTreeMap<String, u64>,
    fail_on: Option<String>,
    fetched: Vec<String>,
}

impl Fake {
    fn with(files: &[(&str, &str)]) -> Self {
        Self { files: files.iter().map(|(p, c)| (p.to_string(), c.as_bytes().to_vec())).collect(), ..Default::default() }
    }
}

impl Connection for Fake {
    fn home(&mut self) -> Result<String> {
        Ok("/home/wren".into())
    }

    fn list(&mut self, path: &str) -> Result<Vec<RemoteEntry>> {
        let prefix = if path == "/" { "/".to_string() } else { format!("{path}/") };
        let mut seen = BTreeMap::new();
        for (file, bytes) in &self.files {
            let Some(rest) = file.strip_prefix(&prefix) else { continue };
            let (name, is_dir) = match rest.split_once('/') {
                Some((dir, _)) => (dir, true),
                None => (rest, false),
            };
            let size = if is_dir { 0 } else { self.listed.get(file).copied().unwrap_or(bytes.len() as u64) };
            seen.insert(name.to_string(), RemoteEntry { name: name.to_string(), path: join(path, name), is_dir, size });
        }
        if seen.is_empty() {
            return Err(Error::Unsuitable(format!("{path} isn't there")));
        }
        Ok(seen.into_values().collect())
    }

    fn fetch(&mut self, path: &str, out: &mut dyn Write, progress: &mut dyn FnMut(u64) -> bool) -> Result<u64> {
        if self.fail_on.as_deref() == Some(path) {
            return Err(Error::Unsuitable("The connection was lost part-way.".into()));
        }
        self.fetched.push(path.to_string());
        let bytes = self.files.get(path).cloned().unwrap_or_default();
        let mut sent = 0;
        for piece in bytes.chunks(3) {
            out.write_all(piece)?;
            sent += piece.len() as u64;
            if !progress(piece.len() as u64) {
                break;
            }
        }
        Ok(sent)
    }
}

fn library_tree() -> Fake {
    Fake::with(&[
        ("/home/wren/Carmilla.epub", "carmilla"),
        ("/home/wren/cover.jpg", "jpeg"),
        ("/home/wren/.cache/x.epub", "hidden"),
        ("/home/wren/Audiobooks/Dracula/01 Chapter.mp3", "one"),
        ("/home/wren/Audiobooks/Dracula/02 Chapter.mp3", "two"),
        ("/home/wren/Audiobooks/Dracula/10 Chapter.mp3", "ten"),
        ("/home/wren/Audiobooks/Dracula/folder.jpg", "art"),
        ("/home/wren/Audiobooks/Dracula/notes.nfo", "nfo"),
        ("/home/wren/Pictures/holiday.png", "png"),
        ("/home/wren/Shelf/Lamps.pdf", "pdf"),
    ])
}

#[test]
fn listings_show_only_folders_and_what_tbv_can_import() {
    let mut fake = library_tree();
    let listing = list_importable(&mut fake, "/home/wren/").unwrap();
    assert_eq!(listing.path, "/home/wren");
    let names: Vec<_> = listing.entries.iter().map(|e| (e.name.as_str(), e.is_dir)).collect();
    assert_eq!(names, [("Audiobooks", true), ("Pictures", true), ("Shelf", true), ("Carmilla.epub", false)]);
    assert_eq!(listing.hidden, 1, "cover.jpg is left out");
    assert_eq!(listing.entries[3].path, "/home/wren/Carmilla.epub");
    assert_eq!(listing.entries[3].size, 8);

    let chapters = list_importable(&mut fake, "/home/wren/Audiobooks/Dracula").unwrap();
    let names: Vec<_> = chapters.entries.iter().map(|e| e.name.as_str()).collect();
    assert_eq!(names, ["01 Chapter.mp3", "02 Chapter.mp3", "10 Chapter.mp3"], "numbers sort in order");
    assert_eq!(chapters.hidden, 2);
}

fn chosen(path: &str, is_dir: bool) -> Chosen {
    Chosen { path: path.into(), is_dir, size: 0 }
}

#[test]
fn downloads_keep_their_folders_so_audiobooks_stay_whole() {
    let dir = tempfile::tempdir().unwrap();
    let mut fake = library_tree();
    let mut seen = Vec::new();
    let got = download(
        &mut fake,
        &[chosen("/home/wren/Audiobooks", true), chosen("/home/wren/Carmilla.epub", false), chosen("/home/wren/Pictures", true)],
        dir.path(),
        &AtomicBool::new(false),
        &mut |p| seen.push(p.clone()),
    )
    .unwrap();
    assert!(!got.stopped);
    assert_eq!(got.files, 4);
    assert_eq!(got.bytes, 3 + 3 + 3 + 8);
    // Pictures had nothing to import, so it isn't handed on.
    assert_eq!(got.roots, [dir.path().join("Audiobooks"), dir.path().join("Carmilla.epub")]);
    let dracula = dir.path().join("Audiobooks").join("Dracula");
    assert_eq!(fs::read_to_string(dracula.join("02 Chapter.mp3")).unwrap(), "two");
    assert!(!dracula.join("folder.jpg").exists());
    assert_eq!(fs::read_to_string(dir.path().join("Carmilla.epub")).unwrap(), "carmilla");
    assert!(!dir.path().join("Pictures").exists());
    let leftovers: Vec<_> = walkdir(dir.path()).into_iter().filter(|p| p.extension().is_some_and(|e| e == "part")).collect();
    assert!(leftovers.is_empty(), "{leftovers:?}");

    // The import queue sees one audiobook for the folder of chapters.
    let books = crate::library::find_book_files(&got.roots, &dir.path().join("Library"));
    assert_eq!(books, [dracula.clone(), dir.path().join("Carmilla.epub")]);

    let last = seen.last().unwrap();
    assert_eq!((last.files_done, last.files_total, last.bytes_done, last.bytes_total), (4, 4, 17, 17));
    assert!(seen.iter().any(|p| p.stage == Stage::Looking));
    assert!(seen.iter().any(|p| p.current.as_deref() == Some("01 Chapter.mp3")));
}

fn walkdir(dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    for entry in fs::read_dir(dir).unwrap().flatten() {
        let path = entry.path();
        if path.is_dir() {
            out.extend(walkdir(&path));
        }
        out.push(path);
    }
    out
}

#[test]
fn two_choices_with_one_name_both_come_down() {
    let dir = tempfile::tempdir().unwrap();
    let mut fake = Fake::with(&[("/a/Book.epub", "first"), ("/b/Book.epub", "second"), ("/b/book.EPUB", "third")]);
    let got = download(
        &mut fake,
        &[chosen("/a/Book.epub", false), chosen("/b/Book.epub", false), chosen("/b/book.EPUB", false)],
        dir.path(),
        &AtomicBool::new(false),
        &mut |_| {},
    )
    .unwrap();
    let names: Vec<_> = got.roots.iter().map(|r| r.file_name().unwrap().to_string_lossy().into_owned()).collect();
    assert_eq!(names, ["Book.epub", "Book (2).epub", "book (3).EPUB"]);
    assert_eq!(fs::read_to_string(&got.roots[1]).unwrap(), "second");
}

#[test]
fn sizes_come_from_the_files_not_the_listing() {
    let dir = tempfile::tempdir().unwrap();
    let mut fake = Fake::with(&[("/x/Big.epub", "123456789")]);
    fake.listed.insert("/x/Big.epub".into(), 4);
    let mut last = DownloadProgress::default();
    download(&mut fake, &[chosen("/x", true)], dir.path(), &AtomicBool::new(false), &mut |p| last = p.clone()).unwrap();
    assert_eq!((last.bytes_done, last.bytes_total), (9, 9));
}

#[test]
fn stopping_leaves_no_half_files() {
    let dir = tempfile::tempdir().unwrap();
    let mut fake = Fake::with(&[("/x/One.epub", "aaaaaaaaa"), ("/x/Two.epub", "bbbbbbbbb")]);
    let cancel = AtomicBool::new(false);
    let got = download(&mut fake, &[chosen("/x", true)], dir.path(), &cancel, &mut |p| {
        if p.bytes_done >= 12 {
            cancel.store(true, Ordering::Relaxed);
        }
    })
    .unwrap();
    assert!(got.stopped);
    assert_eq!(got.files, 1);
    let files = walkdir(dir.path());
    assert!(files.iter().all(|p| p.extension().is_none_or(|e| e != "part")), "{files:?}");
    assert!(!dir.path().join("x").join("Two.epub").exists());
}

#[test]
fn a_lost_connection_says_so_and_cleans_up() {
    let dir = tempfile::tempdir().unwrap();
    let mut fake = Fake::with(&[("/x/One.epub", "aaa"), ("/x/Two.epub", "bbb")]);
    fake.fail_on = Some("/x/Two.epub".into());
    let error = unsuitable(download(&mut fake, &[chosen("/x", true)], dir.path(), &AtomicBool::new(false), &mut |_| {}));
    assert!(error.contains("lost part-way"));
    assert!(!dir.path().join("x").join("Two.epub.part").exists());
}

#[test]
fn nothing_to_import_is_explained() {
    let dir = tempfile::tempdir().unwrap();
    let mut fake = library_tree();
    let error = unsuitable(download(&mut fake, &[chosen("/home/wren/Pictures", true), chosen("/home/wren/cover.jpg", false)], dir.path(), &AtomicBool::new(false), &mut |_| {}));
    assert!(error.contains("no books"));
    assert!(fake.fetched.is_empty());
}

#[test]
fn a_server_cant_write_outside_the_downloads_folder() {
    let dir = tempfile::tempdir().unwrap();
    let into = dir.path().join("downloads");
    fs::create_dir_all(&into).unwrap();
    let mut fake = Fake::with(&[("/x/ok.epub", "fine")]);
    // Names a listing might carry to climb out of the folder are dropped.
    let got = download(
        &mut fake,
        &[chosen("/x/../../../etc/evil.epub", false), chosen("/x", true), chosen("..", true)],
        &into,
        &AtomicBool::new(false),
        &mut |_| {},
    );
    let got = got.unwrap();
    for root in &got.roots {
        assert!(root.starts_with(&into), "{root:?}");
    }
    assert!(!dir.path().join("evil.epub").exists());
}

#[test]
fn the_start_folder_is_the_saved_one_or_the_accounts_own() {
    let mut fake = library_tree();
    let mut server = Server {
        id: "s".into(),
        name: "Box".into(),
        protocol: Protocol::Sftp,
        host: "box".into(),
        port: 22,
        username: "wren".into(),
        password: "pw".into(),
        login: Login::Password,
        key_file: None,
        folder: String::new(),
        host_key: None,
    };
    assert_eq!(start_folder(&mut fake, &server).unwrap(), "/home/wren");
    server.folder = "/home/wren/Shelf".into();
    assert_eq!(start_folder(&mut fake, &server).unwrap(), "/home/wren/Shelf");
    // A folder typed without its leading slash is in the account's own.
    server.folder = "Shelf".into();
    assert_eq!(start_folder(&mut fake, &server).unwrap(), "/home/wren/Shelf");
}

#[test]
fn temp_folders_go_once_let_go() {
    let dir = tempfile::tempdir().unwrap();
    let folder = TempFolder::new(&downloads_dir(dir.path())).unwrap();
    let path = folder.path().to_path_buf();
    fs::write(path.join("Book.epub"), "x").unwrap();
    let held = std::sync::Arc::new(folder);
    let other = held.clone();
    drop(held);
    assert!(path.exists());
    drop(other);
    assert!(!path.exists());
}

#[test]
fn counts_read_naturally() {
    assert_eq!(plural(1, "folder"), "1 folder");
    assert_eq!(plural(3, "folder"), "3 folders");
    assert_eq!(plural(0, "file TBV can import"), "0 files TBV can import");
}

/// Against a real SFTP server. Run with
/// `TBV_SFTP_TEST=127.0.0.1:2222 cargo test -p tbv-core sftp_signs_in -- --ignored`
/// (user embre, password secret).
#[test]
#[ignore = "needs an SFTP server"]
fn sftp_signs_in_and_lists() {
    let at = std::env::var("TBV_SFTP_TEST").unwrap();
    let (host, port) = at.rsplit_once(':').unwrap();
    let (_dir, library) = crate::library::tests::open_temp_library();
    let saved = library
        .save_server(&ServerInput {
            id: None,
            name: String::new(),
            protocol: Protocol::Sftp,
            host: host.into(),
            port: port.parse().unwrap(),
            username: "embre".into(),
            password: Some("secret".into()),
            login: Login::Password,
            key_file: None,
            folder: String::new(),
        })
        .unwrap();
    let server = library.server(&saved.id).unwrap();
    let fingerprint = match super::test(&server) {
        Err(Error::NewHostKey(fp)) => fp,
        other => panic!("expected to be asked about the key first: {other:?}"),
    };
    library.trust_server_key(&saved.id, &fingerprint).unwrap();
    let server = library.server(&saved.id).unwrap();
    println!("test: {:?}", super::test(&server));
    let mut connection = super::connect(&server).unwrap();
    let folder = super::start_folder(connection.as_mut(), &server).unwrap();
    println!("listing {folder}: {:?}", super::list_importable(connection.as_mut(), &folder).map(|l| l.entries.len()));
}

mod queueing {
    use super::*;
    use crate::servers::queue::{FileState, Queue};

    /// Brings down every waiting file, as the app's workers do.
    fn download_all(queue: &mut Queue, fake: &mut Fake) {
        while let Some(file) = queue.claim() {
            let target = queue.path_of(&file);
            let got = fetch_file(fake, &file.remote, &target, &mut |_| true);
            queue.finished(file.id, got.map(|n| n.unwrap_or(0)).map_err(|e| e.to_string()));
        }
    }

    #[test]
    fn every_file_is_listed_and_an_audiobook_waits_for_its_parts() {
        let dir = tempfile::tempdir().unwrap();
        let mut fake = library_tree();
        let (_, planned) = plan(&mut fake, &[chosen("/home/wren/Audiobooks", true), chosen("/home/wren/Carmilla.epub", false)], &AtomicBool::new(false)).unwrap();
        let mut queue = Queue::open(dir.path());
        assert_eq!(queue.add("s1", "Seedbox", planned).unwrap(), 4, "one row per file, not per folder");
        assert_eq!(queue.counts().waiting, 4);

        // The book is down: it can go in while the audiobook's parts come.
        let first = queue.claim().unwrap();
        assert!(first.remote.ends_with("01 Chapter.mp3"));
        let target = queue.path_of(&first);
        queue.finished(first.id, fetch_file(&mut fake, &first.remote, &target, &mut |_| true).unwrap().ok_or_else(String::new));
        assert!(queue.ready().is_empty(), "one part of three isn't an audiobook yet");
        download_all(&mut queue, &mut fake);
        let ready = queue.ready();
        assert_eq!(ready.len(), 2);
        let audiobook = ready.iter().find(|r| r.ids.len() == 3).expect("the three parts go in together");
        assert!(audiobook.source.is_dir());
        assert!(queue.ready().is_empty(), "handed over once");

        // Done: the downloads go, and so does the batch's folder.
        for r in &ready {
            queue.imported(&r.ids);
        }
        assert_eq!(queue.counts().done, 4);
        let left: Vec<_> = fs::read_dir(dir.path()).unwrap().flatten().map(|e| e.file_name()).collect();
        assert_eq!(left, ["queue.json"]);
    }

    #[test]
    fn several_audiobooks_in_one_folder_each_get_their_own_folder() {
        use crate::audio::tests::silent_mp3;
        let dir = tempfile::tempdir().unwrap();
        let mut fake = Fake::default();
        for (name, album) in [("Dracula 1.mp3", "Dracula"), ("Dracula 2.mp3", "Dracula"), ("Carmilla 1.mp3", "Carmilla"), ("Carmilla 2.mp3", "Carmilla")] {
            fake.files.insert(format!("/home/wren/Mixed/{name}"), silent_mp3(10, name, album, "Someone"));
        }
        let (_, planned) = plan(&mut fake, &[chosen("/home/wren/Mixed", true)], &AtomicBool::new(false)).unwrap();
        let mut queue = Queue::open(dir.path());
        queue.add("s1", "Seedbox", planned).unwrap();
        download_all(&mut queue, &mut fake);
        let ready = queue.ready();
        assert_eq!(ready.len(), 2);
        for r in &ready {
            assert!(r.source.is_dir(), "{:?}", r.source);
            assert_eq!(crate::audio::folder_books(&r.source).len(), 1);
            assert_eq!(r.ids.len(), 2);
        }
        // One going in (and its files going) leaves the other whole.
        queue.imported(&ready[0].ids);
        assert_eq!(crate::audio::folder_books(&ready[1].source)[0].1.len(), 2);
        for f in queue.files().iter().filter(|f| ready[1].ids.contains(&f.id)) {
            assert!(queue.path_of(f).exists(), "the queue knows where its files went");
        }
    }

    #[test]
    fn a_crash_loses_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let mut fake = library_tree();
        let (_, planned) = plan(&mut fake, &[chosen("/home/wren/Carmilla.epub", false), chosen("/home/wren/Shelf", true)], &AtomicBool::new(false)).unwrap();
        let mut queue = Queue::open(dir.path());
        queue.add("s1", "Seedbox", planned).unwrap();
        // Carmilla comes down and goes to the import queue; Lamps is part-way when TBV stops.
        let carmilla = queue.claim().unwrap();
        let path = queue.path_of(&carmilla);
        queue.finished(carmilla.id, Ok(fetch_file(&mut fake, &carmilla.remote, &path, &mut |_| true).unwrap().unwrap()));
        assert_eq!(queue.ready().len(), 1);
        let lamps = queue.claim().unwrap();
        let lamps_path = queue.path_of(&lamps);
        fs::create_dir_all(lamps_path.parent().unwrap()).unwrap();
        fs::write(crate::servers::queue::partial(&lamps_path), "pd").unwrap();
        drop(queue);

        let mut again = Queue::open(dir.path());
        let states: Vec<_> = again.files().iter().map(|f| (f.name.as_str(), f.state)).collect();
        assert_eq!(states, [("Carmilla.epub", FileState::Downloaded), ("Lamps.pdf", FileState::Waiting)]);
        assert!(path.exists(), "the downloaded book is kept until it's in the library");
        assert!(!crate::servers::queue::partial(&lamps_path).exists());
        assert_eq!(again.ready().len(), 1, "and is added again");
        download_all(&mut again, &mut fake);
        assert_eq!(again.ready().len(), 1);
    }

    #[test]
    fn failed_files_can_be_tried_again_or_removed() {
        let dir = tempfile::tempdir().unwrap();
        let mut fake = library_tree();
        fake.fail_on = Some("/home/wren/Audiobooks/Dracula/02 Chapter.mp3".into());
        let (_, planned) = plan(&mut fake, &[chosen("/home/wren/Audiobooks/Dracula", true)], &AtomicBool::new(false)).unwrap();
        let mut queue = Queue::open(dir.path());
        queue.add("s1", "Seedbox", planned).unwrap();
        download_all(&mut queue, &mut fake);
        assert_eq!(queue.counts().failed, 1);
        assert!(queue.ready().is_empty(), "an audiobook missing a part waits");
        let failed = queue.files().iter().find(|f| f.state == FileState::Failed).unwrap().id;
        fake.fail_on = None;
        queue.retry(failed);
        download_all(&mut queue, &mut fake);
        assert_eq!(queue.ready().len(), 1);

        // Cancelling takes off only what hasn't come down.
        let (_, more) = plan(&mut fake, &[chosen("/home/wren/Shelf", true)], &AtomicBool::new(false)).unwrap();
        queue.add("s1", "Seedbox", more).unwrap();
        queue.cancel();
        assert_eq!(queue.counts().total, 3);
    }
}

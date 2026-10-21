//! Importing from a server (Settings › Servers, shown on the Imports page).
//! Every file chosen gets its own row, kept on disk (see
//! `tbv_core::servers::queue`), and a few come down at once, each over its
//! own connection: the "Connections" setting says how many. Browsing keeps
//! its own connection open, so you can carry on choosing while files come
//! down. The library is only locked for a moment to look up a server; each
//! file joins the import queue as it arrives (an audiobook's parts once
//! they're all here), and its download goes once its book is in.

use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tbv_core::servers::queue::{QueueCounts, QueuedFile, Queue};
use tbv_core::servers::{self, Chosen, Connection, Listing, Server};
use tbv_core::{Error, Library};

use crate::imports::{Hold, Imports};

/// The device setting with how many files come down at once.
pub const CONNECTIONS_KEY: &str = "servers.connections";
const DEFAULT_CONNECTIONS: usize = 3;
pub const MAX_CONNECTIONS: usize = 5;

/// A browsing connection unused for this long is closed and opened afresh.
const BROWSE_IDLE: Duration = Duration::from_secs(4 * 60);
const TELL_EVERY: Duration = Duration::from_millis(250);

/// How the server list stands, for the Imports page and Settings › Servers.
/// The rows themselves come a page at a time (`page`): a big folder can be
/// thousands of files.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerQueueView {
    pub counts: QueueCounts,
    pub connections: usize,
    /// Servers being looked through for what was chosen.
    pub looking: Vec<String>,
    /// Why the last "Bring in" found nothing to bring down.
    pub problem: Option<String>,
    /// The files coming down now.
    pub active: Vec<QueuedFile>,
    /// Changes when rows come, go or change state, so the page knows to fetch them again.
    pub version: u64,
}

#[derive(Default)]
pub struct ServerImports {
    queue: Mutex<Queue>,
    workers: Mutex<usize>,
    looking: Mutex<Vec<String>>,
    problem: Mutex<Option<String>>,
    version: AtomicU64,
    told: Mutex<Option<Instant>>,
    browsing: Mutex<HashMap<String, (Box<dyn Connection>, Instant)>>,
}

/// Puts a problem in words for the page. A server TBV hasn't met before is
/// marked so the page can ask about its key.
pub fn problem(e: Error) -> String {
    match e {
        Error::NewHostKey(fingerprint) => format!("new-host-key:{fingerprint}"),
        other => other.to_string(),
    }
}

pub fn saved(library: &Mutex<Library>, id: &str) -> tbv_core::Result<Server> {
    library.lock().map_err(|_| Error::Unsuitable("the library is unavailable".into()))?.server(id)
}

/// How many files come down at once, from the device setting.
pub fn connections(library: &Mutex<Library>) -> usize {
    library
        .lock()
        .ok()
        .and_then(|l| l.setting(CONNECTIONS_KEY).ok().flatten())
        .and_then(|v| v.trim().parse::<usize>().ok())
        .unwrap_or(DEFAULT_CONNECTIONS)
        .clamp(1, MAX_CONNECTIONS)
}

/// Kept by the import queue while a downloaded book is added; once it's
/// done, the download goes.
struct Handed {
    owner: Arc<ServerImports>,
    app: AppHandle,
    ids: Vec<u64>,
}

impl Drop for Handed {
    fn drop(&mut self) {
        if let Ok(mut queue) = self.owner.queue.lock() {
            queue.imported(&self.ids);
        }
        self.owner.changed();
        self.owner.tell(&self.app, true);
    }
}

impl ServerImports {
    /// The list as TBV left it, from the "Server downloads" folder.
    pub fn open(dir: &Path) -> Self {
        Self { queue: Mutex::new(Queue::open(dir)), ..Default::default() }
    }

    /// After TBV opens: adds what had come down, and carries on with the rest.
    pub fn resume(self: &Arc<Self>, app: &AppHandle, library: &Arc<Mutex<Library>>, imports: &Arc<Imports>) {
        self.pump(app, library, imports);
        self.start_workers(app, library, imports);
    }

    pub fn view(&self, library: &Mutex<Library>) -> ServerQueueView {
        let (counts, active) = match self.queue.lock() {
            Ok(q) => (q.counts(), q.files().iter().filter(|f| f.state == tbv_core::servers::queue::FileState::Downloading).cloned().collect()),
            Err(_) => Default::default(),
        };
        ServerQueueView {
            counts,
            connections: connections(library),
            looking: self.looking.lock().map(|l| l.clone()).unwrap_or_default(),
            problem: self.problem.lock().ok().and_then(|p| p.clone()),
            active,
            version: self.version.load(Ordering::Relaxed),
        }
    }

    /// Rows `offset..offset + limit`, in the order they were chosen.
    pub fn page(&self, offset: usize, limit: usize) -> Vec<QueuedFile> {
        self.queue.lock().map(|q| q.files().iter().skip(offset).take(limit.min(500)).cloned().collect()).unwrap_or_default()
    }

    /// A folder on a server, over a connection kept open between folders.
    pub fn browse(&self, server: &Server, path: Option<String>) -> tbv_core::Result<Listing> {
        let mut browsing = self.browsing.lock().map_err(|_| Error::Unsuitable("TBV is busy. Try again.".into()))?;
        browsing.retain(|_, (_, used)| used.elapsed() < BROWSE_IDLE);
        let mut kept = browsing.remove(&server.id).map(|(c, _)| c);
        // A kept connection the server has since closed is opened again, once.
        for attempt in 0..2 {
            let mut connection = match kept.take() {
                Some(c) => c,
                None => servers::connect(server)?,
            };
            let listed = (|| {
                let path = match path.as_deref().filter(|p| !p.trim().is_empty()) {
                    Some(p) => servers::normalise(p),
                    None => servers::start_folder(connection.as_mut(), server)?,
                };
                servers::list_importable(connection.as_mut(), &path)
            })();
            match listed {
                Ok(listing) => {
                    browsing.insert(server.id.clone(), (connection, Instant::now()));
                    return Ok(listing);
                }
                Err(e) if attempt == 0 && !matches!(e, Error::NewHostKey(_)) && !is_missing(&e) => continue,
                Err(e) => {
                    browsing.insert(server.id.clone(), (connection, Instant::now()));
                    return Err(e);
                }
            }
        }
        unreachable!("the second attempt always returns")
    }

    /// Looks through what was chosen and lists every file in it, then starts
    /// bringing them down. Runs in the background; more can be chosen meanwhile.
    pub fn bring_in(self: &Arc<Self>, app: AppHandle, library: Arc<Mutex<Library>>, imports: Arc<Imports>, server: Server, chosen: Vec<Chosen>) {
        if let Ok(mut looking) = self.looking.lock() {
            looking.push(server.name.clone());
        }
        if let Ok(mut problem) = self.problem.lock() {
            *problem = None;
        }
        self.tell(&app, true);
        let me = self.clone();
        thread::spawn(move || {
            let found = (|| {
                let mut connection = servers::connect(&server)?;
                let (_, planned) = servers::plan(connection.as_mut(), &chosen, &AtomicBool::new(false))?;
                if planned.is_empty() {
                    return Err(Error::Unsuitable("There were no books, documents or audiobooks TBV can import in what you chose.".into()));
                }
                me.queue.lock().map_err(|_| Error::Unsuitable("TBV is busy. Try again.".into()))?.add(&server.id, &server.name, planned)
            })();
            if let Ok(mut looking) = me.looking.lock() {
                if let Some(i) = looking.iter().position(|n| *n == server.name) {
                    looking.remove(i);
                }
            }
            if let Err(e) = found {
                if let Ok(mut p) = me.problem.lock() {
                    *p = Some(problem(e));
                }
            }
            me.changed();
            me.tell(&app, true);
            me.start_workers(&app, &library, &imports);
        });
    }

    pub fn retry(self: &Arc<Self>, app: &AppHandle, library: &Arc<Mutex<Library>>, imports: &Arc<Imports>, id: u64) {
        self.edit(app, |q| q.retry(id));
        self.start_workers(app, library, imports);
    }

    /// Takes a file off the list; one coming down stops.
    pub fn remove(self: &Arc<Self>, app: &AppHandle, library: &Arc<Mutex<Library>>, imports: &Arc<Imports>, id: u64) {
        self.edit(app, |q| q.remove(id));
        // The rest of an audiobook may have been waiting on that file.
        self.pump(app, library, imports);
    }

    /// Takes everything not yet down off the list.
    pub fn cancel(&self, app: &AppHandle) {
        self.edit(app, Queue::cancel);
        if let Ok(mut p) = self.problem.lock() {
            *p = None;
        }
    }

    pub fn clear_finished(&self, app: &AppHandle) {
        self.edit(app, Queue::clear_finished);
        if let Ok(mut p) = self.problem.lock() {
            *p = None;
        }
        self.tell(app, true);
    }

    fn edit(&self, app: &AppHandle, change: impl FnOnce(&mut Queue)) {
        if let Ok(mut queue) = self.queue.lock() {
            change(&mut queue);
        }
        self.changed();
        self.tell(app, true);
    }

    /// Starts more downloads, up to the Connections setting, if files are waiting.
    pub fn start_workers(self: &Arc<Self>, app: &AppHandle, library: &Arc<Mutex<Library>>, imports: &Arc<Imports>) {
        let limit = connections(library);
        let waiting = self.queue.lock().map(|q| q.counts().waiting).unwrap_or(0);
        let start = {
            let Ok(mut workers) = self.workers.lock() else { return };
            let start = waiting.min(limit.saturating_sub(*workers));
            *workers += start;
            start
        };
        for _ in 0..start {
            let (me, app, library, imports) = (self.clone(), app.clone(), library.clone(), imports.clone());
            thread::spawn(move || me.work(&app, &library, &imports));
        }
    }

    fn work(self: &Arc<Self>, app: &AppHandle, library: &Arc<Mutex<Library>>, imports: &Arc<Imports>) {
        let mut open: HashMap<String, Box<dyn Connection>> = HashMap::new();
        loop {
            // Fewer connections than downloads going: this one stops first.
            let over = self.workers.lock().is_ok_and(|w| *w > connections(library));
            let claimed = if over { None } else { self.queue.lock().ok().and_then(|mut q| q.claim()) };
            let Some(file) = claimed else { break };
            self.changed();
            self.tell(app, true);
            let target = self.queue.lock().map(|q| q.path_of(&file)).unwrap_or_default();
            let outcome = self.fetch(app, library, &mut open, &file, &target);
            if let Ok(mut queue) = self.queue.lock() {
                queue.finished(file.id, outcome);
            }
            self.changed();
            self.pump(app, library, imports);
            self.tell(app, true);
        }
        if let Ok(mut workers) = self.workers.lock() {
            *workers = workers.saturating_sub(1);
        }
        self.tell(app, true);
    }

    /// Brings one file down over this worker's connection to its server,
    /// connecting again once if the old connection was dropped.
    fn fetch(
        &self,
        app: &AppHandle,
        library: &Mutex<Library>,
        open: &mut HashMap<String, Box<dyn Connection>>,
        file: &QueuedFile,
        target: &Path,
    ) -> Result<u64, String> {
        let server = saved(library, &file.server_id).map_err(|_| "That server is no longer saved in Settings › Servers.".to_string())?;
        for attempt in 0..2 {
            let connection = match open.remove(&server.id) {
                Some(c) => c,
                None => servers::connect(&server).map_err(problem)?,
            };
            let mut connection = connection;
            let got = servers::fetch_file(connection.as_mut(), &file.remote, target, &mut |bytes| {
                let wanted = self.queue.lock().is_ok_and(|mut q| q.progress(file.id, bytes));
                self.tell(app, false);
                wanted
            });
            match got {
                Ok(Some(size)) => {
                    open.insert(server.id.clone(), connection);
                    return Ok(size);
                }
                // Taken off the list part-way; `finished` ignores it.
                Ok(None) => {
                    open.insert(server.id.clone(), connection);
                    return Err("Stopped.".into());
                }
                Err(e) if attempt == 0 && !is_missing(&e) => continue,
                Err(e) => return Err(problem(e)),
            }
        }
        Err("The server stopped answering.".into())
    }

    /// Hands what's come down to the import queue.
    fn pump(self: &Arc<Self>, app: &AppHandle, library: &Arc<Mutex<Library>>, imports: &Arc<Imports>) {
        let ready = self.queue.lock().map(|mut q| q.ready()).unwrap_or_default();
        if ready.is_empty() {
            return;
        }
        let sources = ready
            .into_iter()
            .map(|r| {
                let hold: Hold = Arc::new(Handed { owner: self.clone(), app: app.clone(), ids: r.ids });
                (r.source, Some(hold))
            })
            .collect();
        imports.queue_sources(app, library, sources);
        self.changed();
    }

    fn changed(&self) {
        self.version.fetch_add(1, Ordering::Relaxed);
    }

    fn tell(&self, app: &AppHandle, always: bool) {
        {
            let Ok(mut told) = self.told.lock() else { return };
            if !always && told.is_some_and(|at| at.elapsed() < TELL_EVERY) {
                return;
            }
            *told = Some(Instant::now());
        }
        let _ = app.emit("server-queue-changed", ());
    }
}

/// A file or folder that isn't on the server: connecting again won't help.
fn is_missing(e: &Error) -> bool {
    matches!(e, Error::Unsuitable(m) if m.contains("isn't there") || m.contains("No such file"))
}

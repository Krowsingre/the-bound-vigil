//! Importing from a server (Settings › Servers). Connecting, browsing and
//! downloading all wait on the network, so they run off the UI thread and
//! never hold the library: it is only locked for a moment to look up the
//! saved server. Downloads land in a folder of their own, then join the
//! import queue like any other files; the folder goes once they're all in.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tbv_core::servers::{self, Chosen, DownloadProgress, Server, TempFolder};
use tbv_core::{Error, Library};

use crate::imports::Imports;

/// How a download from a server stands, for Settings › Servers.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadStatus {
    pub running: bool,
    pub server: Option<String>,
    pub progress: DownloadProgress,
    /// Books handed to the import queue when it finished.
    pub queued: Option<usize>,
    pub stopped: bool,
    pub error: Option<String>,
}

#[derive(Default)]
pub struct Downloads {
    status: Mutex<DownloadStatus>,
    cancel: Arc<AtomicBool>,
    told: Mutex<Option<Instant>>,
}

const TELL_EVERY: Duration = Duration::from_millis(250);

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

impl Downloads {
    pub fn status(&self) -> DownloadStatus {
        self.status.lock().map(|s| s.clone()).unwrap_or_default()
    }

    pub fn cancel(&self) {
        self.cancel.store(true, Ordering::Relaxed);
    }

    /// Clears a finished download from the page.
    pub fn clear(&self, app: &AppHandle) {
        if let Ok(mut status) = self.status.lock() {
            if !status.running {
                *status = DownloadStatus::default();
            }
        }
        self.tell(app, true);
    }

    /// Starts bringing down the chosen files and folders. One at a time.
    pub fn start(
        self: &Arc<Self>,
        app: AppHandle,
        library: Arc<Mutex<Library>>,
        imports: Arc<Imports>,
        server: Server,
        chosen: Vec<Chosen>,
        downloads_dir: PathBuf,
    ) -> Result<(), String> {
        {
            let mut status = self.status.lock().map_err(|_| "TBV is busy. Try again.".to_string())?;
            if status.running {
                return Err("A download from a server is already going. Wait for it to finish, or stop it.".into());
            }
            *status = DownloadStatus { running: true, server: Some(server.name.clone()), ..Default::default() };
        }
        self.cancel.store(false, Ordering::Relaxed);
        self.tell(&app, true);
        let me = self.clone();
        thread::spawn(move || {
            let outcome = me.run(&app, &library, &imports, &server, &chosen, &downloads_dir);
            if let Ok(mut status) = me.status.lock() {
                status.running = false;
                match outcome {
                    Ok(Some(queued)) => status.queued = Some(queued),
                    Ok(None) => status.stopped = true,
                    Err(e) => status.error = Some(problem(e)),
                }
            }
            me.tell(&app, true);
        });
        Ok(())
    }

    /// The number of books queued, or None when it was stopped.
    fn run(
        &self,
        app: &AppHandle,
        library: &Arc<Mutex<Library>>,
        imports: &Arc<Imports>,
        server: &Server,
        chosen: &[Chosen],
        downloads_dir: &std::path::Path,
    ) -> tbv_core::Result<Option<usize>> {
        let mut connection = servers::connect(server)?;
        std::fs::create_dir_all(downloads_dir)?;
        let folder = TempFolder::new(downloads_dir)?;
        let got = servers::download(connection.as_mut(), chosen, folder.path(), &self.cancel, &mut |progress| {
            if let Ok(mut status) = self.status.lock() {
                status.progress = progress.clone();
            }
            self.tell(app, false);
        })?;
        drop(connection);
        if got.stopped {
            return Ok(None);
        }
        // The folder is deleted once the last of these books is in.
        Ok(Some(imports.add_holding(app, library, got.roots, Some(Arc::new(folder)))))
    }

    fn tell(&self, app: &AppHandle, always: bool) {
        let Ok(mut told) = self.told.lock() else { return };
        if !always && told.is_some_and(|at| at.elapsed() < TELL_EVERY) {
            return;
        }
        *told = Some(Instant::now());
        let _ = app.emit("server-download-changed", self.status());
    }
}

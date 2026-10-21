//! Importing books from a server: a seedbox, a NAS or another computer,
//! over FTP, FTPS (FTP with TLS) or SFTP. The servers are saved on this
//! device only, passwords included, and kept out of backups.
//!
//! Everything that talks to a server goes through `Connection`, so the rest
//! (what to show, what to download and where it goes) is tested without a
//! network. Downloads land in a folder of their own, keeping the server's
//! folders, so a folder of audio files still becomes one audiobook when the
//! import queue picks it up.

mod ftp;
pub mod queue;
mod sftp;

use std::collections::HashSet;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};
use crate::library::{Library, SUPPORTED_FORMATS};

pub(crate) const SETTINGS_KEY: &str = "servers.saved";

/// How long to wait for a server to answer before giving up.
pub(crate) const CONNECT_TIMEOUT: Duration = Duration::from_secs(20);
pub(crate) const READ_TIMEOUT: Duration = Duration::from_secs(60);

/// How deep into a chosen folder TBV looks, and how many files it takes from
/// one choice, so a mistaken tick on a whole drive can't run away.
const MAX_DEPTH: usize = 12;
const MAX_FILES: usize = 5_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Protocol {
    Ftp,
    /// FTP that switches to TLS before signing in (explicit FTPS).
    Ftps,
    Sftp,
}

impl Protocol {
    pub fn usual_port(self) -> u16 {
        match self {
            Protocol::Ftp | Protocol::Ftps => 21,
            Protocol::Sftp => 22,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Login {
    #[default]
    Password,
    /// A private key file (SFTP only). The password, if any, unlocks it.
    Key,
}

/// A saved server, as kept on this device.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Server {
    pub id: String,
    pub name: String,
    pub protocol: Protocol,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    #[serde(default)]
    pub login: Login,
    #[serde(default)]
    pub key_file: Option<String>,
    /// Where browsing starts. Empty means the account's own folder.
    #[serde(default)]
    pub folder: String,
    /// The SFTP server's key, or an FTPS server's own certificate, as its
    /// SHA256 fingerprint, once trusted.
    #[serde(default)]
    pub host_key: Option<String>,
}

/// What Settings shows: everything but the password.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerView {
    pub id: String,
    pub name: String,
    pub protocol: Protocol,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub has_password: bool,
    pub login: Login,
    pub key_file: Option<String>,
    pub folder: String,
    pub host_key: Option<String>,
}

/// What Settings saves. No id adds a server; no password keeps the saved one.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerInput {
    pub id: Option<String>,
    pub name: String,
    pub protocol: Protocol,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: Option<String>,
    #[serde(default)]
    pub login: Login,
    #[serde(default)]
    pub key_file: Option<String>,
    #[serde(default)]
    pub folder: String,
}

impl From<&Server> for ServerView {
    fn from(s: &Server) -> Self {
        Self {
            id: s.id.clone(),
            name: s.name.clone(),
            protocol: s.protocol,
            host: s.host.clone(),
            port: s.port,
            username: s.username.clone(),
            has_password: !s.password.is_empty(),
            login: s.login,
            key_file: s.key_file.clone(),
            folder: s.folder.clone(),
            host_key: s.host_key.clone(),
        }
    }
}

/// Checks a server's settings, saying plainly what to fix.
fn check(s: &Server) -> Result<()> {
    let problem = |m: &str| Err(Error::Unsuitable(m.into()));
    if s.host.is_empty() {
        return problem("Type the server's address, such as seedbox.example.com or 192.168.1.20.");
    }
    if s.host.contains("://") || s.host.contains('/') || s.host.contains(char::is_whitespace) {
        return problem("Type just the server's address, such as seedbox.example.com, without ftp:// or a folder after it. The folder goes in “Start in”.");
    }
    if s.port == 0 {
        return problem("Type the server's port. FTP usually uses 21 and SFTP 22; your seedbox's welcome email often says which.");
    }
    if s.username.is_empty() {
        return problem("Type the username for this server.");
    }
    match s.login {
        Login::Key if s.protocol != Protocol::Sftp => return problem("Signing in with a key file works with SFTP only."),
        Login::Key if s.key_file.as_deref().is_none_or(|k| k.trim().is_empty()) => return problem("Choose your private key file."),
        Login::Password if s.password.is_empty() && !s.username.eq_ignore_ascii_case("anonymous") => {
            return problem("Type the password for this server.")
        }
        _ => {}
    }
    Ok(())
}

impl Library {
    pub fn servers(&self) -> Result<Vec<Server>> {
        Ok(self.setting(SETTINGS_KEY)?.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default())
    }

    pub fn server_views(&self) -> Result<Vec<ServerView>> {
        Ok(self.servers()?.iter().map(ServerView::from).collect())
    }

    pub fn server(&self, id: &str) -> Result<Server> {
        self.servers()?
            .into_iter()
            .find(|s| s.id == id)
            .ok_or_else(|| Error::Unsuitable("That server isn't saved any more. Add it again in Settings › Servers.".into()))
    }

    fn save_servers(&self, servers: &[Server]) -> Result<()> {
        self.set_setting(SETTINGS_KEY, &serde_json::to_string(servers)?)
    }

    /// Adds or changes a server once its settings look right. Stray spaces
    /// are trimmed from everything but the password, kept exactly as typed.
    pub fn save_server(&self, input: &ServerInput) -> Result<ServerView> {
        let mut servers = self.servers()?;
        let before = input.id.as_ref().and_then(|id| servers.iter().find(|s| &s.id == id)).cloned();
        if input.id.is_some() && before.is_none() {
            return Err(Error::Unsuitable("That server isn't saved any more. Add it again.".into()));
        }
        let host = input.host.trim().trim_end_matches('.').to_string();
        let password = match input.password.as_deref().filter(|p| !p.is_empty()) {
            Some(p) => p.to_string(),
            None => before.as_ref().map(|s| s.password.clone()).unwrap_or_default(),
        };
        // A different address may be a different machine: its key is learnt afresh.
        let same_machine = before.as_ref().is_some_and(|b| b.host.eq_ignore_ascii_case(&host) && b.port == input.port && b.protocol == input.protocol);
        let server = Server {
            id: before.as_ref().map(|b| b.id.clone()).unwrap_or_else(crate::ids::new_record_id),
            name: Some(input.name.trim()).filter(|n| !n.is_empty()).unwrap_or(&host).to_string(),
            protocol: input.protocol,
            host,
            port: input.port,
            username: input.username.trim().to_string(),
            password,
            login: if input.protocol == Protocol::Sftp { input.login } else { Login::Password },
            key_file: input.key_file.as_deref().map(str::trim).filter(|k| !k.is_empty()).map(String::from),
            folder: normalise(&input.folder),
            host_key: if same_machine { before.as_ref().and_then(|b| b.host_key.clone()) } else { None },
        };
        check(&server)?;
        match servers.iter_mut().find(|s| s.id == server.id) {
            Some(saved) => *saved = server.clone(),
            None => servers.push(server.clone()),
        }
        self.save_servers(&servers)?;
        Ok(ServerView::from(&server))
    }

    pub fn remove_server(&self, id: &str) -> Result<()> {
        let mut servers = self.servers()?;
        servers.retain(|s| s.id != id);
        self.save_servers(&servers)
    }

    /// Remembers the key a server showed, once the person has said it's theirs.
    pub fn trust_server_key(&self, id: &str, fingerprint: &str) -> Result<ServerView> {
        let mut servers = self.servers()?;
        let server = servers
            .iter_mut()
            .find(|s| s.id == id)
            .ok_or_else(|| Error::Unsuitable("That server isn't saved any more.".into()))?;
        server.host_key = Some(fingerprint.to_string());
        let view = ServerView::from(&*server);
        self.save_servers(&servers)?;
        Ok(view)
    }
}

/// One thing in a server's folder.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
}

/// A folder as the Browse dialog shows it: only folders, and files TBV can
/// import, folders first.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Listing {
    pub path: String,
    pub entries: Vec<RemoteEntry>,
    /// Files left out because TBV can't import them.
    pub hidden: usize,
}

/// The network side, kept behind this so everything else is testable.
pub trait Connection: Send {
    /// The folder the account starts in.
    fn home(&mut self) -> Result<String>;
    /// Everything in a folder, unfiltered.
    fn list(&mut self, path: &str) -> Result<Vec<RemoteEntry>>;
    /// Writes a file's bytes to `out`, calling `progress` with each piece's
    /// size. `progress` returning false stops the download.
    fn fetch(&mut self, path: &str, out: &mut dyn Write, progress: &mut dyn FnMut(u64) -> bool) -> Result<u64>;
}

/// Connects and signs in. A server TBV hasn't met before (SFTP, or FTPS
/// with its own certificate) gives `Error::NewHostKey` with its
/// fingerprint, for the person to check.
pub fn connect(server: &Server) -> Result<Box<dyn Connection>> {
    match server.protocol {
        Protocol::Ftp | Protocol::Ftps => Ok(Box::new(ftp::FtpConnection::open(server)?)),
        Protocol::Sftp => Ok(Box::new(sftp::SftpConnection::open(server)?)),
    }
}

/// What a server looks like from a quick test: where it starts, and how
/// many things are there.
pub fn test(server: &Server) -> Result<String> {
    let mut connection = connect(server)?;
    let start = start_folder(connection.as_mut(), server)?;
    let found = list_importable(connection.as_mut(), &start)?;
    let folders = found.entries.iter().filter(|e| e.is_dir).count();
    let books = found.entries.len() - folders;
    Ok(format!(
        "Connected to {}. {} has {} and {}.",
        server.name,
        if start == "/" { "The top folder".to_string() } else { start.clone() },
        plural(folders, "folder"),
        plural(books, "file TBV can import")
    ))
}

fn plural(n: usize, what: &str) -> String {
    match (n, what.split_once(' ')) {
        (1, _) => format!("1 {what}"),
        (_, Some((noun, rest))) => format!("{n} {noun}s {rest}"),
        _ => format!("{n} {what}s"),
    }
}

/// Where browsing starts: the saved folder, or the account's own.
pub fn start_folder(connection: &mut dyn Connection, server: &Server) -> Result<String> {
    if server.folder.is_empty() {
        Ok(normalise(&connection.home()?))
    } else if server.folder.starts_with('/') {
        Ok(server.folder.clone())
    } else {
        // A folder in the account's own, so every path shown is a full one.
        Ok(normalise(&join(&connection.home()?, &server.folder)))
    }
}

/// A folder's folders and importable files, sorted for showing.
pub fn list_importable(connection: &mut dyn Connection, path: &str) -> Result<Listing> {
    let path = normalise(path);
    let all = connection.list(&path)?;
    let mut hidden = 0;
    let mut entries: Vec<RemoteEntry> = all
        .into_iter()
        .filter(|e| usable_name(&e.name))
        .filter(|e| {
            let keep = e.is_dir || importable(&e.name);
            hidden += usize::from(!keep);
            keep
        })
        .map(|mut e| {
            e.path = join(&path, &e.name);
            e
        })
        .collect();
    entries.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then_with(|| natural_key(&a.name).cmp(&natural_key(&b.name))));
    Ok(Listing { path, entries, hidden })
}

/// Case-insensitive, with numbers in order (Part 2 before Part 10).
fn natural_key(name: &str) -> Vec<(String, u64)> {
    let lower = name.to_lowercase();
    let mut key = Vec::new();
    let mut text = String::new();
    let mut digits = String::new();
    for c in lower.chars() {
        if c.is_ascii_digit() {
            digits.push(c);
        } else {
            if !digits.is_empty() {
                key.push((std::mem::take(&mut text), digits.parse().unwrap_or(u64::MAX)));
                digits.clear();
            }
            text.push(c);
        }
    }
    key.push((text, digits.parse().unwrap_or(0)));
    key
}

/// Names a server may send that never become files here: dot files, the
/// folder itself and its parent, and anything that would reach outside its
/// folder.
fn usable_name(name: &str) -> bool {
    !name.is_empty() && !name.starts_with('.') && !name.contains(['/', '\\', '\0'])
}

/// A file TBV can import, by its extension.
pub fn importable(name: &str) -> bool {
    usable_name(name)
        && name
            .rsplit_once('.')
            .is_some_and(|(stem, ext)| !stem.is_empty() && SUPPORTED_FORMATS.contains(&ext.to_ascii_lowercase().as_str()))
}

/// A server path tidied: forward slashes, no `.` or `..`, no trailing slash.
/// Empty stays empty (the account's own folder).
pub fn normalise(path: &str) -> String {
    let path = path.trim().replace('\\', "/");
    if path.is_empty() {
        return String::new();
    }
    let absolute = path.starts_with('/');
    let mut parts: Vec<&str> = Vec::new();
    for part in path.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            p => parts.push(p),
        }
    }
    let joined = parts.join("/");
    if absolute {
        format!("/{joined}")
    } else if joined.is_empty() {
        ".".into()
    } else {
        joined
    }
}

pub fn join(dir: &str, name: &str) -> String {
    match dir {
        "" | "." => name.to_string(),
        d if d.ends_with('/') => format!("{d}{name}"),
        d => format!("{d}/{name}"),
    }
}

/// The last part of a server path.
fn base_name(path: &str) -> &str {
    path.trim_end_matches('/').rsplit('/').next().unwrap_or(path)
}

/// A name from a server made safe to use as a file or folder name here, on
/// Windows too.
pub fn local_name(name: &str) -> String {
    let cleaned: String = name.chars().map(|c| if "<>:\"/\\|?*".contains(c) || c.is_control() { '_' } else { c }).collect();
    let trimmed = cleaned.trim().trim_end_matches(['.', ' ']).to_string();
    let stem = trimmed.split('.').next().unwrap_or("").to_ascii_uppercase();
    let reserved = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (stem.len() == 4 && (stem.starts_with("COM") || stem.starts_with("LPT")) && stem.as_bytes()[3].is_ascii_digit());
    match trimmed.as_str() {
        "" | "." | ".." => "_".into(),
        t if reserved => format!("_{t}"),
        t => t.to_string(),
    }
}

/// Something ticked in the Browse dialog.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Chosen {
    pub path: String,
    pub is_dir: bool,
    #[serde(default)]
    pub size: u64,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Stage {
    /// Connecting, and looking through the chosen folders.
    #[default]
    Looking,
    Downloading,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    pub stage: Stage,
    pub files_done: usize,
    pub files_total: usize,
    pub bytes_done: u64,
    pub bytes_total: u64,
    /// The file coming down now.
    pub current: Option<String>,
}

/// One file to bring down, and where it goes under the downloads folder.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Planned {
    pub remote: String,
    pub local: PathBuf,
    pub size: u64,
}

/// What came down. `roots` are the chosen files and folders as they now
/// are on this computer, ready for the import queue.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Downloaded {
    pub roots: Vec<PathBuf>,
    pub files: usize,
    pub bytes: u64,
    pub stopped: bool,
}

/// Works out every file to bring down: chosen files as they are, chosen
/// folders searched through for files TBV can import, keeping their folders.
/// Each choice gets its own name at the top, so two `Book.epub`s from
/// different folders don't collide.
pub fn plan(connection: &mut dyn Connection, chosen: &[Chosen], cancel: &AtomicBool) -> Result<(Vec<PathBuf>, Vec<Planned>)> {
    let mut roots = Vec::new();
    let mut files = Vec::new();
    let mut taken = HashSet::new();
    for choice in chosen {
        let path = normalise(&choice.path);
        let name = base_name(&path);
        if !usable_name(name) || (!choice.is_dir && !importable(name)) {
            continue;
        }
        let root = unique(&local_name(name), &mut taken);
        let before = files.len();
        if choice.is_dir {
            walk(connection, &path, &PathBuf::from(&root), 0, &mut files, cancel)?;
        } else {
            files.push(Planned { remote: path, local: PathBuf::from(&root), size: choice.size });
        }
        if files.len() > before {
            roots.push(PathBuf::from(root));
        }
        if cancel.load(Ordering::Relaxed) {
            break;
        }
    }
    Ok((roots, files))
}

/// `name`, or `name (2)` and so on when it's already used. Compared without
/// case, as Windows does.
fn unique(name: &str, taken: &mut HashSet<String>) -> String {
    let mut candidate = name.to_string();
    let (stem, ext) = match name.rsplit_once('.') {
        Some((s, e)) if !s.is_empty() => (s, format!(".{e}")),
        _ => (name, String::new()),
    };
    let mut n = 2;
    while !taken.insert(candidate.to_lowercase()) {
        candidate = format!("{stem} ({n}){ext}");
        n += 1;
    }
    candidate
}

fn walk(connection: &mut dyn Connection, dir: &str, local: &Path, depth: usize, out: &mut Vec<Planned>, cancel: &AtomicBool) -> Result<()> {
    if depth > MAX_DEPTH || cancel.load(Ordering::Relaxed) {
        return Ok(());
    }
    let listing = list_importable(connection, dir)?;
    let mut taken = HashSet::new();
    for entry in listing.entries {
        let here = local.join(unique(&local_name(&entry.name), &mut taken));
        if entry.is_dir {
            walk(connection, &entry.path, &here, depth + 1, out, cancel)?;
        } else {
            if out.len() >= MAX_FILES {
                return Err(Error::Unsuitable(format!(
                    "That's more than {MAX_FILES} files. Choose fewer folders and try again."
                )));
            }
            out.push(Planned { remote: entry.path, local: here, size: entry.size });
        }
    }
    Ok(())
}

/// Brings down the chosen files and folders into `into`. Each file is
/// written beside its final name and renamed once whole, so an interrupted
/// download never leaves half a book to import.
pub fn download(
    connection: &mut dyn Connection,
    chosen: &[Chosen],
    into: &Path,
    cancel: &AtomicBool,
    progress: &mut dyn FnMut(&DownloadProgress),
) -> Result<Downloaded> {
    let mut state = DownloadProgress::default();
    progress(&state);
    let (roots, files) = plan(connection, chosen, cancel)?;
    if cancel.load(Ordering::Relaxed) {
        return Ok(Downloaded { stopped: true, ..Default::default() });
    }
    if files.is_empty() {
        return Err(Error::Unsuitable("There were no books, documents or audiobooks TBV can import in what you chose.".into()));
    }
    state.stage = Stage::Downloading;
    state.files_total = files.len();
    let mut listed: u64 = files.iter().map(|f| f.size).sum();
    state.bytes_total = listed;
    progress(&state);
    for file in &files {
        state.current = Some(file.local.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default());
        progress(&state);
        let target = into.join(&file.local);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)?;
        }
        let partial = target.with_file_name(format!("{}.part", target.file_name().unwrap_or_default().to_string_lossy()));
        let mut out = fs::File::create(&partial)?;
        let start = state.bytes_done;
        let fetched = connection.fetch(&file.remote, &mut out, &mut |n| {
            state.bytes_done += n;
            // A file bigger than the server said stretches the total with it.
            state.bytes_total = state.bytes_total.max(state.bytes_done);
            progress(&state);
            !cancel.load(Ordering::Relaxed)
        });
        drop(out);
        if cancel.load(Ordering::Relaxed) {
            let _ = fs::remove_file(&partial);
            return Ok(Downloaded { roots, files: state.files_done, bytes: state.bytes_done, stopped: true });
        }
        let fetched = match fetched {
            Ok(n) => n,
            Err(e) => {
                let _ = fs::remove_file(&partial);
                return Err(e);
            }
        };
        fs::rename(&partial, &target)?;
        // Sizes in a listing can be missing or out of date; the file is the truth.
        listed = listed - file.size + fetched;
        state.bytes_done = start + fetched;
        state.bytes_total = listed.max(state.bytes_done);
        state.files_done += 1;
        progress(&state);
    }
    state.current = None;
    progress(&state);
    Ok(Downloaded { roots: roots.iter().map(|r| into.join(r)).collect(), files: state.files_done, bytes: state.bytes_done, stopped: false })
}

/// Brings down one file to `target`, written beside it and renamed once
/// whole. `progress` hears the bytes so far and returns false to stop, which
/// gives `Ok(None)` and leaves nothing behind.
pub fn fetch_file(
    connection: &mut dyn Connection,
    remote: &str,
    target: &Path,
    progress: &mut dyn FnMut(u64) -> bool,
) -> Result<Option<u64>> {
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)?;
    }
    let partial = queue::partial(target);
    let mut out = fs::File::create(&partial)?;
    let mut done = 0u64;
    let mut stopped = false;
    let fetched = connection.fetch(remote, &mut out, &mut |n| {
        done += n;
        let go = progress(done);
        stopped |= !go;
        go
    });
    drop(out);
    match fetched {
        Ok(_) if stopped => {
            let _ = fs::remove_file(&partial);
            Ok(None)
        }
        Ok(n) => {
            fs::rename(&partial, target)?;
            Ok(Some(n))
        }
        Err(e) => {
            let _ = fs::remove_file(&partial);
            if stopped {
                Ok(None)
            } else {
                Err(e)
            }
        }
    }
}

/// Where downloads wait for the import queue, inside TBV's own data folder.
pub fn downloads_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("Server downloads")
}

/// A folder of downloads that's deleted once nothing needs it any more:
/// when the last import that uses it lets go.
#[derive(Debug)]
pub struct TempFolder(PathBuf);

impl TempFolder {
    /// A new, empty folder under `parent`.
    pub fn new(parent: &Path) -> Result<Self> {
        let path = parent.join(crate::ids::new_record_id());
        fs::create_dir_all(&path)?;
        Ok(Self(path))
    }

    pub fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TempFolder {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

/// Copies from a reader to `out` in pieces, reporting each one, until the
/// end or until `progress` says stop.
pub(crate) fn copy_with_progress(
    from: &mut dyn std::io::Read,
    out: &mut dyn Write,
    progress: &mut dyn FnMut(u64) -> bool,
) -> std::io::Result<(u64, bool)> {
    let mut buffer = vec![0u8; 256 * 1024];
    let mut total = 0u64;
    loop {
        let n = match from.read(&mut buffer) {
            Ok(0) => return Ok((total, true)),
            Ok(n) => n,
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(e) => return Err(e),
        };
        out.write_all(&buffer[..n])?;
        total += n as u64;
        if !progress(n as u64) {
            return Ok((total, false));
        }
    }
}

/// Words for a connection that failed at the network level.
pub(crate) fn network_problem(e: &std::io::Error, server: &Server) -> Error {
    use std::io::ErrorKind::*;
    let at = format!("{} (port {})", server.host, server.port);
    Error::Unsuitable(match e.kind() {
        ConnectionRefused => format!("{at} turned the connection away. Check the port, and that the server is running and allows {}.", label(server.protocol)),
        TimedOut | WouldBlock => format!("{at} didn't answer in time. Check the address and port, and your internet connection."),
        ConnectionReset | ConnectionAborted | UnexpectedEof | BrokenPipe | NotConnected => {
            format!("The connection to {} was lost part-way. Check your internet connection and try again.", server.host)
        }
        HostUnreachable | NetworkUnreachable | NetworkDown => format!("TBV can't reach {at} from this network. Check your internet connection."),
        _ => format!("TBV couldn't connect to {at}: {e}."),
    })
}

/// Turns the address into places to connect, or says the name wasn't found.
pub(crate) fn resolve(server: &Server) -> Result<Vec<std::net::SocketAddr>> {
    use std::net::ToSocketAddrs;
    let not_found = || {
        Error::Unsuitable(format!(
            "TBV couldn't find a server called {}. Check the spelling of the address and your internet connection.",
            server.host
        ))
    };
    let addresses: Vec<_> = (server.host.as_str(), server.port).to_socket_addrs().map_err(|_| not_found())?.collect();
    if addresses.is_empty() {
        return Err(not_found());
    }
    Ok(addresses)
}

pub(crate) fn label(protocol: Protocol) -> &'static str {
    match protocol {
        Protocol::Ftp => "FTP",
        Protocol::Ftps => "FTPS",
        Protocol::Sftp => "SFTP",
    }
}

#[cfg(test)]
mod tests;

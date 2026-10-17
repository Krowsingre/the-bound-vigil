//! SFTP, which most seedboxes offer, through russh (pure Rust, with ring
//! for its crypto like the rest of TBV). russh is async, so each connection
//! keeps a small runtime of its own and waits on it; callers see plain
//! blocking calls like FTP's.
//!
//! The server's key is checked on every connection. The first time, TBV
//! shows its fingerprint for the person to check and remember (trust on
//! first use); after that a different key is refused, since it can mean
//! someone is pretending to be the server.

use std::io::Write;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use russh::client::{self, AuthResult, KeyboardInteractiveAuthResponse};
use russh::keys::{HashAlg, PrivateKeyWithHashAlg, PublicKeyOrCertificate};
use russh_sftp::client::error::Error as SftpError;
use russh_sftp::client::SftpSession;
use russh_sftp::protocol::StatusCode;
use tokio::io::AsyncReadExt;
use tokio::runtime::Runtime;
use tokio::time::timeout;

use super::{network_problem, resolve, Connection, Login, RemoteEntry, Server, CONNECT_TIMEOUT, READ_TIMEOUT};
use crate::error::{Error, Result};

/// Notes the key the server shows, and accepts it only if it's the one
/// trusted before.
struct KeyCheck {
    trusted: Option<String>,
    seen: Arc<Mutex<Option<String>>>,
}

impl client::Handler for KeyCheck {
    type Error = russh::Error;

    async fn check_server_key(&mut self, key: &PublicKeyOrCertificate) -> std::result::Result<bool, Self::Error> {
        let fingerprint = match key {
            PublicKeyOrCertificate::PublicKey { key, .. } => key.fingerprint(HashAlg::Sha256),
            PublicKeyOrCertificate::Certificate(cert) => cert.public_key().fingerprint(HashAlg::Sha256),
        }
        .to_string();
        let trusted = self.trusted.as_deref() == Some(fingerprint.as_str());
        if let Ok(mut seen) = self.seen.lock() {
            *seen = Some(fingerprint);
        }
        Ok(trusted)
    }
}

pub(crate) struct SftpConnection {
    // Dropped in this order: the SFTP channel, then the connection, then
    // the runtime they run on.
    sftp: Option<SftpSession>,
    session: Option<client::Handle<KeyCheck>>,
    runtime: Runtime,
    server: Server,
}

/// Waits on something with a time limit, turning running out of time into words.
async fn within<T, E>(limit: Duration, server: &Server, work: impl std::future::Future<Output = std::result::Result<T, E>>) -> Result<std::result::Result<T, E>> {
    timeout(limit, work).await.map_err(|_| network_problem(&std::io::ErrorKind::TimedOut.into(), server))
}

impl SftpConnection {
    pub(crate) fn open(server: &Server) -> Result<Self> {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|e| Error::Unsuitable(format!("TBV couldn't get ready to connect: {e}")))?;
        let addresses = resolve(server)?;
        let seen = Arc::new(Mutex::new(None));
        let check = KeyCheck { trusted: server.host_key.clone(), seen: seen.clone() };
        let (session, sftp) = runtime.block_on(async {
            let tcp = within(CONNECT_TIMEOUT, server, tokio::net::TcpStream::connect(&addresses[..]))
                .await?
                .map_err(|e| network_problem(&e, server))?;
            let config = client::Config { keepalive_interval: Some(Duration::from_secs(30)), ..Default::default() };
            let connected = within(CONNECT_TIMEOUT, server, client::connect_stream(Arc::new(config), tcp, check)).await?;
            let mut session = match connected {
                Ok(session) => session,
                Err(e) => {
                    let seen = seen.lock().ok().and_then(|s| s.clone());
                    return Err(key_problem(server, seen).unwrap_or_else(|| ssh_problem(&e, server)));
                }
            };
            sign_in(&mut session, server).await?;
            let channel = within(READ_TIMEOUT, server, session.channel_open_session()).await?.map_err(|e| ssh_problem(&e, server))?;
            within(READ_TIMEOUT, server, channel.request_subsystem(true, "sftp")).await?.map_err(|e| ssh_problem(&e, server))?;
            let sftp = within(READ_TIMEOUT, server, SftpSession::new(channel.into_stream()))
                .await?
                .map_err(|_| Error::Unsuitable(format!("{} doesn't offer SFTP for this account. Check with whoever runs it.", server.host)))?;
            sftp.set_timeout(READ_TIMEOUT.as_secs());
            Ok((session, sftp))
        })?;
        Ok(Self { sftp: Some(sftp), session: Some(session), runtime, server: server.clone() })
    }

    fn sftp(&self) -> &SftpSession {
        self.sftp.as_ref().expect("open until dropped")
    }
}

/// Why the server's key wasn't accepted, if that's what stopped the connection.
fn key_problem(server: &Server, seen: Option<String>) -> Option<Error> {
    let seen = seen?;
    match &server.host_key {
        None => Some(Error::NewHostKey(seen)),
        Some(trusted) if *trusted != seen => Some(Error::Unsuitable(format!(
            "{} isn't showing the key it showed before, so TBV didn't connect. If whoever runs the server has just set it up again, remove it from Settings › Servers and add it again. If not, someone may be pretending to be your server: don't connect until you've checked.",
            server.host
        ))),
        Some(_) => None,
    }
}

async fn sign_in(session: &mut client::Handle<KeyCheck>, server: &Server) -> Result<()> {
    let wrong = || Error::Unsuitable(format!("{} didn't accept the username and password. Check them and try again.", server.host));
    let result = match server.login {
        Login::Password => {
            let first = within(READ_TIMEOUT, server, session.authenticate_password(&server.username, &server.password))
                .await?
                .map_err(|e| ssh_problem(&e, server))?;
            match first {
                AuthResult::Success => return Ok(()),
                // Some servers ask for the password as a question instead.
                AuthResult::Failure { remaining_methods, .. } if remaining_methods.contains(&russh::MethodKind::KeyboardInteractive) => {
                    return if keyboard_interactive(session, server).await? { Ok(()) } else { Err(wrong()) };
                }
                failed => failed,
            }
        }
        Login::Key => {
            let file = server.key_file.clone().unwrap_or_default();
            let key = load_key(Path::new(&file), &server.password)?;
            let hash = within(READ_TIMEOUT, server, session.best_supported_rsa_hash()).await?.ok().flatten().flatten();
            let result = within(READ_TIMEOUT, server, session.authenticate_publickey(&server.username, PrivateKeyWithHashAlg::new(Arc::new(key), hash)))
                .await?
                .map_err(|e| ssh_problem(&e, server))?;
            if !result.success() {
                return Err(Error::Unsuitable(format!(
                    "{} didn't accept your key for {}. Check the username, and that the server has this key's public half.",
                    server.host, server.username
                )));
            }
            result
        }
    };
    if result.success() {
        Ok(())
    } else {
        Err(wrong())
    }
}

/// Answers each question the server asks with the password.
async fn keyboard_interactive(session: &mut client::Handle<KeyCheck>, server: &Server) -> Result<bool> {
    let mut reply = within(READ_TIMEOUT, server, session.authenticate_keyboard_interactive_start(&server.username, None))
        .await?
        .map_err(|e| ssh_problem(&e, server))?;
    for _ in 0..5 {
        match reply {
            KeyboardInteractiveAuthResponse::Success => return Ok(true),
            KeyboardInteractiveAuthResponse::Failure { .. } => return Ok(false),
            KeyboardInteractiveAuthResponse::InfoRequest { prompts, .. } => {
                let answers = prompts.iter().map(|_| server.password.clone()).collect();
                reply = within(READ_TIMEOUT, server, session.authenticate_keyboard_interactive_respond(answers))
                    .await?
                    .map_err(|e| ssh_problem(&e, server))?;
            }
        }
    }
    Ok(false)
}

fn load_key(path: &Path, passphrase: &str) -> Result<russh::keys::PrivateKey> {
    if !path.is_file() {
        return Err(Error::Unsuitable(format!("TBV can't find the key file {}. Choose it again.", path.display())));
    }
    let passphrase = Some(passphrase).filter(|p| !p.is_empty());
    russh::keys::load_secret_key(path, passphrase).map_err(|e| {
        Error::Unsuitable(match e {
            russh::keys::Error::KeyIsEncrypted => "This key file is locked with a passphrase. Type it in the password box.".into(),
            russh::keys::Error::IO(_) => format!("TBV couldn't open the key file {}.", path.display()),
            _ if passphrase.is_some() => "TBV couldn't unlock the key file. Check the passphrase in the password box.".into(),
            other => format!("TBV couldn't read the key file. It should be an OpenSSH private key ({other})."),
        })
    })
}

fn ssh_problem(e: &russh::Error, server: &Server) -> Error {
    match e {
        russh::Error::IO(io) => network_problem(io, server),
        russh::Error::Disconnect | russh::Error::HUP | russh::Error::SendError => {
            network_problem(&std::io::ErrorKind::ConnectionReset.into(), server)
        }
        russh::Error::ConnectionTimeout | russh::Error::KeepaliveTimeout | russh::Error::InactivityTimeout => {
            network_problem(&std::io::ErrorKind::TimedOut.into(), server)
        }
        russh::Error::Version => Error::Unsuitable(format!(
            "{} (port {}) doesn't speak SFTP. Check the port: SFTP usually uses 22, and FTP 21.",
            server.host, server.port
        )),
        russh::Error::NoCommonAlgo { .. } | russh::Error::Kex | russh::Error::KexInit => Error::Unsuitable(format!(
            "TBV and {} couldn't agree on a secure way to talk. The server may be too old for TBV.",
            server.host
        )),
        other => Error::Unsuitable(format!("Something went wrong talking to {}: {other}", server.host)),
    }
}

fn sftp_problem(e: SftpError, server: &Server, path: &str) -> Error {
    match e {
        SftpError::Status(status) => Error::Unsuitable(match status.status_code {
            StatusCode::NoSuchFile => format!("{path} isn't on {} any more. Go back and look again.", server.host),
            StatusCode::PermissionDenied => format!("{} wouldn't let this account open {path}.", server.host),
            StatusCode::NoConnection | StatusCode::ConnectionLost => {
                format!("The connection to {} was lost part-way. Check your internet connection and try again.", server.host)
            }
            _ => format!("{} couldn't open {path}: {}", server.host, status.error_message),
        }),
        SftpError::Timeout => network_problem(&std::io::ErrorKind::TimedOut.into(), server),
        SftpError::IO(_) => network_problem(&std::io::ErrorKind::ConnectionReset.into(), server),
        other => Error::Unsuitable(format!("Something went wrong talking to {}: {other}", server.host)),
    }
}

impl Connection for SftpConnection {
    fn home(&mut self) -> Result<String> {
        let (sftp, server) = (self.sftp(), &self.server);
        self.runtime.block_on(sftp.canonicalize(".")).map_err(|e| sftp_problem(e, server, "your folder"))
    }

    fn list(&mut self, path: &str) -> Result<Vec<RemoteEntry>> {
        let (sftp, server) = (self.sftp(), &self.server);
        let path = if path.is_empty() { "." } else { path };
        self.runtime.block_on(async {
            let entries = sftp.read_dir(path).await.map_err(|e| sftp_problem(e, server, path))?;
            let mut out = Vec::new();
            for entry in entries {
                let name = entry.file_name();
                let mut meta = entry.metadata();
                // A link (common on seedboxes) is listed as itself; what it
                // points at says whether it's a folder.
                if meta.is_symlink() {
                    match sftp.metadata(entry.path()).await {
                        Ok(target) => meta = target,
                        Err(_) => continue,
                    }
                }
                if meta.is_dir() || meta.is_regular() {
                    out.push(RemoteEntry { path: entry.path(), is_dir: meta.is_dir(), size: if meta.is_dir() { 0 } else { meta.len() }, name });
                }
            }
            Ok(out)
        })
    }

    fn fetch(&mut self, path: &str, out: &mut dyn Write, progress: &mut dyn FnMut(u64) -> bool) -> Result<u64> {
        let (sftp, server) = (self.sftp(), &self.server);
        self.runtime.block_on(async {
            let mut file = sftp.open(path).await.map_err(|e| sftp_problem(e, server, path))?;
            let mut buffer = vec![0u8; 256 * 1024];
            let mut total = 0u64;
            loop {
                let n = within(READ_TIMEOUT, server, file.read(&mut buffer)).await?.map_err(|e| network_problem(&e, server))?;
                if n == 0 {
                    break;
                }
                out.write_all(&buffer[..n])?;
                total += n as u64;
                if !progress(n as u64) {
                    break;
                }
            }
            let _ = file.shutdown_ok().await;
            Ok(total)
        })
    }
}

/// Closing a file politely; not every server answers, so it isn't waited on long.
trait ShutdownOk {
    async fn shutdown_ok(&mut self) -> std::io::Result<()>;
}

impl ShutdownOk for russh_sftp::client::fs::File {
    async fn shutdown_ok(&mut self) -> std::io::Result<()> {
        use tokio::io::AsyncWriteExt;
        timeout(Duration::from_secs(5), self.shutdown()).await.unwrap_or(Ok(()))
    }
}

impl Drop for SftpConnection {
    fn drop(&mut self) {
        let _inside = self.runtime.enter();
        drop(self.sftp.take());
        if let Some(session) = self.session.take() {
            let _ = self.runtime.block_on(timeout(Duration::from_secs(2), session.disconnect(russh::Disconnect::ByApplication, "", "en")));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::servers::{download, list_importable, Chosen, Protocol};
    use russh::server::{Auth, ChannelOpenHandle, Msg, Session};
    use russh::{Channel, ChannelId};
    use russh_sftp::protocol::{Attrs, Data, File, FileAttributes, Handle, Name, OpenFlags, Status, Version};
    use std::collections::HashMap;
    use std::path::PathBuf;
    use std::sync::atomic::AtomicBool;

    /// A small SFTP server over a folder, for one account.
    struct SshSide {
        root: PathBuf,
        channels: HashMap<ChannelId, Channel<Msg>>,
    }

    impl russh::server::Handler for SshSide {
        type Error = russh::Error;

        async fn auth_password(&mut self, user: &str, password: &str) -> std::result::Result<Auth, Self::Error> {
            Ok(if user == "wren" && password == "right" { Auth::Accept } else { Auth::reject() })
        }

        async fn channel_open_session(&mut self, channel: Channel<Msg>, reply: ChannelOpenHandle, _: &mut Session) -> std::result::Result<(), Self::Error> {
            self.channels.insert(channel.id(), channel);
            reply.accept().await;
            Ok(())
        }

        async fn subsystem_request(&mut self, id: ChannelId, name: &str, session: &mut Session) -> std::result::Result<(), Self::Error> {
            match (name, self.channels.remove(&id)) {
                ("sftp", Some(channel)) => {
                    session.channel_success(id)?;
                    russh_sftp::server::run(channel.into_stream(), SftpSide { root: self.root.clone(), handles: HashMap::new(), next: 0 }).await;
                }
                _ => session.channel_failure(id)?,
            }
            Ok(())
        }
    }

    enum Open {
        Dir(Option<Vec<File>>),
        File(PathBuf),
    }

    struct SftpSide {
        root: PathBuf,
        handles: HashMap<String, Open>,
        next: u32,
    }

    impl SftpSide {
        fn local(&self, path: &str) -> PathBuf {
            self.root.join(path.trim_start_matches('/'))
        }

        fn handle(&mut self, open: Open) -> String {
            self.next += 1;
            self.handles.insert(self.next.to_string(), open);
            self.next.to_string()
        }
    }

    impl russh_sftp::server::Handler for SftpSide {
        type Error = StatusCode;

        fn unimplemented(&self) -> Self::Error {
            StatusCode::OpUnsupported
        }

        async fn init(&mut self, _: u32, _: HashMap<String, String>) -> std::result::Result<Version, Self::Error> {
            Ok(Version::new())
        }

        async fn realpath(&mut self, id: u32, path: String) -> std::result::Result<Name, Self::Error> {
            let path = if path == "." { "/".to_string() } else { path };
            Ok(Name { id, files: vec![File::dummy(path)] })
        }

        async fn opendir(&mut self, id: u32, path: String) -> std::result::Result<Handle, Self::Error> {
            let dir = std::fs::read_dir(self.local(&path)).map_err(|_| StatusCode::NoSuchFile)?;
            let files = dir
                .flatten()
                .map(|e| File::new(e.file_name().to_string_lossy(), FileAttributes::from(&e.metadata().unwrap())))
                .collect();
            Ok(Handle { id, handle: self.handle(Open::Dir(Some(files))) })
        }

        async fn readdir(&mut self, id: u32, handle: String) -> std::result::Result<Name, Self::Error> {
            match self.handles.get_mut(&handle) {
                Some(Open::Dir(files)) => files.take().map(|files| Name { id, files }).ok_or(StatusCode::Eof),
                _ => Err(StatusCode::Failure),
            }
        }

        async fn stat(&mut self, id: u32, path: String) -> std::result::Result<Attrs, Self::Error> {
            let meta = std::fs::metadata(self.local(&path)).map_err(|_| StatusCode::NoSuchFile)?;
            Ok(Attrs { id, attrs: FileAttributes::from(&meta) })
        }

        async fn lstat(&mut self, id: u32, path: String) -> std::result::Result<Attrs, Self::Error> {
            self.stat(id, path).await
        }

        async fn open(&mut self, id: u32, filename: String, _: OpenFlags, _: FileAttributes) -> std::result::Result<Handle, Self::Error> {
            let path = self.local(&filename);
            if !path.is_file() {
                return Err(StatusCode::NoSuchFile);
            }
            Ok(Handle { id, handle: self.handle(Open::File(path)) })
        }

        async fn fstat(&mut self, id: u32, handle: String) -> std::result::Result<Attrs, Self::Error> {
            match self.handles.get(&handle) {
                Some(Open::File(path)) => Ok(Attrs { id, attrs: FileAttributes::from(&std::fs::metadata(path).unwrap()) }),
                _ => Err(StatusCode::Failure),
            }
        }

        async fn read(&mut self, id: u32, handle: String, offset: u64, len: u32) -> std::result::Result<Data, Self::Error> {
            let Some(Open::File(path)) = self.handles.get(&handle) else { return Err(StatusCode::Failure) };
            let bytes = std::fs::read(path).map_err(|_| StatusCode::Failure)?;
            let start = offset as usize;
            if start >= bytes.len() {
                return Err(StatusCode::Eof);
            }
            let end = (start + len as usize).min(bytes.len());
            Ok(Data { id, data: bytes[start..end].to_vec() })
        }

        async fn close(&mut self, id: u32, handle: String) -> std::result::Result<Status, Self::Error> {
            self.handles.remove(&handle);
            Ok(Status { id, status_code: StatusCode::Ok, error_message: "Ok".into(), language_tag: "en-US".into() })
        }
    }

    /// Starts the server on its own thread. Its key is made from `seed`, so
    /// a different seed is a different machine.
    fn sftp_server(root: PathBuf, seed: u8) -> u16 {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        listener.set_nonblocking(true).unwrap();
        std::thread::spawn(move || {
            let runtime = tokio::runtime::Builder::new_multi_thread().worker_threads(2).enable_all().build().unwrap();
            runtime.block_on(async move {
                let key = russh::keys::PrivateKey::from(russh::keys::ssh_key::private::Ed25519Keypair::from_seed(&[seed; 32]));
                let config = Arc::new(russh::server::Config { keys: vec![key], auth_rejection_time: Duration::from_millis(10), ..Default::default() });
                let listener = tokio::net::TcpListener::from_std(listener).unwrap();
                loop {
                    let Ok((socket, _)) = listener.accept().await else { break };
                    let (config, root) = (config.clone(), root.clone());
                    tokio::spawn(async move {
                        if let Ok(running) = russh::server::run_stream(config, socket, SshSide { root, channels: HashMap::new() }).await {
                            let _ = running.await;
                        }
                    });
                }
            });
        });
        port
    }

    fn server(port: u16, password: &str, host_key: Option<String>) -> Server {
        Server {
            id: "s".into(),
            name: "Seedbox".into(),
            protocol: Protocol::Sftp,
            host: "127.0.0.1".into(),
            port,
            username: "wren".into(),
            password: password.into(),
            login: Login::Password,
            key_file: None,
            folder: String::new(),
            host_key,
        }
    }

    fn failure(server: &Server) -> Error {
        match SftpConnection::open(server) {
            Err(e) => e,
            Ok(_) => panic!("connected"),
        }
    }

    #[test]
    fn learns_the_servers_key_then_lists_and_downloads() {
        let served = tempfile::tempdir().unwrap();
        let book = served.path().join("Audiobooks").join("Carmilla");
        std::fs::create_dir_all(&book).unwrap();
        std::fs::write(book.join("Part 1.m4a"), vec![3u8; 100_000]).unwrap();
        std::fs::write(book.join("Part 2.m4a"), b"second").unwrap();
        std::fs::write(served.path().join("Lamps.epub"), b"PK lamps").unwrap();
        std::fs::write(served.path().join("readme.nfo"), b"x").unwrap();
        let port = sftp_server(served.path().to_path_buf(), 7);

        // First time: TBV stops and shows the key for the person to check.
        let fingerprint = match failure(&server(port, "right", None)) {
            Error::NewHostKey(f) => f,
            other => panic!("{other:?}"),
        };
        assert!(fingerprint.starts_with("SHA256:"), "{fingerprint}");

        // Once trusted, it connects.
        let mut connection = SftpConnection::open(&server(port, "right", Some(fingerprint.clone()))).unwrap();
        assert_eq!(connection.home().unwrap(), "/");
        let top = list_importable(&mut connection, "/").unwrap();
        let names: Vec<_> = top.entries.iter().map(|e| (e.name.as_str(), e.is_dir, e.size)).collect();
        assert_eq!(names, [("Audiobooks", true, 0), ("Lamps.epub", false, 8)]);
        assert_eq!(top.hidden, 1);

        let into = tempfile::tempdir().unwrap();
        let chosen = [Chosen { path: "/Audiobooks/Carmilla".into(), is_dir: true, size: 0 }];
        let got = download(&mut connection, &chosen, into.path(), &AtomicBool::new(false), &mut |_| {}).unwrap();
        assert_eq!(got.roots, [into.path().join("Carmilla")]);
        assert_eq!(std::fs::read(into.path().join("Carmilla").join("Part 1.m4a")).unwrap(), vec![3u8; 100_000]);
        assert_eq!(std::fs::read(into.path().join("Carmilla").join("Part 2.m4a")).unwrap(), b"second");
        drop(connection);

        // A wrong password is put plainly.
        match failure(&server(port, "wrong", Some(fingerprint.clone()))) {
            Error::Unsuitable(m) => assert!(m.contains("didn't accept the username and password"), "{m}"),
            other => panic!("{other:?}"),
        }

        // Another machine answering at the same address is refused.
        let impostor = sftp_server(served.path().to_path_buf(), 8);
        match failure(&server(impostor, "right", Some(fingerprint))) {
            Error::Unsuitable(m) => assert!(m.contains("isn't showing the key it showed before"), "{m}"),
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn a_missing_key_file_is_explained() {
        match load_key(Path::new("/no/such/key"), "") {
            Err(Error::Unsuitable(m)) => assert!(m.contains("can't find the key file"), "{m}"),
            other => panic!("{other:?}"),
        }
    }
}

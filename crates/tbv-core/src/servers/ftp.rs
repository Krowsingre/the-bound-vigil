//! FTP and FTPS (explicit TLS), through suppaftp with rustls, so nothing
//! needs OpenSSL. Plain FTP uses the same stream type and never switches to
//! TLS.

use std::io::Write;
use std::net::TcpStream;
use std::str::FromStr;
use std::sync::{Arc, Mutex};

use suppaftp::list::{File as ListedFile, ListParser};
use sha2::{Digest, Sha256};
use suppaftp::rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use suppaftp::rustls::client::WebPkiServerVerifier;
use suppaftp::rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use suppaftp::rustls::{ClientConfig, DigitallySignedStruct, Error as TlsError, RootCertStore, SignatureScheme};
use suppaftp::types::FileType;
use suppaftp::{FtpError, RustlsConnector, RustlsFtpStream, Status};

use super::{copy_with_progress, network_problem, resolve, Connection, Protocol, RemoteEntry, Server, CONNECT_TIMEOUT, READ_TIMEOUT};
use crate::error::{Error, Result};

pub(crate) struct FtpConnection {
    stream: RustlsFtpStream,
    server: Server,
}

/// Checks the server's certificate against the usual public authorities,
/// like a browser. A server with its own certificate (common on seedboxes)
/// is accepted only once the person has trusted that certificate's
/// fingerprint, and from then on only that certificate; until then the
/// fingerprint is kept in `seen` to show them.
#[derive(Debug)]
struct CertCheck {
    public: Arc<WebPkiServerVerifier>,
    trusted: Option<String>,
    seen: Arc<Mutex<Option<String>>>,
}

/// A certificate's SHA-256 fingerprint, written the way FileZilla shows it.
fn fingerprint(cert: &CertificateDer<'_>) -> String {
    let digest = Sha256::digest(cert.as_ref());
    let hex: Vec<String> = digest.iter().map(|b| format!("{b:02X}")).collect();
    format!("SHA256:{}", hex.join(":"))
}

impl ServerCertVerifier for CertCheck {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        intermediates: &[CertificateDer<'_>],
        server_name: &ServerName<'_>,
        ocsp_response: &[u8],
        now: UnixTime,
    ) -> std::result::Result<ServerCertVerified, TlsError> {
        let remember = |seen: String| *self.seen.lock().unwrap_or_else(|p| p.into_inner()) = Some(seen);
        // A trusted certificate is pinned: any other is refused, even one a
        // public authority vouches for.
        if let Some(trusted) = &self.trusted {
            let seen = fingerprint(end_entity);
            let same = *trusted == seen;
            remember(seen);
            return if same { Ok(ServerCertVerified::assertion()) } else { Err(TlsError::General("the server's certificate changed".into())) };
        }
        self.public.verify_server_cert(end_entity, intermediates, server_name, ocsp_response, now).inspect_err(|_| remember(fingerprint(end_entity)))
    }

    fn verify_tls12_signature(&self, message: &[u8], cert: &CertificateDer<'_>, dss: &DigitallySignedStruct) -> std::result::Result<HandshakeSignatureValid, TlsError> {
        self.public.verify_tls12_signature(message, cert, dss)
    }

    fn verify_tls13_signature(&self, message: &[u8], cert: &CertificateDer<'_>, dss: &DigitallySignedStruct) -> std::result::Result<HandshakeSignatureValid, TlsError> {
        self.public.verify_tls13_signature(message, cert, dss)
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.public.supported_verify_schemes()
    }
}

/// TLS with the same crypto (ring) the rest of TBV uses.
fn tls_config(server: &Server, seen: Arc<Mutex<Option<String>>>) -> Result<Arc<ClientConfig>> {
    let unsuitable = |e: &dyn std::fmt::Display| Error::Unsuitable(format!("A secure connection couldn't be set up: {e}"));
    let provider = Arc::new(suppaftp::rustls::crypto::ring::default_provider());
    let roots = Arc::new(RootCertStore { roots: webpki_roots::TLS_SERVER_ROOTS.to_vec() });
    let public = WebPkiServerVerifier::builder_with_provider(roots, provider.clone()).build().map_err(|e| unsuitable(&e))?;
    let check = CertCheck { public, trusted: server.host_key.clone(), seen };
    let config = ClientConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .map_err(|e| unsuitable(&e))?
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(check))
        .with_no_client_auth();
    Ok(Arc::new(config))
}

impl FtpConnection {
    pub(crate) fn open(server: &Server) -> Result<Self> {
        let addresses = resolve(server)?;
        let mut last = None;
        let mut control = None;
        for address in &addresses {
            match TcpStream::connect_timeout(address, CONNECT_TIMEOUT) {
                Ok(s) => {
                    control = Some(s);
                    break;
                }
                Err(e) => last = Some(e),
            }
        }
        let control = match (control, last) {
            (Some(c), _) => c,
            (None, Some(e)) => return Err(network_problem(&e, server)),
            (None, None) => return Err(network_problem(&std::io::ErrorKind::NotConnected.into(), server)),
        };
        let _ = control.set_read_timeout(Some(READ_TIMEOUT));
        let _ = control.set_write_timeout(Some(READ_TIMEOUT));
        let explain = |e: FtpError| explain(e, server, "");
        let stream = RustlsFtpStream::connect_with_stream(control).map_err(explain)?;
        // Data connections get the same time limits as the control one.
        let mut stream = stream.passive_stream_builder(|address| {
            let data = TcpStream::connect_timeout(&address, CONNECT_TIMEOUT).map_err(FtpError::ConnectionError)?;
            let _ = data.set_read_timeout(Some(READ_TIMEOUT));
            let _ = data.set_write_timeout(Some(READ_TIMEOUT));
            Ok(data)
        });
        // Servers behind a router often name their private address for
        // downloads; the one TBV reached them on works instead.
        stream.set_passive_nat_workaround(true);
        if server.protocol == Protocol::Ftps {
            let seen = Arc::new(Mutex::new(None));
            stream = stream.into_secure(RustlsConnector::from(tls_config(server, seen.clone())?), &server.host).map_err(|e| match e {
                FtpError::UnexpectedResponse(_) => Error::Unsuitable(format!(
                    "{} doesn't offer FTPS (FTP with TLS). Choose SFTP if your server has it, or plain FTP.",
                    server.host
                )),
                other => {
                    let seen = seen.lock().unwrap_or_else(|p| p.into_inner()).take();
                    super::sftp::key_problem(server, seen).unwrap_or_else(|| explain(other))
                }
            })?;
        }
        let password = if server.password.is_empty() { "tbv@localhost" } else { server.password.as_str() };
        stream.login(server.username.as_str(), password).map_err(|e| match e {
            FtpError::UnexpectedResponse(r) if matches!(r.status, Status::NotLoggedIn | Status::InvalidCredentials | Status::NeedPassword) => {
                wrong_login(server)
            }
            other => explain(other),
        })?;
        // Books are binary: text mode would change their bytes.
        stream.transfer_type(FileType::Binary).map_err(explain)?;
        Ok(Self { stream, server: server.clone() })
    }
}

fn wrong_login(server: &Server) -> Error {
    Error::Unsuitable(format!("{} didn't accept the username and password. Check them and try again.", server.host))
}

/// Puts what went wrong into words. `path` names what was being opened.
fn explain(e: FtpError, server: &Server, path: &str) -> Error {
    match e {
        FtpError::ConnectionError(io) => network_problem(&io, server),
        FtpError::SecureError(detail) => Error::Unsuitable(format!(
            "A secure (TLS) connection to {} couldn't be made ({detail}). Check the address and try again, or use SFTP if your server offers it.",
            server.host
        )),
        FtpError::UnexpectedResponse(r) => {
            let said = String::from_utf8_lossy(&r.body).trim().to_string();
            match r.status {
                Status::NotLoggedIn | Status::InvalidCredentials => wrong_login(server),
                Status::FileUnavailable | Status::RequestFileActionIgnored | Status::BadFilename => Error::Unsuitable(if path.is_empty() {
                    format!("{} said no: {said}", server.host)
                } else {
                    format!("{} wouldn't open {path}. Check the folder exists and this account can read it.", server.host)
                }),
                Status::NotAvailable => Error::Unsuitable(format!("{} closed the connection: {said}. Try again in a little while.", server.host)),
                Status::CannotOpenDataConnection | Status::TransferAborted => Error::Unsuitable(format!(
                    "The connection to {} was lost part-way. Check your internet connection and try again.",
                    server.host
                )),
                _ => Error::Unsuitable(format!("{} said: {said}", server.host)),
            }
        }
        other => Error::Unsuitable(format!("Something went wrong talking to {}: {other}", server.host)),
    }
}

/// Reads a listing line as MLSD gives it, or as LIST does (Unix or DOS style).
fn parse_line(line: &str, mlsd: bool) -> Option<RemoteEntry> {
    let file = if mlsd { ListParser::parse_mlsd(line).ok()? } else { ListedFile::from_str(line).ok()? };
    let name = file.name().to_string();
    if name == "." || name == ".." {
        return None;
    }
    // A link's type isn't known from LIST; treat it as a folder only if its
    // name has no book extension, and let listing it tell.
    let is_dir = file.is_directory() || (file.is_symlink() && !super::importable(&name));
    Some(RemoteEntry { path: name.clone(), name, is_dir, size: if is_dir { 0 } else { file.size() as u64 } })
}

impl Connection for FtpConnection {
    fn home(&mut self) -> Result<String> {
        let server = &self.server;
        self.stream.pwd().map_err(|e| explain(e, server, ""))
    }

    fn list(&mut self, path: &str) -> Result<Vec<RemoteEntry>> {
        let server = &self.server;
        let path = if path.is_empty() { "." } else { path };
        // Moving into the folder first copes with spaces and odd names that
        // some servers mishandle as a LIST argument.
        self.stream.cwd(path).map_err(|e| explain(e, server, path))?;
        match self.stream.mlsd(None) {
            Ok(lines) => Ok(lines.iter().filter_map(|l| parse_line(l, true)).collect()),
            Err(FtpError::UnexpectedResponse(r)) if matches!(r.status, Status::BadCommand | Status::NotImplemented | Status::CommandNotImplemented | Status::BadArguments) => {
                let lines = self.stream.list(None).map_err(|e| explain(e, server, path))?;
                Ok(lines.iter().filter_map(|l| parse_line(l, false)).collect())
            }
            Err(e) => Err(explain(e, server, path)),
        }
    }

    fn fetch(&mut self, path: &str, out: &mut dyn Write, progress: &mut dyn FnMut(u64) -> bool) -> Result<u64> {
        let server = self.server.clone();
        let mut transfer = self.stream.retr_as_stream(path).map_err(|e| explain(e, &server, path))?;
        let copied = copy_with_progress(&mut transfer, out, progress);
        match copied {
            Ok((n, true)) => {
                transfer.finish().map_err(|e| explain(e, &server, path))?;
                Ok(n)
            }
            Ok((n, false)) => {
                // Stopped: tell the server, and don't wait long for it.
                let _ = self.stream.abort(transfer);
                Ok(n)
            }
            Err(e) => Err(network_problem(&e, &server)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::servers::{download, list_importable, Chosen, Login};
    use std::io::{BufRead, BufReader};
    use std::net::TcpListener;
    use std::sync::atomic::AtomicBool;

    fn server(port: u16) -> Server {
        Server {
            id: "s".into(),
            name: "Test".into(),
            protocol: Protocol::Ftp,
            host: "127.0.0.1".into(),
            port,
            username: "wren".into(),
            password: "pw".into(),
            login: Login::Password,
            key_file: None,
            folder: String::new(),
            host_key: None,
        }
    }

    fn free_port() -> u16 {
        TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port()
    }

    /// A real FTP server (libunftp) serving a folder, on its own thread.
    fn ftp_server(root: std::path::PathBuf) -> u16 {
        serve(root, None)
    }

    /// The same, offering FTPS with its own certificate, as seedboxes often do.
    fn ftps_server(root: std::path::PathBuf) -> u16 {
        let certs = tempfile::tempdir().unwrap().keep();
        let (cert, key) = (certs.join("cert.pem"), certs.join("key.pem"));
        std::fs::write(&cert, SELF_SIGNED_CERT).unwrap();
        std::fs::write(&key, include_str!("testdata/self-signed-key.pem")).unwrap();
        serve(root, Some((cert, key)))
    }

    /// Connects to the test FTPS server. libunftp answers AUTH TLS before it
    /// switches to TLS, so on a busy machine it sometimes reads the start of
    /// the handshake as a command and replies in plain text; that one race
    /// is the test server's, so it's tried again.
    fn open_tls(server: &Server) -> Result<FtpConnection> {
        for _ in 0..10 {
            match FtpConnection::open(server) {
                Err(Error::Unsuitable(m)) if m.contains("InvalidContentType") => continue,
                other => return other,
            }
        }
        FtpConnection::open(server)
    }

    const SELF_SIGNED_CERT: &str = include_str!("testdata/self-signed-cert.pem");

    fn serve(root: std::path::PathBuf, tls: Option<(std::path::PathBuf, std::path::PathBuf)>) -> u16 {
        let port = free_port();
        let passive = free_port();
        std::thread::spawn(move || {
            let runtime = tokio::runtime::Builder::new_multi_thread().worker_threads(2).enable_all().build().unwrap();
            runtime.block_on(async move {
                let mut builder = libunftp::ServerBuilder::new(Box::new(move || unftp_sbe_fs::Filesystem::new(root.clone()).unwrap()))
                    .passive_ports(passive..=passive);
                if let Some((cert, key)) = tls {
                    builder = builder.ftps(cert, key);
                }
                let ftp = builder.build().unwrap();
                let _ = ftp.listen(format!("127.0.0.1:{port}")).await;
            });
        });
        // Wait until it answers.
        for _ in 0..100 {
            if std::net::TcpStream::connect(("127.0.0.1", port)).is_ok() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        port
    }

    #[test]
    fn lists_and_downloads_from_a_real_ftp_server() {
        let served = tempfile::tempdir().unwrap();
        let book = served.path().join("Audiobooks").join("Dracula");
        std::fs::create_dir_all(&book).unwrap();
        std::fs::write(book.join("01 Chapter.mp3"), vec![7u8; 300_000]).unwrap();
        std::fs::write(book.join("02 Chapter.mp3"), b"two").unwrap();
        std::fs::write(book.join("cover.jpg"), b"jpeg").unwrap();
        std::fs::write(served.path().join("Carmilla.epub"), b"PK carmilla").unwrap();
        let port = ftp_server(served.path().to_path_buf());

        let mut connection = FtpConnection::open(&server(port)).unwrap();
        let home = connection.home().unwrap();
        assert_eq!(home, "/");
        let top = list_importable(&mut connection, &home).unwrap();
        let names: Vec<_> = top.entries.iter().map(|e| (e.name.as_str(), e.is_dir, e.size)).collect();
        assert_eq!(names, [("Audiobooks", true, 0), ("Carmilla.epub", false, 11)]);

        let into = tempfile::tempdir().unwrap();
        let got = download(
            &mut connection,
            &[Chosen { path: "/Audiobooks".into(), is_dir: true, size: 0 }, Chosen { path: "/Carmilla.epub".into(), is_dir: false, size: 11 }],
            into.path(),
            &AtomicBool::new(false),
            &mut |_| {},
        )
        .unwrap();
        assert_eq!(got.files, 3);
        let dracula = into.path().join("Audiobooks").join("Dracula");
        // Binary mode: every byte arrives as it was.
        assert_eq!(std::fs::read(dracula.join("01 Chapter.mp3")).unwrap(), vec![7u8; 300_000]);
        assert_eq!(std::fs::read(dracula.join("02 Chapter.mp3")).unwrap(), b"two");
        assert!(!dracula.join("cover.jpg").exists());
        assert_eq!(std::fs::read(into.path().join("Carmilla.epub")).unwrap(), b"PK carmilla");

        // A missing folder is put plainly.
        match connection.list("/Nowhere") {
            Err(Error::Unsuitable(m)) => assert!(m.contains("wouldn't open /Nowhere"), "{m}"),
            other => panic!("{other:?}"),
        }
    }

    /// A pretend FTP server that turns every password away.
    fn refusing_server() -> u16 {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            let mut out = stream.try_clone().unwrap();
            let mut lines = BufReader::new(stream);
            out.write_all(b"220 pretend ready\r\n").unwrap();
            loop {
                let mut line = String::new();
                if lines.read_line(&mut line).unwrap_or(0) == 0 {
                    break;
                }
                let reply: &[u8] = match line.split_whitespace().next().unwrap_or("").to_uppercase().as_str() {
                    "USER" => b"331 password please\r\n",
                    "PASS" => b"530 Login incorrect.\r\n",
                    "AUTH" => b"502 not here\r\n",
                    _ => b"500 what\r\n",
                };
                out.write_all(reply).unwrap();
            }
        });
        port
    }

    fn failure(server: &Server) -> String {
        match FtpConnection::open(server) {
            Err(Error::Unsuitable(m)) => m,
            Err(other) => panic!("{other:?}"),
            Ok(_) => panic!("connected"),
        }
    }

    #[test]
    fn a_servers_own_certificate_is_trusted_once_the_person_says_so() {
        let served = tempfile::tempdir().unwrap();
        std::fs::write(served.path().join("Carmilla.epub"), b"PK carmilla").unwrap();
        let port = ftps_server(served.path().to_path_buf());
        let mut ftps = server(port);
        ftps.protocol = Protocol::Ftps;

        // First time: TBV stops and shows the certificate's fingerprint.
        let shown = match open_tls(&ftps) {
            Err(Error::NewHostKey(f)) => f,
            Err(other) => panic!("{other:?}"),
            Ok(_) => panic!("connected without asking"),
        };
        // As `openssl x509 -fingerprint -sha256` and FileZilla show it.
        assert_eq!(shown, "SHA256:2C:78:7E:87:C9:4F:03:AC:24:D0:0B:C2:31:6D:8E:6C:45:29:40:AA:57:DF:B5:5B:C2:D5:F4:24:85:DD:B3:2E");

        // Trusted, it connects, lists and downloads over TLS.
        ftps.host_key = Some(shown.clone());
        let mut connection = open_tls(&ftps).unwrap();
        let names: Vec<String> = connection.list("").unwrap().into_iter().map(|e| e.name).collect();
        assert_eq!(names, ["Carmilla.epub"]);
        let mut bytes = Vec::new();
        connection.fetch("Carmilla.epub", &mut bytes, &mut |_| true).unwrap();
        assert_eq!(bytes, b"PK carmilla");

        // A different certificate later is refused.
        ftps.host_key = Some("SHA256:00".into());
        match open_tls(&ftps) {
            Err(Error::Unsuitable(m)) => assert!(m.contains("isn't showing the fingerprint it showed before"), "{m}"),
            Err(other) => panic!("{other:?}"),
            Ok(_) => panic!("connected"),
        }
    }

    #[test]
    fn problems_are_put_plainly() {
        assert!(failure(&server(refusing_server())).contains("didn't accept the username and password"));
        let mut ftps = server(refusing_server());
        ftps.protocol = Protocol::Ftps;
        assert!(failure(&ftps).contains("doesn't offer FTPS"));
        // A port nothing listens on.
        assert!(failure(&server(free_port())).contains("turned the connection away"));
        let mut nowhere = server(21);
        nowhere.host = "no-such-server.invalid".into();
        assert!(failure(&nowhere).contains("couldn't find a server called no-such-server.invalid"));
    }

    #[test]
    fn listings_are_read_in_either_style() {
        let mlsd = parse_line("type=dir;modify=20240101000000; Audiobooks", true).unwrap();
        assert_eq!((mlsd.name.as_str(), mlsd.is_dir), ("Audiobooks", true));
        let file = parse_line("type=file;size=1234;modify=20240101000000; Carmilla.epub", true).unwrap();
        assert_eq!((file.name.as_str(), file.is_dir, file.size), ("Carmilla.epub", false, 1234));
        assert_eq!(parse_line("type=cdir; .", true), None);

        let unix = parse_line("-rw-r--r--    1 1000     1000       524288 Jan 01 12:00 Dracula - Stoker.epub", false).unwrap();
        assert_eq!((unix.name.as_str(), unix.is_dir, unix.size), ("Dracula - Stoker.epub", false, 524288));
        let dir = parse_line("drwxr-xr-x    2 1000     1000         4096 Jan 01 12:00 Books", false).unwrap();
        assert!(dir.is_dir);
        let dos = parse_line("01-01-24  12:00PM       <DIR>          Old Books", false).unwrap();
        assert_eq!((dos.name.as_str(), dos.is_dir), ("Old Books", true));
    }
}

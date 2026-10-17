//! Kindle by email. Amazon's Send to Kindle takes books mailed to the
//! person's @kindle.com address from an address they've approved. TBV sends
//! them through the person's own email account (its SMTP server), so the
//! settings, password included, stay on this device and out of backups.

use std::fs;
use std::time::Duration;

use lettre::message::header::ContentType;
use lettre::message::{Attachment, Mailbox, MultiPart, SinglePart};
use lettre::transport::smtp::authentication::Credentials;
use lettre::transport::smtp::client::{Tls, TlsParameters};
use lettre::{Message, SmtpTransport, Transport};
use serde::{Deserialize, Serialize};

use super::{format_label, Outgoing};
use crate::error::{Error, Result};
use crate::library::Library;

pub(crate) const SETTINGS_KEY: &str = "ereaders.kindle_email";

/// The most Amazon takes in one email.
pub const MAX_BYTES: u64 = 50 * 1024 * 1024;

/// What Send to Kindle accepts by email. Amazon stopped taking MOBI in 2022.
pub const FORMATS: &[&str] = &["epub", "pdf", "doc", "docx", "txt"];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Security {
    /// Usually port 587.
    Starttls,
    /// Usually port 465.
    Ssl,
}

/// Saved on this device only.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KindleEmail {
    pub server: String,
    pub port: u16,
    pub security: Security,
    pub username: String,
    pub password: String,
    /// The address Amazon must have on its approved list.
    pub from: String,
    /// The person's @kindle.com address.
    pub kindle: String,
}

/// What Settings shows: everything but the password.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KindleEmailView {
    pub server: String,
    pub port: u16,
    pub security: Security,
    pub username: String,
    pub has_password: bool,
    pub from: String,
    pub kindle: String,
}

/// What Settings saves. No password keeps the one saved before.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KindleEmailInput {
    pub server: String,
    pub port: u16,
    pub security: Security,
    pub username: String,
    pub password: Option<String>,
    pub from: String,
    pub kindle: String,
}

impl From<&KindleEmail> for KindleEmailView {
    fn from(s: &KindleEmail) -> Self {
        Self {
            server: s.server.clone(),
            port: s.port,
            security: s.security,
            username: s.username.clone(),
            has_password: !s.password.is_empty(),
            from: s.from.clone(),
            kindle: s.kindle.clone(),
        }
    }
}

fn looks_like_address(address: &str) -> bool {
    let Some((name, domain)) = address.split_once('@') else { return false };
    !name.is_empty() && domain.contains('.') && !domain.starts_with('.') && !domain.ends_with('.') && !address.contains(char::is_whitespace)
}

/// Checks the settings, saying plainly what to fix.
fn check(s: &KindleEmail) -> Result<()> {
    let problem = |m: &str| Err(Error::Unsuitable(m.into()));
    if s.server.is_empty() || s.server.contains(char::is_whitespace) || s.server.contains("://") {
        return problem("Type your email service's outgoing server, such as smtp.gmail.com.");
    }
    if s.port == 0 {
        return problem("Type the outgoing server's port, usually 587 or 465.");
    }
    if s.username.is_empty() {
        return problem("Type the username for your email account, usually your email address.");
    }
    if s.password.is_empty() {
        return problem("Type the password for your email account. Many services need an app password for this.");
    }
    if !looks_like_address(&s.from) {
        return problem("Type the email address you send from, like you@example.com.");
    }
    let kindle = s.kindle.to_lowercase();
    if !looks_like_address(&kindle) || !(kindle.ends_with("@kindle.com") || kindle.ends_with("@kindle.cn")) {
        return problem("Your Kindle's address ends in @kindle.com. Amazon shows it under Manage Your Content and Devices › Preferences › Personal Document Settings.");
    }
    Ok(())
}

impl Library {
    pub fn kindle_email(&self) -> Result<Option<KindleEmail>> {
        Ok(self.setting(SETTINGS_KEY)?.and_then(|s| serde_json::from_str(&s).ok()))
    }

    pub fn kindle_email_view(&self) -> Result<Option<KindleEmailView>> {
        Ok(self.kindle_email()?.as_ref().map(KindleEmailView::from))
    }

    /// Saves the settings once they look right. Stray spaces are trimmed
    /// from everything but the password, which is kept exactly as typed.
    pub fn save_kindle_email(&self, input: &KindleEmailInput) -> Result<KindleEmailView> {
        let password = match input.password.as_deref().filter(|p| !p.is_empty()) {
            Some(p) => p.to_string(),
            None => self.kindle_email()?.map(|s| s.password).unwrap_or_default(),
        };
        let settings = KindleEmail {
            server: input.server.trim().to_string(),
            port: input.port,
            security: input.security,
            username: input.username.trim().to_string(),
            password,
            from: input.from.trim().to_string(),
            kindle: input.kindle.trim().to_string(),
        };
        check(&settings)?;
        self.set_setting(SETTINGS_KEY, &serde_json::to_string(&settings)?)?;
        Ok(KindleEmailView::from(&settings))
    }

    pub fn forget_kindle_email(&self) -> Result<()> {
        self.conn.execute("DELETE FROM device_settings WHERE key = ?1", [SETTINGS_KEY])?;
        Ok(())
    }
}

/// Why this book can't go by email, or None when it can.
pub fn cannot_send(book: &Outgoing) -> Option<String> {
    if !FORMATS.contains(&book.format.as_str()) {
        return Some(match book.format.as_str() {
            "mobi" | "azw" | "azw3" => format!(
                "Amazon no longer takes {} books by email. Copy “{}” to your Kindle by cable instead.",
                format_label(&book.format),
                book.title
            ),
            other => format!("Amazon's Send to Kindle can't take {} books.", format_label(other)),
        });
    }
    if book.size > MAX_BYTES {
        return Some(format!(
            "“{}” is {} MB, and Amazon takes books up to 50 MB by email. Copy it to your Kindle by cable instead.",
            book.title,
            book.size.div_ceil(1024 * 1024)
        ));
    }
    None
}

fn content_type(format: &str) -> ContentType {
    let mime = match format {
        "epub" => "application/epub+zip",
        "pdf" => "application/pdf",
        "doc" => "application/msword",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "txt" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    };
    ContentType::parse(mime).unwrap_or(ContentType::TEXT_PLAIN)
}

fn mailbox(address: &str, what: &str) -> Result<Mailbox> {
    address.parse().map_err(|_| Error::Unsuitable(format!("{what} doesn't look like an email address. Check it in Settings › E-readers.")))
}

/// One email to the Kindle with the book attached.
fn message(settings: &KindleEmail, subject: &str, file_name: &str, format: &str, bytes: Vec<u8>) -> Result<Message> {
    let note = SinglePart::plain(format!("Sent from The Bound Vigil: {file_name}"));
    let attachment = Attachment::new(file_name.to_string()).body(bytes, content_type(format));
    Message::builder()
        .from(mailbox(&settings.from, "The address you send from")?)
        .to(mailbox(&settings.kindle, "Your Kindle's address")?)
        .subject(subject)
        .multipart(MultiPart::mixed().singlepart(note).singlepart(attachment))
        .map_err(|e| Error::Unsuitable(format!("The email couldn't be put together: {e}")))
}

/// Sends a book to the Kindle. Blocks until the email service answers, so
/// it runs off the UI thread and away from the library's lock.
pub fn send_book(settings: &KindleEmail, book: &Outgoing) -> Result<()> {
    if let Some(reason) = cannot_send(book) {
        return Err(Error::Unsuitable(reason));
    }
    let bytes = fs::read(&book.path)?;
    deliver(settings, message(settings, &book.title, &book.file_name, &book.format, bytes)?, true)
}

/// A small text document, so the person can see the whole way works:
/// their email account, Amazon's approved list, and the Kindle itself.
pub fn send_test(settings: &KindleEmail) -> Result<()> {
    let text = "This is a test from The Bound Vigil.\n\nIf you can read this on your Kindle, sending books by email works.\n";
    deliver(settings, message(settings, "A test from The Bound Vigil", "A test from The Bound Vigil.txt", "txt", text.as_bytes().to_vec())?, true)
}

fn deliver(settings: &KindleEmail, message: Message, tls: bool) -> Result<()> {
    let tls = match (tls, settings.security) {
        (false, _) => Tls::None,
        (true, security) => {
            let params = TlsParameters::new(settings.server.clone()).map_err(|e| Error::Unsuitable(format!("A secure connection couldn't be set up: {e}")))?;
            match security {
                Security::Starttls => Tls::Required(params),
                Security::Ssl => Tls::Wrapper(params),
            }
        }
    };
    let mailer = SmtpTransport::builder_dangerous(&settings.server)
        .port(settings.port)
        .tls(tls)
        .credentials(Credentials::new(settings.username.clone(), settings.password.clone()))
        .timeout(Some(Duration::from_secs(120)))
        .build();
    mailer.send(&message).map(|_| ()).map_err(|e| explain(&e, settings))
}

/// Puts what the email service said into words.
fn explain(e: &lettre::transport::smtp::Error, settings: &KindleEmail) -> Error {
    let code = e.status().map(u16::from);
    Error::Unsuitable(match code {
        Some(530 | 534 | 535) => "Your email service didn't accept the username and password. Many services (Gmail, Yahoo, iCloud) need an app password for this, made in your email account's security settings.".into(),
        Some(552) => "Your email service turned the book away as too big. Some take less than Amazon does (Gmail takes up to 25 MB).".into(),
        Some(550 | 553 | 554) => format!("Your email service wouldn't send it: {e}. Check the address you send from and your Kindle's address."),
        _ if e.is_timeout() => format!("{} took too long to answer. Check your internet connection and try again.", settings.server),
        _ if e.is_tls() => format!("A secure connection to {} couldn't be made. Check the port and security choice ({}).", settings.server, match settings.security {
            Security::Starttls => "STARTTLS usually uses port 587",
            Security::Ssl => "SSL usually uses port 465",
        }),
        _ if code.is_none() => format!("TBV couldn't reach {} on port {}. Check the server, the port and your internet connection.", settings.server, settings.port),
        _ => format!("Your email service said: {e}"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::library::tests::open_temp_library;
    use std::io::{BufRead, BufReader, Write};
    use std::net::TcpListener;
    use std::path::PathBuf;

    fn input() -> KindleEmailInput {
        KindleEmailInput {
            server: " smtp.example.com ".into(),
            port: 587,
            security: Security::Starttls,
            username: "me@example.com".into(),
            password: Some(" app pass ".into()),
            from: "me@example.com".into(),
            kindle: "me_42@kindle.com".into(),
        }
    }

    #[test]
    fn saves_settings_on_this_device_and_never_shows_the_password() {
        let (_dir, library) = open_temp_library();
        assert_eq!(library.kindle_email_view().unwrap(), None);
        let view = library.save_kindle_email(&input()).unwrap();
        assert!(view.has_password);
        assert_eq!(view.server, "smtp.example.com");
        assert!(!serde_json::to_string(&view).unwrap().contains("app pass"));
        assert_eq!(library.kindle_email().unwrap().unwrap().password, " app pass ");

        // Saving again without a password keeps the one saved.
        let mut again = input();
        again.password = None;
        again.port = 465;
        again.security = Security::Ssl;
        library.save_kindle_email(&again).unwrap();
        let saved = library.kindle_email().unwrap().unwrap();
        assert_eq!((saved.port, saved.security, saved.password.as_str()), (465, Security::Ssl, " app pass "));

        library.forget_kindle_email().unwrap();
        assert_eq!(library.kindle_email().unwrap(), None);
    }

    #[test]
    fn says_what_to_fix() {
        let (_dir, library) = open_temp_library();
        let wrong = |change: fn(&mut KindleEmailInput)| {
            let mut i = input();
            change(&mut i);
            match library.save_kindle_email(&i) {
                Err(Error::Unsuitable(m)) => m,
                other => panic!("{other:?}"),
            }
        };
        assert!(wrong(|i| i.kindle = "me@gmail.com".into()).contains("@kindle.com"));
        assert!(wrong(|i| i.from = "me".into()).contains("send from"));
        assert!(wrong(|i| i.server = "https://smtp.example.com".into()).contains("outgoing server"));
        assert!(wrong(|i| i.port = 0).contains("port"));
        assert!(wrong(|i| i.password = None).contains("app password"));
        assert_eq!(library.kindle_email().unwrap(), None);
    }

    #[test]
    fn the_password_stays_out_of_backups() {
        let (dir, library) = open_temp_library();
        library.save_kindle_email(&input()).unwrap();
        let backup = dir.path().join("backup.tbvbackup");
        library.create_backup(&backup).unwrap();
        let copy = rusqlite::Connection::open(&backup).unwrap();
        let kept: i64 = copy.query_row("SELECT COUNT(*) FROM device_settings WHERE key = ?1", [SETTINGS_KEY], |r| r.get(0)).unwrap();
        assert_eq!(kept, 0);
    }

    fn book(format: &str, size: u64) -> Outgoing {
        Outgoing { title: "Carmilla".into(), path: PathBuf::from("x"), format: format.into(), file_name: format!("Carmilla.{format}"), size }
    }

    #[test]
    fn only_what_amazon_takes_goes_by_email() {
        assert_eq!(cannot_send(&book("epub", 1_000)), None);
        assert_eq!(cannot_send(&book("docx", 1_000)), None);
        assert!(cannot_send(&book("azw3", 1_000)).unwrap().contains("by cable"));
        assert!(cannot_send(&book("fb2", 1_000)).unwrap().contains("FB2"));
        assert_eq!(cannot_send(&book("pdf", MAX_BYTES)), None);
        let big = cannot_send(&book("pdf", MAX_BYTES + 1)).unwrap();
        assert!(big.contains("51 MB") && big.contains("50 MB"), "{big}");
    }

    fn settings(port: u16) -> KindleEmail {
        KindleEmail {
            server: "127.0.0.1".into(),
            port,
            security: Security::Starttls,
            username: "me".into(),
            password: "pw".into(),
            from: "me@example.com".into(),
            kindle: "me@kindle.com".into(),
        }
    }

    /// A pretend email service that answers each command in turn, and
    /// hands back everything it was sent.
    fn pretend_server(accept_login: bool) -> (u16, std::thread::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let handle = std::thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            let mut out = stream.try_clone().unwrap();
            let mut lines = BufReader::new(stream);
            let mut heard = String::new();
            out.write_all(b"220 pretend ready\r\n").unwrap();
            let mut in_data = false;
            loop {
                let mut line = String::new();
                if lines.read_line(&mut line).unwrap_or(0) == 0 {
                    break;
                }
                heard.push_str(&line);
                if in_data {
                    if line == ".\r\n" {
                        in_data = false;
                        out.write_all(b"250 queued\r\n").unwrap();
                    }
                    continue;
                }
                let reply: &[u8] = match line.split_whitespace().next().unwrap_or("").to_uppercase().as_str() {
                    "EHLO" => b"250-pretend\r\n250 AUTH PLAIN LOGIN\r\n",
                    "AUTH" if accept_login => b"235 ok\r\n",
                    "AUTH" => b"535 5.7.8 bad credentials\r\n",
                    "DATA" => {
                        in_data = true;
                        b"354 go on\r\n"
                    }
                    "QUIT" => {
                        out.write_all(b"221 bye\r\n").unwrap();
                        break;
                    }
                    _ => b"250 ok\r\n",
                };
                out.write_all(reply).unwrap();
            }
            heard
        });
        (port, handle)
    }

    #[test]
    fn sends_the_book_as_an_attachment() {
        let (port, server) = pretend_server(true);
        let s = settings(port);
        deliver(&s, message(&s, "Carmilla", "Carmilla - Le Fanu.epub", "epub", b"PK book".to_vec()).unwrap(), false).unwrap();
        let heard = server.join().unwrap();
        assert!(heard.contains("RCPT TO:<me@kindle.com>"), "{heard}");
        assert!(heard.contains("MAIL FROM:<me@example.com>"));
        assert!(heard.contains("application/epub+zip"));
        assert!(heard.contains("Carmilla - Le Fanu.epub"));
    }

    #[test]
    fn a_refused_login_is_explained() {
        let (port, server) = pretend_server(false);
        let s = settings(port);
        let sent = deliver(&s, message(&s, "Test", "Test.txt", "txt", b"hi".to_vec()).unwrap(), false);
        assert!(matches!(sent, Err(Error::Unsuitable(m)) if m.contains("app password")));
        let _ = server.join();
    }

    #[test]
    fn an_unreachable_server_is_explained() {
        // A port nothing listens on.
        let port = TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
        let s = settings(port);
        let sent = deliver(&s, message(&s, "Test", "Test.txt", "txt", b"hi".to_vec()).unwrap(), false);
        assert!(matches!(sent, Err(Error::Unsuitable(m)) if m.contains("couldn't reach")));
    }
}

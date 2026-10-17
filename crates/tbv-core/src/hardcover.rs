//! Hardcover (hardcover.app), a book-tracking site with an open API. When
//! you've signed in and turned it on, rating a book in TBV rates it on
//! Hardcover too.
//!
//! Signing in uses Hardcover's OAuth for desktop apps: TBV opens Hardcover
//! in the browser, you approve, and the browser hands a one-time code back
//! to TBV on this computer (a loopback address), which TBV trades for a
//! token. No password or key ever passes through TBV. The token is kept on
//! this device only, like the Supabase sign-in.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::error::{Error, Result};
use crate::library::Library;

/// TBV's registration with Hardcover (a public id; desktop apps have no
/// secret). Empty until the app is registered.
pub const CLIENT_ID: &str = "7bf3082e-300b-4265-abdd-86cf8bdeb31c";

const AUTHORIZE_URL: &str = "https://hardcover.app/oauth2/authorize";
const TOKEN_URL: &str = "https://api.hardcover.app/oauth2/token";
const REVOKE_URL: &str = "https://api.hardcover.app/oauth2/revoke";
const GRAPHQL_URL: &str = "https://api.hardcover.app/v1/graphql";
const ISSUER: &str = "https://api.hardcover.app";
const SCOPES: &str = "read:me:content read:catalog read:library write:library";

pub(crate) const ACCOUNT_KEY: &str = "hardcover.account";
const MATCHES_KEY: &str = "hardcover.books";

/// The signed-in Hardcover account, kept on this device.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Account {
    pub username: String,
    pub access_token: String,
    pub refresh_token: String,
    /// Unix seconds.
    pub expires_at: i64,
    /// Whether rating a book here rates it on Hardcover.
    pub send_ratings: bool,
}

/// What Settings shows.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HardcoverStatus {
    /// False until TBV is registered with Hardcover.
    pub available: bool,
    pub username: Option<String>,
    pub send_ratings: bool,
}

/// What happened to one book's rating.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Sent {
    Sent,
    /// Hardcover doesn't seem to have this book.
    NotFound,
    /// Not signed in, or sending is turned off.
    Off,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SendAllReport {
    pub sent: u32,
    /// "Title by Author" for books Hardcover doesn't have.
    pub not_found: Vec<String>,
}

/// How TBV talks to Hardcover: a form or JSON post, answered with JSON.
/// Tests stand in a scripted one.
pub trait Transport {
    fn post_form(&self, url: &str, form: &[(&str, &str)]) -> Result<(u16, Value)>;
    fn post_json(&self, url: &str, bearer: &str, body: &Value) -> Result<(u16, Value)>;
}

pub struct Http;

fn agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .http_status_as_error(false)
        .timeout_global(Some(Duration::from_secs(30)))
        .user_agent(concat!("The Bound Vigil/", env!("CARGO_PKG_VERSION"), " (desktop eBook reader)"))
        .build()
        .into()
}

fn offline(error: ureq::Error) -> Error {
    Error::Offline(format!("Hardcover: {error}"))
}

fn read_json(mut response: ureq::http::Response<ureq::Body>) -> Result<(u16, Value)> {
    let status = response.status().as_u16();
    let text = response.body_mut().read_to_string().unwrap_or_default();
    Ok((status, serde_json::from_str(&text).unwrap_or(Value::Null)))
}

impl Transport for Http {
    fn post_form(&self, url: &str, form: &[(&str, &str)]) -> Result<(u16, Value)> {
        read_json(agent().post(url).send_form(form.iter().copied()).map_err(offline)?)
    }

    fn post_json(&self, url: &str, bearer: &str, body: &Value) -> Result<(u16, Value)> {
        read_json(agent().post(url).header("authorization", &format!("Bearer {bearer}")).send_json(body).map_err(offline)?)
    }
}

fn base64url(bytes: &[u8]) -> String {
    const ABC: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = String::new();
    for chunk in bytes.chunks(3) {
        let n = chunk.iter().enumerate().fold(0u32, |n, (i, b)| n | (u32::from(*b) << (16 - 8 * i)));
        for i in 0..=chunk.len() {
            out.push(ABC[((n >> (18 - 6 * i)) & 63) as usize] as char);
        }
    }
    out
}

fn random_token() -> String {
    format!("{}{}", uuid::Uuid::new_v4().simple(), uuid::Uuid::new_v4().simple())
}

fn now_secs() -> i64 {
    chrono::Utc::now().timestamp()
}

/// A sign-in waiting for the browser to come back.
pub struct PendingSignIn {
    /// Open this in the browser.
    pub url: String,
    redirect_uri: String,
    verifier: String,
    state: String,
}

/// Starts a sign-in whose answer comes back to `port` on this computer.
pub fn begin_sign_in(port: u16) -> Result<PendingSignIn> {
    if CLIENT_ID.is_empty() {
        return Err(Error::Unsuitable("Hardcover sign-in isn't set up in this version of TBV yet.".into()));
    }
    let verifier = random_token();
    let state = random_token();
    let challenge = base64url(&Sha256::digest(verifier.as_bytes()));
    let redirect_uri = format!("http://127.0.0.1:{port}/callback");
    let query: Vec<String> = [
        ("response_type", "code"),
        ("client_id", CLIENT_ID),
        ("redirect_uri", redirect_uri.as_str()),
        ("state", state.as_str()),
        ("code_challenge", challenge.as_str()),
        ("code_challenge_method", "S256"),
        ("scope", SCOPES),
    ]
    .iter()
    .map(|(k, v)| format!("{k}={}", percent_encode(v)))
    .collect();
    Ok(PendingSignIn {
        url: format!("{AUTHORIZE_URL}?{}", query.join("&")),
        redirect_uri,
        verifier,
        state,
    })
}

fn percent_encode(value: &str) -> String {
    value
        .bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

fn percent_decode(value: &str) -> String {
    let bytes = value.replace('+', " ").into_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(b) = u8::from_str_radix(std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or(""), 16) {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn parse_query(query: &str) -> HashMap<String, String> {
    query
        .split('&')
        .filter_map(|pair| pair.split_once('=').or(Some((pair, ""))))
        .map(|(k, v)| (percent_decode(k), percent_decode(v)))
        .collect()
}

/// Waits for the browser to come back to TBV with the sign-in's answer, and
/// tells the browser it can be closed. Gives up after `timeout`.
pub fn wait_for_callback(listener: &TcpListener, timeout: Duration) -> Result<HashMap<String, String>> {
    listener.set_nonblocking(true)?;
    let deadline = Instant::now() + timeout;
    loop {
        match listener.accept() {
            Ok((mut stream, _)) => {
                stream.set_nonblocking(false)?;
                stream.set_read_timeout(Some(Duration::from_secs(10)))?;
                let mut line = String::new();
                BufReader::new(&stream).read_line(&mut line)?;
                // "GET /callback?code=…&state=… HTTP/1.1"
                let target = line.split_whitespace().nth(1).unwrap_or("");
                let Some(query) = target.strip_prefix("/callback?").or_else(|| target.strip_prefix("/callback").map(|_| "")) else {
                    let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                    continue;
                };
                let page = "<!doctype html><meta charset=utf-8><title>The Bound Vigil</title>\
                    <body style=\"font:16px system-ui;margin:4em auto;max-width:28em;text-align:center\">\
                    <h1 style=\"font:500 24px Georgia,serif\">You can close this tab</h1>\
                    <p>Go back to The Bound Vigil to carry on.</p></body>";
                let _ = write!(
                    stream,
                    "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{page}",
                    page.len()
                );
                return Ok(parse_query(query));
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                if Instant::now() > deadline {
                    return Err(Error::Unsuitable("Hardcover sign-in timed out. Try again when you're ready.".into()));
                }
                std::thread::sleep(Duration::from_millis(150));
            }
            Err(e) => return Err(e.into()),
        }
    }
}

fn token_answer(status: u16, answer: &Value) -> Result<(String, String, i64)> {
    let field = |k: &str| answer.get(k).and_then(Value::as_str).map(str::to_string);
    match (status, field("access_token")) {
        (200..=299, Some(access)) => Ok((
            access,
            field("refresh_token").unwrap_or_default(),
            now_secs() + answer.get("expires_in").and_then(Value::as_i64).unwrap_or(3600),
        )),
        (400 | 401, _) if field("error").as_deref() == Some("invalid_grant") => Err(Error::SignedOut),
        _ => Err(Error::Cloud(format!(
            "Hardcover: {}",
            field("error_description").or_else(|| field("error")).unwrap_or_else(|| format!("status {status}"))
        ))),
    }
}

/// Finishes a sign-in with what the browser brought back.
pub fn finish_sign_in(net: &dyn Transport, pending: &PendingSignIn, answer: &HashMap<String, String>) -> Result<Account> {
    if let Some(error) = answer.get("error") {
        return Err(Error::Unsuitable(if error == "access_denied" {
            "Hardcover sign-in was cancelled.".into()
        } else {
            format!("Hardcover didn't sign you in ({error}).")
        }));
    }
    if answer.get("state") != Some(&pending.state) || answer.get("iss").is_some_and(|iss| iss != ISSUER) {
        return Err(Error::Unsuitable("That sign-in answer didn't come from this sign-in. Try again.".into()));
    }
    let code = answer.get("code").ok_or_else(|| Error::Unsuitable("Hardcover didn't send a sign-in code.".into()))?;
    let (status, body) = net.post_form(
        TOKEN_URL,
        &[
            ("grant_type", "authorization_code"),
            ("code", code),
            ("redirect_uri", &pending.redirect_uri),
            ("code_verifier", &pending.verifier),
            ("client_id", CLIENT_ID),
        ],
    )?;
    let (access_token, refresh_token, expires_at) = token_answer(status, &body)?;
    let me = graphql(net, &access_token, "query { me { username } }", json!({}))?;
    let username = first_of(&me["me"])["username"].as_str().unwrap_or("").to_string();
    Ok(Account {
        username,
        access_token,
        refresh_token,
        expires_at,
        send_ratings: true,
    })
}

/// Hardcover's `me` answers with a list of one; accept either shape.
fn first_of(value: &Value) -> &Value {
    match value {
        Value::Array(items) => items.first().unwrap_or(&Value::Null),
        other => other,
    }
}

fn graphql(net: &dyn Transport, token: &str, query: &str, variables: Value) -> Result<Value> {
    let (status, body) = net.post_json(GRAPHQL_URL, token, &json!({ "query": query, "variables": variables }))?;
    if status == 401 {
        return Err(Error::SignedOut);
    }
    if status == 429 {
        return Err(Error::Cloud("Hardcover is busy (too many requests today). TBV will try again later.".into()));
    }
    if let Some(message) = body.pointer("/errors/0/message").and_then(Value::as_str) {
        if message.contains("JWT") || message.contains("token") {
            return Err(Error::SignedOut);
        }
        return Err(Error::Cloud(format!("Hardcover: {message}")));
    }
    body.get("data").cloned().ok_or_else(|| Error::Cloud(format!("Hardcover answered with status {status}")))
}

/// What TBV knows about a book when looking for it on Hardcover.
#[derive(Debug, Clone)]
pub struct BookFacts {
    pub id: String,
    pub title: String,
    pub authors: Vec<String>,
    pub isbn: Option<String>,
    pub rating: Option<u8>,
    pub status: String,
}

fn simple(text: &str) -> String {
    let main = text.split(" (").next().unwrap_or(text);
    let main = main.split(':').next().unwrap_or(main);
    main.chars().filter(|c| c.is_alphanumeric()).flat_map(char::to_lowercase).collect()
}

fn surname(name: &str) -> String {
    simple(name.split_whitespace().last().unwrap_or(""))
}

/// Hardcover's id for a book (and edition, when found by ISBN).
fn find_book(net: &dyn Transport, token: &str, book: &BookFacts) -> Result<Option<(i64, Option<i64>)>> {
    if let Some(isbn) = &book.isbn {
        let data = graphql(
            net,
            token,
            "query ($isbn: String!) { editions(where: {_or: [{isbn_13: {_eq: $isbn}}, {isbn_10: {_eq: $isbn}}]}, limit: 1) { id book_id } }",
            json!({ "isbn": isbn }),
        )?;
        if let Some(edition) = data["editions"].as_array().and_then(|e| e.first()) {
            if let Some(book_id) = edition["book_id"].as_i64() {
                return Ok(Some((book_id, edition["id"].as_i64())));
            }
        }
    }
    let author = book.authors.first().cloned().unwrap_or_default();
    let data = graphql(
        net,
        token,
        "query ($q: String!) { search(query: $q, query_type: \"Book\", per_page: 5, page: 1) { results } }",
        json!({ "q": format!("{} {}", book.title, author).trim() }),
    )?;
    let want_title = simple(&book.title);
    let want_author = surname(&author);
    let hits = data.pointer("/search/results/hits").and_then(Value::as_array).cloned().unwrap_or_default();
    for hit in hits {
        let doc = &hit["document"];
        let title_ok = doc["title"].as_str().is_some_and(|t| simple(t) == want_title);
        let author_ok = want_author.is_empty()
            || doc["author_names"].as_array().is_some_and(|names| names.iter().filter_map(Value::as_str).any(|n| surname(n) == want_author));
        let id = doc["id"].as_i64().or_else(|| doc["id"].as_str().and_then(|s| s.parse().ok()));
        if let (true, true, Some(id)) = (title_ok, author_ok, id) {
            return Ok(Some((id, None)));
        }
    }
    Ok(None)
}

/// Hardcover's reading status for TBV's.
fn status_id(status: &str) -> i64 {
    match status {
        "read" => 3,
        "in_progress" => 2,
        _ => 1,
    }
}

/// Sets this book's rating on Hardcover, adding it to your Hardcover
/// library if it isn't there yet. `known` is a Hardcover id found before.
pub fn send_rating(net: &dyn Transport, token: &str, book: &BookFacts, known: Option<i64>) -> Result<(Sent, Option<i64>)> {
    let (hardcover_id, edition) = match known {
        Some(id) => (id, None),
        None => match find_book(net, token, book)? {
            Some(found) => found,
            None => return Ok((Sent::NotFound, None)),
        },
    };
    let mine = graphql(
        net,
        token,
        "query ($id: Int!) { me { user_books(where: {book_id: {_eq: $id}}, limit: 1) { id } } }",
        json!({ "id": hardcover_id }),
    )?;
    let existing = first_of(&mine["me"])["user_books"].as_array().and_then(|b| b.first()).and_then(|b| b["id"].as_i64());
    let rating = book.rating.map(|r| json!(r)).unwrap_or(Value::Null);
    let data = match existing {
        Some(user_book) => graphql(
            net,
            token,
            "mutation ($id: Int!, $object: UserBookUpdateInput!) { update_user_book(id: $id, object: $object) { id error } }",
            json!({ "id": user_book, "object": { "rating": rating } }),
        )?,
        // Clearing a rating on a book Hardcover doesn't list for you: nothing to do.
        None if book.rating.is_none() => return Ok((Sent::Sent, Some(hardcover_id))),
        None => {
            let mut object = json!({ "book_id": hardcover_id, "rating": rating, "status_id": status_id(&book.status) });
            if let Some(edition) = edition {
                object["edition_id"] = json!(edition);
            }
            graphql(
                net,
                token,
                "mutation ($object: UserBookCreateInput!) { insert_user_book(object: $object) { id error } }",
                json!({ "object": object }),
            )?
        }
    };
    let result = data.get("update_user_book").or_else(|| data.get("insert_user_book")).cloned().unwrap_or(Value::Null);
    if let Some(error) = result["error"].as_str().filter(|e| !e.is_empty()) {
        return Err(Error::Cloud(format!("Hardcover: {error}")));
    }
    Ok((Sent::Sent, Some(hardcover_id)))
}

impl Library {
    pub fn hardcover_account(&self) -> Result<Option<Account>> {
        Ok(self.setting(ACCOUNT_KEY)?.and_then(|s| serde_json::from_str(&s).ok()))
    }

    pub fn save_hardcover_account(&self, account: Option<&Account>) -> Result<()> {
        match account {
            Some(a) => self.set_setting(ACCOUNT_KEY, &serde_json::to_string(a)?),
            None => {
                self.conn.execute("DELETE FROM device_settings WHERE key IN (?1, ?2)", rusqlite::params![ACCOUNT_KEY, MATCHES_KEY])?;
                Ok(())
            }
        }
    }

    pub fn hardcover_status(&self) -> Result<HardcoverStatus> {
        let account = self.hardcover_account()?;
        Ok(HardcoverStatus {
            available: !CLIENT_ID.is_empty(),
            username: account.as_ref().map(|a| a.username.clone()),
            send_ratings: account.is_some_and(|a| a.send_ratings),
        })
    }

    pub fn set_hardcover_sending(&self, on: bool) -> Result<()> {
        let mut account = self.hardcover_account()?.ok_or_else(|| Error::Unsuitable("Sign in to Hardcover first.".into()))?;
        account.send_ratings = on;
        self.save_hardcover_account(Some(&account))
    }

    fn hardcover_matches(&self) -> Result<HashMap<String, i64>> {
        Ok(self.setting(MATCHES_KEY)?.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default())
    }

    pub fn remember_hardcover_match(&self, book_id: &str, hardcover_id: i64) -> Result<()> {
        let mut matches = self.hardcover_matches()?;
        matches.insert(book_id.to_string(), hardcover_id);
        self.set_setting(MATCHES_KEY, &serde_json::to_string(&matches)?)
    }

    pub fn hardcover_match(&self, book_id: &str) -> Result<Option<i64>> {
        Ok(self.hardcover_matches()?.get(book_id).copied())
    }

    /// What Hardcover needs to know about one book.
    pub fn book_facts(&self, book_id: &str) -> Result<Option<BookFacts>> {
        use rusqlite::OptionalExtension;
        let row = self
            .conn
            .query_row(
                "SELECT b.id, COALESCE(o_title.value, b.title), COALESCE(o_authors.value, b.authors), b.isbn, b.rating, b.status
                 FROM books b
                 LEFT JOIN metadata_overrides o_title ON o_title.book_id = b.id AND o_title.field = 'title'
                 LEFT JOIN metadata_overrides o_authors ON o_authors.book_id = b.id AND o_authors.field = 'authors'
                 WHERE b.id = ?1 AND b.deleted_at IS NULL",
                [book_id],
                |r| {
                    let authors: String = r.get(2)?;
                    Ok(BookFacts {
                        id: r.get(0)?,
                        title: r.get(1)?,
                        authors: serde_json::from_str(&authors).unwrap_or_default(),
                        isbn: r.get(3)?,
                        rating: r.get(4)?,
                        status: r.get(5)?,
                    })
                },
            )
            .optional()?;
        Ok(row)
    }

    /// Every rated book, for sending all ratings at once.
    pub fn rated_book_ids(&self) -> Result<Vec<String>> {
        let mut statement = self.conn.prepare("SELECT id FROM books WHERE rating IS NOT NULL AND deleted_at IS NULL ORDER BY added_at")?;
        let ids = statement.query_map([], |r| r.get(0))?.collect::<std::result::Result<_, _>>()?;
        Ok(ids)
    }
}

/// A token that's good for the next minute, refreshing it if needed.
/// `None` when not signed in or sending is off. Works on a copy so the
/// library isn't held while Hardcover answers.
pub fn usable_account(net: &dyn Transport, account: Option<Account>) -> Result<Option<Account>> {
    let Some(mut account) = account.filter(|a| a.send_ratings) else {
        return Ok(None);
    };
    if account.expires_at > now_secs() + 60 {
        return Ok(Some(account));
    }
    let (status, body) = net.post_form(
        TOKEN_URL,
        &[("grant_type", "refresh_token"), ("refresh_token", &account.refresh_token), ("client_id", CLIENT_ID)],
    )?;
    let (access, refresh, expires_at) = token_answer(status, &body)?;
    account.access_token = access;
    if !refresh.is_empty() {
        account.refresh_token = refresh;
    }
    account.expires_at = expires_at;
    Ok(Some(account))
}

/// Tells Hardcover to forget TBV's sign-in. Failing to reach it is fine:
/// the token is forgotten here either way.
pub fn revoke(net: &dyn Transport, account: &Account) {
    let _ = net.post_form(REVOKE_URL, &[("token", &account.refresh_token), ("token_type_hint", "refresh_token"), ("client_id", CLIENT_ID)]);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    /// Answers each request with the next scripted reply, and keeps what was asked.
    #[derive(Default)]
    struct Script {
        replies: RefCell<Vec<(u16, Value)>>,
        asked: RefCell<Vec<String>>,
    }

    impl Script {
        fn new(replies: Vec<Value>) -> Self {
            Script {
                replies: RefCell::new(replies.into_iter().rev().map(|r| (200, r)).collect()),
                asked: RefCell::default(),
            }
        }
    }

    impl Transport for Script {
        fn post_form(&self, url: &str, form: &[(&str, &str)]) -> Result<(u16, Value)> {
            self.asked.borrow_mut().push(format!("{url} {form:?}"));
            Ok(self.replies.borrow_mut().pop().expect("unexpected request"))
        }
        fn post_json(&self, url: &str, _: &str, body: &Value) -> Result<(u16, Value)> {
            self.asked.borrow_mut().push(format!("{url} {body}"));
            Ok(self.replies.borrow_mut().pop().expect("unexpected request"))
        }
    }

    fn dune(rating: Option<u8>) -> BookFacts {
        BookFacts {
            id: "b1".into(),
            title: "Dune".into(),
            authors: vec!["Frank Herbert".into()],
            isbn: Some("9780441013593".into()),
            rating,
            status: "read".into(),
        }
    }

    #[test]
    fn a_new_rating_adds_the_book_found_by_isbn() {
        let net = Script::new(vec![
            json!({ "data": { "editions": [{ "id": 77, "book_id": 312 }] } }),
            json!({ "data": { "me": [{ "user_books": [] }] } }),
            json!({ "data": { "insert_user_book": { "id": 9, "error": null } } }),
        ]);
        assert_eq!(send_rating(&net, "t", &dune(Some(5)), None).unwrap(), (Sent::Sent, Some(312)));
        let asked = net.asked.borrow();
        assert!(asked[2].contains("insert_user_book"), "{asked:?}");
        assert!(asked[2].contains("\"book_id\":312") && asked[2].contains("\"edition_id\":77") && asked[2].contains("\"rating\":5"));
        assert!(asked[2].contains("\"status_id\":3"));
    }

    #[test]
    fn a_known_book_is_updated_and_can_be_cleared() {
        let net = Script::new(vec![
            json!({ "data": { "me": { "user_books": [{ "id": 41 }] } } }),
            json!({ "data": { "update_user_book": { "id": 41, "error": null } } }),
        ]);
        assert_eq!(send_rating(&net, "t", &dune(None), Some(312)).unwrap().0, Sent::Sent);
        assert!(net.asked.borrow()[1].contains("\"rating\":null"));
    }

    #[test]
    fn books_found_by_search_must_match_title_and_author() {
        let mut book = dune(Some(4));
        book.isbn = None;
        let hits = |title: &str, author: &str| {
            json!({ "data": { "search": { "results": { "hits": [{ "document": { "id": 5, "title": title, "author_names": [author] } }] } } } })
        };
        let net = Script::new(vec![hits("Dune Messiah", "Frank Herbert")]);
        assert_eq!(send_rating(&net, "t", &book, None).unwrap(), (Sent::NotFound, None));
        let net = Script::new(vec![
            hits("Dune", "Frank Herbert"),
            json!({ "data": { "me": [{ "user_books": [{ "id": 3 }] }] } }),
            json!({ "data": { "update_user_book": { "id": 3 } } }),
        ]);
        assert_eq!(send_rating(&net, "t", &book, None).unwrap(), (Sent::Sent, Some(5)));
    }

    #[test]
    fn hardcover_errors_are_reported() {
        let net = Script::new(vec![json!({ "errors": [{ "message": "Could not verify JWT" }] })]);
        assert!(matches!(send_rating(&net, "t", &dune(Some(5)), Some(1)), Err(Error::SignedOut)));
        let net = Script::new(vec![
            json!({ "data": { "me": [{ "user_books": [{ "id": 3 }] }] } }),
            json!({ "data": { "update_user_book": { "id": null, "error": "Rating out of range" } } }),
        ]);
        assert!(matches!(send_rating(&net, "t", &dune(Some(5)), Some(1)), Err(Error::Cloud(m)) if m.contains("out of range")));
    }

    #[test]
    fn tokens_refresh_shortly_before_they_run_out() {
        let account = Account {
            username: "wren".into(),
            access_token: "old".into(),
            refresh_token: "r1".into(),
            expires_at: now_secs() + 10,
            send_ratings: true,
        };
        let net = Script::new(vec![json!({ "access_token": "new", "refresh_token": "r2", "expires_in": 3600 })]);
        let fresh = usable_account(&net, Some(account.clone())).unwrap().unwrap();
        assert_eq!((fresh.access_token.as_str(), fresh.refresh_token.as_str()), ("new", "r2"));
        assert!(net.asked.borrow()[0].contains("refresh_token"));
        // Turned off: nothing is asked.
        let off = Account { send_ratings: false, ..account };
        assert!(usable_account(&Script::new(vec![]), Some(off)).unwrap().is_none());
    }

    #[test]
    fn the_browser_answer_must_match_the_sign_in() {
        let pending = PendingSignIn {
            url: String::new(),
            redirect_uri: "http://127.0.0.1:5/callback".into(),
            verifier: "v".into(),
            state: "s1".into(),
        };
        let answer = |pairs: &[(&str, &str)]| pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect();
        let net = Script::new(vec![]);
        assert!(finish_sign_in(&net, &pending, &answer(&[("code", "c"), ("state", "other")])).is_err());
        assert!(finish_sign_in(&net, &pending, &answer(&[("error", "access_denied")])).is_err());
        let net = Script::new(vec![
            json!({ "access_token": "hc_at_1", "refresh_token": "hc_rt_1", "expires_in": 3600 }),
            json!({ "data": { "me": [{ "username": "wren" }] } }),
        ]);
        let account = finish_sign_in(&net, &pending, &answer(&[("code", "c"), ("state", "s1"), ("iss", ISSUER)])).unwrap();
        assert_eq!(account.username, "wren");
        assert!(net.asked.borrow()[0].contains("code_verifier"));
    }

    #[test]
    fn the_browser_comes_back_to_tbv() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let browser = std::thread::spawn(move || {
            let mut s = std::net::TcpStream::connect(("127.0.0.1", port)).unwrap();
            s.write_all(b"GET /callback?code=abc%20d&state=xyz HTTP/1.1\r\nHost: x\r\n\r\n").unwrap();
            let mut reply = String::new();
            std::io::Read::read_to_string(&mut s, &mut reply).unwrap();
            reply
        });
        let answer = wait_for_callback(&listener, Duration::from_secs(5)).unwrap();
        assert_eq!(answer["code"], "abc d");
        assert_eq!(answer["state"], "xyz");
        assert!(browser.join().unwrap().contains("You can close this tab"));
    }

    #[test]
    fn pkce_challenge_is_base64url() {
        // RFC 7636's own example.
        let challenge = base64url(&Sha256::digest(b"dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"));
        assert_eq!(challenge, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    }
}

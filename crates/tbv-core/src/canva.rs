//! Canva (canva.com), for Scribe Publisher: covers, pictures and print
//! interiors designed in Canva and brought back into the book (embre,
//! 3 November 2026).
//!
//! Signing in uses Canva's OAuth with PKCE: TBV opens Canva in the browser,
//! you approve, and the browser hands a one-time code back to TBV on this
//! computer, which TBV trades for a token. Canva also asks for TBV's client
//! secret, which is put in when the app is built (the CANVA_CLIENT_SECRET on
//! GitHub), never kept in the code. The sign-in is kept on this device only.
//! Canva hands out a new refresh token each time one is used, so the newest
//! is always saved.

use std::collections::HashMap;
use std::time::Duration;

use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::error::{Error, Result};
use crate::library::Library;
use crate::oauth::{base64url, query, random_token};

/// TBV's registration with Canva. The id is public.
pub const CLIENT_ID: &str = "OC-AaGilyfVfuYO";
const CLIENT_SECRET: Option<&str> = option_env!("TBV_CANVA_CLIENT_SECRET");
/// Canva only accepts the address registered with it (the same one as Dropbox's).
pub const PORT: u16 = 53689;

const AUTHORIZE_URL: &str = "https://www.canva.com/api/oauth/authorize";
const API: &str = "https://api.canva.com/rest/v1";
const SCOPES: &str = "design:meta:read design:content:read design:content:write profile:read";

pub(crate) const ACCOUNT_KEY: &str = "canva.account";

/// The signed-in Canva account, kept on this device.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Account {
    pub name: String,
    pub access_token: String,
    pub refresh_token: String,
    /// Unix seconds.
    pub expires_at: i64,
}

/// What Preferences shows.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CanvaStatus {
    /// False in a copy of TBV built without Canva's secret.
    pub available: bool,
    pub name: Option<String>,
}

/// A design in Canva: its id, kept with the book, and a link to edit it
/// (Canva's links last 30 days, so a fresh one is asked for each time).
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Design {
    pub id: String,
    pub edit_url: String,
    pub page_count: Option<u32>,
}

pub fn available() -> bool {
    CLIENT_SECRET.is_some_and(|s| !s.is_empty())
}

/// How TBV talks to Canva. Tests stand in a scripted one.
pub trait Transport {
    /// A form post with TBV's id and secret as Basic sign-in.
    fn post_form(&self, url: &str, basic: &str, form: &[(&str, &str)]) -> Result<(u16, Value)>;
    /// A GET, or a POST of `body` as JSON when given.
    fn call(&self, url: &str, bearer: &str, body: Option<&Value>) -> Result<(u16, Value)>;
    /// A POST of raw bytes with one extra header.
    fn post_bytes(&self, url: &str, bearer: &str, header: (&str, &str), bytes: Vec<u8>) -> Result<(u16, Value)>;
    /// A file from one of Canva's download links.
    fn download(&self, url: &str) -> Result<Vec<u8>>;
}

pub struct Http;

fn agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .http_status_as_error(false)
        .timeout_connect(Some(Duration::from_secs(15)))
        .timeout_recv_response(Some(Duration::from_secs(180)))
        .user_agent(concat!("The Bound Vigil/", env!("CARGO_PKG_VERSION")))
        .build()
        .into()
}

fn offline(error: ureq::Error) -> Error {
    Error::Offline(format!("Canva: {error}"))
}

fn read_json(mut response: ureq::http::Response<ureq::Body>) -> Result<(u16, Value)> {
    let status = response.status().as_u16();
    let text = response.body_mut().with_config().limit(16 * 1024 * 1024).read_to_string().unwrap_or_default();
    Ok((status, serde_json::from_str(&text).unwrap_or(Value::Null)))
}

impl Transport for Http {
    fn post_form(&self, url: &str, basic: &str, form: &[(&str, &str)]) -> Result<(u16, Value)> {
        read_json(agent().post(url).header("authorization", &format!("Basic {basic}")).send_form(form.iter().copied()).map_err(offline)?)
    }

    fn call(&self, url: &str, bearer: &str, body: Option<&Value>) -> Result<(u16, Value)> {
        let auth = format!("Bearer {bearer}");
        let answer = match body {
            Some(body) => agent().post(url).header("authorization", &auth).send_json(body),
            None => agent().get(url).header("authorization", &auth).call(),
        };
        read_json(answer.map_err(offline)?)
    }

    fn post_bytes(&self, url: &str, bearer: &str, header: (&str, &str), bytes: Vec<u8>) -> Result<(u16, Value)> {
        read_json(
            agent()
                .post(url)
                .header("authorization", &format!("Bearer {bearer}"))
                .header("content-type", "application/octet-stream")
                .header(header.0, header.1)
                .send(&bytes[..])
                .map_err(offline)?,
        )
    }

    fn download(&self, url: &str) -> Result<Vec<u8>> {
        let mut answer = agent().get(url).call().map_err(offline)?;
        if !answer.status().is_success() {
            return Err(Error::Cloud(format!("Canva's download didn't come (status {}).", answer.status().as_u16())));
        }
        answer.body_mut().with_config().limit(1024 * 1024 * 1024).read_to_vec().map_err(offline)
    }
}

fn now_secs() -> i64 {
    chrono::Utc::now().timestamp()
}

fn basic() -> Result<String> {
    let secret = CLIENT_SECRET.filter(|s| !s.is_empty()).ok_or_else(|| Error::Unsuitable("Canva isn't set up in this copy of TBV.".into()))?;
    Ok(base64::engine::general_purpose::STANDARD.encode(format!("{CLIENT_ID}:{secret}")))
}

/// A sign-in waiting for the browser to come back.
pub struct PendingSignIn {
    /// Open this in the browser.
    pub url: String,
    redirect_uri: String,
    verifier: String,
    state: String,
}

pub fn begin_sign_in() -> PendingSignIn {
    let verifier = random_token();
    let state = random_token();
    let challenge = base64url(&Sha256::digest(verifier.as_bytes()));
    let redirect_uri = format!("http://127.0.0.1:{PORT}/callback");
    let url = format!(
        "{AUTHORIZE_URL}?{}",
        query(&[
            ("response_type", "code"),
            ("client_id", CLIENT_ID),
            ("redirect_uri", &redirect_uri),
            ("scope", SCOPES),
            ("state", &state),
            ("code_challenge", &challenge),
            ("code_challenge_method", "S256"),
        ])
    );
    PendingSignIn { url, redirect_uri, verifier, state }
}

fn tokens(status: u16, answer: &Value) -> Result<(String, String, i64)> {
    let field = |k: &str| answer.get(k).and_then(Value::as_str).map(str::to_string);
    match (status, field("access_token"), field("refresh_token")) {
        (200..=299, Some(access), Some(refresh)) => Ok((access, refresh, now_secs() + answer.get("expires_in").and_then(Value::as_i64).unwrap_or(14_400))),
        (400 | 401, _, _) if field("error").as_deref() == Some("invalid_grant") => Err(Error::SignedOut),
        _ => Err(Error::Cloud(format!(
            "Canva: {}",
            field("error_description").or_else(|| field("error")).unwrap_or_else(|| format!("status {status}"))
        ))),
    }
}

/// Finishes a sign-in with what the browser brought back.
pub fn finish_sign_in(net: &dyn Transport, pending: &PendingSignIn, answer: &HashMap<String, String>) -> Result<Account> {
    if let Some(error) = answer.get("error") {
        return Err(Error::Unsuitable(if error == "access_denied" {
            "Canva sign-in was cancelled.".into()
        } else {
            format!("Canva didn't sign you in ({}).", answer.get("error_description").unwrap_or(error))
        }));
    }
    if answer.get("state") != Some(&pending.state) {
        return Err(Error::Unsuitable("That sign-in answer didn't come from this sign-in. Try again.".into()));
    }
    let code = answer.get("code").ok_or_else(|| Error::Unsuitable("Canva didn't send a sign-in code.".into()))?;
    let form = [
        ("grant_type", "authorization_code"),
        ("code", code.as_str()),
        ("code_verifier", pending.verifier.as_str()),
        ("redirect_uri", pending.redirect_uri.as_str()),
    ];
    let (status, body) = net.post_form(&format!("{API}/oauth/token"), &basic()?, &form)?;
    let (access_token, refresh_token, expires_at) = tokens(status, &body)?;
    let (status, me) = net.call(&format!("{API}/users/me/profile"), &access_token, None)?;
    let name = if (200..300).contains(&status) {
        me.pointer("/profile/display_name").and_then(Value::as_str).filter(|s| !s.is_empty()).unwrap_or("Your Canva account").to_string()
    } else {
        "Your Canva account".to_string()
    };
    Ok(Account { name, access_token, refresh_token, expires_at })
}

/// The account with an access token good for the next few minutes. Canva's
/// refresh tokens are single use, so the account that comes back must be saved.
pub fn fresh(net: &dyn Transport, account: &Account) -> Result<Account> {
    if account.expires_at > now_secs() + 300 {
        return Ok(account.clone());
    }
    let form = [("grant_type", "refresh_token"), ("refresh_token", account.refresh_token.as_str())];
    let (status, body) = net.post_form(&format!("{API}/oauth/token"), &basic()?, &form)?;
    let (access_token, refresh_token, expires_at) = tokens(status, &body)?;
    Ok(Account { access_token, refresh_token, expires_at, ..account.clone() })
}

/// Tells Canva to forget TBV's sign-in. Failing to reach it is fine.
pub fn revoke(net: &dyn Transport, account: &Account) {
    if let Ok(b) = basic() {
        let _ = net.post_form(&format!("{API}/oauth/revoke"), &b, &[("token", account.refresh_token.as_str())]);
    }
}

fn problem(status: u16, body: &Value, doing: &str) -> Error {
    if status == 401 {
        return Error::SignedOut;
    }
    let message = body.get("message").and_then(Value::as_str).unwrap_or("");
    Error::Cloud(if message.is_empty() { format!("Canva couldn't {doing} (status {status}).") } else { format!("Canva couldn't {doing}: {message}") })
}

fn design_from(value: &Value) -> Option<Design> {
    Some(Design {
        id: value.get("id")?.as_str()?.to_string(),
        edit_url: value.pointer("/urls/edit_url")?.as_str()?.to_string(),
        page_count: value.get("page_count").and_then(Value::as_u64).map(|n| n as u32),
    })
}

/// Canva's titles are kept to 50 characters.
fn short_title(title: &str) -> String {
    let t: String = title.trim().chars().take(50).collect();
    if t.is_empty() { "The Bound Vigil".into() } else { t }
}

/// A new, empty design of exactly `width` × `height` pixels (40 to 8000 each).
pub fn new_design(net: &dyn Transport, token: &str, title: &str, width: u32, height: u32) -> Result<Design> {
    let body = json!({
        "design_type": { "type": "custom", "width": width.clamp(40, 8000), "height": height.clamp(40, 8000) },
        "title": short_title(title),
    });
    let (status, answer) = net.call(&format!("{API}/designs"), token, Some(&body))?;
    if !(200..300).contains(&status) {
        return Err(problem(status, &answer, "make the design"));
    }
    answer.get("design").and_then(design_from).ok_or_else(|| Error::Cloud("Canva made the design but didn't say where.".into()))
}

/// A design TBV made before, with a fresh link to edit it.
pub fn design(net: &dyn Transport, token: &str, id: &str) -> Result<Option<Design>> {
    let (status, answer) = net.call(&format!("{API}/designs/{id}"), token, None)?;
    if status == 404 {
        return Ok(None);
    }
    if !(200..300).contains(&status) {
        return Err(problem(status, &answer, "find the design"));
    }
    Ok(answer.get("design").and_then(design_from))
}

/// Waits for one of Canva's jobs, checking every few seconds.
fn wait_for_job(net: &dyn Transport, token: &str, url: &str, first: Value, doing: &str, pause: Duration) -> Result<Value> {
    let mut job = first;
    for _ in 0..200 {
        match job.get("status").and_then(Value::as_str) {
            Some("success") => return Ok(job),
            Some("failed") => {
                let message = job.pointer("/error/message").and_then(Value::as_str).unwrap_or("it didn't say why");
                return Err(Error::Cloud(format!("Canva couldn't {doing}: {message}")));
            }
            _ => {}
        }
        std::thread::sleep(pause);
        let id = job.get("id").and_then(Value::as_str).ok_or_else(|| Error::Cloud(format!("Canva couldn't {doing}.")))?;
        let (status, answer) = net.call(&format!("{url}/{id}"), token, None)?;
        if !(200..300).contains(&status) {
            return Err(problem(status, &answer, doing));
        }
        job = answer.get("job").cloned().unwrap_or(Value::Null);
    }
    Err(Error::Offline(format!("Canva took too long to {doing}.")))
}

/// Sends a file (the book's PDF) into Canva as a new design of its own.
pub fn import(net: &dyn Transport, token: &str, title: &str, mime: &str, bytes: Vec<u8>) -> Result<Design> {
    import_with(net, token, title, mime, bytes, Duration::from_secs(3))
}

fn import_with(net: &dyn Transport, token: &str, title: &str, mime: &str, bytes: Vec<u8>, pause: Duration) -> Result<Design> {
    let meta = json!({
        "title_base64": base64::engine::general_purpose::STANDARD.encode(short_title(title)),
        "mime_type": mime,
    })
    .to_string();
    let (status, answer) = net.post_bytes(&format!("{API}/imports"), token, ("import-metadata", &meta), bytes)?;
    if !(200..300).contains(&status) {
        return Err(problem(status, &answer, "take the file"));
    }
    let job = wait_for_job(net, token, &format!("{API}/imports"), answer.get("job").cloned().unwrap_or(Value::Null), "take the file", pause)?;
    job.pointer("/result/designs/0").and_then(design_from).ok_or_else(|| Error::Cloud("Canva took the file but didn't say where it went.".into()))
}

/// What to bring a design back as.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Format {
    Png,
    Jpg,
    Pdf,
}

/// Brings a design back as one file: a picture of its first page, or the whole design as a PDF.
pub fn export(net: &dyn Transport, token: &str, id: &str, format: Format) -> Result<Vec<u8>> {
    export_with(net, token, id, format, Duration::from_secs(2))
}

fn export_with(net: &dyn Transport, token: &str, id: &str, format: Format, pause: Duration) -> Result<Vec<u8>> {
    let format = match format {
        Format::Png => json!({ "type": "png", "pages": [1] }),
        Format::Jpg => json!({ "type": "jpg", "quality": 92, "pages": [1] }),
        Format::Pdf => json!({ "type": "pdf" }),
    };
    let (status, answer) = net.call(&format!("{API}/exports"), token, Some(&json!({ "design_id": id, "format": format })))?;
    if !(200..300).contains(&status) {
        return Err(problem(status, &answer, "send the design back"));
    }
    let job = wait_for_job(net, token, &format!("{API}/exports"), answer.get("job").cloned().unwrap_or(Value::Null), "send the design back", pause)?;
    let url = job.pointer("/urls/0").and_then(Value::as_str).ok_or_else(|| Error::Cloud("Canva didn't send a download.".into()))?;
    net.download(url)
}

impl Library {
    pub fn canva_account(&self) -> Result<Option<Account>> {
        Ok(self.setting(ACCOUNT_KEY)?.and_then(|s| serde_json::from_str(&s).ok()))
    }

    pub fn save_canva_account(&self, account: Option<&Account>) -> Result<()> {
        match account {
            Some(a) => self.set_setting(ACCOUNT_KEY, &serde_json::to_string(a)?),
            None => {
                self.conn.execute("DELETE FROM device_settings WHERE key = ?1", rusqlite::params![ACCOUNT_KEY])?;
                Ok(())
            }
        }
    }

    pub fn canva_status(&self) -> Result<CanvaStatus> {
        Ok(CanvaStatus { available: available(), name: self.canva_account()?.map(|a| a.name) })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    #[derive(Default)]
    struct Script {
        replies: RefCell<Vec<(u16, Value)>>,
        asked: RefCell<Vec<String>>,
    }

    impl Script {
        fn new(replies: Vec<(u16, Value)>) -> Self {
            Script { replies: RefCell::new(replies.into_iter().rev().collect()), asked: RefCell::default() }
        }
        fn next(&self, what: String) -> Result<(u16, Value)> {
            self.asked.borrow_mut().push(what);
            Ok(self.replies.borrow_mut().pop().expect("a scripted reply"))
        }
    }

    impl Transport for Script {
        fn post_form(&self, url: &str, _: &str, form: &[(&str, &str)]) -> Result<(u16, Value)> {
            self.next(format!("form {url} {form:?}"))
        }
        fn call(&self, url: &str, bearer: &str, body: Option<&Value>) -> Result<(u16, Value)> {
            self.next(format!("call {url} {bearer} {}", body.map(Value::to_string).unwrap_or_default()))
        }
        fn post_bytes(&self, url: &str, _: &str, header: (&str, &str), bytes: Vec<u8>) -> Result<(u16, Value)> {
            self.next(format!("bytes {url} {} {} {}", header.0, header.1, bytes.len()))
        }
        fn download(&self, url: &str) -> Result<Vec<u8>> {
            self.asked.borrow_mut().push(format!("download {url}"));
            Ok(b"%PDF".to_vec())
        }
    }

    #[test]
    fn the_sign_in_page_asks_for_what_tbv_needs() {
        let p = begin_sign_in();
        assert!(p.url.starts_with("https://www.canva.com/api/oauth/authorize?"));
        assert!(p.url.contains("client_id=OC-AaGilyfVfuYO"));
        assert!(p.url.contains("redirect_uri=http%3A%2F%2F127.0.0.1%3A53689%2Fcallback"));
        assert!(p.url.contains("code_challenge_method=S256"));
        assert!(p.url.contains("scope=design%3Ameta%3Aread%20design%3Acontent%3Aread%20design%3Acontent%3Awrite%20profile%3Aread"));
    }

    #[test]
    fn a_new_design_is_made_at_the_exact_size() {
        let net = Script::new(vec![(200, json!({ "design": { "id": "DA1", "urls": { "edit_url": "https://canva.com/e/DA1", "view_url": "v" } } }))]);
        let d = new_design(&net, "tok", "The Ash Road (cover)", 1600, 2560).unwrap();
        assert_eq!(d, Design { id: "DA1".into(), edit_url: "https://canva.com/e/DA1".into(), page_count: None });
        let asked = net.asked.borrow()[0].clone();
        assert!(asked.contains("/designs tok"));
        assert!(asked.contains("\"width\":1600") && asked.contains("\"height\":2560") && asked.contains("\"custom\""));
    }

    #[test]
    fn an_export_waits_for_its_job_and_downloads_the_file() {
        let net = Script::new(vec![
            (200, json!({ "job": { "id": "J1", "status": "in_progress" } })),
            (200, json!({ "job": { "id": "J1", "status": "success", "urls": ["https://export-download.canva.com/x.pdf"] } })),
        ]);
        let bytes = export_with(&net, "tok", "DA1", Format::Pdf, Duration::ZERO).unwrap();
        assert_eq!(bytes, b"%PDF");
        let asked = net.asked.borrow();
        assert!(asked[1].starts_with("call https://api.canva.com/rest/v1/exports/J1 tok"));
        assert_eq!(asked[2], "download https://export-download.canva.com/x.pdf");
    }

    #[test]
    fn an_import_names_the_file_and_finds_its_design() {
        let net = Script::new(vec![
            (200, json!({ "job": { "id": "I1", "status": "in_progress" } })),
            (200, json!({ "job": { "id": "I1", "status": "success", "result": { "designs": [{ "id": "DB2", "page_count": 212, "urls": { "edit_url": "https://canva.com/e/DB2" } }] } } })),
        ]);
        let d = import_with(&net, "tok", "The Ash Road (interior)", "application/pdf", vec![0; 10], Duration::ZERO).unwrap();
        assert_eq!(d.page_count, Some(212));
        let asked = net.asked.borrow();
        assert!(asked[0].starts_with("bytes https://api.canva.com/rest/v1/imports import-metadata"));
        assert!(asked[0].contains("application/pdf") && asked[0].ends_with(" 10"));
    }

    #[test]
    fn a_failed_job_says_why_and_a_refused_token_signs_out() {
        let net = Script::new(vec![(200, json!({ "job": { "id": "J1", "status": "failed", "error": { "code": "license_required", "message": "Needs Canva Pro." } } }))]);
        let e = export_with(&net, "tok", "DA1", Format::Png, Duration::ZERO).unwrap_err();
        assert!(e.to_string().contains("Needs Canva Pro."));
        let net = Script::new(vec![(401, json!({}))]);
        assert!(matches!(new_design(&net, "old", "x", 100, 100), Err(Error::SignedOut)));
    }

    #[test]
    fn titles_stay_within_canvas_limit() {
        assert_eq!(short_title(&"a".repeat(80)).len(), 50);
        assert_eq!(short_title("  "), "The Bound Vigil");
    }
}

//! Signing in to Dropbox, Google Drive and OneDrive directly, without their
//! apps. Each keeps TBV's library in a folder of its own: Dropbox and
//! OneDrive give TBV an app folder (`Apps/The Bound Vigil`) and nothing
//! else, and Google Drive lets TBV see only the files TBV made.
//!
//! The sign-in is kept as a refresh token in this device's settings, like
//! the WebDAV password. Short-lived access tokens are only kept in memory,
//! shared by every connection this run of the app opens.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::error::{Error, Result};
use crate::oauth::{base64url, query, random_token};

/// Which service.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Service {
    Dropbox,
    #[serde(rename = "google")]
    GoogleDrive,
    #[serde(rename = "onedrive")]
    OneDrive,
}

impl Service {
    pub fn name(self) -> &'static str {
        match self {
            Service::Dropbox => "Dropbox",
            Service::GoogleDrive => "Google Drive",
            Service::OneDrive => "OneDrive",
        }
    }

    /// As Settings names it ("dropbox", "google", "onedrive").
    pub fn key(self) -> &'static str {
        match self {
            Service::Dropbox => "dropbox",
            Service::GoogleDrive => "google",
            Service::OneDrive => "onedrive",
        }
    }
}

/// A signed-in account. Kept on this device only.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudAccount {
    pub service: Service,
    /// The service's own id for the account, so two sign-ins to the same
    /// account count as the same place.
    pub account_id: String,
    /// The email address (or name) to show in Settings.
    pub name: String,
    pub refresh_token: String,
}

impl CloudAccount {
    fn cache_key(&self) -> String {
        format!("{}:{}", self.service.key(), self.account_id)
    }
}

// TBV's registrations. These ids are public: apps on a person's own device
// can't keep a secret, so each service checks the sign-in by PKCE instead.
const DROPBOX_APP_KEY: &str = "q6uv1t89mili0hg";
/// Dropbox only accepts the exact addresses registered with it.
pub const DROPBOX_PORT: u16 = 53689;
const MICROSOFT_CLIENT_ID: &str = "291378d2-3521-4a1c-b2f3-18126018ee99";
const GOOGLE_DESKTOP_CLIENT_ID: &str = "936822846664-ik2asnsl7pfe4non3t4etnkusuooknu4.apps.googleusercontent.com";
const GOOGLE_IOS_CLIENT_ID: &str = "936822846664-4d0upks12fm3jrrv8edje574391a4j13.apps.googleusercontent.com";
/// Google gives desktop apps a "secret" it doesn't treat as one. It's put in
/// when the app is built (the GOOGLE_CLIENT_SECRET on GitHub), never kept here.
const GOOGLE_DESKTOP_SECRET: Option<&str> = option_env!("TBV_GOOGLE_CLIENT_SECRET");

/// How a sign-in page gets its answer back to TBV.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Return {
    /// To a listener on this device. `port` is fixed when the service only
    /// takes registered addresses. `localhost` means both of the device's
    /// loopback addresses should be heard, since a browser may use either.
    Loopback { port: Option<u16>, localhost: bool },
    /// To the app's own address (Google on iPhone).
    AppScheme { scheme: String },
}

fn google_ios_scheme() -> String {
    let id = GOOGLE_IOS_CLIENT_ID.trim_end_matches(".apps.googleusercontent.com");
    format!("com.googleusercontent.apps.{id}")
}

/// How this service's sign-in comes back, on this kind of device.
pub fn return_for(service: Service) -> Return {
    match service {
        Service::Dropbox => Return::Loopback { port: Some(DROPBOX_PORT), localhost: false },
        Service::OneDrive => Return::Loopback { port: None, localhost: true },
        Service::GoogleDrive if cfg!(target_os = "ios") => Return::AppScheme { scheme: google_ios_scheme() },
        Service::GoogleDrive => Return::Loopback { port: None, localhost: false },
    }
}

/// Whether this build can sign in to the service at all.
pub fn available(service: Service) -> bool {
    match service {
        Service::GoogleDrive => cfg!(target_os = "ios") || GOOGLE_DESKTOP_SECRET.is_some_and(|s| !s.is_empty()),
        _ => true,
    }
}

struct Client {
    authorize: &'static str,
    token: &'static str,
    id: &'static str,
    secret: Option<&'static str>,
}

fn client(service: Service) -> Client {
    match service {
        Service::Dropbox => Client {
            authorize: "https://www.dropbox.com/oauth2/authorize",
            token: "https://api.dropboxapi.com/oauth2/token",
            id: DROPBOX_APP_KEY,
            secret: None,
        },
        Service::OneDrive => Client {
            authorize: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
            token: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
            id: MICROSOFT_CLIENT_ID,
            secret: None,
        },
        Service::GoogleDrive if cfg!(target_os = "ios") => Client {
            authorize: "https://accounts.google.com/o/oauth2/v2/auth",
            token: "https://oauth2.googleapis.com/token",
            id: GOOGLE_IOS_CLIENT_ID,
            secret: None,
        },
        Service::GoogleDrive => Client {
            authorize: "https://accounts.google.com/o/oauth2/v2/auth",
            token: "https://oauth2.googleapis.com/token",
            id: GOOGLE_DESKTOP_CLIENT_ID,
            secret: GOOGLE_DESKTOP_SECRET,
        },
    }
}

const MICROSOFT_SCOPES: &str = "Files.ReadWrite.AppFolder offline_access User.Read";
const GOOGLE_SCOPES: &str = "https://www.googleapis.com/auth/drive.file";

/// A sign-in waiting for the browser to come back.
pub struct PendingCloudSignIn {
    pub service: Service,
    /// Open this in the browser.
    pub url: String,
    redirect_uri: String,
    verifier: String,
    state: String,
}

/// Starts a sign-in. `port` is where the listener is, for a loopback return.
pub fn begin_sign_in(service: Service, port: u16) -> Result<PendingCloudSignIn> {
    if !available(service) {
        return Err(Error::Unsuitable(format!("{} sign-in isn't set up in this copy of TBV.", service.name())));
    }
    let redirect_uri = match (service, return_for(service)) {
        (_, Return::AppScheme { scheme }) => format!("{scheme}:/oauth2redirect"),
        (Service::OneDrive, _) => format!("http://localhost:{port}"),
        _ => format!("http://127.0.0.1:{port}/callback"),
    };
    let verifier = random_token();
    let state = random_token();
    let challenge = base64url(&Sha256::digest(verifier.as_bytes()));
    let c = client(service);
    let mut pairs = vec![
        ("response_type", "code"),
        ("client_id", c.id),
        ("redirect_uri", redirect_uri.as_str()),
        ("state", state.as_str()),
        ("code_challenge", challenge.as_str()),
        ("code_challenge_method", "S256"),
    ];
    match service {
        // Offline: a refresh token, so the sign-in lasts.
        Service::Dropbox => pairs.push(("token_access_type", "offline")),
        Service::OneDrive => pairs.extend([("scope", MICROSOFT_SCOPES), ("prompt", "select_account")]),
        // Consent each time, or Google sends no refresh token for an account
        // that signed in before.
        Service::GoogleDrive => pairs.extend([("scope", GOOGLE_SCOPES), ("access_type", "offline"), ("prompt", "consent")]),
    }
    Ok(PendingCloudSignIn {
        service,
        url: format!("{}?{}", c.authorize, query(&pairs)),
        redirect_uri,
        verifier,
        state,
    })
}

/// How TBV talks to the services' sign-in and account pages. Tests stand in
/// a scripted one.
pub trait Transport {
    fn post_form(&self, url: &str, form: &[(&str, &str)]) -> Result<(u16, Value)>;
    /// A GET, or a POST of `body` (as JSON) when given.
    fn call(&self, url: &str, bearer: &str, body: Option<&Value>) -> Result<(u16, Value)>;
}

pub struct Http;

pub(crate) fn agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .http_status_as_error(false)
        .timeout_connect(Some(Duration::from_secs(15)))
        .timeout_recv_response(Some(Duration::from_secs(120)))
        .user_agent(concat!("The Bound Vigil/", env!("CARGO_PKG_VERSION")))
        .build()
        .into()
}

pub(crate) fn transport(error: ureq::Error) -> Error {
    match error {
        ureq::Error::Io(e) => Error::Offline(e.to_string()),
        ureq::Error::Timeout(_) => Error::Offline("the service took too long to answer".into()),
        ureq::Error::HostNotFound => Error::Offline("the service couldn't be reached".into()),
        ureq::Error::ConnectionFailed => Error::Offline("the connection to the service failed".into()),
        other => Error::Cloud(other.to_string()),
    }
}

pub(crate) fn read_json(mut response: ureq::http::Response<ureq::Body>) -> Result<(u16, Value)> {
    let status = response.status().as_u16();
    let text = response.body_mut().with_config().limit(16 * 1024 * 1024).read_to_string().unwrap_or_default();
    Ok((status, serde_json::from_str(&text).unwrap_or(Value::Null)))
}

impl Transport for Http {
    fn post_form(&self, url: &str, form: &[(&str, &str)]) -> Result<(u16, Value)> {
        read_json(agent().post(url).send_form(form.iter().copied()).map_err(transport)?)
    }

    fn call(&self, url: &str, bearer: &str, body: Option<&Value>) -> Result<(u16, Value)> {
        let auth = format!("Bearer {bearer}");
        let answer = match body {
            Some(body) => agent().post(url).header("authorization", &auth).send_json(body),
            None => agent().get(url).header("authorization", &auth).call(),
        };
        read_json(answer.map_err(transport)?)
    }
}

struct Tokens {
    access: String,
    refresh: String,
    /// Unix seconds.
    expires_at: i64,
}

fn now_secs() -> i64 {
    chrono::Utc::now().timestamp()
}

/// Access tokens (and any refresh token a service handed back in place of
/// the saved one), by account.
static TOKENS: Mutex<Option<HashMap<String, Tokens>>> = Mutex::new(None);

fn token_answer(service: Service, status: u16, answer: &Value) -> Result<Tokens> {
    let field = |k: &str| answer.get(k).and_then(Value::as_str).map(str::to_string);
    match (status, field("access_token")) {
        (200..=299, Some(access)) => Ok(Tokens {
            access,
            refresh: field("refresh_token").unwrap_or_default(),
            expires_at: now_secs() + answer.get("expires_in").and_then(Value::as_i64).unwrap_or(3600),
        }),
        (400 | 401, _) if field("error").as_deref() == Some("invalid_grant") => Err(signed_out(service)),
        _ => Err(Error::Cloud(format!(
            "{}: {}",
            service.name(),
            field("error_description").or_else(|| field("error")).unwrap_or_else(|| format!("status {status}"))
        ))),
    }
}

pub(crate) fn signed_out(service: Service) -> Error {
    Error::Cloud(format!("{} signed TBV out. Sign in again in Preferences › Sync.", service.name()))
}

/// Finishes a sign-in with what the browser brought back.
pub fn finish_sign_in(net: &dyn Transport, pending: &PendingCloudSignIn, answer: &HashMap<String, String>) -> Result<CloudAccount> {
    let service = pending.service;
    if let Some(error) = answer.get("error") {
        return Err(Error::Unsuitable(if error == "access_denied" {
            format!("{} sign-in was cancelled.", service.name())
        } else {
            let detail = answer.get("error_description").unwrap_or(error);
            format!("{} didn't sign you in ({detail}).", service.name())
        }));
    }
    if answer.get("state") != Some(&pending.state) {
        return Err(Error::Unsuitable("That sign-in answer didn't come from this sign-in. Try again.".into()));
    }
    let code = answer.get("code").ok_or_else(|| Error::Unsuitable(format!("{} didn't send a sign-in code.", service.name())))?;
    let c = client(service);
    let mut form = vec![
        ("grant_type", "authorization_code"),
        ("code", code.as_str()),
        ("redirect_uri", pending.redirect_uri.as_str()),
        ("code_verifier", pending.verifier.as_str()),
        ("client_id", c.id),
    ];
    if let Some(secret) = c.secret {
        form.push(("client_secret", secret));
    }
    if service == Service::OneDrive {
        form.push(("scope", MICROSOFT_SCOPES));
    }
    let (status, body) = net.post_form(c.token, &form)?;
    let tokens = token_answer(service, status, &body)?;
    if tokens.refresh.is_empty() {
        return Err(Error::Cloud(format!("{} didn't let TBV stay signed in. Try again.", service.name())));
    }
    let (account_id, name) = who(net, service, &tokens.access)?;
    let account = CloudAccount { service, account_id, name, refresh_token: tokens.refresh.clone() };
    remember(&account, tokens);
    Ok(account)
}

/// The account's id and the name to show.
fn who(net: &dyn Transport, service: Service, access: &str) -> Result<(String, String)> {
    let (status, me) = match service {
        Service::Dropbox => net.call("https://api.dropboxapi.com/2/users/get_current_account", access, Some(&Value::Null))?,
        Service::GoogleDrive => net.call("https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,permissionId,displayName)", access, None)?,
        Service::OneDrive => net.call("https://graph.microsoft.com/v1.0/me?$select=id,mail,userPrincipalName,displayName", access, None)?,
    };
    if !(200..300).contains(&status) {
        return Err(Error::Cloud(format!("{} wouldn't say who signed in (status {status}).", service.name())));
    }
    let text = |pointer: &str| me.pointer(pointer).and_then(Value::as_str).filter(|s| !s.is_empty()).map(str::to_string);
    let (id, name) = match service {
        Service::Dropbox => (text("/account_id"), text("/email").or_else(|| text("/name/display_name"))),
        Service::GoogleDrive => (text("/user/permissionId"), text("/user/emailAddress").or_else(|| text("/user/displayName"))),
        Service::OneDrive => (text("/id"), text("/mail").or_else(|| text("/userPrincipalName")).or_else(|| text("/displayName"))),
    };
    let id = id.ok_or_else(|| Error::Cloud(format!("{} didn't say who signed in.", service.name())))?;
    Ok((id.clone(), name.unwrap_or(id)))
}

fn remember(account: &CloudAccount, tokens: Tokens) {
    if let Ok(mut all) = TOKENS.lock() {
        all.get_or_insert_with(HashMap::new).insert(account.cache_key(), tokens);
    }
}

/// An access token good for the next minute, refreshed when needed.
pub(crate) fn access_token(net: &dyn Transport, account: &CloudAccount) -> Result<String> {
    let key = account.cache_key();
    let saved_refresh = {
        let all = TOKENS.lock().map_err(|_| Error::Unsuitable("sign-ins are unavailable".into()))?;
        match all.as_ref().and_then(|a| a.get(&key)) {
            Some(t) if t.expires_at > now_secs() + 60 => return Ok(t.access.clone()),
            Some(t) if !t.refresh.is_empty() => t.refresh.clone(),
            _ => account.refresh_token.clone(),
        }
    };
    let c = client(account.service);
    let mut form = vec![("grant_type", "refresh_token"), ("refresh_token", saved_refresh.as_str()), ("client_id", c.id)];
    if let Some(secret) = c.secret {
        form.push(("client_secret", secret));
    }
    if account.service == Service::OneDrive {
        form.push(("scope", MICROSOFT_SCOPES));
    }
    let (status, body) = net.post_form(c.token, &form)?;
    let mut tokens = token_answer(account.service, status, &body)?;
    // Most answers leave the refresh token as it was.
    if tokens.refresh.is_empty() {
        tokens.refresh = saved_refresh;
    }
    let access = tokens.access.clone();
    remember(account, tokens);
    Ok(access)
}

/// Forgets the access token, after a service turned it down.
pub(crate) fn forget_access(account: &CloudAccount) {
    if let Ok(mut all) = TOKENS.lock() {
        if let Some(t) = all.as_mut().and_then(|a| a.get_mut(&account.cache_key())) {
            t.expires_at = 0;
        }
    }
}

/// A newer refresh token than the saved one, when the service gave one
/// (OneDrive does, each time). Saving it keeps the sign-in from running out.
pub fn newer_refresh_token(account: &CloudAccount) -> Option<String> {
    let all = TOKENS.lock().ok()?;
    let t = all.as_ref()?.get(&account.cache_key())?;
    (!t.refresh.is_empty() && t.refresh != account.refresh_token).then(|| t.refresh.clone())
}

/// Tells the service to forget TBV's sign-in. Failing to reach it is fine:
/// the sign-in is forgotten here either way.
pub fn sign_out(account: &CloudAccount) {
    if let Ok(mut all) = TOKENS.lock() {
        if let Some(all) = all.as_mut() {
            all.remove(&account.cache_key());
        }
    }
    match account.service {
        Service::Dropbox => {
            if let Ok(token) = access_token(&Http, account) {
                let _ = Http.call("https://api.dropboxapi.com/2/auth/token/revoke", &token, Some(&Value::Null));
            }
        }
        Service::GoogleDrive => {
            let _ = Http.post_form("https://oauth2.googleapis.com/revoke", &[("token", &account.refresh_token)]);
        }
        // Microsoft has no way for an app to revoke its own sign-in; it can
        // be removed at account.microsoft.com.
        Service::OneDrive => {}
    }
}

/// Waits `seconds` from a Retry-After header (capped), for a service that
/// asked TBV to slow down. False when it's waited enough times already.
pub(crate) fn wait_if_busy(answer: &ureq::http::Response<ureq::Body>, attempt: u32) -> bool {
    let status = answer.status().as_u16();
    if !(status == 429 || status == 503) || attempt >= 4 {
        return false;
    }
    let after = answer.headers().get("retry-after").and_then(|v| v.to_str().ok()).and_then(|v| v.trim().parse::<u64>().ok());
    std::thread::sleep(Duration::from_secs(after.unwrap_or(2u64 << attempt).min(60)));
    true
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
        fn post_form(&self, url: &str, form: &[(&str, &str)]) -> Result<(u16, Value)> {
            self.next(format!("{url} {form:?}"))
        }
        fn call(&self, url: &str, bearer: &str, _: Option<&Value>) -> Result<(u16, Value)> {
            self.next(format!("{url} {bearer}"))
        }
    }

    fn answer(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

    #[test]
    fn each_service_asks_for_only_what_tbv_needs() {
        let dropbox = begin_sign_in(Service::Dropbox, DROPBOX_PORT).unwrap();
        assert!(dropbox.url.starts_with("https://www.dropbox.com/oauth2/authorize?"));
        assert!(dropbox.url.contains("token_access_type=offline"));
        assert!(dropbox.url.contains("redirect_uri=http%3A%2F%2F127.0.0.1%3A53689%2Fcallback"));
        let onedrive = begin_sign_in(Service::OneDrive, 4000).unwrap();
        assert!(onedrive.url.contains("Files.ReadWrite.AppFolder"));
        assert!(onedrive.url.contains("redirect_uri=http%3A%2F%2Flocalhost%3A4000&"));
        assert!(onedrive.url.contains("code_challenge_method=S256"));
        assert_eq!(return_for(Service::OneDrive), Return::Loopback { port: None, localhost: true });
        assert_eq!(google_ios_scheme(), "com.googleusercontent.apps.936822846664-4d0upks12fm3jrrv8edje574391a4j13");
    }

    #[test]
    fn a_sign_in_becomes_an_account_and_its_tokens_refresh() {
        let pending = begin_sign_in(Service::OneDrive, 4001).unwrap();
        assert!(finish_sign_in(&Script::new(vec![]), &pending, &answer(&[("code", "c"), ("state", "other")])).is_err());
        assert!(finish_sign_in(&Script::new(vec![]), &pending, &answer(&[("error", "access_denied")])).is_err());
        let net = Script::new(vec![
            (200, serde_json::json!({ "access_token": "at1", "refresh_token": "rt1", "expires_in": 3600 })),
            (200, serde_json::json!({ "id": "ms-42", "userPrincipalName": "wren@example.com" })),
        ]);
        let account = finish_sign_in(&net, &pending, &answer(&[("code", "c"), ("state", &pending.state)])).unwrap();
        assert_eq!(account, CloudAccount { service: Service::OneDrive, account_id: "ms-42".into(), name: "wren@example.com".into(), refresh_token: "rt1".into() });
        assert!(net.asked.borrow()[0].contains("code_verifier"));
        // Kept from the sign-in: nothing asked.
        assert_eq!(access_token(&Script::new(vec![]), &account).unwrap(), "at1");
        // Once it's turned down, a refresh, whose new refresh token is kept.
        forget_access(&account);
        let net = Script::new(vec![(200, serde_json::json!({ "access_token": "at2", "refresh_token": "rt2" }))]);
        assert_eq!(access_token(&net, &account).unwrap(), "at2");
        assert!(net.asked.borrow()[0].contains("rt1"));
        assert_eq!(newer_refresh_token(&account).as_deref(), Some("rt2"));
        // A refresh token the service no longer takes means signing in again.
        forget_access(&account);
        let net = Script::new(vec![(400, serde_json::json!({ "error": "invalid_grant" }))]);
        assert!(access_token(&net, &account).unwrap_err().to_string().contains("Sign in again"));
    }
}

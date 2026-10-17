//! Supabase as a place to keep a library: records in one table (set up by
//! `supabase/setup.sql`), files in one private storage bucket, both visible
//! only to the signed-in person.

use std::fs::File;
use std::io;
use std::path::Path;
use std::time::Duration;

use serde::Deserialize;
use serde_json::{json, Value};
use ureq::http::Response;
use ureq::{Agent, Body};

use super::{seq_after, Page, Record, Remote, Session, SupabaseProject};
use crate::error::{Error, Result};

const BUCKET: &str = "tbv-files";
const SETUP_HINT: &str = "TBV's tables aren't in this Supabase project yet. Run the setup script from Settings › Sync, then try again";

fn agent() -> Agent {
    Agent::config_builder()
        .http_status_as_error(false)
        .timeout_connect(Some(Duration::from_secs(15)))
        .timeout_recv_response(Some(Duration::from_secs(90)))
        .build()
        .into()
}

fn now_secs() -> i64 {
    chrono::Utc::now().timestamp()
}

/// Transport trouble (no connection, a timeout) means offline, not broken.
fn transport(error: ureq::Error) -> Error {
    match error {
        ureq::Error::Io(e) => Error::Offline(e.to_string()),
        ureq::Error::Timeout(_) => Error::Offline("it took too long to answer".into()),
        ureq::Error::HostNotFound => Error::Offline("the project's address couldn't be found".into()),
        ureq::Error::ConnectionFailed => Error::Offline("the connection failed".into()),
        other => Error::Cloud(other.to_string()),
    }
}

/// The readable part of an error answer from any Supabase service.
fn message(response: &mut Response<Body>) -> String {
    let status = response.status().as_u16();
    let body = response.body_mut().read_to_string().unwrap_or_default();
    let parsed: Value = serde_json::from_str(&body).unwrap_or(Value::Null);
    ["msg", "message", "error_description", "error"]
        .iter()
        .find_map(|k| parsed.get(*k).and_then(Value::as_str))
        .map(str::to_string)
        .unwrap_or_else(|| format!("status {status}"))
}

/// Turns an error from the project's Data API (PostgREST) into a next step.
/// A 404 has several causes that need different fixes, so the text names
/// the one Supabase reported, with its own words after it for anyone helping.
fn rest_problem(response: &mut Response<Body>) -> Error {
    let status = response.status().as_u16();
    let body = response.body_mut().read_to_string().unwrap_or_default();
    let parsed: Value = serde_json::from_str(&body).unwrap_or(Value::Null);
    let code = parsed.get("code").and_then(Value::as_str).unwrap_or_default();
    let said = ["message", "msg", "error"]
        .iter()
        .find_map(|k| parsed.get(*k).and_then(Value::as_str))
        .map(str::to_string)
        .unwrap_or_else(|| {
            let text = body.trim();
            if text.is_empty() || text.len() > 200 { format!("status {status}") } else { text.to_string() }
        });
    let hint = match code {
        // The table or function isn't there, or the API hasn't noticed it yet.
        "PGRST205" | "PGRST202" | "42P01" | "42883" => SETUP_HINT,
        // The project only shares other schemas (Supabase's "dedicated API schema" choice).
        "PGRST106" => "This Supabase project's Data API doesn't include the public schema, where TBV's table lives. In Supabase, open Project Settings › Data API, add public to Exposed schemas and save, then try again",
        "42501" => "TBV's table is there, but signed-in accounts aren't allowed to use it. Run the setup script from Settings › Sync again, then try again",
        _ if status == 404 => "Supabase's Data API didn't answer. In Supabase, open Project Settings › Data API and check it's turned on, and that the setup script ran without errors, then try again",
        _ => return Error::Cloud(said),
    };
    Error::Cloud(format!("{hint}. (Supabase said: {said})"))
}

#[derive(Deserialize)]
struct TokenAnswer {
    access_token: String,
    refresh_token: String,
    expires_in: i64,
    user: UserAnswer,
}

#[derive(Deserialize)]
struct UserAnswer {
    id: String,
    #[serde(default)]
    email: Option<String>,
}

impl TokenAnswer {
    fn session(self, email: &str) -> Session {
        Session {
            user_id: self.user.id,
            email: self.user.email.unwrap_or_else(|| email.to_string()),
            access_token: self.access_token,
            refresh_token: self.refresh_token,
            expires_at: now_secs() + self.expires_in,
        }
    }
}

fn auth_post(project: &SupabaseProject, path: &str, body: Value) -> Result<Response<Body>> {
    agent()
        .post(&format!("{}/auth/v1/{path}", project.url))
        .header("apikey", &project.anon_key)
        .send_json(body)
        .map_err(transport)
}

/// Signs in with email and password.
pub fn sign_in(project: &SupabaseProject, email: &str, password: &str) -> Result<Session> {
    let mut answer = auth_post(project, "token?grant_type=password", json!({ "email": email, "password": password }))?;
    if !answer.status().is_success() {
        let why = message(&mut answer);
        return Err(Error::Unsuitable(if why.contains("Email not confirmed") {
            "Confirm your email first: open the link Supabase sent you, then sign in.".into()
        } else if why.contains("Invalid login credentials") {
            "That email and password don't match an account in this project.".into()
        } else {
            why
        }));
    }
    let token: TokenAnswer = answer.body_mut().read_json().map_err(|e| Error::Cloud(e.to_string()))?;
    Ok(token.session(email))
}

/// Makes an account. `None` means Supabase sent a confirmation email first.
pub fn sign_up(project: &SupabaseProject, email: &str, password: &str) -> Result<Option<Session>> {
    let mut answer = auth_post(project, "signup", json!({ "email": email, "password": password }))?;
    if !answer.status().is_success() {
        return Err(Error::Unsuitable(message(&mut answer)));
    }
    let body: Value = answer.body_mut().read_json().map_err(|e| Error::Cloud(e.to_string()))?;
    if body.get("access_token").is_some() {
        let token: TokenAnswer = serde_json::from_value(body)?;
        return Ok(Some(token.session(email)));
    }
    Ok(None)
}

/// Signs out on the server too, so the sign-in can't be reused. Best effort.
pub fn sign_out(project: &SupabaseProject, session: &Session) {
    let _ = agent()
        .post(&format!("{}/auth/v1/logout", project.url))
        .header("apikey", &project.anon_key)
        .header("Authorization", &format!("Bearer {}", session.access_token))
        .send_empty();
}

/// Sends one request, given the agent, project URL and `Bearer …` header.
type Request<'a> = dyn Fn(&Agent, &str, &str) -> std::result::Result<Response<Body>, ureq::Error> + 'a;

/// A signed-in connection to one project.
pub struct Supabase {
    project: SupabaseProject,
    session: Session,
    device_id: String,
    agent: Agent,
    renewed: bool,
}

impl Supabase {
    pub fn new(project: SupabaseProject, session: Session, device_id: String) -> Self {
        Self { project, session, device_id, agent: agent(), renewed: false }
    }

    /// The sign-in, renewed if it ran out during this connection.
    pub fn session(&self) -> &Session {
        &self.session
    }

    /// True if the sign-in was renewed and should be saved.
    pub fn renewed(&self) -> bool {
        self.renewed
    }

    fn renew(&mut self) -> Result<()> {
        let mut answer = auth_post(&self.project, "token?grant_type=refresh_token", json!({ "refresh_token": self.session.refresh_token }))?;
        if !answer.status().is_success() {
            let status = answer.status().as_u16();
            return Err(if (400..500).contains(&status) { Error::SignedOut } else { Error::Cloud(message(&mut answer)) });
        }
        let token: TokenAnswer = answer.body_mut().read_json().map_err(|e| Error::Cloud(e.to_string()))?;
        self.session = token.session(&self.session.email);
        self.renewed = true;
        Ok(())
    }

    /// Sends a request with the current sign-in, renewing it once if it has
    /// run out.
    fn call(&mut self, send: &Request<'_>) -> Result<Response<Body>> {
        if self.session.expires_at - 60 < now_secs() {
            self.renew()?;
        }
        for attempt in 0..2 {
            let bearer = format!("Bearer {}", self.session.access_token);
            let answer = send(&self.agent, &self.project.url, &bearer).map_err(transport)?;
            if answer.status().as_u16() == 401 && attempt == 0 {
                self.renew()?;
                continue;
            }
            return Ok(answer);
        }
        Err(Error::SignedOut)
    }

    fn object_url(&self, path: &str) -> String {
        format!("{BUCKET}/{}/{path}", self.session.user_id)
    }
}

impl Remote for Supabase {
    fn push(&mut self, records: &[Record]) -> Result<()> {
        let device = self.device_id.clone();
        let rows: Vec<Value> = records
            .iter()
            .map(|r| json!({ "kind": r.kind, "key": r.key, "data": r.data, "changed_at": r.changed_at, "device_id": device }))
            .collect();
        let body = json!({ "records": rows });
        let key = self.project.anon_key.clone();
        let mut answer = self.call(&|agent, url, bearer| {
            agent
                .post(&format!("{url}/rest/v1/rpc/tbv_push"))
                .header("apikey", &key)
                .header("Authorization", bearer)
                .send_json(&body)
        })?;
        match answer.status().as_u16() {
            200..=299 => Ok(()),
            _ => Err(rest_problem(&mut answer)),
        }
    }

    fn pull(&mut self, after: &str, limit: usize) -> Result<Page> {
        let start = after;
        let after = seq_after(after);
        #[derive(Deserialize)]
        struct Row {
            seq: i64,
            #[serde(flatten)]
            record: Record,
        }
        let key = self.project.anon_key.clone();
        let mut answer = self.call(&|agent, url, bearer| {
            agent
                .get(&format!(
                    "{url}/rest/v1/tbv_records?select=seq,kind,key,data,changed_at&seq=gt.{after}&order=seq.asc&limit={limit}"
                ))
                .header("apikey", &key)
                .header("Authorization", bearer)
                .call()
        })?;
        match answer.status().as_u16() {
            200..=299 => {
                let rows: Vec<Row> = answer
                    .body_mut()
                    .with_config()
                    .limit(256 * 1024 * 1024)
                    .read_json()
                    .map_err(|e| Error::Cloud(e.to_string()))?;
                Ok(Page::numbered(rows.into_iter().map(|r| (r.seq, r.record)).collect(), start))
            }
            _ => Err(rest_problem(&mut answer)),
        }
    }

    fn upload(&mut self, path: &str, file: &Path) -> Result<()> {
        let object = self.object_url(path);
        let key = self.project.anon_key.clone();
        let file = file.to_path_buf();
        let mut answer = self.call(&|agent, url, bearer| {
            let body = File::open(&file).map_err(ureq::Error::Io)?;
            agent
                .post(&format!("{url}/storage/v1/object/{object}"))
                .header("apikey", &key)
                .header("Authorization", bearer)
                .header("x-upsert", "true")
                .content_type("application/octet-stream")
                .send(&body)
        })?;
        match answer.status().as_u16() {
            200..=299 => Ok(()),
            413 => Err(Error::Rejected("too big for this Supabase plan's file size limit".into())),
            status => {
                let why = message(&mut answer);
                if why.contains("Bucket not found") {
                    Err(Error::Cloud(SETUP_HINT.into()))
                } else if why.to_lowercase().contains("exceeded the maximum allowed size") || why.contains("Payload too large") {
                    Err(Error::Rejected("too big for this Supabase plan's file size limit".into()))
                } else if status == 400 || status == 415 {
                    Err(Error::Rejected(why))
                } else {
                    Err(Error::Cloud(why))
                }
            }
        }
    }

    fn download(&mut self, path: &str, to: &Path) -> Result<bool> {
        let object = self.object_url(path);
        let key = self.project.anon_key.clone();
        let mut answer = self.call(&|agent, url, bearer| {
            agent
                .get(&format!("{url}/storage/v1/object/authenticated/{object}"))
                .header("apikey", &key)
                .header("Authorization", bearer)
                .call()
        })?;
        match answer.status().as_u16() {
            200..=299 => {
                let mut out = File::create(to)?;
                let mut body = answer.body_mut().with_config().limit(u64::MAX).reader();
                io::copy(&mut body, &mut out).map_err(|e| Error::Offline(e.to_string()))?;
                Ok(true)
            }
            400 | 404 => {
                let why = message(&mut answer);
                if why.contains("Bucket not found") {
                    Err(Error::Cloud(SETUP_HINT.into()))
                } else {
                    Ok(false)
                }
            }
            _ => Err(Error::Cloud(message(&mut answer))),
        }
    }

    fn list(&mut self, folder: &str) -> Result<Vec<String>> {
        #[derive(Deserialize)]
        struct Item {
            name: String,
        }
        let prefix = format!("{}/{}", self.session.user_id, folder.trim_end_matches('/'));
        let key = self.project.anon_key.clone();
        let mut names = Vec::new();
        loop {
            let body = json!({ "prefix": prefix, "limit": 1000, "offset": names.len(), "sortBy": { "column": "name", "order": "asc" } });
            let mut answer = self.call(&|agent, url, bearer| {
                agent
                    .post(&format!("{url}/storage/v1/object/list/{BUCKET}"))
                    .header("apikey", &key)
                    .header("Authorization", bearer)
                    .send_json(&body)
            })?;
            if !answer.status().is_success() {
                let why = message(&mut answer);
                return Err(Error::Cloud(if why.contains("Bucket not found") { SETUP_HINT.into() } else { why }));
            }
            let page: Vec<Item> = answer.body_mut().read_json().map_err(|e| Error::Cloud(e.to_string()))?;
            let full = page.len() == 1000;
            names.extend(page.into_iter().map(|i| i.name));
            if !full {
                return Ok(names);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn answer(status: u16, body: &str) -> Response<Body> {
        let body = Body::builder().mime_type("application/json").data(body.to_owned());
        let mut response = Response::new(body);
        *response.status_mut() = ureq::http::StatusCode::from_u16(status).unwrap();
        response
    }

    #[test]
    fn data_api_errors_name_the_fix() {
        let text = |status, body| rest_problem(&mut answer(status, body)).to_string();
        let missing = text(404, r#"{"code":"PGRST205","message":"Could not find the table 'public.tbv_records' in the schema cache"}"#);
        assert!(missing.contains("Run the setup script"), "{missing}");
        assert!(missing.contains("schema cache"), "Supabase's own words are kept: {missing}");
        let hidden = text(406, r#"{"code":"PGRST106","message":"Invalid schema: public"}"#);
        assert!(hidden.contains("Exposed schemas"), "{hidden}");
        let off = text(404, "");
        assert!(off.contains("turned on"), "{off}");
        let other = text(500, r#"{"message":"boom"}"#);
        assert_eq!(other, "the cloud said: boom");
    }
}

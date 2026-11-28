//! The reader's own AI (embre, 28 November), set up in Attunement: any
//! service that gives out keys (Claude, ChatGPT, Gemini, Mistral, DeepSeek,
//! OpenRouter, Grok) or an AI the person runs themselves, by its address.
//! TBV uses it to translate whole books. The setup belongs to this device
//! only, and the key never leaves it except to go to that service.

use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::error::{Error, Result};
use crate::library::Library;

const SETUP_KEY: &str = "ai.setup";
const ANTHROPIC_VERSION: &str = "2023-06-01";

/// A service TBV knows how to talk to.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiProvider {
    pub id: &'static str,
    pub name: &'static str,
    /// Where it's reached; empty for one the person runs themselves.
    pub base: &'static str,
    /// The model picked until the person picks another.
    pub model: &'static str,
    /// Whether it needs a key.
    pub key: bool,
}

pub const PROVIDERS: &[AiProvider] = &[
    AiProvider { id: "claude", name: "Claude", base: "https://api.anthropic.com/v1", model: "claude-opus-5-5", key: true },
    AiProvider { id: "openai", name: "ChatGPT", base: "https://api.openai.com/v1", model: "", key: true },
    AiProvider { id: "gemini", name: "Gemini", base: "https://generativelanguage.googleapis.com/v1beta/openai", model: "", key: true },
    AiProvider { id: "mistral", name: "Mistral", base: "https://api.mistral.ai/v1", model: "", key: true },
    AiProvider { id: "deepseek", name: "DeepSeek", base: "https://api.deepseek.com/v1", model: "", key: true },
    AiProvider { id: "openrouter", name: "OpenRouter", base: "https://openrouter.ai/api/v1", model: "", key: true },
    AiProvider { id: "grok", name: "Grok", base: "https://api.x.ai/v1", model: "", key: true },
    AiProvider { id: "custom", name: "Your own", base: "", model: "", key: false },
];

fn provider(id: &str) -> Result<&'static AiProvider> {
    PROVIDERS.iter().find(|p| p.id == id).ok_or_else(|| Error::Unsuitable("TBV doesn't know that AI.".into()))
}

/// What's kept on this device.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AiSetup {
    pub provider: String,
    /// What the reader calls it (shown on the Translate switch).
    #[serde(default)]
    pub name: String,
    /// The address, for one the person runs themselves.
    #[serde(default)]
    pub base: String,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub key: String,
}

/// The setup as shown in Attunement: the key itself stays hidden.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AiShown {
    pub provider: String,
    pub name: String,
    pub base: String,
    pub model: String,
    pub has_key: bool,
}

impl AiSetup {
    fn shown(&self) -> AiShown {
        AiShown { provider: self.provider.clone(), name: self.label(), base: self.base.clone(), model: self.model.clone(), has_key: !self.key.is_empty() }
    }

    /// Its name on the Translate switch.
    pub fn label(&self) -> String {
        let name = self.name.trim();
        if !name.is_empty() {
            return name.to_string();
        }
        provider(&self.provider).map(|p| p.name.to_string()).unwrap_or_else(|_| "AI".into())
    }

    fn base_url(&self) -> Result<String> {
        let known = provider(&self.provider)?;
        let base = if self.provider == "custom" { self.base.trim() } else { known.base };
        if base.is_empty() {
            return Err(Error::Unsuitable("Add your AI's address.".into()));
        }
        if !(base.starts_with("http://") || base.starts_with("https://")) {
            return Err(Error::Unsuitable("The address should start with http:// or https://.".into()));
        }
        Ok(base.trim_end_matches('/').to_string())
    }

    fn checked(&self) -> Result<()> {
        let known = provider(&self.provider)?;
        self.base_url()?;
        if known.key && self.key.trim().is_empty() {
            return Err(Error::Unsuitable(format!("Add your {} key.", known.name)));
        }
        Ok(())
    }
}

impl Library {
    /// The AI set up on this device, if any.
    pub fn ai_setup_full(&self) -> Result<Option<AiSetup>> {
        Ok(self.setting(SETUP_KEY)?.filter(|s| !s.is_empty()).and_then(|s| serde_json::from_str(&s).ok()))
    }

    pub fn ai_setup(&self) -> Result<Option<AiShown>> {
        Ok(self.ai_setup_full()?.map(|s| s.shown()))
    }

    /// Keeps the setup. An empty key keeps the one already kept for the same service.
    pub fn save_ai_setup(&self, mut setup: AiSetup) -> Result<AiShown> {
        let known = provider(&setup.provider)?;
        setup.name = setup.name.trim().to_string();
        setup.base = setup.base.trim().to_string();
        setup.model = setup.model.trim().to_string();
        setup.key = setup.key.trim().to_string();
        if setup.model.is_empty() {
            setup.model = known.model.to_string();
        }
        if setup.key.is_empty() {
            if let Some(old) = self.ai_setup_full()?.filter(|o| o.provider == setup.provider) {
                setup.key = old.key;
            }
        }
        setup.checked()?;
        if setup.model.is_empty() {
            return Err(Error::Unsuitable("Pick a model.".into()));
        }
        self.set_setting(SETUP_KEY, &serde_json::to_string(&setup)?)?;
        Ok(setup.shown())
    }

    pub fn forget_ai_setup(&self) -> Result<()> {
        self.set_setting(SETUP_KEY, "")
    }

    /// The setup to use for a draft from Attunement: an empty key there means the kept one.
    pub fn ai_setup_draft(&self, mut draft: AiSetup) -> Result<AiSetup> {
        if draft.key.trim().is_empty() {
            if let Some(old) = self.ai_setup_full()?.filter(|o| o.provider == draft.provider) {
                draft.key = old.key;
            }
        }
        Ok(draft)
    }
}

/// How TBV talks to the service, so tests can stand in for it.
pub trait Net {
    fn get(&self, url: &str, headers: &[(&str, String)]) -> Result<(u16, Value)>;
    fn post(&self, url: &str, headers: &[(&str, String)], body: &Value) -> Result<(u16, Value)>;
}

pub struct Http;

fn agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .http_status_as_error(false)
        .timeout_global(Some(Duration::from_secs(300)))
        .user_agent(concat!("The Bound Vigil/", env!("CARGO_PKG_VERSION")))
        .build()
        .into()
}

fn read(mut response: ureq::http::Response<ureq::Body>) -> Result<(u16, Value)> {
    let status = response.status().as_u16();
    let text = response.body_mut().with_config().limit(64 * 1024 * 1024).read_to_string().unwrap_or_default();
    Ok((status, serde_json::from_str(&text).unwrap_or(Value::Null)))
}

fn offline(error: ureq::Error) -> Error {
    Error::Offline(format!("AI: {error}"))
}

impl Net for Http {
    fn get(&self, url: &str, headers: &[(&str, String)]) -> Result<(u16, Value)> {
        let mut request = agent().get(url);
        for (name, value) in headers {
            request = request.header(*name, value);
        }
        read(request.call().map_err(offline)?)
    }

    fn post(&self, url: &str, headers: &[(&str, String)], body: &Value) -> Result<(u16, Value)> {
        let mut request = agent().post(url);
        for (name, value) in headers {
            request = request.header(*name, value);
        }
        read(request.send_json(body).map_err(offline)?)
    }
}

fn headers(setup: &AiSetup) -> Vec<(&'static str, String)> {
    if setup.provider == "claude" {
        return vec![("x-api-key", setup.key.clone()), ("anthropic-version", ANTHROPIC_VERSION.into())];
    }
    if setup.key.is_empty() {
        return Vec::new();
    }
    vec![("authorization", format!("Bearer {}", setup.key))]
}

/// What went wrong, said plainly.
fn failed(setup: &AiSetup, status: u16, body: &Value) -> Error {
    let name = setup.label();
    match status {
        401 | 403 => Error::Unsuitable(format!("{name} didn't accept the key.")),
        402 => Error::Unsuitable(format!("{name} says the account is out of credit.")),
        404 => Error::Unsuitable(format!("{name} couldn't find that model or address.")),
        429 => Error::Unsuitable(format!("{name} is busy or out of credit. Try again later.")),
        _ => {
            let said = body
                .pointer("/error/message")
                .or_else(|| body.pointer("/message"))
                .or_else(|| body.pointer("/error"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            if said.is_empty() {
                Error::Cloud(format!("{name} answered {status}"))
            } else {
                Error::Cloud(format!("{name}: {said}"))
            }
        }
    }
}

/// The models the service offers. Also how Attunement tests a key.
pub fn models(net: &dyn Net, setup: &AiSetup) -> Result<Vec<String>> {
    setup.checked()?;
    let url = if setup.provider == "claude" { format!("{}/models?limit=1000", setup.base_url()?) } else { format!("{}/models", setup.base_url()?) };
    let (status, body) = net.get(&url, &headers(setup))?;
    if status != 200 {
        return Err(failed(setup, status, &body));
    }
    let mut list: Vec<String> = body
        .get("data")
        .or_else(|| body.get("models"))
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|m| m.get("id").or_else(|| m.get("name")).and_then(Value::as_str))
                .map(|id| id.trim_start_matches("models/").to_string())
                .collect()
        })
        .unwrap_or_default();
    list.dedup();
    Ok(list)
}

fn instructions(from: &str, into: &str) -> String {
    format!(
        "You translate a book from {from} into {into}. You are given a JSON array of strings, each one a block of the book in reading order. \
         Answer with only a JSON array holding the same number of strings, each one the translation of the block at the same place. \
         Keep names, numbers and line breaks. Translate faithfully, keep the author's tone, and add no notes or comments."
    )
}

/// One round with the service: the reply's text.
fn ask(net: &dyn Net, setup: &AiSetup, system: &str, user: &str) -> Result<String> {
    let base = setup.base_url()?;
    if setup.provider == "claude" {
        let body = json!({
            "model": setup.model,
            "max_tokens": 16000,
            "system": system,
            "messages": [{ "role": "user", "content": user }],
        });
        let (status, reply) = net.post(&format!("{base}/messages"), &headers(setup), &body)?;
        if status != 200 {
            return Err(failed(setup, status, &reply));
        }
        if reply.get("stop_reason").and_then(Value::as_str) == Some("refusal") {
            return Err(Error::Unsuitable(format!("{} wouldn't translate this part.", setup.label())));
        }
        let text: String = reply
            .get("content")
            .and_then(Value::as_array)
            .map(|blocks| blocks.iter().filter(|b| b.get("type").and_then(Value::as_str) == Some("text")).filter_map(|b| b.get("text").and_then(Value::as_str)).collect())
            .unwrap_or_default();
        return Ok(text);
    }
    let body = json!({
        "model": setup.model,
        "messages": [{ "role": "system", "content": system }, { "role": "user", "content": user }],
    });
    let (status, reply) = net.post(&format!("{base}/chat/completions"), &headers(setup), &body)?;
    if status != 200 {
        return Err(failed(setup, status, &reply));
    }
    Ok(reply.pointer("/choices/0/message/content").and_then(Value::as_str).unwrap_or_default().to_string())
}

/// The JSON array in a reply, even with words or a code fence around it.
fn array_in(reply: &str) -> Option<Vec<String>> {
    let start = reply.find('[')?;
    let end = reply.rfind(']')?;
    if end < start {
        return None;
    }
    serde_json::from_str(&reply[start..=end]).ok()
}

/// Translates blocks of a book, keeping their number and order. When the
/// service answers with the wrong number, the blocks go again in halves.
pub fn translate(net: &dyn Net, setup: &AiSetup, from: &str, into: &str, texts: &[String]) -> Result<Vec<String>> {
    setup.checked()?;
    if texts.is_empty() {
        return Ok(Vec::new());
    }
    let system = instructions(from, into);
    let reply = ask(net, setup, &system, &serde_json::to_string(texts)?)?;
    match array_in(&reply) {
        Some(list) if list.len() == texts.len() => Ok(list),
        _ if texts.len() > 1 => {
            let half = texts.len() / 2;
            let mut first = translate(net, setup, from, into, &texts[..half])?;
            first.extend(translate(net, setup, from, into, &texts[half..])?);
            Ok(first)
        }
        Some(list) if !list.is_empty() => Ok(vec![list.join("\n")]),
        _ => {
            let plain = reply.trim();
            if plain.is_empty() {
                Err(Error::Cloud(format!("{} sent back nothing.", setup.label())))
            } else {
                Ok(vec![plain.to_string()])
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;

    use super::*;
    use crate::library::tests::open_temp_library;

    struct Fake {
        replies: RefCell<Vec<(u16, Value)>>,
        sent: RefCell<Vec<(String, Vec<(String, String)>, Value)>>,
    }

    impl Fake {
        fn new(replies: Vec<(u16, Value)>) -> Self {
            Fake { replies: RefCell::new(replies), sent: RefCell::new(Vec::new()) }
        }
    }

    impl Net for Fake {
        fn get(&self, url: &str, headers: &[(&str, String)]) -> Result<(u16, Value)> {
            self.post(url, headers, &Value::Null)
        }
        fn post(&self, url: &str, headers: &[(&str, String)], body: &Value) -> Result<(u16, Value)> {
            self.sent.borrow_mut().push((url.into(), headers.iter().map(|(a, b)| (a.to_string(), b.clone())).collect(), body.clone()));
            Ok(self.replies.borrow_mut().remove(0))
        }
    }

    fn claude() -> AiSetup {
        AiSetup { provider: "claude".into(), model: "claude-opus-5-5".into(), key: "k".into(), ..Default::default() }
    }

    fn claude_says(text: &str) -> (u16, Value) {
        (200, json!({ "content": [{ "type": "text", "text": text }], "stop_reason": "end_turn" }))
    }

    #[test]
    fn claude_translates_blocks_in_order() {
        let fake = Fake::new(vec![claude_says("```json\n[\"Hello\", \"World\"]\n```")]);
        let out = translate(&fake, &claude(), "German", "English", &["Hallo".into(), "Welt".into()]).unwrap();
        assert_eq!(out, vec!["Hello", "World"]);
        let sent = fake.sent.borrow();
        assert_eq!(sent[0].0, "https://api.anthropic.com/v1/messages");
        assert!(sent[0].1.contains(&("anthropic-version".into(), "2023-06-01".into())));
        assert_eq!(sent[0].2["model"], "claude-opus-5-5");
    }

    #[test]
    fn a_wrong_count_goes_again_in_halves() {
        let fake = Fake::new(vec![claude_says("[\"one\"]"), claude_says("[\"A\"]"), claude_says("[\"B\"]")]);
        let out = translate(&fake, &claude(), "German", "English", &["a".into(), "b".into()]).unwrap();
        assert_eq!(out, vec!["A", "B"]);
    }

    #[test]
    fn other_services_use_chat_completions_and_a_bearer_key() {
        let setup = AiSetup { provider: "openai".into(), model: "m".into(), key: "k".into(), ..Default::default() };
        let fake = Fake::new(vec![(200, json!({ "choices": [{ "message": { "content": "[\"Hi\"]" } }] }))]);
        assert_eq!(translate(&fake, &setup, "German", "English", &["Hallo".into()]).unwrap(), vec!["Hi"]);
        let sent = fake.sent.borrow();
        assert_eq!(sent[0].0, "https://api.openai.com/v1/chat/completions");
        assert!(sent[0].1.contains(&("authorization".into(), "Bearer k".into())));
    }

    #[test]
    fn your_own_ai_needs_an_address_but_no_key() {
        let mut setup = AiSetup { provider: "custom".into(), model: "llama".into(), ..Default::default() };
        assert!(translate(&Fake::new(vec![]), &setup, "German", "English", &["x".into()]).is_err());
        setup.base = "http://localhost:11434/v1/".into();
        let fake = Fake::new(vec![(200, json!({ "data": [{ "id": "llama" }, { "id": "qwen" }] }))]);
        assert_eq!(models(&fake, &setup).unwrap(), vec!["llama", "qwen"]);
        assert_eq!(fake.sent.borrow()[0].0, "http://localhost:11434/v1/models");
        assert!(fake.sent.borrow()[0].1.is_empty());
    }

    #[test]
    fn a_refused_key_is_said_plainly() {
        let fake = Fake::new(vec![(401, json!({ "error": { "message": "invalid x-api-key" } }))]);
        let error = models(&fake, &claude()).unwrap_err().to_string();
        assert_eq!(error, "Claude didn't accept the key.");
    }

    #[test]
    fn the_key_is_kept_but_never_shown() {
        let (_dir, library) = open_temp_library();
        assert_eq!(library.ai_setup().unwrap(), None);
        let shown = library.save_ai_setup(AiSetup { provider: "claude".into(), key: "secret".into(), ..Default::default() }).unwrap();
        assert!(shown.has_key);
        assert_eq!(shown.model, "claude-opus-5-5");
        assert_eq!(shown.name, "Claude");
        let again = library.save_ai_setup(AiSetup { provider: "claude".into(), name: "My Claude".into(), ..Default::default() }).unwrap();
        assert_eq!(again.name, "My Claude");
        assert_eq!(library.ai_setup_full().unwrap().unwrap().key, "secret");
        assert!(library.save_ai_setup(AiSetup { provider: "openai".into(), model: "m".into(), ..Default::default() }).is_err());
        library.forget_ai_setup().unwrap();
        assert_eq!(library.ai_setup().unwrap(), None);
    }
}

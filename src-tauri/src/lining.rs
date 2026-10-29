//! Lining up paired ebooks and audiobooks in the background, for as long as
//! TBV is running (on an iPhone, also while it's away charging, see
//! `tauri_plugin_tbv_ios::background_work`). The work itself is
//! `tbv_core::lineup`; this is the speech engine it hears with (whisper.cpp,
//! on this device), the speech model it downloads the first time, and the
//! loop that goes through the pairs one after another.
//!
//! The ebook's words come from the reader in the web page, which opens the
//! book exactly as it shows it: when a pair needs them, the page is asked
//! ("lining-up-needs-words") and saves them with `save_book_words`.

use std::collections::{HashMap, HashSet};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tbv_core::library::Library;
use tbv_core::lineup::{BookWords, Ended, Me};

/// With nothing to line up, how long before looking again.
const IDLE: Duration = Duration::from_secs(120);
/// After trouble (no internet for the speech model, say), how long before trying a pair again.
const AFTER_TROUBLE: Duration = Duration::from_secs(30 * 60);
/// Out of the way while TBV opens.
const AT_START: Duration = Duration::from_secs(20);

/// What Preferences › Reading › Read-along sets (device setting `readAlong.lineUp`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// Line up pairs by itself.
    pub auto: bool,
    /// "standard" (small.en) or "faster" (base.en).
    pub model: String,
    /// "gentle" (half the processor) or "full".
    pub effort: String,
    /// iPhone: carry on in the background while charging.
    pub background: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Settings { auto: true, model: "standard".into(), effort: "gentle".into(), background: true }
    }
}

const SETTINGS_KEY: &str = "readAlong.lineUp";

fn settings(library: &Mutex<Library>) -> Settings {
    library
        .lock()
        .ok()
        .and_then(|l| l.setting(SETTINGS_KEY).ok().flatten())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

/// The speech model's file, and where it comes from (whisper.cpp's own copies, English only, compressed).
fn model_file(model: &str) -> &'static str {
    if model == "faster" { "ggml-base.en-q5_1.bin" } else { "ggml-small.en-q5_1.bin" }
}

fn model_url(file: &str) -> String {
    format!("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/{file}")
}

fn speech_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("Speech")
}

fn words_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("Read-along words")
}

fn words_path(data_dir: &Path, ebook_id: &str) -> PathBuf {
    // Ids are made by TBV (letters, digits and dashes), but kept to those to be safe.
    let safe: String = ebook_id.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_').collect();
    words_dir(data_dir).join(format!("{safe}.json"))
}

/// What the page shows: the pair being lined up and how far it has got.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub ebook_id: String,
    pub audiobook_id: String,
    pub title: String,
    /// "model" (getting the speech model ready) or "listening".
    pub stage: &'static str,
    pub fraction: f64,
    pub model_loaded: u64,
    pub model_total: u64,
}

struct Engine {
    app: AppHandle,
    library: Arc<Mutex<Library>>,
    data_dir: PathBuf,
    paused: AtomicBool,
    status: Mutex<Option<Status>>,
    /// Woken to look for pairs again at once (a pair was made, words arrived, settings changed).
    wake: (Mutex<bool>, Condvar),
}

static ENGINE: OnceLock<Arc<Engine>> = OnceLock::new();

impl Engine {
    fn tell(&self, status: Option<Status>) {
        *self.status.lock().unwrap_or_else(|e| e.into_inner()) = status.clone();
        let _ = self.app.emit("lining-up", status);
    }

    fn change(&self, f: impl FnOnce(&mut Status)) {
        let mut s = self.status.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(status) = s.as_mut() {
            f(status);
            let _ = self.app.emit("lining-up", Some(status.clone()));
        }
    }

    fn rest(&self, time: Duration) {
        let (woken, wake) = &self.wake;
        let mut w = woken.lock().unwrap_or_else(|e| e.into_inner());
        if !*w {
            w = wake.wait_timeout(w, time).unwrap_or_else(|e| e.into_inner()).0;
        }
        *w = false;
    }

    fn wake(&self) {
        let (woken, wake) = &self.wake;
        *woken.lock().unwrap_or_else(|e| e.into_inner()) = true;
        wake.notify_all();
    }
}

/// Starts lining up in the background.
pub fn start(app: &AppHandle, library: Arc<Mutex<Library>>, data_dir: PathBuf) {
    let engine = Arc::new(Engine {
        app: app.clone(),
        library,
        data_dir,
        paused: AtomicBool::new(false),
        status: Mutex::new(None),
        wake: (Mutex::new(false), Condvar::new()),
    });
    if ENGINE.set(engine.clone()).is_err() {
        return;
    }
    std::thread::Builder::new().name("lining up".into()).spawn(move || run(&engine)).ok();
}

/// This device, as it signs the work it does.
fn me(library: &Mutex<Library>) -> Me {
    let device = library.lock().ok().and_then(|l| l.device_id().ok()).unwrap_or_else(|| "this-device".into());
    Me { device, computer: cfg!(not(any(target_os = "ios", target_os = "android"))) }
}

fn run(engine: &Engine) {
    std::thread::sleep(AT_START);
    let me = me(&engine.library);
    let mut troubled: HashMap<(String, String), Instant> = HashMap::new();
    let mut asked: HashSet<String> = HashSet::new();
    let mut ear: Option<(String, tbv_speech::Whisper)> = None;
    loop {
        let set = settings(&engine.library);
        let paused = engine.paused.load(Ordering::Relaxed);
        if !set.auto || paused {
            ear = None;
            background_work(false, set.background);
            engine.rest(IDLE);
            continue;
        }
        let pairs = engine.library.lock().ok().and_then(|l| l.read_along_pairs().ok()).unwrap_or_default();
        let waiting: Vec<_> = pairs
            .into_iter()
            .filter(|p| p.here && !["pdf", "cbz", "cbr"].contains(&p.ebook_format.to_ascii_lowercase().as_str()))
            .filter(|p| tbv_core::lineup::LineUp::read(p.timing.as_deref()).is_none_or(|l| !l.done && l.failed.is_none()))
            .filter(|p| troubled.get(&(p.ebook_id.clone(), p.audiobook_id.clone())).is_none_or(|until| *until <= Instant::now()))
            .collect();
        // The first pair whose words the page has worked out; the page is asked for the others.
        let mut next = None;
        for pair in &waiting {
            match std::fs::read(words_path(&engine.data_dir, &pair.ebook_id)).ok().and_then(|b| serde_json::from_slice::<BookWords>(&b).ok()) {
                Some(words) => {
                    next = Some((pair.clone(), words));
                    break;
                }
                None => {
                    if asked.insert(pair.ebook_id.clone()) {
                        let _ = engine.app.emit("lining-up-needs-words", &pair.ebook_id);
                    }
                }
            }
        }
        let Some((pair, words)) = next else {
            ear = None;
            background_work(false, set.background);
            engine.rest(IDLE);
            // Asked again next time round, in case the page wasn't ready.
            asked.clear();
            continue;
        };
        background_work(true, set.background);
        let key = (pair.ebook_id.clone(), pair.audiobook_id.clone());
        match line_up_pair(engine, &pair, &words, &set, &me, &mut ear) {
            Ok(Ended::Stopped) => {}
            Ok(_) => {
                let _ = engine.app.emit("lined-up", (&pair.ebook_id, &pair.audiobook_id));
            }
            Err(e) => {
                eprintln!("Lining up stopped: {e}");
                // Kept as it is: the next try carries on from the last piece saved.
                troubled.insert(key, Instant::now() + AFTER_TROUBLE);
                ear = None;
            }
        }
        engine.tell(None);
    }
}

fn line_up_pair(
    engine: &Engine,
    pair: &tbv_core::audio::ReadAlongPair,
    words: &BookWords,
    set: &Settings,
    me: &Me,
    ear: &mut Option<(String, tbv_speech::Whisper)>,
) -> Result<Ended, String> {
    let (title, audiobook, path, format) = {
        let l = engine.library.lock().map_err(|_| "The library is unavailable.")?;
        let title = l.book(&pair.ebook_id).map_err(|e| e.to_string())?.map(|b| b.title).unwrap_or_default();
        let audiobook = l.audiobook(&pair.audiobook_id).map_err(|e| e.to_string())?;
        let (path, format) = l.audio_file(&pair.audiobook_id).map_err(|e| e.to_string())?;
        (title, audiobook, path, format)
    };
    engine.tell(Some(Status {
        ebook_id: pair.ebook_id.clone(),
        audiobook_id: pair.audiobook_id.clone(),
        title,
        stage: "model",
        fraction: pair.pieces as f64 / tbv_core::lineup::piece_count(audiobook.duration_ms) as f64,
        model_loaded: 0,
        model_total: 0,
    }));
    let file = model_file(&set.model);
    if ear.as_ref().is_none_or(|(f, _)| f != file) {
        *ear = None;
        let path = ensure_model(engine, file)?;
        *ear = Some((file.to_string(), tbv_speech::Whisper::open(&path)?));
    }
    let (_, whisper) = ear.as_mut().expect("opened above");
    whisper.set_threads(threads(&set.effort));
    let mut listener = tbv_core::listen::Listener::open(&path, &format, &audiobook.parts).map_err(|e| e.to_string())?;
    let mut clip = |start: u64, len: u64| listener.clip(start, len);
    engine.change(|s| s.stage = "listening");
    let stop = || engine.paused.load(Ordering::Relaxed) || !settings(&engine.library).auto;
    let mut progress = |done: usize, of: u64| engine.change(|s| s.fraction = done as f64 / of.max(1) as f64);
    tbv_core::lineup::line_up(
        &engine.library,
        &pair.ebook_id,
        &pair.audiobook_id,
        audiobook.duration_ms,
        words,
        whisper,
        &mut clip,
        me,
        &stop,
        &mut progress,
    )
    .map_err(|e| e.to_string())
}

/// How many of the processor's cores the speech engine uses.
fn threads(effort: &str) -> i32 {
    let cores = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(2);
    let n = if effort == "full" { cores } else { cores / 2 };
    n.clamp(1, 16) as i32
}

/// The speech model, downloaded the first time (once per model, about 190 MB for the standard one).
fn ensure_model(engine: &Engine, file: &str) -> Result<PathBuf, String> {
    let dir = speech_dir(&engine.data_dir);
    let path = dir.join(file);
    if path.is_file() {
        return Ok(path);
    }
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let part = dir.join(format!("{file}.part"));
    let response = ureq::get(&model_url(file)).call().map_err(|e| format!("Couldn't get the speech model: {e}"))?;
    let total: u64 = response.headers().get("content-length").and_then(|v| v.to_str().ok()?.parse().ok()).unwrap_or(0);
    let mut body = response.into_body().into_reader();
    let mut out = std::fs::File::create(&part).map_err(|e| e.to_string())?;
    let mut buffer = vec![0u8; 256 * 1024];
    let mut loaded = 0u64;
    let mut told = Instant::now();
    loop {
        let n = body.read(&mut buffer).map_err(|e| format!("The speech model stopped coming down: {e}"))?;
        if n == 0 {
            break;
        }
        out.write_all(&buffer[..n]).map_err(|e| e.to_string())?;
        loaded += n as u64;
        if told.elapsed() > Duration::from_millis(300) {
            engine.change(|s| {
                s.model_loaded = loaded;
                s.model_total = total;
            });
            told = Instant::now();
        }
    }
    out.flush().map_err(|e| e.to_string())?;
    drop(out);
    if total > 0 && loaded != total {
        let _ = std::fs::remove_file(&part);
        return Err("The speech model didn't come down whole.".into());
    }
    std::fs::rename(&part, &path).map_err(|e| e.to_string())?;
    Ok(path)
}

/// Tells the iPhone app whether there's lining up to carry on with in the background.
fn background_work(busy: bool, background: bool) {
    #[cfg(target_os = "ios")]
    tauri_plugin_tbv_ios::background_work(busy && background, true);
    #[cfg(not(target_os = "ios"))]
    let _ = (busy, background);
}

// ---- Commands ----

#[tauri::command]
pub fn lining_up_status() -> Option<Status> {
    ENGINE.get().and_then(|e| e.status.lock().ok()?.clone())
}

#[tauri::command]
pub fn lining_up_pause(paused: bool) {
    if let Some(e) = ENGINE.get() {
        e.paused.store(paused, Ordering::Relaxed);
        e.wake();
    }
}

#[tauri::command]
pub fn lining_up_paused() -> bool {
    ENGINE.get().is_some_and(|e| e.paused.load(Ordering::Relaxed))
}

/// Looks for pairs again now (one was just made, or the settings changed).
#[tauri::command]
pub fn lining_up_wake() {
    if let Some(e) = ENGINE.get() {
        e.wake();
    }
}

/// The ebook's words, worked out by the reader in the page.
#[tauri::command]
pub fn save_book_words(ebook_id: String, words: BookWords) -> Result<(), String> {
    let e = ENGINE.get().ok_or("Lining up hasn't started.")?;
    let dir = words_dir(&e.data_dir);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = words_path(&e.data_dir, &ebook_id);
    let tmp = path.with_extension("json.part");
    std::fs::write(&tmp, serde_json::to_vec(&words).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    e.wake();
    Ok(())
}

/// The speech models on this device, by setting name, with their sizes.
#[tauri::command]
pub fn speech_models() -> Vec<(String, u64)> {
    let Some(e) = ENGINE.get() else { return Vec::new() };
    ["standard", "faster"]
        .into_iter()
        .filter_map(|m| std::fs::metadata(speech_dir(&e.data_dir).join(model_file(m))).ok().map(|md| (m.to_string(), md.len())))
        .collect()
}

/// Removes the downloaded speech models (they come down again when needed).
#[tauri::command]
pub fn remove_speech_models() -> Result<(), String> {
    let e = ENGINE.get().ok_or("Lining up hasn't started.")?;
    e.paused.store(true, Ordering::Relaxed);
    let dir = speech_dir(&e.data_dir);
    let result = if dir.exists() { std::fs::remove_dir_all(&dir).map_err(|e| e.to_string()) } else { Ok(()) };
    e.paused.store(false, Ordering::Relaxed);
    e.wake();
    result
}

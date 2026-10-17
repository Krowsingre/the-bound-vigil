//! What sync is doing right now, and what it did lately, for the Sync
//! activity page. Sync runs report into it as they go (see
//! `tbv_core::sync::SyncEvent`), and so do books fetched when they're opened.
//! Kept in memory only: it starts empty each time TBV opens.

use std::collections::VecDeque;
use std::sync::{Mutex, OnceLock};

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tbv_core::sync::{Direction, Lane, ProviderView, SyncEvent, SyncStep};

/// How many finished files the page lists.
const KEEP: usize = 200;

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncActivity {
    pub running: bool,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    /// Each place in this run (or the last one), first place first.
    pub places: Vec<PlaceActivity>,
    /// Finished files, newest first.
    pub recent: VecDeque<FileActivity>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaceActivity {
    pub lane: Lane,
    pub provider: ProviderView,
    pub step: Option<SyncStep>,
    pub received: u32,
    pub sent: u32,
    /// Files planned for the step that's going, and how many are done.
    pub files_total: u32,
    pub files_done: u32,
    pub bytes_total: u64,
    pub bytes_done: u64,
    pub current: Option<FileActivity>,
    pub finished: bool,
    pub problem: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileActivity {
    /// None for a book fetched when it was opened.
    pub lane: Option<Lane>,
    pub direction: Direction,
    pub what: String,
    pub bytes: u64,
    pub at: String,
    pub problem: Option<String>,
}

static ACTIVITY: Mutex<Option<SyncActivity>> = Mutex::new(None);
static APP: OnceLock<AppHandle> = OnceLock::new();

pub fn attach(app: AppHandle) {
    let _ = APP.set(app);
}

pub fn current() -> SyncActivity {
    ACTIVITY.lock().ok().and_then(|a| a.clone()).unwrap_or_default()
}

fn change(work: impl FnOnce(&mut SyncActivity)) {
    let snapshot = {
        let Ok(mut guard) = ACTIVITY.lock() else { return };
        let activity = guard.get_or_insert_with(SyncActivity::default);
        work(activity);
        activity.clone()
    };
    if let Some(app) = APP.get() {
        let _ = app.emit("sync-activity", snapshot);
    }
}

fn now() -> String {
    tbv_core::time::now_utc()
}

fn remember(activity: &mut SyncActivity, item: FileActivity) {
    activity.recent.push_front(item);
    activity.recent.truncate(KEEP);
}

/// A run is starting with these places.
pub fn begin(places: Vec<(Lane, ProviderView)>) {
    change(|a| {
        a.running = true;
        a.started_at = Some(now());
        a.finished_at = None;
        a.places = places
            .into_iter()
            .map(|(lane, provider)| PlaceActivity {
                lane,
                provider,
                step: None,
                received: 0,
                sent: 0,
                files_total: 0,
                files_done: 0,
                bytes_total: 0,
                bytes_done: 0,
                current: None,
                finished: false,
                problem: None,
            })
            .collect();
    });
}

/// A place that couldn't be reached at all, so it never started.
pub fn unreachable(lane: Lane, provider: ProviderView, problem: String) {
    change(|a| {
        a.places.retain(|p| p.lane != lane);
        a.places.push(PlaceActivity {
            lane,
            provider,
            step: None,
            received: 0,
            sent: 0,
            files_total: 0,
            files_done: 0,
            bytes_total: 0,
            bytes_done: 0,
            current: None,
            finished: true,
            problem: Some(problem),
        });
        a.places.sort_by_key(|p| p.lane != Lane::Main);
    });
}

pub fn end() {
    change(|a| {
        a.running = false;
        a.finished_at = Some(now());
        for place in &mut a.places {
            place.current = None;
            place.finished = true;
        }
    });
}

/// Hears one event from a sync run.
pub fn hear(event: SyncEvent) {
    change(|a| {
        let lane = match &event {
            SyncEvent::Step { lane, .. }
            | SyncEvent::Records { lane, .. }
            | SyncEvent::FilesPlanned { lane, .. }
            | SyncEvent::File { lane, .. }
            | SyncEvent::Finished { lane, .. } => *lane,
        };
        let mut finished_file = None;
        if let Some(place) = a.places.iter_mut().find(|p| p.lane == lane) {
            match event {
                SyncEvent::Step { step, .. } => {
                    place.step = Some(step);
                    place.files_total = 0;
                    place.files_done = 0;
                    place.bytes_total = 0;
                    place.bytes_done = 0;
                }
                SyncEvent::Records { received, sent, .. } => {
                    place.received = received;
                    place.sent = sent;
                }
                SyncEvent::FilesPlanned { count, bytes, .. } => {
                    place.files_total += count;
                    place.bytes_total += bytes;
                }
                SyncEvent::File { direction, what, bytes, done, problem, .. } => {
                    let item = FileActivity { lane: Some(lane), direction, what, bytes, at: now(), problem };
                    if done {
                        place.files_done += 1;
                        if direction == Direction::Up {
                            place.bytes_done += bytes;
                        }
                        place.current = None;
                        finished_file = Some(item);
                    } else {
                        place.current = Some(item);
                    }
                }
                SyncEvent::Finished { problem, .. } => {
                    place.finished = true;
                    place.current = None;
                    place.problem = problem;
                }
            }
        }
        if let Some(item) = finished_file {
            remember(a, item);
        }
    });
}

/// A book fetched because it was opened (or sent somewhere) and only the cloud had it.
pub fn book_fetched(what: String, bytes: u64, problem: Option<String>) {
    change(|a| remember(a, FileActivity { lane: None, direction: Direction::Down, what, bytes, at: now(), problem }));
}

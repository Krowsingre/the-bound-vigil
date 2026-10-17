//! Tidying a place up: removing the cloud copies of books that aren't on
//! this computer, so a phone reading through it sees only those books as
//! ready to download.
//!
//! A copy that the other sync place doesn't have is sent there first, and
//! only removed once it has arrived, so tidying never loses a book's only
//! cloud copy unless there's no other place to keep it. The books stay in
//! the library either way.

use std::collections::HashSet;
use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use rusqlite::params;
use serde::Serialize;

use super::moving::carry;
use super::{Lane, Remote};
use crate::error::{Error, Result};
use crate::ids::book_id_hex;
use crate::library::Library;

/// What tidying would do.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TidyPlan {
    /// Copies of books on this computer, which stay.
    pub keep: u32,
    /// Copies the other place already has: simply removed.
    pub remove: Vec<String>,
    /// Copies the other place hasn't got: sent there, then removed.
    pub copy_first: Vec<String>,
    /// Copies with nowhere else to go, because there's no other place.
    pub lose: Vec<String>,
    /// Bytes freed, where the place says its files' sizes.
    pub bytes: u64,
}

impl TidyPlan {
    pub fn is_empty(&self) -> bool {
        self.remove.is_empty() && self.copy_first.is_empty() && self.lose.is_empty()
    }
}

/// How tidying went.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TidyReport {
    pub removed: u32,
    /// Of those, sent to the other place first.
    pub copied: u32,
    /// Left where they were, because they couldn't be sent on.
    pub failed: u32,
    pub stopped: bool,
}

/// How far along tidying is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TidyProgress {
    pub done: u32,
    pub total: u32,
}

impl Library {
    /// The hashes of books whose file is on this computer.
    fn books_here(&self) -> Result<HashSet<String>> {
        let rows = self
            .conn
            .prepare("SELECT book_id, path FROM local_files WHERE path IS NOT NULL")?
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows.into_iter().filter(|(_, path)| Path::new(path).exists()).map(|(id, _)| book_id_hex(&id).to_string()).collect())
    }

    /// Forgets that `paths` were sent to a place, after they're removed from it.
    fn files_gone(&self, paths: &[String], lane: Lane) -> Result<()> {
        let sql = format!("DELETE FROM {} WHERE path = ?1", lane.files_table());
        for path in paths {
            self.conn.execute(&sql, params![path])?;
        }
        Ok(())
    }
}

fn hex_of(name: &str) -> &str {
    name.split('.').next().unwrap_or_default()
}

fn lock(library: &Mutex<Library>) -> Result<std::sync::MutexGuard<'_, Library>> {
    library.lock().map_err(|_| Error::Unsuitable("the library is unavailable".into()))
}

/// Works out what tidying `place` would do. `other` is the second sync
/// place, if there is one. The library is only locked while it's read.
pub fn plan_tidy(library: &Mutex<Library>, place: &mut dyn Remote, other: Option<&mut dyn Remote>) -> Result<TidyPlan> {
    let here = lock(library)?.books_here()?;
    let elsewhere: Option<HashSet<String>> = match other {
        Some(other) => Some(other.list("books/")?.iter().map(|n| hex_of(n).to_string()).collect()),
        None => None,
    };
    let mut plan = TidyPlan::default();
    for (name, size) in place.list_sizes("books/")? {
        if name.starts_with('.') || name.ends_with('/') {
            continue;
        }
        let hex = hex_of(&name);
        if here.contains(hex) {
            plan.keep += 1;
            continue;
        }
        plan.bytes += size.unwrap_or(0);
        let path = format!("books/{name}");
        match &elsewhere {
            Some(has) if has.contains(hex) => plan.remove.push(path),
            Some(_) => plan.copy_first.push(path),
            None => plan.lose.push(path),
        }
    }
    for list in [&mut plan.remove, &mut plan.copy_first, &mut plan.lose] {
        list.sort();
    }
    Ok(plan)
}

/// Carries out `plan` on `place` (synced as `lane`). Copies the other place
/// lacks are sent to it (synced as `other_lane`) first; one that won't go is
/// left where it is. `temp` holds each copy on its way.
#[allow(clippy::too_many_arguments)]
pub fn tidy(
    library: &Mutex<Library>,
    place: &mut dyn Remote,
    lane: Lane,
    mut other: Option<(&mut dyn Remote, Lane)>,
    plan: &TidyPlan,
    temp: &Path,
    cancel: &AtomicBool,
    progress: &mut dyn FnMut(TidyProgress),
) -> Result<TidyReport> {
    fs::create_dir_all(temp)?;
    let mut report = TidyReport::default();
    let jobs: Vec<(&String, bool)> = plan
        .remove
        .iter()
        .chain(&plan.lose)
        .map(|p| (p, false))
        .chain(plan.copy_first.iter().map(|p| (p, true)))
        .collect();
    let total = jobs.len() as u32;
    let mut removed: Vec<String> = Vec::new();
    let mut sent: Vec<String> = Vec::new();
    let other_lane = other.as_ref().map(|(_, l)| *l);
    let outcome = (|| -> Result<()> {
        for (done, (path, copy)) in jobs.into_iter().enumerate() {
            if cancel.load(Ordering::Relaxed) {
                report.stopped = true;
                break;
            }
            progress(TidyProgress { done: done as u32, total });
            if copy {
                let Some((to, _)) = other.as_mut() else {
                    report.failed += 1;
                    continue;
                };
                if carry(place, &mut **to, path, temp).is_err() {
                    report.failed += 1;
                    continue;
                }
                sent.push(path.clone());
                report.copied += 1;
            }
            place.remove(path)?;
            removed.push(path.clone());
            report.removed += 1;
        }
        progress(TidyProgress { done: total, total });
        Ok(())
    })();
    // Recorded even when a removal failed part-way, so this computer knows
    // which copies are gone.
    let library = lock(library)?;
    library.files_gone(&removed, lane)?;
    if let Some(other_lane) = other_lane {
        for path in &sent {
            library.lane_file_sent(path, None, other_lane)?;
        }
    }
    outcome?;
    Ok(report)
}

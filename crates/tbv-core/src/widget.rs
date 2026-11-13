//! What the iPhone's Home Screen and Lock Screen widgets show. TBV writes a
//! small JSON file and shrunken covers into the App Group folder it shares
//! with the widgets; the widgets only ever read them.
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::Result;
use crate::library::Library;
use crate::model::BookPreview;

/// How many books the large widget lists, and how many Sigils it shows.
pub const IN_PROGRESS_MAX: usize = 4;
pub const SIGILS_MAX: usize = 24;
pub const NOTES_MAX: usize = 3;
/// Longest side of a widget cover, in pixels. Widgets are small, and iOS
/// turns away widgets whose pictures are too big.
const COVER_SIDE: u32 = 300;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WidgetBook {
    pub id: String,
    pub title: String,
    pub author: String,
    /// 0 to 1.
    pub progress: f64,
    /// File name of its cover inside the widget folder, if it has one.
    pub cover: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WidgetSigil {
    pub id: String,
    pub title: String,
    pub icon: String,
    pub cover: Option<String>,
}

/// One day of the week chart.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WidgetDay {
    /// `YYYY-MM-DD`.
    pub day: String,
    pub read_minutes: u64,
    pub listen_minutes: u64,
}

/// A book being written in Scribe.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WidgetProject {
    pub id: String,
    pub title: String,
    pub chapters: u32,
    pub cover: Option<String>,
}

/// A personal note in Scribe.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WidgetNote {
    pub id: String,
    pub title: String,
    /// The start of what it says, as plain text.
    pub preview: String,
}

/// The audiobook the app is playing, or last played, as the app tells it.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WidgetAudio {
    pub book_id: String,
    pub title: String,
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub playing: bool,
    #[serde(default)]
    pub progress: f64,
    #[serde(default)]
    pub cover: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WidgetSnapshot {
    pub current: Option<WidgetBook>,
    pub in_progress: Vec<WidgetBook>,
    pub sigils: Vec<WidgetSigil>,
    /// Minutes read and listened today.
    pub today_read_minutes: u64,
    pub today_listen_minutes: u64,
    pub audio: Option<WidgetAudio>,
    /// The seven days ending today, oldest first.
    #[serde(default)]
    pub week: Vec<WidgetDay>,
    /// The book most recently changed in Scribe.
    #[serde(default)]
    pub project: Option<WidgetProject>,
    /// The personal notes most recently changed.
    #[serde(default)]
    pub notes: Vec<WidgetNote>,
    /// `YYYY-MM-DD`, the day the minutes are for, so a widget can show 0 the
    /// next morning before TBV has been opened.
    pub day: String,
}

fn book(preview: &BookPreview) -> WidgetBook {
    WidgetBook {
        id: preview.id.clone(),
        title: preview.title.clone(),
        author: preview.authors.join(", "),
        progress: preview.total_progression.unwrap_or(0.0).clamp(0.0, 1.0),
        cover: preview.cover_path.clone(),
    }
}

impl Library {
    /// Gathers what the widgets show. `today` is the local date
    /// (`YYYY-MM-DD`); `audio` is what the app's player says. Cover fields
    /// hold the original files' paths until [`write_widget_snapshot`] copies them.
    pub fn widget_snapshot(&self, today: &str, audio: Option<WidgetAudio>) -> Result<WidgetSnapshot> {
        let home = self.home()?;
        let current = home.resume_book.as_ref().or(home.in_progress.first()).map(book);
        let in_progress = home.in_progress.iter().take(IN_PROGRESS_MAX).map(book).collect();
        let sigils = self
            .sanctum_links()?
            .into_iter()
            .take(SIGILS_MAX)
            .map(|s| WidgetSigil { id: s.id, title: s.title, icon: s.icon, cover: s.picture_path })
            .collect();
        let spent = self.time_spent()?;
        let (read, listen) = spent.iter().find(|t| t.day == today).map(|t| (t.read, t.listen)).unwrap_or((0, 0));
        let week = week_ending(today)
            .into_iter()
            .map(|day| {
                let t = spent.iter().find(|t| t.day == day);
                WidgetDay { read_minutes: t.map_or(0, |t| t.read / 60), listen_minutes: t.map_or(0, |t| t.listen / 60), day }
            })
            .collect();
        let project = self.writing_projects()?.into_iter().next().map(|p| WidgetProject {
            id: p.id,
            title: p.title,
            chapters: p.chapters,
            cover: p.cover_small_path.or(p.cover_path),
        });
        let query = crate::model::NotesQuery { tab: crate::model::NotesTab::Personal, sort: crate::model::NotesSort::Updated, ..Default::default() };
        let notes = self
            .notes_page(&query)?
            .notes
            .into_iter()
            .take(NOTES_MAX)
            .map(|n| {
                let text = plain(n.note.as_deref().unwrap_or(&n.excerpt));
                let title = n.title.filter(|t| !t.trim().is_empty()).unwrap_or_else(|| text.chars().take(40).collect());
                WidgetNote { id: n.id, title, preview: text.chars().take(120).collect() }
            })
            .collect();
        let audio = match audio {
            Some(mut a) if !a.book_id.is_empty() => {
                if a.cover.is_none() {
                    a.cover = self.book(&a.book_id)?.and_then(|b| b.cover_path);
                }
                Some(a)
            }
            _ => None,
        };
        Ok(WidgetSnapshot {
            current,
            in_progress,
            sigils,
            today_read_minutes: read / 60,
            today_listen_minutes: listen / 60,
            audio,
            week,
            project,
            notes,
            day: today.to_string(),
        })
    }
}

/// Writes `snapshot.json` and small copies of its covers into `folder`,
/// then clears out covers no longer shown. Cover fields in the written file
/// name files in `folder`.
pub fn write_widget_snapshot(folder: &Path, mut snapshot: WidgetSnapshot) -> Result<()> {
    fs::create_dir_all(folder)?;
    let mut kept: Vec<String> = Vec::new();
    let mut shrink = |cover: &mut Option<String>, key: &str| {
        let name = cover.take().and_then(|path| shrunk_cover(folder, Path::new(&path), key));
        if let Some(n) = &name {
            kept.push(n.clone());
        }
        *cover = name;
    };
    if let Some(b) = snapshot.current.as_mut() {
        shrink(&mut b.cover, &b.id.clone());
    }
    for b in snapshot.in_progress.iter_mut() {
        shrink(&mut b.cover, &b.id.clone());
    }
    for s in snapshot.sigils.iter_mut() {
        shrink(&mut s.cover, &format!("sigil-{}", s.id));
    }
    if let Some(p) = snapshot.project.as_mut() {
        shrink(&mut p.cover, &format!("project-{}", p.id));
    }
    if let Some(a) = snapshot.audio.as_mut() {
        shrink(&mut a.cover, &a.book_id.clone());
    }
    let json = serde_json::to_vec(&snapshot)?;
    let temp = folder.join("snapshot.json.part");
    fs::write(&temp, json)?;
    fs::rename(&temp, folder.join("snapshot.json"))?;
    if let Ok(entries) = fs::read_dir(folder) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.ends_with(".jpg") && !kept.contains(&name) {
                let _ = fs::remove_file(entry.path());
            }
        }
    }
    Ok(())
}

/// The seven dates ending with `today`, oldest first.
fn week_ending(today: &str) -> Vec<String> {
    let Ok(end) = chrono::NaiveDate::parse_from_str(today, "%Y-%m-%d") else { return Vec::new() };
    (0..7).rev().filter_map(|back| end.checked_sub_days(chrono::Days::new(back))).map(|d| d.format("%Y-%m-%d").to_string()).collect()
}

/// A note's words without markup, on one line.
fn plain(text: &str) -> String {
    let mut out = String::new();
    let mut in_tag = false;
    for c in text.chars() {
        match c {
            '<' => in_tag = true,
            '>' if in_tag => {
                in_tag = false;
                out.push(' ');
            }
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    let out = out.replace("&nbsp;", " ").replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&#39;", "'");
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// A file name that is safe and stays the same for the same book.
fn cover_name(key: &str) -> String {
    let safe: String = key.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' { c } else { '_' }).collect();
    format!("{}.jpg", safe.chars().take(80).collect::<String>())
}

/// Shrinks `source` into `folder`, reusing the copy already there when the
/// source hasn't changed since. Returns the copy's file name.
fn shrunk_cover(folder: &Path, source: &Path, key: &str) -> Option<String> {
    let name = cover_name(key);
    let target: PathBuf = folder.join(&name);
    let source_time = fs::metadata(source).and_then(|m| m.modified()).ok()?;
    if let Ok(made) = fs::metadata(&target).and_then(|m| m.modified()) {
        if made >= source_time {
            return Some(name);
        }
    }
    let picture = image::open(source).ok()?;
    let small = picture.thumbnail(COVER_SIDE, COVER_SIDE).to_rgb8();
    small.save_with_format(&target, image::ImageFormat::Jpeg).ok()?;
    Some(name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_the_file_and_small_covers_and_tidies_old_ones() {
        let dir = std::env::temp_dir().join(format!("tbv-widget-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let out = dir.join("Widget");
        fs::create_dir_all(&out).unwrap();
        fs::write(out.join("old.jpg"), b"x").unwrap();
        let cover = dir.join("cover.png");
        image::RgbImage::from_pixel(900, 1200, image::Rgb([20, 40, 60])).save(&cover).unwrap();
        let snapshot = WidgetSnapshot {
            current: Some(WidgetBook { id: "sha256:ab/c".into(), title: "T".into(), author: "A".into(), progress: 0.5, cover: Some(cover.to_string_lossy().into()) }),
            day: "2026-11-13".into(),
            ..Default::default()
        };
        write_widget_snapshot(&out, snapshot).unwrap();
        let written: WidgetSnapshot = serde_json::from_slice(&fs::read(out.join("snapshot.json")).unwrap()).unwrap();
        let name = written.current.unwrap().cover.unwrap();
        assert_eq!(name, "sha256_ab_c.jpg");
        let small = image::open(out.join(&name)).unwrap();
        assert!(small.width() <= COVER_SIDE && small.height() <= COVER_SIDE);
        assert!(!out.join("old.jpg").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_week_ends_today_and_notes_lose_their_markup() {
        assert_eq!(week_ending("2026-03-02"), ["2026-02-24", "2026-02-25", "2026-02-26", "2026-02-27", "2026-02-28", "2026-03-01", "2026-03-02"]);
        assert!(week_ending("not a day").is_empty());
        assert_eq!(plain("<p>Tea &amp; <b>toast</b></p><p>later</p>"), "Tea & toast later");
    }
}

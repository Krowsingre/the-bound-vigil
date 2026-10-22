//! The Writing page: books the person writes in TBV. Each is a project of
//! chapters, synced like notes. A chapter's words are kept as the editor's
//! HTML; turning a project into an EPUB happens in the UI (src/writing/epub.ts),
//! which hands the finished file back to be saved or added to the library.

use std::path::Path;

use rusqlite::{params, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};
use crate::ids::new_record_id;
use crate::library::Library;
use crate::model::IsoUtc;
use crate::time::now_utc;

const MAX_TITLE_CHARS: usize = 200;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WritingProject {
    pub id: String,
    pub title: String,
    pub author: Option<String>,
    pub series: Option<String>,
    pub series_index: Option<f64>,
    pub language: Option<String>,
    pub description: Option<String>,
    /// `picture:<file>`, a picture copied into TBV.
    pub cover: Option<String>,
    /// The cover's file on this device, when it's here.
    pub cover_path: Option<String>,
    /// EPUB settings, as the UI keeps them (JSON).
    pub export: String,
    pub chapters: u32,
    pub words: u32,
    pub created_at: IsoUtc,
    pub updated_at: IsoUtc,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WritingChapter {
    pub id: String,
    pub project_id: String,
    pub title: String,
    /// The editor's HTML.
    pub body: String,
    pub position: f64,
    pub words: u32,
    pub updated_at: IsoUtc,
    /// `chapter`, `front` (dedication, foreword…) or `back` (acknowledgements…).
    pub role: String,
}

/// Where a section of a written book goes.
pub const CHAPTER_ROLES: &[&str] = &["chapter", "front", "back"];

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WritingProjectView {
    pub project: WritingProject,
    pub chapters: Vec<WritingChapter>,
}

/// Book details as edited. Every field is written; empty text clears it.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WritingDetails {
    pub title: String,
    pub author: Option<String>,
    pub series: Option<String>,
    pub series_index: Option<f64>,
    pub language: Option<String>,
    pub description: Option<String>,
}

fn clean(text: Option<&str>) -> Option<String> {
    text.map(str::trim).filter(|t| !t.is_empty()).map(str::to_owned)
}

fn title_of(text: &str) -> Result<String> {
    let title = text.trim();
    if title.is_empty() {
        return Err(Error::Unsuitable("give the book a title".into()));
    }
    Ok(title.chars().take(MAX_TITLE_CHARS).collect())
}

/// Words in a chapter's HTML: tags and entities left out, footnotes'
/// words (kept in their `data-footnote` attribute) counted in.
pub fn count_words(html: &str) -> u32 {
    const NOTE: &str = "data-footnote=\"";
    let notes: u32 = html
        .match_indices(NOTE)
        .map(|(at, _)| {
            let rest = &html[at + NOTE.len()..];
            words_outside_tags(&rest[..rest.find('"').unwrap_or(rest.len())])
        })
        .sum();
    words_outside_tags(html) + notes
}

fn words_outside_tags(html: &str) -> u32 {
    let mut text = String::with_capacity(html.len());
    let mut in_tag = false;
    let mut chars = html.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '<' => {
                in_tag = true;
                text.push(' ');
            }
            '>' if in_tag => in_tag = false,
            '&' if !in_tag => {
                // An entity is one character, and none of them are letters that matter here.
                while let Some(&n) = chars.peek() {
                    chars.next();
                    if n == ';' || n.is_whitespace() {
                        break;
                    }
                }
                text.push(' ');
            }
            _ if !in_tag => text.push(c),
            _ => {}
        }
    }
    text.split_whitespace().filter(|w| w.chars().any(char::is_alphanumeric)).count() as u32
}

fn chapter_from(r: &Row) -> rusqlite::Result<WritingChapter> {
    let body: String = r.get(3)?;
    Ok(WritingChapter {
        id: r.get(0)?,
        project_id: r.get(1)?,
        title: r.get(2)?,
        words: count_words(&body),
        body,
        position: r.get(4)?,
        updated_at: r.get(5)?,
        role: r.get(6)?,
    })
}

const CHAPTER_COLUMNS: &str = "id, project_id, title, body, position, updated_at, role";

impl Library {
    /// Every book being written, most recently changed first.
    pub fn writing_projects(&self) -> Result<Vec<WritingProject>> {
        let ids = self
            .conn
            .prepare("SELECT id FROM writing_projects WHERE deleted_at IS NULL ORDER BY updated_at DESC")?
            .query_map([], |r| r.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        ids.iter().map(|id| self.writing_project_row(id)).collect()
    }

    fn writing_project_row(&self, id: &str) -> Result<WritingProject> {
        let project = self
            .conn
            .query_row(
                "SELECT id, title, author, series, series_index, language, description, cover, export, created_at, updated_at
                 FROM writing_projects WHERE id = ?1 AND deleted_at IS NULL",
                params![id],
                |r| {
                    Ok(WritingProject {
                        id: r.get(0)?,
                        title: r.get(1)?,
                        author: r.get(2)?,
                        series: r.get(3)?,
                        series_index: r.get(4)?,
                        language: r.get(5)?,
                        description: r.get(6)?,
                        cover: r.get(7)?,
                        cover_path: None,
                        export: r.get(8)?,
                        chapters: 0,
                        words: 0,
                        created_at: r.get(9)?,
                        updated_at: r.get(10)?,
                    })
                },
            )
            .optional()?
            .ok_or_else(|| Error::Unsuitable("that book no longer exists".into()))?;
        let bodies = self
            .conn
            .prepare("SELECT body FROM writing_chapters WHERE project_id = ?1 AND deleted_at IS NULL")?
            .query_map(params![id], |r| r.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let cover_path = project
            .cover
            .as_deref()
            .and_then(|c| c.strip_prefix("picture:"))
            .map(|file| self.paths.pictures_dir.join(file))
            .filter(|p| p.exists())
            .map(|p| p.display().to_string());
        Ok(WritingProject {
            chapters: bodies.len() as u32,
            words: bodies.iter().map(|b| count_words(b)).sum(),
            cover_path,
            ..project
        })
    }

    /// A book being written, with its chapters in order.
    pub fn writing_project(&self, id: &str) -> Result<WritingProjectView> {
        let project = self.writing_project_row(id)?;
        let chapters = self
            .conn
            .prepare(&format!(
                "SELECT {CHAPTER_COLUMNS} FROM writing_chapters WHERE project_id = ?1 AND deleted_at IS NULL ORDER BY position, created_at"
            ))?
            .query_map(params![id], chapter_from)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(WritingProjectView { project, chapters })
    }

    /// Starts a book, with an empty first chapter to write in.
    pub fn create_writing_project(&self, title: &str, author: Option<&str>) -> Result<WritingProjectView> {
        let title = title_of(title)?;
        let id = new_record_id();
        let now = now_utc();
        self.conn.execute(
            "INSERT INTO writing_projects (id, title, author, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)",
            params![id, title, clean(author), now],
        )?;
        self.add_writing_chapter(&id, "Chapter 1", None)?;
        self.writing_project(&id)
    }

    pub fn update_writing_details(&self, id: &str, details: &WritingDetails) -> Result<WritingProject> {
        let title = title_of(&details.title)?;
        let changed = self.conn.execute(
            "UPDATE writing_projects SET title = ?2, author = ?3, series = ?4, series_index = ?5, language = ?6,
                 description = ?7, updated_at = ?8
             WHERE id = ?1 AND deleted_at IS NULL",
            params![
                id,
                title,
                clean(details.author.as_deref()),
                clean(details.series.as_deref()),
                details.series_index,
                clean(details.language.as_deref()),
                clean(details.description.as_deref()),
                now_utc()
            ],
        )?;
        if changed == 0 {
            return Err(Error::Unsuitable("that book no longer exists".into()));
        }
        self.writing_project_row(id)
    }

    /// Remembers the EPUB settings last used for a book.
    pub fn set_writing_export(&self, id: &str, export: &str) -> Result<()> {
        serde_json::from_str::<serde_json::Value>(export).map_err(|_| Error::Unsuitable("those export settings aren't readable".into()))?;
        self.conn.execute(
            "UPDATE writing_projects SET export = ?2, updated_at = ?3 WHERE id = ?1 AND deleted_at IS NULL AND export IS NOT ?2",
            params![id, export, now_utc()],
        )?;
        Ok(())
    }

    /// Uses a picture from the computer as the cover, or none.
    pub fn set_writing_cover(&self, id: &str, source: Option<&Path>) -> Result<WritingProject> {
        self.writing_project_row(id)?;
        let cover = source.map(|s| self.copy_picture(s)).transpose()?.map(|file| format!("picture:{file}"));
        self.conn.execute(
            "UPDATE writing_projects SET cover = ?2, updated_at = ?3 WHERE id = ?1",
            params![id, cover, now_utc()],
        )?;
        self.forget_unused_pictures()?;
        self.writing_project_row(id)
    }

    /// Uses a picture made in TBV (the cover maker) as the cover. `extension`
    /// is its kind of file: png, jpg or webp.
    pub fn set_writing_cover_bytes(&self, id: &str, bytes: &[u8], extension: &str) -> Result<WritingProject> {
        let extension = extension.trim_start_matches('.').to_ascii_lowercase();
        if !["png", "jpg", "jpeg", "webp"].contains(&extension.as_str()) {
            return Err(Error::Unsuitable("a cover is a PNG, JPEG or WebP picture".into()));
        }
        std::fs::create_dir_all(&self.paths.pictures_dir)?;
        let made = self.paths.pictures_dir.join(format!(".made-{}.{extension}", new_record_id()));
        std::fs::write(&made, bytes)?;
        let result = self.set_writing_cover(id, Some(&made));
        let _ = std::fs::remove_file(&made);
        result
    }

    pub fn delete_writing_project(&self, id: &str) -> Result<()> {
        let now = now_utc();
        self.conn.execute(
            "UPDATE writing_chapters SET deleted_at = ?2, updated_at = ?2 WHERE project_id = ?1 AND deleted_at IS NULL",
            params![id, now],
        )?;
        self.conn.execute(
            "UPDATE writing_projects SET deleted_at = ?2, updated_at = ?2 WHERE id = ?1 AND deleted_at IS NULL",
            params![id, now],
        )?;
        self.forget_unused_pictures()?;
        Ok(())
    }

    /// Adds a chapter after `after`, or at the end.
    pub fn add_writing_chapter(&self, project_id: &str, title: &str, after: Option<&str>) -> Result<WritingChapter> {
        let positions = self
            .conn
            .prepare("SELECT id, position FROM writing_chapters WHERE project_id = ?1 AND deleted_at IS NULL ORDER BY position, created_at")?
            .query_map(params![project_id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, f64>(1)?)))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let at = after.and_then(|a| positions.iter().position(|(id, _)| id == a));
        let position = match at {
            Some(i) => match positions.get(i + 1) {
                Some((_, next)) => (positions[i].1 + next) / 2.0,
                None => positions[i].1 + 1.0,
            },
            None => positions.last().map_or(1.0, |(_, p)| p + 1.0),
        };
        let id = new_record_id();
        let now = now_utc();
        self.conn.execute(
            "INSERT INTO writing_chapters (id, project_id, title, position, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
            params![id, project_id, title.trim().chars().take(MAX_TITLE_CHARS).collect::<String>(), position, now],
        )?;
        self.touch_writing_project(project_id)?;
        self.writing_chapter(&id)
    }

    fn writing_chapter(&self, id: &str) -> Result<WritingChapter> {
        self.conn
            .query_row(
                &format!("SELECT {CHAPTER_COLUMNS} FROM writing_chapters WHERE id = ?1 AND deleted_at IS NULL"),
                params![id],
                chapter_from,
            )
            .optional()?
            .ok_or_else(|| Error::Unsuitable("that chapter no longer exists".into()))
    }

    fn touch_writing_project(&self, project_id: &str) -> Result<()> {
        self.conn.execute("UPDATE writing_projects SET updated_at = ?2 WHERE id = ?1", params![project_id, now_utc()])?;
        Ok(())
    }

    /// Saves a chapter's title and words. Unchanged ones aren't written, so
    /// they don't go out to other devices again.
    pub fn save_writing_chapter(&self, id: &str, title: &str, body: &str) -> Result<WritingChapter> {
        let chapter = self.writing_chapter(id)?;
        let title: String = title.trim().chars().take(MAX_TITLE_CHARS).collect();
        if chapter.title != title || chapter.body != body {
            self.conn.execute(
                "UPDATE writing_chapters SET title = ?2, body = ?3, updated_at = ?4 WHERE id = ?1",
                params![id, title, body, now_utc()],
            )?;
            self.touch_writing_project(&chapter.project_id)?;
        }
        self.writing_chapter(id)
    }

    /// Makes a chapter front matter, back matter, or a chapter again.
    pub fn set_writing_chapter_role(&self, id: &str, role: &str) -> Result<WritingChapter> {
        if !CHAPTER_ROLES.contains(&role) {
            return Err(Error::Unsuitable("a section is a chapter, front matter or back matter".into()));
        }
        let chapter = self.writing_chapter(id)?;
        if chapter.role != role {
            self.conn.execute(
                "UPDATE writing_chapters SET role = ?2, updated_at = ?3 WHERE id = ?1",
                params![id, role, now_utc()],
            )?;
            self.touch_writing_project(&chapter.project_id)?;
        }
        self.writing_chapter(id)
    }

    /// Puts the chapters in this order. Chapters not named keep their places after them.
    pub fn order_writing_chapters(&self, project_id: &str, order: &[String]) -> Result<Vec<WritingChapter>> {
        let mut view = self.writing_project(project_id)?.chapters;
        view.sort_by_key(|c| order.iter().position(|id| *id == c.id).unwrap_or(usize::MAX));
        let now = now_utc();
        for (i, chapter) in view.iter().enumerate() {
            let position = (i + 1) as f64;
            if chapter.position != position {
                self.conn.execute(
                    "UPDATE writing_chapters SET position = ?2, updated_at = ?3 WHERE id = ?1",
                    params![chapter.id, position, now],
                )?;
            }
        }
        self.touch_writing_project(project_id)?;
        Ok(self.writing_project(project_id)?.chapters)
    }

    pub fn delete_writing_chapter(&self, id: &str) -> Result<()> {
        let chapter = self.writing_chapter(id)?;
        let now = now_utc();
        self.conn.execute(
            "UPDATE writing_chapters SET deleted_at = ?2, updated_at = ?2 WHERE id = ?1",
            params![id, now],
        )?;
        self.touch_writing_project(&chapter.project_id)?;
        Ok(())
    }

    /// The cover picture's bytes, for putting into the EPUB.
    pub fn writing_cover_bytes(&self, id: &str) -> Result<Option<(Vec<u8>, String)>> {
        let project = self.writing_project_row(id)?;
        let Some(path) = project.cover_path else {
            return Ok(None);
        };
        let extension = Path::new(&path).extension().map(|e| e.to_string_lossy().to_ascii_lowercase()).unwrap_or_default();
        Ok(Some((std::fs::read(&path)?, extension)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::library::tests::open_temp_library;

    #[test]
    fn words_are_counted_without_the_html() {
        assert_eq!(count_words("<h2>Part one</h2><p>It was a <em>dark</em>&nbsp;night.</p><hr><p>— Then</p>"), 8);
        assert_eq!(count_words(""), 0);
        assert_eq!(count_words(r#"<p>Night<sup data-footnote="A long one &amp; cold." class="writing-footnote"></sup> fell.</p>"#), 6);
    }

    #[test]
    fn a_book_is_written_chapter_by_chapter() {
        let (_dir, library) = open_temp_library();
        let view = library.create_writing_project("  The Ash Road ", Some("Embre")).unwrap();
        assert_eq!(view.project.title, "The Ash Road");
        assert_eq!(view.chapters.len(), 1);
        let first = &view.chapters[0];
        library.save_writing_chapter(&first.id, "Arrival", "<p>Rain on the road.</p>").unwrap();
        let last = library.add_writing_chapter(&view.project.id, "Leaving", None).unwrap();
        let middle = library.add_writing_chapter(&view.project.id, "Between", Some(&first.id)).unwrap();
        let titles = |l: &Library| l.writing_project(&view.project.id).unwrap().chapters.into_iter().map(|c| c.title).collect::<Vec<_>>();
        assert_eq!(titles(&library), ["Arrival", "Between", "Leaving"]);

        library.order_writing_chapters(&view.project.id, &[last.id.clone(), first.id.clone()]).unwrap();
        assert_eq!(titles(&library), ["Leaving", "Arrival", "Between"]);

        library.delete_writing_chapter(&middle.id).unwrap();
        let project = library.writing_project(&view.project.id).unwrap().project;
        assert_eq!((project.chapters, project.words), (2, 4));

        let details = WritingDetails { title: "The Ash Road".into(), series: Some("Roads".into()), series_index: Some(1.0), language: Some("en".into()), ..Default::default() };
        let project = library.update_writing_details(&view.project.id, &details).unwrap();
        assert_eq!(project.series.as_deref(), Some("Roads"));
        assert!(library.update_writing_details(&view.project.id, &WritingDetails::default()).is_err());

        library.delete_writing_project(&view.project.id).unwrap();
        assert!(library.writing_projects().unwrap().is_empty());
    }

    #[test]
    fn a_cover_is_copied_in_and_let_go_when_the_book_is() {
        let (dir, library) = open_temp_library();
        let view = library.create_writing_project("Cover test", None).unwrap();
        let picture = dir.path().join("cover.png");
        std::fs::write(&picture, b"\x89PNG not really").unwrap();
        let project = library.set_writing_cover(&view.project.id, Some(&picture)).unwrap();
        let path = project.cover_path.expect("copied in");
        assert!(Path::new(&path).exists());
        assert_eq!(library.writing_cover_bytes(&view.project.id).unwrap().unwrap().1, "png");
        library.delete_writing_project(&view.project.id).unwrap();
        assert!(!Path::new(&path).exists());
    }

    #[test]
    fn a_made_cover_is_kept_like_a_chosen_one() {
        let (_dir, library) = open_temp_library();
        let view = library.create_writing_project("Made cover", None).unwrap();
        let project = library.set_writing_cover_bytes(&view.project.id, b"\x89PNG made", "png").unwrap();
        assert!(project.cover.as_deref().is_some_and(|c| c.starts_with("picture:") && c.ends_with(".png")));
        assert!(Path::new(&project.cover_path.unwrap()).exists());
        // Only the kept copy is left in the pictures folder.
        let files = std::fs::read_dir(&library.paths().pictures_dir).unwrap().count();
        assert_eq!(files, 1);
        assert!(library.set_writing_cover_bytes(&view.project.id, b"x", "exe").is_err());
    }

    #[test]
    fn sections_can_be_front_or_back_matter() {
        let (_dir, library) = open_temp_library();
        let view = library.create_writing_project("Roles", None).unwrap();
        let first = &view.chapters[0];
        assert_eq!(first.role, "chapter");
        assert_eq!(library.set_writing_chapter_role(&first.id, "front").unwrap().role, "front");
        assert!(library.set_writing_chapter_role(&first.id, "appendix").is_err());
    }
}

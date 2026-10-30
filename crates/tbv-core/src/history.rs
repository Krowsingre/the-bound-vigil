//! Reading history (Preferences › Archive): books finished, dropped or
//! rated, kept after they leave the library. An entry is only taken off by
//! hand, and then nothing about the book is kept.

use rusqlite::params;
use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};
use crate::library::Library;
use crate::model::{IsoUtc, ReadStatus};
use crate::time::now_utc;

/// Starts the history id of a book marked from Suggested reading.
pub const SUGGESTED: &str = "suggested:";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub book_id: String,
    pub title: String,
    pub authors: Vec<String>,
    /// `read` or `dropped`, or none for a book only rated.
    pub status: Option<String>,
    /// Quarter stars, 0.25 to 5.
    pub stars: Option<f64>,
    /// When it was finished or dropped.
    pub finished_at: Option<IsoUtc>,
    /// Whether the book is still in the library.
    pub in_library: bool,
}

impl Library {
    /// Brings a book's history entry up to date after its status or rating
    /// changes. Drafts and copies kept with another book have none.
    pub(crate) fn remember_reading(&self, book_id: &str) -> Result<()> {
        let own: bool = self
            .conn
            .query_row("SELECT same_as IS NULL FROM books WHERE id = ?1 AND deleted_at IS NULL", params![book_id], |r| r.get(0))
            .unwrap_or(false);
        let Some(book) = self.book(book_id)?.filter(|_| own) else {
            return Ok(());
        };
        let status = match book.status {
            ReadStatus::Read | ReadStatus::Dropped => Some(book.status.as_str()),
            _ => None,
        };
        let now = now_utc();
        if status.is_none() && book.rating.is_none() {
            // Nothing left worth remembering, while the book is still here to show it.
            self.conn.execute(
                "UPDATE reading_history SET status = NULL, stars = NULL, deleted_at = ?2, updated_at = ?2
                 WHERE book_id = ?1 AND deleted_at IS NULL",
                params![book_id, now],
            )?;
            return Ok(());
        }
        let authors = serde_json::to_string(&book.authors)?;
        let finished = status.and(book.finished_at.clone());
        self.conn.execute(
            "INSERT INTO reading_history (book_id, title, authors, status, stars, finished_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT (book_id) DO UPDATE SET title = ?2, authors = ?3, status = ?4, stars = ?5, finished_at = ?6,
                 updated_at = ?7, deleted_at = NULL
             WHERE title IS NOT ?2 OR authors IS NOT ?3 OR status IS NOT ?4 OR stars IS NOT ?5 OR finished_at IS NOT ?6 OR deleted_at IS NOT NULL",
            params![book_id, book.title, authors, status, book.rating, finished, now],
        )?;
        Ok(())
    }

    /// Marks a book from Sanctum's Suggested reading (not in the library) as
    /// read or dropped, and rates it, in the reading history under
    /// `suggested:<key>`. With neither left, the entry is taken off.
    pub fn mark_suggestion(&self, key: &str, title: &str, authors: &[String], status: Option<&str>, stars: Option<f64>) -> Result<()> {
        let key = key.trim();
        if key.is_empty() || key.len() > 600 || title.trim().is_empty() {
            return Err(Error::Unsuitable("a suggestion needs its title".into()));
        }
        if status.is_some_and(|s| s != "read" && s != "dropped") {
            return Err(Error::Unsuitable("a suggestion is marked read or dropped".into()));
        }
        if stars.is_some_and(|s| !(0.25..=5.0).contains(&s) || (s * 4.0).fract() != 0.0) {
            return Err(Error::Unsuitable("a rating is a quarter star to 5 stars".into()));
        }
        let id = format!("{SUGGESTED}{key}");
        if status.is_none() && stars.is_none() {
            return self.forget_reading(&id);
        }
        let now = now_utc();
        // A date only when it's first marked, or marked differently.
        let finished: Option<String> = status.map(|s| {
            self.conn
                .query_row(
                    "SELECT finished_at FROM reading_history WHERE book_id = ?1 AND status = ?2 AND deleted_at IS NULL",
                    params![id, s],
                    |r| r.get::<_, Option<String>>(0),
                )
                .ok()
                .flatten()
                .unwrap_or_else(|| now.clone())
        });
        let authors = serde_json::to_string(authors)?;
        self.conn.execute(
            "INSERT INTO reading_history (book_id, title, authors, status, stars, finished_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT (book_id) DO UPDATE SET title = ?2, authors = ?3, status = ?4, stars = ?5, finished_at = ?6,
                 updated_at = ?7, deleted_at = NULL",
            params![id, title.trim(), authors, status, stars, finished, now],
        )?;
        Ok(())
    }

    /// Every entry, the most recently finished first.
    pub fn reading_history(&self) -> Result<Vec<HistoryEntry>> {
        let rows = self
            .conn
            .prepare(
                "SELECT h.book_id, h.title, h.authors, h.status, h.stars, h.finished_at,
                        EXISTS (SELECT 1 FROM books b WHERE b.id = h.book_id AND b.deleted_at IS NULL)
                 FROM reading_history h WHERE h.deleted_at IS NULL
                 ORDER BY COALESCE(h.finished_at, h.updated_at) DESC",
            )?
            .query_map([], |r| {
                let authors: String = r.get(2)?;
                Ok(HistoryEntry {
                    book_id: r.get(0)?,
                    title: r.get(1)?,
                    authors: serde_json::from_str(&authors).unwrap_or_default(),
                    status: r.get(3)?,
                    stars: r.get(4)?,
                    finished_at: r.get(5)?,
                    in_library: r.get(6)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    /// Takes an entry off for good: its title and authors are wiped too, on
    /// every device. A book still in the library keeps its status and rating.
    pub fn forget_reading(&self, book_id: &str) -> Result<()> {
        let now = now_utc();
        self.conn.execute(
            "UPDATE reading_history SET title = '', authors = '[]', status = NULL, stars = NULL, finished_at = NULL,
                 deleted_at = ?2, updated_at = ?2
             WHERE book_id = ?1 AND deleted_at IS NULL",
            params![book_id, now],
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::epub::tests::write_test_epub_with;
    use crate::library::tests::open_temp_library;
    use crate::model::ImportResult;

    #[test]
    fn finished_dropped_and_rated_books_stay_in_the_history_until_taken_off() {
        let (dir, mut library) = open_temp_library();
        let path = dir.path().join("a.epub");
        write_test_epub_with(&path, "Carmilla", "Le Fanu", false, "");
        let ImportResult::Imported { book_id, .. } = library.import_files(&[path]).remove(0) else { panic!() };
        assert!(library.reading_history().unwrap().is_empty());

        library.set_rating(&book_id, Some(3.75)).unwrap();
        library.set_status(&book_id, ReadStatus::Dropped).unwrap();
        let entry = library.reading_history().unwrap().remove(0);
        assert_eq!((entry.status.as_deref(), entry.stars, entry.in_library), (Some("dropped"), Some(3.75), true));
        assert!(entry.finished_at.is_some());
        assert!(library.set_rating(&book_id, Some(3.3)).is_err());

        library.delete_book(&book_id).unwrap();
        let entry = library.reading_history().unwrap().remove(0);
        assert_eq!((entry.title.as_str(), entry.in_library), ("Carmilla", false));

        library.forget_reading(&book_id).unwrap();
        assert!(library.reading_history().unwrap().is_empty());
        let title: String = library.conn.query_row("SELECT title FROM reading_history WHERE book_id = ?1", [&book_id], |r| r.get(0)).unwrap();
        assert_eq!(title, "");
    }

    #[test]
    fn suggested_books_can_be_marked_and_rated_without_being_in_the_library() {
        let (_dir, library) = open_temp_library();
        let authors = vec!["Ursula K. Le Guin".to_string()];
        library.mark_suggestion("the dispossessed|ursula k. le guin", "The Dispossessed", &authors, Some("read"), None).unwrap();
        let entry = library.reading_history().unwrap().remove(0);
        assert_eq!(entry.book_id, "suggested:the dispossessed|ursula k. le guin");
        assert_eq!((entry.status.as_deref(), entry.stars, entry.in_library), (Some("read"), None, false));
        let finished = entry.finished_at.clone();
        assert!(finished.is_some());

        // Rating it keeps the day it was marked read.
        library.mark_suggestion("the dispossessed|ursula k. le guin", "The Dispossessed", &authors, Some("read"), Some(4.5)).unwrap();
        let entry = library.reading_history().unwrap().remove(0);
        assert_eq!((entry.stars, entry.finished_at), (Some(4.5), finished));

        assert!(library.mark_suggestion("x|y", "X", &[], Some("unread"), None).is_err());
        assert!(library.mark_suggestion("x|y", "X", &[], None, Some(4.1)).is_err());

        library.mark_suggestion("the dispossessed|ursula k. le guin", "The Dispossessed", &authors, None, None).unwrap();
        assert!(library.reading_history().unwrap().is_empty());
        library.mark_suggestion("the dispossessed|ursula k. le guin", "The Dispossessed", &authors, Some("dropped"), None).unwrap();
        assert_eq!(library.reading_history().unwrap()[0].status.as_deref(), Some("dropped"));
    }
}

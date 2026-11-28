//! Whole-book translations (embre, 28 November): a book read in another
//! language, made a section at a time by Apple Translate (iPhone, iPad, Mac)
//! or the reader's own AI, and kept so it can be swapped in at will. The book
//! file itself is never touched: each section's text blocks are kept here, in
//! reading order, and the reader puts them in place of the original's.

use rusqlite::{params, OptionalExtension};
use serde::Serialize;

use crate::error::{Error, Result};
use crate::library::Library;
use crate::time::now_utc;

/// How far one translation of a book has got.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TranslationState {
    /// "apple" or "ai".
    pub engine: String,
    /// The language it's in, as a code ("en").
    pub lang: String,
    /// What made it ("Apple", or the AI's name).
    pub name: String,
    /// Sections translated so far.
    pub done: i64,
    /// Sections in the book.
    pub sections: i64,
}

fn engine_ok(engine: &str) -> Result<()> {
    match engine {
        "apple" | "ai" => Ok(()),
        _ => Err(Error::Unsuitable("TBV doesn't know that translator.".into())),
    }
}

impl Library {
    /// Keeps one translated section of a book.
    #[allow(clippy::too_many_arguments)]
    pub fn save_translation(&self, book_id: &str, engine: &str, lang: &str, section: i64, blocks: &[String], sections: i64, name: &str) -> Result<()> {
        engine_ok(engine)?;
        if lang.trim().is_empty() || section < 0 || sections <= section {
            return Err(Error::Unsuitable("That part of the book can't be kept.".into()));
        }
        self.conn.execute(
            "INSERT INTO book_translations (book_id, engine, lang, section, blocks, sections, name, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(book_id, engine, lang, section) DO UPDATE SET
               blocks = excluded.blocks, sections = excluded.sections, name = excluded.name, updated_at = excluded.updated_at",
            params![book_id, engine, lang.trim(), section, serde_json::to_string(blocks)?, sections, name.trim(), now_utc()],
        )?;
        Ok(())
    }

    /// One translated section's blocks, if it has been translated.
    pub fn translation_section(&self, book_id: &str, engine: &str, lang: &str, section: i64) -> Result<Option<Vec<String>>> {
        let blocks: Option<String> = self
            .conn
            .query_row(
                "SELECT blocks FROM book_translations WHERE book_id = ?1 AND engine = ?2 AND lang = ?3 AND section = ?4",
                params![book_id, engine, lang, section],
                |r| r.get(0),
            )
            .optional()?;
        Ok(blocks.map(|b| serde_json::from_str(&b).unwrap_or_default()))
    }

    /// The sections of one translation that are done, so a paused one carries on.
    pub fn translated_sections(&self, book_id: &str, engine: &str, lang: &str) -> Result<Vec<i64>> {
        let mut statement = self
            .conn
            .prepare("SELECT section FROM book_translations WHERE book_id = ?1 AND engine = ?2 AND lang = ?3 ORDER BY section")?;
        let list = statement.query_map(params![book_id, engine, lang], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?;
        Ok(list)
    }

    /// Every translation of a book, made or started.
    pub fn book_translations(&self, book_id: &str) -> Result<Vec<TranslationState>> {
        let mut statement = self.conn.prepare(
            "SELECT engine, lang, MAX(name), COUNT(*), MAX(sections) FROM book_translations
             WHERE book_id = ?1 GROUP BY engine, lang ORDER BY engine, lang",
        )?;
        let list = statement
            .query_map(params![book_id], |r| {
                Ok(TranslationState { engine: r.get(0)?, lang: r.get(1)?, name: r.get(2)?, done: r.get(3)?, sections: r.get(4)? })
            })?
            .collect::<rusqlite::Result<_>>()?;
        Ok(list)
    }
}

#[cfg(test)]
mod tests {
    use crate::library::tests::open_temp_library;

    #[test]
    fn a_translation_is_kept_by_section_and_counted() {
        let (_dir, library) = open_temp_library();
        library.save_translation("b1", "ai", "en", 0, &["Hello".into(), "World".into()], 3, "Claude").unwrap();
        library.save_translation("b1", "ai", "en", 2, &["End".into()], 3, "Claude").unwrap();
        library.save_translation("b1", "ai", "en", 2, &["The end".into()], 3, "Claude").unwrap();
        assert_eq!(library.translation_section("b1", "ai", "en", 0).unwrap(), Some(vec!["Hello".to_string(), "World".to_string()]));
        assert_eq!(library.translation_section("b1", "ai", "en", 2).unwrap(), Some(vec!["The end".to_string()]));
        assert_eq!(library.translation_section("b1", "ai", "en", 1).unwrap(), None);
        assert_eq!(library.translated_sections("b1", "ai", "en").unwrap(), vec![0, 2]);
        let states = library.book_translations("b1").unwrap();
        assert_eq!(states.len(), 1);
        assert_eq!((states[0].done, states[0].sections, states[0].name.as_str()), (2, 3, "Claude"));
        assert!(library.save_translation("b1", "other", "en", 0, &[], 3, "").is_err());
        assert!(library.save_translation("b1", "ai", "en", 3, &[], 3, "").is_err());
    }
}

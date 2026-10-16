//! The Collections page: the four built-in shelves, smart collections that
//! fill themselves, series read from the books, and the user's own
//! collections and reading lists.

use std::fs;
use std::path::Path;

use chrono::{Duration, SecondsFormat, Utc};
use rusqlite::{params, params_from_iter, types::Value, OptionalExtension};

use crate::error::{Error, Result};
use crate::home::{book_from_row, BOOK_COLUMNS, BOOK_FROM};
use crate::ids::new_record_id;
use crate::library::Library;
use crate::model::*;
use crate::profile::AVATAR_FORMATS;
use crate::time::now_utc;

const MAX_PICTURE_BYTES: u64 = 15 * 1024 * 1024;
const MAX_NAME_CHARS: usize = 80;
const MAX_DESCRIPTION_CHARS: usize = 600;
const COVER_STRIP: u32 = 3;

const TITLE: &str = "COALESCE(o_title.value, b.title) COLLATE NOCASE";
const SERIES: &str = "COALESCE(o_series.value, b.series)";

/// The books on a built-in shelf, from each book's own flags.
fn shelf_condition(id: &str) -> Option<(&'static str, &'static str)> {
    Some(match id {
        "shelf:favorites" => ("b.favorite = 1", "b.added_at DESC"),
        "shelf:reading" => (
            "b.status = 'in_progress'",
            "b.last_opened_at IS NULL, b.last_opened_at DESC",
        ),
        "shelf:want_to_read" => ("b.want_to_read = 1", "b.added_at DESC"),
        "shelf:completed" => (
            "b.status = 'read'",
            "b.last_opened_at IS NULL, b.last_opened_at DESC",
        ),
        _ => return None,
    })
}

fn days_ago(days: i64) -> String {
    (Utc::now() - Duration::days(days)).to_rfc3339_opts(SecondsFormat::Millis, true)
}

/// Which books belong, how they are ordered, and the values the SQL needs.
struct Members {
    condition: String,
    order: String,
    values: Vec<Value>,
}

fn clean_text(text: Option<&str>, max: usize) -> Option<String> {
    text.map(str::trim)
        .filter(|t| !t.is_empty())
        .map(|t| t.chars().take(max).collect())
}

/// Badges are names of pictures that ship with TBV: short, lowercase words.
fn clean_badge(badge: Option<&str>) -> Option<String> {
    badge
        .map(str::trim)
        .filter(|b| !b.is_empty() && b.len() <= 32)
        .filter(|b| b.chars().all(|c| c.is_ascii_lowercase() || c == '-'))
        .map(str::to_owned)
}

impl Library {
    fn members(&self, collection: &CollectionRef) -> Result<Members> {
        Ok(match collection {
            CollectionRef::Collection { id } => match shelf_condition(id) {
                Some((condition, order)) => Members {
                    condition: condition.into(),
                    order: format!("{order}, {TITLE}"),
                    values: vec![],
                },
                None => {
                    let (column, direction) = match self.collection_kind(id)? {
                        CollectionKind::ReadingList => ("position", ""),
                        _ => ("added_at", " DESC"),
                    };
                    Members {
                        condition: "EXISTS (SELECT 1 FROM collection_books cb WHERE cb.collection_id = ?1 \
                                    AND cb.book_id = b.id AND cb.removed_at IS NULL)"
                            .into(),
                        order: format!(
                            "(SELECT cb.{column} FROM collection_books cb \
                              WHERE cb.collection_id = ?1 AND cb.book_id = b.id){direction}, {TITLE}"
                        ),
                        values: vec![Value::Text(id.clone())],
                    }
                }
            },
            CollectionRef::Series { name } => Members {
                condition: format!("{SERIES} = ?1"),
                order: format!("b.series_index IS NULL, b.series_index, {TITLE}"),
                values: vec![Value::Text(name.clone())],
            },
            CollectionRef::Smart { smart } => {
                let (condition, order, values) = match smart {
                    SmartKind::RecentlyAdded => {
                        ("b.added_at >= ?1", "b.added_at DESC", vec![days_ago(30)])
                    }
                    SmartKind::Unread => ("b.status = 'unread'", "b.added_at DESC", vec![]),
                    SmartKind::Read => (
                        "b.status = 'read'",
                        "b.last_opened_at IS NULL, b.last_opened_at DESC",
                        vec![],
                    ),
                    SmartKind::Incomplete => ("b.status != 'read'", "b.added_at DESC", vec![]),
                    SmartKind::InProgress => (
                        "b.status = 'in_progress'",
                        "b.last_opened_at IS NULL, b.last_opened_at DESC",
                        vec![],
                    ),
                    SmartKind::Favorites => ("b.favorite = 1", "b.added_at DESC", vec![]),
                };
                Members {
                    condition: condition.into(),
                    order: format!("{order}, {TITLE}"),
                    values: values.into_iter().map(Value::Text).collect(),
                }
            }
        })
    }

    fn collection_kind(&self, id: &str) -> Result<CollectionKind> {
        let kind: Option<String> = self
            .conn
            .query_row(
                "SELECT kind FROM collections WHERE id = ?1 AND deleted_at IS NULL",
                params![id],
                |r| r.get(0),
            )
            .optional()?;
        kind.map(|k| CollectionKind::parse(&k))
            .ok_or_else(|| Error::Unsuitable("that collection no longer exists".into()))
    }

    fn member_count(&self, members: &Members) -> Result<u32> {
        Ok(self.conn.query_row(
            &format!("SELECT COUNT(*) {BOOK_FROM} AND {}", members.condition),
            params_from_iter(members.values.iter()),
            |r| r.get(0),
        )?)
    }

    fn member_covers(&self, members: &Members) -> Result<Vec<CoverRef>> {
        let mut statement = self.conn.prepare(&format!(
            "SELECT b.id, COALESCE(o_title.value, b.title), COALESCE(o_authors.value, b.authors), lf.cover_path
             {BOOK_FROM} AND {} ORDER BY {} LIMIT {COVER_STRIP}",
            members.condition, members.order
        ))?;
        let rows = statement.query_map(params_from_iter(members.values.iter()), |r| {
            let authors: String = r.get(2)?;
            Ok(CoverRef {
                id: r.get(0)?,
                title: r.get(1)?,
                authors: serde_json::from_str(&authors).unwrap_or_default(),
                cover_path: r.get(3)?,
            })
        })?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    fn picture_path(&self, picture: Option<&str>) -> Result<Option<String>> {
        let Some(picture) = picture else {
            return Ok(None);
        };
        if let Some(file) = picture.strip_prefix("picture:") {
            let path = self.paths.pictures_dir.join(file);
            return Ok(path.exists().then(|| path.display().to_string()));
        }
        if let Some(book_id) = picture.strip_prefix("cover:") {
            return Ok(self
                .conn
                .query_row(
                    "SELECT cover_path FROM local_files WHERE book_id = ?1",
                    params![book_id],
                    |r| r.get::<_, Option<String>>(0),
                )
                .optional()?
                .flatten());
        }
        Ok(None)
    }

    fn summaries(&self, filter: &str) -> Result<Vec<CollectionSummary>> {
        let mut statement = self.conn.prepare(&format!(
            "SELECT id, name, description, kind, badge, picture, pinned, created_at,
                    COALESCE(updated_at, created_at)
             FROM collections WHERE deleted_at IS NULL {filter}
             ORDER BY position IS NULL, position, created_at"
        ))?;
        let rows = statement
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, Option<String>>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, Option<String>>(4)?,
                    r.get::<_, Option<String>>(5)?,
                    r.get::<_, bool>(6)?,
                    r.get::<_, String>(7)?,
                    r.get::<_, String>(8)?,
                ))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        rows.into_iter()
            .map(
                |(id, name, description, kind, badge, picture, pinned, created_at, updated_at)| {
                    let members = self.members(&CollectionRef::Collection { id: id.clone() })?;
                    Ok(CollectionSummary {
                        count: self.member_count(&members)?,
                        covers: self.member_covers(&members)?,
                        picture_path: self.picture_path(picture.as_deref())?,
                        id,
                        name,
                        description,
                        kind: CollectionKind::parse(&kind),
                        badge,
                        picture,
                        pinned,
                        created_at,
                        updated_at,
                    })
                },
            )
            .collect()
    }

    pub fn collection(&self, id: &str) -> Result<CollectionSummary> {
        self.summaries(&format!("AND id = '{}'", id.replace('\'', "''")))?
            .pop()
            .ok_or_else(|| Error::Unsuitable("that collection no longer exists".into()))
    }

    pub fn collections_overview(&self) -> Result<CollectionsOverview> {
        let smart = SmartKind::ALL
            .iter()
            .map(|&kind| {
                let members = self.members(&CollectionRef::Smart { smart: kind })?;
                Ok(SmartSummary {
                    kind,
                    count: self.member_count(&members)?,
                })
            })
            .collect::<Result<_>>()?;
        Ok(CollectionsOverview {
            pinned: self.summaries("AND pinned = 1")?,
            smart,
            collections: self.summaries("AND kind != 'shelf'")?,
            series: self.series_summaries()?,
        })
    }

    fn series_summaries(&self) -> Result<Vec<SeriesSummary>> {
        let mut statement = self.conn.prepare(&format!(
            "SELECT {SERIES} AS s, COUNT(*) {BOOK_FROM} AND {SERIES} IS NOT NULL AND trim({SERIES}) != ''
             GROUP BY s ORDER BY s COLLATE NOCASE"
        ))?;
        let rows = statement
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, u32>(1)?)))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        let mut authors = self.conn.prepare(&format!(
            "SELECT DISTINCT json_extract(COALESCE(o_authors.value, b.authors), '$[0]') {BOOK_FROM}
             AND {SERIES} = ?1 AND json_extract(COALESCE(o_authors.value, b.authors), '$[0]') IS NOT NULL"
        ))?;
        rows.into_iter()
            .map(|(name, count)| {
                let members = self.members(&CollectionRef::Series { name: name.clone() })?;
                Ok(SeriesSummary {
                    authors: authors
                        .query_map(params![name], |r| r.get(0))?
                        .collect::<std::result::Result<_, _>>()?,
                    covers: self.member_covers(&members)?,
                    name,
                    count,
                })
            })
            .collect()
    }

    /// One collection with its books, in its own order.
    pub fn collection_detail(&self, collection: &CollectionRef) -> Result<CollectionDetail> {
        let members = self.members(collection)?;
        let mut statement = self.conn.prepare(&format!(
            "{BOOK_COLUMNS} {BOOK_FROM} AND {} ORDER BY {}, b.id",
            members.condition, members.order
        ))?;
        let books = statement
            .query_map(params_from_iter(members.values.iter()), book_from_row)?
            .collect::<std::result::Result<_, _>>()?;
        Ok(CollectionDetail {
            collection: match collection {
                CollectionRef::Collection { id } => Some(self.collection(id)?),
                _ => None,
            },
            books,
        })
    }

    pub fn create_collection(&self, input: &CollectionInput) -> Result<CollectionSummary> {
        if input.kind == CollectionKind::Shelf {
            return Err(Error::Unsuitable(
                "only collections and reading lists can be made".into(),
            ));
        }
        let name = clean_text(Some(&input.name), MAX_NAME_CHARS)
            .ok_or_else(|| Error::Unsuitable("give the collection a name".into()))?;
        let id = new_record_id();
        let now = now_utc();
        self.conn.execute(
            "INSERT INTO collections (id, name, description, kind, badge, pinned, position, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6,
                     (SELECT COALESCE(MAX(position), 0) + 1 FROM collections), ?7, ?7)",
            params![
                id,
                name,
                clean_text(input.description.as_deref(), MAX_DESCRIPTION_CHARS),
                input.kind.as_str(),
                clean_badge(input.badge.as_deref()),
                input.pinned,
                now
            ],
        )?;
        self.collection(&id)
    }

    /// Saves changes. A shelf keeps its name and kind; only its badge and pinning change.
    pub fn update_collection(
        &self,
        id: &str,
        input: &CollectionInput,
    ) -> Result<CollectionSummary> {
        let kind = self.collection_kind(id)?;
        let now = now_utc();
        if kind == CollectionKind::Shelf {
            self.conn.execute(
                "UPDATE collections SET badge = ?2, pinned = ?3, updated_at = ?4 WHERE id = ?1",
                params![id, clean_badge(input.badge.as_deref()), input.pinned, now],
            )?;
        } else {
            if input.kind == CollectionKind::Shelf {
                return Err(Error::Unsuitable(
                    "a collection can't become a shelf".into(),
                ));
            }
            let name = clean_text(Some(&input.name), MAX_NAME_CHARS)
                .ok_or_else(|| Error::Unsuitable("give the collection a name".into()))?;
            self.conn.execute(
                "UPDATE collections SET name = ?2, description = ?3, kind = ?4, badge = ?5, pinned = ?6,
                        updated_at = ?7
                 WHERE id = ?1",
                params![
                    id,
                    name,
                    clean_text(input.description.as_deref(), MAX_DESCRIPTION_CHARS),
                    input.kind.as_str(),
                    clean_badge(input.badge.as_deref()),
                    input.pinned,
                    now
                ],
            )?;
            if kind != CollectionKind::ReadingList && input.kind == CollectionKind::ReadingList {
                // A new reading list starts in the order the books were added.
                self.renumber(id, None)?;
            }
        }
        self.collection(id)
    }

    /// Deletes a collection (never its books). Kept as a tombstone for sync.
    pub fn delete_collection(&self, id: &str) -> Result<()> {
        if self.collection_kind(id)? == CollectionKind::Shelf {
            return Err(Error::Unsuitable(
                "the built-in shelves can't be deleted".into(),
            ));
        }
        let now = now_utc();
        self.conn.execute(
            "UPDATE collections SET deleted_at = ?2, updated_at = ?2 WHERE id = ?1",
            params![id, now],
        )?;
        self.forget_unused_pictures()?;
        Ok(())
    }

    /// Uses a gallery picture (`gallery:<name>`) or a book's cover
    /// (`cover:<book id>`), or no picture at all.
    pub fn set_collection_picture(
        &self,
        id: &str,
        picture: Option<&str>,
    ) -> Result<CollectionSummary> {
        self.collection_kind(id)?;
        if let Some(p) = picture {
            let ok = p
                .strip_prefix("gallery:")
                .is_some_and(|g| clean_badge(Some(g)).is_some())
                || p.strip_prefix("cover:")
                    .is_some_and(|b| b.starts_with("sha256:"));
            if !ok {
                return Err(Error::Unsuitable("that picture can't be used".into()));
            }
        }
        self.write_picture(id, picture)
    }

    /// Copies a picture from the computer into TBV and uses it. The copy is
    /// named by its content, so the same picture is only stored once.
    pub fn set_collection_picture_file(
        &self,
        id: &str,
        source: &Path,
    ) -> Result<CollectionSummary> {
        self.collection_kind(id)?;
        let extension = source
            .extension()
            .map(|e| e.to_string_lossy().to_ascii_lowercase())
            .filter(|e| AVATAR_FORMATS.contains(&e.as_str()))
            .ok_or_else(|| Error::Unsuitable("choose a PNG, JPEG, WebP or GIF picture".into()))?;
        if fs::metadata(source)?.len() > MAX_PICTURE_BYTES {
            return Err(Error::Unsuitable("that picture is over 15 MB".into()));
        }
        let hash = crate::ids::book_id_for_file(source)?;
        let file = format!("{}.{extension}", crate::ids::book_id_hex(&hash));
        fs::create_dir_all(&self.paths.pictures_dir)?;
        let target = self.paths.pictures_dir.join(&file);
        if !target.exists() {
            fs::copy(source, &target)?;
        }
        self.write_picture(id, Some(&format!("picture:{file}")))
    }

    fn write_picture(&self, id: &str, picture: Option<&str>) -> Result<CollectionSummary> {
        self.conn.execute(
            "UPDATE collections SET picture = ?2, updated_at = ?3 WHERE id = ?1",
            params![id, picture, now_utc()],
        )?;
        self.forget_unused_pictures()?;
        self.collection(id)
    }

    /// Removes copied pictures no collection uses any more.
    fn forget_unused_pictures(&self) -> Result<()> {
        let Ok(entries) = fs::read_dir(&self.paths.pictures_dir) else {
            return Ok(());
        };
        let mut used = self.conn.prepare(
            "SELECT 1 FROM collections WHERE picture = ?1 AND deleted_at IS NULL LIMIT 1",
        )?;
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if !used.exists(params![format!("picture:{name}")])? {
                let _ = fs::remove_file(entry.path());
            }
        }
        Ok(())
    }

    /// Adds books to the end of a collection. Books already in it stay put.
    pub fn add_to_collection(&self, id: &str, book_ids: &[BookId]) -> Result<()> {
        if self.collection_kind(id)? == CollectionKind::Shelf {
            return Err(Error::Unsuitable(
                "books join a shelf from their own menu".into(),
            ));
        }
        let now = now_utc();
        let tx = self.conn.unchecked_transaction()?;
        for book_id in book_ids {
            tx.execute(
                "INSERT INTO collection_books (collection_id, book_id, added_at, updated_at, position)
                 VALUES (?1, ?2, ?3, ?3,
                         (SELECT COALESCE(MAX(position), 0) + 1 FROM collection_books
                          WHERE collection_id = ?1 AND removed_at IS NULL))
                 ON CONFLICT(collection_id, book_id) DO UPDATE SET
                     added_at = CASE WHEN removed_at IS NULL THEN added_at ELSE excluded.added_at END,
                     position = CASE WHEN removed_at IS NULL THEN position ELSE excluded.position END,
                     updated_at = CASE WHEN removed_at IS NULL THEN updated_at ELSE excluded.updated_at END,
                     removed_at = NULL",
                params![id, book_id, now],
            )?;
        }
        tx.execute(
            "UPDATE collections SET updated_at = ?2 WHERE id = ?1",
            params![id, now],
        )?;
        tx.commit()?;
        Ok(())
    }

    /// Takes a book out of a collection. The book stays in the library.
    pub fn remove_from_collection(&self, id: &str, book_id: &str) -> Result<()> {
        let now = now_utc();
        self.conn.execute(
            "UPDATE collection_books SET removed_at = ?3, updated_at = ?3
             WHERE collection_id = ?1 AND book_id = ?2 AND removed_at IS NULL",
            params![id, book_id, now],
        )?;
        Ok(())
    }

    /// Moves one of the user's collections to a new place (zero-based) in
    /// "Your order". Shelves keep their own place.
    pub fn move_collection(&self, id: &str, to_index: usize) -> Result<()> {
        let mut ids: Vec<String> = self
            .conn
            .prepare(
                "SELECT id FROM collections WHERE deleted_at IS NULL AND kind != 'shelf'
                 ORDER BY position IS NULL, position, created_at",
            )?
            .query_map([], |r| r.get(0))?
            .collect::<std::result::Result<_, _>>()?;
        let Some(from) = ids.iter().position(|c| c == id) else {
            return Err(Error::Unsuitable("that collection no longer exists".into()));
        };
        let moving = ids.remove(from);
        ids.insert(to_index.min(ids.len()), moving);
        let now = now_utc();
        let tx = self.conn.unchecked_transaction()?;
        for (i, id) in ids.iter().enumerate() {
            tx.execute(
                "UPDATE collections SET position = ?2, updated_at = ?3
                 WHERE id = ?1 AND (position IS NULL OR position != ?2)",
                params![id, (i + 1) as f64, now],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    /// Moves a book to a new place (zero-based) in a reading list.
    pub fn move_in_collection(&self, id: &str, book_id: &str, to_index: usize) -> Result<()> {
        self.renumber(id, Some((book_id, to_index)))
    }

    fn renumber(&self, id: &str, moving: Option<(&str, usize)>) -> Result<()> {
        let order = if moving.is_some() {
            "position"
        } else {
            "added_at"
        };
        let mut ids: Vec<String> = self
            .conn
            .prepare(&format!(
                "SELECT book_id FROM collection_books WHERE collection_id = ?1 AND removed_at IS NULL
                 ORDER BY {order} IS NULL, {order}, added_at"
            ))?
            .query_map(params![id], |r| r.get(0))?
            .collect::<std::result::Result<_, _>>()?;
        if let Some((book_id, to)) = moving {
            let Some(from) = ids.iter().position(|b| b == book_id) else {
                return Ok(());
            };
            let book = ids.remove(from);
            ids.insert(to.min(ids.len()), book);
        }
        let now = now_utc();
        let tx = self.conn.unchecked_transaction()?;
        for (i, book_id) in ids.iter().enumerate() {
            tx.execute(
                "UPDATE collection_books SET position = ?3, updated_at = ?4
                 WHERE collection_id = ?1 AND book_id = ?2 AND (position IS NULL OR position != ?3)",
                params![id, book_id, (i + 1) as f64, now],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    /// The user's collections (not shelves) a book is in.
    pub fn collections_for_book(&self, book_id: &str) -> Result<Vec<String>> {
        let mut statement = self.conn.prepare(
            "SELECT c.id FROM collection_books cb JOIN collections c ON c.id = cb.collection_id
             WHERE cb.book_id = ?1 AND cb.removed_at IS NULL AND c.deleted_at IS NULL AND c.kind != 'shelf'",
        )?;
        let rows = statement.query_map(params![book_id], |r| r.get(0))?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::epub::tests::write_test_epub_with;
    use crate::library::tests::open_temp_library;

    fn add(library: &mut Library, dir: &Path, title: &str, extra: &str) -> String {
        let path = dir.join(format!("{title}.epub"));
        write_test_epub_with(&path, title, "Author", true, extra);
        match library.import_files(&[path]).remove(0) {
            ImportResult::Imported { book_id, .. } => book_id,
            other => panic!("{other:?}"),
        }
    }

    fn input(name: &str, kind: CollectionKind) -> CollectionInput {
        CollectionInput {
            name: name.into(),
            description: Some("  ".into()),
            kind,
            badge: Some("moon".into()),
            pinned: false,
        }
    }

    #[test]
    fn shelves_are_built_in_and_follow_the_books() {
        let (dir, mut library) = open_temp_library();
        let a = add(&mut library, dir.path(), "Alpha", "");
        add(&mut library, dir.path(), "Beta", "");
        library.set_favorite(&a, true).unwrap();

        let overview = library.collections_overview().unwrap();
        let names: Vec<_> = overview.pinned.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(
            names,
            ["Favourites", "Currently reading", "To be read", "Completed"]
        );
        assert_eq!(overview.pinned[0].count, 1);
        assert!(
            overview.collections.is_empty(),
            "shelves aren't listed as the user's own"
        );
        assert_eq!(library.shelf_counts().unwrap().collections, 0);

        let shelf = CollectionRef::Collection {
            id: "shelf:favorites".into(),
        };
        assert!(library.delete_collection("shelf:favorites").is_err());
        assert!(library
            .add_to_collection("shelf:favorites", std::slice::from_ref(&a))
            .is_err());
        let detail = library.collection_detail(&shelf).unwrap();
        assert_eq!(detail.books.len(), 1);

        // A shelf keeps its name; its badge and pinning can change.
        let changed = library
            .update_collection(
                "shelf:favorites",
                &CollectionInput {
                    pinned: false,
                    ..input("Renamed", CollectionKind::Collection)
                },
            )
            .unwrap();
        assert_eq!(changed.name, "Favourites");
        assert_eq!(changed.badge.as_deref(), Some("moon"));
        assert_eq!(library.collections_overview().unwrap().pinned.len(), 3);
    }

    #[test]
    fn collections_hold_books_and_reading_lists_keep_order() {
        let (dir, mut library) = open_temp_library();
        let a = add(&mut library, dir.path(), "Alpha", "");
        let b = add(&mut library, dir.path(), "Beta", "");
        let c = add(&mut library, dir.path(), "Gamma", "");

        assert!(library
            .create_collection(&input("  ", CollectionKind::Collection))
            .is_err());
        let list = library
            .create_collection(&input(" Winter list ", CollectionKind::ReadingList))
            .unwrap();
        assert_eq!(list.name, "Winter list");
        assert_eq!(
            list.description, None,
            "a blank description is no description"
        );

        library
            .add_to_collection(&list.id, &[b.clone(), a.clone(), c.clone()])
            .unwrap();
        library
            .add_to_collection(&list.id, std::slice::from_ref(&b))
            .unwrap();
        let reference = CollectionRef::Collection {
            id: list.id.clone(),
        };
        let order = |l: &Library| -> Vec<String> {
            l.collection_detail(&reference)
                .unwrap()
                .books
                .into_iter()
                .map(|b| b.title)
                .collect()
        };
        assert_eq!(order(&library), ["Beta", "Alpha", "Gamma"]);

        library.move_in_collection(&list.id, &c, 0).unwrap();
        assert_eq!(order(&library), ["Gamma", "Beta", "Alpha"]);

        library.remove_from_collection(&list.id, &b).unwrap();
        assert_eq!(order(&library), ["Gamma", "Alpha"]);
        assert_eq!(
            library.collections_for_book(&b).unwrap(),
            Vec::<String>::new()
        );
        assert_eq!(
            library.collections_for_book(&a).unwrap(),
            vec![list.id.clone()]
        );

        // Adding a removed book again puts it at the end.
        library
            .add_to_collection(&list.id, std::slice::from_ref(&b))
            .unwrap();
        assert_eq!(order(&library), ["Gamma", "Alpha", "Beta"]);
        assert_eq!(library.collection(&list.id).unwrap().count, 3);

        library.delete_collection(&list.id).unwrap();
        assert!(library
            .collections_overview()
            .unwrap()
            .collections
            .is_empty());
        assert_eq!(
            library
                .collection_detail(&CollectionRef::Smart {
                    smart: SmartKind::Unread
                })
                .unwrap()
                .books
                .len(),
            3
        );
    }

    #[test]
    fn collections_can_be_put_in_your_own_order() {
        let (_dir, library) = open_temp_library();
        let names = ["One", "Two", "Three"];
        let ids: Vec<String> = names
            .iter()
            .map(|n| {
                library
                    .create_collection(&input(n, CollectionKind::Collection))
                    .unwrap()
                    .id
            })
            .collect();
        library.move_collection(&ids[2], 0).unwrap();
        library.move_collection(&ids[0], 5).unwrap();
        let order: Vec<String> = library
            .collections_overview()
            .unwrap()
            .collections
            .into_iter()
            .map(|c| c.name)
            .collect();
        assert_eq!(order, ["Three", "Two", "One"]);
        assert!(library.move_collection("shelf:favorites", 0).is_err());
    }

    #[test]
    fn series_and_smart_collections_fill_themselves() {
        let (dir, mut library) = open_temp_library();
        let series = r#"<meta name="calibre:series" content="Holmes"/><meta name="calibre:series_index" content="2"/>"#;
        let first = r#"<meta name="calibre:series" content="Holmes"/><meta name="calibre:series_index" content="1"/>"#;
        add(&mut library, dir.path(), "Second", series);
        let one = add(&mut library, dir.path(), "First", first);
        add(&mut library, dir.path(), "Alone", "");
        library.set_status(&one, ReadStatus::InProgress).unwrap();

        let overview = library.collections_overview().unwrap();
        assert_eq!(overview.series.len(), 1);
        assert_eq!(overview.series[0].name, "Holmes");
        assert_eq!(overview.series[0].count, 2);
        let detail = library
            .collection_detail(&CollectionRef::Series {
                name: "Holmes".into(),
            })
            .unwrap();
        assert_eq!(
            detail
                .books
                .iter()
                .map(|b| b.title.as_str())
                .collect::<Vec<_>>(),
            ["First", "Second"]
        );

        let count = |kind| {
            overview
                .smart
                .iter()
                .find(|s| s.kind == kind)
                .unwrap()
                .count
        };
        assert_eq!(count(SmartKind::RecentlyAdded), 3);
        assert_eq!(count(SmartKind::Unread), 2);
        assert_eq!(count(SmartKind::Read), 0);
        assert_eq!(count(SmartKind::Incomplete), 3);
        assert_eq!(count(SmartKind::InProgress), 1);
        assert_eq!(count(SmartKind::Favorites), 0);
    }

    #[test]
    fn pictures_from_the_gallery_covers_and_the_computer() {
        let (dir, mut library) = open_temp_library();
        let a = add(&mut library, dir.path(), "Alpha", "");
        let c = library
            .create_collection(&input("Mine", CollectionKind::Collection))
            .unwrap();

        assert!(library
            .set_collection_picture(&c.id, Some("https://example.com/x.png"))
            .is_err());
        let g = library
            .set_collection_picture(&c.id, Some("gallery:peaks"))
            .unwrap();
        assert_eq!(g.picture.as_deref(), Some("gallery:peaks"));
        assert_eq!(g.picture_path, None);
        let cover = library
            .set_collection_picture(&c.id, Some(&format!("cover:{a}")))
            .unwrap();
        assert_eq!(
            cover.picture.as_deref(),
            Some(format!("cover:{a}").as_str())
        );

        let source = dir.path().join("Sky.JPG");
        fs::write(&source, b"jpeg bytes").unwrap();
        let p = library.set_collection_picture_file(&c.id, &source).unwrap();
        let path = p.picture_path.clone().unwrap();
        assert!(path.starts_with(library.paths().pictures_dir.to_str().unwrap()));
        assert!(p.picture.unwrap().ends_with(".jpg"));
        assert!(source.exists(), "the original is left alone");

        // Switching away removes the copy nobody uses any more.
        library.set_collection_picture(&c.id, None).unwrap();
        assert!(!Path::new(&path).exists());
    }
}

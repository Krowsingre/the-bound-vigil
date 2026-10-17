//! The Library page: every book, by shelf, searched, filtered, sorted and paged.

use rusqlite::{params, params_from_iter, types::Value};

use crate::error::{Error, Result};
use crate::home::{book_from_row, BOOK_COLUMNS, BOOK_FROM};
use crate::library::Library;
use crate::model::*;

pub const DEFAULT_PAGE_SIZE: u32 = 24;
const MAX_PAGE_SIZE: u32 = 200;

const TITLE: &str = "COALESCE(o_title.value, b.title)";
const FIRST_AUTHOR: &str = "json_extract(COALESCE(o_authors.value, b.authors), '$[0]')";
const SERIES: &str = "COALESCE(o_series.value, b.series)";

/// Title without a leading "The", "A" or "An", so "The Hobbit" sorts under H.
fn sort_title() -> String {
    format!(
        "CASE WHEN lower({TITLE}) LIKE 'the %' THEN substr({TITLE}, 5) \
              WHEN lower({TITLE}) LIKE 'an %' THEN substr({TITLE}, 4) \
              WHEN lower({TITLE}) LIKE 'a %' THEN substr({TITLE}, 3) \
              ELSE {TITLE} END COLLATE NOCASE"
    )
}

fn order_by(sort: SortOrder) -> String {
    let title = sort_title();
    match sort {
        SortOrder::RecentlyAdded => "b.added_at DESC".into(),
        SortOrder::RecentlyOpened => {
            "b.last_opened_at IS NULL, b.last_opened_at DESC, b.added_at DESC".into()
        }
        SortOrder::Title => title,
        SortOrder::Author => {
            format!("{FIRST_AUTHOR} IS NULL, {FIRST_AUTHOR} COLLATE NOCASE, {title}")
        }
        SortOrder::Series => format!(
            "{SERIES} IS NULL, {SERIES} COLLATE NOCASE, b.series_index IS NULL, b.series_index, {title}"
        ),
        SortOrder::Progress => format!("COALESCE(b.total_progression, 0) DESC, {title}"),
        SortOrder::Rating => format!("b.rating IS NULL, b.rating DESC, {title}"),
    }
}

/// `%` and `_` typed by the user match themselves, not anything.
fn like_pattern(text: &str) -> String {
    let escaped = text
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_");
    format!("%{}%", escaped.to_lowercase())
}

impl Library {
    pub fn library_page(&self, query: &LibraryQuery) -> Result<LibraryPage> {
        let mut conditions: Vec<String> = Vec::new();
        let mut values: Vec<Value> = Vec::new();

        match query.shelf {
            Shelf::All => {}
            Shelf::Favorites => conditions.push("b.favorite = 1".into()),
            Shelf::WantToRead => conditions.push("b.want_to_read = 1".into()),
            Shelf::InProgress => conditions.push("b.status = 'in_progress'".into()),
            Shelf::Read => conditions.push("b.status = 'read'".into()),
            Shelf::Unread => conditions.push("b.status = 'unread'".into()),
        }

        if let Some(search) = query
            .search
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            conditions.push(format!(
                "(tbv_fold({TITLE}) LIKE ?{n} ESCAPE '\\' \
                  OR tbv_fold(COALESCE(o_authors.value, b.authors)) LIKE ?{n} ESCAPE '\\' \
                  OR tbv_fold(COALESCE({SERIES}, '')) LIKE ?{n} ESCAPE '\\')",
                n = values.len() + 1
            ));
            values.push(Value::Text(like_pattern(search)));
        }

        if !query.formats.is_empty() {
            let start = values.len() + 1;
            let slots: Vec<String> = (0..query.formats.len())
                .map(|i| format!("?{}", start + i))
                .collect();
            conditions.push(format!("b.format IN ({})", slots.join(", ")));
            values.extend(query.formats.iter().map(|f| Value::Text(f.to_lowercase())));
        }

        if !query.tags.is_empty() {
            let start = values.len() + 1;
            let slots: Vec<String> = (0..query.tags.len())
                .map(|i| format!("?{}", start + i))
                .collect();
            conditions.push(format!(
                "EXISTS (SELECT 1 FROM book_tags t WHERE t.book_id = b.id AND t.removed_at IS NULL \
                 AND lower(t.tag) IN ({}))",
                slots.join(", ")
            ));
            values.extend(
                query
                    .tags
                    .iter()
                    .map(|t| Value::Text(t.trim().to_lowercase())),
            );
        }

        match query.location {
            Some(Location::OnDevice) => conditions.push("lf.book_id IS NOT NULL".into()),
            Some(Location::CloudOnly) => conditions.push("lf.book_id IS NULL".into()),
            None => {}
        }

        let filter: String = conditions.iter().map(|c| format!(" AND {c}")).collect();

        let total: u32 = self.conn.query_row(
            &format!("SELECT COUNT(*) {BOOK_FROM} {filter}"),
            params_from_iter(values.iter()),
            |r| r.get(0),
        )?;

        let page_size = match query.page_size {
            0 => DEFAULT_PAGE_SIZE,
            n => n.min(MAX_PAGE_SIZE),
        };
        // Stay on a real page when the list shrinks (a filter, or a book moving shelf).
        let last_page = total.saturating_sub(1) / page_size;
        let page = query.page.min(last_page);

        let sql = format!(
            "{BOOK_COLUMNS} {BOOK_FROM} {filter} ORDER BY {}, b.id LIMIT {page_size} OFFSET {}",
            order_by(query.sort),
            page * page_size
        );
        let mut statement = self.conn.prepare(&sql)?;
        let books = statement
            .query_map(params_from_iter(values.iter()), book_from_row)?
            .collect::<std::result::Result<_, _>>()?;

        Ok(LibraryPage {
            books,
            total,
            page,
            page_size,
            counts: self.shelf_counts()?,
            formats: self.formats_in_library()?,
            tags: self.all_tags()?.into_iter().map(|t| t.name).collect(),
        })
    }

    pub fn shelf_counts(&self) -> Result<ShelfCounts> {
        Ok(self.conn.query_row(
            "SELECT COUNT(*),
                    COALESCE(SUM(favorite = 1), 0),
                    COALESCE(SUM(want_to_read = 1), 0),
                    COALESCE(SUM(status = 'in_progress'), 0),
                    COALESCE(SUM(status = 'read'), 0),
                    COALESCE(SUM(status = 'unread'), 0),
                    (SELECT COUNT(*) FROM collections WHERE deleted_at IS NULL AND kind != 'shelf')
             FROM books WHERE deleted_at IS NULL",
            [],
            |r| {
                Ok(ShelfCounts {
                    all: r.get(0)?,
                    favorites: r.get(1)?,
                    want_to_read: r.get(2)?,
                    in_progress: r.get(3)?,
                    read: r.get(4)?,
                    unread: r.get(5)?,
                    collections: r.get(6)?,
                })
            },
        )?)
    }

    fn formats_in_library(&self) -> Result<Vec<String>> {
        let mut statement = self.conn.prepare(
            "SELECT DISTINCT format FROM books WHERE deleted_at IS NULL ORDER BY format",
        )?;
        let rows = statement.query_map([], |r| r.get(0))?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    pub fn set_favorite(&self, book_id: &str, favorite: bool) -> Result<()> {
        self.conn.execute(
            "UPDATE books SET favorite = ?2 WHERE id = ?1",
            params![book_id, favorite],
        )?;
        Ok(())
    }

    /// Sets your star rating, 1 to 5, or clears it with `None`.
    pub fn set_rating(&self, book_id: &str, rating: Option<u8>) -> Result<()> {
        if rating.is_some_and(|r| !(1..=5).contains(&r)) {
            return Err(Error::Unsuitable("a rating is 1 to 5 stars".into()));
        }
        self.conn.execute("UPDATE books SET rating = ?2 WHERE id = ?1", params![book_id, rating])?;
        Ok(())
    }

    pub fn set_want_to_read(&self, book_id: &str, want: bool) -> Result<()> {
        self.conn.execute(
            "UPDATE books SET want_to_read = ?2 WHERE id = ?1",
            params![book_id, want],
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::epub::tests::{write_test_epub, write_test_epub_with};
    use crate::library::tests::open_temp_library;
    use std::path::Path;

    fn add(library: &mut Library, dir: &Path, title: &str, author: &str) -> String {
        add_with(library, dir, title, author, "")
    }

    fn add_with(
        library: &mut Library,
        dir: &Path,
        title: &str,
        author: &str,
        extra: &str,
    ) -> String {
        let path = dir.join(format!("{title}.epub"));
        write_test_epub_with(&path, title, author, false, extra);
        std::thread::sleep(std::time::Duration::from_millis(3));
        match &library.import_files(&[path])[0] {
            ImportResult::Imported { book_id, .. } => book_id.clone(),
            other => panic!("{other:?}"),
        }
    }

    fn titles(page: &LibraryPage) -> Vec<&str> {
        page.books.iter().map(|b| b.title.as_str()).collect()
    }

    fn query(f: impl FnOnce(&mut LibraryQuery)) -> LibraryQuery {
        let mut q = LibraryQuery::default();
        f(&mut q);
        q
    }

    #[test]
    fn empty_library_is_one_empty_page() {
        let (_dir, library) = open_temp_library();
        let page = library.library_page(&LibraryQuery::default()).unwrap();
        assert!(page.books.is_empty());
        assert_eq!(
            (page.total, page.page, page.page_size),
            (0, 0, DEFAULT_PAGE_SIZE)
        );
        assert_eq!(page.counts, ShelfCounts::default());
    }

    #[test]
    fn sorts_by_title_ignoring_leading_articles_and_case() {
        let (dir, mut library) = open_temp_library();
        for t in [
            "The Hobbit",
            "dune",
            "A Psalm for the Wild-Built",
            "Piranesi",
            "An Echo",
        ] {
            add(&mut library, dir.path(), t, "X");
        }
        let page = library
            .library_page(&query(|q| q.sort = SortOrder::Title))
            .unwrap();
        assert_eq!(
            titles(&page),
            [
                "dune",
                "An Echo",
                "The Hobbit",
                "Piranesi",
                "A Psalm for the Wild-Built"
            ]
        );
        let recent = library.library_page(&LibraryQuery::default()).unwrap();
        assert_eq!(recent.books[0].title, "An Echo");
    }

    #[test]
    fn sorts_by_author_and_series_order() {
        let (dir, mut library) = open_temp_library();
        let series = |n: u32| {
            format!(
                r#"<meta name="calibre:series" content="Stormlight"/><meta name="calibre:series_index" content="{n}"/>"#
            )
        };
        add_with(
            &mut library,
            dir.path(),
            "Oathbringer",
            "Sanderson",
            &series(3),
        );
        add_with(
            &mut library,
            dir.path(),
            "The Way of Kings",
            "Sanderson",
            &series(1),
        );
        add(&mut library, dir.path(), "Dune", "Herbert");
        add_with(
            &mut library,
            dir.path(),
            "Words of Radiance",
            "Sanderson",
            &series(2),
        );

        let by_series = library
            .library_page(&query(|q| q.sort = SortOrder::Series))
            .unwrap();
        assert_eq!(
            titles(&by_series),
            [
                "The Way of Kings",
                "Words of Radiance",
                "Oathbringer",
                "Dune"
            ]
        );
        assert_eq!(by_series.books[0].series.as_deref(), Some("Stormlight"));
        assert_eq!(by_series.books[0].series_index, Some(1.0));

        let by_author = library
            .library_page(&query(|q| q.sort = SortOrder::Author))
            .unwrap();
        assert_eq!(by_author.books[0].title, "Dune");
    }

    #[test]
    fn shelves_follow_explicit_status_and_flags() {
        let (dir, mut library) = open_temp_library();
        let a = add(&mut library, dir.path(), "A", "X");
        let b = add(&mut library, dir.path(), "B", "X");
        add(&mut library, dir.path(), "C", "X");
        library.set_status(&a, ReadStatus::InProgress).unwrap();
        library.set_status(&b, ReadStatus::Read).unwrap();
        library.set_favorite(&b, true).unwrap();
        library.set_want_to_read(&a, true).unwrap();

        let shelf = |s| titles(&library.library_page(&query(|q| q.shelf = s)).unwrap()).join(",");
        assert_eq!(shelf(Shelf::InProgress), "A");
        assert_eq!(shelf(Shelf::Read), "B");
        assert_eq!(shelf(Shelf::Unread), "C");
        assert_eq!(shelf(Shelf::Favorites), "B");
        assert_eq!(shelf(Shelf::WantToRead), "A");

        let counts = library.shelf_counts().unwrap();
        assert_eq!(
            (
                counts.all,
                counts.favorites,
                counts.want_to_read,
                counts.in_progress,
                counts.read,
                counts.unread
            ),
            (3, 1, 1, 1, 1, 1)
        );

        library.set_favorite(&b, false).unwrap();
        assert_eq!(shelf(Shelf::Favorites), "");
        let page = library
            .library_page(&query(|q| q.shelf = Shelf::Read))
            .unwrap();
        assert!(!page.books[0].favorite);
    }

    #[test]
    fn search_matches_title_author_and_series_literally() {
        let (dir, mut library) = open_temp_library();
        add(&mut library, dir.path(), "Dune", "Frank Herbert");
        add(&mut library, dir.path(), "100% Wolf", "Jayne Lyons");
        add_with(
            &mut library,
            dir.path(),
            "Oathbringer",
            "Brandon Sanderson",
            r#"<meta name="calibre:series" content="The Stormlight Archive"/>"#,
        );
        let search = |s: &str| {
            let s = s.to_string();
            titles(
                &library
                    .library_page(&query(|q| q.search = Some(s)))
                    .unwrap(),
            )
            .join(",")
        };
        assert_eq!(search("herbert"), "Dune");
        assert_eq!(search("DUNE"), "Dune");
        assert_eq!(search("stormlight"), "Oathbringer");
        assert_eq!(search("100%"), "100% Wolf");
        assert_eq!(search("%"), "100% Wolf");
        assert_eq!(search("   "), "Oathbringer,100% Wolf,Dune");
        assert_eq!(search("nothing like this"), "");
    }

    #[test]
    fn search_folds_case_beyond_ascii() {
        let (dir, mut library) = open_temp_library();
        add(&mut library, dir.path(), "Germinal", "Émile Zola");
        add(&mut library, dir.path(), "ÖDE INSELN", "Jane Doe");
        let search = |s: &str| {
            let s = s.to_string();
            titles(
                &library
                    .library_page(&query(|q| q.search = Some(s)))
                    .unwrap(),
            )
            .join(",")
        };
        assert_eq!(search("émile zola"), "Germinal");
        assert_eq!(search("ÉMILE"), "Germinal");
        assert_eq!(search("öde"), "ÖDE INSELN");
    }

    #[test]
    fn filters_by_format_and_location() {
        let (dir, mut library) = open_temp_library();
        add(&mut library, dir.path(), "Book", "X");
        let pdf = dir.path().join("Scan.pdf");
        std::fs::write(&pdf, b"%PDF-1.4 not really").unwrap();
        library.import_files(&[pdf]);

        let page = library
            .library_page(&query(|q| q.formats = vec!["PDF".into()]))
            .unwrap();
        assert_eq!(titles(&page), ["Scan"]);
        assert_eq!(page.formats, ["epub", "pdf"]);
        let cloud = library
            .library_page(&query(|q| q.location = Some(Location::CloudOnly)))
            .unwrap();
        assert_eq!(cloud.total, 0);
        let local = library
            .library_page(&query(|q| q.location = Some(Location::OnDevice)))
            .unwrap();
        assert_eq!(local.total, 2);
    }

    #[test]
    fn pages_cover_every_book_once_and_clamp_past_the_end() {
        let (dir, mut library) = open_temp_library();
        for i in 0..7 {
            let path = dir.path().join(format!("{i}.epub"));
            write_test_epub(&path, &format!("Book {i}"), "X", false);
            library.import_files(&[path]);
        }
        let page_of = |n| {
            library
                .library_page(&query(|q| {
                    q.page = n;
                    q.page_size = 3;
                    q.sort = SortOrder::Title;
                }))
                .unwrap()
        };
        let mut seen: Vec<String> = (0..3)
            .flat_map(|n| page_of(n).books)
            .map(|b| b.title)
            .collect();
        assert_eq!(seen.len(), 7);
        seen.dedup();
        assert_eq!(seen.len(), 7);
        let past = page_of(9);
        assert_eq!((past.page, past.total, past.books.len()), (2, 7, 1));
    }
}

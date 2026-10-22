//! The Library page: every book, by shelf, searched, filtered, sorted and paged.

use rusqlite::{params, params_from_iter, types::Value};

use crate::error::{Error, Result};
use crate::home::{book_from_row, BOOK_COLUMNS, BOOK_FROM, DOCUMENT_FORMATS, LANGUAGE, NARRATORS};
use crate::library::Library;
use crate::model::*;

pub const DEFAULT_PAGE_SIZE: u32 = 24;
const MAX_PAGE_SIZE: u32 = 200;

const TITLE: &str = "COALESCE(o_title.value, f_title.value, b.title)";
const AUTHORS: &str = "COALESCE(o_authors.value, f_authors.value, b.authors)";
const FIRST_AUTHOR: &str = "json_extract(COALESCE(o_authors.value, f_authors.value, b.authors), '$[0]')";
const SERIES: &str = "COALESCE(o_series.value, f_series.value, b.series)";
const SERIES_INDEX: &str =
    "COALESCE(CAST(NULLIF(o_series_index.value, '') AS REAL), CAST(NULLIF(f_series_index.value, '') AS REAL), b.series_index)";
const GENRES: &str = "COALESCE(o_genres.value, f_genres.value)";

/// The SQL test for books of one kind, on the books table as `b`.
pub(crate) fn kind_condition(kind: ItemKind) -> String {
    let quoted = |formats: &[&str]| formats.iter().map(|f| format!("'{f}'")).collect::<Vec<_>>().join(", ");
    let (docs, audio) = (quoted(DOCUMENT_FORMATS), quoted(crate::audio::AUDIO_FORMATS));
    match kind {
        ItemKind::Documents => format!("b.format IN ({docs})"),
        ItemKind::Audiobooks => format!("b.format IN ({audio})"),
        ItemKind::Books => format!("b.format NOT IN ({docs}, {audio})"),
    }
}

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
            "{SERIES} IS NULL, {SERIES} COLLATE NOCASE, {SERIES_INDEX} IS NULL, {SERIES_INDEX}, {title}"
        ),
        SortOrder::Genre => {
            let first = format!("CASE WHEN json_valid({GENRES}) THEN json_extract({GENRES}, '$[0]') END");
            format!("{first} IS NULL, {first} COLLATE NOCASE, {title}")
        }
        SortOrder::Progress => format!("COALESCE(b.total_progression, 0) DESC, {title}"),
        SortOrder::Rating => format!("b.rating IS NULL, b.rating DESC, {title}"),
    }
}

/// A book's language as a short code ("en", "fr"), so "en-US", "en_GB",
/// "eng" and "English" all count as one language. `None` when there's none.
pub fn language_code(raw: &str) -> Option<String> {
    let lower = raw.trim().to_lowercase();
    let first = lower.split(['-', '_', ' ', ',', ';']).find(|p| !p.is_empty())?;
    let code = match first {
        "eng" | "english" => "en",
        "fre" | "fra" | "french" | "français" | "francais" => "fr",
        "ger" | "deu" | "german" | "deutsch" => "de",
        "spa" | "spanish" | "español" | "espanol" => "es",
        "ita" | "italian" | "italiano" => "it",
        "por" | "portuguese" | "português" | "portugues" => "pt",
        "dut" | "nld" | "dutch" | "nederlands" => "nl",
        "rus" | "russian" => "ru",
        "jpn" | "japanese" => "ja",
        "chi" | "zho" | "chinese" => "zh",
        "kor" | "korean" => "ko",
        "ara" | "arabic" => "ar",
        "pol" | "polish" | "polski" => "pl",
        "swe" | "swedish" | "svenska" => "sv",
        "dan" | "danish" | "dansk" => "da",
        "nor" | "nob" | "norwegian" | "norsk" => "no",
        "fin" | "finnish" | "suomi" => "fi",
        "gre" | "ell" | "greek" => "el",
        "tur" | "turkish" => "tr",
        "heb" | "hebrew" => "he",
        "hin" | "hindi" => "hi",
        "lat" | "latin" => "la",
        "und" | "unknown" | "mul" | "zxx" => return None,
        other => other,
    };
    Some(code.to_string())
}

/// `%` and `_` typed by the user match themselves, not anything.
fn like_pattern(text: &str) -> String {
    let escaped = text
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_");
    format!("%{}%", escaped.to_lowercase())
}

/// One set of Library filters: a book matches when it has any of the
/// names in each list that isn't empty.
struct Filters<'q> {
    formats: &'q [String],
    tags: &'q [String],
    genres: &'q [String],
    authors: &'q [String],
    narrators: &'q [String],
    series: &'q [String],
    languages: &'q [String],
}

impl Filters<'_> {
    /// Each condition is whole in brackets and never NULL, so it can be turned round with NOT.
    fn conditions(&self, values: &mut Vec<Value>) -> Vec<String> {
        let mut conditions = Vec::new();
        let slots = |values: &mut Vec<Value>, names: Vec<String>| {
            let start = values.len() + 1;
            let slots: Vec<String> = (0..names.len()).map(|i| format!("?{}", start + i)).collect();
            values.extend(names.into_iter().map(Value::Text));
            slots.join(", ")
        };
        if !self.formats.is_empty() {
            let s = slots(values, self.formats.iter().map(|f| f.to_lowercase()).collect());
            conditions.push(format!("(b.format IN ({s}))"));
        }
        if !self.tags.is_empty() {
            let s = slots(values, self.tags.iter().map(|t| t.trim().to_lowercase()).collect());
            conditions.push(format!(
                "(EXISTS (SELECT 1 FROM book_tags t WHERE t.book_id = b.id AND t.removed_at IS NULL AND lower(t.tag) IN ({s})))"
            ));
        }
        // Genres, authors and narrators are JSON lists: a book matches when any name does.
        for (list, names) in [(GENRES, self.genres), (AUTHORS, self.authors), (NARRATORS, self.narrators)] {
            if names.is_empty() {
                continue;
            }
            let s = slots(values, names.iter().map(|g| g.trim().to_lowercase()).collect());
            conditions.push(format!(
                "(EXISTS (SELECT 1 FROM json_each(CASE WHEN json_valid({list}) THEN {list} ELSE '[]' END) g WHERE tbv_fold(g.value) IN ({s})))"
            ));
        }
        if !self.series.is_empty() {
            let s = slots(values, self.series.iter().map(|x| x.trim().to_lowercase()).collect());
            conditions.push(format!("(tbv_fold(COALESCE({SERIES}, '')) IN ({s}))"));
        }
        if !self.languages.is_empty() {
            let s = slots(values, self.languages.iter().map(|l| language_code(l).unwrap_or_default()).collect());
            conditions.push(format!("(COALESCE(tbv_language({LANGUAGE}), '') IN ({s}))"));
        }
        conditions
    }
}

impl Library {
    pub fn library_page(&self, query: &LibraryQuery) -> Result<LibraryPage> {
        let mut conditions: Vec<String> = Vec::new();
        let mut values: Vec<Value> = Vec::new();

        match query.shelf {
            Shelf::All => {}
            Shelf::Favorites => conditions.push("b.favorite = 1".into()),
            Shelf::WantToRead => conditions.push("b.want_to_read = 1".into()),
            Shelf::SendToDevice => conditions.push("b.phone_wanted = 1".into()),
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
                  OR tbv_fold({AUTHORS}) LIKE ?{n} ESCAPE '\\' \
                  OR tbv_fold(COALESCE({SERIES}, '')) LIKE ?{n} ESCAPE '\\')",
                n = values.len() + 1
            ));
            values.push(Value::Text(like_pattern(search)));
        }

        // The filters chosen to show, then those chosen to leave out.
        let include = Filters {
            formats: &query.formats,
            tags: &query.tags,
            genres: &query.genres,
            authors: &query.authors,
            narrators: &query.narrators,
            series: &query.series,
            languages: &query.languages,
        };
        let e = &query.exclude;
        let exclude = Filters {
            formats: &e.formats,
            tags: &e.tags,
            genres: &e.genres,
            authors: &e.authors,
            narrators: &e.narrators,
            series: &e.series,
            languages: &e.languages,
        };
        for (filters, keep) in [(include, true), (exclude, false)] {
            for condition in filters.conditions(&mut values) {
                conditions.push(if keep { condition } else { format!("NOT {condition}") });
            }
        }
        if query.hide_read {
            conditions.push("b.status != 'read'".into());
        }

        if let Some(kind) = query.kind {
            conditions.push(kind_condition(kind));
        }

        if let Some(ids) = &query.ids {
            let start = values.len() + 1;
            let slots: Vec<String> = (0..ids.len()).map(|i| format!("?{}", start + i)).collect();
            values.extend(ids.iter().cloned().map(Value::Text));
            conditions.push(if ids.is_empty() { "0".into() } else { format!("b.id IN ({})", slots.join(", ")) });
        }

        match query.location {
            Some(Location::OnDevice) => conditions.push("lf.path IS NOT NULL".into()),
            Some(Location::CloudOnly) => conditions.push("lf.path IS NULL".into()),
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
            counts: self.shelf_counts_of(query.kind)?,
            formats: self.formats_in_library(query.kind)?,
            tags: self.all_tags()?.into_iter().map(|t| t.name).collect(),
            genres: self.genres_in_library(query.kind)?,
            languages: self.languages_in_library(query.kind)?,
            // Only audiobooks filter by author and narrator; other pages search instead.
            authors: if query.kind == Some(ItemKind::Audiobooks) { self.names_in_library(AUTHORS, query.kind)? } else { Vec::new() },
            narrators: if query.kind == Some(ItemKind::Audiobooks) { self.names_in_library(NARRATORS, query.kind)? } else { Vec::new() },
        })
    }

    pub fn shelf_counts(&self) -> Result<ShelfCounts> {
        self.shelf_counts_of(None)
    }

    /// Counts for one kind of book, or all of them.
    pub fn shelf_counts_of(&self, kind: Option<ItemKind>) -> Result<ShelfCounts> {
        let only = kind.map(|k| format!(" AND {}", kind_condition(k))).unwrap_or_default();
        Ok(self.conn.query_row(
            &format!("SELECT COUNT(*),
                    COALESCE(SUM(favorite = 1), 0),
                    COALESCE(SUM(want_to_read = 1), 0),
                    COALESCE(SUM(phone_wanted = 1), 0),
                    COALESCE(SUM(status = 'in_progress'), 0),
                    COALESCE(SUM(status = 'read'), 0),
                    COALESCE(SUM(status = 'unread'), 0),
                    (SELECT COUNT(*) FROM collections WHERE deleted_at IS NULL AND kind != 'shelf')
             FROM books b WHERE deleted_at IS NULL{only}"),
            [],
            |r| {
                Ok(ShelfCounts {
                    all: r.get(0)?,
                    favorites: r.get(1)?,
                    want_to_read: r.get(2)?,
                    send_to_device: r.get(3)?,
                    in_progress: r.get(4)?,
                    read: r.get(5)?,
                    unread: r.get(6)?,
                    collections: r.get(7)?,
                })
            },
        )?)
    }

    fn formats_in_library(&self, kind: Option<ItemKind>) -> Result<Vec<String>> {
        let only = kind.map(|k| format!(" AND {}", kind_condition(k))).unwrap_or_default();
        let mut statement = self.conn.prepare(&format!(
            "SELECT DISTINCT format FROM books b WHERE deleted_at IS NULL{only} ORDER BY format"
        ))?;
        let rows = statement.query_map([], |r| r.get(0))?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    /// Every genre on books of this kind, one spelling each, A to Z.
    pub fn genres_in_library(&self, kind: Option<ItemKind>) -> Result<Vec<String>> {
        self.names_in_library(GENRES, kind)
    }

    /// The languages books of this kind are in, as codes, A to Z.
    pub fn languages_in_library(&self, kind: Option<ItemKind>) -> Result<Vec<String>> {
        let only = kind.map(|k| format!(" AND {}", kind_condition(k))).unwrap_or_default();
        let mut statement = self.conn.prepare(&format!(
            "SELECT DISTINCT tbv_language({LANGUAGE}) AS l {BOOK_FROM}{only} AND l IS NOT NULL ORDER BY l"
        ))?;
        let rows = statement.query_map([], |r| r.get(0))?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    /// Every name in a list column (genres, authors, narrators) on books of
    /// this kind, one spelling each, A to Z.
    fn names_in_library(&self, list: &str, kind: Option<ItemKind>) -> Result<Vec<String>> {
        let only = kind.map(|k| format!(" AND {}", kind_condition(k))).unwrap_or_default();
        let mut statement = self.conn.prepare(&format!(
            "SELECT MIN(g.value) FROM (SELECT {list} AS names {BOOK_FROM}{only}) x, json_each(CASE WHEN json_valid(x.names) THEN x.names ELSE '[]' END) g
             WHERE trim(g.value) != ''
             GROUP BY tbv_fold(g.value) ORDER BY tbv_fold(g.value)"
        ))?;
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
    fn filters_can_leave_books_out_as_well_as_pick_them() {
        let (dir, mut library) = open_temp_library();
        let a = add(&mut library, dir.path(), "Dracula", "Bram Stoker");
        let b = add(&mut library, dir.path(), "Carmilla", "Sheridan Le Fanu");
        add(&mut library, dir.path(), "Emma", "Jane Austen");
        library.add_tag(&[a.clone(), b.clone()], "Gothic").unwrap();
        library.set_status(&a, ReadStatus::Read).unwrap();
        let sorted = |f: &dyn Fn(&mut LibraryQuery)| {
            let page = library.library_page(&query(|q| {
                q.sort = SortOrder::Title;
                f(q)
            }));
            titles(&page.unwrap()).into_iter().map(str::to_string).collect::<Vec<_>>()
        };
        assert_eq!(sorted(&|q| q.exclude.tags = vec!["gothic".into()]), ["Emma"]);
        assert_eq!(sorted(&|q| q.exclude.authors = vec!["Jane Austen".into()]), ["Carmilla", "Dracula"]);
        // Both at once: Gothic books, but not Le Fanu's.
        assert_eq!(
            sorted(&|q| {
                q.tags = vec!["Gothic".into()];
                q.exclude.authors = vec!["sheridan le fanu".into()];
            }),
            ["Dracula"]
        );
        // Of some chosen books, only those the search still shows.
        let (a2, b2) = (a.clone(), b.clone());
        assert_eq!(
            sorted(&|q| {
                q.ids = Some(vec![a2.clone(), b2.clone()]);
                q.search = Some("carm".into());
            }),
            ["Carmilla"]
        );
        assert!(sorted(&|q| q.ids = Some(Vec::new())).is_empty());
        // Books with no series or language aren't left out by mistake.
        assert_eq!(sorted(&|q| q.exclude.series = vec!["Discworld".into()]).len(), 3);
        assert_eq!(sorted(&|q| q.exclude.languages = vec!["fr".into()]).len(), 3);
        assert_eq!(sorted(&|q| q.hide_read = true), ["Carmilla", "Emma"]);
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
    fn filters_by_series_ignoring_case() {
        let (dir, mut library) = open_temp_library();
        add(&mut library, dir.path(), "Dune", "Frank Herbert");
        add_with(
            &mut library,
            dir.path(),
            "Oathbringer",
            "Brandon Sanderson",
            r#"<meta name="calibre:series" content="The Stormlight Archive"/>"#,
        );
        let page = library
            .library_page(&query(|q| q.series = vec!["the stormlight archive".into()]))
            .unwrap();
        assert_eq!(titles(&page), ["Oathbringer"]);
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

#[cfg(test)]
mod languages {
    use super::*;
    use crate::details::DetailChange;
    use crate::epub::tests::write_test_epub;
    use crate::library::tests::open_temp_library;

    #[test]
    fn spellings_of_one_language_count_as_one() {
        for (raw, code) in [("en-US", Some("en")), ("eng", Some("en")), ("English", Some("en")), ("fr_CA", Some("fr")), ("und", None), ("  ", None)] {
            assert_eq!(language_code(raw).as_deref(), code, "{raw}");
        }
    }

    #[test]
    fn the_library_filters_by_language() {
        let (dir, mut library) = open_temp_library();
        let mut ids = Vec::new();
        for title in ["Dracula", "Germinal", "Nana"] {
            let path = dir.path().join(format!("{title}.epub"));
            write_test_epub(&path, title, "Someone", false);
            let ImportResult::Imported { book_id, .. } = library.import_files(&[path]).remove(0) else { panic!() };
            ids.push(book_id);
        }
        // The test books say "en"; two are changed to French, spelt two ways.
        library.edit_details(&ids[1..2], &[DetailChange { field: "language".into(), value: Some("fre".into()) }]).unwrap();
        library.edit_details(&ids[2..3], &[DetailChange { field: "language".into(), value: Some("fr-FR".into()) }]).unwrap();

        let page = |languages: &[&str]| {
            library.library_page(&LibraryQuery { languages: languages.iter().map(|l| l.to_string()).collect(), ..Default::default() }).unwrap()
        };
        assert_eq!(page(&[]).languages, ["en", "fr"]);
        assert_eq!(page(&["fr"]).total, 2);
        assert_eq!(page(&["en"]).total, 1);
        assert_eq!(page(&["en", "fr"]).total, 3);
    }
}

#[cfg(test)]
mod scale {
    use super::*;
    use crate::epub::tests::write_test_epub;
    use crate::library::tests::open_temp_library;
    use std::time::Instant;

    /// How long each page's data takes with a very large library.
    /// `TBV_SCALE=17000 cargo test -p tbv-core scale -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn pages_stay_quick_with_a_huge_library() {
        let count: usize = std::env::var("TBV_SCALE").ok().and_then(|n| n.parse().ok()).unwrap_or(17_000);
        let (dir, mut library) = open_temp_library();
        let source = dir.path().join("source");
        std::fs::create_dir_all(&source).unwrap();
        let paths: Vec<_> = (0..count)
            .map(|i| {
                let path = source.join(format!("book{i}.epub"));
                write_test_epub(&path, &format!("Book {i}"), &format!("Author {}", i % 900), false);
                path
            })
            .collect();
        let started = Instant::now();
        for chunk in paths.chunks(500) {
            library.import_files(chunk);
        }
        eprintln!("import {count}: {:?}", started.elapsed());
        // Big libraries have many series, with a few books in each.
        library.conn.execute("UPDATE books SET series = 'Series ' || (rowid % (?1 / 4 + 1)), series_index = rowid % 4", [count as i64]).unwrap();
        let time = |name: &str, run: &mut dyn FnMut()| {
            let started = Instant::now();
            run();
            eprintln!("{name}: {:?}", started.elapsed());
        };
        time("home", &mut || drop(library.home().unwrap()));
        time("library page", &mut || {
            drop(library.library_page(&LibraryQuery { page_size: 60, ..Default::default() }).unwrap())
        });
        time("collections", &mut || drop(library.collections(u32::MAX).unwrap()));
        time("collections overview", &mut || drop(library.collections_overview().unwrap()));
        time("notes", &mut || drop(library.notes_page(&Default::default()).unwrap()));
        time("library info", &mut || drop(library.library_info().unwrap()));
    }
}

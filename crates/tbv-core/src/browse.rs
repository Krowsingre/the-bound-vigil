//! The Library page: every book, by shelf, searched, filtered, sorted and paged.

use rusqlite::{params, params_from_iter, types::Value, OptionalExtension};

use crate::error::{Error, Result};
use crate::home::{book_from_row, BOOK_COLUMNS, BOOK_FROM, DOCUMENT_FORMATS, LANGUAGE, NARRATORS, PAIRED};
use crate::library::Library;
use crate::model::*;

pub const DEFAULT_PAGE_SIZE: u32 = 24;
const MAX_PAGE_SIZE: u32 = 200;
pub(crate) const UP_NEXT_LIMIT: u32 = 15;

const TITLE: &str = "COALESCE(o_title.value, f_title.value, b.title)";
const AUTHORS: &str = "COALESCE(o_authors.value, f_authors.value, b.authors)";
type StackDetails = (std::collections::BTreeMap<BookId, BookPreview>, std::collections::BTreeMap<BookId, u32>);

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
    sort_title_value(TITLE)
}

fn sort_title_value(title: &str) -> String {
    format!(
        "CASE WHEN lower(({title})) LIKE 'the %' THEN substr(({title}), 5) \
              WHEN lower(({title})) LIKE 'an %' THEN substr(({title}), 4) \
              WHEN lower(({title})) LIKE 'a %' THEN substr(({title}), 3) \
              ELSE ({title}) END COLLATE NOCASE"
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
        SortOrder::Rating => format!("COALESCE(b.stars, b.rating) IS NULL, COALESCE(b.stars, b.rating) DESC, {title}"),
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
            // A book kept with copies in other formats has those formats too.
            conditions.push(format!(
                "(b.format IN ({s}) OR EXISTS (SELECT 1 FROM books c WHERE c.same_as = b.id AND c.deleted_at IS NULL AND lower(c.format) IN ({s})))"
            ));
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
            conditions.push(format!("(tbv_fold(trim(COALESCE({SERIES}, ''))) IN ({s}))"));
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
            Shelf::Read => conditions.push("b.status IN ('read', 'dropped')".into()),
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
            conditions.push("b.status NOT IN ('read', 'dropped')".into());
        }

        if let Some(kind) = query.kind {
            conditions.push(kind_condition(kind));
        }

        if let Some(pinned) = query.pinned {
            conditions.push(if pinned { "b.pinned_at IS NOT NULL".into() } else { "b.pinned_at IS NULL".into() });
        }
        if let Some(audio_type) = &query.audio_type {
            conditions.push(format!("COALESCE(b.audio_type, 'audiobook') = ?{}", values.len() + 1));
            values.push(Value::Text(audio_type.clone()));
        }
        match query.paired {
            Some(true) => conditions.push(PAIRED.into()),
            Some(false) => conditions.push(format!("NOT {PAIRED}")),
            None => {}
        }

        if let Some(ids) = &query.ids {
            let start = values.len() + 1;
            let slots: Vec<String> = (0..ids.len()).map(|i| format!("?{}", start + i)).collect();
            values.extend(ids.iter().cloned().map(Value::Text));
            conditions.push(if ids.is_empty() { "0".into() } else { format!("b.id IN ({})", slots.join(", ")) });
        }

        match query.location {
            Some(Location::OnDevice) => conditions.push("tbv_file_exists(lf.path)".into()),
            Some(Location::CloudOnly) => conditions.push("lf.path IS NULL".into()),
            None => {}
        }

        let filter: String = conditions.iter().map(|c| format!(" AND {c}")).collect();

        // Pins remain individual cards, and the first matching book in the chosen order represents each stack.
        let pins = if query.pinned_first { "b.pinned_at IS NULL, " } else { "" };
        let order = format!("{pins}{}, b.id", order_by(query.sort));
        let group = format!(
            "CASE WHEN {}NULLIF(trim({SERIES}), '') IS NOT NULL THEN 'series:' || tbv_fold(trim({SERIES})) ELSE 'book:' || b.id END",
            if query.pinned_first { "b.pinned_at IS NULL AND " } else { "" },
        );
        let total_expr = if query.group_series { format!("COUNT(DISTINCT {group})") } else { "COUNT(*)".into() };
        let total: u32 = self.conn.query_row(
            &format!("SELECT {total_expr} {BOOK_FROM} {filter}"),
            params_from_iter(values.iter()),
            |r| r.get(0),
        )?;

        let page_size = match query.page_size {
            0 => DEFAULT_PAGE_SIZE,
            n => n.min(MAX_PAGE_SIZE),
        };
        let page = query.page.min(total.saturating_sub(1) / page_size);
        let limit = format!("LIMIT {page_size} OFFSET {}", page * page_size);
        let mut series_counts = std::collections::BTreeMap::new();
        let books = if query.group_series {
            let pin_rank = if query.pinned_first { "b.pinned_at IS NULL" } else { "0" };
            let rank = if query.mix_series { "0".into() } else { format!("({group}) NOT LIKE 'series:%'") };
            let position_order = if query.mix_series && query.sort == SortOrder::Title {
                let name = format!("CASE WHEN ({group}) LIKE 'series:%' THEN trim({SERIES}) ELSE {TITLE} END");
                format!("{}, b.id", sort_title_value(&name))
            } else { order.clone() };
            let sql = format!(
                "WITH ranked AS (
                    SELECT b.id, {pin_rank} AS pin_rank, {rank} AS series_rank, {group} AS stack,
                           ROW_NUMBER() OVER (PARTITION BY {group} ORDER BY {order}) AS pick,
                           ROW_NUMBER() OVER (ORDER BY {position_order}) AS position
                    {BOOK_FROM} {filter}
                ), page AS (
                    SELECT id, stack, position, pin_rank, series_rank FROM ranked WHERE pick = 1 ORDER BY pin_rank, series_rank, position {limit}
                )
                {BOOK_COLUMNS}, (SELECT 1 FROM page WHERE page.id = b.id AND stack LIKE 'series:%') AS series_marker
                {BOOK_FROM} AND b.id IN (SELECT id FROM page)
                ORDER BY (SELECT pin_rank FROM page WHERE page.id = b.id),
                         (SELECT series_rank FROM page WHERE page.id = b.id),
                         (SELECT position FROM page WHERE page.id = b.id)"
            );
            let mut statement = self.conn.prepare(&sql)?;
            let rows = statement.query_map(params_from_iter(values.iter()), |row| {
                Ok((book_from_row(row)?, row.get::<_, Option<u32>>("series_marker")?))
            })?;
            let mut books = Vec::new();
            for row in rows {
                let (book, count) = row?;
                if let Some(count) = count {
                    series_counts.insert(book.id.clone(), count);
                }
                books.push(book);
            }
            books
        } else {
            let mut statement = self.conn.prepare(&format!("{BOOK_COLUMNS} {BOOK_FROM} {filter} ORDER BY {order} {limit}"))?;
            let rows = statement.query_map(params_from_iter(values.iter()), book_from_row)?;
            rows.collect::<std::result::Result<_, _>>()?
        };

        let (series_covers, series_published) = self.stack_details(query, &books, &mut series_counts)?;
        Ok(LibraryPage {
            books,
            series_counts,
            series_covers,
            series_published,
            series_names: if query.omit_facets { Vec::new() } else { self.series_names(query.kind)? },
            total,
            page,
            page_size,
            counts: if query.omit_facets { ShelfCounts::default() } else { self.shelf_counts_of(query.kind)? },
            formats: if query.omit_facets { Vec::new() } else { self.formats_in_library(query.kind)? },
            tags: if query.omit_facets { Vec::new() } else { self.all_tags()?.into_iter().map(|t| t.name).collect() },
            genres: if query.omit_facets { Vec::new() } else { self.genres_in_library(query.kind)? },
            languages: if query.omit_facets { Vec::new() } else { self.languages_in_library(query.kind)? },
            // Only audiobooks filter by author and narrator; other pages search instead.
            authors: if !query.omit_facets && query.kind == Some(ItemKind::Audiobooks) { self.names_in_library(AUTHORS, query.kind)? } else { Vec::new() },
            narrators: if !query.omit_facets && query.kind == Some(ItemKind::Audiobooks) { self.names_in_library(NARRATORS, query.kind)? } else { Vec::new() },
        })
    }

    fn stack_details(
        &self,
        query: &LibraryQuery,
        books: &[BookPreview],
        counts: &mut std::collections::BTreeMap<BookId, u32>,
    ) -> Result<StackDetails> {
        let names: std::collections::BTreeMap<_, _> = books.iter()
            .filter(|book| counts.contains_key(&book.id))
            .filter_map(|book| Some((book.series.as_deref()?.trim().to_lowercase(), book.id.clone())))
            .collect();
        if names.is_empty() {
            return Ok(Default::default());
        }
        let choices = serde_json::to_string(&query.series_cover_choices).unwrap_or_else(|_| "{}".into());
        let keys = serde_json::to_string(&names.keys().collect::<Vec<_>>()).unwrap_or_else(|_| "[]".into());
        let kind = query.kind.map(|kind| format!(" AND {}", kind_condition(kind))).unwrap_or_default();
        let series = format!("tbv_fold(trim({SERIES}))");
        let order = sort_title();
        let sql = format!(
            "WITH candidates AS (
               SELECT b.id, COUNT(*) OVER (PARTITION BY {series}) AS owned, ROW_NUMBER() OVER (
                 PARTITION BY {series}
                 ORDER BY (b.id IS NOT COALESCE((SELECT value FROM json_each(?2) WHERE key = {series}), '')),
                          b.status IN ('read', 'dropped'), {SERIES_INDEX} IS NULL, {SERIES_INDEX}, {order}, b.id
               ) AS pick
               {BOOK_FROM}{kind} AND {series} IN (SELECT value FROM json_each(?1))
             )
             {BOOK_COLUMNS}, (SELECT owned FROM candidates WHERE id = b.id) AS owned_count,
             (SELECT COUNT(*) FROM (
               SELECT json_extract(entry.value, '$.published') AS release_date
               FROM series_lists sl, json_each(sl.books) entry
               WHERE sl.id = lower(trim({SERIES})) AND sl.checked_at IS NOT NULL
             ) WHERE CASE length(release_date)
               WHEN 4 THEN date(release_date || '-12-31')
               WHEN 7 THEN date(release_date || '-01', '+1 month', '-1 day')
               WHEN 10 THEN date(release_date)
             END <= date('now')) AS published_count
             {BOOK_FROM} AND b.id IN (SELECT id FROM candidates WHERE pick = 1)"
        );
        let mut stmt = self.conn.prepare(&sql)?;
        let books = stmt.query_map(params![keys, choices], |row| {
            Ok((book_from_row(row)?, row.get::<_, u32>("owned_count")?, row.get::<_, Option<u32>>("published_count")?))
        })?;
        let mut result = std::collections::BTreeMap::new();
        let mut published = std::collections::BTreeMap::new();
        for book in books {
            let (book, owned, listed) = book?;
            if let Some(id) = book.series.as_deref().and_then(|name| names.get(&name.trim().to_lowercase())) {
                counts.insert(id.clone(), owned);
                if let Some(listed) = listed.filter(|listed| *listed > owned) {
                    published.insert(id.clone(), listed);
                }
                result.insert(id.clone(), book);
            }
        }
        Ok((result, published))
    }

    fn series_names(&self, kind: Option<ItemKind>) -> Result<Vec<String>> {
        let only = kind.map(|kind| format!(" AND {}", kind_condition(kind))).unwrap_or_default();
        let mut statement = self.conn.prepare(&format!(
            "SELECT MIN(trim({SERIES})) {BOOK_FROM}{only} AND NULLIF(trim({SERIES}), '') IS NOT NULL
             GROUP BY tbv_fold(trim({SERIES})) ORDER BY tbv_fold(trim({SERIES}))"
        ))?;
        let rows = statement.query_map([], |row| row.get(0))?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
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
             FROM books b WHERE deleted_at IS NULL AND same_as IS NULL{only}"),
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

    /// Pins a book to the top of the Archive, or takes the pin off.
    pub fn archive_series_pins(&self) -> Result<Vec<String>> {
        let mut statement = self.conn.prepare("SELECT label FROM archive_series_pins WHERE pinned_at IS NOT NULL ORDER BY name")?;
        let rows = statement.query_map([], |row| row.get(0))?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    pub fn set_archive_series_pin(&self, label: &str, pinned: bool) -> Result<()> {
        let label = label.trim();
        if label.is_empty() { return Err(Error::Unsuitable("Choose a series to pin.".into())); }
        let name = label.to_lowercase();
        let tx = self.conn.unchecked_transaction()?;
        let already: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM archive_series_pins WHERE name = ?1 AND pinned_at IS NOT NULL)",
            params![name], |row| row.get(0),
        )?;
        if already == pinned { return Ok(()); }
        if pinned { Self::check_archive_pin_limit(&tx)?; }
        let at = pinned.then(crate::time::now_utc);
        tx.execute(
            "INSERT INTO archive_series_pins (name, label, pinned_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(name) DO UPDATE SET label = excluded.label, pinned_at = excluded.pinned_at",
            params![name, label, at],
        )?;
        tx.commit()?;
        Ok(())
    }

    fn check_archive_pin_limit(conn: &rusqlite::Connection) -> Result<()> {
        let count: u32 = conn.query_row(
            "SELECT (SELECT COUNT(*) FROM books WHERE pinned_at IS NOT NULL AND deleted_at IS NULL AND same_as IS NULL)
                  + (SELECT COUNT(*) FROM archive_series_pins WHERE pinned_at IS NOT NULL)",
            [], |row| row.get(0),
        )?;
        if count >= 10 {
            return Err(Error::Unsuitable("The Archive holds ten pins. Unpin a book or series first.".into()));
        }
        Ok(())
    }

    pub fn set_pinned(&self, book_id: &str, pinned: bool) -> Result<()> {
        // Only a real change is written, so syncing doesn't send pins that didn't move.
        if pinned {
            let tx = self.conn.unchecked_transaction()?;
            let can_pin: bool = tx.query_row(
                "SELECT EXISTS(SELECT 1 FROM books WHERE id = ?1 AND pinned_at IS NULL AND deleted_at IS NULL AND same_as IS NULL)",
                params![book_id],
                |row| row.get(0),
            )?;
            if can_pin {
                Self::check_archive_pin_limit(&tx)?;
                tx.execute("UPDATE books SET pinned_at = ?2 WHERE id = ?1", params![book_id, crate::time::now_utc()])?;
            }
            tx.commit()?;
        } else {
            self.conn.execute("UPDATE books SET pinned_at = NULL WHERE id = ?1 AND pinned_at IS NOT NULL", params![book_id])?;
        }
        Ok(())
    }

    pub fn set_audio_type(&self, book_id: &str, kind: Option<&str>) -> Result<()> {
        if kind.is_some_and(|kind| !matches!(kind, "audiobook" | "podcast" | "music")) {
            return Err(Error::Unsuitable("Choose an audio type.".into()));
        }
        let changed = self.conn.execute(
            &format!("UPDATE books AS b SET audio_type = ?2 WHERE id = ?1 AND deleted_at IS NULL AND {}", kind_condition(ItemKind::Audiobooks)),
            params![book_id, kind],
        )?;
        if changed == 0 { return Err(Error::Unsuitable("This audio item is no longer in Resonance.".into())); }
        Ok(())
    }

    pub fn set_favorite(&self, book_id: &str, favorite: bool) -> Result<()> {
        self.conn.execute(
            "UPDATE books SET favorite = ?2 WHERE id = ?1",
            params![book_id, favorite],
        )?;
        Ok(())
    }

    /// Sets your rating in quarter stars, 0.25 to 5, or clears it with
    /// `None`. Whole stars (`rating`) are kept too, for older devices.
    pub fn set_rating(&self, book_id: &str, stars: Option<f64>) -> Result<()> {
        if stars.is_some_and(|s| !(0.25..=5.0).contains(&s) || (s * 4.0).fract() != 0.0) {
            return Err(Error::Unsuitable("a rating is a quarter star to 5 stars".into()));
        }
        let whole = stars.map(|s| s.round().clamp(1.0, 5.0) as u8);
        self.conn.execute("UPDATE books SET stars = ?2, rating = ?3 WHERE id = ?1", params![book_id, stars, whole])?;
        self.remember_reading(book_id)?;
        Ok(())
    }

    pub fn set_want_to_read(&self, book_id: &str, want: bool) -> Result<()> {
        self.update_up_next(book_id, want, None)
    }

    pub fn update_up_next(&self, book_id: &str, want: bool, replace: Option<&str>) -> Result<()> {
        let tx = self.conn.unchecked_transaction()?;
        let current: Option<bool> = tx.query_row(
            "SELECT want_to_read FROM books WHERE id = ?1 AND deleted_at IS NULL AND same_as IS NULL",
            params![book_id],
            |row| row.get(0),
        ).optional()?;
        if current.is_none_or(|current| current == want) {
            return Ok(());
        }
        if want {
            let count: u32 = tx.query_row(
                "SELECT COUNT(*) FROM books WHERE want_to_read = 1 AND deleted_at IS NULL AND same_as IS NULL",
                [],
                |row| row.get(0),
            )?;
            if count > UP_NEXT_LIMIT {
                return Err(Error::Unsuitable("Up Next already exceeds 15 books. Remove books before adding another.".into()));
            }
            if let Some(old) = replace {
                let changed = tx.execute(
                    "UPDATE books SET want_to_read = 0 WHERE id = ?1 AND want_to_read = 1 AND deleted_at IS NULL AND same_as IS NULL",
                    params![old],
                )?;
                if changed == 0 {
                    return Err(Error::Unsuitable("That book is no longer in Up Next. Choose another book.".into()));
                }
            } else if count == UP_NEXT_LIMIT {
                return Err(Error::Unsuitable("Up Next is full.".into()));
            }
        }
        tx.execute("UPDATE books SET want_to_read = ?2 WHERE id = ?1", params![book_id, want])?;
        tx.commit()?;
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
    fn pinned_books_lead_the_archive_only() {
        let (dir, mut library) = open_temp_library();
        add(&mut library, dir.path(), "A", "X");
        let b = add(&mut library, dir.path(), "B", "X");
        let c = add(&mut library, dir.path(), "C", "X");
        library.set_pinned(&b, true).unwrap();
        library.set_pinned(&c, true).unwrap();
        // Pinning again keeps its place.
        library.set_pinned(&b, true).unwrap();
        let list = |pins| {
            titles(&library.library_page(&query(|q| {
                q.sort = SortOrder::Title;
                q.pinned_first = pins;
            })).unwrap())
            .join(",")
        };
        let first = library.library_page(&query(|q| q.pinned_first = true)).unwrap();
        assert!(first.books[0].pinned_at.is_some());
        assert_eq!(list(false), "A,B,C");
        assert_eq!(list(true), "B,C,A");
        library.set_pinned(&b, false).unwrap();
        library.set_pinned(&c, false).unwrap();
        assert_eq!(list(true), "A,B,C");
    }

    #[test]
    fn series_stacks_group_before_paging_and_leave_pins_visible() {
        let (dir, mut library) = open_temp_library();
        let series = r#"<meta name="calibre:series" content="Shared Series"/>"#;
        let a = add_with(&mut library, dir.path(), "A", "Writer", series);
        let c = add_with(&mut library, dir.path(), "C", "Writer", series);
        add(&mut library, dir.path(), "B", "Writer");
        let stack = |library: &Library, page| library.library_page(&query(|q| {
            q.sort = SortOrder::Title;
            q.group_series = true;
            q.pinned_first = true;
            q.page_size = 1;
            q.page = page;
        })).unwrap();
        let first = stack(&library, 0);
        assert_eq!(first.total, 2);
        assert_eq!(first.books[0].id, a);
        assert_eq!(first.series_counts.get(&a), Some(&2));
        assert_eq!(stack(&library, 1).books[0].title, "B");
        library.set_pinned(&c, true).unwrap();
        assert_eq!(stack(&library, 0).books[0].id, c);
        assert_eq!(stack(&library, 1).series_counts.get(&a), Some(&2));
    }

    #[test]
    fn mixed_title_sort_places_series_by_name_before_pagination() {
        let (dir, mut library) = open_temp_library();
        let series = r#"<meta name="calibre:series" content="The Middle Series"/>"#;
        let volume = add_with(&mut library, dir.path(), "Zebra Volume", "Writer", series);
        let alpha = add(&mut library, dir.path(), "Alpha", "Writer");
        let omega = add(&mut library, dir.path(), "Omega", "Writer");
        let page = |number, mixed| library.library_page(&query(|q| {
            q.sort = SortOrder::Title;
            q.group_series = true;
            q.mix_series = mixed;
            q.page_size = 1;
            q.page = number;
        })).unwrap();
        assert_eq!(page(0, true).books[0].id, alpha);
        assert_eq!(page(1, true).books[0].id, volume);
        assert_eq!(page(2, true).books[0].id, omega);
        assert_eq!(page(0, false).books[0].id, volume);
    }

    #[test]
    fn a_filtered_stack_counts_owned_books_and_uses_checked_catalogue_evidence() {
        let (dir, mut library) = open_temp_library();
        let series = r#"<meta name="calibre:series" content="Shared Series"/>"#;
        let first = add_with(&mut library, dir.path(), "First", "Writer", series);
        let second = add_with(&mut library, dir.path(), "Second", "Writer", series);
        library.set_status(&first, ReadStatus::Read).unwrap();
        let q = query(|q| {
            q.group_series = true;
            q.hide_read = true;
        });
        let page = library.library_page(&q).unwrap();
        assert_eq!(page.books[0].id, second);
        assert_eq!(page.series_counts[&second], 2);
        assert!(page.series_published.is_empty());

        let listed = [
            ("First", Some("2020-01-01")),
            ("Second", Some("2020-01")),
            ("Third", Some("2020")),
            ("Future release", Some("9999-12-31")),
            ("No release date", None),
        ]
            .into_iter()
            .map(|(title, published)| crate::series::SeriesEntry {
                title: title.into(),
                source: "hardcover".into(),
                published: published.map(str::to_string),
                ..Default::default()
            })
            .collect();
        library.save_series_found("Shared Series", listed).unwrap();
        let page = library.library_page(&q).unwrap();
        assert_eq!(page.series_counts[&second], 2);
        assert_eq!(page.series_published[&second], 3);

        library.set_status(&second, ReadStatus::Dropped).unwrap();
        assert!(library.library_page(&q).unwrap().books.is_empty());
    }

    #[test]
    fn stack_cover_uses_reading_order_and_respects_an_owned_manual_choice() {
        let (dir, mut library) = open_temp_library();
        let volume = |number| format!(
            r#"<meta name="calibre:series" content="Shared Series"/><meta name="calibre:series_index" content="{number}"/>"#
        );
        let one = add_with(&mut library, dir.path(), "Last in title sort", "Writer", &volume(1));
        let two = add_with(&mut library, dir.path(), "Middle in title sort", "Writer", &volume(2));
        let three = add_with(&mut library, dir.path(), "First in title sort", "Writer", &volume(3));
        library.set_status(&two, ReadStatus::InProgress).unwrap();
        library.set_status(&three, ReadStatus::InProgress).unwrap();
        let mut q = query(|q| {
            q.sort = SortOrder::Title;
            q.group_series = true;
            q.search = Some("First in title".into());
            q.omit_facets = true;
        });
        let cover = |library: &Library, q: &LibraryQuery| {
            let page = library.library_page(q).unwrap();
            assert_eq!(page.books[0].id, three);
            assert_eq!(page.series_counts[&three], 3);
            assert!(page.series_names.is_empty());
            page.series_covers[&three].id.clone()
        };
        assert_eq!(cover(&library, &q), one);
        library.set_status(&one, ReadStatus::Read).unwrap();
        assert_eq!(cover(&library, &q), two);
        q.series_cover_choices.insert("shared series".into(), three.clone());
        assert_eq!(cover(&library, &q), three);
        q.series_cover_choices.insert("shared series".into(), "missing book".into());
        assert_eq!(cover(&library, &q), two);
        library.set_status(&two, ReadStatus::Dropped).unwrap();
        library.set_status(&three, ReadStatus::Read).unwrap();
        assert_eq!(cover(&library, &q), one);
    }

    #[test]
    fn a_series_and_a_book_share_the_archive_pin_limit() {
        let (dir, mut library) = open_temp_library();
        let ids: Vec<_> = (0..10).map(|i| add(&mut library, dir.path(), &format!("Book {i}"), "Writer")).collect();
        for id in &ids[..9] { library.set_pinned(id, true).unwrap(); }
        library.set_archive_series_pin(" A Series ", true).unwrap();
        library.set_archive_series_pin("a series", true).unwrap();
        assert_eq!(library.archive_series_pins().unwrap(), ["A Series"]);
        assert!(library.set_pinned(&ids[9], true).is_err());
        library.set_archive_series_pin("a SERIES", false).unwrap();
        library.set_pinned(&ids[9], true).unwrap();
    }

    #[test]
    fn audio_type_is_opt_in_and_filterable() {
        let (dir, mut library) = open_temp_library();
        let id = add(&mut library, dir.path(), "Audio test", "Writer");
        assert!(library.set_audio_type(&id, Some("music")).is_err());
        library.conn.execute("UPDATE books SET format = 'mp3' WHERE id = ?1", params![id]).unwrap();
        let podcasts = query(|q| { q.kind = Some(ItemKind::Audiobooks); q.audio_type = Some("podcast".into()); });
        assert_eq!(library.library_page(&podcasts).unwrap().total, 0);
        library.set_audio_type(&id, Some("podcast")).unwrap();
        assert_eq!(library.library_page(&podcasts).unwrap().books[0].audio_type.as_deref(), Some("podcast"));
        library.set_audio_type(&id, None).unwrap();
        assert_eq!(library.library_page(&podcasts).unwrap().total, 0);
    }

    #[test]
    fn shelf_limits_require_an_explicit_replacement() {
        let (dir, mut library) = open_temp_library();
        let ids: Vec<String> = (0..16).map(|i| add(&mut library, dir.path(), &format!("Book {i}"), "Writer")).collect();
        for id in &ids[..10] {
            library.set_pinned(id, true).unwrap();
        }
        assert!(library.set_pinned(&ids[10], true).is_err());
        library.set_pinned(&ids[0], true).unwrap();
        for id in &ids[..15] {
            library.set_want_to_read(id, true).unwrap();
        }
        assert!(library.set_want_to_read(&ids[15], true).is_err());
        assert!(library.update_up_next(&ids[15], true, Some("missing")).is_err());
        library.update_up_next(&ids[15], true, Some(&ids[0])).unwrap();
        let shelf = library.library_page(&query(|q| q.shelf = Shelf::WantToRead)).unwrap();
        assert_eq!(shelf.total, 15);
        assert!(shelf.books.iter().any(|book| book.id == ids[15]));
        assert!(!shelf.books.iter().any(|book| book.id == ids[0]));
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
        for (name, group_series, omit_facets) in [
            ("search with facets", false, false),
            ("search without facets", false, true),
            ("series search with facets", true, false),
            ("series search without facets", true, true),
        ] {
            time(name, &mut || {
                drop(library.library_page(&LibraryQuery {
                    search: Some("Book 1".into()), page_size: 24, group_series, omit_facets, ..Default::default()
                }).unwrap());
            });
        }
        time("collections", &mut || drop(library.collections(u32::MAX).unwrap()));
        time("collections overview", &mut || drop(library.collections_overview().unwrap()));
        time("notes", &mut || drop(library.notes_page(&Default::default()).unwrap()));
        time("library info", &mut || drop(library.library_info().unwrap()));
    }
}

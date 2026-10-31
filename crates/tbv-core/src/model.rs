//! Records shared with the UI. Field names serialize as camelCase so the
//! TypeScript types in `src/api/types.ts` mirror them one to one.

use serde::{Deserialize, Serialize};

/// Content-hash identity, `sha256:<64 hex>`. Every device computes the same
/// id for the same file bytes, so it is safe to sync. Paths never are.
pub type BookId = String;

/// UTC timestamp, RFC 3339 with milliseconds and a `Z` suffix.
pub type IsoUtc = String;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReadStatus {
    Unread,
    InProgress,
    Read,
    /// Stopped and not going back to it.
    Dropped,
}

impl ReadStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            ReadStatus::Unread => "unread",
            ReadStatus::InProgress => "in_progress",
            ReadStatus::Read => "read",
            ReadStatus::Dropped => "dropped",
        }
    }

    pub fn parse(value: &str) -> ReadStatus {
        match value {
            "in_progress" => ReadStatus::InProgress,
            "read" => ReadStatus::Read,
            "dropped" => ReadStatus::Dropped,
            _ => ReadStatus::Unread,
        }
    }
}

/// Where the book's file is, from this device's point of view.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Availability {
    /// The file is on this device.
    Local,
    /// Known to the library (synced from another device) but not downloaded here.
    Cloud,
    /// This device had the file, but it is gone.
    Missing,
}

/// One file of a book: its own, or a copy kept with it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BookFile {
    pub id: BookId,
    pub format: String,
    pub size: u64,
    pub downloaded: bool,
}

/// A layout-independent reading position. Never a pixel offset.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReaderLocator {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub href: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cfi: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub page_index: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub normalized_y: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_progression: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_before: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_highlight: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_after: Option<String>,
    /// The chapter title at this position, for lists of highlights and bookmarks.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chapter: Option<String>,
    /// For an audiobook: how far in, from the start of the whole book.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audio_ms: Option<u64>,
    /// The format this place was marked in, when it came from another copy
    /// of the book (an EPUB's place on a PDF, say): its `cfi` is gone, and the
    /// page, fraction and words find it instead.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub format: Option<String>,
}

/// Another device's position for the same book, shown as "On Phone you're at 51%".
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemotePosition {
    pub device_name: String,
    pub total_progression: f64,
    pub at: IsoUtc,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BookPreview {
    pub id: BookId,
    pub title: String,
    pub authors: Vec<String>,
    /// Absolute path of the cached cover image on this device, if any.
    pub cover_path: Option<String>,
    /// Lowercase file extension without the dot, e.g. `epub`.
    pub format: String,
    pub synopsis: Option<String>,
    pub series: Option<String>,
    pub series_index: Option<f64>,
    pub added_at: IsoUtc,
    pub last_opened_at: Option<IsoUtc>,
    pub status: ReadStatus,
    pub total_progression: Option<f64>,
    pub resume_locator: Option<ReaderLocator>,
    pub availability: Availability,
    pub remote_positions: Vec<RemotePosition>,
    pub favorite: bool,
    pub want_to_read: bool,
    /// Your own rating, in quarter stars from 0.25 to 5.
    pub rating: Option<f64>,
    /// When you finished it.
    pub finished_at: Option<IsoUtc>,
    /// Your own tags, A to Z.
    #[serde(default)]
    pub tags: Vec<String>,
    /// Whether sync has put the book's file in the cloud, so the copy here can be removed.
    #[serde(default)]
    pub in_cloud: bool,
    /// Its genres: your edit, else fetched or from the file.
    #[serde(default)]
    pub genres: Vec<String>,
    /// An audiobook's length.
    #[serde(default)]
    pub duration_ms: Option<u64>,
    /// An audiobook's narrators.
    #[serde(default)]
    pub narrators: Vec<String>,
    /// Its language as a short code ("en"), when known.
    #[serde(default)]
    pub language: Option<String>,
    /// An ebook linked to an audiobook in the library, or an audiobook linked to an ebook.
    #[serde(default)]
    pub paired: bool,
    /// Chosen to be sent to the phone (see `SyncOptions::phone_chosen_only`).
    #[serde(default)]
    pub phone_wanted: bool,
    /// Downloaded on a phone.
    #[serde(default)]
    pub phone_has: bool,
    /// Pinned to the top of the Archive: when, so the latest pin comes first.
    #[serde(default)]
    pub pinned_at: Option<IsoUtc>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionPreview {
    pub id: String,
    pub name: String,
    pub count: u32,
    pub cover_paths: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AnnotationKind {
    Note,
    Highlight,
    Bookmark,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnotationPreview {
    pub id: String,
    pub book_id: BookId,
    pub book_title: String,
    pub kind: AnnotationKind,
    pub excerpt: String,
    pub note: Option<String>,
    pub locator: ReaderLocator,
    pub updated_at: IsoUtc,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryCounts {
    pub total: u32,
    pub unread: u32,
    pub in_progress: u32,
    pub read: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SyncState {
    Disabled,
    Idle,
    Syncing,
    Offline,
    Attention,
    Error,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatus {
    pub state: SyncState,
    pub last_success_at: Option<IsoUtc>,
    /// Other devices whose changes haven't all reached this one yet.
    #[serde(default)]
    pub behind: Vec<crate::sync::Behind>,
}

/// Reading activity is only reported once reading sessions are recorded.
/// Until then it is `None` and the UI shows an honest empty state.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadingActivity {
    pub completed_books: u32,
    pub pages_read: Option<u32>,
    pub seconds_read: u64,
    /// Monday first, seven values.
    pub weekly_seconds: Vec<u64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HomeViewModel {
    pub resume_book: Option<BookPreview>,
    pub recently_added: Vec<BookPreview>,
    pub in_progress: Vec<BookPreview>,
    pub collections: Vec<CollectionPreview>,
    pub annotations: Vec<AnnotationPreview>,
    pub library_counts: LibraryCounts,
    pub activity: Option<ReadingActivity>,
    /// When each book was finished, over the last year or so, for "this week" and "this month".
    #[serde(default)]
    pub finished_dates: Vec<IsoUtc>,
    /// Books you own and haven't started, for Suggested reading.
    #[serde(default)]
    pub suggested: Vec<BookPreview>,
    /// The authors you read most, for suggestions of their other books.
    #[serde(default)]
    pub read_authors: Vec<String>,
    pub sync: SyncStatus,
}

/// Which books the Library page lists. Read statuses are explicit, never
/// inferred from a percentage.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Shelf {
    #[default]
    All,
    Favorites,
    WantToRead,
    /// Chosen to go to the phone (web version): Send to device.
    SendToDevice,
    InProgress,
    Read,
    Unread,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SortOrder {
    #[default]
    RecentlyAdded,
    RecentlyOpened,
    Title,
    Author,
    Series,
    Progress,
    /// Your highest rated first; unrated books last.
    Rating,
    /// By first genre, A to Z; books without one last.
    Genre,
}

/// Which page a book belongs on: ebooks in the Library, PDF/DOC/DOCX/TXT in
/// Documents, audio in Audiobooks.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ItemKind {
    Books,
    Documents,
    Audiobooks,
}

/// Where a book's file is, for filtering. `Missing` books count as on device.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Location {
    OnDevice,
    CloudOnly,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct LibraryQuery {
    pub shelf: Shelf,
    pub sort: SortOrder,
    /// Matches title, author or series, ignoring case.
    pub search: Option<String>,
    /// Lowercase extensions. Empty means every format.
    pub formats: Vec<String>,
    pub location: Option<Location>,
    /// Books with any of these tags. Empty means any book.
    #[serde(default)]
    pub tags: Vec<String>,
    /// Books with any of these genres. Empty means any.
    #[serde(default)]
    pub genres: Vec<String>,
    /// Books in any of these languages (codes, as `languages` lists them). Empty means any.
    #[serde(default)]
    pub languages: Vec<String>,
    /// Books by any of these authors. Empty means any.
    #[serde(default)]
    pub authors: Vec<String>,
    /// Audiobooks read by any of these narrators. Empty means any.
    #[serde(default)]
    pub narrators: Vec<String>,
    /// Leaves out books marked read (Filter › Hide finished books).
    #[serde(default)]
    pub hide_read: bool,
    /// Books to leave out: any with one of these, whatever else matches.
    #[serde(default)]
    pub exclude: LibraryExclude,
    /// Books in any of these series. Empty means any.
    #[serde(default)]
    pub series: Vec<String>,
    /// Only books, documents or audiobooks. None means all of them.
    #[serde(default)]
    pub kind: Option<ItemKind>,
    /// Resonance's switch: only audiobooks paired with their ebook (true), or
    /// only those with none (false). None means both.
    #[serde(default)]
    pub paired: Option<bool>,
    /// Only these books (of those that match), to check which chosen ones a
    /// search or filter still shows. None means any book.
    #[serde(default)]
    pub ids: Option<Vec<String>>,
    /// Pinned books first (the Archive's own list).
    #[serde(default)]
    pub pinned_first: bool,
    /// Zero-based.
    pub page: u32,
    pub page_size: u32,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShelfCounts {
    pub all: u32,
    pub favorites: u32,
    pub want_to_read: u32,
    #[serde(default)]
    pub send_to_device: u32,
    pub in_progress: u32,
    pub read: u32,
    pub unread: u32,
    pub collections: u32,
}

/// The Library filters turned round: books with any of these are left out.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct LibraryExclude {
    pub formats: Vec<String>,
    pub tags: Vec<String>,
    pub genres: Vec<String>,
    pub authors: Vec<String>,
    pub narrators: Vec<String>,
    pub series: Vec<String>,
    pub languages: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryPage {
    pub books: Vec<BookPreview>,
    /// Books matching the query across all pages.
    pub total: u32,
    pub page: u32,
    pub page_size: u32,
    /// Whole-library counts, unaffected by search and filters.
    pub counts: ShelfCounts,
    /// Formats present in the library, for the filter menu.
    pub formats: Vec<String>,
    /// Your tags, A to Z, for the filter menu.
    pub tags: Vec<String>,
    /// Genres on the books of this kind, A to Z, for the filter menu.
    pub genres: Vec<String>,
    /// Languages the books of this kind are in, as short codes ("en"), A to Z.
    pub languages: Vec<String>,
    /// For audiobooks: their authors and narrators, A to Z, for the filter menus.
    pub authors: Vec<String>,
    pub narrators: Vec<String>,
}

/// This device's own settings. Not synced.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    /// The picture shown inside the sync circle, copied into the app's data folder.
    pub avatar_path: Option<String>,
    /// The account's own name, the same on every device.
    #[serde(default)]
    pub name: Option<String>,
    /// What this device is called: in Grimoire's list and in sync's notes.
    #[serde(default)]
    pub device_name: String,
}

/// What happened to one file handed to import.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "outcome"
)]
pub enum ImportResult {
    Imported {
        path: String,
        book_id: BookId,
        title: String,
        /// Deleted before and brought back: put in the Previously deleted collection.
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        returned: bool,
    },
    AlreadyInLibrary {
        path: String,
        book_id: BookId,
        title: String,
    },
    /// Deleted before, and Preferences › Library says to leave such books out.
    SkippedDeleted {
        path: String,
        book_id: BookId,
        title: String,
    },
    Unsupported {
        path: String,
    },
    Failed {
        path: String,
        reason: String,
    },
}

impl ImportResult {
    /// The same result, reported under the path the person chose.
    pub fn from_path(self, path: String) -> Self {
        match self {
            Self::Imported { book_id, title, returned, .. } => Self::Imported { path, book_id, title, returned },
            Self::SkippedDeleted { book_id, title, .. } => Self::SkippedDeleted { path, book_id, title },
            Self::AlreadyInLibrary { book_id, title, .. } => Self::AlreadyInLibrary { path, book_id, title },
            Self::Unsupported { .. } => Self::Unsupported { path },
            Self::Failed { reason, .. } => Self::Failed { path, reason },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn import_results_match_the_typescript_shape() {
        let json = serde_json::to_value(ImportResult::AlreadyInLibrary {
            path: "a.epub".into(),
            book_id: "sha256:00".into(),
            title: "A".into(),
        })
        .unwrap();
        assert_eq!(
            json,
            serde_json::json!({"outcome": "alreadyInLibrary", "path": "a.epub", "bookId": "sha256:00", "title": "A"})
        );
    }
}

/// Everything the reader needs about a book besides its file.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReaderBook {
    pub book: BookPreview,
    pub publisher: Option<String>,
    pub language: Option<String>,
    pub file_size: u64,
    /// When the book was opened before this time, for "Last opened 2 h ago".
    pub previously_opened_at: Option<IsoUtc>,
}

/// A highlight (with or without a note) or a bookmark inside a book.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Annotation {
    pub id: String,
    pub book_id: BookId,
    pub kind: AnnotationKind,
    /// The highlighted words, or the first words of a bookmarked page.
    pub excerpt: String,
    pub note: Option<String>,
    /// One of the four highlight colours: `rose`, `amber`, `sage`, `slate`.
    pub color: Option<String>,
    pub locator: ReaderLocator,
    pub created_at: IsoUtc,
    pub updated_at: IsoUtc,
}

/// A new or changed annotation from the reader. Without an id, one is created.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnotationInput {
    #[serde(default)]
    pub id: Option<String>,
    pub book_id: BookId,
    pub kind: AnnotationKind,
    #[serde(default)]
    pub excerpt: String,
    #[serde(default)]
    pub note: Option<String>,
    #[serde(default)]
    pub color: Option<String>,
    pub locator: ReaderLocator,
}

/// What a collection is. Shelves are the four built-in ones (Favourites,
/// Currently reading, To be read, Completed): their books come from each
/// book's own flags, and only their picture, badge and pinning can change.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CollectionKind {
    Shelf,
    Collection,
    /// A collection whose order matters, read from the top down.
    ReadingList,
}

impl CollectionKind {
    pub fn as_str(self) -> &'static str {
        match self {
            CollectionKind::Shelf => "shelf",
            CollectionKind::Collection => "collection",
            CollectionKind::ReadingList => "reading_list",
        }
    }

    pub fn parse(value: &str) -> CollectionKind {
        match value {
            "shelf" => CollectionKind::Shelf,
            "reading_list" => CollectionKind::ReadingList,
            _ => CollectionKind::Collection,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionSummary {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub kind: CollectionKind,
    /// One of the badges that ship with TBV, by name.
    pub badge: Option<String>,
    /// `gallery:<name>`, `picture:<file>` (a picture the user added) or
    /// `cover:<book id>`. Synced as written.
    pub picture: Option<String>,
    /// The picture's file on this device, for `picture:` and `cover:`.
    pub picture_path: Option<String>,
    pub pinned: bool,
    /// Set when the collection fills itself from rules instead of by hand.
    pub rules: Option<crate::rules::CollectionRules>,
    pub count: u32,
    /// The average of your ratings of its books, if you've rated any.
    pub rating: Option<f64>,
    /// Its first three books, for the strip of covers.
    pub covers: Vec<CoverRef>,
    pub created_at: IsoUtc,
    pub updated_at: IsoUtc,
}

/// Collections that fill themselves from each book's own details.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SmartKind {
    /// Added in the last 7 days. No longer shown; kept so an old link still opens.
    RecentlyAdded,
    /// Not opened yet.
    Unread,
    /// Finished.
    Read,
    /// Started and not finished.
    InProgress,
    Favorites,
    /// The Up next shelf's books.
    UpNext,
    /// The Sent to device shelf's books.
    SendToDevice,
}

impl SmartKind {
    /// The ones Compendium shows (embre, 2026-10-23), in their usual order.
    pub const ALL: [SmartKind; 5] = [
        SmartKind::SendToDevice,
        SmartKind::InProgress,
        SmartKind::UpNext,
        SmartKind::Favorites,
        SmartKind::Read,
    ];
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmartSummary {
    pub kind: SmartKind,
    pub count: u32,
    /// The average of your ratings of its books, if you've rated any.
    pub rating: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SeriesSummary {
    pub name: String,
    pub count: u32,
    pub authors: Vec<String>,
    pub covers: Vec<CoverRef>,
    /// Books of the series the library lacks, from its list online, filling
    /// the cover strip after the books here. Drawn greyed out.
    #[serde(default)]
    pub missing: Vec<MissingCover>,
}

/// A book of a series the library doesn't have, enough to draw its cover.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MissingCover {
    pub title: String,
    pub cover_url: Option<String>,
}

/// Enough of a book to draw its cover, or a cloth cover when it has none.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoverRef {
    pub id: BookId,
    pub title: String,
    pub authors: Vec<String>,
    pub cover_path: Option<String>,
}

/// Everything the Collections page shows.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionsOverview {
    /// Shelves and collections pinned to the top row.
    pub pinned: Vec<CollectionSummary>,
    pub smart: Vec<SmartSummary>,
    /// The user's own collections and reading lists (not shelves).
    pub collections: Vec<CollectionSummary>,
    pub series: Vec<SeriesSummary>,
}

/// Which collection to open.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum CollectionRef {
    Collection { id: String },
    Series { name: String },
    Smart { smart: SmartKind },
}

/// One collection with its books, in the collection's own order.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionDetail {
    /// Set for shelves, collections and reading lists.
    pub collection: Option<CollectionSummary>,
    pub books: Vec<BookPreview>,
}

/// A new collection, or the changes to one. Shelves keep their name and kind.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionInput {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    pub kind: CollectionKind,
    #[serde(default)]
    pub badge: Option<String>,
    #[serde(default)]
    pub pinned: bool,
    /// Rules that fill it by themselves. None: books are added by hand.
    #[serde(default)]
    pub rules: Option<crate::rules::CollectionRules>,
}

/// The kinds of note on the Notes page.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NoteKind {
    /// Highlighted words with nothing written.
    Highlight,
    /// Highlighted words with your own words attached.
    Annotation,
    /// Your words about a whole book.
    BookNote,
    /// Your words, belonging to no book.
    Personal,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteItem {
    pub id: String,
    pub kind: NoteKind,
    /// The book it belongs to. Personal notes have none.
    pub book: Option<CoverRef>,
    /// The highlighted words.
    pub excerpt: String,
    /// What you wrote.
    pub note: Option<String>,
    /// A personal note's title.
    pub title: Option<String>,
    pub color: Option<String>,
    /// Where in the book, for highlights and annotations.
    pub locator: Option<ReaderLocator>,
    pub created_at: IsoUtc,
    pub updated_at: IsoUtc,
    /// When it was pinned above the rest; None when it isn't.
    #[serde(default)]
    pub pinned_at: Option<IsoUtc>,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NotesTab {
    #[default]
    All,
    Highlights,
    Annotations,
    BookNotes,
    Personal,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NotesSort {
    /// Newest first.
    #[default]
    Recent,
    /// Most recently changed first.
    Updated,
    /// By book title, then in reading order.
    Book,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct NotesQuery {
    pub tab: NotesTab,
    pub sort: NotesSort,
    /// Matches the words, your notes, titles, and the book's title or author.
    pub search: Option<String>,
    pub book_id: Option<BookId>,
    /// Highlight colours to keep. Empty keeps every colour.
    pub colors: Vec<String>,
    /// Only notes with this tag.
    pub tag: Option<String>,
    /// Only notes changed at or after this moment.
    pub since: Option<IsoUtc>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteCounts {
    pub all: u32,
    pub highlights: u32,
    pub annotations: u32,
    pub book_notes: u32,
    pub personal: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotesPage {
    pub notes: Vec<NoteItem>,
    /// Across all notes, whatever the tab, search and filters.
    pub counts: NoteCounts,
    /// Books that have notes, for filtering by book.
    pub books: Vec<CoverRef>,
    /// Every tag a note has, for filtering by tag.
    pub tags: Vec<String>,
}

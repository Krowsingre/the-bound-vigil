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
}

impl ReadStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            ReadStatus::Unread => "unread",
            ReadStatus::InProgress => "in_progress",
            ReadStatus::Read => "read",
        }
    }

    pub fn parse(value: &str) -> ReadStatus {
        match value {
            "in_progress" => ReadStatus::InProgress,
            "read" => ReadStatus::Read,
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
    pub in_progress: u32,
    pub read: u32,
    pub unread: u32,
    pub collections: u32,
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
}

/// This device's own settings. Not synced.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    /// The picture shown inside the sync circle, copied into the app's data folder.
    pub avatar_path: Option<String>,
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
    },
    AlreadyInLibrary {
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
    pub count: u32,
    /// Its first three books, for the strip of covers.
    pub covers: Vec<CoverRef>,
    pub created_at: IsoUtc,
    pub updated_at: IsoUtc,
}

/// Collections that fill themselves from each book's own details.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SmartKind {
    /// Added in the last 30 days.
    RecentlyAdded,
    /// Not opened yet.
    Unread,
    /// Finished.
    Read,
    /// Not finished yet: unread or in progress.
    Incomplete,
    /// Started and not finished.
    InProgress,
    Favorites,
}

impl SmartKind {
    pub const ALL: [SmartKind; 6] = [
        SmartKind::RecentlyAdded,
        SmartKind::Unread,
        SmartKind::InProgress,
        SmartKind::Incomplete,
        SmartKind::Read,
        SmartKind::Favorites,
    ];
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmartSummary {
    pub kind: SmartKind,
    pub count: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SeriesSummary {
    pub name: String,
    pub count: u32,
    pub authors: Vec<String>,
    pub covers: Vec<CoverRef>,
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
}

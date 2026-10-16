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
    pub added_at: IsoUtc,
    pub last_opened_at: Option<IsoUtc>,
    pub status: ReadStatus,
    pub total_progression: Option<f64>,
    pub resume_locator: Option<ReaderLocator>,
    pub availability: Availability,
    pub remote_positions: Vec<RemotePosition>,
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

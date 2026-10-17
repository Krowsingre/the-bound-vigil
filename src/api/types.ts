// Mirrors crates/tbv-core/src/model.rs. Keep the two in step.

export type BookId = `sha256:${string}`;
export type IsoUtc = string;

export type ReadStatus = "unread" | "in_progress" | "read";
export type Availability = "local" | "cloud" | "missing";

export interface ReaderLocator {
  href?: string;
  cfi?: string;
  pageIndex?: number;
  normalizedY?: number;
  totalProgression?: number;
  textBefore?: string;
  textHighlight?: string;
  textAfter?: string;
}

export interface RemotePosition {
  deviceName: string;
  totalProgression: number;
  at: IsoUtc;
}

export interface BookPreview {
  id: BookId;
  title: string;
  authors: string[];
  coverPath: string | null;
  format: string;
  synopsis: string | null;
  series: string | null;
  seriesIndex: number | null;
  addedAt: IsoUtc;
  lastOpenedAt: IsoUtc | null;
  status: ReadStatus;
  totalProgression: number | null;
  resumeLocator: ReaderLocator | null;
  availability: Availability;
  remotePositions: RemotePosition[];
  favorite: boolean;
  wantToRead: boolean;
}

export interface CollectionPreview {
  id: string;
  name: string;
  count: number;
  coverPaths: string[];
}

export interface AnnotationPreview {
  id: string;
  bookId: BookId;
  bookTitle: string;
  kind: "note" | "highlight" | "bookmark";
  excerpt: string;
  note: string | null;
  locator: ReaderLocator;
  updatedAt: IsoUtc;
}

export interface LibraryCounts {
  total: number;
  unread: number;
  inProgress: number;
  read: number;
}

export type SyncState = "disabled" | "idle" | "syncing" | "offline" | "attention" | "error";

export interface SyncStatus {
  state: SyncState;
  lastSuccessAt: IsoUtc | null;
}

export interface ReadingActivity {
  completedBooks: number;
  pagesRead: number | null;
  secondsRead: number;
  weeklySeconds: number[];
}

export interface HomeViewModel {
  resumeBook: BookPreview | null;
  recentlyAdded: BookPreview[];
  inProgress: BookPreview[];
  collections: CollectionPreview[];
  annotations: AnnotationPreview[];
  libraryCounts: LibraryCounts;
  activity: ReadingActivity | null;
  sync: SyncStatus;
}

export type ImportResult =
  | { outcome: "imported"; path: string; bookId: BookId; title: string }
  | { outcome: "alreadyInLibrary"; path: string; bookId: BookId; title: string }
  | { outcome: "unsupported"; path: string }
  | { outcome: "failed"; path: string; reason: string };

export type Shelf = "all" | "favorites" | "want_to_read" | "in_progress" | "read" | "unread";
export type SortOrder = "recently_added" | "recently_opened" | "title" | "author" | "series" | "progress";
export type Location = "on_device" | "cloud_only";

export interface LibraryQuery {
  shelf: Shelf;
  sort: SortOrder;
  search: string | null;
  formats: string[];
  location: Location | null;
  /** Zero-based. */
  page: number;
  pageSize: number;
}

export interface ShelfCounts {
  all: number;
  favorites: number;
  wantToRead: number;
  inProgress: number;
  read: number;
  unread: number;
  collections: number;
}

export interface LibraryPage {
  books: BookPreview[];
  total: number;
  page: number;
  pageSize: number;
  counts: ShelfCounts;
  formats: string[];
}

export interface Profile {
  avatarPath: string | null;
}

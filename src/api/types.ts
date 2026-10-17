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
  /** The chapter title at this position. */
  chapter?: string;
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
  /** Your own rating, 1 to 5 stars. */
  rating: number | null;
  /** When you finished it. */
  finishedAt: IsoUtc | null;
  /** Your own tags, A to Z. */
  tags: string[];
  /** Whether the book's file is in the cloud, so the copy here can be removed. */
  inCloud: boolean;
  /** Its genres: your edit, else fetched online or from the file. */
  genres: string[];
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
  kind: AnnotationKind;
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

export interface SupabaseProject {
  url: string;
  anonKey: string;
}

/** Both devices changed the same thing; the user picks which to keep. */
export interface SyncConflict {
  kind: string;
  key: string;
  /** What it is, in words: "Reading progress in Dracula". */
  what: string;
  here: string;
  cloud: string;
  cloudChangedAt: IsoUtc;
}

/** Where the library is kept, as Settings shows it (never a password). */
export interface ProviderView {
  kind: "supabase" | "folder" | "webdav" | "off";
  /** For a folder: which cloud app's ("icloud", "dropbox", "mega", "custom"…). */
  service: string | null;
  /** The folder, or the WebDAV address. */
  location: string | null;
  username: string | null;
}

/** A choice of where to keep the library, as sent to the core. */
export type ProviderChoice =
  | { kind: "supabase" }
  | { kind: "off" }
  | { kind: "folder"; service: string; path: string }
  | { kind: "webdav"; url: string; username: string; password: string };

export interface SyncOverview {
  status: SyncStatus;
  provider: ProviderView;
  project: SupabaseProject | null;
  signedInAs: string | null;
  lastError: string | null;
  /** Changes on this device the cloud doesn't have yet. */
  waitingToSend: number;
  conflicts: SyncConflict[];
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

export type ImportStage = "waiting" | "reading" | "adding" | "done";

/** One book file on the Imports page. */
export interface ImportItem {
  id: number;
  path: string;
  name: string;
  bytes: number;
  bytesRead: number;
  stage: ImportStage;
  result: ImportResult | null;
}

export type Shelf = "all" | "favorites" | "want_to_read" | "in_progress" | "read" | "unread";
export type SortOrder = "recently_added" | "recently_opened" | "title" | "author" | "series" | "progress" | "rating" | "genre";
/** Ebooks live in the Library; PDF, DOC, DOCX and TXT on the Documents page. */
export type ItemKind = "books" | "documents";
export type Location = "on_device" | "cloud_only";

export interface LibraryQuery {
  shelf: Shelf;
  sort: SortOrder;
  search: string | null;
  formats: string[];
  location: Location | null;
  /** Books with any of these tags. */
  tags?: string[];
  /** Books with any of these genres. */
  genres?: string[];
  /** Only books, or only documents. Left out: both. */
  kind?: ItemKind | null;
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
  /** Your tags, A to Z. */
  tags: string[];
  /** Genres on books of this kind, A to Z. */
  genres: string[];
}

export type DetailFieldName =
  | "title"
  | "authors"
  | "series"
  | "series_index"
  | "synopsis"
  | "genres"
  | "publisher"
  | "published"
  | "language"
  | "isbn";

/** One detail in its layers. Lists (authors, genres) are JSON arrays. */
export interface DetailField {
  field: DetailFieldName;
  /** From the book file. */
  own: string | null;
  /** Fetched online, or read from the file beyond the basics. */
  fetched: string | null;
  fetchedFrom: "google" | "openlibrary" | "file" | null;
  /** Your own edit. */
  edited: string | null;
}

export interface BookDetails {
  book: BookPreview;
  fields: DetailField[];
  fileSize: number;
  filePath: string | null;
  collections: { id: string; name: string }[];
  annotations: number;
}

/** A value for a detail, or null to take your edit away. */
export interface DetailChange {
  field: DetailFieldName;
  value: string | null;
}

export interface TagCount {
  name: string;
  count: number;
}

/** Books that look like the same book. */
export interface DuplicateGroup {
  key: string;
  /** Why they look alike, in words. */
  reason: string;
  books: (BookPreview & { fileSize: number; notes: number })[];
}

export interface Profile {
  avatarPath: string | null;
}

export type HighlightColor = "rose" | "amber" | "sage" | "slate";
export type AnnotationKind = "note" | "highlight" | "bookmark";

export interface ReaderBook {
  book: BookPreview;
  publisher: string | null;
  language: string | null;
  fileSize: number;
  previouslyOpenedAt: IsoUtc | null;
}

export interface Annotation {
  id: string;
  bookId: BookId;
  kind: AnnotationKind;
  excerpt: string;
  note: string | null;
  color: HighlightColor | null;
  locator: ReaderLocator;
  createdAt: IsoUtc;
  updatedAt: IsoUtc;
}

export interface AnnotationInput {
  id?: string;
  bookId: BookId;
  kind: AnnotationKind;
  excerpt: string;
  note?: string | null;
  color?: HighlightColor | null;
  locator: ReaderLocator;
}

export type CollectionKind = "shelf" | "collection" | "reading_list";

export interface CollectionSummary {
  id: string;
  name: string;
  description: string | null;
  kind: CollectionKind;
  /** One of the badges in `collections/badges.tsx`, by name. */
  badge: string | null;
  /** `gallery:<name>`, `picture:<file>` or `cover:<book id>`. */
  picture: string | null;
  /** The picture's file on this device, for `picture:` and `cover:`. */
  picturePath: string | null;
  pinned: boolean;
  /** Set when it fills itself from rules instead of by hand. */
  rules: CollectionRules | null;
  count: number;
  /** The average of your ratings of its books, if you've rated any. */
  rating: number | null;
  /** Its first three books, for the strip of covers. */
  covers: CoverRef[];
  createdAt: IsoUtc;
  updatedAt: IsoUtc;
}

export type SmartKind = "recently_added" | "unread" | "in_progress" | "read" | "favorites";

export interface SmartSummary {
  kind: SmartKind;
  count: number;
  rating: number | null;
}

/** What an import of a Goodreads export did. */
export interface HardcoverStatus {
  /** False until this version of TBV is registered with Hardcover. */
  available: boolean;
  username: string | null;
  sendRatings: boolean;
}

export interface HardcoverSendAll {
  sent: number;
  /** "Title by Author" for books Hardcover doesn't have. */
  notFound: string[];
}

export interface GoodreadsImport {
  rows: number;
  matched: number;
  ratings: number;
  statuses: number;
  upNext: number;
  favourites: number;
  collectionsCreated: string[];
  collectionBooks: number;
  /** "Title by Author" for each book that isn't in the library. */
  notFound: string[];
}

export interface SeriesSummary {
  name: string;
  count: number;
  authors: string[];
  covers: CoverRef[];
}

/** Enough of a book to draw its cover. */
export interface CoverRef {
  id: BookId;
  title: string;
  authors: string[];
  coverPath: string | null;
}

export interface CollectionsOverview {
  pinned: CollectionSummary[];
  smart: SmartSummary[];
  collections: CollectionSummary[];
  series: SeriesSummary[];
}

export type CollectionRef =
  | { kind: "collection"; id: string }
  | { kind: "series"; name: string }
  | { kind: "smart"; smart: SmartKind };

export interface CollectionDetail {
  collection: CollectionSummary | null;
  books: BookPreview[];
}

export interface CollectionInput {
  name: string;
  description?: string | null;
  kind: CollectionKind;
  badge?: string | null;
  pinned: boolean;
  /** Rules that fill it by themselves. Null or left out: books are added by hand. */
  rules?: CollectionRules | null;
}

export type RuleField =
  | "title"
  | "author"
  | "series"
  | "publisher"
  | "language"
  | "format"
  | "rating"
  | "status"
  | "favorite"
  | "upNext"
  | "added"
  | "location"
  | "tag"
  | "genre";

export type RuleOp =
  | "contains"
  | "notContains"
  | "is"
  | "isNot"
  | "startsWith"
  | "isEmpty"
  | "atLeast"
  | "atMost"
  | "withinDays"
  | "olderThanDays";

export interface Rule {
  field: RuleField;
  op: RuleOp;
  value: string;
}

/** `any`: a book needs to match one rule; otherwise every rule. */
export interface CollectionRules {
  any: boolean;
  rules: Rule[];
}

export type NoteKind = "highlight" | "annotation" | "book_note" | "personal";

export interface NoteItem {
  id: string;
  kind: NoteKind;
  /** The book it belongs to. Personal notes have none. */
  book: CoverRef | null;
  /** The highlighted words. */
  excerpt: string;
  /** What you wrote. */
  note: string | null;
  /** A personal note's title. */
  title: string | null;
  color: HighlightColor | null;
  locator: ReaderLocator | null;
  createdAt: IsoUtc;
  updatedAt: IsoUtc;
}

export type NotesTab = "all" | "highlights" | "annotations" | "book_notes" | "personal";
export type NotesSort = "recent" | "updated" | "book";

export interface NotesQuery {
  tab: NotesTab;
  sort: NotesSort;
  search: string | null;
  bookId: BookId | null;
  colors: HighlightColor[];
}

export interface NoteCounts {
  all: number;
  highlights: number;
  annotations: number;
  bookNotes: number;
  personal: number;
}

export interface NotesPage {
  notes: NoteItem[];
  counts: NoteCounts;
  books: CoverRef[];
}

/** Where this device keeps the library, for Settings. */
export interface LibraryInfo {
  database: string;
  booksDir: string;
  schemaVersion: number;
  bookCount: number;
  databaseBytes: number;
  booksBytes: number;
}

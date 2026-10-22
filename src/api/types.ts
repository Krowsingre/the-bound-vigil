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
  /** For an audiobook: how far in, from the start of the whole book. */
  audioMs?: number;
  /** Marked in another copy of the book, in this format: found by page and fraction, not `cfi`. */
  format?: string;
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
  /** Its language as a short code ("en"), when known. */
  language?: string | null;
  /** Phone version: its file isn't in the cloud, so it can't be opened or downloaded here. */
  fileUnavailable?: boolean;
  /** An audiobook's length. */
  durationMs?: number | null;
  /** An audiobook's narrators. */
  narrators?: string[];
  /** An ebook linked to an audiobook in the library, or an audiobook linked to an ebook. */
  paired?: boolean;
  /** Chosen to go to the phone (when only chosen books do), or asked for from the phone. */
  phoneWanted?: boolean;
  /** Downloaded on a phone, so tidying Supabase keeps it. */
  phoneHas?: boolean;
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
  /** The second place the library syncs with, if there is one. */
  also: AlsoOverview | null;
}

/** How the second place stands. */
export interface AlsoOverview {
  provider: ProviderView;
  lastSuccessAt: IsoUtc | null;
  lastError: string | null;
  waitingToSend: number;
}

/** What tidying up Supabase would do: paths like `books/<hash>.epub`. */
export interface TidyPlan {
  /** Copies of books on this computer, which stay. */
  keep: number;
  /** Copies the other sync place already has: simply removed. */
  remove: string[];
  /** Copies the other place hasn't got: sent there, then removed. */
  copyFirst: string[];
  /** Copies with nowhere else to go, because there's no other place. */
  lose: string[];
  /** Covers of books whose file isn't kept in Supabase: simply removed. */
  covers: string[];
  /** Bytes freed, where Supabase says its files' sizes. */
  bytes: number;
}

/** One file TBV keeps in Supabase (Settings › Sync › What's in Supabase). */
export interface StoredFile {
  /** Like `books/<hash>.epub`. */
  path: string;
  kind: "ebook" | "document" | "audiobook" | "cover" | "picture" | "other";
  /** The book it belongs to, if it's one in the library. */
  bookId: string | null;
  title: string | null;
  bytes: number | null;
  /** This computer or the other sync place keeps a copy, so removing it loses nothing. */
  elsewhere: boolean;
}

/** One book and where its file is (the "Where your books are" page). */
export interface BookPlaces {
  bookId: string;
  title: string;
  authors: string[];
  format: string;
  /** Its file is on this computer. */
  here: boolean;
  /** In the main sync place; null when that place isn't set up or couldn't be checked. */
  main: boolean | null;
  /** In the second sync place, likewise. */
  also: boolean | null;
}

/** A sync place as the page names it, and why it couldn't be checked. */
export interface PlaceCheck {
  provider: ProviderView;
  problem: string | null;
}

export interface PlacesView {
  main: PlaceCheck | null;
  also: PlaceCheck | null;
  books: BookPlaces[];
}

export interface RemoveReport {
  removed: number;
  failed: number;
  stopped: boolean;
}

/** How much of a Supabase project TBV is using. */
export interface SupabaseUsage {
  fileBytes: number;
  files: number;
  bookBytes: number;
  audioBytes: number;
  pictureBytes: number;
  /** Unknown until the setup script is run again. */
  databaseBytes: number | null;
}

export interface TidyReport {
  removed: number;
  /** Of those, sent to the other place first. */
  copied: number;
  /** Left where they were, because they couldn't be sent on. */
  failed: number;
  stopped: boolean;
}

export interface TidyProgress {
  done: number;
  total: number;
}

/** Migrate: copy everything, then sync through the new place. Backup: copy everything, keep syncing where you are. */
export type MoveMode = "migrate" | "backup";
/** Which books go: all, books and documents, or audiobooks. */
export type MoveScope = "all" | "text" | "audio";
export type MoveStage = "looking" | "records" | "files" | "checking";

/** The check at the end of a move: is everything that should be there, there? */
export interface MoveCheck {
  records: number;
  recordsFound: number;
  files: number;
  filesFound: number;
  /** What isn't there, in words. */
  missing: string[];
  moreMissing: number;
  /** What didn't go but wasn't in the old place either. Doesn't fail the check. */
  notes: string[];
}

export interface MoveReport {
  recordsCopied: number;
  filesCopied: number;
  /** Already there from an earlier backup or try. */
  alreadyThere: number;
  cancelled: boolean;
  check: MoveCheck | null;
}

export interface MoveStatus {
  running: boolean;
  mode: MoveMode | null;
  scope: MoveScope;
  from: ProviderView | null;
  to: ProviderView | null;
  progress: { stage: MoveStage; done: number; total: number };
  report: MoveReport | null;
  /** A migration that passed its check now syncs through the new place. */
  switched: boolean;
  error: string | null;
  /** Whether "Audio only" can be chosen yet. */
  audioReady: boolean;
  /** Signed in to the Supabase project being moved to, as this email. */
  supabaseAccount: string | null;
}

export interface ReadingActivity {
  completedBooks: number;
  pagesRead: number | null;
  secondsRead: number;
  weeklySeconds: number[];
}

/** Seconds spent on one day (`YYYY-MM-DD`), added up across devices. */
export interface TimeSpent {
  day: string;
  read: number;
  listen: number;
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
  | { outcome: "imported"; path: string; bookId: BookId; title: string; /** Deleted before, now in Previously deleted. */ returned?: boolean }
  | { outcome: "alreadyInLibrary"; path: string; bookId: BookId; title: string }
  | { outcome: "skippedDeleted"; path: string; bookId: BookId; title: string }
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

/**
 * What the Imports page shows: counts, plus a window of the list. A big
 * import can hold tens of thousands of books, far too many to send whole.
 */
export interface ImportsView {
  total: number;
  done: number;
  added: number;
  already: number;
  /** Deleted before and left out. */
  skippedDeleted: number;
  /** Deleted before and brought back into Previously deleted. */
  returned: number;
  unsupported: number;
  failed: number;
  /** The title when exactly one book was added. */
  onlyAdded: string | null;
  /** The reason when exactly one file couldn't be read. */
  onlyFailure: string | null;
  waitingCount: number;
  current: ImportItem[];
  /** The first few waiting. */
  waiting: ImportItem[];
  /** The latest few finished, newest first. */
  finished: ImportItem[];
  currentRead: number;
  currentBytes: number;
  /** Added PDFs whose covers are still to be drawn. */
  pdfCovers: number;
}

export type Shelf = "all" | "favorites" | "want_to_read" | "send_to_device" | "in_progress" | "read" | "unread";
export type SortOrder = "recently_added" | "recently_opened" | "title" | "author" | "series" | "progress" | "rating" | "genre";
/** Ebooks live in the Library; PDF, DOC, DOCX and TXT on the Documents page. */
export type ItemKind = "books" | "documents" | "audiobooks";
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
  /** Books in any of these languages (codes, as `languages` lists them). */
  languages?: string[];
  /** Phone version only: books whose file can be downloaded here. */
  downloadable?: boolean;
  /** Books by any of these authors. */
  authors?: string[];
  /** Audiobooks read by any of these narrators. */
  narrators?: string[];
  /** Books in any of these series. */
  series?: string[];
  /** Leaves out books marked read. */
  hideRead?: boolean;
  /** Books with any of these are left out. */
  exclude?: LibraryExclude;
  /** Only books, documents or audiobooks. Left out: all of them. */
  kind?: ItemKind | null;
  /** Only these books (of those that match). */
  ids?: string[];
  /** Zero-based. */
  page: number;
  pageSize: number;
}

/** The Library filters turned round: books with any of these are left out. */
export interface LibraryExclude {
  formats: string[];
  tags: string[];
  genres: string[];
  authors: string[];
  narrators: string[];
  series: string[];
  languages: string[];
}

export interface ShelfCounts {
  all: number;
  favorites: number;
  wantToRead: number;
  sendToDevice: number;
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
  /** Languages books of this kind are in, as short codes, A to Z. */
  languages: string[];
  /** For audiobooks: their authors and narrators, A to Z. */
  authors: string[];
  narrators: string[];
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
  | "isbn"
  | "narrators";

/** One detail in its layers. Lists (authors, genres) are JSON arrays. */
export interface DetailField {
  field: DetailFieldName;
  /** From the book file. */
  own: string | null;
  /** Fetched online, or read from the file beyond the basics. */
  fetched: string | null;
  fetchedFrom: "google" | "openlibrary" | "audible" | "hardcover" | "file" | null;
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
  books: (BookPreview & { fileSize: number; notes: number; collections: number; coverSize: [number, number] | null })[];
}

/** One book of a series, as an online source lists it. */
export interface SeriesEntry {
  title: string;
  /** Its number in the series. Novellas can be 2.5. */
  position: number | null;
  authors: string[];
  coverUrl: string | null;
  source: string;
}

/** A book of the series the library doesn't have. */
export interface MissingBook extends SeriesEntry {
  key: string;
  /** Hidden by the person. */
  hidden: boolean;
  /** Read somewhere else, as the person marked it. */
  read: boolean;
}

/** A book of the series in the library, with its number (its own, or the list's). */
export interface OwnedBook {
  book: BookPreview;
  position: number | null;
}

/** A book in the library that is probably in the series. */
export interface SeriesMatch {
  book: BookPreview;
  /** The number it would get. */
  position: number | null;
  /** Why TBV thinks it fits, in words. */
  reason: string;
}

export interface SeriesReview {
  name: string;
  /** When the list was last looked up online. Null: never. */
  checkedAt: string | null;
  /** How many books the online list has. */
  listed: number;
  /** How many books of the series the library has. */
  owned: number;
  missing: MissingBook[];
  matches: SeriesMatch[];
  /** The books here, in series order. */
  ownedBooks: OwnedBook[];
}

/** "Use on your phone at home": the computer serving TBV to a phone on the same Wi-Fi. */
export interface HomeStatus {
  on: boolean;
  /** Addresses to open on the phone, best first. */
  addresses: string[];
  /** The pairing code, while one is offered. */
  code: string | null;
  /** A QR code (SVG) that opens the first address and pairs. */
  qr: string | null;
  phones: number;
  /** Why it couldn't start, in words. */
  problem: string | null;
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

// Mirrors crates/tbv-core/src/ereaders.

export type EreaderKind = "kindle" | "kobo" | "pocketBook" | "nook" | "sony" | "other";

/** An e-reader (or a drive that might be one) plugged in by cable. */
export interface Ereader {
  kind: EreaderKind;
  /** "Kindle", or for a drive TBV isn't sure about, its name. */
  name: string;
  /** Where the drive is, e.g. `E:\`. Names the reader when sending. */
  root: string;
  booksFolder: string;
  /** Formats it opens when copied by cable. Empty when TBV can't know. */
  formats: string[];
}

export interface CopiedToEreader {
  path: string;
  /** The same book was there already. */
  alreadyThere: boolean;
}

export type MailSecurity = "starttls" | "ssl";

/** Kindle by email, as Settings shows it: everything but the password. */
export interface KindleEmailView {
  server: string;
  port: number;
  security: MailSecurity;
  username: string;
  hasPassword: boolean;
  /** The address Amazon must have on its approved list. */
  from: string;
  /** The person's @kindle.com address. */
  kindle: string;
}

export interface KindleEmailInput {
  server: string;
  port: number;
  security: MailSecurity;
  username: string;
  /** Null keeps the password saved before. */
  password: string | null;
  from: string;
  kindle: string;
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
  /** Books the library lacks, from the series' list online, after the covers here. Drawn greyed out. */
  missing?: MissingCover[];
}

export interface MissingCover {
  title: string;
  coverUrl: string | null;
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

export interface AudioChapter {
  title: string;
  startMs: number;
}

export interface AudioPart {
  name: string;
  startMs: number;
  durationMs: number;
}

/** An audiobook as its page and the player show it. */
export interface Audiobook {
  book: BookPreview;
  narrators: string[];
  durationMs: number;
  chapters: AudioChapter[];
  parts: AudioPart[];
  /** Where you are, from the start. */
  positionMs: number;
  /** The ebook it's linked to, for reading along. */
  ebook: { id: string; name: string } | null;
}

export type ServerProtocol = "ftp" | "ftps" | "sftp";
export type ServerLogin = "password" | "key";

/** A server saved on this device, as Settings shows it: never the password. */
export interface ServerView {
  id: string;
  name: string;
  protocol: ServerProtocol;
  host: string;
  port: number;
  username: string;
  hasPassword: boolean;
  login: ServerLogin;
  keyFile: string | null;
  folder: string;
  /** The SFTP server's key fingerprint, once trusted. */
  hostKey: string | null;
}

export interface ServerInput {
  /** Null adds a new server. */
  id: string | null;
  name: string;
  protocol: ServerProtocol;
  host: string;
  port: number;
  username: string;
  /** Null keeps the password saved before. */
  password: string | null;
  login: ServerLogin;
  keyFile: string | null;
  folder: string;
}

export interface RemoteEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
}

/** A server's folder: its folders and the files TBV can import. */
export interface ServerListing {
  path: string;
  entries: RemoteEntry[];
  /** Files left out because TBV can't import them. */
  hidden: number;
}

export interface ServerChoice {
  path: string;
  isDir: boolean;
  size: number;
}

export interface LocalSendStatus {
  enabled: boolean;
  running: boolean;
  /** How TBV shows in LocalSend's list of nearby devices. */
  alias: string;
  problem: string | null;
}

/** Files someone wants to send with LocalSend, waiting for an answer. */
/** One file sent with LocalSend, as the Imports page shows it. */
export interface SentFile {
  session: string;
  id: string;
  from: string;
  name: string;
  /** The size the sender gave, and how much has arrived. */
  size: number;
  bytes: number;
  state: "waiting" | "arriving" | "arrived" | "failed" | "skipped";
  /** Why it failed or was skipped. */
  reason: string | null;
}

export interface LocalSendOffer {
  session: string;
  /** The sending device's name. */
  from: string;
  files: { id: string; name: string; size: number; importable: boolean }[];
}

/** A device nearby with LocalSend open, to send books to. */
export interface NearbyDevice {
  alias: string;
  fingerprint: string;
  /** "mobile", "desktop", "web", "headless" or "server", as the device says. */
  deviceType: string;
  address: string;
  port: number;
  https: boolean;
}

/** How sending with LocalSend is going. */
export interface LocalSendSending {
  /** Which book, counting from 1, of how many. */
  book: number;
  books: number;
  title: string;
  bytes: number;
  size: number;
}

/** What sending with LocalSend did. */
export interface SentWithLocalSend {
  sent: number;
  /** Books that couldn't go: [title, why]. */
  skipped: [string, string][];
}

/** One file from a server, from being chosen until its book is in the library. */
export interface QueuedServerFile {
  id: number;
  serverName: string;
  remote: string;
  name: string;
  size: number;
  bytesDone: number;
  state: "waiting" | "downloading" | "downloaded" | "importing" | "done" | "failed";
  error: string | null;
  startedAt: IsoUtc | null;
  finishedAt: IsoUtc | null;
}

export interface ServerQueueCounts {
  total: number;
  waiting: number;
  downloading: number;
  /** Down and on their way into the library. */
  downloaded: number;
  done: number;
  failed: number;
  bytesTotal: number;
  bytesDone: number;
}

/** How bringing files down from servers stands. The rows come a page at a time. */
export interface ServerQueueView {
  counts: ServerQueueCounts;
  /** How many come down at once, 1 to 5. */
  connections: number;
  /** Servers being looked through for what was chosen. */
  looking: string[];
  /** Why the last "Bring in" found nothing to bring down. */
  problem: string | null;
  /** The files coming down now. */
  active: QueuedServerFile[];
  /** Changes when rows come, go or change state. */
  version: number;
}

/** One file a sync moved (or tried to), for the Sync activity page. */
export interface FileActivity {
  /** "main" or "also"; null for a book fetched when it was opened. */
  lane: "main" | "also" | null;
  direction: "up" | "down" | "erase";
  what: string;
  bytes: number;
  at: IsoUtc;
  problem: string | null;
}

/** How one sync place is getting on in the current (or last) run. */
export interface PlaceActivity {
  lane: "main" | "also";
  provider: ProviderView;
  step: "receiving" | "sending" | "files" | null;
  received: number;
  sent: number;
  filesTotal: number;
  filesDone: number;
  bytesTotal: number;
  bytesDone: number;
  current: FileActivity | null;
  finished: boolean;
  problem: string | null;
}

/** What sync is doing now and did lately. Kept only while TBV is open. */
export interface SyncActivity {
  running: boolean;
  startedAt: IsoUtc | null;
  finishedAt: IsoUtc | null;
  places: PlaceActivity[];
  /** Newest first. */
  recent: FileActivity[];
}

/** An OPDS catalog saved on this device (Catalogs page). */
export interface CatalogView {
  id: string;
  name: string;
  url: string;
  username: string | null;
  hasPassword: boolean;
}

/** What the Catalogs page saves. No id adds one; no password keeps the saved one. */
export interface CatalogInput {
  id: string | null;
  name: string;
  url: string;
  username: string | null;
  password: string | null;
}

export interface OpdsFile {
  url: string;
  mime: string;
  /** TBV's name for the format ("epub"), when it can open it. */
  format: string | null;
  label: string | null;
}

export interface OpdsEntry {
  id: string;
  title: string;
  authors: string[];
  summary: string | null;
  language: string | null;
  published: string | null;
  cover: string | null;
  /** A shelf or list rather than a book: the page it leads to. */
  navigation: string | null;
  /** The book's files, best first. */
  files: OpdsFile[];
  /** Must be bought or borrowed, which TBV can't do. */
  notFree: boolean;
}

/** One page of a catalog. */
export interface OpdsFeed {
  url: string;
  title: string;
  entries: OpdsEntry[];
  next: string | null;
  previous: string | null;
  /** Search address with `{searchTerms}` where the words go. */
  search: string | null;
}

/** A book being written on the Writing page. */
export interface WritingProject {
  id: string;
  title: string;
  author: string | null;
  series: string | null;
  seriesIndex: number | null;
  language: string | null;
  description: string | null;
  /** `picture:<file>`. */
  cover: string | null;
  /** The cover's file here (or a picture address on the phone). */
  coverPath: string | null;
  /** EPUB settings as JSON (see writing/epub.ts). */
  export: string;
  chapters: number;
  words: number;
  createdAt: IsoUtc;
  updatedAt: IsoUtc;
}

export interface WritingChapter {
  id: string;
  projectId: string;
  title: string;
  /** The editor's HTML. */
  body: string;
  position: number;
  words: number;
  updatedAt: IsoUtc;
  /** A chapter, or front matter (dedication, foreword) or back matter (acknowledgements, about the author). */
  role: "chapter" | "front" | "back";
}

export interface WritingProjectView {
  project: WritingProject;
  chapters: WritingChapter[];
}

export interface WritingDetails {
  title: string;
  author: string | null;
  series: string | null;
  seriesIndex: number | null;
  language: string | null;
  description: string | null;
}

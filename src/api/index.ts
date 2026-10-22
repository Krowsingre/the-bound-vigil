// The one place the UI talks to the app core. Inside the desktop app this
// calls Rust commands; in a plain browser (design previews only) it serves a
// clearly labelled sample library so screens can be looked at without the app.

import { homeAudioUrl, homeCore, homeEvents } from "./homeCore";
import type { Found } from "../lib/onlineDetails";
import type {
  TidyPlan,
  StoredFile,
  RemoveReport,
  TidyProgress,
  SentFile,
  SupabaseUsage,
  TidyReport,
  Audiobook,
  ProviderChoice,
  Annotation,
  AnnotationInput,
  CollectionDetail,
  CollectionInput,
  CollectionRules,
  CollectionPreview,
  CollectionRef,
  CollectionSummary,
  BookDetails,
  CollectionsOverview,
  DetailChange,
  DuplicateGroup,
  SeriesReview,
  HomeStatus,
  CopiedToEreader,
  Ereader,
  GoodreadsImport,
  HardcoverSendAll,
  HardcoverStatus,
  HomeViewModel,
  ImportsView,
  SyncActivity,
  KindleEmailInput,
  KindleEmailView,
  ServerChoice,
  ServerQueueView,
  LocalSendOffer,
  LocalSendStatus,
  QueuedServerFile,
  ServerInput,
  ServerListing,
  ServerView,
  MoveMode,
  MoveScope,
  MoveStatus,
  LibraryInfo,
  LibraryPage,
  LibraryQuery,
  NoteItem,
  NoteKind,
  NotesPage,
  NotesQuery,
  Profile,
  ReadStatus,
  ReaderBook,
  ReaderLocator,
  SupabaseProject,
  SyncOverview,
  SyncStatus,
  TagCount,
} from "./types";

export interface Api {
  readonly kind: "app" | "preview" | "web";
  getHome(): Promise<HomeViewModel>;
  /** Queues book files and folders on the Imports page. Returns how many books were found. */
  queueImports(paths: string[]): Promise<number>;
  importQueue(): Promise<ImportsView>;
  /** Added PDFs still needing a cover drawn, handed over once. */
  takePdfCovers(): Promise<string[]>;
  /** Takes the books still waiting off the queue. */
  cancelImports(): Promise<void>;
  clearFinishedImports(): Promise<void>;
  onImports(listener: (view: ImportsView) => void): () => void;
  setBookStatus(bookId: string, status: ReadStatus): Promise<void>;
  getLibrary(query: LibraryQuery): Promise<LibraryPage>;
  getCollections(): Promise<CollectionPreview[]>;
  setFavorite(bookId: string, favorite: boolean): Promise<void>;
  setWantToRead(bookId: string, want: boolean): Promise<void>;
  /** Chooses books to go to the phone (when only chosen ones do), or stops. On the phone: asks a computer to send them. */
  setPhoneWanted(bookIds: string[], wanted: boolean): Promise<void>;
  /** 1 to 5 stars, or null to clear. */
  setRating(bookId: string, rating: number | null): Promise<void>;
  /** Asks for a Goodreads export file and brings it in. Null if cancelled. */
  importGoodreads(): Promise<GoodreadsImport | null>;
  /** Writes a Goodreads-format file of rated and shelved books. Null if cancelled, else how many. */
  exportGoodreads(): Promise<number | null>;
  hardcoverStatus(): Promise<HardcoverStatus>;
  /** Opens Hardcover in the browser and waits for the person to approve. */
  hardcoverSignIn(): Promise<HardcoverStatus>;
  hardcoverSignOut(): Promise<HardcoverStatus>;
  hardcoverSetSending(on: boolean): Promise<HardcoverStatus>;
  hardcoverSendAll(): Promise<HardcoverSendAll>;
  /** Problems sending a rating to Hardcover in the background. */
  onHardcoverNotice(listener: (message: string) => void): () => void;
  /** The plain text of an old Word (DOC) book. */
  bookText(bookId: string): Promise<string>;
  /** Gives a book a cover drawn here (a PDF's first page) if it has none. */
  fillCover(bookId: string, picture: Uint8Array): Promise<boolean>;
  /** Downloads a cover found online, for a book that has none. */
  fetchCover(bookId: string, url: string): Promise<boolean>;
  /** An audiobook's chapters, parts and your place in it. */
  audiobook(bookId: string): Promise<Audiobook>;
  /** Remembers where you are in an audiobook. */
  saveListening(bookId: string, positionMs: number, chapter: string | null): Promise<void>;
  /** Links an audiobook to its ebook for reading along, or unlinks it with null. */
  linkEbook(audiobookId: string, ebookId: string | null): Promise<void>;
  /** The audiobook linked to an ebook, for reading along. */
  audiobookForEbook(ebookId: string): Promise<string | null>;
  /** Where the player streams one part of an audiobook from, or null where it can't play here. */
  audioUrl(bookId: string, part: number): string | null;
  /**
   * Gets an audiobook that isn't on this device ready to play from the cloud without downloading.
   * The links to play each part from, or null to use `audioUrl`. Throws when it can't be streamed.
   */
  prepareStream(bookId: string): Promise<string[] | null>;
  /** "Use on your phone at home" (desktop app). */
  homeStatus(): Promise<HomeStatus>;
  setHome(on: boolean): Promise<HomeStatus>;
  /** A new pairing code, for another phone. */
  newHomeCode(): Promise<HomeStatus>;
  /** Every paired phone has to pair again. */
  forgetHomePhones(): Promise<HomeStatus>;
  /** Hears a phone pairing. Returns a way to stop. */
  onHomeChanged(listener: () => void): () => void;
  getProfile(): Promise<Profile>;
  /** Asks for a picture, copies it into TBV, and returns the new profile. Null if cancelled. */
  chooseAvatar(): Promise<Profile | null>;
  clearAvatar(): Promise<Profile>;
  pickBooks(): Promise<string[]>;
  pickFolder(): Promise<string[]>;
  coverUrl(path: string): string;
  /** Opens a book for reading (records when, and moves Unread to In progress). */
  openBook(bookId: string): Promise<ReaderBook>;
  /** The book file itself, for the reader's page engine. */
  readBookFile(bookId: string): Promise<Blob>;
  savePosition(bookId: string, locator: ReaderLocator): Promise<void>;
  getAnnotations(bookId: string): Promise<Annotation[]>;
  saveAnnotation(annotation: AnnotationInput): Promise<Annotation>;
  deleteAnnotation(id: string): Promise<void>;
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): Promise<void>;
  /** Quits the whole app. */
  quit(): Promise<void>;
  getCollectionsOverview(): Promise<CollectionsOverview>;
  getCollection(collection: CollectionRef): Promise<CollectionDetail>;
  createCollection(input: CollectionInput): Promise<CollectionSummary>;
  /** How many books these rules would hold. */
  countRuleMatches(rules: CollectionRules): Promise<number>;
  updateCollection(id: string, input: CollectionInput): Promise<CollectionSummary>;
  deleteCollection(id: string): Promise<void>;
  /** A gallery picture (`gallery:<name>`), a book's cover (`cover:<book id>`), or none. */
  setCollectionPicture(id: string, picture: string | null): Promise<CollectionSummary>;
  /** Asks for a picture on the computer. Null if cancelled. */
  pickCollectionPicture(): Promise<string | null>;
  /** Uses a copy of a picture on the computer for a collection. */
  setCollectionPictureFile(id: string, path: string): Promise<CollectionSummary>;
  addToCollection(id: string, bookIds: string[]): Promise<void>;
  removeFromCollection(id: string, bookId: string): Promise<void>;
  /** Moves one of your collections to a new place (zero-based) in "Your order". */
  moveCollection(id: string, toIndex: number): Promise<void>;
  moveInCollection(id: string, bookId: string, toIndex: number): Promise<void>;
  /** Ids of the user's collections a book is in. */
  collectionsForBook(bookId: string): Promise<string[]>;
  getNotes(query: NotesQuery): Promise<NotesPage>;
  /** Writes a note about a whole book; with an id, rewrites that one. */
  saveBookNote(bookId: string, id: string | null, text: string): Promise<NoteItem>;
  savePersonalNote(id: string | null, title: string | null, body: string): Promise<NoteItem>;
  /** Changes the words on a highlight. Empty words make it a plain highlight. */
  setAnnotationNote(id: string, note: string | null): Promise<NoteItem>;
  deleteNote(id: string, kind: NoteKind): Promise<void>;
  /** Where this device keeps the library, and how big it is. */
  libraryInfo(): Promise<LibraryInfo>;
  /** Asks where to save, then writes the file. False if cancelled. */
  exportLibrary(): Promise<boolean>;
  exportNotesMarkdown(): Promise<boolean>;
  createBackup(): Promise<boolean>;
  /** Asks for a backup file and replaces this device's library with it. False if cancelled. */
  restoreBackup(): Promise<boolean>;
  /** A colour from a book's cover, as #rrggbb, for Adaptive theming. */
  coverAccent(bookId: string): Promise<string | null>;
  /** Opens File Explorer at a file or folder. */
  showFolder(path: string): Promise<void>;
  syncOverview(): Promise<SyncOverview>;
  /** Asks for a sync now. Progress arrives through `onSync`. */
  syncNow(): Promise<void>;
  /** Signs in, or makes an account. False means Supabase emailed a link to confirm first. */
  syncSignIn(email: string, password: string, create: boolean): Promise<boolean>;
  syncSignOut(): Promise<void>;
  /** Saves the Supabase project to use. A different project signs out first. */
  setSupabaseProject(project: SupabaseProject | null): Promise<void>;
  /** Chooses where the library is kept. True when that folder or server already held a library to join. */
  setSyncProvider(provider: ProviderChoice): Promise<boolean>;
  /** Chooses a second place to sync with at the same time, or with null stops it. True when it already held a library. */
  setAlsoSync(provider: ProviderChoice | null): Promise<boolean>;
  /** Asks for a folder. Null if cancelled. */
  chooseFolder(title: string, start?: string | null): Promise<string | null>;
  /** Where a cloud app usually keeps its folder on this computer, if it's there. */
  suggestSyncFolder(service: string): Promise<string | null>;
  resolveSyncConflict(kind: string, key: string, keepCloud: boolean): Promise<void>;
  /** Fetches a book that's only in the cloud onto this device. */
  downloadBook(bookId: string): Promise<void>;
  /** What tidying up Supabase would remove: cloud copies of books that aren't on this computer. */
  planTidyCloud(): Promise<TidyPlan>;
  /** Tidies Supabase up, sending copies the other place lacks there first. */
  tidyCloud(onProgress: (progress: TidyProgress) => void): Promise<TidyReport>;
  supabaseUsage(): Promise<SupabaseUsage>;
  /** Every file TBV keeps in Supabase, by type. */
  supabaseContents(): Promise<StoredFile[]>;
  /** Removes the chosen files from Supabase. */
  removeSupabaseFiles(paths: string[], onProgress: (progress: TidyProgress) => void): Promise<RemoveReport>;
  /** How moving or backing up the library to another service stands. */
  moveStatus(): Promise<MoveStatus>;
  /** Signs in to a Supabase project to move to, leaving sync's own sign-in alone. False: confirm the email first. */
  moveSignIn(project: SupabaseProject, email: string, password: string, create: boolean): Promise<boolean>;
  moveSignOut(): Promise<void>;
  /** Starts copying the library to another service, in the background. Progress arrives through `onMove`. */
  startMove(mode: MoveMode, scope: MoveScope, to: ProviderChoice): Promise<void>;
  /** Runs the last move again; only what's still missing is copied. */
  retryMove(): Promise<void>;
  cancelMove(): Promise<void>;
  /** Puts away a finished move's result. */
  clearMove(): Promise<void>;
  onMove(listener: (status: MoveStatus) => void): () => void;
  /** Your tags, A to Z, with how many books carry each. */
  allTags(): Promise<TagCount[]>;
  /** Puts a tag on books. Returns the tag as kept (an existing tag keeps its spelling). */
  addTag(bookIds: string[], tag: string): Promise<string>;
  removeTag(bookIds: string[], tag: string): Promise<void>;
  /** Gives a book exactly these tags. */
  setBookTags(bookId: string, tags: string[]): Promise<void>;
  /** Takes a book out of the library on every device, with its notes. */
  /** Deletes a book for good: its notes, and its file and cover in the cloud, go too. */
  deleteBook(bookId: string): Promise<void>;
  /** Takes a book out of the library, keeping its notes and cloud file for when it's imported again. */
  removeFromLibrary(bookId: string): Promise<void>;
  /** Saves copies of the books, named "Title - Author", into a folder chosen now. Null if none was chosen. */
  saveCopies(bookIds: string[]): Promise<{ saved: number; folder: string } | null>;
  /** Removes the copy on this device, keeping the one in the cloud. */
  removeDownload(bookId: string): Promise<void>;
  findDuplicates(): Promise<DuplicateGroup[]>;
  /** A book's details in their layers, for the Book details page. */
  bookDetails(bookId: string): Promise<BookDetails>;
  /** Applies the same changes to each book. */
  editDetails(bookIds: string[], changes: DetailChange[]): Promise<void>;
  /** Takes away your edits, and with `fetched` what was fetched online too. */
  resetDetails(bookId: string, fetched: boolean): Promise<void>;
  /** Keeps details found online. Lists (authors, genres) as JSON arrays. */
  saveFetched(bookId: string, source: "google" | "openlibrary" | "audible" | "hardcover", values: Record<string, string>): Promise<void>;
  /** Looks a book up in Audible's catalogue, or on Hardcover when it's connected (desktop app). */
  searchDetailsMore(source: "audible" | "hardcover", title: string, author: string): Promise<Found[]>;
  /** Looks a series' books up online (Hardcover when connected, then Audible) and keeps the list. Desktop app. */
  findSeriesBooks(name: string, author: string): Promise<SeriesReview>;
  /** What's missing from a series, and books that probably belong to it. */
  seriesReview(name: string): Promise<SeriesReview>;
  hideSeriesBook(name: string, key: string, hidden: boolean): Promise<SeriesReview>;
  /** Puts the books in the series with their numbers, as details edits. */
  approveSeriesMatches(name: string, approvals: { bookId: string; position: number | null }[]): Promise<SeriesReview>;
  /** Remembers the books aren't in the series. */
  denySeriesMatches(name: string, bookIds: string[]): Promise<SeriesReview>;
  /** Remembers that a group isn't duplicates, so it isn't shown again. */
  dismissDuplicates(key: string): Promise<void>;
  /** E-readers plugged in by cable now. */
  listEreaders(): Promise<Ereader[]>;
  /** Copies a book onto the reader plugged in at `root`. The library's copy is never changed. */
  copyToEreader(bookId: string, root: string): Promise<CopiedToEreader>;
  /** Kindle by email, if it's set up on this device. */
  kindleEmailSettings(): Promise<KindleEmailView | null>;
  saveKindleEmail(settings: KindleEmailInput): Promise<KindleEmailView>;
  forgetKindleEmail(): Promise<void>;
  /** Emails a book to the person's Kindle. */
  sendToKindle(bookId: string): Promise<void>;
  /** Emails a small test document to the Kindle with the saved settings. */
  sendKindleTest(): Promise<void>;
  /** Servers to import from (FTP, FTPS, SFTP), saved on this device. */
  listServers(): Promise<ServerView[]>;
  saveServer(server: ServerInput): Promise<ServerView>;
  removeServer(id: string): Promise<void>;
  /** Remembers an SFTP server's key once the person has said it's theirs. */
  trustServerKey(id: string, fingerprint: string): Promise<ServerView>;
  /** Connects and says what's there. A new SFTP server fails with `new-host-key:<fingerprint>`. */
  testServer(id: string): Promise<string>;
  /** A folder on the server; null is where browsing starts. */
  browseServer(id: string, path: string | null): Promise<ServerListing>;
  /** Lists every file in what was ticked and starts bringing them down; each joins the import queue as it arrives. */
  downloadFromServer(id: string, chosen: ServerChoice[]): Promise<void>;
  serverQueue(): Promise<ServerQueueView>;
  /** Rows of the server list, in the order they were chosen. */
  serverQueuePage(offset: number, limit: number): Promise<QueuedServerFile[]>;
  retryServerFile(id: number): Promise<void>;
  removeServerFile(id: number): Promise<void>;
  /** Takes everything not yet down off the list. */
  cancelServerQueue(): Promise<void>;
  clearServerFinished(): Promise<void>;
  /** How many files come down at once, 1 to 5. */
  setServerConnections(count: number): Promise<void>;
  onServerQueue(listener: () => void): () => void;
  localSendStatus(): Promise<LocalSendStatus>;
  /** Switches receiving from LocalSend on or off. */
  setLocalSend(on: boolean): Promise<LocalSendStatus>;
  answerLocalSend(session: string, accept: boolean): Promise<void>;
  /** Someone nearby wants to send files; answer with `answerLocalSend`. */
  onLocalSendOffer(listener: (offer: LocalSendOffer) => void): () => void;
  /** Every file sent with LocalSend this run, newest delivery first. */
  localSendFiles(): Promise<SentFile[]>;
  clearLocalSendFinished(): Promise<void>;
  /** A sent file's state or progress changed. */
  onLocalSendChanged(listener: () => void): () => void;
  /** A private key file, for SFTP. */
  pickKeyFile(): Promise<string | null>;
  /** What sync is doing now, file by file, and what it did lately. */
  syncActivity(): Promise<SyncActivity>;
  /** Hears the activity now, then each change to it. Returns a way to stop. */
  onSyncActivity(listener: (activity: SyncActivity) => void): () => void;
  /** Hears sync starting and finishing, and library changes it brings. Returns a way to stop. */
  onSync(listener: { status?: (status: SyncStatus) => void; libraryChanged?: () => void }): () => void;
}

export const isApp = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
/** The pages TBV on the computer serves to a phone at home (Settings › Sync › Use on your phone at home). */
export const isHome = !isApp && typeof document !== "undefined" && !!document.querySelector('meta[name="tbv-home"]');
/** The web version, for phones: built with `npm run build:web`, syncing through Supabase. */
export const isWeb = !isApp && import.meta.env.VITE_TBV_WEB === "1";

const BOOK_EXTENSIONS = ["epub", "pdf", "mobi", "azw", "azw3", "fb2", "fbz", "cbz", "cbr", "txt", "docx", "doc"];

// At home on the phone there's no app window to hear events from.
const tauriEvents = () => (isHome ? Promise.resolve(homeEvents) : import("@tauri-apps/api/event")) as Promise<typeof import("@tauri-apps/api/event")>;

/** Listens for one of the app's events until the returned function is called. */
function onEvent<T>(name: string, listener: (payload: T) => void): () => void {
  let stop: (() => void) | null = null;
  let stopped = false;
  void tauriEvents().then(async ({ listen }) => {
    const unlisten = await listen<T>(name, (e) => listener(e.payload));
    if (stopped) unlisten();
    else stop = unlisten;
  });
  return () => {
    stopped = true;
    stop?.();
  };
}

function appApi(): Api {
  // Loaded lazily so the browser preview never touches Tauri internals.
  const core = (isHome ? Promise.resolve(homeCore) : import("@tauri-apps/api/core")) as Promise<typeof import("@tauri-apps/api/core")>;
  const dialog = import("@tauri-apps/plugin-dialog");
  let convert: ((path: string) => string) | null = null;
  void core.then((c) => (convert = c.convertFileSrc));

  const asList = (picked: string | string[] | null) =>
    picked === null ? [] : Array.isArray(picked) ? picked : [picked];
  const today = () => new Date().toISOString().slice(0, 10);
  const saveTo = async (command: string, title: string, defaultPath: string, name: string, extensions: string[]) => {
    const path = await (await dialog).save({ title, defaultPath, filters: [{ name, extensions }] });
    if (!path) return false;
    await (await core).invoke(command, { path });
    return true;
  };

  return {
    kind: "app",
    getHome: async () => (await core).invoke<HomeViewModel>("get_home"),
    queueImports: async (paths) => (await core).invoke<number>("queue_imports", { paths }),
    importQueue: async () => (await core).invoke<ImportsView>("import_queue"),
    takePdfCovers: async () => (await core).invoke<string[]>("take_pdf_covers"),
    cancelImports: async () => (await core).invoke<void>("cancel_imports"),
    clearFinishedImports: async () => (await core).invoke<void>("clear_finished_imports"),
    syncActivity: async () => (await core).invoke<SyncActivity>("sync_activity"),
    onSyncActivity: (listener) => {
      let stop: (() => void) | null = null;
      let stopped = false;
      void tauriEvents().then(async ({ listen }) => {
        let heard = false;
        const unlisten = await listen<SyncActivity>("sync-activity", (e) => {
          heard = true;
          listener(e.payload);
        });
        if (stopped) return unlisten();
        stop = unlisten;
        // The snapshot is asked for only once updates are heard, so none slips between
        // the two, and it's dropped if an update has already arrived.
        const snapshot = await (await core).invoke<SyncActivity>("sync_activity").catch(() => null);
        if (snapshot && !heard && !stopped) listener(snapshot);
      });
      return () => {
        stopped = true;
        stop?.();
      };
    },
    onImports: (listener) => {
      let stop: (() => void) | null = null;
      let stopped = false;
      void tauriEvents().then(async ({ listen }) => {
        const unlisten = await listen<ImportsView>("imports-changed", (e) => listener(e.payload));
        if (stopped) unlisten();
        else stop = unlisten;
      });
      return () => {
        stopped = true;
        stop?.();
      };
    },
    setBookStatus: async (bookId, status) => (await core).invoke("set_book_status", { bookId, status }),
    getLibrary: async (query) => (await core).invoke<LibraryPage>("get_library", { query }),
    getCollections: async () => (await core).invoke<CollectionPreview[]>("get_collections"),
    setFavorite: async (bookId, favorite) => (await core).invoke("set_favorite", { bookId, favorite }),
    setWantToRead: async (bookId, want) => (await core).invoke("set_want_to_read", { bookId, want }),
    setPhoneWanted: async (bookIds, wanted) => (await core).invoke("set_phone_wanted", { bookIds, wanted }),
    setRating: async (bookId, rating) => (await core).invoke("set_rating", { bookId, rating }),
    importGoodreads: async () => {
      const [path] = asList(
        await (await dialog).open({
          multiple: false,
          title: "Import your Goodreads export",
          filters: [{ name: "Goodreads export", extensions: ["csv"] }],
        }),
      );
      return path ? (await core).invoke<GoodreadsImport>("import_goodreads", { path }) : null;
    },
    exportGoodreads: async () => {
      const path = await (await dialog).save({
        title: "Export for Goodreads",
        defaultPath: `TBV for Goodreads ${today()}.csv`,
        filters: [{ name: "Goodreads file", extensions: ["csv"] }],
      });
      return path ? (await core).invoke<number>("export_goodreads", { path }) : null;
    },
    hardcoverStatus: async () => (await core).invoke<HardcoverStatus>("hardcover_status"),
    hardcoverSignIn: async () => (await core).invoke<HardcoverStatus>("hardcover_sign_in"),
    hardcoverSignOut: async () => (await core).invoke<HardcoverStatus>("hardcover_sign_out"),
    hardcoverSetSending: async (on) => (await core).invoke<HardcoverStatus>("hardcover_set_sending", { on }),
    hardcoverSendAll: async () => (await core).invoke<HardcoverSendAll>("hardcover_send_all"),
    onHardcoverNotice: (listener) => {
      let stop: (() => void) | null = null;
      let stopped = false;
      void tauriEvents().then(async ({ listen }) => {
        const unlisten = await listen<{ message: string }>("hardcover-notice", (e) => listener(e.payload.message));
        if (stopped) unlisten();
        else stop = unlisten;
      });
      return () => {
        stopped = true;
        stop?.();
      };
    },
    bookText: async (bookId) => (await core).invoke<string>("book_text", { bookId }),
    fillCover: async (bookId, picture) => (await core).invoke<boolean>("fill_cover", picture, { headers: { "book-id": bookId } }),
    fetchCover: async (bookId, url) => (await core).invoke<boolean>("fetch_cover", { bookId, url }),
    audiobook: async (bookId) => (await core).invoke<Audiobook>("audiobook", { bookId }),
    saveListening: async (bookId, positionMs, chapter) =>
      (await core).invoke("save_listening", { bookId, positionMs: Math.max(0, Math.round(positionMs)), chapter }),
    linkEbook: async (audiobookId, ebookId) => (await core).invoke("link_ebook", { audiobookId, ebookId }),
    audiobookForEbook: async (ebookId) => (await core).invoke<string | null>("audiobook_for_ebook", { ebookId }),
    // Windows and Android reach custom schemes through http://<scheme>.localhost.
    prepareStream: async (bookId) => {
      await (await core).invoke("prepare_stream", { bookId });
      return null;
    },
    homeStatus: async () => (await core).invoke<HomeStatus>("home_status"),
    setHome: async (on) => (await core).invoke<HomeStatus>("set_home", { on }),
    newHomeCode: async () => (await core).invoke<HomeStatus>("new_home_code"),
    forgetHomePhones: async () => (await core).invoke<HomeStatus>("forget_home_phones"),
    onHomeChanged: (listener) => onEvent<null>("home-changed", () => listener()),
    audioUrl: (bookId, part) =>
      isHome
        ? homeAudioUrl(bookId, part)
        : `${/windows|android/i.test(navigator.userAgent) ? "http://tbvaudio.localhost" : "tbvaudio://localhost"}/${encodeURIComponent(bookId)}/${part}`,
    getProfile: async () => (await core).invoke<Profile>("get_profile"),
    chooseAvatar: async () => {
      const [path] = asList(
        await (await dialog).open({
          multiple: false,
          title: "Choose a profile picture",
          filters: [{ name: "Pictures", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }],
        }),
      );
      return path ? (await core).invoke<Profile>("set_avatar", { path }) : null;
    },
    clearAvatar: async () => (await core).invoke<Profile>("clear_avatar"),
    pickBooks: async () =>
      asList(
        await (await dialog).open({
          multiple: true,
          title: "Import books",
          filters: [{ name: "Books", extensions: BOOK_EXTENSIONS }],
        }),
      ),
    pickFolder: async () =>
      asList(await (await dialog).open({ directory: true, multiple: false, title: "Import a folder of books" })),
    coverUrl: (path) => (convert ? convert(path) : ""),
    openBook: async (bookId) => (await core).invoke<ReaderBook>("open_book", { bookId }),
    readBookFile: async (bookId) => {
      // Raw bytes normally arrive as an ArrayBuffer, but if Tauri has to fall
      // back to its slower message channel they come as a list of numbers.
      const bytes = await (await core).invoke<ArrayBuffer | number[]>("read_book_file", { bookId });
      return new Blob([Array.isArray(bytes) ? new Uint8Array(bytes) : bytes]);
    },
    savePosition: async (bookId, locator) => (await core).invoke("save_position", { bookId, locator }),
    getAnnotations: async (bookId) => (await core).invoke<Annotation[]>("get_annotations", { bookId }),
    saveAnnotation: async (annotation) => (await core).invoke<Annotation>("save_annotation", { annotation }),
    deleteAnnotation: async (id) => (await core).invoke("delete_annotation", { id }),
    getSetting: async (key) => (await core).invoke<string | null>("get_setting", { key }),
    setSetting: async (key, value) => (await core).invoke("set_setting", { key, value }),
    quit: async () => (await core).invoke("quit_app"),
    getCollectionsOverview: async () => (await core).invoke<CollectionsOverview>("get_collections_overview"),
    getCollection: async (collection) => (await core).invoke<CollectionDetail>("get_collection", { collection }),
    createCollection: async (input) => (await core).invoke<CollectionSummary>("create_collection", { input }),
    countRuleMatches: async (rules) => (await core).invoke<number>("count_rule_matches", { rules }),
    updateCollection: async (id, input) => (await core).invoke<CollectionSummary>("update_collection", { id, input }),
    deleteCollection: async (id) => (await core).invoke("delete_collection", { id }),
    setCollectionPicture: async (id, picture) =>
      (await core).invoke<CollectionSummary>("set_collection_picture", { id, picture }),
    pickCollectionPicture: async () => {
      const [path] = asList(
        await (await dialog).open({
          multiple: false,
          title: "Choose a picture for this collection",
          filters: [{ name: "Pictures", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }],
        }),
      );
      return path ?? null;
    },
    setCollectionPictureFile: async (id, path) => (await core).invoke<CollectionSummary>("set_collection_picture_file", { id, path }),
    addToCollection: async (id, bookIds) => (await core).invoke("add_to_collection", { id, bookIds }),
    removeFromCollection: async (id, bookId) => (await core).invoke("remove_from_collection", { id, bookId }),
    moveCollection: async (id, toIndex) => (await core).invoke("move_collection", { id, toIndex }),
    moveInCollection: async (id, bookId, toIndex) => (await core).invoke("move_in_collection", { id, bookId, toIndex }),
    collectionsForBook: async (bookId) => (await core).invoke<string[]>("collections_for_book", { bookId }),
    getNotes: async (query) => (await core).invoke<NotesPage>("get_notes", { query }),
    saveBookNote: async (bookId, id, text) => (await core).invoke<NoteItem>("save_book_note", { bookId, id, text }),
    savePersonalNote: async (id, title, body) => (await core).invoke<NoteItem>("save_personal_note", { id, title, body }),
    setAnnotationNote: async (id, note) => (await core).invoke<NoteItem>("set_annotation_note", { id, note }),
    deleteNote: async (id, kind) => (await core).invoke("delete_note", { id, kind }),
    libraryInfo: async () => (await core).invoke<LibraryInfo>("library_info"),
    exportLibrary: () => saveTo("export_library", "Export library data", `TBV library ${today()}.json`, "JSON", ["json"]),
    exportNotesMarkdown: () => saveTo("export_notes_markdown", "Export notes", `TBV notes ${today()}.md`, "Markdown", ["md"]),
    createBackup: () => saveTo("create_backup", "Create a backup", `TBV backup ${today()}.tbvbackup`, "TBV backup", ["tbvbackup"]),
    restoreBackup: async () => {
      const [path] = asList(
        await (await dialog).open({
          multiple: false,
          title: "Restore from a backup",
          filters: [{ name: "TBV backup", extensions: ["tbvbackup", "db", "sqlite"] }],
        }),
      );
      if (!path) return false;
      await (await core).invoke("restore_backup", { path });
      return true;
    },
    coverAccent: async (bookId) => (await core).invoke<string | null>("cover_accent", { bookId }),
    showFolder: async (path) => (await core).invoke("show_folder", { path }),
    syncOverview: async () => (await core).invoke<SyncOverview>("sync_overview"),
    syncNow: async () => (await core).invoke("sync_now"),
    syncSignIn: async (email, password, create) => (await core).invoke<boolean>("sync_sign_in", { email, password, create }),
    syncSignOut: async () => (await core).invoke("sync_sign_out"),
    setSupabaseProject: async (project) => (await core).invoke("set_supabase_project", { project }),
    setSyncProvider: async (provider) => (await core).invoke<boolean>("set_sync_provider", { provider }),
    setAlsoSync: async (provider) => (await core).invoke<boolean>("set_also_sync", { provider }),
    chooseFolder: async (title, start) => {
      const picked = await (await dialog).open({ directory: true, multiple: false, title, defaultPath: start ?? undefined });
      return typeof picked === "string" ? picked : null;
    },
    suggestSyncFolder: async (service) => (await core).invoke<string | null>("suggest_sync_folder", { service }),
    resolveSyncConflict: async (kind, key, keepCloud) => (await core).invoke("resolve_sync_conflict", { kind, key, keepCloud }),
    downloadBook: async (bookId) => (await core).invoke("download_book", { bookId }),
    moveStatus: async () => (await core).invoke<MoveStatus>("move_status"),
    moveSignIn: async (project, email, password, create) =>
      (await core).invoke<boolean>("move_sign_in", { project, email, password, create }),
    moveSignOut: async () => (await core).invoke("move_sign_out"),
    planTidyCloud: async () => (await core).invoke("plan_tidy_cloud"),
    supabaseUsage: async () => (await core).invoke("supabase_usage"),
    supabaseContents: async () => (await core).invoke("supabase_contents"),
    removeSupabaseFiles: async (paths, onProgress) => {
      const { listen } = await tauriEvents();
      const stop = await listen<TidyProgress>("tidy-progress", (e) => onProgress(e.payload));
      try {
        return await (await core).invoke<RemoveReport>("remove_supabase_files", { paths });
      } finally {
        stop();
      }
    },
    tidyCloud: async (onProgress) => {
      const { listen } = await tauriEvents();
      const stop = await listen<TidyProgress>("tidy-progress", (e) => onProgress(e.payload));
      try {
        return await (await core).invoke<TidyReport>("tidy_cloud");
      } finally {
        stop();
      }
    },
    startMove: async (mode, scope, to) => (await core).invoke("start_move", { mode, scope, to }),
    retryMove: async () => (await core).invoke("retry_move"),
    cancelMove: async () => (await core).invoke("cancel_move"),
    clearMove: async () => (await core).invoke("clear_move"),
    onMove: (listener) => {
      let stop: (() => void) | null = null;
      let stopped = false;
      void tauriEvents().then(async ({ listen }) => {
        const unlisten = await listen<MoveStatus>("move-changed", (e) => listener(e.payload));
        if (stopped) unlisten();
        else stop = unlisten;
      });
      return () => {
        stopped = true;
        stop?.();
      };
    },
    allTags: async () => (await core).invoke<TagCount[]>("all_tags"),
    addTag: async (bookIds, tag) => (await core).invoke<string>("add_tag", { bookIds, tag }),
    removeTag: async (bookIds, tag) => (await core).invoke("remove_tag", { bookIds, tag }),
    setBookTags: async (bookId, tags) => (await core).invoke("set_book_tags", { bookId, tags }),
    deleteBook: async (bookId) => (await core).invoke("delete_book", { bookId }),
    removeFromLibrary: async (bookId) => (await core).invoke("remove_from_library", { bookId }),
    saveCopies: async (bookIds) => {
      const picked = await (await dialog).open({ directory: true, multiple: false, title: "Save copies to this folder" });
      if (typeof picked !== "string") return null;
      const saved = await (await core).invoke<number>("save_copies", { bookIds, folder: picked });
      return { saved, folder: picked };
    },
    removeDownload: async (bookId) => (await core).invoke("remove_download", { bookId }),
    findDuplicates: async () => (await core).invoke<DuplicateGroup[]>("find_duplicates"),
    dismissDuplicates: async (key) => (await core).invoke("dismiss_duplicates", { key }),
    bookDetails: async (bookId) => (await core).invoke<BookDetails>("book_details", { bookId }),
    editDetails: async (bookIds, changes) => (await core).invoke("edit_details", { bookIds, changes }),
    resetDetails: async (bookId, fetched) => (await core).invoke("reset_details", { bookId, fetched }),
    saveFetched: async (bookId, source, values) => (await core).invoke("save_fetched", { bookId, source, values }),
    listEreaders: async () => (await core).invoke<Ereader[]>("list_ereaders"),
    copyToEreader: async (bookId, root) => (await core).invoke<CopiedToEreader>("copy_to_ereader", { bookId, root }),
    kindleEmailSettings: async () => (await core).invoke<KindleEmailView | null>("kindle_email_settings"),
    saveKindleEmail: async (settings) => (await core).invoke<KindleEmailView>("save_kindle_email", { settings }),
    forgetKindleEmail: async () => (await core).invoke("forget_kindle_email"),
    sendToKindle: async (bookId) => (await core).invoke("send_to_kindle", { bookId }),
    sendKindleTest: async () => (await core).invoke("send_kindle_test"),
    listServers: async () => (await core).invoke<ServerView[]>("list_servers"),
    saveServer: async (server) => (await core).invoke<ServerView>("save_server", { server }),
    removeServer: async (id) => (await core).invoke("remove_server", { id }),
    trustServerKey: async (id, fingerprint) => (await core).invoke<ServerView>("trust_server_key", { id, fingerprint }),
    testServer: async (id) => (await core).invoke<string>("test_server", { id }),
    browseServer: async (id, path) => (await core).invoke<ServerListing>("browse_server", { id, path }),
    downloadFromServer: async (id, chosen) => (await core).invoke("download_from_server", { id, chosen }),
    serverQueue: async () => (await core).invoke<ServerQueueView>("server_queue"),
    serverQueuePage: async (offset, limit) => (await core).invoke<QueuedServerFile[]>("server_queue_page", { offset, limit }),
    retryServerFile: async (id) => (await core).invoke("retry_server_file", { id }),
    removeServerFile: async (id) => (await core).invoke("remove_server_file", { id }),
    cancelServerQueue: async () => (await core).invoke("cancel_server_queue"),
    clearServerFinished: async () => (await core).invoke("clear_server_finished"),
    setServerConnections: async (count) => (await core).invoke("set_server_connections", { count }),
    searchDetailsMore: async (source, title, author) => (await core).invoke<Found[]>("search_details_more", { source, title, author }),
    findSeriesBooks: async (name, author) => (await core).invoke<SeriesReview>("find_series_books", { name, author }),
    seriesReview: async (name) => (await core).invoke<SeriesReview>("series_review", { name }),
    hideSeriesBook: async (name, key, hidden) => (await core).invoke<SeriesReview>("hide_series_book", { name, key, hidden }),
    approveSeriesMatches: async (name, approvals) => (await core).invoke<SeriesReview>("approve_series_matches", { name, approvals }),
    denySeriesMatches: async (name, bookIds) => (await core).invoke<SeriesReview>("deny_series_matches", { name, bookIds }),
    localSendStatus: async () => (await core).invoke<LocalSendStatus>("localsend_status"),
    setLocalSend: async (on) => (await core).invoke<LocalSendStatus>("set_localsend", { on }),
    answerLocalSend: async (session, accept) => (await core).invoke("answer_localsend", { session, accept }),
    onLocalSendOffer: (listener) => onEvent<LocalSendOffer>("localsend-offer", listener),
    localSendFiles: async () => (await core).invoke<SentFile[]>("localsend_files"),
    clearLocalSendFinished: async () => (await core).invoke("clear_localsend_finished"),
    onLocalSendChanged: (listener) => onEvent<null>("localsend-changed", () => listener()),
    onServerQueue: (listener) => {
      let stop: (() => void) | null = null;
      let stopped = false;
      void tauriEvents().then(async ({ listen }) => {
        const unlisten = await listen("server-queue-changed", () => listener());
        if (stopped) unlisten();
        else stop = unlisten;
      });
      return () => {
        stopped = true;
        stop?.();
      };
    },
    pickKeyFile: async () => {
      const picked = await (await dialog).open({ multiple: false, title: "Choose your private key file" });
      return typeof picked === "string" ? picked : null;
    },
    onSync: ({ status, libraryChanged }) => {
      const stops: (() => void)[] = [];
      let stopped = false;
      void tauriEvents().then(async ({ listen }) => {
        const add = (stop: () => void) => (stopped ? stop() : stops.push(stop));
        if (status) add(await listen<SyncStatus>("sync-status", (e) => status(e.payload)));
        if (libraryChanged) add(await listen("library-changed", () => libraryChanged()));
      });
      return () => {
        stopped = true;
        stops.forEach((stop) => stop());
      };
    },
  };
}

/** Opens a web link in the person's browser, never inside TBV. */
export async function openExternal(url: string): Promise<void> {
  if (!/^https?:\/\//i.test(url)) return;
  if (isApp) await (await import("@tauri-apps/plugin-opener")).openUrl(url);
  else window.open(url, "_blank", "noopener");
}

export const api: Api = isApp || isHome
  ? appApi()
  : isWeb
    ? await (await import("../web/webApi")).webApi()
    : (await import("./preview")).previewApi();

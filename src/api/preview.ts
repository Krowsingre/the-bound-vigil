// Sample data for looking at screens in an ordinary browser while designing.
// It is never used inside the desktop app (see api/index.ts), and the shell
// shows a "Preview" badge whenever it is active.

import type { Api } from "./index";
import { previewCollections } from "../preview/collections";
import { previewNotes, sampleAnnotations } from "../preview/notes";
import { sampleEpub } from "../preview/sampleEpub";
import type {
  Annotation,
  BookPreview,
  HomeViewModel,
  ImportResult,
  LibraryPage,
  LibraryQuery,
  Profile,
  SyncOverview,
} from "./types";

const day = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * day).toISOString();

let next = 1;
function book(title: string, author: string, extra: Partial<BookPreview> = {}): BookPreview {
  const n = next++;
  return {
    id: `sha256:${n.toString(16).padStart(64, "0")}`,
    title,
    authors: [author],
    coverPath: null,
    format: "epub",
    synopsis: null,
    series: null,
    seriesIndex: null,
    addedAt: ago(n * 1.7),
    lastOpenedAt: null,
    status: "unread",
    totalProgression: null,
    resumeLocator: null,
    availability: "local",
    remotePositions: [],
    favorite: false,
    wantToRead: false,
    ...extra,
  };
}

const reading = (p: number, daysAgo: number): Partial<BookPreview> => ({
  status: "in_progress",
  totalProgression: p,
  lastOpenedAt: ago(daysAgo),
});

let books: BookPreview[] = [
  book("The Count of Monte Cristo", "Alexandre Dumas", {
    ...reading(0.42, 0.1),
    favorite: true,
    synopsis:
      "Wrongly imprisoned on the eve of his wedding, Edmond Dantès escapes after fourteen years and returns as the wealthy Count, set on repaying every debt.",
    remotePositions: [{ deviceName: "Phone", totalProgression: 0.47, at: ago(0.5) }],
  }),
  book("Middlemarch", "George Eliot", reading(0.18, 2)),
  book("The Moonstone", "Wilkie Collins", reading(0.71, 5)),
  book("Frankenstein", "Mary Shelley", { availability: "cloud", wantToRead: true }),
  book("Jane Eyre", "Charlotte Brontë", { favorite: true }),
  book("Moby-Dick", "Herman Melville", { status: "read", totalProgression: 1, lastOpenedAt: ago(30) }),
  book("The Picture of Dorian Gray", "Oscar Wilde", { wantToRead: true }),
  book("A Study in Scarlet", "Arthur Conan Doyle", { series: "Sherlock Holmes", seriesIndex: 1, status: "read", totalProgression: 1 }),
  book("The Sign of the Four", "Arthur Conan Doyle", { series: "Sherlock Holmes", seriesIndex: 2, ...reading(0.33, 9) }),
  book("The Hound of the Baskervilles", "Arthur Conan Doyle", { series: "Sherlock Holmes", seriesIndex: 5 }),
  book("The Warden", "Anthony Trollope", { series: "Chronicles of Barsetshire", seriesIndex: 1 }),
  book("Barchester Towers", "Anthony Trollope", { series: "Chronicles of Barsetshire", seriesIndex: 2, wantToRead: true }),
  book("Dracula", "Bram Stoker", { favorite: true, status: "read", totalProgression: 1 }),
  book("Wuthering Heights", "Emily Brontë"),
  book("Persuasion", "Jane Austen", { favorite: true }),
  book("Emma", "Jane Austen"),
  book("Great Expectations", "Charles Dickens", { status: "read", totalProgression: 1 }),
  book("Bleak House", "Charles Dickens", { wantToRead: true }),
  book("The Woman in White", "Wilkie Collins"),
  book("North and South", "Elizabeth Gaskell"),
  book("The Turn of the Screw", "Henry James", { format: "pdf" }),
  book("Little Women", "Louisa May Alcott"),
  book("The Time Machine", "H. G. Wells", { status: "read", totalProgression: 1 }),
  book("The War of the Worlds", "H. G. Wells"),
  book("Twenty Thousand Leagues Under the Seas", "Jules Verne", { availability: "cloud" }),
  book("Around the World in Eighty Days", "Jules Verne"),
  book("Little Nemo in Slumberland", "Winsor McCay", { format: "cbz" }),
  book("The Secret Garden", "Frances Hodgson Burnett"),
  book("Anna Karenina", "Leo Tolstoy", { wantToRead: true }),
  book("The Brothers Karamazov", "Fyodor Dostoevsky"),
  book("Crime and Punishment", "Fyodor Dostoevsky", { status: "read", totalProgression: 1 }),
  book("A Tale of Two Cities", "Charles Dickens"),
];

const params = new URLSearchParams(location.search);
const empty = params.has("empty");
// `?avatar` shows a stand-in profile picture, for reviewing the sync circle.
const SAMPLE_AVATAR =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x2="0" y2="1"><stop offset="0" stop-color="#8fa3b5"/><stop offset="1" stop-color="#2f3a44"/></linearGradient></defs><rect width="64" height="64" fill="url(#g)"/><circle cx="32" cy="26" r="11" fill="#e6e3de"/><path d="M12 64c2-14 10-20 20-20s18 6 20 20z" fill="#e6e3de"/></svg>`,
  );
const library = () => (empty ? [] : books);
const collections = previewCollections(library, empty);
let annotations: Annotation[] = empty ? [] : sampleAnnotations(books);
const notes = previewNotes(library, { get: () => annotations, set: (list) => (annotations = list) }, empty);

const articles = /^(the|an|a) /i;
const sortTitle = (b: BookPreview) => b.title.replace(articles, "").toLowerCase();
const byTitle = (a: BookPreview, b: BookPreview) => sortTitle(a).localeCompare(sortTitle(b));
const nullsLast = <T>(a: T | null, b: T | null, cmp: (x: T, y: T) => number) =>
  a === null ? (b === null ? 0 : 1) : b === null ? -1 : cmp(a, b);

/** Mirrors the core's Library query closely enough for design previews. */
function queryBooks(all: BookPreview[], q: LibraryQuery): LibraryPage {
  const search = q.search?.trim().toLowerCase();
  let list = all.filter((b) => {
    if (q.shelf === "favorites" && !b.favorite) return false;
    if (q.shelf === "want_to_read" && !b.wantToRead) return false;
    if ((q.shelf === "in_progress" || q.shelf === "read" || q.shelf === "unread") && b.status !== q.shelf) return false;
    if (q.formats.length && !q.formats.includes(b.format)) return false;
    if (q.location === "on_device" && b.availability === "cloud") return false;
    if (q.location === "cloud_only" && b.availability !== "cloud") return false;
    if (search && ![b.title, ...b.authors, b.series ?? ""].some((t) => t.toLowerCase().includes(search))) return false;
    return true;
  });
  const sorters: Record<LibraryQuery["sort"], (a: BookPreview, b: BookPreview) => number> = {
    recently_added: (a, b) => b.addedAt.localeCompare(a.addedAt),
    recently_opened: (a, b) =>
      nullsLast(a.lastOpenedAt, b.lastOpenedAt, (x, y) => y.localeCompare(x)) || b.addedAt.localeCompare(a.addedAt),
    title: byTitle,
    author: (a, b) => (a.authors[0] ?? "").localeCompare(b.authors[0] ?? "") || byTitle(a, b),
    series: (a, b) =>
      nullsLast(a.series, b.series, (x, y) => x.localeCompare(y)) ||
      nullsLast(a.seriesIndex, b.seriesIndex, (x, y) => x - y) ||
      byTitle(a, b),
    progress: (a, b) => (b.totalProgression ?? 0) - (a.totalProgression ?? 0) || byTitle(a, b),
  };
  list = [...list].sort(sorters[q.sort]);
  const pageSize = q.pageSize || 24;
  const page = Math.min(q.page, Math.max(0, Math.ceil(list.length / pageSize) - 1));
  return {
    books: list.slice(page * pageSize, (page + 1) * pageSize),
    total: list.length,
    page,
    pageSize,
    counts: {
      all: all.length,
      favorites: all.filter((b) => b.favorite).length,
      wantToRead: all.filter((b) => b.wantToRead).length,
      inProgress: all.filter((b) => b.status === "in_progress").length,
      read: all.filter((b) => b.status === "read").length,
      unread: all.filter((b) => b.status === "unread").length,
      collections: collections.previews().length,
    },
    formats: [...new Set(all.map((b) => b.format))].sort(),
  };
}

function home(): HomeViewModel {
  const all = library();
  const inProgress = all
    .filter((b) => b.status === "in_progress")
    .sort((a, b) => (b.lastOpenedAt ?? "").localeCompare(a.lastOpenedAt ?? ""));
  return {
    resumeBook: inProgress[0] ?? null,
    recentlyAdded: [...all].sort((a, b) => b.addedAt.localeCompare(a.addedAt)).slice(0, 5),
    inProgress: inProgress.slice(0, 3),
    collections: collections.previews().slice(0, 4),
    annotations: empty
      ? []
      : [
          {
            id: "a1",
            bookId: books[0].id,
            bookTitle: books[0].title,
            kind: "highlight",
            excerpt: "All human wisdom is contained in these two words: wait and hope.",
            note: null,
            locator: {},
            updatedAt: ago(0.2),
          },
          {
            id: "a2",
            bookId: books[1].id,
            bookTitle: books[1].title,
            kind: "note",
            excerpt: "the growing good of the world is partly dependent on unhistoric acts",
            note: "Use as the epigraph?",
            locator: {},
            updatedAt: ago(3),
          },
        ],
    libraryCounts: {
      total: all.length,
      unread: all.filter((b) => b.status === "unread").length,
      inProgress: inProgress.length,
      read: all.filter((b) => b.status === "read").length,
    },
    activity: null,
    sync: previewSync().status,
  };
}

const update = (bookId: string, change: Partial<BookPreview>) => {
  books = books.map((b) => (b.id === bookId ? { ...b, ...change } : b));
};

function previewSync(): SyncOverview {
  const mode = params.get("sync");
  if (!mode) return { status: { state: "disabled", lastSuccessAt: null }, project: null, signedInAs: null, lastError: null, waitingToSend: 0, conflicts: [] };
  return {
    status: { state: mode === "ask" ? "attention" : "idle", lastSuccessAt: ago(0.002) },
    project: { url: "https://abcdefghijklmnop.supabase.co", anonKey: "sb_publishable_sample" },
    signedInAs: "reader@example.com",
    lastError: null,
    waitingToSend: 2,
    conflicts:
      mode === "ask"
        ? [
            {
              kind: "book_progress",
              key: '["x"]',
              what: "Reading progress in Dracula",
              here: "in progress, 42% through",
              cloud: "in progress, 61% through",
              cloudChangedAt: ago(0.1),
            },
          ]
        : [],
  };
}

export function previewApi(): Api {
  let sync = previewSync();
  let profile: Profile = { avatarPath: params.has("avatar") ? SAMPLE_AVATAR : null };
  const settings = new Map<string, string>();
  const find = (bookId: string) => {
    const b = books.find((x) => x.id === bookId);
    if (!b) throw new Error("This book is no longer in your library.");
    return b;
  };
  return {
    kind: "preview",
    getHome: async () => home(),
    importBooks: async (paths): Promise<ImportResult[]> => paths.map((path) => ({ outcome: "unsupported", path })),
    setBookStatus: async (bookId, status) =>
      update(bookId, status === "unread" ? { status, totalProgression: null } : { status }),
    getLibrary: async (query) => queryBooks(library(), query),
    getCollections: async () => collections.previews(),
    setFavorite: async (bookId, favorite) => update(bookId, { favorite }),
    setWantToRead: async (bookId, wantToRead) => update(bookId, { wantToRead }),
    getProfile: async () => profile,
    chooseAvatar: async () => null,
    clearAvatar: async () => (profile = { avatarPath: null }),
    pickBooks: async () => [],
    pickFolder: async () => [],
    coverUrl: (path) => (path.startsWith("data:") ? path : ""),
    openBook: async (bookId) => {
      const before = find(bookId);
      update(bookId, { lastOpenedAt: new Date().toISOString(), status: before.status === "unread" ? "in_progress" : before.status });
      return { book: find(bookId), publisher: "Sample Press", language: "en", fileSize: 48_000, previouslyOpenedAt: before.lastOpenedAt };
    },
    readBookFile: async (bookId) => {
      const b = find(bookId);
      return sampleEpub(b.title, b.authors.join(", "));
    },
    savePosition: async (bookId, locator) => update(bookId, { resumeLocator: locator, totalProgression: locator.totalProgression ?? null }),
    getAnnotations: async (bookId) => annotations.filter((a) => a.bookId === bookId && (a.kind as string) !== "book_note"),
    saveAnnotation: async (input) => {
      const now = new Date().toISOString();
      const old = annotations.find((a) => a.id === input.id);
      const saved: Annotation = {
        id: input.id ?? `preview-${Math.random().toString(36).slice(2)}`,
        bookId: input.bookId,
        kind: input.kind,
        excerpt: input.excerpt,
        note: input.note?.trim() || null,
        color: input.color ?? null,
        locator: input.locator,
        createdAt: old?.createdAt ?? now,
        updatedAt: now,
      };
      annotations = [...annotations.filter((a) => a.id !== saved.id), saved];
      return saved;
    },
    deleteAnnotation: async (id) => {
      annotations = annotations.filter((a) => a.id !== id);
    },
    getSetting: async (key) => settings.get(key) ?? null,
    setSetting: async (key, value) => void settings.set(key, value),
    quit: async () => undefined,
    libraryInfo: async () => ({
      database: "C:\\Users\\you\\AppData\\Roaming\\The Bound Vigil\\library.db",
      booksDir: "C:\\Users\\you\\AppData\\Roaming\\The Bound Vigil\\Books",
      schemaVersion: 5,
      bookCount: books.length,
      databaseBytes: 1_480_000,
      booksBytes: 186_400_000,
    }),
    exportLibrary: async () => {
      throw new Error("Exporting works in the desktop app.");
    },
    exportNotesMarkdown: async () => {
      throw new Error("Exporting works in the desktop app.");
    },
    createBackup: async () => {
      throw new Error("Backups work in the desktop app.");
    },
    restoreBackup: async () => {
      throw new Error("Restoring works in the desktop app.");
    },
    // A quiet colour per sample book, standing in for its cover.
    coverAccent: async (bookId) => ["#8a5a44", "#4f6b5a", "#5b5f8a", "#8a7444", "#6a4a6e"][parseInt(bookId.slice(-2), 16) % 5],
    showFolder: async () => undefined,
    // Sync is pretend here: `?sync=on` shows a signed-in library, `?sync=ask`
    // adds a conflict to choose about.
    syncOverview: async () => sync,
    syncNow: async () => {
      sync = { ...sync, status: { state: "idle", lastSuccessAt: new Date().toISOString() }, waitingToSend: 0 };
    },
    syncSignIn: async (email) => {
      sync = { ...sync, signedInAs: email, status: { state: "idle", lastSuccessAt: new Date().toISOString() } };
      return true;
    },
    syncSignOut: async () => {
      sync = { ...sync, signedInAs: null, status: { state: "disabled", lastSuccessAt: null } };
    },
    setSupabaseProject: async (project) => {
      sync = { ...sync, project, signedInAs: project?.url === sync.project?.url ? sync.signedInAs : null };
    },
    resolveSyncConflict: async (_kind, key) => {
      sync = { ...sync, conflicts: sync.conflicts.filter((c) => c.key !== key) };
      if (!sync.conflicts.length) sync.status = { ...sync.status, state: "idle" };
    },
    downloadBook: async () => {
      throw new Error("Downloading works in the desktop app.");
    },
    onSync: () => () => undefined,
    ...collections.api,
    ...notes,
  };
}

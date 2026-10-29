// Sample data for looking at screens in an ordinary browser while designing.
// It is never used inside the desktop app (see api/index.ts), and the shell
// shows a "Preview" badge whenever it is active.

import type { Api } from "./index";
import { previewCollections } from "../preview/collections";
import { previewNotes, sampleAnnotations } from "../preview/notes";
import { sampleEpub } from "../preview/sampleEpub";
import { previewMove } from "../preview/move";
import { previewServers } from "../preview/servers";
import { cleanTag, isAudio, queryBooks, tagCounts } from "../lib/queryBooks";
import { sampleTime } from "../lib/timeSpent";
import { duplicateGroups } from "../lib/duplicates";
import { cleanValue, DETAIL_FIELDS, previewFields } from "../lib/details";
import { DESKTOP_ONLY } from "../ereaders/ereaders";
import { importsViewOf } from "../imports/view";
import { previewWriting } from "../preview/writing";
import { browseStub } from "../preview/browse";
import type {
  StoredFile,
  Audiobook,
  AudioChapter,
  DetailField,
  DetailFieldName,
  ProviderView,
  Annotation,
  BookPreview,
  Ereader,
  HardcoverStatus,
  LicenseView,
  HomeViewModel,
  KindleEmailView,
  ImportItem,
  Profile,
  SeriesEntry,
  SeriesReview,
  HomeStatus,
  SyncOverview,
  SyncActivity,
  TimeSpent,
} from "./types";

const day = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * day).toISOString();

let next = 1;

const activityListeners = new Set<(activity: SyncActivity) => void>();
// `?activity` shows a sync underway in both places, for reviewing the Sync activity page.
const secondsAgo = (s: number) => new Date(Date.now() - s * 1000).toISOString();
let previewActivity: SyncActivity = new URLSearchParams(location.search).has("activity")
  ? {
      running: true,
      startedAt: secondsAgo(40),
      finishedAt: null,
      places: [
        {
          lane: "main",
          provider: { kind: "supabase", service: null, location: null, username: null },
          step: "files",
          received: 12,
          sent: 3,
          filesTotal: 6,
          filesDone: 2,
          bytesTotal: 18_400_000,
          bytesDone: 4_100_000,
          current: { lane: "main", direction: "up", what: "The Left Hand of Darkness", bytes: 2_300_000, at: secondsAgo(2), problem: null },
          finished: false,
          problem: null,
        },
        {
          lane: "also",
          provider: { kind: "folder", service: "icloud", location: "C:\\Users\\embre\\iCloudDrive\\The Bound Vigil", username: null },
          step: null,
          received: 0,
          sent: 15,
          filesTotal: 9,
          filesDone: 9,
          bytesTotal: 412_000_000,
          bytesDone: 412_000_000,
          current: null,
          finished: true,
          problem: null,
        },
      ],
      recent: [
        { lane: "main", direction: "up", what: "The cover of Piranesi", bytes: 180_000, at: secondsAgo(6), problem: null },
        { lane: "main", direction: "up", what: "Piranesi", bytes: 3_900_000, at: secondsAgo(9), problem: null },
        { lane: "also", direction: "up", what: "Project Hail Mary (audiobook)", bytes: 398_000_000, at: secondsAgo(14), problem: null },
        { lane: "main", direction: "down", what: "A collection picture", bytes: 420_000, at: secondsAgo(20), problem: null },
        { lane: "main", direction: "down", what: "The Name of the Wind", bytes: 0, at: secondsAgo(25), problem: "It isn't in the cloud yet." },
        { lane: null, direction: "down", what: "Dune", bytes: 1_200_000, at: secondsAgo(3600), problem: null },
      ],
      changes: [
        { lane: "main", direction: "down", what: "Reading place: Warlock", at: secondsAgo(4) },
        { lane: "main", direction: "down", what: "Highlight: Warlock", at: secondsAgo(4) },
        { lane: "main", direction: "down", what: "Up next, favourite or rating: Piranesi", at: secondsAgo(5) },
        { lane: "main", direction: "up", what: "Reading place: The Left Hand of Darkness", at: secondsAgo(11) },
        { lane: "also", direction: "up", what: "Compendium: Winter reading", at: secondsAgo(16) },
      ],
    }
  : { running: false, startedAt: null, finishedAt: null, places: [], recent: [], changes: [] };

// `?imports` shows an import underway, for reviewing the Imports page.
const MB = 1024 * 1024;
let imports: ImportItem[] = new URLSearchParams(location.search).has("imports")
  ? [
      ["Carmilla.epub", 0.4, "imported", "Carmilla"],
      ["The Monk.epub", 0.9, "imported", "The Monk"],
      ["Wuthering Heights.epub", 0.6, "alreadyInLibrary", "Wuthering Heights"],
      ["Notes from a scan.pdf", 2.2, "failed", ""],
      ["Melmoth the Wanderer.pdf", 38, "reading", ""],
      ["Uncle Silas.epub", 1.1, "waiting", ""],
      ["The Castle of Otranto.epub", 0.3, "waiting", ""],
      ["Vathek.mobi", 0.7, "waiting", ""],
      ["The Italian.azw3", 1.4, "waiting", ""],
    ].map(([name, size, state, title], i): ImportItem => {
      const path = `C:\\Users\\you\\iCloudDrive\\Books\\${name}`;
      const bytes = Math.round((size as number) * MB);
      const done = state !== "waiting" && state !== "reading";
      return {
        id: i + 1,
        path,
        name: name as string,
        bytes,
        bytesRead: state === "reading" ? Math.round(bytes * 0.42) : done ? bytes : 0,
        stage: done ? "done" : (state as "waiting" | "reading"),
        result: !done
          ? null
          : state === "failed"
            ? { outcome: "failed", path, reason: "the file is damaged or not a PDF" }
            : { outcome: state as "imported" | "alreadyInLibrary", path, bookId: `sha256:${i}`, title: title as string },
      };
    })
  : [];
// `?license=expired` (or `=ending`, `=owned`) shows that state of the trial.
const licenseParam = new URLSearchParams(location.search).get("license");
let previewLicense: LicenseView = {
  state: licenseParam === "expired" ? "expired" : licenseParam === "owned" ? "owned" : "trial",
  daysLeft: licenseParam === "expired" || licenseParam === "owned" ? 0 : licenseParam === "ending" ? 2 : 21,
  trialEnds: Math.floor(Date.now() / 1000) + (licenseParam === "ending" ? 2 : 21) * 86_400,
  shop: "microsoft",
  price: "$14.99",
};
// `?hardcover` shows Hardcover signed in, for reviewing Settings.
let hardcover: HardcoverStatus = new URLSearchParams(location.search).has("hardcover")
  ? { available: true, username: "wrenhale", sendRatings: true }
  : { available: true, username: null, sendRatings: false };
// `?ereaders` shows a Kindle and a Kobo plugged in, and Kindle by email set
// up, for reviewing the Send dialog and Preferences › E-readers. Sending itself
// only works in the desktop app.
const showReaders = new URLSearchParams(location.search).has("ereaders");
const sampleReaders: Ereader[] = showReaders
  ? [
      { kind: "kindle", name: "Kindle", root: "E:\\", booksFolder: "E:\\documents", formats: ["mobi", "azw", "azw3", "pdf", "txt"] },
      { kind: "kobo", name: "Kobo", root: "F:\\", booksFolder: "F:\\", formats: ["epub", "pdf", "mobi", "txt", "cbz"] },
      { kind: "other", name: "G:\\", root: "G:\\", booksFolder: "G:\\Books", formats: [] },
    ]
  : [];
let kindleEmail: KindleEmailView | null = showReaders
  ? {
      server: "smtp.gmail.com",
      port: 587,
      security: "starttls",
      username: "wren.hale@gmail.com",
      hasPassword: true,
      from: "wren.hale@gmail.com",
      kindle: "wren_hale@kindle.com",
    }
  : null;
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
    rating: null,
    finishedAt: extra.status === "read" ? ago(n * 3) : null,
    tags: [],
    inCloud: n % 3 !== 0,
    genres: [],
    // The French classics are in French, so the language filter has something to show.
    language: ["Alexandre Dumas", "Émile Zola", "Gustave Flaubert", "Victor Hugo"].includes(author) ? "fr" : "en",
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
  book("Middlemarch", "George Eliot", { ...reading(0.18, 2), genres: ["Literary fiction"] }),
  book("The Moonstone", "Wilkie Collins", reading(0.71, 5)),
  book("Frankenstein", "Mary Shelley", { availability: "cloud", wantToRead: true }),
  book("Jane Eyre", "Charlotte Brontë", { favorite: true, rating: 4, tags: ["Gothic"], genres: ["Romance", "Gothic fiction"] }),
  book("Moby-Dick", "Herman Melville", { status: "read", totalProgression: 1, lastOpenedAt: ago(30), rating: 4 }),
  book("The Picture of Dorian Gray", "Oscar Wilde", { wantToRead: true }),
  book("A Study in Scarlet", "Arthur Conan Doyle", { series: "Sherlock Holmes", seriesIndex: 1, status: "read", totalProgression: 1, rating: 5 }),
  book("The Sign of the Four", "Arthur Conan Doyle", { series: "Sherlock Holmes", seriesIndex: 2, ...reading(0.33, 9) }),
  book("The Hound of the Baskervilles", "Arthur Conan Doyle", { series: "Sherlock Holmes", seriesIndex: 5 }),
  book("The Valley of Fear", "Arthur Conan Doyle"),
  book("The Warden", "Anthony Trollope", { series: "Chronicles of Barsetshire", seriesIndex: 1 }),
  book("Barchester Towers", "Anthony Trollope", { series: "Chronicles of Barsetshire", seriesIndex: 2, wantToRead: true }),
  book("Dracula", "Bram Stoker", { favorite: true, status: "read", totalProgression: 1, rating: 5, tags: ["Gothic", "Horror"], genres: ["Horror", "Gothic fiction"] }),
  book("Wuthering Heights", "Emily Brontë", { tags: ["Gothic", "Book club"] }),
  book("Persuasion", "Jane Austen", { favorite: true }),
  book("Emma", "Jane Austen"),
  book("Great Expectations", "Charles Dickens", { status: "read", totalProgression: 1, rating: 3 }),
  book("Bleak House", "Charles Dickens", { wantToRead: true }),
  book("The Woman in White", "Wilkie Collins"),
  book("North and South", "Elizabeth Gaskell"),
  book("The Turn of the Screw", "Henry James", { format: "pdf" }),
  book("Little Women", "Louisa May Alcott"),
  book("The Time Machine", "H. G. Wells", { status: "read", totalProgression: 1, genres: ["Science fiction"] }),
  book("The War of the Worlds", "H. G. Wells", { format: "txt", genres: ["Science fiction"] }),
  book("Twenty Thousand Leagues Under the Seas", "Jules Verne", { availability: "cloud" }),
  book("Around the World in Eighty Days", "Jules Verne"),
  book("Little Nemo in Slumberland", "Winsor McCay", { format: "cbz" }),
  book("The Secret Garden", "Frances Hodgson Burnett", { format: "docx" }),
  book("Anna Karenina", "Leo Tolstoy", { wantToRead: true }),
  book("The Brothers Karamazov", "Fyodor Dostoevsky", { format: "doc" }),
  book("Crime and Punishment", "Fyodor Dostoevsky", { status: "read", totalProgression: 1, format: "fb2" }),
  book("A Tale of Two Cities", "Charles Dickens"),
  book("Dracula", "Bram Stoker", { format: "pdf" }),
  book("Persuasion", "Jane Austen", {
    format: "tbvaudio",
    narrators: ["Juliet Stevenson"],
    genres: ["Romance", "Classics"],
    ...reading(0.38, 0.05),
  }),
  book("The Hound of the Baskervilles", "Arthur Conan Doyle", {
    format: "m4b",
    narrators: ["Stephen Fry"],
    series: "Sherlock Holmes",
    seriesIndex: 5,
    genres: ["Mystery"],
    ...reading(0.12, 1),
  }),
  book("Carmilla", "Sheridan Le Fanu", { format: "mp3", narrators: ["Rosamund Pike"], genres: ["Gothic fiction", "Horror"] }),
  book("The Time Machine", "H. G. Wells", { format: "m4b", narrators: ["Derek Jacobi"], genres: ["Science fiction"], status: "read", totalProgression: 1 }),
  book("Northanger Abbey", "Jane Austen", { format: "m4b", narrators: ["Juliet Stevenson"], genres: ["Romance", "Gothic fiction"], availability: "cloud" }),
];

// Sample audiobooks are short, so the preview plays them as silence of the right length.
const audioParts = new Map<string, { chapters: string[]; parts: number[] }>([
  ["Persuasion", { chapters: ["Chapter 1", "Chapter 2", "Chapter 3", "Chapter 4"], parts: [50, 45, 55, 40] }],
  ["The Hound of the Baskervilles", { chapters: ["Mr. Sherlock Holmes", "The Curse of the Baskervilles", "The Problem", "Sir Henry Baskerville", "Three Broken Threads"], parts: [210] }],
  ["Carmilla", { chapters: ["An Early Fright", "A Guest", "We Compare Notes"], parts: [40, 40, 40] }],
  ["The Time Machine", { chapters: ["Introduction", "The Machine", "The Time Traveller Returns"], parts: [120] }],
  ["Northanger Abbey", { chapters: ["Chapter 1", "Chapter 2"], parts: [90] }],
]);
for (const b of books)
  if (isAudio(b.format)) {
    const info = audioParts.get(b.title);
    b.durationMs = (info?.parts ?? [60]).reduce((a, s) => a + s, 0) * 1000;
    if (b.totalProgression) b.resumeLocator = { audioMs: Math.round(b.durationMs * b.totalProgression), totalProgression: b.totalProgression };
  }

function previewAudiobook(b: BookPreview, ebooks: BookPreview[], linked: Map<string, string>): Audiobook {
  const info = audioParts.get(b.title) ?? { chapters: ["Chapter 1"], parts: [60] };
  const durationMs = info.parts.reduce((a, s) => a + s, 0) * 1000;
  let at = 0;
  const parts = info.parts.map((s, i) => {
    const part = { name: `${String(i + 1).padStart(2, "0")} ${b.title}.mp3`, startMs: at, durationMs: s * 1000 };
    at += s * 1000;
    return part;
  });
  // One chapter per part, or evenly through a single file.
  const chapters: AudioChapter[] =
    parts.length > 1
      ? parts.map((p, i) => ({ title: info.chapters[i] ?? `Chapter ${i + 1}`, startMs: p.startMs }))
      : info.chapters.map((title, i) => ({ title, startMs: Math.round((durationMs / info.chapters.length) * i) }));
  const ebookId = linked.get(b.id);
  const ebook = ebookId ? ebooks.find((e) => e.id === ebookId) : undefined;
  return {
    book: b,
    narrators: b.narrators ?? [],
    durationMs,
    chapters,
    parts,
    positionMs: b.resumeLocator?.audioMs ?? 0,
    ebook: ebook ? { id: ebook.id, name: ebook.title } : null,
  };
}

/** A silent WAV of this length: 8 kHz, 8-bit mono. */
function silence(seconds: number): string {
  const samples = Math.round(seconds * 8000);
  const buffer = new ArrayBuffer(44 + samples);
  const v = new DataView(buffer);
  const text = (at: number, s: string) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  text(0, "RIFF");
  v.setUint32(4, 36 + samples, true);
  text(8, "WAVEfmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true);
  v.setUint32(28, 8000, true);
  v.setUint16(32, 1, true);
  v.setUint16(34, 8, true);
  text(36, "data");
  v.setUint32(40, samples, true);
  new Uint8Array(buffer, 44).fill(128);
  return URL.createObjectURL(new Blob([buffer], { type: "audio/wav" }));
}

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

function home(): HomeViewModel {
  const all = library();
  // Home is for reading; audiobooks have their own page.
  const reading = all.filter((b) => !isAudio(b.format));
  const inProgress = reading
    .filter((b) => b.status === "in_progress")
    .sort((a, b) => (b.lastOpenedAt ?? "").localeCompare(a.lastOpenedAt ?? ""));
  return {
    resumeBook: inProgress[0] ?? null,
    recentlyAdded: reading.filter((b) => Date.now() - Date.parse(b.addedAt) < 7 * 86_400_000).sort((a, b) => b.addedAt.localeCompare(a.addedAt)).slice(0, 5),
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
    finishedDates: [ago(1), ago(4), ago(12), ago(40)],
    sync: previewSync().status,
  };
}

const update = (bookId: string, change: Partial<BookPreview>) => {
  books = books.map((b) => (b.id === bookId ? { ...b, ...change } : b));
};

function previewSync(): SyncOverview {
  const mode = params.get("sync");
  const supabase: ProviderView = { kind: "supabase", service: null, location: null, username: null };
  if (!mode)
    return { status: { state: "disabled", lastSuccessAt: null }, provider: supabase, project: null, signedInAs: null, lastError: null, waitingToSend: 0, conflicts: [], also: null };
  if (mode === "folder")
    return {
      status: { state: "idle", lastSuccessAt: ago(0.002) },
      provider: { kind: "folder", service: "icloud", location: "C:\\Users\\you\\iCloudDrive", username: null },
      project: null,
      signedInAs: null,
      lastError: null,
      waitingToSend: 0,
      conflicts: [],
      also: null,
    };
  return {
    status: { state: mode === "ask" ? "attention" : "idle", lastSuccessAt: ago(0.002) },
    provider: supabase,
    project: { url: "https://abcdefghijklmnop.supabase.co", anonKey: "sb_publishable_sample" },
    signedInAs: "reader@example.com",
    lastError: null,
    waitingToSend: 2,
    also: null,
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
  let profile: Profile = { avatarPath: params.has("avatar") ? SAMPLE_AVATAR : null, name: null, deviceName: "This computer" };
  const settings = new Map<string, string>();
  const dismissed = new Set<string>();
  // Book details in their layers: what each book started with, your edits and what was fetched.
  const own = new Map<string, Record<string, string | null>>();
  const edited = new Map<string, Record<string, string>>();
  const fetched = new Map<string, Record<string, { value: string; source: "google" | "openlibrary" | "audible" | "hardcover" }>>();
  const ownOf = (id: string) => {
    if (!own.has(id)) {
      const b = find(id);
      own.set(id, {
        title: b.title,
        authors: JSON.stringify(b.authors),
        series: b.series,
        series_index: b.seriesIndex === null ? null : String(b.seriesIndex),
        synopsis: b.synopsis,
        publisher: "Penguin Classics",
        language: "en",
        isbn: null,
        narrators: isAudio(b.format) ? JSON.stringify(b.narrators ?? []) : null,
      });
      if (b.genres.length) fetched.set(id, { ...fetched.get(id), genres: { value: JSON.stringify(b.genres), source: "openlibrary" } });
    }
    return own.get(id)!;
  };
  const detailFields = (id: string): DetailField[] =>
    DETAIL_FIELDS.map(({ field }) => ({
      field,
      own: ownOf(id)[field] ?? null,
      fetched: fetched.get(id)?.[field]?.value ?? null,
      fetchedFrom: fetched.get(id)?.[field]?.source ?? null,
      edited: edited.get(id)?.[field] ?? null,
    }));
  const relayer = (id: string) => update(id, previewFields(detailFields(id)));
  const linked = new Map<string, string>();
  const timeLog = new Map<string, TimeSpent>(sampleTime().map((t) => [t.day, t]));
  const timings = new Map<string, string>();
  const pieces = new Map<string, Map<number, string>>();
  const sounds = new Map<string, string>();
  const find = (bookId: string) => {
    const b = books.find((x) => x.id === bookId);
    if (!b) throw new Error("This book is no longer in your library.");
    return b;
  };
  const HOME_OFF: HomeStatus = { on: false, addresses: [], code: null, qr: null, phones: 0, problem: null };
  const HOME_ON: HomeStatus = {
    on: true,
    addresses: ["http://192.168.1.24:53318/"],
    code: "482913",
    qr: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 21 21" width="220" height="220"><rect width="21" height="21" fill="#fff"/><path d="M1 1h7v7H1zM13 1h7v7h-7zM1 13h7v7H1z" fill="none" stroke="#000"/><path d="M3 3h3v3H3zM15 3h3v3h-3zM3 15h3v3H3zM10 2h1v1h-1zM9 9h3v1H9zM12 12h2v2h-2zM16 13h2v1h-2zM14 17h3v1h-3z"/></svg>`,
    phones: 1,
    problem: null,
  };
  let homeState: HomeStatus = HOME_OFF;

  // Find missing books: a made-up online list for each series asked about.
  const seriesLists = new Map<string, { list: SeriesEntry[]; hidden: Set<string>; denied: Set<string>; read: Set<string> }>();
  const seriesReviewOf = (name: string): SeriesReview => {
    const id = name.toLowerCase();
    const inside = library().filter((b) => b.series?.toLowerCase() === id);
    const saved = seriesLists.get(id);
    const ownedBooks = inside
      .map((book) => ({ book, position: book.seriesIndex ?? saved?.list.find((e) => e.title.toLowerCase() === book.title.toLowerCase())?.position ?? null }))
      .sort((a, b) => (a.position ?? 1e9) - (b.position ?? 1e9));
    if (!saved) return { name, checkedAt: null, listed: 0, owned: inside.length, missing: [], matches: [], ownedBooks };
    const missing = saved.list
      .filter((e) => !inside.some((b) => b.seriesIndex === e.position || b.title.toLowerCase() === e.title.toLowerCase()))
      .map((e) => ({ ...e, key: String(e.position), hidden: saved.hidden.has(String(e.position)), read: saved.read.has(String(e.position)) }));
    const matches = missing.flatMap((m) =>
      m.hidden
        ? []
        : library()
            .filter((b) => !saved.denied.has(b.id) && b.series?.toLowerCase() !== id && b.title.toLowerCase() === m.title.toLowerCase())
            .map((book) => ({ book, position: m.position, reason: "The same title and author, with no series in its details" })),
    );
    return { name, checkedAt: new Date().toISOString(), listed: saved.list.length, owned: inside.length, missing, matches, ownedBooks };
  };
  const HOLMES = ["A Study in Scarlet", "The Sign of the Four", "The Adventures of Sherlock Holmes", "The Memoirs of Sherlock Holmes", "The Hound of the Baskervilles", "The Return of Sherlock Holmes", "The Valley of Fear", "His Last Bow", "The Case-Book of Sherlock Holmes"];

  return {
    kind: "preview",
    ...previewMove(params),
    ...previewWriting(),
    ...browseStub(),
    findSeriesBooks: async (name, author) => {
      await new Promise((r) => setTimeout(r, 600));
      const titles = name.toLowerCase() === "sherlock holmes" ? HOLMES : Array.from({ length: 5 }, (_, i) => `${name}, book ${i + 1}`);
      const list = titles.map((title, i) => ({ title, position: i + 1, authors: [author], coverUrl: null, source: "audible" }));
      const old = seriesLists.get(name.toLowerCase());
      const byHand = old?.list.filter((e) => e.source === "you") ?? [];
      seriesLists.set(name.toLowerCase(), {
        list: [...list, ...byHand].sort((a, b) => (a.position ?? 1e9) - (b.position ?? 1e9)),
        hidden: old?.hidden ?? new Set(),
        denied: old?.denied ?? new Set(),
        read: old?.read ?? new Set(),
      });
      return seriesReviewOf(name);
    },
    seriesReview: async (name) => seriesReviewOf(name),
    hideSeriesBook: async (name, key, hidden) => {
      const saved = seriesLists.get(name.toLowerCase());
      if (saved) hidden ? saved.hidden.add(key) : saved.hidden.delete(key);
      return seriesReviewOf(name);
    },
    markSeriesBookRead: async (name, key, read) => {
      const saved = seriesLists.get(name.toLowerCase());
      if (saved) read ? saved.read.add(key) : saved.read.delete(key);
      return seriesReviewOf(name);
    },
    addSeriesBook: async (name, title, position, authors) => {
      const id = name.toLowerCase();
      const saved = seriesLists.get(id) ?? { list: [], hidden: new Set<string>(), denied: new Set<string>(), read: new Set<string>() };
      saved.list = [...saved.list.filter((e) => e.position !== position), { title, position, authors, coverUrl: null, source: "you" }].sort(
        (a, b) => (a.position ?? 1e9) - (b.position ?? 1e9),
      );
      seriesLists.set(id, saved);
      return seriesReviewOf(name);
    },
    removeSeriesBook: async (name, key) => {
      const saved = seriesLists.get(name.toLowerCase());
      if (saved) saved.list = saved.list.filter((e) => !(e.source === "you" && String(e.position) === key));
      return seriesReviewOf(name);
    },
    approveSeriesMatches: async (name, approvals) => {
      for (const a of approvals) update(a.bookId, { series: name, seriesIndex: a.position });
      return seriesReviewOf(name);
    },
    denySeriesMatches: async (name, bookIds) => {
      bookIds.forEach((id) => seriesLists.get(name.toLowerCase())?.denied.add(id));
      return seriesReviewOf(name);
    },
    planTidyCloud: async () => ({
      keep: 1,
      remove: Array.from({ length: 1290 }, (_, i) => `books/${i}.epub`),
      copyFirst: Array.from({ length: 416 }, (_, i) => `books/c${i}.epub`),
      lose: [],
      covers: Array.from({ length: 7900 }, (_, i) => `covers/${i}.jpg`),
      bytes: 912_000_000,
    }),
    tidyCloud: async (onProgress) => {
      for (let done = 0; done <= 1706; done += 120) {
        onProgress({ done, total: 1706 });
        await new Promise((r) => setTimeout(r, 120));
      }
      onProgress({ done: 1706, total: 1706 });
      return { removed: 1706, copied: 416, failed: 0, stopped: false };
    },
    supabaseContents: async () => {
      const titles = ["Dracula", "Carmilla", "The Valley of Fear", "Frankenstein", "The Turn of the Screw", "Uncle Silas"];
      const files: StoredFile[] = titles.flatMap((title, i) => [
        { path: `books/${i}.epub`, kind: "ebook" as const, bookId: `sha256:${i}`, title, bytes: 400_000 + i * 90_000, elsewhere: i % 3 !== 2 },
        { path: `covers/${i}.jpg`, kind: "cover" as const, bookId: `sha256:${i}`, title, bytes: 92_000, elsewhere: true },
      ]);
      files.push(
        { path: "books/a.pdf", kind: "document", bookId: "sha256:a", title: "Field notes", bytes: 2_300_000, elsewhere: true },
        { path: "books/b.m4b", kind: "audiobook", bookId: "sha256:b", title: "Dracula (audiobook)", bytes: 41_000_000, elsewhere: false },
        { path: "pictures/me.webp", kind: "picture", bookId: null, title: null, bytes: 30_000, elsewhere: true },
      );
      return files;
    },
    bookPlaces: async () => {
      const titles = ["Carmilla", "Dracula", "Frankenstein", "The Turn of the Screw", "The Valley of Fear", "Uncle Silas", "Wuthering Heights"];
      return {
        main: { provider: { kind: "folder", service: "icloud", location: "C:\\Users\\embre\\iCloudDrive\\The Bound Vigil", username: null }, problem: null },
        also: { provider: { kind: "supabase", service: null, location: null, username: null }, problem: null },
        books: titles.map((title, i) => ({
          bookId: `sha256:${i}`,
          title,
          authors: ["Someone"],
          format: i === 3 ? "pdf" : "epub",
          here: i % 4 !== 1,
          main: i !== 5,
          also: i % 3 === 0,
        })),
      };
    },
    removeSupabaseFiles: async (paths, onProgress) => {
      onProgress({ done: paths.length, total: paths.length });
      return { removed: paths.length, failed: 0, stopped: false };
    },
    supabaseUsage: async () => ({
      fileBytes: 742_000_000,
      files: 18_412,
      bookBytes: 590_000_000,
      audioBytes: 0,
      pictureBytes: 152_000_000,
      databaseBytes: params.has("oldsetup") ? null : 61_000_000,
    }),
    getHome: async () => home(),
    queueImports: async () => 0,
    importQueue: async () => importsViewOf(imports),
    takePdfCovers: async () => [],
    cancelImports: async () => {
      imports = imports.filter((i) => i.stage !== "waiting");
    },
    clearFinishedImports: async () => {
      imports = imports.filter((i) => i.stage !== "done");
    },
    onImports: () => () => undefined,
    syncActivity: async () => previewActivity,
    clearSyncChanges: async () => {
      previewActivity = { ...previewActivity, changes: [] };
      activityListeners.forEach((l) => l(previewActivity));
    },
    onSyncActivity: (listener) => {
      let stopped = false;
      void Promise.resolve().then(() => !stopped && listener(previewActivity));
      activityListeners.add(listener);
      return () => {
        stopped = true;
        activityListeners.delete(listener);
      };
    },
    setBookStatus: async (bookId, status) =>
      update(bookId, status === "unread" ? { status, totalProgression: null } : { status }),
    getLibrary: async (query) => queryBooks(library(), query, collections.previews().length),
    getCollections: async () => collections.previews(),
    setFavorite: async (bookId, favorite) => update(bookId, { favorite }),
    setWantToRead: async (bookId, wantToRead) => update(bookId, { wantToRead }),
    setPhoneWanted: async (bookIds, phoneWanted) => bookIds.forEach((id) => update(id, { phoneWanted })),
    setRating: async (bookId, rating) => update(bookId, { rating }),
    // The preview has no files to read, so it shows what an import reports.
    importGoodreads: async () => ({
      rows: 214,
      matched: 38,
      ratings: 31,
      statuses: 26,
      upNext: 9,
      favourites: 4,
      collectionsCreated: ["Gothic", "Victorian"],
      collectionBooks: 17,
      notFound: ["Middlemarch by George Eliot", "Bleak House by Charles Dickens"],
    }),
    exportGoodreads: async () => 12,
    hardcoverStatus: async () => ({ ...hardcover }),
    hardcoverSignIn: async () => {
      hardcover = { ...hardcover, username: "wrenhale", sendRatings: true };
      return { ...hardcover };
    },
    hardcoverSignOut: async () => {
      hardcover = { ...hardcover, username: null, sendRatings: false };
      return { ...hardcover };
    },
    hardcoverSetSending: async (on) => {
      hardcover = { ...hardcover, sendRatings: on };
      return { ...hardcover };
    },
    hardcoverSendAll: async () => ({ sent: 4, notFound: ["Little Nemo in Slumberland by Winsor McCay"] }),
    onHardcoverNotice: () => () => undefined,
    onSharedBooks: () => () => undefined,
    bookText: async () => "Chapter One\nThe lamps along the harbour wall were lit one by one.",
    fillCover: async () => false,
    fetchCover: async () => false,
    audiobook: async (bookId) => previewAudiobook(find(bookId), books, linked),
    saveListening: async (bookId, positionMs, chapter) => {
      const b = find(bookId);
      const total = b.durationMs ?? 0;
      const progression = total ? Math.min(1, positionMs / total) : null;
      update(bookId, {
        resumeLocator: { audioMs: Math.round(positionMs), totalProgression: progression ?? undefined, chapter: chapter ?? undefined },
        totalProgression: progression,
        lastOpenedAt: new Date().toISOString(),
        status: b.status === "unread" && positionMs > 0 ? "in_progress" : b.status,
      });
    },
    addTime: async (day, kind, seconds) => {
      const spent = timeLog.get(day) ?? { day, read: 0, listen: 0 };
      spent[kind] += Math.round(seconds);
      timeLog.set(day, spent);
    },
    timeSpent: async () => [...timeLog.values()].sort((a, b) => a.day.localeCompare(b.day)),
    linkEbook: async (audiobookId, ebookId) => {
      if (ebookId) linked.set(audiobookId, ebookId);
      else linked.delete(audiobookId);
    },
    audiobookForEbook: async (ebookId) => [...linked].find(([, e]) => e === ebookId)?.[0] ?? null,
    audioClip: async () => {
      throw new Error("Working out read-along timing needs the desktop app.");
    },
    audioClipsDone: async () => undefined,
    readAlongTiming: async (ebookId, audiobookId) => timings.get(`${ebookId}|${audiobookId}`) ?? null,
    saveReadAlongTiming: async (ebookId, audiobookId, timing) => {
      timings.set(`${ebookId}|${audiobookId}`, timing);
    },
    readAlongPieces: async (ebookId, audiobookId) =>
      [...(pieces.get(`${ebookId}|${audiobookId}`) ?? new Map<number, string>())].sort((a, b) => a[0] - b[0]),
    saveReadAlongPiece: async (ebookId, audiobookId, piece, anchors) => {
      const key = `${ebookId}|${audiobookId}`;
      const kept = pieces.get(key) ?? new Map<number, string>();
      if (!kept.has(piece)) kept.set(piece, anchors);
      pieces.set(key, kept);
    },
    clearReadAlongPieces: async (ebookId, audiobookId) => {
      pieces.delete(`${ebookId}|${audiobookId}`);
    },
    readAlongPairs: async () =>
      [...linked].flatMap(([audiobookId, ebookId]) => {
        const ebook = books.find((b) => b.id === ebookId);
        if (!ebook) return [];
        const key = `${ebookId}|${audiobookId}`;
        return [{ ebookId, audiobookId, ebookFormat: ebook.format, here: true, timing: timings.get(key) ?? null, pieces: pieces.get(key)?.size ?? 0 }];
      }),
    prepareStream: async () => null,
    homeStatus: async () => homeState,
    setHome: async (on) => (homeState = on ? { ...HOME_ON, phones: homeState.phones } : { ...HOME_OFF, phones: homeState.phones }),
    newHomeCode: async () => (homeState = { ...homeState, code: String(100000 + Math.floor(Math.random() * 900000)) }),
    forgetHomePhones: async () => (homeState = { ...homeState, phones: 0 }),
    onHomeChanged: () => () => undefined,
    audioUrl: (bookId, part) => {
      const key = `${bookId}/${part}`;
      if (!sounds.has(key)) {
        const seconds = previewAudiobook(find(bookId), books, linked).parts[part]?.durationMs ?? 0;
        sounds.set(key, silence(seconds / 1000));
      }
      return sounds.get(key)!;
    },
    getProfile: async () => profile,
    chooseAvatar: async () => null,
    clearAvatar: async () => (profile = { ...profile, avatarPath: null }),
    setAccountName: async (name) => (profile = { ...profile, name: name.trim() || null }),
    setDeviceName: async (name) => (profile = { ...profile, deviceName: name.trim() || "This computer" }),
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
      const author = b.authors.join(", ");
      const { sampleComic, sampleDocx, sampleFb2, samplePdf, sampleText } = await import("../preview/sampleFiles");
      switch (b.format) {
        case "pdf":
          return samplePdf(b.title, author);
        case "cbz":
          return sampleComic(b.title);
        case "txt":
          return sampleText(b.title);
        case "docx":
          return sampleDocx(b.title, author);
        case "fb2":
          return sampleFb2(b.title, author);
        default:
          return sampleEpub(b.title, author);
      }
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
    setSyncProvider: async (choice) => {
      const provider: ProviderView =
        choice.kind === "folder"
          ? { kind: "folder", service: choice.service, location: choice.path, username: null }
          : choice.kind === "webdav"
            ? { kind: "webdav", service: null, location: choice.url, username: choice.username }
            : choice.kind === "cloud"
              ? { kind: "cloud", service: choice.service, location: null, username: choice.name }
              : { kind: choice.kind, service: null, location: null, username: null };
      sync = { ...sync, provider, status: choice.kind === "off" ? { state: "disabled", lastSuccessAt: null } : { state: "idle", lastSuccessAt: new Date().toISOString() } };
      return false;
    },
    setAlsoSync: async (choice) => {
      const provider: ProviderView | null = !choice || choice.kind === "off"
        ? null
        : choice.kind === "folder"
          ? { kind: "folder", service: choice.service, location: choice.path, username: null }
          : choice.kind === "webdav"
            ? { kind: "webdav", service: null, location: choice.url, username: choice.username }
            : choice.kind === "cloud"
              ? { kind: "cloud", service: choice.service, location: null, username: choice.name }
              : { kind: "supabase", service: null, location: null, username: null };
      sync = { ...sync, also: provider && { provider, lastSuccessAt: new Date().toISOString(), lastError: null, waitingToSend: 0 } };
      return false;
    },
    chooseFolder: async () => "C:\\Users\\you\\Dropbox",
    cloudSignIn: async (service) => ({ kind: "cloud", service, accountId: `${service}-1`, name: "you@example.com", refreshToken: "preview" }),
    cloudServices: async () => ["dropbox", "google", "onedrive"],
    checkForUpdate: async () => ({ canUpdate: true, current: "1.38.0", version: "1.39.0", notes: "The Bound Vigil 1.39.0" }),
    installUpdate: async () => {
      throw new Error("The preview can't install updates.");
    },
    onUpdateProgress: () => () => undefined,
    licenseStatus: async () => previewLicense,
    buyLicense: async () => (previewLicense = { ...previewLicense, state: "owned", daysLeft: 0 }),
    restoreLicense: async () => previewLicense,
    unlockLicense: async (code) => (code.trim() ? (previewLicense = { ...previewLicense, state: "owned", daysLeft: 0 }) : null),
    suggestSyncFolder: async (service) =>
      ({ icloud: "C:\\Users\\you\\iCloudDrive", dropbox: "C:\\Users\\you\\Dropbox", onedrive: "C:\\Users\\you\\OneDrive", gdrive: "G:\\My Drive" })[service] ?? null,
    resolveSyncConflict: async (_kind, key) => {
      sync = { ...sync, conflicts: sync.conflicts.filter((c) => c.key !== key) };
      if (!sync.conflicts.length) sync.status = { ...sync.status, state: "idle" };
    },
    downloadBook: async () => {
      throw new Error("Downloading works in the desktop app.");
    },
    allTags: async () => tagCounts(library()),
    addTag: async (bookIds, tag) => {
      const clean = cleanTag(tag);
      if (!clean) throw new Error("Type a tag first.");
      const kept = tagCounts(library()).find((t) => t.name.toLowerCase() === clean.toLowerCase())?.name ?? clean;
      for (const id of bookIds) {
        const b = find(id);
        if (!b.tags.some((t) => t.toLowerCase() === kept.toLowerCase())) update(id, { tags: [...b.tags, kept].sort() });
      }
      return kept;
    },
    removeTag: async (bookIds, tag) => {
      for (const id of bookIds) update(id, { tags: find(id).tags.filter((t) => t.toLowerCase() !== tag.toLowerCase()) });
    },
    setBookTags: async (bookId, tags) =>
      update(bookId, { tags: [...new Set(tags.map(cleanTag).filter((t): t is string => !!t))].sort() }),
    // The preview and the web version leave this to TBV on the computer, where duplicates are cleaned up.
    mergeReading: async () => undefined,
    keepTogether: async (_mainId, otherIds) => {
      books = books.filter((b) => !otherIds.includes(b.id));
    },
    keepApart: async () => undefined,
    bookFiles: async (bookId) => {
      const b = find(bookId);
      return [{ id: b.id, format: b.format, size: 48_000, downloaded: b.availability === "local" }];
    },
    deleteBook: async (bookId) => {
      find(bookId);
      books = books.filter((b) => b.id !== bookId);
    },
    saveCopies: async (bookIds) => ({ saved: bookIds.length, folder: "C:\\Users\\you\\Documents" }),
    removeFromLibrary: async (bookId) => {
      find(bookId);
      books = books.filter((b) => b.id !== bookId);
    },
    removeDownload: async (bookId) => {
      if (!find(bookId).inCloud) throw new Error("This book isn't in the cloud yet, so this is its only copy.");
      update(bookId, { availability: "cloud" });
    },
    findDuplicates: async () =>
      duplicateGroups(library())
        .filter((g) => !dismissed.has(g.key))
        .map((g) => ({ ...g, books: g.books.map((b, i) => ({ ...b, fileSize: 412_000 + i * 2_300_000, notes: i ? 0 : 3, collections: 0, coverSize: (i ? [300, 450] : [600, 900]) as [number, number] })) })),
    dismissDuplicates: async (key) => void dismissed.add(key),
    shareBestCover: async (bookIds) => {
      // Sample covers are drawn, so the first copy's stands in for the largest.
      bookIds.forEach(find);
      return bookIds.length - 1;
    },
    bookDetails: async (bookId) => ({
      book: find(bookId),
      fields: detailFields(bookId),
      fileSize: 1_284_000,
      filePath: find(bookId).availability === "local" ? `C:\\Users\\you\\AppData\\Roaming\\The Bound Vigil\\Books\\${find(bookId).title}.${find(bookId).format}` : null,
      collections: [],
      annotations: 0,
    }),
    editDetails: async (bookIds, changes) => {
      const cleaned = changes.map((c) => ({ ...c, value: c.value === null ? null : cleanValue(c.field, c.value) }));
      for (const id of bookIds) {
        ownOf(id);
        const mine = { ...edited.get(id) };
        for (const c of cleaned) {
          if (c.value === null) delete mine[c.field];
          else mine[c.field] = c.value;
        }
        edited.set(id, mine);
        relayer(id);
      }
    },
    resetDetails: async (bookId, alsoFetched) => {
      ownOf(bookId);
      edited.delete(bookId);
      if (alsoFetched) fetched.delete(bookId);
      relayer(bookId);
    },
    searchDetailsMore: async () => [],
    saveFetched: async (bookId, source, values) => {
      ownOf(bookId);
      const found = { ...fetched.get(bookId) };
      for (const [field, value] of Object.entries(values)) {
        const v = cleanValue(field as DetailFieldName, value);
        if (v && v !== "[]") found[field] = { value: v, source };
      }
      fetched.set(bookId, found);
      relayer(bookId);
    },
    listEreaders: async () => sampleReaders,
    copyToEreader: async () => {
      throw new Error(DESKTOP_ONLY);
    },
    kindleEmailSettings: async () => kindleEmail,
    saveKindleEmail: async ({ password, ...rest }) => {
      kindleEmail = { ...rest, hasPassword: Boolean(password) || Boolean(kindleEmail?.hasPassword) };
      return kindleEmail;
    },
    forgetKindleEmail: async () => {
      kindleEmail = null;
    },
    sendToKindle: async () => {
      throw new Error(DESKTOP_ONLY);
    },
    sendKindleTest: async () => {
      throw new Error(DESKTOP_ONLY);
    },
    onSync: () => () => undefined,
    ...previewServers(),
    ...collections.api,
    ...notes,
  };
}

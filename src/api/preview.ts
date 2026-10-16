// Sample data for looking at screens in an ordinary browser while designing.
// It is never used inside the desktop app (see api/index.ts), and the shell
// shows a "Preview" badge whenever it is active.

import type { Api } from "./index";
import type { BookPreview, HomeViewModel, ImportResult, ReadStatus } from "./types";

const day = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * day).toISOString();

function book(n: number, title: string, author: string, extra: Partial<BookPreview> = {}): BookPreview {
  return {
    id: `sha256:${n.toString(16).padStart(64, "0")}`,
    title,
    authors: [author],
    coverPath: null,
    format: "epub",
    synopsis: null,
    addedAt: ago(n),
    lastOpenedAt: null,
    status: "unread",
    totalProgression: null,
    resumeLocator: null,
    availability: "local",
    remotePositions: [],
    ...extra,
  };
}

const books: BookPreview[] = [
  book(1, "The Count of Monte Cristo", "Alexandre Dumas", {
    status: "in_progress",
    totalProgression: 0.42,
    lastOpenedAt: ago(0.1),
    synopsis:
      "Wrongly imprisoned on the eve of his wedding, Edmond Dantès escapes after fourteen years and returns as the wealthy Count, set on repaying every debt.",
    remotePositions: [{ deviceName: "Phone", totalProgression: 0.47, at: ago(0.5) }],
  }),
  book(2, "Middlemarch", "George Eliot", { status: "in_progress", totalProgression: 0.18, lastOpenedAt: ago(2) }),
  book(3, "The Moonstone", "Wilkie Collins", { status: "in_progress", totalProgression: 0.71, lastOpenedAt: ago(5) }),
  book(4, "Frankenstein", "Mary Shelley", { availability: "cloud" }),
  book(5, "Jane Eyre", "Charlotte Brontë"),
  book(6, "Moby-Dick", "Herman Melville", { status: "read", totalProgression: 1 }),
  book(7, "The Picture of Dorian Gray", "Oscar Wilde"),
];

let home: HomeViewModel = {
  resumeBook: books[0],
  recentlyAdded: [...books].sort((a, b) => b.addedAt.localeCompare(a.addedAt)).slice(0, 5),
  inProgress: books.filter((b) => b.status === "in_progress"),
  collections: [
    { id: "c1", name: "Gothic", count: 3, coverPaths: [] },
    { id: "c2", name: "Long Victorians", count: 4, coverPaths: [] },
  ],
  annotations: [
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
  libraryCounts: { total: 7, unread: 3, inProgress: 3, read: 1 },
  activity: null,
  sync: { state: "disabled", lastSuccessAt: null },
};

const empty = new URLSearchParams(location.search).has("empty");

export function previewApi(): Api {
  return {
    kind: "preview",
    getHome: async () =>
      empty
        ? {
            ...home,
            resumeBook: null,
            recentlyAdded: [],
            inProgress: [],
            collections: [],
            annotations: [],
            libraryCounts: { total: 0, unread: 0, inProgress: 0, read: 0 },
          }
        : home,
    importBooks: async (paths): Promise<ImportResult[]> => paths.map((path) => ({ outcome: "unsupported", path })),
    setBookStatus: async (bookId: string, status: ReadStatus) => {
      const update = (b: BookPreview) => (b.id === bookId ? { ...b, status } : b);
      home = { ...home, recentlyAdded: home.recentlyAdded.map(update) };
    },
    pickBooks: async () => [],
    pickFolder: async () => [],
    coverUrl: () => "",
  };
}

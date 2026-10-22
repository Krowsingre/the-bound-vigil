// The browser preview's Writing page and Catalogs: a sample book being
// written, and a pretend catalog, kept in memory.

import type { Api } from "../api";
import type { CatalogView, OpdsEntry, OpdsFeed } from "../api/types";
import { writingCalls } from "../writing/records";

type Row = { [column: string]: unknown };

type Calls = Pick<
  Api,
  | "catalogs"
  | "saveCatalog"
  | "removeCatalog"
  | "catalogFeed"
  | "catalogSearch"
  | "downloadFromCatalog"
  | "writingProjects"
  | "writingProject"
  | "createWritingProject"
  | "updateWritingDetails"
  | "setWritingExport"
  | "setWritingCover"
  | "setWritingCoverPicture"
  | "setWritingChapterRole"
  | "deleteWritingProject"
  | "addWritingChapter"
  | "saveWritingChapter"
  | "orderWritingChapters"
  | "deleteWritingChapter"
  | "writingCover"
  | "pickWritingCover"
  | "pickEpubSavePath"
  | "saveWritingEpub"
>;

const CLASSICS: [string, string, string][] = [
  ["Pride and Prejudice", "Jane Austen", "A spirited young woman, a proud gentleman, and a great many misunderstandings."],
  ["Moby-Dick", "Herman Melville", "Captain Ahab hunts the white whale across every ocean."],
  ["Frankenstein", "Mary Shelley", "A young scientist builds a living creature, and regrets it."],
  ["The Time Machine", "H. G. Wells", "A traveller visits the far future of mankind."],
  ["Dracula", "Bram Stoker", "Letters and diaries tell of a count from Transylvania."],
  ["The Count of Monte Cristo", "Alexandre Dumas", "A man wrongly imprisoned plans his return."],
];

export function previewWriting(): Calls {
  const pictures = new Map<string, string>();
  const tables = { writing_projects: new Map<string, Row>(), writing_chapters: new Map<string, Row>() };
  const store = {
    rows: (table: keyof typeof tables) => [...tables[table].values()],
    write: async (kind: "writing_project" | "writing_chapter", row: Row) => {
      tables[kind === "writing_project" ? "writing_projects" : "writing_chapters"].set(String(row.id), row);
    },
    pictureUrl: (picture: string) => pictures.get(picture) ?? null,
    newId: () => crypto.randomUUID(),
  };
  const calls = writingCalls(store);
  const at = "2026-10-20T19:00:00.000Z";
  store.write("writing_project", {
    id: "sample-book",
    title: "The Ash Road",
    author: "Embre",
    series: "Roads",
    series_index: 1,
    language: "en",
    description: "A courier crosses a burned country with a letter no one should read.",
    cover: null,
    export: "{}",
    created_at: at,
    updated_at: at,
    deleted_at: null,
  });
  const chapters = [
    ["Arrival", "<h2>The gate</h2><p>Rain came down on the <em>ash road</em> the night Wren reached the gate.</p><p>The guard did not look up.</p><hr><p>By morning the letter was gone.</p>"],
    ["The burned mile", "<p>Nothing grew along the burned mile, but people still lived there.</p><blockquote><p>Keep to the stones, they told her.</p></blockquote>"],
    ["Leaving", "<p>She left before anyone could ask her name.</p>"],
  ];
  chapters.forEach(([title, body], i) =>
    store.write("writing_chapter", { id: `sample-${i}`, project_id: "sample-book", title, body, position: i + 1, created_at: at, updated_at: at, deleted_at: null }),
  );

  let catalogs: CatalogView[] = [
    { id: "gutenberg", name: "Project Gutenberg", url: "https://www.gutenberg.org/ebooks.opds/", username: null, hasPassword: false },
    { id: "standard-ebooks", name: "Standard Ebooks", url: "https://standardebooks.org/feeds/opds", username: null, hasPassword: false },
  ];
  const book = ([title, author, summary]: [string, string, string], i: number): OpdsEntry => ({
    id: `book-${i}`,
    title,
    authors: [author],
    summary,
    language: "en",
    published: null,
    cover: null,
    navigation: null,
    files: [
      { url: `https://example.invalid/${i}.epub`, mime: "application/epub+zip", format: "epub", label: "EPUB (with images)" },
      { url: `https://example.invalid/${i}.mobi`, mime: "application/x-mobipocket-ebook", format: "mobi", label: "Kindle" },
    ],
    notFree: false,
  });
  const shelf = (title: string, url: string): OpdsEntry => ({
    id: url,
    title,
    authors: [],
    summary: null,
    language: null,
    published: null,
    cover: null,
    navigation: url,
    files: [],
    notFree: false,
  });
  const feed = (url: string | null): OpdsFeed =>
    url === null
      ? {
          url: "start",
          title: "Project Gutenberg",
          entries: [shelf("Popular", "popular"), shelf("Latest", "latest"), shelf("Random", "random")],
          next: null,
          previous: null,
          search: "search?q={searchTerms}",
        }
      : { url, title: url === "popular" ? "Popular" : "Latest", entries: CLASSICS.map(book), next: "page-2", previous: null, search: "search?q={searchTerms}" };

  return {
    ...calls,
    catalogs: async () => catalogs,
    saveCatalog: async ({ password, ...input }) => {
      const saved: CatalogView = {
        id: input.id ?? crypto.randomUUID(),
        name: input.name.trim() || new URL(input.url).host,
        url: input.url,
        username: input.username || null,
        hasPassword: !!password || !!catalogs.find((c) => c.id === input.id)?.hasPassword,
      };
      catalogs = [...catalogs.filter((c) => c.id !== saved.id), saved];
      return saved;
    },
    removeCatalog: async (id) => {
      catalogs = catalogs.filter((c) => c.id !== id);
    },
    catalogFeed: async (_id, url) => {
      await new Promise((r) => setTimeout(r, 300));
      return feed(url);
    },
    catalogSearch: async (_id, _search, words) => {
      await new Promise((r) => setTimeout(r, 300));
      const found = CLASSICS.map(book).filter((b) => `${b.title} ${b.authors}`.toLowerCase().includes(words.toLowerCase()));
      return { url: "search", title: `Results for “${words}”`, entries: found, next: null, previous: null, search: "search?q={searchTerms}" };
    },
    downloadFromCatalog: async () => {
      await new Promise((r) => setTimeout(r, 600));
    },
    setWritingCover: async (id) => (await calls.writingProjects()).find((p) => p.id === id)!,
    setWritingCoverPicture: async (id, bytes, extension) => {
      const picture = `picture:made-${crypto.randomUUID()}.${extension}`;
      pictures.set(picture, URL.createObjectURL(new Blob([bytes as BlobPart], { type: extension === "png" ? "image/png" : "image/jpeg" })));
      const row = tables.writing_projects.get(id)!;
      await store.write("writing_project", { ...row, cover: picture, updated_at: new Date().toISOString() });
      return (await calls.writingProjects()).find((p) => p.id === id)!;
    },
    pickWritingCover: async () => null,
    pickEpubSavePath: async (fileName) => fileName,
    saveWritingEpub: async () => {},
  };
}

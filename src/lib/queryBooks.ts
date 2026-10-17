// The Library page's filtering, sorting and paging, done in the page itself.

import type { BookPreview, ItemKind, LibraryPage, LibraryQuery, TagCount } from "../api/types";

/** The kinds of file the Documents page holds (DOCUMENT_FORMATS in the core). */
export const DOCUMENT_FORMATS = ["pdf", "doc", "docx", "txt"];
export const isDocument = (format: string) => DOCUMENT_FORMATS.includes(format.toLowerCase());
/** Audio formats, kept on the Audiobooks page (AUDIO_FORMATS in the core). */
export const AUDIO_FORMATS = ["m4b", "m4a", "mp3", "aac", "ogg", "oga", "opus", "flac", "tbvaudio"];
export const isAudio = (format: string) => AUDIO_FORMATS.includes(format.toLowerCase());
export const kindOf = (format: string): ItemKind => (isAudio(format) ? "audiobooks" : isDocument(format) ? "documents" : "books");
export const ofKind = (b: BookPreview, kind: ItemKind | null | undefined) => !kind || kindOf(b.format) === kind;
const hasAny = (names: string[] | undefined, wanted: string[] | undefined) =>
  !wanted?.length || (names ?? []).some((n) => wanted.some((w) => w.toLowerCase() === n.toLowerCase()));

const articles = /^(the|an|a) /i;
const sortTitle = (b: BookPreview) => b.title.replace(articles, "").toLowerCase();
const byTitle = (a: BookPreview, b: BookPreview) => sortTitle(a).localeCompare(sortTitle(b));
const nullsLast = <T>(a: T | null, b: T | null, cmp: (x: T, y: T) => number) =>
  a === null ? (b === null ? 0 : 1) : b === null ? -1 : cmp(a, b);

/** Mirrors the core's Library query, for the browser preview and the web version. */
export function queryBooks(everything: BookPreview[], q: LibraryQuery, collectionCount: number): LibraryPage {
  const all = everything.filter((b) => ofKind(b, q.kind));
  const search = q.search?.trim().toLowerCase();
  let list = all.filter((b) => {
    if (q.shelf === "favorites" && !b.favorite) return false;
    if (q.shelf === "want_to_read" && !b.wantToRead) return false;
    if ((q.shelf === "in_progress" || q.shelf === "read" || q.shelf === "unread") && b.status !== q.shelf) return false;
    if (q.formats.length && !q.formats.includes(b.format)) return false;
    if (q.location === "on_device" && b.availability === "cloud") return false;
    if (q.location === "cloud_only" && b.availability !== "cloud") return false;
    if (q.tags?.length && !b.tags.some((t) => q.tags!.some((w) => w.toLowerCase() === t.toLowerCase()))) return false;
    if (!hasAny(b.genres, q.genres) || !hasAny(b.authors, q.authors) || !hasAny(b.narrators, q.narrators)) return false;
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
    rating: (a, b) => nullsLast(a.rating, b.rating, (x, y) => y - x) || byTitle(a, b),
    genre: (a, b) =>
      nullsLast(a.genres?.[0] ?? null, b.genres?.[0] ?? null, (x, y) => x.localeCompare(y, undefined, { sensitivity: "base" })) || byTitle(a, b),
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
      collections: collectionCount,
    },
    formats: [...new Set(all.map((b) => b.format))].sort(),
    tags: tagCounts(everything).map((t) => t.name),
    genres: namesIn(all, (b) => b.genres ?? []),
    authors: q.kind === "audiobooks" ? namesIn(all, (b) => b.authors) : [],
    narrators: q.kind === "audiobooks" ? namesIn(all, (b) => b.narrators ?? []) : [],
  };
}

const namesIn = (books: BookPreview[], names: (b: BookPreview) => string[]) =>
  tagCounts(books.map((b) => ({ ...b, tags: names(b) }))).map((t) => t.name);

/** "8h 24m", "41m" or "52s": how long, for people. */
export function formatLength(ms: number | null | undefined): string {
  if (!ms || ms < 0) return "";
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return `${Math.max(1, Math.round(ms / 1000))}s`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

/** Every tag on these books, A to Z, with how many carry it. One spelling per tag. */
export function tagCounts(all: BookPreview[]): TagCount[] {
  const counts = new Map<string, TagCount>();
  for (const b of all)
    for (const t of b.tags) {
      const found = counts.get(t.toLowerCase());
      if (found) found.count++;
      else counts.set(t.toLowerCase(), { name: t, count: 1 });
    }
  return [...counts.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

/** A tag as it's kept: single spaces, at most 40 letters. Null when nothing's left. */
export function cleanTag(tag: string): string | null {
  const t = tag.split(/\s+/).filter(Boolean).join(" ").slice(0, 40);
  return t || null;
}

/** A format as people know it. A folder of audio files kept as one book is "Audio". */
export const formatLabel = (format: string) => (format === "tbvaudio" ? "Audio" : format.toUpperCase());

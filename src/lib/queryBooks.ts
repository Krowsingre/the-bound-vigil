// The Library page's filtering, sorting and paging, done in the page itself.

import type { BookPreview, ItemKind, LibraryExclude, LibraryPage, LibraryQuery, TagCount } from "../api/types";

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

/** Whether a book has any of the things chosen to leave out. */
function excluded(b: BookPreview, x: LibraryExclude): boolean {
  const any = (has: (string | null | undefined)[], out: string[]) => {
    const o = out.map((v) => v.toLowerCase());
    return has.some((v) => v != null && o.includes(v.toLowerCase()));
  };
  return (
    any([b.format], x.formats) ||
    any(b.tags, x.tags) ||
    any(b.genres ?? [], x.genres) ||
    any(b.authors, x.authors) ||
    any(b.narrators ?? [], x.narrators) ||
    any([b.series], x.series) ||
    any([b.language], x.languages)
  );
}

/** Mirrors the core's Library query, for the browser preview and the web version. */
export function queryBooks(everything: BookPreview[], q: LibraryQuery, collectionCount: number): LibraryPage {
  const all = everything.filter((b) => ofKind(b, q.kind));
  const search = q.search?.trim().toLowerCase();
  const only = q.ids && new Set(q.ids);
  let list = all.filter((b) => {
    if (only && !only.has(b.id)) return false;
    if (q.shelf === "favorites" && !b.favorite) return false;
    if (q.shelf === "want_to_read" && !b.wantToRead) return false;
    if (q.shelf === "send_to_device" && !b.phoneWanted) return false;
    if ((q.shelf === "in_progress" || q.shelf === "read" || q.shelf === "unread") && b.status !== q.shelf) return false;
    if (q.formats.length && !q.formats.includes(b.format)) return false;
    if (q.location === "on_device" && b.availability === "cloud") return false;
    if (q.location === "cloud_only" && b.availability !== "cloud") return false;
    if (q.tags?.length && !b.tags.some((t) => q.tags!.some((w) => w.toLowerCase() === t.toLowerCase()))) return false;
    if (q.languages?.length && !q.languages.includes(b.language ?? "")) return false;
    if (q.downloadable && !b.inCloud) return false;
    if (q.hideRead && (b.status === "read" || b.status === "dropped")) return false;
    if (q.pinned != null && !!b.pinnedAt !== q.pinned) return false;
    if (q.audioType && (b.audioType ?? "audiobook") !== q.audioType) return false;
    if (q.paired != null && !!b.paired !== q.paired) return false;
    if (!hasAny(b.genres, q.genres) || !hasAny(b.authors, q.authors) || !hasAny(b.narrators, q.narrators)) return false;
    if (q.series?.length && !q.series.some((s) => s.trim().toLowerCase() === (b.series ?? "").trim().toLowerCase())) return false;
    if (q.exclude && excluded(b, q.exclude)) return false;
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
  const pins = (a: BookPreview, b: BookPreview) => (q.pinnedFirst ? Number(!!b.pinnedAt) - Number(!!a.pinnedAt) : 0);
  list = [...list].sort((a, b) => pins(a, b) || sorters[q.sort](a, b));
  const seriesCounts: Record<string, number> = {};
  if (q.groupSeries) {
    const stacks = new Map<string, BookPreview>();
    list = list.filter((book) => {
      const name = book.series?.trim().toLowerCase();
      if (!name || (q.pinnedFirst && book.pinnedAt)) return true;
      const first = stacks.get(name);
      if (first) {
        seriesCounts[first.id] += 1;
        return false;
      }
      stacks.set(name, book);
      seriesCounts[book.id] = 1;
      return true;
    });
    const titleOf = (book: BookPreview) => seriesCounts[book.id] && book.series
      ? { ...book, title: book.series.trim() } : book;
    list.sort((a, b) => pins(a, b) || (q.mixSeries
      ? q.sort === "title" ? byTitle(titleOf(a), titleOf(b)) || a.id.localeCompare(b.id) : 0
      : Number(Boolean(seriesCounts[b.id])) - Number(Boolean(seriesCounts[a.id]))));
  }
  const pageSize = q.pageSize || 24;
  const page = Math.min(q.page, Math.max(0, Math.ceil(list.length / pageSize) - 1));
  const books = list.slice(page * pageSize, (page + 1) * pageSize);
  const seriesCovers: Record<string, BookPreview> = {};
  const seriesKey = (b: BookPreview) => b.series?.trim().toLowerCase();
  const finished = (b: BookPreview) => Number(b.status === "read" || b.status === "dropped");
  for (const book of books) {
    if (!seriesCounts[book.id]) continue;
    const name = seriesKey(book);
    const chosen = name && q.seriesCoverChoices?.[name];
    const candidates = all.filter((b) => seriesKey(b) === name);
    const cover = candidates.find((b) => b.id === chosen) ?? candidates.sort((a, b) =>
      finished(a) - finished(b) || sorters.series(a, b) || a.id.localeCompare(b.id)
    )[0];
    if (cover) seriesCovers[book.id] = cover;
  }
  return {
    books,
    seriesCovers,
    seriesNames: q.omitFacets ? [] : namesIn(all, (book) => book.series ? [book.series] : []),
    seriesCounts: Object.fromEntries(books.flatMap((book) => seriesCounts[book.id] ? [[book.id, seriesCounts[book.id]]] : [])),
    total: list.length,
    page,
    pageSize,
    counts: q.omitFacets ? { all: 0, favorites: 0, wantToRead: 0, sendToDevice: 0, inProgress: 0, read: 0, unread: 0, collections: 0 } : {
      all: all.length,
      favorites: all.filter((b) => b.favorite).length,
      wantToRead: all.filter((b) => b.wantToRead).length,
      sendToDevice: all.filter((b) => b.phoneWanted).length,
      inProgress: all.filter((b) => b.status === "in_progress").length,
      read: all.filter((b) => b.status === "read").length,
      unread: all.filter((b) => b.status === "unread").length,
      collections: collectionCount,
    },
    formats: q.omitFacets ? [] : [...new Set(all.map((b) => b.format))].sort(),
    tags: q.omitFacets ? [] : tagCounts(everything).map((t) => t.name),
    genres: q.omitFacets ? [] : namesIn(all, (b) => b.genres ?? []),
    languages: q.omitFacets ? [] : [...new Set(all.flatMap((b) => (b.language ? [b.language] : [])))].sort(),
    authors: !q.omitFacets && q.kind === "audiobooks" ? namesIn(all, (b) => b.authors) : [],
    narrators: !q.omitFacets && q.kind === "audiobooks" ? namesIn(all, (b) => b.narrators ?? []) : [],
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

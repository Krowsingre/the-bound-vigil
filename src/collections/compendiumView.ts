// Filtering and sorting inside one compendium. The books are all here
// already, so it's done on the page: nothing changes the compendium itself.

import type { BookPreview } from "../api/types";
import { isAudio } from "../lib/queryBooks";

export type CompendiumShow = "all" | "ebooks" | "audiobooks" | "unread" | "in_progress" | "read";
export type CompendiumSort = "own" | "title" | "author" | "added" | "opened" | "progress" | "rating";

export const SHOW_OPTIONS: { value: CompendiumShow; label: string }[] = [
  { value: "all", label: "All books" },
  { value: "ebooks", label: "Ebooks" },
  { value: "audiobooks", label: "Audiobooks" },
  { value: "unread", label: "Not started" },
  { value: "in_progress", label: "In progress" },
  { value: "read", label: "Read" },
];

export const SORT_OPTIONS: { value: CompendiumSort; label: string }[] = [
  { value: "own", label: "Compendium order" },
  { value: "title", label: "Title A–Z" },
  { value: "author", label: "Author A–Z" },
  { value: "added", label: "Recently added" },
  { value: "opened", label: "Recently read" },
  { value: "progress", label: "Furthest along" },
  { value: "rating", label: "Highest rated" },
];

const fold = (text: string) => text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
const compare = new Intl.Collator(undefined, { sensitivity: "base", numeric: true }).compare;
/** Surname first, so "Jane Austen" sorts under A. */
const authorKey = (b: BookPreview) => {
  const first = b.authors[0] ?? "";
  if (first.includes(",")) return first;
  const parts = first.trim().split(/\s+/);
  return parts.length > 1 ? `${parts.at(-1)}, ${parts.slice(0, -1).join(" ")}` : first;
};
/** Newest first; books with no date go last. */
const newest = (a: string | null, b: string | null) => (a === b ? 0 : !a ? 1 : !b ? -1 : a < b ? 1 : -1);

export function viewCompendium(books: BookPreview[], words: string, show: CompendiumShow, sort: CompendiumSort): BookPreview[] {
  const terms = fold(words).split(/\s+/).filter(Boolean);
  const shown = books.filter((b) => {
    if (show === "ebooks" && isAudio(b.format)) return false;
    if (show === "audiobooks" && !isAudio(b.format)) return false;
    if (show === "unread" && b.status !== "unread") return false;
    if (show === "in_progress" && b.status !== "in_progress") return false;
    if (show === "read" && b.status !== "read" && b.status !== "dropped") return false;
    if (!terms.length) return true;
    const text = fold([b.title, ...b.authors, b.series ?? "", ...(b.narrators ?? []), ...b.tags].join(" "));
    return terms.every((t) => text.includes(t));
  });
  if (sort === "own") return shown;
  const title = (a: BookPreview, b: BookPreview) => compare(a.title, b.title);
  const by: Record<Exclude<CompendiumSort, "own">, (a: BookPreview, b: BookPreview) => number> = {
    title,
    author: (a, b) => compare(authorKey(a), authorKey(b)) || title(a, b),
    added: (a, b) => newest(a.addedAt, b.addedAt) || title(a, b),
    opened: (a, b) => newest(a.lastOpenedAt, b.lastOpenedAt) || title(a, b),
    progress: (a, b) => (b.totalProgression ?? -1) - (a.totalProgression ?? -1) || title(a, b),
    rating: (a, b) => (b.rating ?? -1) - (a.rating ?? -1) || title(a, b),
  };
  return [...shown].sort(by[sort]);
}

const SORT_KEY = "tbv.compendium.sort";

/** Each compendium remembers its own sort, on this device. */
export function savedSort(key: string): CompendiumSort {
  try {
    const all = JSON.parse(localStorage.getItem(SORT_KEY) ?? "{}") as Record<string, string>;
    const value = all[key];
    return SORT_OPTIONS.some((o) => o.value === value) ? (value as CompendiumSort) : "own";
  } catch {
    return "own";
  }
}

export function saveSort(key: string, sort: CompendiumSort) {
  try {
    const all = JSON.parse(localStorage.getItem(SORT_KEY) ?? "{}") as Record<string, string>;
    if (sort === "own") delete all[key];
    else all[key] = sort;
    localStorage.setItem(SORT_KEY, JSON.stringify(all));
  } catch {
    // Private windows: the sort just isn't remembered.
  }
}

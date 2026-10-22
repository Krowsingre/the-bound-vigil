import type { ItemKind, Location, Shelf, SortOrder } from "../api/types";

export type LibraryTab = Shelf | "collections";
export type Layout = "grid" | "list" | "compact";

/** What the Library page is showing. Search lives in the header, so it is kept apart. */
export interface LibraryView {
  tab: LibraryTab;
  sort: SortOrder;
  formats: string[];
  location: Location | null;
  /** Books with any of these tags. */
  tags: string[];
  /** Books with any of these genres. */
  genres: string[];
  /** Books in any of these languages (short codes). */
  languages: string[];
  /** Phone version: only books that can be downloaded here. */
  downloadable: boolean;
  /** Books by any of these authors. */
  authors: string[];
  /** Books in any of these series (Show series, in a book's menu). */
  series: string[];
  /** Audiobooks read by any of these narrators. */
  narrators: string[];
  page: number;
  layout: Layout;
}

export const PAGE_SIZE = 24;

/** Every filter off. */
export const NO_FILTERS: Partial<LibraryView> = {
  formats: [],
  location: null,
  tags: [],
  genres: [],
  languages: [],
  downloadable: false,
  authors: [],
  series: [],
  narrators: [],
};

export const TABS: { tab: LibraryTab; label: string }[] = [
  { tab: "all", label: "All books" },
  { tab: "favorites", label: "Favourites" },
  { tab: "want_to_read", label: "Up next" },
  { tab: "in_progress", label: "In progress" },
  { tab: "read", label: "Read" },
  { tab: "unread", label: "Unread" },
  { tab: "collections", label: "Collections" },
];

export const SORTS: { sort: SortOrder; label: string }[] = [
  { sort: "recently_added", label: "Recently added" },
  { sort: "recently_opened", label: "Recently opened" },
  { sort: "title", label: "Title" },
  { sort: "author", label: "Author" },
  { sort: "series", label: "Series" },
  { sort: "progress", label: "Progress" },
  { sort: "rating", label: "Your rating" },
  { sort: "genre", label: "Genre" },
];

const KEY = "tbv.libraryView";
const keyOf = (kind: ItemKind) => (kind === "books" ? KEY : `tbv.${kind}View`);

/** Sort and layout are remembered on this device, for each page of books; the rest starts fresh. */
export function initialView(kind: ItemKind = "books"): LibraryView {
  const view: LibraryView = { tab: "all", sort: "recently_added", formats: [], location: null, tags: [], genres: [], languages: [], downloadable: false, authors: [], series: [], narrators: [], page: 0, layout: "grid" };
  try {
    const saved = JSON.parse(localStorage.getItem(keyOf(kind)) ?? "{}") as Partial<LibraryView>;
    if (SORTS.some((s) => s.sort === saved.sort)) view.sort = saved.sort!;
    if (saved.layout === "grid" || saved.layout === "list" || saved.layout === "compact") view.layout = saved.layout;
  } catch {
    /* fall back to defaults */
  }
  return view;
}

export function rememberView(view: LibraryView, kind: ItemKind = "books") {
  try {
    localStorage.setItem(keyOf(kind), JSON.stringify({ sort: view.sort, layout: view.layout }));
  } catch {
    /* the choice just won't be remembered */
  }
}

/** Page numbers to show, with null for a gap: 1 … 4 5 6 … 12. */
export function pageItems(current: number, count: number): (number | null)[] {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i);
  const keep = new Set([0, count - 1, current - 1, current, current + 1]);
  if (current <= 2) [1, 2, 3].forEach((p) => keep.add(p));
  if (current >= count - 3) [count - 4, count - 3, count - 2].forEach((p) => keep.add(p));
  const pages = [...keep].filter((p) => p >= 0 && p < count).sort((a, b) => a - b);
  const items: (number | null)[] = [];
  pages.forEach((p, i) => {
    if (i > 0 && p - pages[i - 1] > 1) items.push(null);
    items.push(p);
  });
  return items;
}

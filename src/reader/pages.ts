// Fixed page numbers. An eBook has no printed pages, so TBV counts one page
// for every 1,500 bytes of the book's text files (the page engine's
// "locations"). The count depends only on the file, so page 178 is the same
// place on every device, window size and text size.

import type { TocItem } from "../vendor/foliate-js/view.js";

export interface PagePosition {
  /** One-based. */
  page: number;
  total: number;
}

export function pageOf(location: { current: number; total: number } | undefined | null): PagePosition | null {
  if (!location || location.total <= 0) return null;
  return { page: Math.min(location.total, location.current + 1), total: location.total };
}

/** The page a position in the book falls on, from its fraction (0–1). */
export function pageAtFraction(fraction: number, total: number): number {
  if (total <= 0) return 1;
  return Math.min(total, Math.max(1, Math.floor(fraction * total) + 1));
}

const number = new Intl.NumberFormat();
export const formatPage = (p: PagePosition) => `Page ${number.format(p.page)} of ${number.format(p.total)}`;
export const formatNumber = (n: number) => number.format(n);

export interface ContentsEntry {
  id: string;
  label: string;
  href: string;
  depth: number;
  /** One-based page where the entry starts, when it can be worked out. */
  page: number | null;
  /** Ids of the entries this one sits inside, outermost first. */
  parents: string[];
  hasChildren: boolean;
}

/**
 * Flattens the book's table of contents, numbering each entry's start page.
 * `sectionOf` maps an href to its section (file) index, and `sectionStarts`
 * gives each section's starting fraction of the book.
 */
export function contentsEntries(
  toc: TocItem[] | undefined,
  sectionOf: (href: string) => number | null,
  sectionStarts: number[],
  totalPages: number,
): ContentsEntry[] {
  const out: ContentsEntry[] = [];
  const walk = (items: TocItem[], depth: number, parents: string[]) => {
    items.forEach((item, i) => {
      const id = `${parents.at(-1) ?? "toc"}.${i}`;
      const index = sectionOf(item.href);
      const start = index === null ? undefined : sectionStarts[index];
      const children = item.subitems ?? [];
      out.push({
        id,
        label: item.label?.trim() || "Untitled",
        href: item.href,
        depth,
        page: start === undefined || totalPages <= 0 ? null : pageAtFraction(start, totalPages),
        parents,
        hasChildren: children.length > 0,
      });
      if (children.length) walk(children, depth + 1, [...parents, id]);
    });
  };
  walk(toc ?? [], 0, []);
  return out;
}

/** The entry for the reader's current place: the last one whose href matches. */
export function currentEntry(entries: ContentsEntry[], href: string | undefined): ContentsEntry | null {
  if (!href) return null;
  for (let i = entries.length - 1; i >= 0; i--) if (entries[i].href === href) return entries[i];
  return null;
}

/** A place to come back to after a jump (contents, search, a highlight, the slider). */
export interface Jump {
  cfi: string;
  page: number | null;
}

/** Keeps the most recent places, newest last, never two of the same in a row. */
export function pushJump(stack: Jump[], jump: Jump, limit = 20): Jump[] {
  if (stack.at(-1)?.cfi === jump.cfi) return stack;
  return [...stack, jump].slice(-limit);
}

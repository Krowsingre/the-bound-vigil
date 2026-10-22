// Cleaning up duplicate books by rule: which copy of each set stays, which go,
// and which sets to look at. Worked out here so the plan can be shown and
// changed before anything is deleted.

import type { DuplicateGroup } from "../api/types";

export type DuplicateBook = DuplicateGroup["books"][number];

/** The formats in the order a copy is preferred, best first, until changed. */
export const DEFAULT_FORMAT_ORDER = ["epub", "kepub", "azw3", "azw", "mobi", "fb2", "cbz", "cbr", "pdf", "docx", "doc", "txt"];

/**
 * Something of yours lives with this copy: notes, highlights, progress, a
 * rating, a favourite, tags, or a place on a collection or shelf (Up next
 * too). When a copy goes, all of it moves to the copy that stays.
 */
export function hasYourReading(book: DuplicateBook): boolean {
  return (
    book.notes > 0 ||
    book.status === "in_progress" ||
    book.status === "read" ||
    (book.totalProgression ?? 0) > 0 ||
    book.rating != null ||
    book.favorite ||
    book.wantToRead ||
    book.tags.length > 0 ||
    book.collections > 0
  );
}

/**
 * Every format in the order to prefer them: the saved order as it is (formats
 * not in these sets keep their places), then any new ones, A to Z.
 */
export function formatOrder(saved: string[], groups: DuplicateGroup[]): string[] {
  const seen = new Set(groups.flatMap((g) => g.books.map((b) => b.format.toLowerCase())));
  const order = saved.map((f) => f.toLowerCase()).filter((f, i, all) => all.indexOf(f) === i);
  return [...order, ...[...seen].filter((f) => !order.includes(f)).sort()];
}

export interface CleanupStep {
  key: string;
  keep: DuplicateBook;
  remove: DuplicateBook[];
  /** Why this copy stays, in words. */
  why: string;
}

export interface CleanupPlan {
  steps: CleanupStep[];
}

const rank = (order: string[], format: string) => {
  const i = order.indexOf(format.toLowerCase());
  return i < 0 ? order.length : i;
};

/** The copy of a set to keep: the best-ranked format, then the largest file, then the first added. */
export function bestCopy(books: DuplicateBook[], order: string[]): DuplicateBook {
  return [...books].sort(
    (a, b) => rank(order, a.format) - rank(order, b.format) || b.fileSize - a.fileSize || a.addedAt.localeCompare(b.addedAt),
  )[0];
}

/**
 * Which copy of each set stays. Your notes, highlights and place on the
 * copies that go move to it, so they belong to the book whichever copy it
 * is; a copy that alone holds them stays, as they fit its own file exactly.
 */
export function planCleanup(groups: DuplicateGroup[], order: string[]): CleanupPlan {
  const plan: CleanupPlan = { steps: [] };
  for (const g of groups) {
    const read = g.books.filter(hasYourReading);
    const keep = read.length === 1 ? read[0] : bestCopy(g.books, order);
    const sameFormat = g.books.every((b) => b.format.toLowerCase() === keep.format.toLowerCase());
    const remove = g.books.filter((b) => b.id !== keep.id);
    const why =
      read.length === 1
        ? "It has your notes, progress, rating, tags or collections."
        : sameFormat
          ? "The largest file."
          : `${keep.format.toUpperCase()} comes first in your order.`;
    const moving = remove.some(hasYourReading) ? " Your notes, highlights and place on the others move to it." : "";
    plan.steps.push({ key: g.key, keep, remove, why: why + moving });
  }
  return plan;
}

/** The copy a set keeps once `gone` leave it: the best of the rest. */
export function keeperAfter(g: DuplicateGroup, gone: DuplicateBook[], order: string[]): DuplicateBook | null {
  const rest = g.books.filter((b) => !gone.some((x) => x.id === b.id));
  return rest.length ? bestCopy(rest, order) : null;
}

export type FormatFilter = { kind: "all" } | { kind: "same" } | { kind: "exactly"; formats: string[] };

/** The formats of a set, each once, A to Z. */
export function setFormats(g: DuplicateGroup): string[] {
  return [...new Set(g.books.map((b) => b.format.toLowerCase()))].sort();
}

export function matchesFilter(g: DuplicateGroup, filter: FormatFilter): boolean {
  const formats = setFormats(g);
  if (filter.kind === "same") return formats.length === 1;
  if (filter.kind === "exactly") {
    const wanted = [...new Set(filter.formats.map((f) => f.toLowerCase()))].sort();
    return wanted.length === formats.length && wanted.every((f, i) => f === formats[i]);
  }
  return true;
}

/**
 * Every copy of `format` in these sets that can go, each with the copy its
 * notes and place move to: a set always keeps at least one copy (the best of
 * that format, when all are that format).
 */
export function copiesOfFormat(groups: DuplicateGroup[], format: string, order: string[]): { remove: DuplicateBook[]; into: Map<string, DuplicateBook> } {
  const f = format.toLowerCase();
  const remove: DuplicateBook[] = [];
  const into = new Map<string, DuplicateBook>();
  for (const g of groups) {
    const ofFormat = g.books.filter((b) => b.format.toLowerCase() === f);
    if (!ofFormat.length) continue;
    // All one format: the best copy stays, so the book isn't lost.
    const spared = ofFormat.length === g.books.length ? bestCopy(ofFormat, order) : null;
    const going = ofFormat.filter((b) => b !== spared);
    const keeper = keeperAfter(g, going, order);
    for (const b of going) {
      remove.push(b);
      if (keeper) into.set(b.id, keeper);
    }
  }
  return { remove, into };
}

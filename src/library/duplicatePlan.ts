// Cleaning up duplicate books by rule: which copy of each set stays, which go,
// and which sets to look at. Worked out here so the plan can be shown and
// changed before anything is deleted.

import type { DuplicateGroup } from "../api/types";

export type DuplicateBook = DuplicateGroup["books"][number];

/** The formats in the order a copy is preferred, best first, until changed. */
export const DEFAULT_FORMAT_ORDER = ["epub", "kepub", "azw3", "azw", "mobi", "fb2", "cbz", "cbr", "pdf", "docx", "doc", "txt"];

/** Your notes, highlights or reading progress live with this copy. */
export function hasYourReading(book: DuplicateBook): boolean {
  return book.notes > 0 || book.status === "in_progress" || book.status === "read" || (book.totalProgression ?? 0) > 0;
}

/** Every format in the order to prefer them: the saved order, then any others seen, A to Z. */
export function formatOrder(saved: string[], groups: DuplicateGroup[]): string[] {
  const seen = new Set(groups.flatMap((g) => g.books.map((b) => b.format.toLowerCase())));
  const order = saved.map((f) => f.toLowerCase()).filter((f, i, all) => all.indexOf(f) === i);
  const rest = [...seen].filter((f) => !order.includes(f)).sort();
  return [...order.filter((f) => seen.has(f)), ...rest, ...order.filter((f) => !seen.has(f))];
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
  /** Sets where more than one copy holds your notes or progress: left for you to choose. */
  yours: DuplicateGroup[];
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

export function planCleanup(groups: DuplicateGroup[], order: string[]): CleanupPlan {
  const plan: CleanupPlan = { steps: [], yours: [] };
  for (const g of groups) {
    const read = g.books.filter(hasYourReading);
    if (read.length > 1) {
      plan.yours.push(g);
      continue;
    }
    const keep = read[0] ?? bestCopy(g.books, order);
    const sameFormat = g.books.every((b) => b.format.toLowerCase() === keep.format.toLowerCase());
    const why = read.length
      ? "It has your notes or progress."
      : sameFormat
        ? "The largest file."
        : `${keep.format.toUpperCase()} comes first in your order.`;
    plan.steps.push({ key: g.key, keep, remove: g.books.filter((b) => b.id !== keep.id), why });
  }
  return plan;
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
 * Every copy of `format` in these sets that can go: a set always keeps at
 * least one copy (the best of that format, when all are that format), and
 * copies with your notes or progress stay.
 */
export function copiesOfFormat(groups: DuplicateGroup[], format: string, order: string[]): { remove: DuplicateBook[]; keptForReading: number } {
  const f = format.toLowerCase();
  const remove: DuplicateBook[] = [];
  let keptForReading = 0;
  for (const g of groups) {
    const ofFormat = g.books.filter((b) => b.format.toLowerCase() === f);
    if (!ofFormat.length) continue;
    // All one format: the best copy stays, so the book isn't lost.
    const spared = ofFormat.length === g.books.length ? bestCopy(ofFormat, order) : null;
    for (const b of ofFormat) {
      if (b === spared) continue;
      if (hasYourReading(b)) keptForReading++;
      else remove.push(b);
    }
  }
  return { remove, keptForReading };
}

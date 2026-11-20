// What kind of book a book in Quire is, as the writer says (embre, 18
// November): picked in Book details, or typed in as their own. Books that
// never had one chosen show what their template was, and are never changed
// for the writer.

import type { BookKind } from "./epub";

export const BOOK_TYPES = [
  { type: "novel", label: "Novel" },
  { type: "novella", label: "Novella" },
  { type: "short_stories", label: "Short stories" },
  { type: "poetry", label: "Poetry" },
  { type: "anthology", label: "Anthology" },
  { type: "nonfiction", label: "Non-fiction" },
  { type: "memoir", label: "Memoir" },
  { type: "none", label: "None" },
  { type: "custom", label: "Custom" },
] as const;

export type BookTypeKey = (typeof BOOK_TYPES)[number]["type"];

/** The type chosen in Book details; `custom` is the writer's own words when the type is "custom". */
export interface BookType {
  type: BookTypeKey;
  custom?: string;
}

const KEYS = new Set<string>(BOOK_TYPES.map((t) => t.type));

export function readBookType(raw: unknown): BookType | null {
  if (!raw || typeof raw !== "object") return null;
  const { type, custom } = raw as { type?: unknown; custom?: unknown };
  if (typeof type !== "string" || !KEYS.has(type)) return null;
  return type === "custom" ? { type, custom: typeof custom === "string" ? custom.trim().slice(0, 60) : "" } : { type: type as BookTypeKey };
}

/** The type a book started from (its template), in the same words. */
const FROM_TEMPLATE: Record<BookKind, BookTypeKey> = { blank: "none", novel: "novel", collection: "short_stories", nonfiction: "nonfiction" };

/** What Book details shows as the book's type: the one chosen, else its template's, else none. */
export function currentBookType(chosen: BookType | null | undefined, kind: BookKind | null | undefined): BookType {
  return chosen ?? { type: kind ? FROM_TEMPLATE[kind] : "none" };
}

/** The words on the book's card, or null for none. */
export function bookTypeLabel(chosen: BookType | null | undefined, kind: BookKind | null | undefined): string | null {
  const t = currentBookType(chosen, kind);
  if (t.type === "none") return null;
  if (t.type === "custom") return t.custom?.trim() || null;
  return BOOK_TYPES.find((b) => b.type === t.type)?.label ?? null;
}

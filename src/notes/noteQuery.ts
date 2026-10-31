// Which notes a query keeps, for the browser preview and the web version
// (the app asks its core, notes.rs, which does the same).

import type { NoteItem, NotesPage, NotesQuery } from "../api/types";

/** Tags as written: trimmed, without repeats, the first spelling kept. */
export function cleanTags(tags: string[]): string[] {
  const kept: string[] = [];
  for (const raw of tags) {
    const t = raw.trim().replace(/^#+/, "").trim().slice(0, 40);
    if (t && !kept.some((k) => k.toLowerCase() === t.toLowerCase())) kept.push(t);
  }
  return kept;
}

function inTab(n: NoteItem, tab: NotesQuery["tab"]): boolean {
  if (tab === "all") return true;
  if (tab === "highlights") return n.kind === "highlight";
  if (tab === "annotations") return n.kind === "annotation";
  // Everything from a book: notes about it, and highlights in it.
  if (tab === "book_notes") return n.kind !== "personal";
  return n.kind === "personal";
}

/** The notes page for a list of every note, as the core makes it. */
export function notesPageOf(list: NoteItem[], q: NotesQuery): NotesPage {
  const books: NonNullable<NoteItem["book"]>[] = [];
  for (const n of list) if (n.book && !books.some((b) => b.id === n.book!.id)) books.push(n.book);
  const tags = cleanTags(list.flatMap((n) => n.tags ?? [])).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  const s = q.search?.trim().toLowerCase();
  const tag = q.tag?.toLowerCase();
  let notes = list.filter(
    (n) =>
      inTab(n, q.tab) &&
      (!q.bookId || n.book?.id === q.bookId) &&
      (!q.colors.length || (n.color && q.colors.includes(n.color))) &&
      (!tag || (n.tags ?? []).some((t) => t.toLowerCase() === tag)) &&
      (!q.since || n.updatedAt >= q.since) &&
      (!s ||
        [n.excerpt, n.note, n.title, n.book?.title, n.locator?.chapter, ...(n.book?.authors ?? []), ...(n.tags ?? [])].some((t) =>
          t?.toLowerCase().includes(s),
        )),
  );
  if (q.sort === "updated") notes = [...notes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (q.sort === "book")
    notes = [...notes].sort(
      (a, b) =>
        Number(!a.book) - Number(!b.book) ||
        (a.book?.title ?? "").localeCompare(b.book?.title ?? "") ||
        (a.locator?.totalProgression ?? -1) - (b.locator?.totalProgression ?? -1),
    );
  return {
    notes,
    counts: {
      all: list.length,
      highlights: list.filter((n) => n.kind === "highlight").length,
      annotations: list.filter((n) => n.kind === "annotation").length,
      bookNotes: list.filter((n) => n.kind === "book_note").length,
      personal: list.filter((n) => n.kind === "personal").length,
    },
    books: books.sort((a, b) => a.title.localeCompare(b.title)),
    tags,
  };
}

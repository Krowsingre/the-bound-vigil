// Labels and small helpers shared by the Notes page.

import type { NoteItem, NoteKind } from "../api/types";

export const KIND_LABEL: Record<NoteKind, string> = {
  highlight: "Highlight",
  annotation: "Annotation",
  book_note: "Book note",
  personal: "Personal note",
};

/** "Chapter 8 · p. 317", as much of it as is known. */
export function placeLine(n: NoteItem): string {
  const parts: string[] = [];
  if (n.locator?.chapter) parts.push(n.locator.chapter);
  if (n.locator?.pageIndex != null) parts.push(`p. ${(n.locator.pageIndex + 1).toLocaleString()}`);
  return parts.join(" · ");
}

/** The words to show for a note in a list. */
export function noteHeadline(n: NoteItem): { quote: string | null; text: string | null } {
  switch (n.kind) {
    case "highlight":
      return { quote: n.excerpt, text: null };
    case "annotation":
      return { quote: n.excerpt || null, text: n.note };
    case "book_note":
      return { quote: null, text: n.note };
    case "personal":
      return { quote: null, text: n.note };
  }
}

/** What a personal note is called: its title, or its first words. */
export function personalTitle(n: NoteItem): string {
  if (n.title) return n.title;
  const words = (n.note ?? "").trim().split(/\s+/).slice(0, 6).join(" ");
  return words ? `${words}…` : "Untitled note";
}

// Notes going into a book you're writing: a note as a chapter's words, and a
// highlight as a quote with the book it came from underneath.

import type { NoteItem } from "../api/types";

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Words as paragraphs: a blank line starts a new one, a single line break stays a break. */
export function paragraphs(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escape(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/** Who and what a quote is from, as it's written under it. */
export function sourceLine(note: NoteItem): string | null {
  if (!note.book) return null;
  const authors = note.book.authors.filter(Boolean).join(", ");
  return authors ? `${note.book.title}, ${authors}` : note.book.title;
}

/** A note as a quote: the highlighted words, the book underneath, then what you wrote. */
export function quoteHtml(note: NoteItem): string {
  const source = sourceLine(note);
  const quoted = note.excerpt.trim() ? paragraphs(note.excerpt) : "";
  const quote = quoted ? `<blockquote>${quoted}${source ? `<p>— ${escape(source)}</p>` : ""}</blockquote>` : "";
  return quote + paragraphs(note.note ?? "");
}

/** A chapter's title from a note: its own title, or its first words. */
export function chapterTitle(note: NoteItem): string {
  const own = note.title?.trim();
  if (own) return own.slice(0, 200);
  const first = (note.note ?? note.excerpt).trim().split(/\s+/).slice(0, 6).join(" ");
  return first ? `${first}…` : "From my notes";
}

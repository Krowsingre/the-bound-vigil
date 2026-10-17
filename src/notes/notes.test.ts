import { describe, expect, it } from "vitest";
import type { NoteItem } from "../api/types";
import { noteHeadline, personalTitle, placeLine } from "./noteInfo";

const note = (over: Partial<NoteItem>): NoteItem => ({
  id: "n",
  kind: "highlight",
  book: null,
  excerpt: "",
  note: null,
  title: null,
  color: null,
  locator: null,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
  ...over,
});

describe("notes", () => {
  it("says where a note is, as far as it knows", () => {
    expect(placeLine(note({ locator: { chapter: "Chapter 8", pageIndex: 316 } }))).toBe("Chapter 8 · p. 317");
    expect(placeLine(note({ locator: { pageIndex: 0 } }))).toBe("p. 1");
    expect(placeLine(note({}))).toBe("");
  });

  it("shows the highlighted words and your own", () => {
    expect(noteHeadline(note({ excerpt: "words" }))).toEqual({ quote: "words", text: null });
    expect(noteHeadline(note({ kind: "annotation", excerpt: "words", note: "mine" }))).toEqual({ quote: "words", text: "mine" });
    expect(noteHeadline(note({ kind: "book_note", note: "about it" }))).toEqual({ quote: null, text: "about it" });
  });

  it("names a personal note by its title or first words", () => {
    expect(personalTitle(note({ kind: "personal", title: "Plan" }))).toBe("Plan");
    expect(personalTitle(note({ kind: "personal", note: "one two three four five six seven" }))).toBe("one two three four five six…");
    expect(personalTitle(note({ kind: "personal" }))).toBe("Untitled note");
  });
});

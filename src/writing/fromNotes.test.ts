import { describe, expect, it } from "vitest";
import type { NoteItem } from "../api/types";
import { chapterTitle, paragraphs, quoteHtml } from "./fromNotes";

const note = (part: Partial<NoteItem>): NoteItem => ({
  id: "n1",
  kind: "highlight",
  book: null,
  excerpt: "",
  note: null,
  title: null,
  color: null,
  locator: null,
  createdAt: "2026-10-23T00:00:00Z" as NoteItem["createdAt"],
  updatedAt: "2026-10-23T00:00:00Z" as NoteItem["updatedAt"],
  ...part,
});

describe("notes into writing", () => {
  it("keeps paragraphs and line breaks, and escapes the words", () => {
    expect(paragraphs("One <b>\nline\n\n\nTwo")).toBe("<p>One &lt;b&gt;<br>line</p><p>Two</p>");
  });

  it("quotes a highlight with its book underneath", () => {
    const html = quoteHtml(
      note({ excerpt: "It was the best of times.", note: "Opening line", book: { id: "b" as never, title: "A Tale of Two Cities", authors: ["Charles Dickens"], coverPath: null } }),
    );
    expect(html).toBe("<blockquote><p>It was the best of times.</p><p>— A Tale of Two Cities, Charles Dickens</p></blockquote><p>Opening line</p>");
  });

  it("titles a chapter from the note", () => {
    expect(chapterTitle(note({ kind: "personal", title: "Ideas" }))).toBe("Ideas");
    expect(chapterTitle(note({ kind: "personal", note: "one two three four five six seven" }))).toBe("one two three four five six…");
    expect(chapterTitle(note({}))).toBe("From my notes");
  });
});

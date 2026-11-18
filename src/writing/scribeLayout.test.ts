import { describe, expect, it } from "vitest";
import { plainText, searchPages } from "./Writing";
import { readPage, writePage } from "./pages";
import type { WritingChapter } from "../api/types";

const page = (id: string, title: string, body: string) => ({ id, title, body, role: "chapter", page: "{}" }) as unknown as WritingChapter;

describe("Search this book", () => {
  it("reads a page's words as plain text", () => {
    expect(plainText("<p>Rain &amp; <em>ash</em></p><p>road</p>")).toBe("Rain & ash road");
  });
  it("lists the pages a search is on, with how often and the words around it", () => {
    const found = searchPages([page("a", "Arrival", "<p>The lamps burned. More lamps.</p>"), page("b", "Leaving", "<p>Dark.</p>")], "LAMPS");
    expect(found.map((f) => [f.chapter.id, f.count])).toEqual([["a", 2]]);
    expect(found[0].match).toBe("lamps");
    expect(searchPages([page("a", "A", "<p>x</p>")], "  ")).toEqual([]);
  });
});

describe("A page's title position", () => {
  it("is kept only when set, and follows the book otherwise", () => {
    expect(readPage("{}").titles).toBeNull();
    const right = writePage({ ...readPage("{}"), titles: "right" });
    expect(readPage(right).titles).toBe("right");
    expect(readPage('{"titles":"middle"}').titles).toBeNull();
    expect(writePage(readPage("{}"))).not.toContain("titles");
  });
});

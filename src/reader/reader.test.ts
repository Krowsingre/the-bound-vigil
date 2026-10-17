import { describe, expect, it } from "vitest";
import type { Annotation } from "../api/types";
import { annotationPage, counts, filterAnnotations, isHighlight, isNote } from "./annotations";
import { contentsEntries, currentEntry, pageAtFraction, pageOf, pushJump } from "./pages";
import { DEFAULT_SETTINGS, PAGE_COLORS, parseSettings, readerCss, resolveTheme, SIZE_RANGE } from "./settings";

describe("fixed pages", () => {
  it("numbers pages from one and never past the end", () => {
    expect(pageOf({ current: 0, total: 300 })).toEqual({ page: 1, total: 300 });
    expect(pageOf({ current: 300, total: 300 })).toEqual({ page: 300, total: 300 });
    expect(pageOf({ current: 0, total: 0 })).toBeNull();
    expect(pageOf(null)).toBeNull();
  });

  it("finds the page for a place in the book", () => {
    expect(pageAtFraction(0, 300)).toBe(1);
    expect(pageAtFraction(0.5, 300)).toBe(151);
    expect(pageAtFraction(1, 300)).toBe(300);
    expect(pageAtFraction(0.4, 0)).toBe(1);
  });

  it("flattens the contents with start pages and nesting", () => {
    const toc = [
      { label: "Part One", href: "a.xhtml", subitems: [{ label: " Chapter 1 ", href: "a.xhtml" }, { label: "", href: "b.xhtml" }] },
      { label: "Missing", href: "nowhere.xhtml" },
    ];
    const sections: Record<string, number> = { "a.xhtml": 0, "b.xhtml": 1 };
    const entries = contentsEntries(toc, (h) => sections[h] ?? null, [0, 0.5], 100);
    expect(entries.map((e) => [e.label, e.depth, e.page])).toEqual([
      ["Part One", 0, 1],
      ["Chapter 1", 1, 1],
      ["Untitled", 1, 51],
      ["Missing", 0, null],
    ]);
    expect(entries[0].hasChildren).toBe(true);
    expect(entries[2].parents).toEqual([entries[0].id]);
    expect(currentEntry(entries, "a.xhtml")?.label).toBe("Chapter 1");
    expect(currentEntry(entries, undefined)).toBeNull();
  });

  it("remembers jumps without repeating the same place", () => {
    let stack = pushJump([], { cfi: "a", page: 1 });
    stack = pushJump(stack, { cfi: "a", page: 1 });
    expect(stack).toHaveLength(1);
    for (let i = 0; i < 30; i++) stack = pushJump(stack, { cfi: `c${i}`, page: i }, 5);
    expect(stack.map((j) => j.cfi)).toEqual(["c25", "c26", "c27", "c28", "c29"]);
  });
});

describe("reading settings", () => {
  it("falls back to the defaults for missing or broken settings", () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings("not json")).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('{"font":"comic","flow":"sideways"}')).toEqual(DEFAULT_SETTINGS);
  });

  it("keeps good values and pulls sizes into range", () => {
    const s = parseSettings('{"font":"sans","size":99,"flow":"scrolled","theme":"paper","justify":true}');
    expect(s).toMatchObject({ font: "sans", size: SIZE_RANGE.max, flow: "scrolled", theme: "paper", justify: true });
    expect(parseSettings('{"size":2}').size).toBe(SIZE_RANGE.min);
  });

  it("matches the app's light or dark look when set to auto", () => {
    expect(resolveTheme("auto", true)).toBe("dark");
    expect(resolveTheme("auto", false)).toBe("light");
    expect(resolveTheme("paper", true)).toBe("paper");
  });

  it("uses Lora unless the publisher's fonts are chosen", () => {
    expect(DEFAULT_SETTINGS.font).toBe("lora");
    expect(readerCss(DEFAULT_SETTINGS, PAGE_COLORS.paper)).toContain('"TBV Lora"');
    expect(readerCss({ ...DEFAULT_SETTINGS, font: "publisher" }, PAGE_COLORS.paper)).not.toContain("font-family: \"TBV Lora\"");
  });
});

const ann = (over: Partial<Annotation>): Annotation => ({
  id: Math.random().toString(36),
  bookId: "sha256:b",
  kind: "highlight",
  excerpt: "words",
  note: null,
  color: "rose",
  locator: {},
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
  ...over,
});

describe("highlights and notes", () => {
  const list = [
    ann({ excerpt: "late", locator: { totalProgression: 0.9 }, createdAt: "2026-10-01T00:00:00Z" }),
    ann({ excerpt: "early", note: "A thought", locator: { totalProgression: 0.1, chapter: "Low Tide" }, createdAt: "2026-10-03T00:00:00Z" }),
    ann({ kind: "bookmark", color: null, excerpt: "mark", locator: { totalProgression: 0.5, pageIndex: 41 }, createdAt: "2026-10-02T00:00:00Z" }),
  ];

  it("counts a highlight with a note as a note", () => {
    expect(isNote(list[1])).toBe(true);
    expect(isHighlight(list[1])).toBe(false);
    expect(counts(list)).toEqual({ all: 3, highlights: 1, notes: 1, bookmarks: 1 });
  });

  it("sorts by place in the book or by most recent", () => {
    expect(filterAnnotations(list, "all", "position").map((a) => a.excerpt)).toEqual(["early", "mark", "late"]);
    expect(filterAnnotations(list, "all", "recent").map((a) => a.excerpt)).toEqual(["early", "mark", "late"]);
  });

  it("filters by kind and searches words, notes and chapters", () => {
    expect(filterAnnotations(list, "bookmarks", "position").map((a) => a.excerpt)).toEqual(["mark"]);
    expect(filterAnnotations(list, "all", "position", "THOUGHT").map((a) => a.excerpt)).toEqual(["early"]);
    expect(filterAnnotations(list, "all", "position", "low tide").map((a) => a.excerpt)).toEqual(["early"]);
  });

  it("gives each one its fixed page", () => {
    expect(annotationPage(list[2], 100)).toBe(42);
    expect(annotationPage(list[0], 100)).toBe(91);
    expect(annotationPage(ann({}), 100)).toBeNull();
  });
});

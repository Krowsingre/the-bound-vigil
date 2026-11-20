import { describe, expect, it } from "vitest";
import { readDocumentBytes } from "./importDoc";
import { buildManuscript, inspect } from "./manuscript";
import { bundle, exampleBook, isTextBookZip, pagesForPictures, splitDetails } from "./tbvText";
import { bestSplit } from "./importDoc";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

describe("a book written by hand", () => {
  it("reads the details at the top", () => {
    const { details, rest } = splitDetails("Title: Night Lanterns\nSubtitle: Poems\nAuthor: Embre Vale\n\n=== Chapter: One ===\nWords.");
    expect(details).toEqual({ title: "Night Lanterns", subtitle: "Poems", author: "Embre Vale" });
    expect(rest.trim().startsWith("=== Chapter: One")).toBe(true);
  });

  it("makes a picture page from its mark, with the caption from the next line", () => {
    const out = pagesForPictures("=== Picture page: pictures/map.jpg ===\nThe valley.\n\n=== Chapter: Two ===");
    expect(out).toContain('![The valley.](pictures/map.jpg "full")');
    expect(out).toContain("=== picture page");
    expect(out).toContain("=== Chapter: Two ===");
  });

  it("is told apart from a Quire book file and from other zips", () => {
    const book = exampleBook(PNG);
    expect(isTextBookZip(book)).toBe(true);
    expect(inspect("Night Lanterns.tbv", book)).toMatchObject({ format: "tbv_text", supported: true });
    expect(inspect("Night Lanterns.zip", book)).toMatchObject({ format: "tbv_text", supported: true });
    expect(isTextBookZip(bundle([{ path: "a.jpg", bytes: PNG }]))).toBe(false);
  });

  it("builds the example's pages, sections and pictures", async () => {
    const doc = await readDocumentBytes("Night Lanterns.tbv", exampleBook(PNG));
    expect(doc).toMatchObject({ title: "Night Lanterns", subtitle: "Poems of the Long Dark", author: "Your Name" });
    expect(doc.warnings).toEqual([]);
    const m = buildManuscript(doc, bestSplit(doc.html));
    const kinds = m.sections.map((s) => [s.title, s.area, s.kind, !!s.isPart, !!s.untitled]);
    expect(kinds).toEqual([
      ["Dedication", "front", "dedication", false, false],
      ["We Begin with Night", "chapter", "custom", true, false],
      ["The Long Night", "chapter", "chapter", false, false],
      ["Lanterns", "chapter", "poem", false, false],
      ["The valley, as the lamplighters knew it.", "chapter", "custom", false, true],
      ["About the author", "back", "about_author", false, false],
    ]);
    const chapter = m.sections[2].body;
    expect(chapter).toContain('<img src="data:image/png;base64,');
    expect(chapter).toContain("<em>italic</em>");
    expect(chapter).toContain("data-footnote=");
    console.log(m.sections[4].body.replace(/base64,[^"]+/,"…"));
    expect(m.sections[4].body).toContain('data-size="full"');
    // The section ends before the back matter.
    expect(m.sections[5].partOf).toBeUndefined();
    expect(m.sections[4].partOf).toBe(1);
  });

  it("lists pictures it couldn't find", async () => {
    const zip = bundle([{ path: "book.md", bytes: new TextEncoder().encode("Title: T\n\n=== Chapter: One ===\n![x](pictures/gone.jpg)") }]);
    const doc = await readDocumentBytes("T.tbv", zip);
    expect(doc.warnings?.[0].message).toContain("pictures/gone.jpg");
  });

  it("reads book.md chosen alone", async () => {
    const doc = await readDocumentBytes("book.md", new TextEncoder().encode("Title: Alone\nAuthor: A\n\n=== Chapter: One ===\nWords."));
    expect(doc.title).toBe("Alone");
  });
});

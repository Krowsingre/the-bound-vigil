import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import type { WritingChapter, WritingProject } from "../api/types";
import { boxSetSections, boxSetSettings } from "./BoxSet";
import { alsoByHtml, editionFileName, readStoreBooks, retarget, storeOf, type StoreBook } from "./editions";
import { buildEpub, epubFiles, readExport } from "./epub";
import { buildDocx } from "./docx";

const project: WritingProject = {
  id: "0192f0a4-7e3b-7c1d-9a52-1f3e5b7d9c02",
  title: "The Ash Road",
  author: "Ada Embre",
  series: null,
  seriesIndex: null,
  language: "en",
  description: null,
  cover: null,
  coverPath: null,
  coverPage: "title",
  export: "{}",
  chapters: 2,
  words: 0,
  createdAt: "2026-10-20T19:00:00.000Z",
  updatedAt: "2026-10-20T19:00:00.000Z",
};

const section = (id: string, title: string, body: string, role: WritingChapter["role"] = "chapter", page = "{}"): WritingChapter => ({
  id,
  projectId: project.id,
  title,
  body,
  position: 0,
  words: 10,
  updatedAt: project.updatedAt,
  role,
  part: null,
  page,
});

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const books: StoreBook[] = [
  { id: "1", title: "The Ember Gate", links: { amazon: "https://www.amazon.com/dp/B0EMBER", apple: "https://books.apple.com/book/id111", kobo: "https://www.kobo.com/ebook/ember" } },
  { id: "2", title: "Ashfall", links: { amazon: "https://www.amazon.com/dp/B0ASH", everywhere: "https://books2read.com/ashfall" } },
];

describe("store editions", () => {
  it("knows which store a link goes to", () => {
    expect(storeOf("https://www.amazon.co.uk/dp/1")).toBe("amazon");
    expect(storeOf("https://amzn.to/abc")).toBe("amazon");
    expect(storeOf("https://books.apple.com/us/book/x")).toBe("apple");
    expect(storeOf("https://www.kobo.com/gb/en/ebook/x")).toBe("kobo");
    expect(storeOf("https://www.barnesandnoble.com/w/x")).toBe("bn");
    expect(storeOf("https://play.google.com/store/books/details?id=1")).toBe("google");
    expect(storeOf("https://example.com")).toBeNull();
    expect(storeOf("not a link")).toBeNull();
  });

  it("sends links to each store's page, and keeps only the words of rival links", () => {
    const html = `<p><a href="https://www.amazon.com/dp/B0EMBER/">The Ember Gate</a>, <a href="https://www.amazon.com/dp/B0ASH">Ashfall</a>, <a href="https://www.amazon.com/dp/OTHER">another</a>, <a href="https://example.com">my site</a> and <a href="#c3">a note</a>.</p>`;
    const kobo = retarget(html, "kobo", books);
    expect(kobo.html).toContain(`<a href="https://www.kobo.com/ebook/ember">The Ember Gate</a>`);
    // No Kobo page for Ashfall: its link that suits everywhere.
    expect(kobo.html).toContain(`<a href="https://books2read.com/ashfall">Ashfall</a>`);
    expect(kobo.html).toContain(", another,");
    expect(kobo.html).toContain(`<a href="https://example.com">my site</a>`);
    expect(kobo.html).toContain(`<a href="#c3">a note</a>`);
    expect(kobo.changed).toBe(2);
    expect(kobo.unlinked).toEqual(["another"]);

    const amazon = retarget(html, "amazon", books);
    expect(amazon.changed).toBe(0);
    expect(amazon.unlinked).toEqual([]);
    expect(amazon.html).toBe(html);
  });

  it("reads saved lists, dropping what isn't a link", () => {
    const read = readStoreBooks([{ id: "a", title: "  X ", links: { amazon: "https://a.co/1", apple: "javascript:alert(1)", nope: "https://x" } }, null, "junk"]);
    expect(read).toEqual([{ id: "a", title: "X", links: { amazon: "https://a.co/1" } }]);
    expect(readStoreBooks("nothing")).toEqual([]);
    expect(readExport(JSON.stringify({ storeBooks: books })).storeBooks).toHaveLength(2);
  });

  it("makes an Also by page and names each edition's file", () => {
    expect(alsoByHtml(books, "ashfall")).toBe(`<p><a href="https://www.amazon.com/dp/B0EMBER">The Ember Gate</a></p>`);
    expect(editionFileName("The Ash Road", "apple")).toBe("The Ash Road (Apple Books).epub");
    expect(editionFileName("A/B", null)).toBe("A B.epub");
  });

  it("builds each store's EPUB with its own links", () => {
    const settings = { ...readExport("{}"), storeBooks: books };
    const chapters = [section("c1", "One", `<p>Read <a href="https://www.amazon.com/dp/B0EMBER">The Ember Gate</a>.</p>`)];
    const files = (edition: "apple" | null) => {
      const zip = unzipSync(buildEpub({ project, chapters, settings, edition }));
      return Object.entries(zip)
        .filter(([n]) => n.endsWith(".xhtml"))
        .map(([, b]) => strFromU8(b))
        .join("");
    };
    expect(files("apple")).toContain("https://books.apple.com/book/id111");
    expect(files("apple")).not.toContain("amazon.com");
    expect(files(null)).toContain("https://www.amazon.com/dp/B0EMBER");
  });
});

describe("pictures", () => {
  it("carries captions and full-page pictures into the EPUB and Word", async () => {
    const body = `<figure data-picture="" data-size="full"><img src="${PNG}" alt="The map"><figcaption>The road, as drawn by Ada</figcaption></figure><figure data-picture=""><img src="${PNG}" alt="Plain"></figure>`;
    const input = { project, chapters: [section("c1", "One", body)], settings: readExport("{}") };
    const page = epubFiles(input)
      .files.filter(([n]) => n.endsWith(".xhtml"))
      .map(([, d]) => String(d))
      .join("");
    expect(page).toContain(`<figure class="picture full-page"><img src="images/c1-1.png" alt="The map"/><figcaption>The road, as drawn by Ada</figcaption></figure>`);
    expect(page).toContain(`<div class="picture"><img src="images/c1-2.png" alt="Plain"/></div>`);
    const docx = unzipSync(await buildDocx(input, null));
    const xml = strFromU8(docx["word/document.xml"]);
    expect(xml).toContain(`<w:pStyle w:val="Caption"/>`);
    expect(xml).toContain("The road, as drawn by Ada");
  });
});

describe("box sets", () => {
  it("brings each book's own pages, writing out made pages and leaving out the box set's own", () => {
    const chapters = [
      section("t", "", "", "front", JSON.stringify({ kind: "title_page" })),
      section("cr", "", "", "front", JSON.stringify({ kind: "copyright" })),
      section("d", "", "<p>For Wren.</p>", "front", JSON.stringify({ kind: "dedication" })),
      section("c1", "One", "<p>Rain.</p>"),
      section("ack", "Acknowledgments", "<p>Thanks.</p>", "back", JSON.stringify({ kind: "acknowledgments" })),
    ];
    const settings = { ...readExport("{}"), copyright: { ...readExport("{}").copyright, isbn: "978-1-4028-9462-6" } };
    const all = boxSetSections(project, chapters, settings, { front: true, back: true });
    expect(all.map((s) => JSON.parse(s.page).kind)).toEqual(["copyright", "dedication", "chapter", "acknowledgments"]);
    const copyright = all[0];
    expect(JSON.parse(copyright.page).byHand).toBe(true);
    expect(copyright.body).toContain("978-1-4028-9462-6");
    expect(copyright.body).toContain("The Ash Road");
    const lean = boxSetSections(project, chapters, settings, { front: false, back: false });
    expect(lean.map((s) => s.title)).toEqual(["One"]);
  });

  it("gathers every book's sources and store links", () => {
    const a = { ...readExport("{}"), storeBooks: [books[0]], sources: [{ id: "s1" } as never] };
    const b = { ...readExport("{}"), storeBooks: [books[0], books[1]], sources: [{ id: "s1" } as never, { id: "s2" } as never] };
    const set = boxSetSettings([a, b]);
    expect(set.storeBooks.map((x) => x.title)).toEqual(["The Ember Gate", "Ashfall"]);
    expect(set.sources.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(set.numbering).toBe("restart");
  });

  it("keeps a part's own title page from replacing the box set's", () => {
    const part = section("p1", "The Ember Gate", "", "part");
    const inside = { ...section("pt", "", "<p>The Ember Gate</p>", "front", JSON.stringify({ kind: "title_page", byHand: true })), part: "p1" };
    const names = epubFiles({ project, chapters: [part, inside, section("c1", "One", "<p>x</p>")], settings: readExport("{}") }).files.map(([n]) => n);
    expect(names).toContain("OEBPS/titlepage.xhtml");
  });
});

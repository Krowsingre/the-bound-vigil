import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import type { WritingChapter, WritingProject } from "../api/types";
import { bookOrder, buildEpub, chapterXhtml, epubFileName, epubFiles, exportProblems, readExport, type ExportSettings } from "./epub";
import { countWords } from "./records";

const project: WritingProject = {
  id: "0192f0a4-7e3b-7c1d-9a52-1f3e5b7d9c01",
  title: "The Ash Road",
  author: "Embre",
  series: "Roads",
  seriesIndex: 1,
  language: "en",
  description: "A courier & a letter.",
  cover: null,
  coverPath: null,
  coverPage: null,
  export: "{}",
  chapters: 2,
  words: 0,
  createdAt: "2026-10-20T19:00:00.000Z",
  updatedAt: "2026-10-20T19:00:00.000Z",
};

const chapter = (n: number, title: string, body: string): WritingChapter => ({
  id: `c${n}`,
  projectId: project.id,
  title,
  body,
  position: n,
  words: 0,
  updatedAt: project.updatedAt,
  role: "chapter",
  part: null,
  page: "{}",
});

const chapters = [
  chapter(1, "Arrival", `<h2>The gate</h2><p>Rain on the <em>ash</em> road &amp; <strong>mud</strong>.</p><p></p><hr><p>Then <a href="https://example.com/x?a=1&b=2">a link</a> and <a href="javascript:alert(1)">no link</a>.</p><h3>Later</h3><ul><li><p>One</p></li></ul>`),
  chapter(2, "Leaving", `<p>She left.<br>Quietly.</p><blockquote><p>Keep to the stones.</p></blockquote><script>bad()</script><img src="x" onerror="bad()">`),
];

const settings = (over: Partial<ExportSettings> = {}): ExportSettings => ({ ...readExport("{}"), ...over });

const text = (files: [string, string | Uint8Array][], name: string) => {
  const found = files.find(([n]) => n === name);
  if (!found) throw new Error(`no ${name}`);
  return typeof found[1] === "string" ? found[1] : strFromU8(found[1]);
};

describe("chapter XHTML", () => {
  it("keeps what readers handle and drops the rest", () => {
    const { body, headings } = chapterXhtml(chapters[0].body, "asterisks", "c1");
    expect(body).toContain(`<h2 id="c1-h1">The gate</h2>`);
    expect(body).toContain("<em>ash</em> road &amp; <strong>mud</strong>");
    expect(body).toContain(`<p class="blank"> </p>`);
    expect(body).toContain(`<p class="scene">* * *</p>`);
    expect(body).toContain(`<a href="https://example.com/x?a=1&amp;b=2">a link</a>`);
    expect(body).toContain("and no link.");
    expect(headings).toEqual([
      { level: 2, text: "The gate", id: "c1-h1" },
      { level: 3, text: "Later", id: "c1-h2" },
    ]);
    const second = chapterXhtml(chapters[1].body, "line", "c2").body;
    expect(second).toContain("She left.<br/>Quietly.");
    expect(second).not.toMatch(/script|onerror|<img/);
    expect(chapterXhtml("<hr>", "line", "c").body).toBe(`<hr class="scene"/>`);
  });
});

describe("the EPUB", () => {
  it("has its parts in place, with a table of contents as deep as asked", () => {
    const { files } = epubFiles({ project, chapters, settings: settings({ tocDepth: 3 }), now: new Date("2026-10-22T05:00:00.123Z") });
    expect(files[0]).toEqual(["mimetype", "application/epub+zip"]);
    const opf = text(files, "OEBPS/content.opf");
    expect(opf).toContain(`<dc:identifier id="bookid">urn:uuid:${project.id}</dc:identifier>`);
    expect(opf).toContain("<dc:description>A courier &amp; a letter.</dc:description>");
    expect(opf).toContain(`<meta refines="#series" property="group-position">1</meta>`);
    expect(opf).toContain(`<meta property="dcterms:modified">2026-10-22T05:00:00Z</meta>`);
    const nav = text(files, "OEBPS/nav.xhtml");
    expect(nav).toContain(`<a href="chapter-1.xhtml">Arrival</a><ol>`);
    expect(nav).toContain(`<a href="chapter-1.xhtml#c1-h1">The gate</a><ol>`);
    expect(nav).toContain(`<a href="chapter-1.xhtml#c1-h2">Later</a>`);
    expect(text(files, "OEBPS/toc.ncx")).toContain(`<meta name="dtb:depth" content="3"/>`);

    const shallow = epubFiles({ project, chapters, settings: settings({ tocDepth: 1 }) }).files;
    expect(text(shallow, "OEBPS/nav.xhtml")).not.toContain("The gate");
  });

  it("puts everything in one file when chapters don't start new pages", () => {
    const { files } = epubFiles({ project, chapters, settings: settings({ newPage: false }) });
    expect(files.map(([n]) => n)).toContain("OEBPS/text.xhtml");
    expect(files.map(([n]) => n)).not.toContain("OEBPS/chapter-1.xhtml");
    expect(text(files, "OEBPS/nav.xhtml")).toContain(`<a href="text.xhtml#c2">Leaving</a>`);
  });

  it("carries a cover and a font when there are some", () => {
    const cover = { bytes: new Uint8Array([0xff, 0xd8, 0xff]), mime: "image/jpeg" };
    const font = { family: "Lora", files: [{ name: "lora-400-normal.woff2", bytes: new Uint8Array([1, 2, 3]), weight: "400", style: "normal" as const }] };
    const { files } = epubFiles({ project, chapters, settings: settings({ font: "lora" }), cover, font });
    const opf = text(files, "OEBPS/content.opf");
    expect(opf).toContain(`properties="cover-image"`);
    expect(opf).toContain(`<itemref idref="cover"/>`);
    expect(opf).toContain(`href="fonts/lora-400-normal.woff2" media-type="font/woff2"`);
    expect(text(files, "OEBPS/styles.css")).toContain(`font-family: "Lora", serif;`);
  });

  it("zips with mimetype first and unpacked", () => {
    const bytes = buildEpub({ project, chapters, settings: settings() });
    // The mimetype file's name sits at byte 30, its text right after it.
    expect(strFromU8(bytes.slice(30, 38))).toBe("mimetype");
    expect(strFromU8(bytes.slice(38, 58))).toBe("application/epub+zip");
    expect(Object.keys(unzipSync(bytes))).toContain("OEBPS/chapter-2.xhtml");
  });

  // Runs the official checker when it's to hand: EPUBCHECK_JAR=/path/to/epubcheck.jar npx vitest run src/writing
  it.runIf(!!process.env.EPUBCHECK_JAR)("passes the official EPUB checker", () => {
    const dir = mkdtempSync(join(tmpdir(), "tbv-epub-"));
    const cover = { bytes: new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==", "base64")), mime: "image/png" };
    const withExtras = [...chapters, { ...chapter(3, "Thanks", `<p>Thanks<sup data-footnote="And more."></sup>.</p><img src="data:image/png;base64,${cover.bytes.length ? Buffer.from(cover.bytes).toString("base64") : ""}" alt="">`), role: "back" as const }];
    for (const [i, s] of [settings({ tocDepth: 3, dropCap: true }), settings({ newPage: false, sceneBreak: "line", paragraphs: "space" })].entries()) {
      const file = join(dir, `book-${i}.epub`);
      const font = { family: "Lora", files: [{ name: "lora-400-normal.woff2", bytes: new Uint8Array(readFileSync("node_modules/@fontsource/lora/files/lora-latin-400-normal.woff2")), weight: "400", style: "normal" as const }] };
      writeFileSync(file, buildEpub({ project, chapters: withExtras, settings: s, cover, font: i === 0 ? font : null }));
      execFileSync("java", ["-jar", process.env.EPUBCHECK_JAR!, file], { stdio: "pipe" });
    }
  }, 120_000);
});

// A one-pixel PNG, as the editor keeps a picture.
const PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";

describe("pictures, footnotes, front and back matter", () => {
  const written = [
    { ...chapter(1, "Acknowledgements", "<p>Thanks to all.</p>"), role: "back" as const },
    chapter(2, "", `<p>The road<sup data-footnote="Built by the old empire &amp; never mended."></sup> ran east.</p><img src="${PIXEL}" alt="A map"><p>End.</p>`),
    { ...chapter(3, "For Wren", "<p>Who kept the letter.</p>"), role: "front" as const },
  ];

  it("takes pictures into files and footnotes to the chapter's end", () => {
    const { body, pictures, notes } = chapterXhtml(written[1].body, "asterisks", "c2");
    expect(pictures).toHaveLength(1);
    expect(pictures[0]).toMatchObject({ path: "images/c2-1.png", mime: "image/png" });
    expect(body).toContain(`<div class="picture"><img src="images/c2-1.png" alt="A map"/></div>`);
    expect(body).toContain(`<sup><a epub:type="noteref" href="#c2-fn1" id="c2-ref1">1</a></sup>`);
    expect(notes).toContain(`<aside epub:type="footnote" id="c2-fn1" class="footnote"><p><a href="#c2-ref1">1.</a> Built by the old empire &amp; never mended.</p></aside>`);
  });

  it("puts front matter first and back matter last, numbering only chapters", () => {
    const { files } = epubFiles({ project, chapters: written, settings: settings() });
    const nav = text(files, "OEBPS/nav.xhtml");
    expect(nav.indexOf("For Wren")).toBeLessThan(nav.indexOf("Chapter 1"));
    expect(nav.indexOf("Chapter 1")).toBeLessThan(nav.indexOf("Acknowledgements"));
    expect(nav).toContain(`<a epub:type="bodymatter" href="chapter-2.xhtml">Start</a>`);
    expect(text(files, "OEBPS/chapter-1.xhtml")).toContain(`epub:type="frontmatter"`);
    expect(text(files, "OEBPS/content.opf")).toContain(`<item id="picture1" href="images/c2-1.png" media-type="image/png"/>`);
    expect(files.map(([n]) => n)).toContain("OEBPS/images/c2-1.png");
  });

  it("styles paragraphs, lines, titles and first letters as chosen", () => {
    const css = (s: Partial<ExportSettings>) => text(epubFiles({ project, chapters, settings: settings(s) }).files, "OEBPS/styles.css");
    expect(css({})).toContain("text-indent: 1.5em; text-align: justify;");
    expect(css({ paragraphs: "space", align: "left" })).toContain("p { margin: 0 0 0.9em; text-indent: 0; text-align: left; }");
    expect(css({ titles: "left" })).toContain("h1 { font-size: 1.6em; text-align: left;");
    expect(css({ dropCap: true })).toContain("::first-letter");
    expect(css({})).not.toContain("::first-letter");
  });
});

describe("anthologies, page breaks and what opens the book", () => {
  const story = (n: number, title: string): WritingChapter => ({ ...chapter(n, title, "<p>A story of its own.</p>"), role: "part" });
  const inPart = (c: WritingChapter, part: string, role: WritingChapter["role"] = "chapter"): WritingChapter => ({ ...c, part, role });
  const anthology = [
    { ...chapter(1, "Foreword", "<p>Some stories.</p>"), role: "front" as const },
    story(2, "The Ash Road"),
    inPart(chapter(3, "", "<p>Rain.</p>"), "c2"),
    inPart(chapter(4, "", "<p>Wind.</p>"), "c2"),
    inPart(chapter(5, "Afterword", "<p>That was the road.</p>"), "c2", "back"),
    story(6, "The Salt Sea"),
    inPart(chapter(7, "", "<p>Waves.</p>"), "c6"),
    inPart(chapter(8, "For Mara", "<p>Who sailed.</p>"), "c6", "front"),
    { ...chapter(9, "About the author", "<p>Embre writes.</p>"), role: "back" as const },
  ];

  it("orders each work with its own front matter, chapters and back matter", () => {
    const titles = bookOrder(anthology).map((c) => c.title || c.id);
    expect(titles).toEqual(["Foreword", "The Ash Road", "c3", "c4", "Afterword", "The Salt Sea", "For Mara", "c7", "About the author"]);
  });

  it("nests the contents by work and numbers chapters again in each", () => {
    const nav = text(epubFiles({ project, chapters: anthology, settings: settings() }).files, "OEBPS/nav.xhtml");
    const toc = nav.slice(0, nav.indexOf("landmarks"));
    expect(toc).toMatch(/The Ash Road<\/a><ol>\n<li><a href="chapter-3.xhtml">Chapter 1<\/a><\/li>\n<li><a href="chapter-4.xhtml">Chapter 2<\/a><\/li>\n<li><a href="chapter-5.xhtml">Afterword/);
    expect(toc).toMatch(/The Salt Sea<\/a><ol>\n<li><a href="chapter-7.xhtml">For Mara<\/a><\/li>\n<li><a href="chapter-8.xhtml">Chapter 1/);
    expect(toc.indexOf("About the author")).toBeGreaterThan(toc.indexOf("The Salt Sea"));
    const files = epubFiles({ project, chapters: anthology, settings: settings() }).files;
    expect(text(files, "OEBPS/chapter-2.xhtml")).toContain(`<section class="part" epub:type="part"`);
    expect(text(files, "OEBPS/toc.ncx")).toContain(`<meta name="dtb:depth" content="2"/>`);
    expect(exportProblems([story(1, "Only a part")])).toEqual(["Add a chapter first."]);
  });

  it.runIf(!!process.env.EPUBCHECK_JAR)("passes the official EPUB checker as an anthology", () => {
    const dir = mkdtempSync(join(tmpdir(), "tbv-epub-"));
    const cover = { bytes: new Uint8Array(Buffer.from(PIXEL.slice(PIXEL.indexOf(",") + 1), "base64")), mime: "image/png" };
    const withBreak = anthology.map((c) => (c.id === "c3" ? { ...c, body: `<p>Rain.</p><div data-page-break=""></div><p>More rain.</p>` } : c));
    for (const [i, coverPage] of (["cover", "none"] as const).entries()) {
      const file = join(dir, `anthology-${i}.epub`);
      writeFileSync(file, buildEpub({ project: { ...project, coverPage }, chapters: withBreak, settings: settings({ tocDepth: 2 }), cover }));
      execFileSync("java", ["-jar", process.env.EPUBCHECK_JAR!, file], { stdio: "pipe" });
    }
  }, 120_000);

  it("starts a new page at a page break", () => {
    const { body } = chapterXhtml(`<p>One page.</p><div data-page-break=""></div><p>The next.</p>`, "asterisks", "c1");
    expect(body).toBe(`<p>One page.</p><div class="pagebreak"></div><p>The next.</p>`);
    expect(text(epubFiles({ project, chapters, settings: settings() }).files, "OEBPS/styles.css")).toContain(".pagebreak {");
  });

  it("opens with the cover, a title page, both or neither", () => {
    const cover = { bytes: new Uint8Array([0xff, 0xd8, 0xff]), mime: "image/jpeg" };
    const spine = (coverPage: WritingProject["coverPage"], withCover = true) => {
      const opf = text(epubFiles({ project: { ...project, coverPage }, chapters, settings: settings(), cover: withCover ? cover : null }).files, "OEBPS/content.opf");
      return [opf.includes(`<itemref idref="cover"/>`), opf.includes(`<itemref idref="titlepage"/>`), opf.includes(`properties="cover-image"`)];
    };
    expect(spine(null)).toEqual([true, true, true]);
    expect(spine("cover")).toEqual([true, false, true]);
    expect(spine("title")).toEqual([false, true, true]);
    expect(spine("none")).toEqual([false, false, true]);
    // Without a picture, "the cover only" still gives the book a title page.
    expect(spine("cover", false)).toEqual([false, true, false]);
  });
});

describe("helpers", () => {
  it("counts words and names files", () => {
    expect(countWords("<h2>Part one</h2><p>It was a <em>dark</em>&nbsp;night.</p><hr><p>— Then</p>")).toBe(8);
    expect(countWords('<p>Night<sup data-footnote="A long one &amp; cold." class="writing-footnote"></sup> fell.</p>')).toBe(6);
    expect(epubFileName('War/Peace: "draft"')).toBe("War Peace draft.epub");
    expect(epubFileName("...")).toBe("Book.epub");
  });

  it("says what stops an export", () => {
    expect(exportProblems([])).toEqual(["Add a chapter first."]);
    expect(exportProblems([chapter(1, "One", "<p></p>")])).toEqual(["Write something in a chapter first."]);
    expect(exportProblems([chapter(1, "One", '<img src="data:image/png;base64,AA" alt="">')])).toEqual([]);
    expect(exportProblems(chapters)).toEqual([]);
  });

  it("reads saved settings, falling back for anything odd", () => {
    expect(readExport('{"font":"echolume","tocDepth":2,"newPage":false,"sceneBreak":"ornament","paragraphs":"space","dropCap":true}')).toEqual({
      ...readExport("{}"),
      font: "echolume",
      tocDepth: 2,
      newPage: false,
      sceneBreak: "ornament",
      paragraphs: "space",
      dropCap: true,
    });
    expect(readExport('{"font":"comic sans","tocDepth":9}')).toEqual(readExport("{}"));
    expect(readExport("not json")).toEqual(readExport(null));
  });
});

describe("ready-made pages, numbering and headings", () => {
  const page = (c: WritingChapter, role: WritingChapter["role"], json: object): WritingChapter => ({ ...c, role, page: JSON.stringify(json) });
  const book = [
    page(chapter(1, "Copyright", ""), "front", { kind: "copyright" }),
    page(chapter(2, "Contents", ""), "front", { kind: "contents" }),
    page(chapter(3, "", "<p>For Wren.</p>"), "front", { kind: "dedication" }),
    page(chapter(4, "Part One", "<p>Beginnings.</p>"), "part", {}),
    { ...chapter(5, "Arrival", "<p>Rain.</p>"), part: "c4" },
    page({ ...chapter(6, "Between", "<p>A pause.</p>"), part: "c4" }, "chapter", { kind: "interlude" }),
    page(chapter(7, "Part Two", ""), "part", {}),
    { ...chapter(8, "Leaving", "<p>Wind.</p>"), part: "c7" },
    page(chapter(9, "Title page", ""), "front", { kind: "title_page" }),
  ];
  const files = (s: Partial<ExportSettings> = {}) => epubFiles({ project, chapters: book, settings: settings(s), now: new Date("2026-10-30T00:00:00Z") }).files;

  it("fills in the copyright and contents pages, and leaves them out of the contents", () => {
    const f = files({ copyright: { ...readExport("{}").copyright, isbn: "978-1-23456-789-7", publisher: "Krowsingre Publishing LLC" } });
    const copyright = text(f, "OEBPS/chapter-1.xhtml");
    expect(copyright).toContain("Copyright © 2026 Embre");
    expect(copyright).toContain("ISBN 978-1-23456-789-7");
    expect(copyright).toContain("Published by Krowsingre Publishing LLC");
    expect(copyright).not.toContain("<h1>");
    const contents = text(f, "OEBPS/chapter-2.xhtml");
    expect(contents).toContain(`<ol class="contents">`);
    expect(contents).toContain(`>Arrival</a>`);
    const nav = text(f, "OEBPS/nav.xhtml");
    expect(nav).not.toContain(">Copyright<");
    expect(nav).not.toContain(">Contents</a>");
  });

  it("uses a title page of the book's own instead of making one", () => {
    const f = files();
    expect(f.map(([n]) => n)).not.toContain("OEBPS/titlepage.xhtml");
    expect(text(f, "OEBPS/chapter-4.xhtml")).toContain(`class="frontmatter page-title-page titlepage"`);
  });

  it("numbers only chapters, again in each section or on through the book", () => {
    const labels = (s: Partial<ExportSettings>) => [...text(files(s), "OEBPS/nav.xhtml").matchAll(/>(Chapter [^<]*)</g)].map((m) => m[1]);
    expect(labels({ chapterHeading: "number" })).toEqual(["Chapter 1: Arrival", "Chapter 1: Leaving"]);
    expect(labels({ chapterHeading: "words", numbering: "continuous" })).toEqual(["Chapter One: Arrival", "Chapter Two: Leaving"]);
    expect(text(files({ chapterHeading: "words" }), "OEBPS/chapter-6.xhtml")).toContain(`<p class="chapter-label">Chapter One</p>\n<h1>Arrival</h1>`);
  });

  it("keeps a page that doesn't start a new page in the file before it", () => {
    const joined = [...book.slice(0, 5), page({ ...chapter(6, "Between", "<p>A pause.</p>"), part: "c4" }, "chapter", { kind: "interlude", newPage: false })];
    const f = epubFiles({ project, chapters: joined, settings: settings() }).files;
    expect(f.map(([n]) => n)).not.toContain("OEBPS/chapter-6.xhtml");
    expect(text(f, "OEBPS/chapter-5.xhtml")).toContain(`<section class="chapter page-interlude follows"`);
  });
});

describe("numbers in words", async () => {
  const { numberInWords } = await import("./pages");
  it("writes chapter numbers as headings do", () => {
    expect([1, 12, 20, 21, 99, 100, 105, 342].map(numberInWords)).toEqual([
      "One",
      "Twelve",
      "Twenty",
      "Twenty-One",
      "Ninety-Nine",
      "One Hundred",
      "One Hundred Five",
      "Three Hundred Forty-Two",
    ]);
  });
});

import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import type { WritingChapter, WritingProject } from "../api/types";
import { pictureSize, buildDocx, wordCountLine } from "./docx";
import { chooseStyle } from "./bookStyles";
import { readExport, type ExportSettings } from "./epub";
import { gutterFor, printHtml } from "./printBook";
import { buildTxt, bookFileName } from "./txt";

const project: WritingProject = {
  id: "0192f0a4-7e3b-7c1d-9a52-1f3e5b7d9c01",
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

const chapter = (n: number, title: string, body: string, words = 0): WritingChapter => ({
  id: `c${n}`,
  projectId: project.id,
  title,
  body,
  position: n,
  words,
  updatedAt: project.updatedAt,
  role: "chapter",
  part: null,
  page: "{}",
});

// A 1×1 PNG.
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const chapters = [
  chapter(
    1,
    "Arrival",
    `<h2>The gate</h2><p>Rain on the <em>ash</em> road<sup data-footnote="It was always ash.">*</sup> &amp; <strong>mud</strong>.</p><hr><p style="text-align: center">Then <a href="https://example.com/x?a=1&b=2">a link</a>.</p><p><img src="${PNG}" alt="A map"></p>`,
    1234,
  ),
  chapter(2, "Leaving", `<p>She left.<br>Quietly.</p><blockquote><p>Keep to the stones.</p></blockquote><ul><li><p>One</p></li><li><p>Two</p></li></ul>`, 40),
];

const settings = (over: Partial<ExportSettings> = {}): ExportSettings => ({ ...readExport("{}"), ...over });
const input = (over: Partial<ExportSettings> = {}) => ({ project, chapters, settings: settings(over) });

describe("TXT", () => {
  it("keeps the words, headings in capitals, notes after their chapter", () => {
    const txt = buildTxt(input());
    expect(txt).toContain("ARRIVAL");
    expect(txt).toContain("The gate");
    expect(txt).toContain("Rain on the ash road[1] & mud.");
    expect(txt).toContain("* * *");
    expect(txt).toContain("Notes\n\n1. It was always ash.");
    expect(txt).toContain("She left.\nQuietly.");
    expect(txt).toContain("    Keep to the stones.");
    expect(txt).toContain("• One");
    expect(txt.indexOf("ARRIVAL")).toBeLessThan(txt.indexOf("LEAVING"));
    expect(txt).not.toMatch(/<[a-z]/);
  });

  it("names the file after the book", () => {
    expect(bookFileName("A: B/C", "txt")).toBe("A B C.txt");
  });
});

describe("DOCX", () => {
  const open = async (over: Partial<ExportSettings> = {}, manuscript = false) => {
    const s = settings(over);
    const files = unzipSync(await buildDocx({ project, chapters, settings: s }, manuscript ? s.manuscript : null));
    return { files, doc: strFromU8(files["word/document.xml"]), notes: strFromU8(files["word/footnotes.xml"]), styles: strFromU8(files["word/styles.xml"]) };
  };

  it("uses Word's heading styles, real footnotes, links and pictures", async () => {
    const { files, doc, notes } = await open();
    for (const part of ["[Content_Types].xml", "_rels/.rels", "word/_rels/document.xml.rels", "word/footer1.xml", "docProps/core.xml"]) expect(files[part]).toBeDefined();
    expect(doc).toMatch(/<w:pStyle w:val="Heading1"\/>(<w:pageBreakBefore\/>)?<\/w:pPr><w:r><w:t xml:space="preserve">Arrival</);
    expect(doc).toContain(`<w:pStyle w:val="Heading2"/>`);
    expect(doc).toContain(`<w:i/></w:rPr><w:t xml:space="preserve">ash</w:t>`);
    expect(doc).toContain(`<w:footnoteReference w:id="1"/>`);
    expect(notes).toContain("It was always ash.");
    expect(doc).toContain(`<w:jc w:val="center"/>`);
    expect(doc).toContain("<w:hyperlink");
    expect(strFromU8(files["word/_rels/document.xml.rels"])).toContain(`Target="https://example.com/x?a=1&amp;b=2" TargetMode="External"`);
    expect(Object.keys(files).some((k) => k.startsWith("word/media/picture1.png"))).toBe(true);
    expect(doc).toContain("<wp:extent");
    // The second chapter starts a new page.
    expect(doc).toMatch(/Heading1"\/><w:pageBreakBefore\/><\/w:pPr><w:r><w:t xml:space="preserve">Leaving/);
    expect(doc).toContain(`<w:pStyle w:val="Quote"/>`);
    expect(doc).toContain("•\t");
    // Well-formed XML throughout.
    for (const [name, bytes] of Object.entries(files)) {
      if (!name.endsWith(".xml") && !name.endsWith(".rels")) continue;
      const parsed = new DOMParser().parseFromString(strFromU8(bytes), "application/xml");
      expect(parsed.querySelector("parsererror"), name).toBeNull();
    }
  });

  it("lays out a standard manuscript", async () => {
    const manuscript = { layout: "shunn" as const, font: "courier" as const, name: "Ada Embre", address: "1 Ash Road\nGreyton", phone: "", email: "ada@example.com" };
    const { files, doc, styles } = await open({ manuscript }, true);
    expect(doc).toContain(`Ada Embre</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t xml:space="preserve">about 1,300 words`);
    expect(doc).toContain("1 Ash Road");
    expect(doc).toContain("by Ada Embre");
    expect(doc).toContain(`>#</w:t>`);
    expect(doc).toContain(`>END</w:t>`);
    expect(styles).toContain(`w:ascii="Courier New"`);
    expect(styles).toContain(`w:line="480"`);
    expect(strFromU8(files["word/header1.xml"])).toContain("Embre / THE ASH ROAD / ");
    expect(doc).toContain("<w:titlePg/>");
  });

  it("counts a manuscript's words and lines as editors expect", () => {
    expect(wordCountLine({ project, chapters, settings: settings() }, "shunn")).toBe("about 1,300 words");
    expect(wordCountLine({ project, chapters: [chapter(1, "", "", 84_321)], settings: settings() }, "shunn")).toBe("about 84,000 words");
    expect(wordCountLine({ project, chapters: [chapter(1, "", "<p>a<br>b<br>c</p>")], settings: settings() }, "poetry")).toBe("1 poem, 3 lines");
  });

  it("reads a picture's size", () => {
    const bytes = Uint8Array.from(atob(PNG.split(",")[1]), (c) => c.charCodeAt(0));
    expect(pictureSize(bytes, "image/png")).toEqual({ width: 1, height: 1 });
  });
});

describe("Book styles", () => {
  it("fill in their settings and add their looks to the stylesheet", () => {
    const styled = chooseStyle(settings(), "thriller");
    expect(styled.bookStyle).toBe("thriller");
    expect(styled.chapterHeading).toBe("numeral");
    expect(readExport(JSON.stringify(styled)).bookStyle).toBe("thriller");
    expect(readExport(JSON.stringify({ ...styled, bookStyle: "nope" })).bookStyle).toBeNull();
    expect(printHtml({ project, chapters, settings: styled }, styled.print)).toContain("border-bottom: 2px solid currentColor");
    expect(chooseStyle(styled, null).bookStyle).toBeNull();
  });
});

describe("Print PDF", () => {
  it("grows the inside margin with the page count", () => {
    expect(gutterFor(100)).toBe(0.625);
    expect(gutterFor(400)).toBe(0.875);
    expect(gutterFor(900)).toBe(1.125);
  });

  it("lays the pages out at the trim size, without the cover, with running heads", () => {
    const s = settings();
    const html = printHtml({ project, chapters, settings: s }, { ...s.print, trim: "5x8" });
    expect(html).toContain("size: 5in 8in");
    expect(html).toContain("string(chapter, first)");
    expect(html).toContain('"The Ash Road"');
    expect(html).not.toMatch(/class="[^"]*\bcover\b/);
    expect(html).toContain('name="tbv-print"');
  });
});

import { describe, expect, it } from "vitest";
import type { WritingChapter, WritingProject } from "../api/types";
import { buildDocx } from "./docx";
import { readExport } from "./epub";
import { bestSplit, markdownToHtml, readDocumentBytes, rtfToHtml, splitChapters, textToHtml } from "./importDoc";
import { isbnValid, preflight } from "./preflightChecks";
import { jpegPdf, spineWidth, wrapFor } from "./paperbackWrap";

describe("Importing", () => {
  it("reads RTF: paragraphs, italics, accents, footnotes", () => {
    const html = rtfToHtml(String.raw`{\rtf1\ansi{\fonttbl{\f0 Times;}}{\info{\title x}}\pard Chapter 1\par\pard The {\i ash} road, caf\'e9 ` + "\\u8212? done" + String.raw`{\footnote\pard {\chftn} A note.}.\par\pard\qc ***\par}`);
    expect(html).toContain("<p>Chapter 1</p>");
    expect(html).toContain("The <em>ash</em> road, café — done");
    expect(html).toContain('<sup data-footnote="A note.">*</sup>');
    expect(html).not.toContain("Times");
    expect(html).not.toContain(">x<");
  });

  it("reads Markdown and plain text", () => {
    const md = markdownToHtml("# One\n\nSome *soft* and **loud** words[^n].\n\n***\n\n> Quoted\n\n[^n]: The note.");
    expect(md).toContain("<h1>One</h1>");
    expect(md).toContain("<em>soft</em>");
    expect(md).toContain("<strong>loud</strong>");
    expect(md).toContain('data-footnote="The note."');
    expect(md).toContain("<hr>");
    expect(md).toContain("<blockquote>");
    expect(textToHtml("Line one\nLine two\nLine three\nLine four")).toBe("<p>Line one</p><p>Line two</p><p>Line three</p><p>Line four</p>");
  });

  it("splits at headings, or at lines like 'Chapter 1', keeping an opening", () => {
    const html = "<p>A Book</p><p>Chapter 1</p><p>Rain fell.</p><p>* * *</p><p>Then sun.</p><p>Chapter 2</p><p>The end.</p>";
    expect(bestSplit(html)).toBe("lines");
    const chapters = splitChapters(html, "lines", "A Book");
    expect(chapters.map((c) => c.title)).toEqual(["Opening", "Chapter 1", "Chapter 2"]);
    expect(chapters[1].body).toBe("<p>Rain fell.</p><hr><p>Then sun.</p>");
    expect(chapters[1].words).toBe(4);
    expect(splitChapters("<h1>One</h1><p class='x' style='color:red'>Hi <span>there</span></p><h1>Two</h1><p>Bye</p>", "headings", "B").map((c) => [c.title, c.body])).toEqual([
      ["One", "<p>Hi there</p>"],
      ["Two", "<p>Bye</p>"],
    ]);
    expect(splitChapters("<p>All of it.</p>", "none", "Whole")).toEqual([{ title: "Whole", body: "<p>All of it.</p>", words: 3 }]);
  });

  it("brings back a Word file Scribe made, chapters and footnotes intact", async () => {
    const project: WritingProject = {
      id: "p",
      title: "Round Trip",
      author: "Embre",
      series: null,
      seriesIndex: null,
      language: "en",
      description: null,
      cover: null,
      coverPath: null,
      coverPage: "none",
      export: "{}",
      chapters: 2,
      words: 0,
      createdAt: "2026-10-30T00:00:00.000Z",
      updatedAt: "2026-10-30T00:00:00.000Z",
    };
    const chapter = (n: number, title: string, body: string): WritingChapter => ({ id: `c${n}`, projectId: "p", title, body, position: n, words: 5, updatedAt: project.updatedAt, role: "chapter", part: null, page: "{}" });
    const chapters = [chapter(1, "Arrival", `<p>Rain on the <em>ash</em> road<sup data-footnote="Always ash.">*</sup>.</p>`), chapter(2, "Leaving", "<p>She left.</p>")];
    const bytes = await buildDocx({ project, chapters, settings: readExport("{}") }, null);
    const doc = await readDocumentBytes("Round Trip.docx", bytes);
    expect(bestSplit(doc.html)).toBe("headings");
    const back = splitChapters(doc.html, "headings", doc.title);
    const titles = back.map((c) => c.title);
    expect(titles).toContain("Arrival");
    expect(titles).toContain("Leaving");
    const arrival = back.find((c) => c.title === "Arrival")!;
    expect(arrival.body).toContain("<em>ash</em>");
    expect(arrival.body).toContain('data-footnote="Always ash."');
  });
});

describe("Pre-upload check", () => {
  it("knows a real ISBN", () => {
    expect(isbnValid("978-0-306-40615-7")).toBe(true);
    expect(isbnValid("978-0-306-40615-8")).toBe(false);
    expect(isbnValid("0-306-40615-2")).toBe(true);
  });

  it("finds what stores would turn away", () => {
    const settings = readExport("{}");
    const project = { id: "p", title: "Ash", author: null, series: null, seriesIndex: null, language: "en", description: null, cover: null, coverPath: null, coverPage: "none", export: "{}", chapters: 1, words: 3, createdAt: "", updatedAt: "" } as WritingProject;
    const chapters = [
      { id: "c1", projectId: "p", title: "One", body: '<p>TODO finish. See <a href="https://www.amazon.com/dp/1">my other book</a>.</p><p><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" alt=""></p>', position: 1, words: 3, updatedAt: "", role: "chapter", part: null, page: "{}" },
    ] as WritingChapter[];
    const found = preflight({ book: { project, chapters, settings }, stores: ["kdp", "apple", "ingram"], print: { pages: 12, trim: "6x9" } });
    const titles = found.filter((f) => f.level === "problem").map((f) => f.title);
    expect(titles).toContain("There's no author's name");
    expect(titles).toContain("There's no cover");
    expect(titles).toContain("IngramSpark needs an ISBN");
    expect(titles).toContain("Links to Amazon");
    expect(titles).toContain("Unfinished words");
    expect(titles).toContain("Too few pages for IngramSpark");
    expect(found.some((f) => f.title === "Pictures without a description")).toBe(true);
  });
});

describe("Paperback cover", () => {
  it("works out the spine and the whole cover", () => {
    expect(spineWidth(300, "kdp", "cream")).toBeCloseTo(0.75);
    expect(spineWidth(300, "kdp", "white")).toBeCloseTo(0.6756);
    const wrap = wrapFor("6x9", 300, "kdp", "cream");
    expect(wrap.width).toBeCloseTo(0.125 + 6 + 0.75 + 6 + 0.125);
    expect(wrap.height).toBeCloseTo(9.25);
    expect(wrap.spineText).toBe(true);
    expect(wrapFor("6x9", 60, "kdp", "cream").spineText).toBe(false);
  });

  it("makes a PDF the exact size of the cover", () => {
    const pdf = new TextDecoder("latin1").decode(jpegPdf(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), { width: 10, height: 8 }, { width: 12.875, height: 9.25 }));
    expect(pdf.startsWith("%PDF-1.4")).toBe(true);
    expect(pdf).toContain("/MediaBox [0 0 927.000 666.000]");
    expect(pdf).toContain("/TrimBox [9.000 9.000 918.000 657.000]");
    const xref = Number(/startxref\n(\d+)/.exec(pdf)![1]);
    expect(pdf.slice(xref, xref + 4)).toBe("xref");
  });
});

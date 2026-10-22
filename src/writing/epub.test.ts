import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import type { WritingChapter, WritingProject } from "../api/types";
import { buildEpub, chapterXhtml, epubFileName, epubFiles, exportProblems, readExport, type ExportSettings } from "./epub";
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
    for (const [i, s] of [settings({ tocDepth: 3 }), settings({ newPage: false, sceneBreak: "line" })].entries()) {
      const file = join(dir, `book-${i}.epub`);
      const font = { family: "Lora", files: [{ name: "lora-400-normal.woff2", bytes: new Uint8Array(readFileSync("node_modules/@fontsource/lora/files/lora-latin-400-normal.woff2")), weight: "400", style: "normal" as const }] };
      writeFileSync(file, buildEpub({ project, chapters, settings: s, cover, font: i === 0 ? font : null }));
      execFileSync("java", ["-jar", process.env.EPUBCHECK_JAR!, file], { stdio: "pipe" });
    }
  }, 120_000);
});

describe("helpers", () => {
  it("counts words and names files", () => {
    expect(countWords("<h2>Part one</h2><p>It was a <em>dark</em>&nbsp;night.</p><hr><p>— Then</p>")).toBe(8);
    expect(epubFileName('War/Peace: "draft"')).toBe("War Peace draft.epub");
    expect(epubFileName("...")).toBe("Book.epub");
  });

  it("says what stops an export", () => {
    expect(exportProblems([])).toEqual(["Add a chapter first."]);
    expect(exportProblems([chapter(1, "One", "<p></p>")])).toEqual(["Write something in a chapter first."]);
    expect(exportProblems(chapters)).toEqual([]);
  });

  it("reads saved settings, falling back for anything odd", () => {
    expect(readExport('{"font":"echolume","tocDepth":2,"newPage":false,"sceneBreak":"ornament"}')).toEqual({ font: "echolume", tocDepth: 2, newPage: false, sceneBreak: "ornament" });
    expect(readExport('{"font":"comic sans","tocDepth":9}')).toEqual(readExport("{}"));
    expect(readExport("not json")).toEqual(readExport(null));
  });
});

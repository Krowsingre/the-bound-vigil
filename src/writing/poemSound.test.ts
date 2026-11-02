import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import type { WritingChapter, WritingProject } from "../api/types";
import { buildEpub, epubFiles, readExport } from "./epub";
import { readPage, webLink, writePage } from "./pages";
import { printHtml } from "./printBook";
import { readTbv, writeTbv } from "./tbvFile";

const SOUND = `${"ab".repeat(32)}.mp3`;
const BYTES = new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 1, 2, 3]);

const project: WritingProject = {
  id: "0192f0a4-7e3b-7c1d-9a52-1f3e5b7d9c02",
  title: "Salt Songs",
  author: "Embre",
  series: null,
  seriesIndex: null,
  language: "en",
  description: null,
  cover: null,
  coverPath: null,
  coverPage: null,
  export: "{}",
  chapters: 1,
  words: 4,
  createdAt: "2026-11-02T00:00:00Z",
  updatedAt: "2026-11-02T00:00:00Z",
};

const poem = (sound: object | null): WritingChapter => ({
  id: "p1",
  projectId: project.id,
  title: "Tide",
  body: "<p>Salt on the stair<br>and the tide in the hall</p>",
  position: 1,
  words: 9,
  updatedAt: project.updatedAt,
  role: "chapter",
  part: null,
  page: JSON.stringify({ kind: "poem", ...(sound ? { sound } : {}) }),
});

const settings = readExport("");
const sounds = new Map([[SOUND, BYTES]]);
const text = (files: [string, string | Uint8Array][]) => files.map(([, b]) => (typeof b === "string" ? b : "")).join("\n");

describe("A poem's sound", () => {
  it("is kept in the page's settings, and only a real kept file or web link", () => {
    const page = readPage(writePage({ ...readPage('{"kind":"poem"}'), sound: { file: SOUND, name: "Tide.mp3", link: "https://example.com/tide" } }));
    expect(page.sound).toEqual({ file: SOUND, name: "Tide.mp3", link: "https://example.com/tide" });
    expect(readPage('{"kind":"poem","sound":{"file":"../x.mp3","link":"javascript:alert(1)"}}').sound).toBeNull();
    expect(webLink("example.com/song")).toBe("https://example.com/song");
    expect(webLink("ftp://example.com")).toBeNull();
    expect(JSON.parse(writePage({ ...readPage('{"kind":"poem"}'), sound: null }))).toEqual({ kind: "poem" });
  });

  it("plays inside the plain EPUB and the Apple edition", () => {
    for (const edition of [null, "apple" as const]) {
      const { files } = epubFiles({ project, chapters: [poem({ file: SOUND, name: "Tide.mp3", link: "https://example.com/tide" })], settings, sounds, edition });
      const all = text(files);
      expect(all).toContain(`<audio controls="controls" src="audio/${SOUND}">`);
      expect(all).toContain(`<item id="sound1" href="audio/${SOUND}" media-type="audio/mpeg"/>`);
      expect(files.find(([name]) => name === `OEBPS/audio/${SOUND}`)?.[1]).toEqual(BYTES);
    }
    const epub = unzipSync(buildEpub({ project, chapters: [poem({ file: SOUND, name: "Tide.mp3", link: null })], settings, sounds }));
    expect(epub[`OEBPS/audio/${SOUND}`]).toEqual(BYTES);
  });

  it("is a link in the Kindle and other store editions, and nothing without one", () => {
    const { files } = epubFiles({ project, chapters: [poem({ file: SOUND, name: "Tide.mp3", link: "https://example.com/tide" })], settings, sounds, edition: "amazon" });
    const all = text(files);
    expect(all).not.toContain("<audio");
    expect(all).not.toContain("audio/");
    expect(all).toContain('Listen to this poem: <a href="https://example.com/tide">example.com/tide</a>');
    const none = text(epubFiles({ project, chapters: [poem({ file: SOUND, name: "Tide.mp3", link: null })], settings, sounds, edition: "kobo" }).files);
    expect(none).not.toContain("Listen to this poem");
  });

  it("is a QR code in the paperback, with its address under it", () => {
    const html = printHtml({ project, chapters: [poem({ file: SOUND, name: "Tide.mp3", link: "https://example.com/tide?a=1&b=2" })], settings }, settings.print);
    expect(html).toContain('<svg xmlns="http://www.w3.org/2000/svg" class="qr"');
    expect(html).toContain("<p>Listen to this poem: example.com/tide?a=1&amp;b=2</p>");
    expect(html).not.toContain("<audio");
  });

  it("travels inside a .tbv file", () => {
    const book = readTbv(writeTbv({ project, chapters: [poem({ file: SOUND, name: "Tide.mp3", link: null })], cover: null, notes: [], records: [], app: "test", sounds }));
    expect(book.sounds).toEqual([{ file: SOUND, bytes: BYTES }]);
    expect((book.pages[0].page.sound as { file: string }).file).toBe(SOUND);
  });
});

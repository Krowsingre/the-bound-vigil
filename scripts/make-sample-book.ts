// Makes public/samples/paradise-lost.tbv, the sample book Scribe starts with.
// The text is John Milton's Paradise Lost (second edition, 1674, in twelve
// books), which is in the public domain; the plain-text copy it was made from
// is passed in, along with the cover picture:
//   npx vite-node scripts/make-sample-book.ts -- <paradise-lost.txt> <cover.jpg>

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import type { WritingChapter, WritingProject } from "../src/api/types";
import { writeTbv } from "../src/writing/tbvFile";

const [textPath, coverPath] = process.argv.slice(2).filter((a) => a !== "--");
if (!textPath || !coverPath)
  throw new Error("usage: make-sample-book.ts <text> <cover.jpg>");

const lines = readFileSync(textPath, "utf8").replace(/\r/g, "").split("\n");
const end = lines.findIndex((l) => /^End of the Project Gutenberg/i.test(l));
const ROMAN = [
  "I",
  "II",
  "III",
  "IV",
  "V",
  "VI",
  "VII",
  "VIII",
  "IX",
  "X",
  "XI",
  "XII",
];
const starts = lines
  .map((l, i) => (/^Book [IVX]+\s*$/.test(l) ? i : -1))
  .filter((i) => i >= 0);
if (starts.length !== 12)
  throw new Error(`expected 12 books, found ${starts.length}`);

const escape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** Book typography: real dashes, apostrophes and quotation marks. */
const typeset = (s: string) =>
  escape(s)
    .replace(/\s*--\s*/g, "—")
    .replace(/'/g, "’")
    .replace(/(^|[\s(—])"/g, "$1“")
    .replace(/"/g, "”");

/** A book of the poem: verse paragraphs (an indented line starts one), each line kept. */
function verse(from: number, to: number): string {
  const paragraphs: string[][] = [];
  for (const raw of lines.slice(from, to)) {
    if (!raw.trim()) continue;
    if (!paragraphs.length || /^\s/.test(raw)) paragraphs.push([]);
    paragraphs[paragraphs.length - 1].push(typeset(raw.trim()));
  }
  return paragraphs.map((p) => `<p>${p.join("<br>")}</p>`).join("");
}

const now = "2026-11-02T00:00:00Z";
const project: WritingProject = {
  id: "sample",
  title: "Paradise Lost",
  author: "John Milton",
  series: null,
  seriesIndex: null,
  language: "en",
  description:
    "Milton’s epic of the war in Heaven, the fall of Satan and his angels, and the temptation and fall of Adam and Eve, told in blank verse in twelve books. A sample book: open it to see how Scribe lays out a long poem, then try the cover, styles and exports on it.",
  cover: "picture:cover.jpg",
  coverPath: null,
  coverPage: null,
  export: JSON.stringify({
    align: "left",
    chapterHeading: "title",
    dropCap: true,
    smallCaps: true,
    kind: null,
  }),
  chapters: 15,
  words: 0,
  createdAt: now,
  updatedAt: now,
};

let position = 0;
const section = (
  title: string,
  role: WritingChapter["role"],
  page: object,
  body: string,
): WritingChapter => ({
  id: `s${position}`,
  projectId: "sample",
  title,
  body,
  position: position++,
  words: 0,
  updatedAt: now,
  role,
  part: null,
  page: JSON.stringify(page),
});

const chapters: WritingChapter[] = [
  section("", "front", { kind: "title_page" }, ""),
  section(
    "Copyright",
    "front",
    { kind: "copyright", byHand: true },
    "<p>Paradise Lost, by John Milton</p>" +
      "<p>First published in ten books in 1667. This text follows the second edition of 1674, in twelve books.</p>" +
      "<p>This work is in the public domain.</p>" +
      "<p>A sample book for Scribe in The Bound Vigil. Change anything in it, or delete it when you’re done.</p>",
  ),
  section("Contents", "front", { kind: "contents" }, ""),
  ...starts.map((start, i) =>
    section(
      `Book ${ROMAN[i]}`,
      "chapter",
      { kind: "chapter" },
      verse(start + 1, starts[i + 1] ?? end),
    ),
  ),
];

const bytes = writeTbv({
  project,
  chapters,
  cover: new Uint8Array(readFileSync(coverPath)),
  notes: [],
  records: [],
  app: "sample",
});
mkdirSync("public/samples", { recursive: true });
writeFileSync("public/samples/paradise-lost.tbv", bytes);
console.log(
  `public/samples/paradise-lost.tbv: ${bytes.length} bytes, ${chapters.length} pages`,
);

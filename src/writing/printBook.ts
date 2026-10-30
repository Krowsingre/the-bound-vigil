// A book written in Scribe laid out as printed pages, for a PDF: a trim size
// the print-on-demand services accept (KDP, IngramSpark), mirrored margins
// with an inside margin (gutter) that grows with the page count, running
// heads, page numbers, chapters that can open on a right-hand page, and
// optional bleed. The pages themselves are laid out by Paged.js (see
// src/print), from the same pages the EPUB has.

import { bookSheets, escapeXml, inlineStyles, sheetHtml, type EpubInput } from "./epub";

import { DEFAULT_PRINT, readPrint, TRIMS, type PrintSettings, type TrimSize } from "./printSettings";

export { DEFAULT_PRINT, readPrint, TRIMS, type PrintSettings, type TrimSize };

/**
 * The inside margin a book of this many pages needs, in inches, after the
 * print services' own tables (KDP's minimums, with a quarter inch to spare
 * so words never run into the spine).
 */
export function gutterFor(pages: number): number {
  const minimum = pages <= 150 ? 0.375 : pages <= 300 ? 0.5 : pages <= 500 ? 0.625 : pages <= 700 ? 0.75 : 0.875;
  return minimum + 0.25;
}

/** A first guess at the page count, from the words, for the first layout's gutter. */
export function estimatePages(words: number, trim: TrimSize): number {
  const t = TRIMS.find((x) => x.value === trim) ?? TRIMS[3];
  // About 300 words fill a 6 × 9 page at 11 pt.
  return Math.ceil((words / 300) * ((6 * 9) / (t.width * t.height))) + 8;
}

/** CSS strings need their quotes and backslashes escaped. */
const cssString = (text: string) => `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, " ")}"`;

/** The page's own styles for print: size, margins, running heads and numbers. */
export function printStyles(settings: PrintSettings, bookTitle: string, gutter: number): string {
  const trim = TRIMS.find((t) => t.value === settings.trim) ?? TRIMS[3];
  const outside = trim.width >= 7 ? 0.75 : 0.6;
  const inside = settings.mirrored ? Math.max(outside, gutter) : outside;
  const head = settings.runningHeads;
  const number = settings.pageNumbers ? "counter(page)" : "none";
  const none = `@top-center { content: none; } @bottom-center { content: none; }`;
  return `
@page {
  size: ${trim.width}in ${trim.height}in;
  margin: 0.75in ${settings.mirrored ? `${outside}in 0.8in ${inside}in` : `${outside}in 0.8in ${outside}in`};
  ${settings.bleed ? "bleed: 0.125in; marks: none;" : ""}
  @bottom-center { content: ${number}; font-size: 9pt; }
}
${
  settings.mirrored
    ? `@page :left { margin-left: ${outside}in; margin-right: ${inside}in; }
@page :right { margin-left: ${inside}in; margin-right: ${outside}in; }`
    : ""
}
@page main:left { @top-center { content: ${head ? cssString(bookTitle) : "none"}; font-size: 8.5pt; letter-spacing: 0.12em; text-transform: uppercase; } }
@page main:right { @top-center { content: ${head ? "string(chapter, first)" : "none"}; font-size: 8.5pt; letter-spacing: 0.12em; text-transform: uppercase; } }
@page main:first { @top-center { content: none; } }
@page front { ${none} }
@page :blank { ${none} }

html, body { margin: 0; padding: 0; background: #fff; color: #000; }
body { font-size: 11pt; line-height: 1.45; }
section.chapter, section.backmatter, section.part { page: main; }
section.frontmatter, section.titlepage { page: front; }
section > h1 { string-set: chapter content(text); }
section.chapter:not(.follows), section.part:not(.follows) { break-before: ${settings.chaptersRight ? "right" : "page"}; }
section.frontmatter:not(.follows), section.backmatter:not(.follows), section.titlepage { break-before: page; }
.print-sheet:first-child section:first-child, .print-sheet:first-child > section.titlepage { break-before: auto; }
p { widows: 2; orphans: 2; }
h1, h2, h3, .chapter-label { break-after: avoid; }
.picture, .stanza { break-inside: avoid; }
img { max-width: 100%; max-height: 7in; }
a { color: inherit; text-decoration: none; }
section.page-half-title .title, .titlepage .title { margin-top: 2.2in; }
section.page-copyright { padding-top: 3in; }
section.page-dedication, section.page-epigraph { padding-top: 2in; }
section.part > h1 { margin-top: 2.5in; }
.footnotes { break-inside: avoid; }
/* The contents page gives each chapter's page number. */
ol.contents li > a { display: flex; gap: 1em; }
ol.contents li > a::after { content: target-counter(attr(href url), page); margin-left: auto; }
`;
}

/** The whole interior as one page for Paged.js: no cover (that's a separate file at the printer). */
export function printHtml(input: EpubInput, settings: PrintSettings): string {
  const { sheets, files } = bookSheets(input);
  const title = input.project.title.trim() || "Untitled";
  const gutter = gutterFor(estimatePages(input.chapters.reduce((n, c) => n + (c.words ?? 0), 0), settings.trim));
  const body = sheets
    .filter((s) => !s.cls.split(/\s+/).includes("cover"))
    .map((s) => {
      const html = sheetHtml(files, s);
      // The title page has no section of its own in the EPUB, so it's given one here.
      return `<div class="print-sheet">${s.cls.includes("titlepage") && !/<section/.test(html) ? `<section class="titlepage">${html}</section>` : html}</div>`;
    })
    .join("\n");
  return `<!DOCTYPE html>
<html lang="${escapeXml(input.project.language?.trim() || "en")}">
<head>
<meta charset="UTF-8"/>
<title>${escapeXml(title)}</title>
<style data-book>
${inlineStyles(files)}
</style>
<style data-print>
${printStyles(settings, title, gutter)}
</style>
<meta name="tbv-print" content="${escapeXml(JSON.stringify({ settings, title, gutter }))}"/>
</head>
<body>
${body}
</body>
</html>`;
}

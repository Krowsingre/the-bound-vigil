// Rebuilding a book from a PDF for Scribe: the words on each page, read with
// PDF.js, turned back into headings, paragraphs and poems. A PDF only knows
// where each line sits, so this reads the layout: bigger lines that look
// like titles become headings, centred or short lines set apart become
// verse, page numbers and running heads repeated page after page are left
// out, and a paragraph cut by a page turn is joined again. Nothing is
// reworded. A PDF of scanned pages has no words to read, and says so.

import type { ImportedDocument, ImportWarning } from "./importDoc";

/** One run of text as PDF.js gives it, in points from the page's bottom left. */
export interface PdfItem {
  str: string;
  x: number;
  y: number;
  width: number;
  /** The font size, near enough. */
  size: number;
}

export interface PdfPage {
  width: number;
  height: number;
  items: PdfItem[];
  /** Pictures drawn on the page. */
  pictures: number;
}

interface Line {
  text: string;
  x: number;
  right: number;
  y: number;
  size: number;
  page: number;
}

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** "D e d i c a t i o n" → "Dedication", "G a r y M e u l e m a n s" → "Gary Meulemans".
 * All-capital spacing ("K E N N") can't be split into words, so it stays as it is. */
export function unspace(text: string): string {
  const t = text.trim();
  if (!/^(\S ){2,}\S$/.test(t) || !/[a-z]/.test(t)) return text;
  return t.replace(/ /g, "").replace(/(?<=[a-z0-9.,'’])(?=[A-Z@])/g, " ");
}

/** The lines of a page, top to bottom, each run joined left to right. */
function linesOf(page: PdfPage, index: number): Line[] {
  const items = page.items.filter((i) => i.str.trim() && i.size > 0).sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: { items: PdfItem[]; y: number; size: number }[] = [];
  for (const item of items) {
    const line = lines.find((l) => Math.abs(l.y - item.y) < Math.max(l.size, item.size) * 0.4);
    if (line) {
      line.items.push(item);
      line.size = Math.max(line.size, item.size);
    } else lines.push({ items: [item], y: item.y, size: item.size });
  }
  // A wide gap inside a line is a second column: each side is a line of its own.
  let columns = 0;
  const out = lines.flatMap((l) => {
    const runs = l.items.filter((r) => r.str.trim()).sort((a, b) => a.x - b.x);
    const parts: Line[] = [];
    let text = "";
    let start = runs[0].x;
    let end = runs[0].x;
    const finish = () => {
      if (text.trim()) parts.push({ text: unspace(text.replace(/\s+/g, " ").trim()), x: start, right: end, y: l.y, size: Math.round(l.size * 10) / 10, page: index });
    };
    for (const r of runs) {
      if (text && r.x - end > l.size * 3) {
        finish();
        text = "";
        start = r.x;
      }
      if (text && r.x - end > l.size * 0.15 && !/\s$/.test(text) && !/^\s/.test(r.str)) text += " ";
      text += r.str;
      end = r.x + r.width;
    }
    finish();
    if (parts.length > 1) columns++;
    return parts;
  });
  // Two columns read down the left, then down the right.
  const side = (l: Line) => (columns >= 3 && l.x >= page.width / 2 ? 1 : 0);
  return out.sort((a, b) => side(a) - side(b) || b.y - a.y || a.x - b.x);
}

const sentenceEnd = /[.!?:;…"”’)\]]$/;
const pageNumber = /^(page\s+)?(\d{1,4}|[ivxlc]{1,7})$/i;
const SMALL = new Set(["a", "an", "and", "as", "at", "but", "by", "for", "in", "of", "on", "or", "the", "to", "with", "from", "into", "is"]);

/** Looks like a title: short, and its words mostly start with capitals. */
function titleLike(text: string): boolean {
  const words = text.split(/\s+/).filter((w) => /\w/.test(w));
  if (!words.length || words.length > 12) return false;
  if (/^(chapter|part|book|prologue|epilogue)\b/i.test(text)) return true;
  const counted = words.filter((w, i) => i === 0 || !SMALL.has(w.toLowerCase()));
  const capital = counted.filter((w) => /^[^a-z]*[A-Z0-9]/.test(w)).length;
  return capital / Math.max(1, counted.length) >= 0.6;
}

const mostCommon = (values: number[]) => {
  const count = new Map<number, number>();
  for (const v of values) count.set(v, (count.get(v) ?? 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
};

/** The book's pages, read as a PDF reader shows them, turned into Scribe's markup. */
export function layoutToHtml(pages: PdfPage[]): { html: string; title: string | null; warnings: ImportWarning[] } {
  const warnings: ImportWarning[] = [];
  const all = pages.map((p, i) => linesOf(p, i));

  // Running heads and page numbers: near the top or bottom, the same words page after page.
  const edge = (l: Line) => {
    const h = pages[l.page].height;
    return l.y > h * 0.92 || l.y < h * 0.08;
  };
  const shape = (t: string) => t.toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ");
  const seen = new Map<string, Set<number>>();
  for (const l of all.flat()) if (edge(l)) seen.set(shape(l.text), (seen.get(shape(l.text)) ?? new Set()).add(l.page));
  const repeated = (l: Line) => (seen.get(shape(l.text))?.size ?? 0) >= Math.max(3, pages.length * 0.2);
  let dropped = 0;
  const lines = all.map((page) =>
    page.filter((l) => {
      const out = edge(l) && (pageNumber.test(l.text) || repeated(l));
      if (out) dropped++;
      return !out;
    }),
  );
  if (dropped) warnings.push({ kind: "text", message: `${dropped} page numbers and running heads were left out. Scribe numbers its own pages.` });

  const words = lines.flat().reduce((n, l) => n + l.text.split(/\s+/).length, 0);
  const pictured = pages.filter((p) => p.pictures > 0).length;
  if (words < Math.max(20, pages.length * 4)) {
    throw new Error(
      pictured
        ? "This PDF holds pictures of its pages rather than their words, so there's nothing to read yet. Reading scanned pages comes in a later update; if you have the Word or EPUB file it was made from, import that instead."
        : "No words could be read from this PDF.",
    );
  }

  // The size most of the words are set in, and where they sit.
  const body = mostCommon(lines.flat().flatMap((l) => Array<number>(Math.min(50, l.text.length)).fill(l.size)));
  const bodyLines = lines.flat().filter((l) => Math.abs(l.size - body) < 0.6);
  const lefts = bodyLines.map((l) => Math.round(l.x));
  const left = mostCommon(lefts);
  const right = bodyLines.map((l) => l.right).sort((a, b) => a - b)[Math.floor(bodyLines.length * 0.9)] ?? 0;
  const column = Math.max(1, right - left);
  const spacing = mostCommon(
    lines.flatMap((page) => page.slice(1).map((l, i) => Math.round(page[i].y - l.y)).filter((g) => g > 0 && g < body * 3)),
  ) || body * 1.4;

  // The title page: the first page, when it's a few words in big type.
  let title: string | null = null;
  const first = lines[0] ?? [];
  if (first.length && first.reduce((n, l) => n + l.text.split(/\s+/).length, 0) < 40) {
    const biggest = Math.max(...first.map((l) => l.size));
    if (biggest > body * 1.5) title = first.filter((l) => l.size === biggest).map((l) => l.text).join(" ");
  }

  const out: string[] = [];
  let headed = false;
  lines.forEach((page, pageIndex) => {
    // Pages before the first heading are each a page of their own: the title page, the copyright page…
    if (!headed && page.length) {
      const words = page.map((l) => l.text).join(" ");
      const opens = page[0].size > body * 1.25 && titleLike(page[0].text);
      if (title && pageIndex === 0) out.push("<h1>Title page</h1>");
      else if (!opens && pageIndex > 0) out.push(/©|\bcopyright\b|all rights reserved/i.test(words) ? "<h1>Copyright</h1>" : "<h1></h1>");
    }
    // Blocks: lines close together, apart from the next by a wider gap or a change of size.
    const blocks: Line[][] = [];
    for (const l of page) {
      const last = blocks[blocks.length - 1];
      const prev = last?.[last.length - 1];
      if (prev && prev.y - l.y < Math.max(spacing, l.size * 1.2) * 1.5 && Math.abs(prev.size - l.size) < 0.6) last.push(l);
      else blocks.push([l]);
    }
    for (const block of blocks) {
      const size = block[0].size;
      const text = block.map((l) => l.text).join(" ");
      // The title page stays as written: Scribe makes its own from the book's details.
      if (title && pageIndex === 0) {
        out.push(`<p>${block.map((l) => escapeHtml(l.text)).join("<br>")}</p>`);
        continue;
      }
      if (size > body * 1.25 && titleLike(text)) {
        headed = true;
        out.push(`<h1>${escapeHtml(text)}</h1>`);
        continue;
      }
      if (/^([*•·~#]\s*){1,5}$/.test(text)) {
        out.push("<hr>");
        continue;
      }
      // Verse: lines that don't reach across the column, or that are centred.
      const short = block.filter((l) => l.right - l.x < column * 0.8).length;
      const lefts = block.map((l) => l.x);
      const ragged = Math.max(...lefts) - Math.min(...lefts) > body * 1.5;
      const isVerse = block.length >= 2 && short >= block.length - 1 && (ragged || (short === block.length && block.length >= 3));
      if (isVerse) {
        out.push(`<p>${block.map((l) => escapeHtml(l.text)).join("<br>")}</p>`);
        continue;
      }
      // Prose: a new paragraph where a line is indented, or the line before stopped short.
      let paragraph = "";
      const flush = () => {
        if (paragraph) out.push(`<p>${escapeHtml(paragraph)}</p>`);
        paragraph = "";
      };
      block.forEach((l, i) => {
        const indented = l.x - left > body * 0.8 && l.x - left < column * 0.3;
        const prevShort = i > 0 && block[i - 1].right < right - body * 3 && sentenceEnd.test(block[i - 1].text);
        if (i > 0 && (indented || prevShort)) flush();
        // A paragraph cut by the page turn carries on.
        if (i === 0 && !paragraph && !indented && /^[a-z]/.test(l.text)) {
          const prev = out[out.length - 1];
          if (prev?.startsWith("<p>") && !prev.includes("<br>") && !sentenceEnd.test(prev.slice(3, -4))) {
            paragraph = prev.slice(3, -4).replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
            out.pop();
          }
        }
        if (!paragraph) paragraph = l.text;
        else if (/[a-z]-$/.test(paragraph) && /^[a-z]/.test(l.text)) paragraph = paragraph.slice(0, -1) + l.text;
        else paragraph += " " + l.text;
      });
      flush();
    }
  });
  if (pictured) warnings.push({ kind: "images", message: `${pictured} ${pictured === 1 ? "page has a picture" : "pages have pictures"} in the PDF. Pictures aren't brought in from a PDF; add them again in Scribe.` });
  warnings.push({ kind: "formatting", message: "A PDF doesn't say which words are in italics or bold, so none are. Check the book against the original." });
  return { html: out.join(""), title, warnings };
}

/** Reads a PDF's pages with PDF.js. */
async function readPages(bytes: Uint8Array): Promise<{ pages: PdfPage[]; info: Record<string, unknown> }> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (typeof window !== "undefined" && !pdfjs.GlobalWorkerOptions.workerSrc)
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(`${import.meta.env.BASE_URL}pdfjs/pdf.worker.min.mjs`, location.href).toString();
  // PDF.js takes the bytes over, so it's given a copy.
  const task = pdfjs.getDocument({ data: bytes.slice() });
  const doc = await task.promise;
  try {
    const info = ((await doc.getMetadata().catch(() => null))?.info ?? {}) as Record<string, unknown>;
    const pages: PdfPage[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const view = page.getViewport({ scale: 1 });
      const text = await page.getTextContent();
      const items: PdfItem[] = [];
      for (const item of text.items) {
        if (!("str" in item) || !item.str) continue;
        const [, , , d, e, f] = item.transform as number[];
        items.push({ str: item.str, x: e, y: f, width: item.width, size: item.height || Math.abs(d) });
      }
      let pictures = 0;
      try {
        const ops = await page.getOperatorList();
        pictures = ops.fnArray.filter((op) => op === pdfjs.OPS.paintImageXObject || op === pdfjs.OPS.paintInlineImageXObject).length;
      } catch {
        // Counting pictures is only for the report.
      }
      pages.push({ width: view.width, height: view.height, items, pictures });
      page.cleanup();
    }
    return { pages, info };
  } finally {
    void task.destroy();
  }
}

export async function fromPdf(bytes: Uint8Array, fallback: string): Promise<ImportedDocument> {
  const { pages, info } = await readPages(bytes);
  const { html, title, warnings } = layoutToHtml(pages);
  const said = (key: string) => (typeof info[key] === "string" && (info[key] as string).trim()) || null;
  return { title: said("Title") ?? title ?? fallback, author: said("Author"), description: null, html, warnings };
}

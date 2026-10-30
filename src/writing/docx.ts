// A book written in Scribe as a Word file (DOCX), made from the same pages
// as the EPUB. Titles use Word's own Heading styles, so the navigation pane
// and Word's table of contents work; footnotes are real Word footnotes; text
// styling, pictures, page breaks and alignment are kept.
//
// The same builder makes manuscripts: Shunn's standard manuscript format for
// prose and the standard poetry manuscript, which agents, publishers and
// magazines ask for (12 pt Times or Courier, your contact details and word
// count on the first page, your surname, the title and the page number in
// the header).

import { strToU8, zipSync } from "fflate";
import { bookSheets, escapeXml as esc, type EpubInput, type ManuscriptSettings } from "./epub";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS = `xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"`;

/** Twips (1/20 pt): 1440 an inch. EMU: 914400 an inch. */
const INCH = 1440;
const EMU = 914400;

interface RunProps {
  b?: boolean;
  i?: boolean;
  u?: boolean;
  strike?: boolean;
  sup?: boolean;
  sub?: boolean;
  smallCaps?: boolean;
  caps?: boolean;
  font?: string;
  /** Half-points. */
  size?: number;
  style?: string;
}

const PASSAGE_FONT: Record<string, string> = {
  "lora, serif": "Lora",
  "echolume, serif": "Echolume",
  serif: "Georgia",
  "sans-serif": "Arial",
  monospace: "Courier New",
};

/** Styles that open a chapter. */
const TOP_OF_CHAPTER = ["Heading1", "PageTitle", "ChapterLabel"];

/** Pages Scribe makes from the book's details, which a manuscript leaves out. */
const MADE_PAGES = ["page-half-title", "titlepage", "page-title-page", "page-copyright", "page-contents", "page-also-by"];

/** The size of a picture in pixels, read from its first bytes. */
export function pictureSize(bytes: Uint8Array, mime: string): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  try {
    if (mime === "image/png" && bytes.length > 24) return { width: view.getUint32(16), height: view.getUint32(20) };
    if (mime === "image/gif" && bytes.length > 10) return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
    if (mime === "image/jpeg") {
      let at = 2;
      while (at + 9 < bytes.length) {
        if (bytes[at] !== 0xff) return null;
        const marker = bytes[at + 1];
        const length = view.getUint16(at + 2);
        // Start-of-frame markers carry the size (C4, C8 and CC are something else).
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { height: view.getUint16(at + 5), width: view.getUint16(at + 7) };
        at += 2 + length;
      }
    }
  } catch {
    return null;
  }
  return null;
}

/** Turns a WebP picture (which older Word can't show) into a PNG, where the page can. */
async function asPng(bytes: Uint8Array): Promise<Uint8Array | null> {
  try {
    if (typeof createImageBitmap !== "function" || typeof document === "undefined") return null;
    const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: "image/webp" }));
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
    const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, "image/png"));
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

const MIME_OF: Record<string, string> = { jpg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp" };

interface Media {
  name: string;
  bytes: Uint8Array;
  width: number;
  height: number;
}

/** Everything gathered while writing document.xml. */
class Writer {
  body: string[] = [];
  rels: string[] = [];
  media: Media[] = [];
  notes: string[] = [];
  private nextRel = 10;
  private nextPicture = 1;
  /** The next paragraph starts a new page. */
  breakNext = false;
  constructor(
    readonly pictures: Map<string, Media>,
    readonly manuscript: ManuscriptSettings | null,
    /** The widest a picture may be, in inches. */
    readonly maxWidth: number,
  ) {}

  rel(type: string, target: string, external = false): string {
    const id = `rId${this.nextRel++}`;
    this.rels.push(`<Relationship Id="${id}" Type="${R}/${type}" Target="${esc(target)}"${external ? ` TargetMode="External"` : ""}/>`);
    return id;
  }

  paragraph(style: string, content: string, extra = "") {
    const pageBreak = this.breakNext ? "<w:pageBreakBefore/>" : "";
    // A manuscript's chapters start a third of the way down a fresh page.
    if (this.breakNext && this.manuscript?.layout === "shunn" && TOP_OF_CHAPTER.includes(style) && !extra.includes("<w:spacing")) extra = `<w:spacing w:before="3600"/>` + extra;
    this.breakNext = false;
    this.body.push(`<w:p><w:pPr><w:pStyle w:val="${style}"/>${pageBreak}${extra}</w:pPr>${content}</w:p>`);
  }

  picture(path: string): string {
    const media = this.pictures.get(path);
    if (!media) return "";
    if (!this.media.includes(media)) this.media.push(media);
    const id = this.rel("image", `media/${media.name}`);
    const n = this.nextPicture++;
    // At 96 pixels an inch, no wider than the page.
    let width = (media.width / 96) * EMU;
    let height = (media.height / 96) * EMU;
    const most = this.maxWidth * EMU;
    if (width > most) {
      height = (height * most) / width;
      width = most;
    }
    const cx = Math.round(width);
    const cy = Math.round(height);
    return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${n}" name="Picture ${n}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${n}" name="${media.name}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
  }
}

function runProps(p: RunProps): string {
  const parts = [
    p.style ? `<w:rStyle w:val="${p.style}"/>` : "",
    p.font ? `<w:rFonts w:ascii="${esc(p.font)}" w:hAnsi="${esc(p.font)}" w:cs="${esc(p.font)}"/>` : "",
    p.b ? "<w:b/>" : "",
    p.i ? "<w:i/>" : "",
    p.caps ? "<w:caps/>" : "",
    p.smallCaps ? "<w:smallCaps/>" : "",
    p.strike ? "<w:strike/>" : "",
    p.size ? `<w:sz w:val="${p.size}"/>` : "",
    p.u ? `<w:u w:val="single"/>` : "",
    p.sup ? `<w:vertAlign w:val="superscript"/>` : p.sub ? `<w:vertAlign w:val="subscript"/>` : "",
  ].join("");
  return parts ? `<w:rPr>${parts}</w:rPr>` : "";
}

const textRun = (text: string, p: RunProps) => (text ? `<w:r>${runProps(p)}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>` : "");

/** A paragraph's own alignment, from its style. */
function align(el: Element): string {
  const found = /text-align:\s*(left|center|right|justify)/.exec(el.getAttribute("style") ?? "");
  return found ? `<w:jc w:val="${{ left: "left", center: "center", right: "right", justify: "both" }[found[1]]}"/>` : "";
}

/** The runs inside an element: text with its styling, pictures, links and footnote marks. */
function runs(node: Node, p: RunProps, w: Writer, notes: Map<string, Element>): string {
  if (node.nodeType === Node.TEXT_NODE) return textRun((node.textContent ?? "").replace(/[\r\n\t]+/g, " "), p);
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  const inner = (q: RunProps) => [...el.childNodes].map((c) => runs(c, q, w, notes)).join("");
  if (tag === "br") return "<w:r><w:br/></w:r>";
  if (tag === "img") return w.picture(el.getAttribute("src") ?? "");
  if (tag === "a" && el.getAttribute("epub:type") === "noteref") {
    const note = notes.get((el.getAttribute("href") ?? "").replace(/^.*#/, ""));
    if (!note) return "";
    const id = w.notes.length + 1;
    // The note's own number and link back are Word's to write.
    const body = note.cloneNode(true) as Element;
    body.querySelector("p > a:first-child")?.remove();
    const text = [...(body.querySelector("p") ?? body).childNodes].map((c) => runs(c, {}, w, notes)).join("").replace(/^(<w:r>(?:<w:rPr>.*?<\/w:rPr>)?<w:t xml:space="preserve">)\s+/, "$1");
    w.notes.push(
      `<w:footnote w:id="${id}"><w:p><w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr><w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> </w:t></w:r>${text}</w:p></w:footnote>`,
    );
    return `<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="${id}"/></w:r>`;
  }
  if (tag === "a") {
    const href = el.getAttribute("href") ?? "";
    if (/^(https?:|mailto:)/i.test(href)) return `<w:hyperlink r:id="${w.rel("hyperlink", href, true)}">${inner({ ...p, style: "Hyperlink" })}</w:hyperlink>`;
    return inner(p);
  }
  // A note mark's own superscript is Word's.
  if (tag === "sup" && el.querySelector("a[epub\\:type='noteref'], a[href*='-fn']")) return inner(p);
  const q = { ...p };
  if (tag === "strong" || tag === "b") q.b = true;
  else if (tag === "em" || tag === "i" || tag === "cite") q.i = true;
  else if (tag === "u") q.u = true;
  else if (tag === "s") q.strike = true;
  else if (tag === "sup") q.sup = true;
  else if (tag === "sub") q.sub = true;
  else if (tag === "code") q.font = "Courier New";
  if (tag === "span") {
    const style = el.getAttribute("style") ?? "";
    if (/font-variant:\s*small-caps/.test(style)) q.smallCaps = true;
    if (/text-transform:\s*uppercase/.test(style)) q.caps = true;
    const family = /font-family:\s*([^;]+)/.exec(style)?.[1].trim().toLowerCase();
    if (family && PASSAGE_FONT[family] && !w.manuscript) q.font = PASSAGE_FONT[family];
    const size = /font-size:\s*([\d.]+)em/.exec(style);
    if (size && !w.manuscript) q.size = Math.round(Number(size[1]) * 24);
  }
  return inner(q);
}

interface Context {
  w: Writer;
  notes: Map<string, Element>;
  /** The next paragraph follows a heading or break, so isn't indented. */
  first: boolean;
  /** In a quotation or list, for its style. */
  quote: boolean;
  /** Where a section's headings go in Word's outline: true for chapters, false for pages like Contents. */
  outline: boolean;
  /** Text made by Scribe for the contents, in place of Word's own. */
  contents: { level: number; text: string }[];
  /** Characters a manuscript puts at a scene break. */
  sceneMark: string | null;
}

function blocks(root: Element, c: Context) {
  const { w } = c;
  for (const node of root.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (node.textContent?.trim()) {
        w.paragraph(c.first ? "BodyFirst" : "Normal", textRun(node.textContent.trim(), {}));
        c.first = false;
      }
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    const cls = (el.getAttribute("class") ?? "").split(/\s+/);
    const inner = runs(el, {}, w, c.notes);
    if (tag === "h1") {
      w.paragraph(c.outline ? "Heading1" : "PageTitle", inner, align(el));
      c.first = true;
    } else if (tag === "h2" || tag === "h3") {
      w.paragraph(tag === "h2" ? "Heading2" : "Heading3", inner, align(el));
      c.first = true;
    } else if (tag === "p" && cls.includes("chapter-label")) {
      w.paragraph("ChapterLabel", inner);
    } else if (tag === "p" && (cls.includes("title") || cls.includes("author") || cls.includes("series")) && root.closest(".titlepage, .page-half-title, body")) {
      w.paragraph(cls.includes("title") ? "Title" : cls.includes("author") ? "Subtitle" : "SeriesLine", inner);
    } else if ((tag === "p" && cls.includes("scene")) || (tag === "hr" && cls.includes("scene"))) {
      const mark = c.sceneMark ?? (el.textContent?.trim() || (tag === "hr" ? "———" : ""));
      w.paragraph("SceneBreak", textRun(mark, {}));
      c.first = true;
    } else if (tag === "p" && cls.includes("blank")) {
      w.paragraph("Blank", "");
      c.first = true;
    } else if (tag === "p" && cls.includes("source")) {
      w.paragraph("Source", inner);
    } else if (tag === "p" && cls.includes("line")) {
      const left = /margin-left:\s*([\d.]+)em/.exec(el.getAttribute("style") ?? "");
      w.paragraph("PoemLine", inner || textRun(" ", {}), left ? `<w:ind w:left="${Math.round(Number(left[1]) * 240)}"/>` : "");
    } else if (tag === "p") {
      if (!inner && !el.querySelector("img")) continue;
      const centred = el.parentElement?.closest(".page-dedication, .page-epigraph, .part, .poem-centred");
      const style = c.quote ? "Quote" : root.closest(".page-copyright") || el.closest(".page-copyright") ? "Copyright" : centred ? "Centred" : c.first ? "BodyFirst" : "Normal";
      w.paragraph(style, inner, align(el));
      c.first = false;
    } else if (tag === "div" && cls.includes("picture")) {
      w.paragraph("Picture", inner);
      c.first = true;
    } else if (tag === "figure") {
      // A captioned picture, or one on a page of its own.
      const full = cls.includes("full-page");
      if (full) w.breakNext = true;
      const img = el.querySelector("img");
      w.paragraph("Picture", img ? w.picture(img.getAttribute("src") ?? "") : "");
      const caption = el.querySelector("figcaption");
      if (caption) w.paragraph("Caption", runs(caption, {}, w, c.notes));
      if (full) w.breakNext = true;
      c.first = true;
    } else if (tag === "div" && cls.includes("pagebreak")) {
      w.breakNext = true;
      c.first = true;
    } else if (tag === "div" && cls.includes("stanza")) {
      blocks(el, c);
      w.paragraph("StanzaGap", "");
    } else if (tag === "blockquote") {
      const was = c.quote;
      c.quote = true;
      blocks(el, c);
      c.quote = was;
      c.first = true;
    } else if ((tag === "ol" || tag === "ul") && cls.includes("contents")) {
      const walk = (list: Element, level: number) => {
        for (const li of list.children) {
          const a = li.querySelector(":scope > a");
          if (a) c.contents.push({ level, text: (a.textContent ?? "").trim() });
          const sub = li.querySelector(":scope > ol, :scope > ul");
          if (sub) walk(sub, level + 1);
        }
      };
      walk(el, 1);
      tocField(w, c.contents);
      c.contents = [];
    } else if (tag === "ol" || tag === "ul") {
      let n = 0;
      for (const li of el.children) {
        if (li.tagName.toLowerCase() !== "li") continue;
        n++;
        const nested = [...li.children].filter((x) => /^(ol|ul)$/i.test(x.tagName));
        const own = [...li.childNodes].filter((x) => !nested.includes(x as Element));
        const content = own.map((x) => (x.nodeType === Node.ELEMENT_NODE && (x as Element).tagName.toLowerCase() === "p" ? runs(x, {}, w, c.notes) : runs(x, {}, w, c.notes))).join("");
        w.paragraph("ListParagraph", textRun(tag === "ol" ? `${n}.\t` : "•\t", {}) + content);
        for (const sub of nested) blocks(sub.parentElement === li ? wrap(sub) : sub, c);
      }
      c.first = true;
    } else if (tag === "pre") {
      const lines = (el.textContent ?? "").split("\n");
      w.paragraph("Code", lines.map((line, i) => (i ? "<w:r><w:br/></w:r>" : "") + textRun(line, { font: "Courier New" })).join(""));
    } else if (tag === "section" && cls.includes("footnotes")) {
      // Already placed as Word footnotes where they're marked.
    } else if (tag === "nav" && el.hasAttribute("hidden")) {
      // The landmarks e-readers use.
    } else {
      blocks(el, c);
    }
  }
}

/** An element held alone in a fresh body, so a nested list is walked as a list. */
function wrap(el: Element): Element {
  const holder = el.ownerDocument.createElement("div");
  holder.appendChild(el.cloneNode(true));
  return holder;
}

/** Word's own table of contents, filled in with Scribe's so it shows before Word updates it. */
function tocField(w: Writer, entries: { level: number; text: string }[]) {
  const depth = Math.max(1, Math.min(3, ...entries.map((e) => e.level)));
  const begin = `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> TOC \\o "1-${Math.max(depth, 3)}" \\h \\z \\u </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>`;
  const end = `<w:r><w:fldChar w:fldCharType="end"/></w:r>`;
  if (!entries.length) {
    w.paragraph("TOC1", begin + end);
    return;
  }
  entries.forEach((e, i) => w.paragraph(`TOC${Math.min(3, e.level)}`, (i === 0 ? begin : "") + textRun(e.text, {}) + (i === entries.length - 1 ? end : "")));
}

function styles(input: EpubInput, manuscript: ManuscriptSettings | null): string {
  const s = input.settings;
  const font = manuscript ? (manuscript.font === "courier" ? "Courier New" : "Times New Roman") : s.font === "lora" ? "Lora" : s.font === "echolume" ? "Echolume" : "Georgia";
  const prose = manuscript?.layout === "shunn";
  const line = prose ? 480 : manuscript ? 240 : 300;
  const body = manuscript
    ? `<w:spacing w:after="0" w:line="${line}" w:lineRule="auto"/>${prose ? `<w:ind w:firstLine="720"/>` : ""}<w:jc w:val="left"/>`
    : s.paragraphs === "indent"
      ? `<w:spacing w:after="0" w:line="${line}" w:lineRule="auto"/><w:ind w:firstLine="360"/><w:jc w:val="${s.align === "justify" ? "both" : "left"}"/>`
      : `<w:spacing w:after="180" w:line="${line}" w:lineRule="auto"/><w:jc w:val="${s.align === "justify" ? "both" : "left"}"/>`;
  const title = s.titles === "center" || manuscript ? "center" : "left";
  // A manuscript's chapter titles move a third of the way down only on a fresh page (see Writer.paragraph).
  const headingTop = manuscript ? (prose ? 480 : 0) : 720;
  const style = (id: string, name: string, ppr: string, rpr = "", extra = "", basedOn = "Normal") =>
    `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/>${id === "Normal" ? "" : `<w:basedOn w:val="${basedOn}"/>`}<w:next w:val="${id.startsWith("Heading") || id === "ChapterLabel" ? "BodyFirst" : id === "Title" ? "Subtitle" : id}"/>${extra}<w:qFormat/><w:pPr>${ppr}</w:pPr>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ""}</w:style>`;
  const big = (pt: number) => (manuscript ? "" : `<w:sz w:val="${pt * 2}"/>`);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${W}">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:cs="${font}" w:eastAsia="${font}"/><w:sz w:val="24"/><w:szCs w:val="24"/><w:lang w:val="${esc(input.project.language?.trim() || "en")}"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:widowControl/></w:pPr></w:pPrDefault></w:docDefaults>
${style("Normal", "Normal", body)}
${style("BodyFirst", "First Paragraph", `<w:ind w:firstLine="0"/>`)}
${style("Heading1", "heading 1", `<w:keepNext/><w:spacing w:before="${headingTop}" w:after="${manuscript ? 480 : 480}" w:line="240" w:lineRule="auto"/><w:ind w:firstLine="0"/><w:jc w:val="${title}"/><w:outlineLvl w:val="0"/>`, big(18))}
${style("Heading2", "heading 2", `<w:keepNext/><w:spacing w:before="360" w:after="180" w:line="240" w:lineRule="auto"/><w:ind w:firstLine="0"/><w:jc w:val="left"/><w:outlineLvl w:val="1"/>`, manuscript ? "" : `<w:b/>${big(14)}`)}
${style("Heading3", "heading 3", `<w:keepNext/><w:spacing w:before="240" w:after="120" w:line="240" w:lineRule="auto"/><w:ind w:firstLine="0"/><w:jc w:val="left"/><w:outlineLvl w:val="2"/>`, manuscript ? "<w:i/>" : `<w:b/><w:i/>${big(12)}`)}
${style("PageTitle", "Page Title", `<w:keepNext/><w:spacing w:before="${headingTop}" w:after="480" w:line="240" w:lineRule="auto"/><w:ind w:firstLine="0"/><w:jc w:val="${title}"/>`, big(16))}
${style("ChapterLabel", "Chapter Label", `<w:keepNext/><w:spacing w:before="${headingTop}" w:after="0"/><w:ind w:firstLine="0"/><w:jc w:val="${title}"/>`, `<w:caps/><w:spacing w:val="40"/><w:sz w:val="20"/>`)}
${style("Title", "Title", `<w:spacing w:before="${manuscript ? 0 : 2880}" w:after="240" w:line="240" w:lineRule="auto"/><w:ind w:firstLine="0"/><w:jc w:val="center"/>`, big(28))}
${style("Subtitle", "Subtitle", `<w:spacing w:after="240" w:line="240" w:lineRule="auto"/><w:ind w:firstLine="0"/><w:jc w:val="center"/>`, big(16))}
${style("SeriesLine", "Series", `<w:ind w:firstLine="0"/><w:jc w:val="center"/>`, "<w:i/>")}
${style("SceneBreak", "Scene Break", `<w:spacing w:before="${manuscript ? 0 : 240}" w:after="${manuscript ? 0 : 240}"/><w:ind w:firstLine="0"/><w:jc w:val="center"/>`)}
${style("Blank", "Blank Line", `<w:ind w:firstLine="0"/>`)}
${style("Centred", "Centred", `<w:spacing w:after="120"/><w:ind w:firstLine="0"/><w:jc w:val="center"/>`)}
${style("Quote", "Quote", `<w:spacing w:before="120" w:after="120"/><w:ind w:left="720" w:right="720" w:firstLine="0"/>`, manuscript ? "" : "<w:i/>")}
${style("Code", "Code", `<w:spacing w:after="120" w:line="240" w:lineRule="auto"/><w:ind w:firstLine="0"/><w:jc w:val="left"/>`, `<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/><w:sz w:val="20"/>`)}
${style("PoemLine", "Poem Line", `<w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:ind w:left="${manuscript ? 0 : 720}" w:hanging="${manuscript ? 0 : 360}" w:firstLine="0"/><w:jc w:val="left"/>`)}
${style("StanzaGap", "Stanza Gap", `<w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:ind w:firstLine="0"/>`)}
${style("ListParagraph", "List Paragraph", `<w:spacing w:after="60"/><w:ind w:left="720" w:hanging="360" w:firstLine="0"/><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs><w:jc w:val="left"/>`)}
${style("Picture", "Picture", `<w:spacing w:before="240" w:after="240"/><w:ind w:firstLine="0"/><w:jc w:val="center"/><w:keepNext/>`)}
${style("Caption", "Caption", `<w:spacing w:before="0" w:after="240"/><w:ind w:firstLine="0"/><w:jc w:val="center"/>`, "<w:i/><w:sz w:val=\"20\"/>")}
${style("Copyright", "Copyright", `<w:spacing w:after="160" w:line="240" w:lineRule="auto"/><w:ind w:firstLine="0"/><w:jc w:val="left"/>`, "<w:sz w:val=\"18\"/>")}
${style("Source", "Source", `<w:spacing w:after="140" w:line="240" w:lineRule="auto"/><w:ind w:left="720" w:hanging="720" w:firstLine="0"/><w:jc w:val="left"/>`)}
${style("TOC1", "toc 1", `<w:spacing w:after="100"/><w:ind w:firstLine="0"/><w:jc w:val="left"/>`)}
${style("TOC2", "toc 2", `<w:spacing w:after="80"/><w:ind w:left="360" w:firstLine="0"/><w:jc w:val="left"/>`)}
${style("TOC3", "toc 3", `<w:spacing w:after="60"/><w:ind w:left="720" w:firstLine="0"/><w:jc w:val="left"/>`)}
${style("FootnoteText", "footnote text", `<w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:ind w:firstLine="0"/><w:jc w:val="left"/>`, manuscript ? "" : `<w:sz w:val="20"/>`)}
${style("Header", "header", `<w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:ind w:firstLine="0"/><w:jc w:val="right"/>`)}
${style("Footer", "footer", `<w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:ind w:firstLine="0"/><w:jc w:val="center"/>`)}
${style("Contact", "Contact", `<w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:ind w:firstLine="0"/><w:jc w:val="left"/><w:tabs><w:tab w:val="right" w:pos="9360"/></w:tabs>`)}
<w:style w:type="character" w:styleId="FootnoteReference"><w:name w:val="footnote reference"/><w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style>
<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="1F4E79"/><w:u w:val="single"/></w:rPr></w:style>
</w:styles>`;
}

/** The book's words counted the way a manuscript reports them: rounded, prose to the nearest hundred. */
export function wordCountLine(input: EpubInput, layout: ManuscriptSettings["layout"]): string {
  if (layout === "poetry") {
    const lines = input.chapters.reduce((n, c) => n + (c.body.match(/<br\s*\/?>|<\/p>/gi)?.length ?? 0), 0);
    const poems = input.chapters.filter((c) => c.role !== "part" && c.body.trim()).length;
    return `${poems} ${poems === 1 ? "poem" : "poems"}, ${lines} lines`;
  }
  const words = input.chapters.reduce((n, c) => n + (c.words ?? 0), 0);
  const rounded = words < 1000 ? Math.max(100, Math.round(words / 100) * 100) : words < 20000 ? Math.round(words / 100) * 100 : Math.round(words / 1000) * 1000;
  return `about ${rounded.toLocaleString("en-US")} words`;
}

/** The first page's contact block: your name and the word count on one line, then the rest of your details. */
function contactBlock(w: Writer, input: EpubInput, m: ManuscriptSettings) {
  const name = m.name.trim() || input.project.author?.trim() || "";
  w.paragraph("Contact", textRun(name, {}) + `<w:r><w:tab/></w:r>` + textRun(wordCountLine(input, m.layout), {}));
  for (const line of [...m.address.split("\n"), m.phone, m.email].map((l) => l.trim()).filter(Boolean)) w.paragraph("Contact", textRun(line, {}));
}

/** The book as a Word file. With `manuscript`, laid out as a standard manuscript. */
export async function buildDocx(input: EpubInput, manuscript: ManuscriptSettings | null = null): Promise<Uint8Array> {
  const { sheets, files } = bookSheets(input);
  // Pictures as Word can show them, with their sizes.
  const pictures = new Map<string, Media>();
  let count = 0;
  for (const [path, data] of files) {
    if (!path.startsWith("images/") || !(data instanceof Uint8Array)) continue;
    const ext = path.split(".").pop() ?? "";
    let bytes = data;
    let mime = MIME_OF[ext] ?? "";
    if (mime === "image/webp") {
      const png = await asPng(data);
      if (!png) continue;
      bytes = png;
      mime = "image/png";
    }
    const size = pictureSize(bytes, mime);
    if (!size) continue;
    pictures.set(path, { name: `picture${++count}.${mime === "image/jpeg" ? "jpg" : mime.split("/")[1]}`, bytes, ...size });
  }
  const w = new Writer(pictures, manuscript, manuscript ? 6.5 : 6);
  const title = input.project.title.trim() || "Untitled";
  const author = (manuscript?.name.trim() || input.project.author?.trim() || "").trim();

  if (manuscript) {
    contactBlock(w, input, manuscript);
    if (manuscript.layout === "shunn") {
      // The title about halfway down the first page, then "by", then the story.
      w.paragraph("Title", textRun(title, {}), `<w:spacing w:before="${INCH * 3}" w:after="0" w:line="480" w:lineRule="auto"/>`);
      if (author) w.paragraph("Subtitle", textRun(`by ${author}`, {}), `<w:spacing w:after="480" w:line="480" w:lineRule="auto"/>`);
    }
  }

  let firstSection = true;
  for (const sheet of sheets) {
    const sheetClasses = sheet.cls.split(/\s+/);
    if (sheetClasses.includes("cover")) {
      if (manuscript) continue;
      const doc = new DOMParser().parseFromString(`<body>${sheet.html}</body>`, "text/html");
      const img = doc.querySelector("img");
      if (img) {
        w.paragraph("Picture", w.picture(img.getAttribute("src") ?? ""));
        firstSection = false;
      }
      continue;
    }
    if (manuscript && sheetClasses.includes("titlepage")) continue;
    const doc = new DOMParser().parseFromString(`<body>${sheet.html}</body>`, "text/html");
    const sections = [...doc.body.querySelectorAll(":scope > section")];
    for (const section of sections.length ? sections : [doc.body]) {
      const classes = (section.getAttribute("class") ?? "").split(/\s+/);
      if (manuscript && MADE_PAGES.some((c) => classes.includes(c))) continue;
      const notes = new Map([...section.querySelectorAll("aside[id]")].map((a) => [a.id, a] as const));
      // Every section that starts its own page in the EPUB does in Word too.
      if (!firstSection && (!classes.includes("follows") || (manuscript && classes.includes("chapter")))) w.breakNext = true;
      // A poetry manuscript puts each poem on a page of its own.
      if (!firstSection && manuscript?.layout === "poetry") w.breakNext = true;
      firstSection = false;
      const outline = classes.includes("chapter") || classes.includes("part") || !MADE_PAGES.some((c) => classes.includes(c));
      blocks(section, { w, notes, first: true, quote: false, outline, contents: [], sceneMark: manuscript ? "#" : null });
    }
  }
  if (manuscript?.layout === "shunn") w.paragraph("SceneBreak", textRun("END", {}), `<w:spacing w:before="480"/>`);

  // Headers and footers: a manuscript's running head; otherwise page numbers at the foot.
  const surname = author.split(/\s+/).pop() ?? "";
  const shortTitle = title.split(/\s+/).slice(0, 4).join(" ").toUpperCase();
  const pageField = `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>2</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>`;
  const header = manuscript
    ? `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr ${NS}><w:p><w:pPr><w:pStyle w:val="Header"/></w:pPr>${textRun(`${surname ? `${surname} / ` : ""}${shortTitle} / `, {})}${pageField}</w:p></w:hdr>`
    : null;
  const footer = manuscript
    ? null
    : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr ${NS}><w:p><w:pPr><w:pStyle w:val="Footer"/></w:pPr>${pageField}</w:p></w:ftr>`;
  const empty = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr ${NS}><w:p><w:pPr><w:pStyle w:val="Header"/></w:pPr></w:p></w:hdr>`;
  const headerRel = header ? w.rel("header", "header1.xml") : null;
  const firstRel = header ? w.rel("header", "header2.xml") : null;
  const footerRel = footer ? w.rel("footer", "footer1.xml") : null;
  // Book pages are 6 by 9 inches; manuscripts are on Letter paper with an inch all round.
  const page = manuscript
    ? `<w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>`
    : `<w:pgSz w:w="${6 * INCH}" w:h="${9 * INCH}"/><w:pgMar w:top="1080" w:right="900" w:bottom="1080" w:left="900" w:header="540" w:footer="540" w:gutter="0"/>`;
  const sectPr = `<w:sectPr>${headerRel ? `<w:headerReference w:type="default" r:id="${headerRel}"/><w:headerReference w:type="first" r:id="${firstRel}"/>` : ""}${
    footerRel ? `<w:footerReference w:type="default" r:id="${footerRel}"/>` : ""
  }${page}${header ? "<w:titlePg/>" : ""}</w:sectPr>`;

  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${NS}><w:body>${w.body.join("\n")}${sectPr}</w:body></w:document>`;
  const footnotes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:footnotes ${NS}><w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote><w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>${w.notes.join("")}</w:footnotes>`;
  const settings = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="${W}"><w:footnotePr><w:footnote w:id="-1"/><w:footnote w:id="0"/></w:footnotePr><w:defaultTabStop w:val="720"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`;
  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/styles" Target="styles.xml"/><Relationship Id="rId2" Type="${R}/settings" Target="settings.xml"/><Relationship Id="rId3" Type="${R}/footnotes" Target="footnotes.xml"/>${w.rels.join("")}</Relationships>`;
  const now = (input.now ?? new Date()).toISOString().replace(/\.\d{3}Z$/, "Z");
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(title)}</dc:title>${
    author ? `<dc:creator>${esc(author)}</dc:creator>` : ""
  }<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`;
  const types = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpg" ContentType="image/jpeg"/><Default Extension="gif" ContentType="image/gif"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>${
    header
      ? `<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/header2.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>`
      : ""
  }${footer ? `<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>` : ""}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;

  const entries: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(types),
    "_rels/.rels": strToU8(rootRels),
    "docProps/core.xml": strToU8(core),
    "word/document.xml": strToU8(document),
    "word/styles.xml": strToU8(styles(input, manuscript)),
    "word/settings.xml": strToU8(settings),
    "word/footnotes.xml": strToU8(footnotes),
    "word/_rels/document.xml.rels": strToU8(docRels),
  };
  if (header) {
    entries["word/header1.xml"] = strToU8(header);
    entries["word/header2.xml"] = strToU8(empty);
  }
  if (footer) entries["word/footer1.xml"] = strToU8(footer);
  for (const m of w.media) entries[`word/media/${m.name}`] = m.bytes;
  return zipSync(entries);
}

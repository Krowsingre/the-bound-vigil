// Turns a book written on the Writing page into an EPUB 3 file: chapters as
// XHTML, a table of contents built from chapter titles and headings, the
// book's details, an optional cover and an optional embedded font. A
// navigation file for older readers (toc.ncx) goes in too, since Kindle's
// converter still looks for it. Pure apart from the zip, so it's tested
// without the app.

import { zipSync, strToU8 } from "fflate";
import type { WritingChapter, WritingProject } from "../api/types";
import { DEFAULT_COPYRIGHT, DEFAULT_RIGHTS, firstLine, isMade, isPoem, KINDS, numberInWords, readPage, writePage, type CopyrightDetails, type PageKind, type PageSettings } from "./pages";
import { readSources, readStyle, type CitationStyle, type Cited, type Citer, type Source } from "./sources";
import { styleById, styleCss } from "./bookStyles";
import { DEFAULT_PRINT, readPrint, type PrintSettings } from "./printSettings";

export type SceneBreak = "asterisks" | "ornament" | "space" | "line";
export type BookFont = "lora" | "echolume" | "none";

/** A standard manuscript's layout and the details on its first page. */
export interface ManuscriptSettings {
  /** Shunn's standard manuscript format for prose, or the standard poetry manuscript. */
  layout: "shunn" | "poetry";
  font: "times" | "courier";
  name: string;
  address: string;
  phone: string;
  email: string;
}

export const DEFAULT_MANUSCRIPT: ManuscriptSettings = { layout: "shunn", font: "times", name: "", address: "", phone: "", email: "" };

export interface ExportSettings {
  font: BookFont;
  /** Each chapter in its own file, so it starts on a new page. */
  newPage: boolean;
  sceneBreak: SceneBreak;
  /** 1: chapters; 2: and their headings; 3: and sub-headings. */
  tocDepth: 1 | 2 | 3;
  /** Paragraphs set apart by an indent (as in print) or a blank line (as online). */
  paragraphs: "indent" | "space";
  /** Lines even on both sides, or ragged on the right. */
  align: "justify" | "left";
  /** Where chapter titles sit. */
  titles: "center" | "left";
  /** A large first letter at the start of each chapter. */
  dropCap: boolean;
  /** The first line of each chapter in small capitals. */
  smallCaps: boolean;
  /** How a chapter's heading reads: its title alone, or a number above it. */
  chapterHeading: "title" | "number" | "words" | "numeral";
  /** With chapters in several body sections: numbered from 1 again in each, or on through the book. */
  numbering: "restart" | "continuous";
  copyright: CopyrightDetails;
  /** Research sources, cited in the text. */
  sources: Source[];
  citationStyle: CitationStyle;
  manuscript: ManuscriptSettings;
  /** A matched set of headings, ornaments and fonts (bookStyles.ts), or null for the settings alone. */
  bookStyle: string | null;
  /** How the printed PDF is laid out. */
  print: PrintSettings;
}

export const DEFAULT_EXPORT: ExportSettings = {
  font: "none",
  newPage: true,
  sceneBreak: "asterisks",
  tocDepth: 1,
  paragraphs: "indent",
  align: "justify",
  titles: "center",
  dropCap: false,
  smallCaps: false,
  chapterHeading: "title",
  numbering: "restart",
  copyright: DEFAULT_COPYRIGHT,
  sources: [],
  citationStyle: "chicago-notes",
  manuscript: DEFAULT_MANUSCRIPT,
  bookStyle: null,
  print: DEFAULT_PRINT,
};

const text = (value: unknown, fallback: string, max = 2000) => (typeof value === "string" ? value.slice(0, max) : fallback);

const oneOf = <T,>(value: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(value as T) ? (value as T) : fallback);

export function readExport(json: string | null | undefined): ExportSettings {
  try {
    const saved = JSON.parse(json || "{}") as Partial<ExportSettings>;
    return {
      font: oneOf(saved.font, ["lora", "echolume", "none"] as const, DEFAULT_EXPORT.font),
      newPage: typeof saved.newPage === "boolean" ? saved.newPage : DEFAULT_EXPORT.newPage,
      sceneBreak: oneOf(saved.sceneBreak, ["asterisks", "ornament", "space", "line"] as const, DEFAULT_EXPORT.sceneBreak),
      tocDepth: oneOf(saved.tocDepth, [1, 2, 3] as const, DEFAULT_EXPORT.tocDepth),
      paragraphs: oneOf(saved.paragraphs, ["indent", "space"] as const, DEFAULT_EXPORT.paragraphs),
      align: oneOf(saved.align, ["justify", "left"] as const, DEFAULT_EXPORT.align),
      titles: oneOf(saved.titles, ["center", "left"] as const, DEFAULT_EXPORT.titles),
      dropCap: typeof saved.dropCap === "boolean" ? saved.dropCap : DEFAULT_EXPORT.dropCap,
      smallCaps: typeof saved.smallCaps === "boolean" ? saved.smallCaps : DEFAULT_EXPORT.smallCaps,
      chapterHeading: oneOf(saved.chapterHeading, ["title", "number", "words", "numeral"] as const, DEFAULT_EXPORT.chapterHeading),
      numbering: oneOf(saved.numbering, ["restart", "continuous"] as const, DEFAULT_EXPORT.numbering),
      copyright: (() => {
        const c = (saved.copyright && typeof saved.copyright === "object" ? saved.copyright : {}) as Partial<CopyrightDetails>;
        const d = DEFAULT_COPYRIGHT;
        return {
          year: text(c.year, d.year, 20),
          holder: text(c.holder, d.holder, 200),
          rights: text(c.rights, d.rights),
          notice: text(c.notice, d.notice),
          isbn: text(c.isbn, d.isbn, 40),
          edition: text(c.edition, d.edition, 200),
          publisher: text(c.publisher, d.publisher, 200),
        };
      })(),
      sources: readSources(saved.sources),
      citationStyle: readStyle(saved.citationStyle),
      manuscript: (() => {
        const m = (saved.manuscript && typeof saved.manuscript === "object" ? saved.manuscript : {}) as Partial<ManuscriptSettings>;
        const d = DEFAULT_MANUSCRIPT;
        return {
          layout: oneOf(m.layout, ["shunn", "poetry"] as const, d.layout),
          font: oneOf(m.font, ["times", "courier"] as const, d.font),
          name: text(m.name, d.name, 200),
          address: text(m.address, d.address, 600),
          phone: text(m.phone, d.phone, 60),
          email: text(m.email, d.email, 200),
        };
      })(),
      bookStyle: typeof saved.bookStyle === "string" && styleById(saved.bookStyle) ? saved.bookStyle : null,
      print: readPrint(saved.print),
    };
  } catch {
    return DEFAULT_EXPORT;
  }
}

export interface FontFile {
  /** File name inside the EPUB, e.g. "lora-400-normal.woff2". */
  name: string;
  bytes: Uint8Array;
  /** CSS weight: "400", or "100 900" for a variable font. */
  weight: string;
  style: "normal" | "italic";
}

export interface EmbeddedFont {
  family: string;
  files: FontFile[];
}

export interface Cover {
  bytes: Uint8Array;
  /** "image/jpeg", "image/png", … */
  mime: string;
}

export interface EpubInput {
  project: WritingProject;
  chapters: WritingChapter[];
  settings: ExportSettings;
  cover?: Cover | null;
  font?: EmbeddedFont | null;
  /** Writes the book's citations and its Sources page (see sources.ts), when it cites anything. */
  citer?: Citer | null;
  /** Fonts passages are set in (beyond the book's own), carried so they show as written. */
  passageFonts?: EmbeddedFont[];
  /** When it was made, for the required "modified" date. */
  now?: Date;
}

const XHTML_NS = "http://www.w3.org/1999/xhtml";

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "");
}

const KIND_LABEL = Object.fromEntries(Object.entries(KINDS).map(([kind, info]) => [kind, info.label.replace(/ \(.*\)$/, "")])) as Record<PageKind, string>;

/** What each kind of page is, in the words EPUB readers understand (EPUB 3 structural semantics). */
const SEMANTIC: Partial<Record<PageKind, string>> = {
  half_title: "halftitlepage",
  title_page: "titlepage",
  copyright: "copyright-page",
  dedication: "dedication",
  epigraph: "epigraph",
  contents: "toc",
  contents_manual: "toc",
  foreword: "foreword",
  preface: "preface",
  introduction: "introduction",
  prologue: "prologue",
  epilogue: "epilogue",
  afterword: "afterword",
  acknowledgments: "acknowledgments",
  endnotes: "endnotes",
  glossary: "glossary",
  appendix: "appendix",
  bibliography: "bibliography",
  sources: "bibliography",
};

/** The copyright page Scribe makes from the book's details. */
export function copyrightHtml(project: WritingProject, details: CopyrightDetails, now = new Date()): string {
  const year = details.year.trim() || String(now.getFullYear());
  const holder = details.holder.trim() || project.author?.trim() || "";
  const line = (text: string, cls = "") => (text.trim() ? `<p${cls ? ` class="${cls}"` : ""}>${escapeXml(text.trim())}</p>\n` : "");
  return [
    line(project.title, "copyright-title"),
    line(`Copyright © ${year}${holder ? ` ${holder}` : ""}`),
    line(details.rights.trim() ? details.rights : DEFAULT_RIGHTS),
    line(details.notice),
    line(details.isbn ? `ISBN ${details.isbn.replace(/^isbn[:\s]*/i, "")}` : ""),
    line(details.edition),
    line(details.publisher ? `Published by ${details.publisher}` : ""),
  ].join("");
}

const SCENE_MARK: Record<SceneBreak, string> = { asterisks: "* * *", ornament: "❦", space: " ", line: "" };

/** A heading found in a chapter, for the table of contents. */
export interface Heading {
  level: 2 | 3;
  text: string;
  id: string;
}

/** A picture placed in a chapter, taken out of the editor's HTML into its own file. */
export interface Picture {
  /** Its path inside the EPUB's OEBPS folder, e.g. "images/c1-1.jpg". */
  path: string;
  mime: string;
  bytes: Uint8Array;
}

const PICTURE_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp" };

/** A picture's bytes from the `data:` address the editor keeps it as, or null for anything else. */
export function pictureFrom(src: string): { mime: string; bytes: Uint8Array } | null {
  const found = /^data:(image\/(?:jpeg|png|gif|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(src);
  if (!found) return null;
  try {
    const raw = atob(found[2].replace(/\s+/g, ""));
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return { mime: found[1], bytes };
  } catch {
    return null;
  }
}

/**
 * The order sections go in the book: the book's own front matter, its
 * chapters outside any part, then each part (one work of an anthology) with
 * its own front matter, chapters and back matter, then the book's back matter.
 * Each group keeps its own order.
 */
export function bookOrder(chapters: WritingChapter[]): WritingChapter[] {
  const parts = chapters.filter((c) => c.role === "part");
  const partIds = new Set(parts.map((p) => p.id));
  const own = (c: WritingChapter) => c.role !== "part" && !(c.part && partIds.has(c.part));
  const of = (list: WritingChapter[], role: WritingChapter["role"]) => list.filter((c) => (c.role ?? "chapter") === role);
  const ownSections = chapters.filter(own);
  return [
    ...of(ownSections, "front"),
    ...of(ownSections, "chapter"),
    ...parts.flatMap((p) => {
      const inside = chapters.filter((c) => c.role !== "part" && c.part === p.id);
      return [p, ...of(inside, "front"), ...of(inside, "chapter"), ...of(inside, "back")];
    }),
    ...of(ownSections, "back"),
  ];
}

const INLINE: Record<string, string> = { strong: "strong", b: "strong", em: "em", i: "em", u: "u", s: "s", strike: "s", del: "s", code: "code", sub: "sub", sup: "sup", mark: "mark" };

/** The fonts a passage can be set in (see the editor's Font menu), and the ones TBV puts inside the book for them. */
const PASSAGE_FONTS: Record<string, Exclude<BookFont, "none"> | null> = {
  "lora, serif": "lora",
  "echolume, serif": "echolume",
  serif: null,
  "sans-serif": null,
  monospace: null,
};
const LENGTH = /^-?\d*\.?\d+(em|%)$/;
const NUMBER = /^\d*\.?\d+$/;

/** The parts of a passage's look that travel into the EPUB, each checked so nothing else slips into the book. */
const SPAN_STYLE: Record<string, (v: string) => boolean> = {
  "font-family": (v) => v.replace(/["']/g, "").toLowerCase() in PASSAGE_FONTS,
  "font-size": (v) => LENGTH.test(v),
  "text-transform": (v) => v === "uppercase",
  "font-variant": (v) => v === "small-caps",
  "letter-spacing": (v) => LENGTH.test(v),
  "word-spacing": (v) => LENGTH.test(v),
};
const BLOCK_STYLE: Record<string, (v: string) => boolean> = {
  "text-align": (v) => ["left", "center", "right", "justify"].includes(v),
  "line-height": (v) => NUMBER.test(v),
};

/** An element's style, kept to what's allowed, as an attribute ready to write (or ""). */
function keptStyle(el: Element, allowed: Record<string, (v: string) => boolean>): string {
  const style = (el as HTMLElement).style;
  if (!style) return "";
  const kept = Object.entries(allowed)
    .map(([prop, ok]) => [prop, style.getPropertyValue(prop).trim(), ok] as const)
    .filter(([, v, ok]) => v && ok(v))
    .map(([prop, v]) => `${prop}: ${prop === "font-family" ? v.replace(/["']/g, "") : v}`);
  return kept.length ? ` style="${escapeXml(kept.join("; "))}"` : "";
}

/** The fonts the book's passages are set in that TBV has to put inside it. */
export function passageFonts(chapters: WritingChapter[]): Exclude<BookFont, "none">[] {
  const found = new Set<Exclude<BookFont, "none">>();
  for (const c of chapters)
    for (const m of c.body.matchAll(/font-family:\s*([^;"]+?)\s*(?:;|")/gi)) {
      const font = PASSAGE_FONTS[m[1].replace(/&quot;|["']/g, "").toLowerCase()];
      if (font) found.add(font);
    }
  return [...found];
}
const BLOCK: Record<string, string> = { p: "p", blockquote: "blockquote", ul: "ul", ol: "ol", li: "li", pre: "pre" };

/** How wide one leading space of a poem's line is, in em. */
const SPACE_EM = 0.5;

/**
 * A poem's HTML set out line by line: each paragraph becomes a stanza, each
 * line (between line breaks) a line of its own, its leading spaces an exact
 * indent and runs of spaces inside it kept as non-breaking spaces, so no
 * e-reader can squash them. chapterXhtml then writes stanzas and lines.
 */
export function poemHtml(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const out = doc.createElement("div");
  for (const block of [...doc.body.childNodes]) {
    if (!(block instanceof HTMLElement) || block.tagName !== "P") {
      out.append(block);
      continue;
    }
    const groups: Node[][] = [[]];
    for (const node of [...block.childNodes]) {
      if (node instanceof HTMLElement && node.tagName === "BR") groups.push([]);
      else groups[groups.length - 1].push(node);
    }
    const stanza = doc.createElement("div");
    stanza.setAttribute("data-stanza", "");
    for (const group of groups) {
      const line = doc.createElement("p");
      line.setAttribute("data-line", "");
      line.append(...group);
      // The spaces a line starts with become its indent.
      const walker = doc.createTreeWalker(line, NodeFilter.SHOW_TEXT);
      let indent = 0;
      for (let text = walker.nextNode(); text; text = walker.nextNode()) {
        const value = text.textContent ?? "";
        const lead = /^[ \u00a0\t]*/.exec(value)![0];
        indent += [...lead].reduce((n, c) => n + (c === "\t" ? 4 : 1), 0);
        text.textContent = value.slice(lead.length);
        if (text.textContent) break;
      }
      if (indent) line.setAttribute("data-indent", String(indent * SPACE_EM));
      for (const text of textNodes(line)) text.textContent = (text.textContent ?? "").replace(/ {2,}|\u00a0+/g, (run) => "\u00a0".repeat(run.length));
      stanza.append(line);
    }
    // A blank line on its own only separates stanzas.
    if ((stanza.textContent ?? "").trim() || stanza.querySelector("img")) out.append(stanza);
  }
  return out.innerHTML;
}

function textNodes(root: Node): Text[] {
  const found: Text[] = [];
  const walker = root.ownerDocument!.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) found.push(n as Text);
  return found;
}

/**
 * The editor's HTML as XHTML for the EPUB, with only what readers handle:
 * paragraphs, headings (moved below the chapter title), emphasis, quotes,
 * lists, links and scene breaks. Anything else keeps its words but not its
 * tag. Headings get ids for the table of contents.
 */
export function chapterXhtml(
  html: string,
  sceneBreak: SceneBreak,
  idPrefix: string,
  cite?: (id: string, locator: string) => Cited,
): { body: string; headings: Heading[]; pictures: Picture[]; notes: string } {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const headings: Heading[] = [];
  const pictures: Picture[] = [];
  const notes: string[] = [];
  const out: string[] = [];
  const walk = (node: Node, inBlock: boolean) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? "";
      // Text straight in the body gets a paragraph of its own.
      if (!inBlock) {
        if (text.trim()) out.push(`<p>${escapeXml(text)}</p>`);
      } else out.push(escapeXml(text));
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    const children = (block: boolean) => el.childNodes.forEach((c) => walk(c, block));
    if (tag === "img") {
      // Only pictures kept inside the book travel; links to the web are left out.
      const picture = pictureFrom(el.getAttribute("src") ?? "");
      if (!picture) return;
      const path = `images/${idPrefix}-${pictures.length + 1}.${PICTURE_TYPES[picture.mime]}`;
      pictures.push({ path, ...picture });
      const img = `<img src="${path}" alt="${escapeXml(el.getAttribute("alt") ?? "")}"/>`;
      out.push(inBlock ? img : `<div class="picture">${img}</div>`);
    } else if (tag === "cite" && el.hasAttribute("data-source")) {
      // A citation, written in the book's style: words in the text, or a note at the chapter's end.
      const cited = cite?.(el.getAttribute("data-source") ?? "", el.getAttribute("data-locator") ?? "") ?? { text: escapeXml(el.textContent ?? "") };
      if (cited.note) {
        const n = notes.length + 1;
        const note = `${idPrefix}-fn${n}`;
        const ref = `${idPrefix}-ref${n}`;
        notes.push(`<aside epub:type="footnote" id="${note}" class="footnote"><p><a href="#${ref}">${n}.</a> ${inlineXhtml(cited.note)}</p></aside>`);
        const mark = `<sup><a epub:type="noteref" href="#${note}" id="${ref}">${n}</a></sup>`;
        out.push(inBlock ? mark : `<p>${mark}</p>`);
      } else if (cited.text) {
        const words = inlineXhtml(cited.text);
        out.push(inBlock ? words : `<p>${words}</p>`);
      }
    } else if (tag === "sup" && el.hasAttribute("data-footnote")) {
      // A footnote: a number here, the note at the end of the chapter, each linking to the other.
      const n = notes.length + 1;
      const note = `${idPrefix}-fn${n}`;
      const ref = `${idPrefix}-ref${n}`;
      const text = escapeXml(el.getAttribute("data-footnote") ?? "");
      notes.push(`<aside epub:type="footnote" id="${note}" class="footnote"><p><a href="#${ref}">${n}.</a> ${text}</p></aside>`);
      const mark = `<sup><a epub:type="noteref" href="#${note}" id="${ref}">${n}</a></sup>`;
      out.push(inBlock ? mark : `<p>${mark}</p>`);
    } else if (tag === "hr") {
      out.push(sceneBreak === "line" ? `<hr class="scene"/>` : `<p class="scene">${SCENE_MARK[sceneBreak]}</p>`);
    } else if (tag === "br") {
      out.push("<br/>");
    } else if (tag === "div" && el.hasAttribute("data-stanza")) {
      out.push(`<div class="stanza">`);
      children(false);
      out.push("</div>");
    } else if (tag === "p" && el.hasAttribute("data-line")) {
      const indent = Number(el.getAttribute("data-indent") ?? 0);
      out.push(`<p class="line"${indent > 0 && indent < 40 ? ` style="margin-left: ${indent}em"` : ""}>`);
      children(true);
      out.push(el.textContent ? "</p>" : "\u00a0</p>");
    } else if (tag === "div" && el.hasAttribute("data-page-break")) {
      out.push(`<div class="pagebreak"></div>`);
    } else if (/^h[1-6]$/.test(tag)) {
      const level = tag === "h1" || tag === "h2" ? 2 : 3;
      const id = `${idPrefix}-h${headings.length + 1}`;
      headings.push({ level, text: (el.textContent ?? "").trim().replace(/\s+/g, " "), id });
      out.push(`<h${level} id="${id}"${keptStyle(el, BLOCK_STYLE)}>`);
      children(true);
      out.push(`</h${level}>`);
    } else if (tag === "a") {
      const href = el.getAttribute("href") ?? "";
      if (/^(https?:|mailto:)/i.test(href)) {
        out.push(`<a href="${escapeXml(href)}">`);
        children(true);
        out.push("</a>");
      } else children(inBlock);
    } else if (tag === "span" && keptStyle(el, SPAN_STYLE)) {
      if (!inBlock) out.push("<p>");
      out.push(`<span${keptStyle(el, SPAN_STYLE)}>`);
      children(true);
      out.push("</span>");
      if (!inBlock) out.push("</p>");
    } else if (INLINE[tag]) {
      const t = INLINE[tag];
      if (!inBlock) out.push("<p>");
      out.push(`<${t}>`);
      children(true);
      out.push(`</${t}>`);
      if (!inBlock) out.push("</p>");
    } else if (BLOCK[tag]) {
      const t = BLOCK[tag];
      const empty = t === "p" && !(el.textContent ?? "").trim() && !el.querySelector("br,img");
      if (empty) {
        out.push(`<p class="blank"> </p>`);
        return;
      }
      out.push(`<${t}${t === "p" ? keptStyle(el, BLOCK_STYLE) : ""}>`);
      // Lists and quotes hold blocks; the rest hold text.
      children(t === "p" || t === "li" || t === "pre");
      out.push(`</${t}>`);
    } else {
      children(inBlock);
    }
  };
  doc.body.childNodes.forEach((c) => walk(c, false));
  return { body: out.join(""), headings, pictures, notes: notes.length ? `<section class="footnotes" epub:type="footnotes">${notes.join("")}</section>` : "" };
}

/** A line of HTML (a citation, an entry in the Sources list) as XHTML, keeping only what readers handle. */
export function inlineXhtml(html: string): string {
  return chapterXhtml(`<p>${html}</p>`, "asterisks", "x").body.replace(/^<p>|<\/p>$/g, "");
}

function page(title: string, lang: string, body: string, bodyClass = ""): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="${XHTML_NS}" xmlns:epub="http://www.idpf.org/2007/ops" lang="${escapeXml(lang)}" xml:lang="${escapeXml(lang)}">
<head>
<meta charset="UTF-8"/>
<title>${escapeXml(title)}</title>
<link rel="stylesheet" type="text/css" href="styles.css"/>
</head>
<body${bodyClass ? ` class="${bodyClass}"` : ""}>
${body}
</body>
</html>
`;
}

/** Every font the book carries, the book's own first, each once. */
function carried(font: EmbeddedFont | null | undefined, passage: EmbeddedFont[] = []): EmbeddedFont[] {
  const all = [...(font ? [font] : []), ...passage];
  return all.filter((f, i) => all.findIndex((g) => g.family === f.family) === i);
}

function stylesheet(settings: ExportSettings, font: EmbeddedFont | null | undefined, passage: EmbeddedFont[] = []): string {
  const faces = carried(font, passage)
    .flatMap((each) =>
      each.files.map((f) => `@font-face {\n  font-family: "${each.family}";\n  src: url("fonts/${f.name}");\n  font-weight: ${f.weight};\n  font-style: ${f.style};\n}\n`),
    )
    .join("");
  const family = font ? `  font-family: "${font.family}", serif;\n` : "";
  return `${faces}body {
${family}  margin: 0 5%;
  line-height: 1.5;
}
h1 { font-size: 1.6em; text-align: ${settings.titles}; margin: 2em 0 1.5em; font-weight: normal; }
h2 { font-size: 1.25em; margin: 1.5em 0 0.75em; }
h3 { font-size: 1.1em; margin: 1.25em 0 0.5em; }
${
  settings.paragraphs === "indent"
    ? `p { margin: 0; text-indent: 1.5em; text-align: ${settings.align}; }`
    : `p { margin: 0 0 0.9em; text-indent: 0; text-align: ${settings.align}; }`
}
p[style*="text-align: center"], p[style*="text-align: right"] { text-indent: 0; }
h1 + p, h2 + p, h3 + p, .scene + p, hr + p, blockquote + p, .blank + p, .picture + p, p:first-child { text-indent: 0; }
${settings.dropCap ? "section.chapter > h1 + p::first-letter { float: left; font-size: 3.2em; line-height: 0.85; margin: 0.05em 0.08em 0 0; }\n" : ""}${
  settings.smallCaps ? "section.chapter > h1 + p::first-line { font-variant: small-caps; letter-spacing: 0.03em; }\n" : ""
}.chapter-label { text-align: ${settings.titles}; text-indent: 0; margin: 2em 0 -1.2em; font-size: 0.85em; letter-spacing: 0.12em; text-transform: uppercase; }
.picture { text-align: center; text-indent: 0; margin: 1em 0; }
.picture img, p img { max-width: 100%; }
sup a { text-decoration: none; }
.footnotes { margin-top: 2em; border-top: 1px solid currentColor; padding-top: 0.5em; font-size: 0.85em; }
.footnote p { text-indent: 0; text-align: left; margin: 0 0 0.4em; }
.blank { text-indent: 0; }
blockquote { margin: 1em 2em; font-style: italic; }
blockquote p { text-indent: 0; }
.scene { text-align: center; text-indent: 0; margin: 1em 0; }
hr.scene { border: none; border-top: 1px solid currentColor; width: 25%; margin: 1.5em auto; }
ul, ol { margin: 1em 0 1em 1.5em; }
pre { white-space: pre-wrap; font-family: monospace; }
section.chapter, section.frontmatter, section.backmatter, section.part { page-break-before: always; break-before: page; }
section.follows { page-break-before: auto; break-before: auto; margin-top: 3em; }
section.page-half-title .title { font-size: 1.6em; margin: 35% 0 0; text-align: center; text-indent: 0; }
section.page-copyright { padding-top: 30%; }
section.page-copyright p { text-indent: 0; text-align: left; font-size: 0.85em; margin: 0 0 0.8em; }
section.page-copyright .copyright-title { font-style: italic; }
section.page-dedication, section.page-epigraph { text-align: center; padding-top: 25%; }
section.page-dedication p, section.page-epigraph p { text-align: center; text-indent: 0; }
section.page-dedication p { font-style: italic; }
ol.contents, ol.contents ol { list-style: none; padding: 0; margin: 0.5em 0; }
ol.contents ol { padding-left: 1.5em; }
ol.contents li { margin: 0.4em 0; }
ol.contents a { text-decoration: none; }
.titlepage { text-align: center; }
.titlepage .title { font-size: 2em; margin: 30% 0 0.5em; text-indent: 0; text-align: center; }
.titlepage .author { font-size: 1.2em; text-indent: 0; text-align: center; }
.titlepage .series { font-style: italic; margin-top: 1em; text-indent: 0; text-align: center; }
.pagebreak { height: 0; margin: 0; page-break-after: always; break-after: page; -webkit-column-break-after: always; }
section.part { text-align: center; }
section.part > h1 { margin-top: 30%; font-size: 1.8em; }
section.part p { text-align: center; text-indent: 0; }
section.page-sources p.source { text-indent: -2em; padding-left: 2em; text-align: left; margin: 0 0 0.7em; }
.stanza { margin: 0 0 1.2em; page-break-inside: avoid; break-inside: avoid; }
.stanza p.line { margin: 0; padding-left: 2em; text-indent: -2em; text-align: left; }
.poem-centred .stanza p.line { padding-left: 0; text-indent: 0; text-align: center; }
section.page-haiku { padding-top: 20%; }
.cover { margin: 0; padding: 0; text-align: center; }
.cover img { max-width: 100%; max-height: 100%; }
${styleCss(settings)}`;
}

/** A file name for the book: its title, safe on every computer. */
export function epubFileName(title: string): string {
  const name = title.replace(/[\\/:*?"<>|\u0000-\u001F]/g, " ").replace(/\s+/g, " ").trim().replace(/^\.+|\.+$/g, "").slice(0, 80);
  return `${name || "Book"}.epub`;
}

const IMAGE_EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp" };

export interface Built {
  /** Each file's path inside the EPUB and its text or bytes, in zip order. */
  files: [string, string | Uint8Array][];
}

/** Every file of the EPUB, before zipping (tests read these). */
export function epubFiles({ project, chapters: own, settings, cover, font, passageFonts: passage = [], citer, now = new Date() }: EpubInput): Built {
  citer?.restart();
  // A book that cites sources gets a Sources page at the back, unless it has one already.
  const chapters =
    citer && !own.some((c) => readPage(c.page, c.role).kind === "sources")
      ? [...own, { ...own[0], id: "sources", title: "", body: "", role: "back" as const, part: null, page: writePage({ ...readPage("{}"), kind: "sources", inContents: true, showTitle: true }), words: 0 }]
      : own;
  const fontFiles = carried(font, passage).flatMap((f) => f.files);
  const lang = project.language?.trim() || "en";
  const title = project.title.trim() || "Untitled";
  const modified = now.toISOString().replace(/\.\d{3}Z$/, "Z");
  const id = `urn:uuid:${/^[0-9a-f-]{36}$/i.test(project.id) ? project.id : crypto.randomUUID()}`;
  const coverExt = cover ? IMAGE_EXT[cover.mime] : undefined;
  const useCover = !!cover && !!coverExt && cover.bytes.length > 0;
  // What opens the book: by default the cover picture, then a title page.
  // Without a cover picture, the title page stays unless asked for neither.
  const showCover = useCover && project.coverPage !== "title" && project.coverPage !== "none";
  // A title page among the book's own pages takes the place of the one made here.
  const showTitle =
    project.coverPage !== "none" && (project.coverPage !== "cover" || !useCover) && !chapters.some((c) => readPage(c.page, c.role).kind === "title_page");

  const ordered = bookOrder(chapters);
  const pageOf = ordered.map((c) => readPage(c.page, c.role ?? "chapter"));
  const author = project.author?.trim();
  const series = project.series?.trim();
  const titleBlock = `<p class="title">${escapeXml(title)}</p>\n${author ? `<p class="author">${escapeXml(author)}</p>\n` : ""}${
    series ? `<p class="series">${escapeXml(series)}${project.seriesIndex != null ? `, book ${project.seriesIndex}` : ""}</p>\n` : ""
  }`;

  // Chapters are numbered from 1 again in each body section (part), unless they run on through the book.
  let chapterCount = 0;
  let partCount = 0;
  let inPart: string | null = null;
  let file = "";
  const parts = ordered.map((c, i) => {
    const n = i + 1;
    const role = c.role ?? "chapter";
    const settingsOf: PageSettings = pageOf[i];
    if (role === "part") {
      inPart = c.id;
      if (settings.numbering === "restart") chapterCount = 0;
      partCount++;
    } else if (!c.part && inPart) inPart = null;
    const made = isMade(settingsOf);
    const poem = isPoem(settingsOf);
    const { body, headings, pictures, notes } = made
      ? { body: "", headings: [] as Heading[], pictures: [] as Picture[], notes: "" }
      : chapterXhtml(poem ? poemHtml(c.body) : c.body, settings.sceneBreak, `c${n}`, citer ? (id, locator) => citer.cite(id, locator) : undefined);
    const numbered = role === "chapter" && settingsOf.kind === "chapter";
    const number = numbered ? ++chapterCount : 0;
    const named = c.title.trim();
    const style = settings.chapterHeading;
    const numberLabel = !numbered ? "" : style === "words" ? `Chapter ${numberInWords(number)}` : style === "numeral" ? String(number) : `Chapter ${number}`;
    // Untitled pages are named by what they are.
    const heading =
      named ||
      (poem ? firstLine(c.body) : "") ||
      (settingsOf.kind === "sources" ? (citer?.heading ?? "Sources") : "") ||
      (numbered ? numberLabel : role === "part" ? `Part ${partCount}` : settingsOf.kind === "custom" ? (role === "front" ? "Front matter" : role === "back" ? "Back matter" : "Untitled") : KIND_LABEL[settingsOf.kind]);
    const label = numbered && named && style !== "title" ? numberLabel : "";
    // A section starts a file of its own when it starts on a new page.
    // Every poem starts on a fresh page unless asked otherwise, so none begins mid-screen.
    const newPage = i === 0 || (settingsOf.newPage ?? (poem || settings.newPage));
    if (newPage) file = settings.newPage ? `chapter-${n}.xhtml` : i === 0 ? "text.xhtml" : `text-${n}.xhtml`;
    return {
      n,
      heading,
      label,
      body,
      notes,
      headings,
      pictures,
      role,
      kind: settingsOf.kind,
      centred: poem && settingsOf.centred,
      made,
      // An untitled poem is listed by its first line but not headed by it, so the line isn't printed twice.
      showTitle: role === "part" || (settingsOf.showTitle && !(poem && !named)),
      inContents: settingsOf.inContents,
      first: newPage,
      file,
      part: role === "part" ? null : c.part && ordered.some((p) => p.id === c.part) ? c.part : null,
      id: c.id,
    };
  });

  // The table of contents: chapters, and their headings as deep as asked.
  type Point = { label: string; href: string; children: Point[] };
  const flat: (Point & { part: string | null; id: string; role: string })[] = parts
    .filter((p) => p.inContents)
    .map((p) => {
      const href = settings.newPage && p.first ? p.file : `${p.file}#c${p.n}`;
      const children: Point[] = [];
      if (settings.tocDepth >= 2) {
        for (const h of p.headings) {
          if (!h.text) continue;
          const point = { label: h.text, href: `${p.file}#${h.id}`, children: [] as Point[] };
          if (h.level === 2) children.push(point);
          else if (settings.tocDepth < 3) continue;
          // A sub-heading goes under the heading before it, if there is one.
          else if (children.length) children[children.length - 1].children.push(point);
          else children.push(point);
        }
      }
      return { label: p.label ? `${p.label}: ${p.heading}` : p.heading, href, children, part: p.part, id: p.id, role: p.role };
    });
  // A part's sections are listed under it, so the contents nest by work.
  const points: Point[] = [];
  for (const p of flat) {
    const host = p.part ? flat.find((h) => h.id === p.part) : undefined;
    if (host) host.children.push(p);
    else points.push(p);
  }
  const navList = (list: Point[], cls = ""): string =>
    `<ol${cls ? ` class="${cls}"` : ""}>\n${list.map((p) => `<li><a href="${p.href}">${escapeXml(p.label)}</a>${p.children.length ? navList(p.children) : ""}</li>`).join("\n")}\n</ol>`;

  // Each section's page, with the pages Scribe makes filled in.
  const madeBody = (kind: string): string =>
    kind === "half_title"
      ? `<p class="title">${escapeXml(title)}</p>`
      : kind === "title_page"
        ? titleBlock
        : kind === "copyright"
          ? copyrightHtml(project, settings.copyright, now)
          : kind === "contents"
            ? navList(points, "contents")
            : kind === "sources"
              ? (citer?.bibliography() ?? []).map((entry) => `<p class="source">${inlineXhtml(entry.replace(/^<div[^>]*>|<\/div>$/g, ""))}</p>`).join("\n") ||
                `<p class="source">Sources you cite will be listed here.</p>`
              : "";
  const sectionHtml = (p: (typeof parts)[number]) => {
    const type = { chapter: "chapter", front: "frontmatter", back: "backmatter", part: "part" }[p.role];
    const semantic = SEMANTIC[p.kind] ?? type;
    const classes = [type, p.kind === "chapter" || p.kind === "custom" ? "" : `page-${p.kind.replace(/_/g, "-")}`, p.first ? "" : "follows", p.kind === "title_page" ? "titlepage" : "", p.centred ? "poem-centred" : ""].filter(Boolean).join(" ");
    const top = `${p.label ? `<p class="chapter-label">${escapeXml(p.label)}</p>\n` : ""}${p.showTitle ? `<h1>${escapeXml(p.heading)}</h1>\n` : ""}`;
    return `<section class="${classes}" epub:type="${semantic}" id="c${p.n}">\n${top}${p.made ? madeBody(p.kind) : p.body}\n${p.notes}</section>`;
  };
  const fileNames = [...new Set(parts.map((p) => p.file))];
  const content: [string, string][] = fileNames.map((name) => {
    const inFile = parts.filter((p) => p.file === name);
    return [name, page(inFile.length === 1 || settings.newPage ? inFile[0].heading : title, lang, inFile.map(sectionHtml).join("\n"))];
  });
  const firstChapter = parts.find((p) => p.role === "chapter" || p.role === "part") ?? parts[0];
  const firstText = firstChapter ? (settings.newPage && firstChapter.first ? firstChapter.file : `${firstChapter.file}#c${firstChapter.n}`) : "text.xhtml";
  const nav = page(
    "Contents",
    lang,
    `<nav epub:type="toc" id="toc">\n<h1>Contents</h1>\n${navList(points)}\n</nav>\n<nav epub:type="landmarks" hidden="hidden">\n<ol>\n${
      showCover ? `<li><a epub:type="cover" href="cover.xhtml">Cover</a></li>\n` : ""
    }<li><a epub:type="bodymatter" href="${firstText}">Start</a></li>\n</ol>\n</nav>`,
  );
  let order = 0;
  const navPoints = (list: Point[]): string =>
    list
      .map((p) => {
        order++;
        return `<navPoint id="np${order}" playOrder="${order}"><navLabel><text>${escapeXml(p.label)}</text></navLabel><content src="${p.href}"/>${navPoints(p.children)}</navPoint>`;
      })
      .join("\n");
  const deepest = (list: Point[]): number => (list.length ? 1 + Math.max(...list.map((p) => deepest(p.children))) : 0);
  const depth = Math.max(1, deepest(points));
  const ncx = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1" xml:lang="${escapeXml(lang)}">
<head>
<meta name="dtb:uid" content="${escapeXml(id)}"/>
<meta name="dtb:depth" content="${depth}"/>
<meta name="dtb:totalPageCount" content="0"/>
<meta name="dtb:maxPageNumber" content="0"/>
</head>
<docTitle><text>${escapeXml(title)}</text></docTitle>
<navMap>
${navPoints(points)}
</navMap>
</ncx>
`;

  const titlePage = page(title, lang, `<section class="titlepage" epub:type="titlepage">\n${titleBlock}</section>`, "titlepage");
  const coverPage = showCover
    ? page("Cover", lang, `<section class="cover" epub:type="cover"><img src="images/cover.${coverExt}" alt="${escapeXml(title)}"/></section>`, "cover")
    : null;

  const pictures = parts.flatMap((p) => p.pictures);
  const fontItems = fontFiles.map((f, i) => `<item id="font${i + 1}" href="fonts/${f.name}" media-type="font/woff2"/>`);
  const manifest = [
    `<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`,
    `<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`,
    `<item id="css" href="styles.css" media-type="text/css"/>`,
    ...(useCover
      ? [
          `<item id="cover-image" href="images/cover.${coverExt}" media-type="${cover!.mime}" properties="cover-image"/>`,
          ...(showCover ? [`<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>`] : []),
        ]
      : []),
    ...(showTitle ? [`<item id="titlepage" href="titlepage.xhtml" media-type="application/xhtml+xml"/>`] : []),
    ...content.map(([name], i) => `<item id="text${i + 1}" href="${name}" media-type="application/xhtml+xml"/>`),
    ...pictures.map((p, i) => `<item id="picture${i + 1}" href="${p.path}" media-type="${p.mime}"/>`),
    ...fontItems,
  ];
  const spine = [
    ...(showCover ? [`<itemref idref="cover"/>`] : []),
    ...(showTitle ? [`<itemref idref="titlepage"/>`] : []),
    ...content.map((_, i) => `<itemref idref="text${i + 1}"/>`),
  ];
  const description = project.description?.trim();
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="${escapeXml(lang)}">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="bookid">${escapeXml(id)}</dc:identifier>
<dc:title>${escapeXml(title)}</dc:title>
<dc:language>${escapeXml(lang)}</dc:language>
${author ? `<dc:creator id="author">${escapeXml(author)}</dc:creator>\n<meta refines="#author" property="role" scheme="marc:relators">aut</meta>\n` : ""}${
    description ? `<dc:description>${escapeXml(description)}</dc:description>\n` : ""
  }${
    series
      ? `<meta property="belongs-to-collection" id="series">${escapeXml(series)}</meta>\n<meta refines="#series" property="collection-type">series</meta>\n${
          project.seriesIndex != null ? `<meta refines="#series" property="group-position">${project.seriesIndex}</meta>\n` : ""
        }<meta name="calibre:series" content="${escapeXml(series)}"/>\n${project.seriesIndex != null ? `<meta name="calibre:series_index" content="${project.seriesIndex}"/>\n` : ""}`
      : ""
  }${useCover ? `<meta name="cover" content="cover-image"/>\n` : ""}<meta property="dcterms:modified">${modified}</meta>
</metadata>
<manifest>
${manifest.join("\n")}
</manifest>
<spine toc="ncx">
${spine.join("\n")}
</spine>
</package>
`;
  const container = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles>
<rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
</rootfiles>
</container>
`;
  const files: [string, string | Uint8Array][] = [
    ["mimetype", "application/epub+zip"],
    ["META-INF/container.xml", container],
    ["OEBPS/content.opf", opf],
    ["OEBPS/nav.xhtml", nav],
    ["OEBPS/toc.ncx", ncx],
    ["OEBPS/styles.css", stylesheet(settings, font, passage)],
    ...(coverPage ? ([["OEBPS/cover.xhtml", coverPage]] as [string, string][]) : []),
    ...(useCover ? ([[`OEBPS/images/cover.${coverExt}`, cover!.bytes]] as [string, Uint8Array][]) : []),
    ...(showTitle ? ([["OEBPS/titlepage.xhtml", titlePage]] as [string, string][]) : []),
    ...content.map(([name, text]) => [`OEBPS/${name}`, text] as [string, string]),
    ...pictures.map((p) => [`OEBPS/${p.path}`, p.bytes] as [string, Uint8Array]),
    ...fontFiles.map((f) => [`OEBPS/fonts/${f.name}`, f.bytes] as [string, Uint8Array]),
  ];
  return { files };
}

/** Problems that stop an export, in words for the person. */
export function exportProblems(chapters: WritingChapter[]): string[] {
  const problems: string[] = [];
  const sections = chapters.filter((c) => c.role !== "part");
  if (!sections.length) problems.push("Add a chapter first.");
  else if (sections.every((c) => !c.body.replace(/<[^>]*>/g, "").trim() && !/<img\b/i.test(c.body))) problems.push("Write something in a chapter first.");
  return problems;
}

/** The EPUB itself. `mimetype` goes first and uncompressed, as readers expect. */
export function buildEpub(input: EpubInput): Uint8Array {
  const entries: Record<string, [Uint8Array, { level: 0 | 6 }]> = {};
  for (const [name, data] of epubFiles(input).files) {
    const bytes = typeof data === "string" ? strToU8(data) : data;
    entries[name] = [bytes, { level: name === "mimetype" || /\.(jpg|png|gif|webp|woff2)$/.test(name) ? 0 : 6 }];
  }
  return zipSync(entries);
}

const base64 = (bytes: Uint8Array) => {
  let raw = "";
  for (let i = 0; i < bytes.length; i += 0x8000) raw += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(raw);
};

/** One of the EPUB's pages in reading order: its body's class and its inner XHTML (pictures still at images/…). */
export interface Sheet {
  cls: string;
  html: string;
}

/**
 * The book's pages in reading order, as the EPUB has them, with every file
 * by its path inside OEBPS (pictures, fonts, the stylesheet). The preview,
 * TXT, DOCX and PDF are all made from these, so each comes out the same.
 */
export function bookSheets(input: EpubInput): { sheets: Sheet[]; files: Map<string, string | Uint8Array> } {
  const all = new Map(epubFiles(input).files);
  const opf = String(all.get("OEBPS/content.opf") ?? "");
  const hrefs = new Map([...opf.matchAll(/<item id="([^"]+)" href="([^"]+)"/g)].map((m) => [m[1], m[2]]));
  const spine = [...opf.matchAll(/<itemref idref="([^"]+)"\/>/g)].map((m) => hrefs.get(m[1])).filter((h): h is string => !!h);
  const files = new Map([...all].filter(([k]) => k.startsWith("OEBPS/")).map(([k, v]) => [k.slice(6), v]));
  const sheets = spine.map((href) => {
    const page = String(files.get(href) ?? "");
    const body = /<body([^>]*)>([\s\S]*)<\/body>/.exec(page);
    return { cls: /class="([^"]*)"/.exec(body?.[1] ?? "")?.[1] ?? "", html: body?.[2] ?? "" };
  });
  return { sheets, files };
}

/** A picture inside the book as a data: address, for pages shown outside it. */
export function pictureUrl(files: Map<string, string | Uint8Array>, path: string): string {
  const bytes = files.get(path);
  if (!(bytes instanceof Uint8Array)) return path;
  const mime = Object.entries(PICTURE_TYPES).find(([, ext]) => path.endsWith(`.${ext}`))?.[0] ?? (path.endsWith(".jpg") ? "image/jpeg" : "image/png");
  return `data:${mime};base64,${base64(bytes)}`;
}

/** The book's stylesheet with its fonts inside it, for pages shown outside the EPUB. */
export function inlineStyles(files: Map<string, string | Uint8Array>): string {
  let css = String(files.get("styles.css") ?? "");
  for (const [path, bytes] of files) {
    if (path.startsWith("fonts/") && bytes instanceof Uint8Array) css = css.replace(`url("${path}")`, `url("data:font/woff2;base64,${base64(bytes)}")`);
  }
  return css;
}

/** A sheet's XHTML with its pictures inside it and links between pages kept within one page. */
export function sheetHtml(files: Map<string, string | Uint8Array>, sheet: Sheet): string {
  return (
    sheet.html
      .replace(/src="(images\/[^"]+)"/g, (_, path: string) => `src="${pictureUrl(files, path)}"`)
      // Links between the book's own pages jump within the one page.
      .replace(/href="[^"#:]+\.xhtml#([^"]+)"/g, 'href="#$1"')
  );
}

/**
 * The whole book as one page, exactly as the EPUB has it (cover, title page,
 * every section in order, with its pictures), for the preview beside the
 * editor. Each of the EPUB's pages is shown as a sheet of its own.
 */
export function previewHtml(input: EpubInput): string {
  const { sheets: pages, files } = bookSheets(input);
  const sheets = pages.map((sheet) => `<article class="sheet ${sheet.cls}">${sheetHtml(files, sheet)}</article>`);
  const css = inlineStyles(files);
  return `<!DOCTYPE html>
<html lang="${escapeXml(input.project.language?.trim() || "en")}">
<head>
<meta charset="UTF-8"/>
<style>
${css}
html { background: #d9d6d0; }
body { margin: 0; padding: 16px 0 48px; }
.sheet { background: #fffdf9; color: #1a1c1e; max-width: 34em; min-height: 46em; margin: 0 auto 16px; padding: 3em 2.5em; box-shadow: 0 1px 3px rgb(0 0 0 / 0.18); box-sizing: border-box; }
.sheet section.chapter, .sheet section.frontmatter, .sheet section.backmatter, .sheet section.part { break-before: auto; page-break-before: auto; }
.sheet.cover { padding: 0; min-height: 0; }
.pagebreak { border-top: 1px dashed #bbb; margin: 1.5em 0; }
a { color: inherit; }
</style>
</head>
<body>
${sheets.join("\n")}
</body>
</html>`;
}

/** One section's page as the EPUB has it, without its heading: what Scribe makes for a ready-made page. */
export function madeSectionHtml(input: EpubInput, chapterId: string): string {
  const n = bookOrder(input.chapters).findIndex((c) => c.id === chapterId) + 1;
  if (!n) return "";
  for (const [, data] of epubFiles(input).files) {
    if (typeof data !== "string") continue;
    const found = new RegExp(`<section [^>]*id="c${n}">\\n([\\s\\S]*?)\\n</section>`).exec(data);
    if (found) return found[1].replace(/^(<p class="chapter-label">.*<\/p>\n)?(<h1>.*<\/h1>\n)?/, "").trim();
  }
  return "";
}

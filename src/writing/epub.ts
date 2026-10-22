// Turns a book written on the Writing page into an EPUB 3 file: chapters as
// XHTML, a table of contents built from chapter titles and headings, the
// book's details, an optional cover and an optional embedded font. A
// navigation file for older readers (toc.ncx) goes in too, since Kindle's
// converter still looks for it. Pure apart from the zip, so it's tested
// without the app.

import { zipSync, strToU8 } from "fflate";
import type { WritingChapter, WritingProject } from "../api/types";

export type SceneBreak = "asterisks" | "ornament" | "space" | "line";
export type BookFont = "lora" | "echolume" | "none";

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
};

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

const INLINE: Record<string, string> = { strong: "strong", b: "strong", em: "em", i: "em", u: "u", s: "s", strike: "s", del: "s", code: "code", sub: "sub", sup: "sup" };
const BLOCK: Record<string, string> = { p: "p", blockquote: "blockquote", ul: "ul", ol: "ol", li: "li", pre: "pre" };

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
    } else if (/^h[1-6]$/.test(tag)) {
      const level = tag === "h1" || tag === "h2" ? 2 : 3;
      const id = `${idPrefix}-h${headings.length + 1}`;
      headings.push({ level, text: (el.textContent ?? "").trim().replace(/\s+/g, " "), id });
      out.push(`<h${level} id="${id}">`);
      children(true);
      out.push(`</h${level}>`);
    } else if (tag === "a") {
      const href = el.getAttribute("href") ?? "";
      if (/^(https?:|mailto:)/i.test(href)) {
        out.push(`<a href="${escapeXml(href)}">`);
        children(true);
        out.push("</a>");
      } else children(inBlock);
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
      out.push(`<${t}>`);
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

function stylesheet(settings: ExportSettings, font: EmbeddedFont | null | undefined): string {
  const faces = (font?.files ?? [])
    .map((f) => `@font-face {\n  font-family: "${font!.family}";\n  src: url("fonts/${f.name}");\n  font-weight: ${f.weight};\n  font-style: ${f.style};\n}\n`)
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
h1 + p, h2 + p, h3 + p, .scene + p, hr + p, blockquote + p, .blank + p, .picture + p, p:first-child { text-indent: 0; }
${settings.dropCap ? "section.chapter > h1 + p::first-letter { float: left; font-size: 3.2em; line-height: 0.85; margin: 0.05em 0.08em 0 0; }\n" : ""}.picture { text-align: center; text-indent: 0; margin: 1em 0; }
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
section.chapter, section.frontmatter, section.backmatter { ${settings.newPage ? "page-break-before: always; break-before: page;" : "margin-top: 3em;"} }
.titlepage { text-align: center; }
.titlepage .title { font-size: 2em; margin: 30% 0 0.5em; text-indent: 0; text-align: center; }
.titlepage .author { font-size: 1.2em; text-indent: 0; text-align: center; }
.titlepage .series { font-style: italic; margin-top: 1em; text-indent: 0; text-align: center; }
.cover { margin: 0; padding: 0; text-align: center; }
.cover img { max-width: 100%; max-height: 100%; }
`;
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
export function epubFiles({ project, chapters, settings, cover, font, now = new Date() }: EpubInput): Built {
  const lang = project.language?.trim() || "en";
  const title = project.title.trim() || "Untitled";
  const modified = now.toISOString().replace(/\.\d{3}Z$/, "Z");
  const id = `urn:uuid:${/^[0-9a-f-]{36}$/i.test(project.id) ? project.id : crypto.randomUUID()}`;
  const coverExt = cover ? IMAGE_EXT[cover.mime] : undefined;
  const useCover = !!cover && !!coverExt && cover.bytes.length > 0;

  // Front matter first, then the chapters, then back matter, each in its own order.
  const ordered = [...chapters.filter((c) => c.role === "front"), ...chapters.filter((c) => (c.role ?? "chapter") === "chapter"), ...chapters.filter((c) => c.role === "back")];
  let chapterCount = 0;
  const parts = ordered.map((c, i) => {
    const n = i + 1;
    const role = c.role ?? "chapter";
    const { body, headings, pictures, notes } = chapterXhtml(c.body, settings.sceneBreak, `c${n}`);
    // Only chapters are numbered; untitled front or back matter is named by what it is.
    const heading = c.title.trim() || (role === "chapter" ? `Chapter ${++chapterCount}` : role === "front" ? "Front matter" : "Back matter");
    if (role === "chapter" && c.title.trim()) chapterCount++;
    const type = role === "chapter" ? "chapter" : role === "front" ? "frontmatter" : "backmatter";
    const section = `<section class="${type}" epub:type="${type}" id="c${n}">\n<h1>${escapeXml(heading)}</h1>\n${body}\n${notes}</section>`;
    return { n, heading, section, headings, pictures, role };
  });
  const chapterFile = (n: number) => (settings.newPage ? `chapter-${n}.xhtml` : "text.xhtml");
  const content: [string, string][] = settings.newPage
    ? parts.map((p) => [chapterFile(p.n), page(p.heading, lang, p.section)])
    : [["text.xhtml", page(title, lang, parts.map((p) => p.section).join("\n"))]];

  // The table of contents: chapters, and their headings as deep as asked.
  type Point = { label: string; href: string; children: Point[] };
  const points: Point[] = parts.map((p) => {
    const href = settings.newPage ? chapterFile(p.n) : `text.xhtml#c${p.n}`;
    const children: Point[] = [];
    if (settings.tocDepth >= 2) {
      for (const h of p.headings) {
        if (!h.text) continue;
        const point = { label: h.text, href: `${chapterFile(p.n)}#${h.id}`, children: [] as Point[] };
        if (h.level === 2) children.push(point);
        else if (settings.tocDepth < 3) continue;
        // A sub-heading goes under the heading before it, if there is one.
        else if (children.length) children[children.length - 1].children.push(point);
        else children.push(point);
      }
    }
    return { label: p.heading, href, children };
  });
  const navList = (list: Point[]): string =>
    `<ol>\n${list.map((p) => `<li><a href="${p.href}">${escapeXml(p.label)}</a>${p.children.length ? navList(p.children) : ""}</li>`).join("\n")}\n</ol>`;
  const firstChapter = parts.find((p) => p.role === "chapter") ?? parts[0];
  const firstText = settings.newPage ? chapterFile(firstChapter?.n ?? 1) : `text.xhtml${firstChapter ? `#c${firstChapter.n}` : ""}`;
  const nav = page(
    "Contents",
    lang,
    `<nav epub:type="toc" id="toc">\n<h1>Contents</h1>\n${navList(points)}\n</nav>\n<nav epub:type="landmarks" hidden="hidden">\n<ol>\n${
      useCover ? `<li><a epub:type="cover" href="cover.xhtml">Cover</a></li>\n` : ""
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
  const depth = Math.max(1, ...points.map((p) => (p.children.length ? (p.children.some((c) => c.children.length) ? 3 : 2) : 1)));
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

  const author = project.author?.trim();
  const series = project.series?.trim();
  const titlePage = page(
    title,
    lang,
    `<section class="titlepage" epub:type="titlepage">\n<p class="title">${escapeXml(title)}</p>\n${author ? `<p class="author">${escapeXml(author)}</p>\n` : ""}${
      series ? `<p class="series">${escapeXml(series)}${project.seriesIndex != null ? `, book ${project.seriesIndex}` : ""}</p>\n` : ""
    }</section>`,
    "titlepage",
  );
  const coverPage = useCover
    ? page("Cover", lang, `<section class="cover" epub:type="cover"><img src="images/cover.${coverExt}" alt="${escapeXml(title)}"/></section>`, "cover")
    : null;

  const pictures = parts.flatMap((p) => p.pictures);
  const fontItems = (font?.files ?? []).map((f, i) => `<item id="font${i + 1}" href="fonts/${f.name}" media-type="font/woff2"/>`);
  const manifest = [
    `<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`,
    `<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`,
    `<item id="css" href="styles.css" media-type="text/css"/>`,
    ...(useCover
      ? [
          `<item id="cover-image" href="images/cover.${coverExt}" media-type="${cover!.mime}" properties="cover-image"/>`,
          `<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>`,
        ]
      : []),
    `<item id="titlepage" href="titlepage.xhtml" media-type="application/xhtml+xml"/>`,
    ...content.map(([name], i) => `<item id="text${i + 1}" href="${name}" media-type="application/xhtml+xml"/>`),
    ...pictures.map((p, i) => `<item id="picture${i + 1}" href="${p.path}" media-type="${p.mime}"/>`),
    ...fontItems,
  ];
  const spine = [...(useCover ? [`<itemref idref="cover"/>`] : []), `<itemref idref="titlepage"/>`, ...content.map((_, i) => `<itemref idref="text${i + 1}"/>`)];
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
    ["OEBPS/styles.css", stylesheet(settings, font)],
    ...(coverPage ? ([["OEBPS/cover.xhtml", coverPage]] as [string, string][]) : []),
    ...(useCover ? ([[`OEBPS/images/cover.${coverExt}`, cover!.bytes]] as [string, Uint8Array][]) : []),
    ["OEBPS/titlepage.xhtml", titlePage],
    ...content.map(([name, text]) => [`OEBPS/${name}`, text] as [string, string]),
    ...pictures.map((p) => [`OEBPS/${p.path}`, p.bytes] as [string, Uint8Array]),
    ...(font?.files ?? []).map((f) => [`OEBPS/fonts/${f.name}`, f.bytes] as [string, Uint8Array]),
  ];
  return { files };
}

/** Problems that stop an export, in words for the person. */
export function exportProblems(chapters: WritingChapter[]): string[] {
  const problems: string[] = [];
  if (!chapters.length) problems.push("Add a chapter first.");
  else if (chapters.every((c) => !c.body.replace(/<[^>]*>/g, "").trim())) problems.push("Write something in a chapter first.");
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

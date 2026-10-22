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
}

export const DEFAULT_EXPORT: ExportSettings = { font: "none", newPage: true, sceneBreak: "asterisks", tocDepth: 1 };

export function readExport(json: string | null | undefined): ExportSettings {
  try {
    const saved = JSON.parse(json || "{}") as Partial<ExportSettings>;
    return {
      font: (["lora", "echolume", "none"] as const).includes(saved.font as BookFont) ? (saved.font as BookFont) : DEFAULT_EXPORT.font,
      newPage: typeof saved.newPage === "boolean" ? saved.newPage : DEFAULT_EXPORT.newPage,
      sceneBreak: (["asterisks", "ornament", "space", "line"] as const).includes(saved.sceneBreak as SceneBreak)
        ? (saved.sceneBreak as SceneBreak)
        : DEFAULT_EXPORT.sceneBreak,
      tocDepth: ([1, 2, 3] as const).includes(saved.tocDepth as 1) ? (saved.tocDepth as 1 | 2 | 3) : DEFAULT_EXPORT.tocDepth,
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

const INLINE: Record<string, string> = { strong: "strong", b: "strong", em: "em", i: "em", u: "u", s: "s", strike: "s", del: "s", code: "code", sub: "sub", sup: "sup" };
const BLOCK: Record<string, string> = { p: "p", blockquote: "blockquote", ul: "ul", ol: "ol", li: "li", pre: "pre" };

/**
 * The editor's HTML as XHTML for the EPUB, with only what readers handle:
 * paragraphs, headings (moved below the chapter title), emphasis, quotes,
 * lists, links and scene breaks. Anything else keeps its words but not its
 * tag. Headings get ids for the table of contents.
 */
export function chapterXhtml(html: string, sceneBreak: SceneBreak, idPrefix: string): { body: string; headings: Heading[] } {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const headings: Heading[] = [];
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
    if (tag === "hr") {
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
  return { body: out.join(""), headings };
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
h1 { font-size: 1.6em; text-align: center; margin: 2em 0 1.5em; font-weight: normal; }
h2 { font-size: 1.25em; margin: 1.5em 0 0.75em; }
h3 { font-size: 1.1em; margin: 1.25em 0 0.5em; }
p { margin: 0; text-indent: 1.5em; text-align: justify; }
h1 + p, h2 + p, h3 + p, .scene + p, hr + p, blockquote + p, .blank + p, p:first-child { text-indent: 0; }
.blank { text-indent: 0; }
blockquote { margin: 1em 2em; font-style: italic; }
blockquote p { text-indent: 0; }
.scene { text-align: center; text-indent: 0; margin: 1em 0; }
hr.scene { border: none; border-top: 1px solid currentColor; width: 25%; margin: 1.5em auto; }
ul, ol { margin: 1em 0 1em 1.5em; }
pre { white-space: pre-wrap; font-family: monospace; }
section.chapter { ${settings.newPage ? "page-break-before: always; break-before: page;" : "margin-top: 3em;"} }
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

  // Chapters, each with its headings.
  const parts = chapters.map((c, i) => {
    const n = i + 1;
    const { body, headings } = chapterXhtml(c.body, settings.sceneBreak, `c${n}`);
    const heading = c.title.trim() || `Chapter ${n}`;
    const section = `<section class="chapter" epub:type="chapter" id="c${n}">\n<h1>${escapeXml(heading)}</h1>\n${body}\n</section>`;
    return { n, heading, section, headings };
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
  const firstText = settings.newPage ? chapterFile(1) : "text.xhtml";
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

// Bringing a book written elsewhere into Scribe: Word, OpenDocument, RTF,
// plain text, Markdown, HTML or EPUB, turned into the markup Scribe's editor
// keeps (paragraphs, headings, italics, quotations, lists, scene breaks,
// footnotes, pictures and links), then split into chapters.

import { strFromU8, unzipSync } from "fflate";

export interface ImportedDocument {
  title: string;
  author: string | null;
  description: string | null;
  /** The whole book as HTML, chapter headings as <h1>/<h2>. */
  html: string;
}

export interface ImportedChapter {
  title: string;
  body: string;
  words: number;
}

export type SplitAt = "headings" | "lines" | "none";

export const IMPORT_ACCEPT = ".docx,.odt,.rtf,.txt,.md,.markdown,.html,.htm,.xhtml,.epub";

const extensionOf = (name: string) => /\.([^.]+)$/.exec(name)?.[1]?.toLowerCase() ?? "";
const baseName = (name: string) => name.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").trim() || "Untitled";

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml" };

function dataUrl(bytes: Uint8Array, mime: string): string {
  let raw = "";
  for (let i = 0; i < bytes.length; i += 0x8000) raw += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${mime};base64,${btoa(raw)}`;
}

/** Reads a file into one HTML document, whatever kind it is. */
export async function readDocument(file: File): Promise<ImportedDocument> {
  return readDocumentBytes(file.name, new Uint8Array(await file.arrayBuffer()));
}

export async function readDocumentBytes(name: string, bytes: Uint8Array): Promise<ImportedDocument> {
  const ext = extensionOf(name);
  const fallback = baseName(name);
  switch (ext) {
    case "docx":
      return fromDocx(bytes, fallback);
    case "odt":
      return fromOdt(bytes, fallback);
    case "rtf":
      return { title: fallback, author: null, description: null, html: rtfToHtml(new TextDecoder("latin1").decode(bytes)) };
    case "md":
    case "markdown":
      return { title: fallback, author: null, description: null, html: markdownToHtml(new TextDecoder().decode(bytes)) };
    case "txt":
      return { title: fallback, author: null, description: null, html: textToHtml(new TextDecoder().decode(bytes)) };
    case "html":
    case "htm":
    case "xhtml": {
      const doc = new DOMParser().parseFromString(new TextDecoder().decode(bytes), "text/html");
      foldNotes([{ path: "", doc }], (_, href) => href);
      return { title: doc.title.trim() || fallback, author: null, description: null, html: doc.body.innerHTML };
    }
    case "epub":
      return fromEpub(bytes, fallback);
    default:
      throw new Error("TBV can bring in Word (.docx), OpenDocument (.odt), RTF, text, Markdown, HTML and EPUB files.");
  }
}

// ---- Word ----

async function fromDocx(bytes: Uint8Array, fallback: string): Promise<ImportedDocument> {
  const mammoth = (await import("mammoth")).default;
  const { value } = await mammoth.convertToHtml(
    // The browser's mammoth reads an ArrayBuffer; the one the tests run takes the bytes as `buffer`.
    { arrayBuffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, buffer: bytes } as { arrayBuffer: ArrayBuffer },
    { styleMap: ["p[style-name='Title'] => p.doc-title:fresh", "p[style-name='Subtitle'] => p.doc-subtitle:fresh", "p[style-name='Quote'] => blockquote > p:fresh", "p[style-name='Intense Quote'] => blockquote > p:fresh"] },
  );
  let title: string | null = null;
  let author: string | null = null;
  let description: string | null = null;
  try {
    const core = unzipSync(bytes, { filter: (f) => f.name === "docProps/core.xml" })["docProps/core.xml"];
    if (core) {
      const xml = new DOMParser().parseFromString(strFromU8(core), "application/xml");
      title = xml.getElementsByTagName("dc:title")[0]?.textContent?.trim() || null;
      author = xml.getElementsByTagName("dc:creator")[0]?.textContent?.trim() || null;
      description = xml.getElementsByTagName("dc:description")[0]?.textContent?.trim() || null;
    }
  } catch {
    // The details are a nicety; the words are what matter.
  }
  const doc = new DOMParser().parseFromString(`<body>${value}</body>`, "text/html");
  const docTitle = doc.querySelector("p.doc-title");
  if (docTitle) {
    title ??= docTitle.textContent?.trim() || null;
    docTitle.remove();
  }
  doc.querySelectorAll("p.doc-subtitle").forEach((p) => p.remove());
  foldNotes([{ path: "", doc }], (_, href) => href);
  return { title: title || fallback, author, description, html: doc.body.innerHTML };
}

// ---- OpenDocument ----

function fromOdt(bytes: Uint8Array, fallback: string): ImportedDocument {
  const files = unzipSync(bytes);
  const content = files["content.xml"];
  if (!content) throw new Error("That OpenDocument file has no text in it.");
  const xml = new DOMParser().parseFromString(strFromU8(content), "application/xml");
  const meta = files["meta.xml"] ? new DOMParser().parseFromString(strFromU8(files["meta.xml"]), "application/xml") : null;

  const OFFICE = "urn:oasis:names:tc:opendocument:xmlns:office:1.0";
  const TEXT = "urn:oasis:names:tc:opendocument:xmlns:text:1.0";
  const STYLE = "urn:oasis:names:tc:opendocument:xmlns:style:1.0";
  const FO = "urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0";
  const XLINK = "http://www.w3.org/1999/xlink";

  // What each automatic style does: italic, bold, underline, centred, and the named style it's based on.
  const looks = new Map<string, { i: boolean; b: boolean; u: boolean; center: boolean; parent: string | null }>();
  for (const s of xml.getElementsByTagNameNS(STYLE, "style")) {
    const t = s.getElementsByTagNameNS(STYLE, "text-properties")[0];
    const p = s.getElementsByTagNameNS(STYLE, "paragraph-properties")[0];
    looks.set(s.getAttributeNS(STYLE, "name") ?? "", {
      i: t?.getAttributeNS(FO, "font-style") === "italic",
      b: t?.getAttributeNS(FO, "font-weight") === "bold",
      u: !!t?.getAttributeNS(STYLE, "text-underline-style") && t.getAttributeNS(STYLE, "text-underline-style") !== "none",
      center: p?.getAttributeNS(FO, "text-align") === "center",
      parent: s.getAttributeNS(STYLE, "parent-style-name"),
    });
  }
  const look = (el: Element) => looks.get(el.getAttributeNS(TEXT, "style-name") ?? "");

  const inline = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return escapeHtml(node.textContent ?? "");
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const el = node as Element;
    const inner = () => [...el.childNodes].map(inline).join("");
    switch (el.localName) {
      case "s":
        return " ".repeat(Number(el.getAttributeNS(TEXT, "c") ?? 1) || 1);
      case "tab":
        return " ";
      case "line-break":
        return "<br>";
      case "note": {
        const body = el.getElementsByTagNameNS(TEXT, "note-body")[0];
        return `<sup data-footnote="${escapeHtml((body?.textContent ?? "").trim())}">*</sup>`;
      }
      case "a":
        return `<a href="${escapeHtml(el.getAttributeNS(XLINK, "href") ?? "")}">${inner()}</a>`;
      case "frame": {
        const image = el.getElementsByTagNameNS("urn:oasis:names:tc:opendocument:xmlns:drawing:1.0", "image")[0];
        const href = image?.getAttributeNS(XLINK, "href") ?? "";
        const data = files[href];
        const mime = MIME[extensionOf(href)];
        return data && mime ? `<img src="${dataUrl(data, mime)}" alt="">` : "";
      }
      case "span": {
        const l = look(el);
        let html = inner();
        if (l?.u) html = `<u>${html}</u>`;
        if (l?.b) html = `<strong>${html}</strong>`;
        if (l?.i) html = `<em>${html}</em>`;
        return html;
      }
      case "bookmark":
      case "bookmark-start":
      case "bookmark-end":
      case "soft-page-break":
      case "annotation":
        return "";
      default:
        return inner();
    }
  };

  const blocks = (parent: Element): string => {
    let html = "";
    for (const el of parent.children) {
      if (el.namespaceURI === TEXT && el.localName === "h") {
        const level = Math.min(3, Number(el.getAttributeNS(TEXT, "outline-level") ?? 1) || 1);
        html += `<h${level}>${inline(el)}</h${level}>`;
      } else if (el.namespaceURI === TEXT && el.localName === "p") {
        const l = look(el);
        const parentName = l?.parent ?? el.getAttributeNS(TEXT, "style-name") ?? "";
        const words = inline(el);
        if (/^Title$/i.test(parentName)) html += `<p class="doc-title">${words}</p>`;
        else if (/Quot/i.test(parentName)) html += `<blockquote><p>${words}</p></blockquote>`;
        else html += l?.center ? `<p style="text-align: center">${words}</p>` : `<p>${words}</p>`;
      } else if (el.namespaceURI === TEXT && el.localName === "list") {
        html += `<ul>${[...el.children].map((li) => `<li>${blocks(li)}</li>`).join("")}</ul>`;
      } else if (el.localName === "table") {
        for (const cell of el.getElementsByTagNameNS("urn:oasis:names:tc:opendocument:xmlns:table:1.0", "table-cell")) html += blocks(cell);
      } else if (el.localName === "section" || el.localName === "text") {
        html += blocks(el);
      }
    }
    return html;
  };

  const body = xml.getElementsByTagNameNS(OFFICE, "text")[0];
  const doc = new DOMParser().parseFromString(`<body>${body ? blocks(body) : ""}</body>`, "text/html");
  const docTitle = doc.querySelector("p.doc-title");
  const title = meta?.getElementsByTagName("dc:title")[0]?.textContent?.trim() || docTitle?.textContent?.trim() || fallback;
  docTitle?.remove();
  return {
    title,
    author: meta?.getElementsByTagName("dc:creator")[0]?.textContent?.trim() || meta?.getElementsByTagName("meta:initial-creator")[0]?.textContent?.trim() || null,
    description: meta?.getElementsByTagName("dc:description")[0]?.textContent?.trim() || null,
    html: doc.body.innerHTML,
  };
}

// ---- RTF ----

/** Windows-1252's characters 0x80–0x9F, where it differs from Latin-1. */
const CP1252 = "€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008DŽ\u008F\u0090‘’“”•–—˜™š›œ\u009DžŸ";
const cp1252 = (code: number) => (code >= 0x80 && code <= 0x9f ? CP1252[code - 0x80] : String.fromCharCode(code));

/** Groups whose words aren't the book's. */
const SKIPPED = new Set([
  "fonttbl", "colortbl", "stylesheet", "info", "header", "footer", "headerl", "headerr", "headerf", "footerl", "footerr", "footerf", "listtable",
  "listoverridetable", "rsidtbl", "generator", "xmlnstbl", "nonshppict", "themedata", "colorschememapping", "latentstyles", "datastore", "fldinst", "pgdsctbl",
]);

export function rtfToHtml(rtf: string): string {
  interface State {
    skip: boolean;
    i: boolean;
    b: boolean;
    u: boolean;
    uc: number;
    note: boolean;
    pict: boolean;
  }
  const blocks: string[] = [];
  let para = "";
  let paraLevel = 0;
  let center = false;
  let note: string | null = null;
  let pict: { hex: string; mime: string | null } | null = null;
  let run = { text: "", i: false, b: false, u: false };
  let state: State = { skip: false, i: false, b: false, u: false, uc: 1, note: false, pict: false };
  const stack: State[] = [];
  let skipChars = 0;
  let groupStart = false;

  const flushRun = () => {
    if (!run.text) return;
    let html = escapeHtml(run.text);
    if (run.u) html = `<u>${html}</u>`;
    if (run.b) html = `<strong>${html}</strong>`;
    if (run.i) html = `<em>${html}</em>`;
    if (note !== null) note += run.text;
    else para += html;
    run = { ...run, text: "" };
  };
  const write = (text: string) => {
    if (state.skip || skipChars > 0) {
      if (skipChars > 0) skipChars -= text.length;
      return;
    }
    if (state.pict && pict) {
      pict.hex += text;
      return;
    }
    if (state.note && note === null) return;
    if (run.i !== state.i || run.b !== state.b || run.u !== state.u) {
      flushRun();
      run = { text: "", i: state.i, b: state.b, u: state.u };
    }
    run.text += text;
  };
  const endPara = () => {
    flushRun();
    const words = para.trim();
    if (words) blocks.push(paraLevel ? `<h${paraLevel}>${words}</h${paraLevel}>` : center ? `<p style="text-align: center">${words}</p>` : `<p>${words}</p>`);
    para = "";
  };

  let i = 0;
  while (i < rtf.length) {
    const c = rtf[i];
    if (c === "{") {
      flushRun();
      stack.push(state);
      state = { ...state };
      groupStart = true;
      i++;
      continue;
    }
    if (c === "}") {
      flushRun();
      const was = state;
      state = stack.pop() ?? state;
      if (was.note && !state.note && note !== null) {
        para += `<sup data-footnote="${escapeHtml(note.trim())}">*</sup>`;
        note = null;
      }
      if (was.pict && !state.pict && pict) {
        const clean = pict.hex.replace(/[^0-9a-f]/gi, "");
        if (pict.mime && clean.length > 2) {
          const data = new Uint8Array(clean.length / 2);
          for (let k = 0; k < data.length; k++) data[k] = parseInt(clean.substr(k * 2, 2), 16);
          para += `<img src="${dataUrl(data, pict.mime)}" alt="">`;
        }
        pict = null;
      }
      groupStart = false;
      i++;
      continue;
    }
    if (c === "\\") {
      const next = rtf[i + 1];
      if (next === "'") {
        write(cp1252(parseInt(rtf.substr(i + 2, 2), 16)));
        i += 4;
        groupStart = false;
        continue;
      }
      if (next === "*") {
        // An optional destination: kept only for a picture's PNG or JPEG.
        const ahead = /^\\\*\\([a-z]+)/.exec(rtf.slice(i, i + 40));
        if (ahead?.[1] !== "shppict") state.skip = true;
        i += 2;
        continue;
      }
      if (next && !/[a-z]/i.test(next)) {
        if (next === "~") write("\u00a0");
        else if (next === "_") write("‑");
        else if (next === "\\" || next === "{" || next === "}") write(next);
        else if (next === "\n" || next === "\r") endPara();
        i += 2;
        groupStart = false;
        continue;
      }
      const m = /^\\([a-z]+)(-?\d+)? ?/i.exec(rtf.slice(i, i + 40));
      if (!m) {
        i++;
        continue;
      }
      const [all, word, arg] = m;
      const n = arg === undefined ? null : Number(arg);
      i += all.length;
      const first = groupStart;
      groupStart = false;
      if (first && SKIPPED.has(word)) {
        state.skip = true;
        continue;
      }
      switch (word) {
        case "par":
          if (note !== null) note += " ";
          else endPara();
          break;
        case "line":
          write("\n");
          if (note === null && !state.skip) {
            flushRun();
            para += "<br>";
            run.text = "";
          }
          break;
        case "tab":
          write(" ");
          break;
        case "emdash":
          write("—");
          break;
        case "endash":
          write("–");
          break;
        case "lquote":
          write("‘");
          break;
        case "rquote":
          write("’");
          break;
        case "ldblquote":
          write("“");
          break;
        case "rdblquote":
          write("”");
          break;
        case "bullet":
          write("•");
          break;
        case "u": {
          const code = n !== null && n < 0 ? n + 65536 : (n ?? 0);
          write(String.fromCharCode(code));
          skipChars = state.uc;
          break;
        }
        case "uc":
          state.uc = n ?? 1;
          break;
        case "i":
          state.i = n !== 0;
          break;
        case "b":
          state.b = n !== 0;
          break;
        case "ul":
          state.u = n !== 0;
          break;
        case "ulnone":
          state.u = false;
          break;
        case "plain":
          state.i = state.b = state.u = false;
          break;
        case "pard":
          center = false;
          paraLevel = 0;
          break;
        case "qc":
          center = true;
          break;
        case "outlinelevel":
          paraLevel = Math.min(3, (n ?? 0) + 1);
          break;
        case "footnote":
          if (!state.skip) {
            flushRun();
            state.note = true;
            note = "";
          }
          break;
        case "chftn":
          break;
        case "pict":
          if (!state.skip) {
            flushRun();
            state.pict = true;
            pict = { hex: "", mime: null };
          }
          break;
        case "pngblip":
          if (pict) pict.mime = "image/png";
          break;
        case "jpegblip":
          if (pict) pict.mime = "image/jpeg";
          break;
        default:
          break;
      }
      continue;
    }
    if (c === "\n" || c === "\r") {
      i++;
      continue;
    }
    // Plain text, up to the next control.
    let end = i;
    while (end < rtf.length && !"\\{}\n\r".includes(rtf[end])) end++;
    let text = rtf.slice(i, end);
    if (skipChars > 0) {
      const drop = Math.min(skipChars, text.length);
      text = text.slice(drop);
      skipChars -= drop;
    }
    if (text) write(text);
    groupStart = false;
    i = end;
  }
  endPara();
  return blocks.join("");
}

// ---- Markdown and text ----

function markdownInline(text: string, notes: Map<string, string>): string {
  return escapeHtml(text)
    .replace(/\[\^([^\]]+)\]/g, (_, id: string) => (notes.has(id) ? `<sup data-footnote="${escapeHtml(notes.get(id)!)}">*</sup>` : ""))
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\(((?:https?:|mailto:)[^)\s]+)\)/g, '<a href="$2">$1</a>')
    .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, "<strong>$2</strong>")
    .replace(/(\*|_)(?=\S)([\s\S]*?\S)\1/g, "<em>$2</em>")
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, "<s>$1</s>")
    .replace(/ {2,}\n|\\\n/g, "<br>")
    .replace(/\n/g, " ");
}

export function markdownToHtml(md: string): string {
  const notes = new Map<string, string>();
  const text = md.replace(/\r\n?/g, "\n").replace(/^\[\^([^\]]+)\]:\s*(.+)$/gm, (_, id: string, note: string) => {
    notes.set(id, note.trim());
    return "";
  });
  const out: string[] = [];
  for (const block of text.split(/\n\s*\n/)) {
    const b = block.replace(/^\n+|\s+$/g, "");
    if (!b.trim()) continue;
    const heading = /^(#{1,6})\s+(.*)$/.exec(b);
    if (heading && !b.includes("\n")) {
      const level = Math.min(3, heading[1].length);
      out.push(`<h${level}>${markdownInline(heading[2].replace(/\s#+$/, ""), notes)}</h${level}>`);
    } else if (/^(\*\s*){3,}$|^(-\s*){3,}$|^(_\s*){3,}$/.test(b.trim())) out.push("<hr>");
    else if (/^>/.test(b)) out.push(`<blockquote><p>${markdownInline(b.replace(/^>\s?/gm, ""), notes)}</p></blockquote>`);
    else if (/^\s*([-*+]|\d+[.)])\s/.test(b)) {
      const ordered = /^\s*\d/.test(b);
      const items = b.split(/\n(?=\s*(?:[-*+]|\d+[.)])\s)/).map((li) => `<li><p>${markdownInline(li.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, ""), notes)}</p></li>`);
      out.push(ordered ? `<ol>${items.join("")}</ol>` : `<ul>${items.join("")}</ul>`);
    } else out.push(`<p>${markdownInline(b, notes)}</p>`);
  }
  return out.join("");
}

export function textToHtml(text: string): string {
  const t = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const blocks = t.split(/\n\s*\n/).filter((b) => b.trim());
  const lines = t.split("\n").filter((l) => l.trim());
  // Some files put each paragraph on one line with no blank lines between.
  const each = lines.length > blocks.length * 3 ? lines : blocks;
  return each.map((b) => `<p>${escapeHtml(b.trim()).replace(/\n/g, "<br>")}</p>`).join("");
}

// ---- EPUB ----

function fromEpub(bytes: Uint8Array, fallback: string): ImportedDocument {
  const files = unzipSync(bytes);
  const text = (path: string) => (files[path] ? strFromU8(files[path]) : "");
  const container = new DOMParser().parseFromString(text("META-INF/container.xml"), "application/xml");
  const opfPath = container.getElementsByTagName("rootfile")[0]?.getAttribute("full-path") ?? "";
  const opf = new DOMParser().parseFromString(text(opfPath), "application/xml");
  if (!opfPath || !opf.documentElement) throw new Error("That EPUB couldn't be opened.");
  const dir = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "";
  const resolve = (from: string, href: string) => {
    const parts = (from.slice(0, from.lastIndexOf("/") + 1) + decodeURIComponent(href)).split("/");
    const out: string[] = [];
    for (const p of parts) {
      if (p === "..") out.pop();
      else if (p !== ".") out.push(p);
    }
    return out.join("/");
  };
  const items = new Map([...opf.getElementsByTagName("item")].map((it) => [it.getAttribute("id") ?? "", { href: dir + (it.getAttribute("href") ?? ""), props: it.getAttribute("properties") ?? "" }]));
  const spine = [...opf.getElementsByTagName("itemref")].map((r) => items.get(r.getAttribute("idref") ?? "")).filter((x): x is { href: string; props: string } => !!x && !x.props.includes("nav"));
  const meta = (name: string) => opf.getElementsByTagName(name)[0]?.textContent?.trim() || null;

  const docs = spine.map((s) => ({ path: decodeURIComponent(s.href), doc: new DOMParser().parseFromString(text(decodeURIComponent(s.href)), "text/html") }));
  // Pictures come along inside the chapters.
  for (const { path, doc } of docs) {
    for (const img of [...doc.querySelectorAll("img, image")]) {
      const src = img.getAttribute("src") ?? img.getAttribute("xlink:href") ?? img.getAttribute("href") ?? "";
      const at = resolve(path, src);
      const mime = MIME[extensionOf(at)];
      if (files[at] && mime) {
        const el = doc.createElement("img");
        el.setAttribute("src", dataUrl(files[at], mime));
        el.setAttribute("alt", img.getAttribute("alt") ?? "");
        img.replaceWith(el);
      } else img.remove();
    }
  }
  foldNotes(docs, (from, href) => resolve(from, href));

  let html = "";
  for (const { doc } of docs) {
    const body = doc.body;
    if (!body) continue;
    const words = (body.textContent ?? "").trim().split(/\s+/).filter(Boolean).length;
    if (words < 3 && !body.querySelector("img")) continue;
    const heading = body.querySelector("h1, h2, h3");
    if (heading) {
      const h1 = doc.createElement("h1");
      h1.innerHTML = heading.innerHTML;
      heading.replaceWith(h1);
    } else body.insertAdjacentHTML("afterbegin", "<h1></h1>");
    html += body.innerHTML;
  }
  return { title: meta("dc:title") ?? fallback, author: meta("dc:creator"), description: meta("dc:description"), html };
}

/**
 * Note marks that link to their note (in the same document or another) become
 * Scribe's footnotes, the note's words kept with the mark, and the note itself
 * is taken out of the text.
 */
function foldNotes(docs: { path: string; doc: Document }[], resolve: (from: string, href: string) => string) {
  const byId = new Map<string, Element>();
  for (const { path, doc } of docs) for (const el of doc.querySelectorAll("[id]")) byId.set(`${path}#${el.id}`, el);
  const used = new Set<Element>();
  for (const { path, doc } of docs) {
    for (const a of [...doc.querySelectorAll("a[href*='#']")]) {
      const href = a.getAttribute("href") ?? "";
      const isNote = a.getAttribute("epub:type") === "noteref" || a.getAttribute("role") === "doc-noteref" || (a.closest("sup") && /^\s*[[(]?\w{1,3}[\])]?\s*$/.test(a.textContent ?? ""));
      if (!isNote) continue;
      const [file, id] = href.split("#");
      const target = byId.get(`${file ? resolve(path, file) : path}#${id}`);
      if (!target) continue;
      const note = target.closest("li, aside, p, div") ?? target;
      const clone = note.cloneNode(true) as Element;
      // The way back to the mark isn't part of the note.
      clone.querySelectorAll("a[href*='#']").forEach((back) => {
        if (/^[\s↑↩^\d[\]]*$/.test(back.textContent ?? "") || back.getAttribute("role") === "doc-backlink") back.remove();
      });
      const words = (clone.textContent ?? "").replace(/\s+/g, " ").trim();
      const mark = doc.createElement("sup");
      mark.setAttribute("data-footnote", words);
      mark.textContent = "*";
      (a.closest("sup") ?? a).replaceWith(mark);
      used.add(note);
    }
  }
  for (const note of used) {
    const list = note.parentElement;
    note.remove();
    if (list && /^(ol|ul|section|aside|div)$/i.test(list.tagName) && !(list.textContent ?? "").trim()) list.remove();
  }
  for (const { doc } of docs) doc.querySelectorAll("hr.footnotes, section.footnotes:empty, div.footnotes:empty").forEach((el) => el.remove());
}

// ---- Tidying and splitting ----

const SCENE_BREAK = /^\s*(?:[*#~•◆✦❦-]\s*){1,5}\s*$/;
const CHAPTER_LINE = /^\s*(?:(?:chapter|part|book|prologue|epilogue|interlude|afterword|foreword|preface|introduction|acknowledg(?:e)?ments)\b.{0,80}|(?:\d{1,3}|[IVXLC]{1,7})\.?)\s*$/i;

/** Keeps only the markup Scribe's editor holds. */
function tidy(root: Element) {
  const keep = new Set(["P", "H1", "H2", "H3", "EM", "STRONG", "U", "S", "SUP", "SUB", "BLOCKQUOTE", "UL", "OL", "LI", "HR", "BR", "IMG", "A", "MARK"]);
  const rename: Record<string, string> = { I: "em", B: "strong", CITE: "em", STRIKE: "s", DEL: "s", H4: "h3", H5: "h3", H6: "h3" };
  const walk = (el: Element) => {
    for (const child of [...el.children]) {
      walk(child);
      const tag = child.tagName.toUpperCase();
      if (rename[tag]) {
        const next = child.ownerDocument.createElement(rename[tag]);
        next.append(...child.childNodes);
        child.replaceWith(next);
        continue;
      }
      if (tag === "SCRIPT" || tag === "STYLE" || tag === "HEAD" || tag === "TITLE" || tag === "META" || tag === "LINK") {
        child.remove();
        continue;
      }
      if (!keep.has(tag)) {
        // A block that isn't kept still leaves its words, as a paragraph if it held loose text.
        if (/^(DIV|SECTION|ARTICLE|HEADER|FOOTER|ASIDE|FIGURE|FIGCAPTION|TD|TH|CENTER|DD|DT|PRE)$/.test(tag) && [...child.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim())) {
          const p = child.ownerDocument.createElement("p");
          p.append(...child.childNodes);
          child.replaceWith(p);
        } else child.replaceWith(...child.childNodes);
        continue;
      }
      const centred = /text-align:\s*center/i.test(child.getAttribute("style") ?? "") || child.getAttribute("align") === "center" || /\bcent(er|re)/i.test(child.getAttribute("class") ?? "");
      for (const attr of [...child.attributes]) {
        const allowed = (tag === "A" && attr.name === "href") || (tag === "IMG" && (attr.name === "src" || attr.name === "alt")) || (tag === "SUP" && attr.name === "data-footnote");
        if (!allowed) child.removeAttribute(attr.name);
      }
      if (centred && tag === "P") child.setAttribute("style", "text-align: center");
      if (tag === "A" && !/^(https?:|mailto:)/i.test(child.getAttribute("href") ?? "")) child.replaceWith(...child.childNodes);
      if (tag === "IMG" && !/^data:image\//.test(child.getAttribute("src") ?? "")) child.remove();
    }
  };
  walk(root);
  // Paragraphs that are only a scene-break mark become one.
  for (const p of [...root.querySelectorAll("p")]) {
    const text = p.textContent ?? "";
    if (text.trim() && SCENE_BREAK.test(text) && !p.querySelector("img")) p.replaceWith(root.ownerDocument.createElement("hr"));
    else if (!text.trim() && !p.querySelector("img, br")) p.remove();
  }
}

const wordCount = (html: string) =>
  html
    .replace(/<sup[^>]*data-footnote[^>]*>.*?<\/sup>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .split(/\s+/)
    .filter((w) => /\w/.test(w)).length;

/** How the document would split by itself: at its headings if it has them, else at lines like "Chapter 1", else not at all. */
export function bestSplit(html: string): SplitAt {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  if (doc.body.querySelectorAll("h1, h2").length >= 2) return "headings";
  const lines = [...doc.body.querySelectorAll("p")].filter((p) => CHAPTER_LINE.test(p.textContent ?? ""));
  return lines.length >= 2 ? "lines" : "none";
}

/** The document cut into chapters. Whatever comes before the first chapter is kept as an opening page. */
export function splitChapters(html: string, at: SplitAt, bookTitle: string): ImportedChapter[] {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  tidy(doc.body);
  const level = doc.body.querySelector("h1") ? "H1" : "H2";
  const isBreak = (el: Element) =>
    at === "headings" ? el.tagName === level : at === "lines" ? el.tagName === "P" && CHAPTER_LINE.test(el.textContent ?? "") || el.tagName === level : false;
  const out: { title: string; nodes: Node[] }[] = [{ title: "", nodes: [] }];
  for (const node of [...doc.body.childNodes]) {
    if (node.nodeType === Node.ELEMENT_NODE && isBreak(node as Element)) {
      out.push({ title: (node.textContent ?? "").replace(/\s+/g, " ").trim(), nodes: [] });
      continue;
    }
    out[out.length - 1].nodes.push(node);
  }
  const chapters: ImportedChapter[] = [];
  out.forEach((part, i) => {
    const holder = doc.createElement("div");
    holder.append(...part.nodes);
    const body = holder.innerHTML.trim();
    const words = wordCount(body);
    if (i === 0 && !words && !holder.querySelector("img")) return;
    chapters.push({ title: part.title || (i === 0 ? (out.length > 1 ? "Opening" : bookTitle) : "Untitled"), body, words });
  });
  // A chapter number alone ("1") reads better as "Chapter 1".
  for (const c of chapters) if (/^\d{1,3}\.?$/.test(c.title)) c.title = `Chapter ${parseInt(c.title, 10)}`;
  return chapters.length ? chapters : [{ title: bookTitle, body: "", words: 0 }];
}

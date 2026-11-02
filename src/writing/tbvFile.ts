// The Scribe book file (.tbv): one file holding a whole book as Scribe has it,
// so opening it rebuilds the book exactly, with nothing guessed. It isn't
// locked: like EPUB and Word files it's an ordinary zip, holding
//
//   mimetype          "application/vnd.krowsingre.tbv+zip", first and not compressed
//   book.json         the book's details, its settings (styles, store editions,
//                     sources, copyright, print) and every page in order, each
//                     with its kind, its area and the part it's in
//   pages/0001.html   each page's words, as Scribe's editor keeps them
//   images/…          the pictures in the pages, taken out of them
//   cover.jpg|png     the cover picture
//   notes/0001.html   the book's notes
//
// The table of contents isn't written out: a Contents page only marks where
// it goes, and Scribe makes it from the pages. The signed records of where
// the book came from travel in book.json and are signed into the new book's
// own record when the file is opened (see ImportBook.tsx).

import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from "fflate";
import type { NoteItem, ProvenanceRecord, WritingChapter, WritingProject } from "../api/types";

export const TBV_EXTENSION = "tbv";
export const TBV_MIME = "application/vnd.krowsingre.tbv+zip";
/** The layout this version writes. A file from a newer one still opens; what this version doesn't know is left out. */
export const TBV_VERSION = 1;

const ROLES: WritingChapter["role"][] = ["chapter", "front", "back", "part"];
const IMAGE_TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml" };
const EXTENSION_OF: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/svg+xml": "svg" };
/** Larger than any book; a file that unpacks to more is refused. */
const MAX_UNPACKED = 1024 * 1024 * 1024;

export interface TbvPage {
  title: string;
  role: WritingChapter["role"];
  /** The part (an anthology's book) it sits in, by its place in `pages`. */
  part: number | null;
  /** Its kind and how it's set out (src/writing/pages.ts). */
  page: Record<string, unknown>;
  body: string;
}

export interface TbvNote {
  title: string | null;
  body: string;
  tags: string[];
  pinned: boolean;
}

export interface TbvBook {
  formatVersion: number;
  madeBy: string | null;
  madeAt: string | null;
  title: string;
  author: string | null;
  series: string | null;
  seriesIndex: number | null;
  language: string | null;
  description: string | null;
  coverPage: WritingProject["coverPage"];
  /** The export settings, as Scribe keeps them (src/writing/epub.ts). */
  settings: Record<string, unknown>;
  cover: { bytes: Uint8Array; extension: "png" | "jpg" } | null;
  pages: TbvPage[];
  notes: TbvNote[];
  /** The records of where the book came from, as the saving device had them. */
  history: unknown[];
  /** Made by a newer TBV than this one. */
  newer: boolean;
}

export interface TbvInput {
  project: WritingProject;
  chapters: WritingChapter[];
  cover: Uint8Array | null;
  notes: NoteItem[];
  records: ProvenanceRecord[];
  app: string;
}

const isPng = (b: Uint8Array) => b.length > 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;

function parseJson(text: string | null | undefined): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(text || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function fromBase64(data: string): Uint8Array {
  const raw = atob(data);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function toBase64(bytes: Uint8Array): string {
  let raw = "";
  for (let i = 0; i < bytes.length; i += 0x8000) raw += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(raw);
}

const pad = (n: number) => String(n).padStart(4, "0");

/** The book as a .tbv file. */
export function writeTbv(input: TbvInput): Uint8Array {
  const chapters = [...input.chapters].sort((a, b) => a.position - b.position);
  const index = new Map(chapters.map((c, i) => [c.id, i]));
  const files: Zippable = { mimetype: [strToU8(TBV_MIME), { level: 0 }] };
  // Each picture is kept once, however many pages show it.
  const images = new Map<string, string>();
  const takeImages = (html: string) =>
    html.replace(/(\ssrc=")data:(image\/[a-z+.-]+);base64,([^"]+)"/gi, (whole, before: string, mime: string, data: string) => {
      const ext = EXTENSION_OF[mime.toLowerCase()];
      if (!ext) return whole;
      let path = images.get(data);
      if (!path) {
        path = `images/${pad(images.size + 1)}.${ext}`;
        images.set(data, path);
        files[path] = [fromBase64(data), { level: 0 }];
      }
      return `${before}${path}"`;
    });

  const pages = chapters.map((c, i) => {
    const file = `pages/${pad(i + 1)}.html`;
    files[file] = strToU8(takeImages(c.body));
    const part = c.role !== "part" && c.part !== null ? (index.get(c.part) ?? null) : null;
    return { file, title: c.title, role: c.role, part, page: parseJson(c.page) };
  });
  const notes = input.notes
    .filter((n) => n.kind === "personal")
    .map((n, i) => {
      const file = `notes/${pad(i + 1)}.html`;
      files[file] = strToU8(takeImages(n.note ?? ""));
      return { file, title: n.title, tags: n.tags ?? [], pinned: !!n.pinnedAt };
    });
  let cover: string | null = null;
  if (input.cover?.length) {
    cover = isPng(input.cover) ? "cover.png" : "cover.jpg";
    files[cover] = [input.cover, { level: 0 }];
  }
  const p = input.project;
  const book = {
    format: "The Bound Vigil book",
    formatVersion: TBV_VERSION,
    madeBy: `The Bound Vigil ${input.app}`,
    madeAt: new Date().toISOString(),
    book: {
      title: p.title,
      author: p.author,
      series: p.series,
      seriesIndex: p.seriesIndex,
      language: p.language,
      description: p.description,
      coverPage: p.coverPage,
      cover,
      settings: parseJson(p.export),
    },
    pages,
    notes,
    history: input.records.map((r) => ({ event: r.event, createdAt: r.createdAt, record: r.record, signature: r.signature, keyId: r.keyId, appleStamp: r.appleStamp, appleCheck: r.appleCheck, device: r.device })),
  };
  // book.json goes second, after the mimetype, so it's quick to find.
  const ordered: Zippable = { mimetype: files.mimetype, "book.json": strToU8(JSON.stringify(book, null, 2)) };
  for (const [name, entry] of Object.entries(files)) if (name !== "mimetype") ordered[name] = entry;
  return zipSync(ordered, { level: 6 });
}

/** Whether bytes look like a .tbv file, without opening it all. */
export function isTbv(bytes: Uint8Array): boolean {
  // A zip's first entry, named "mimetype", holding the type uncompressed: as an EPUB's is.
  if (bytes.length < 30 || bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 3 || bytes[3] !== 4) return false;
  const nameLength = bytes[26] | (bytes[27] << 8);
  const extraLength = bytes[28] | (bytes[29] << 8);
  const start = 30 + nameLength + extraLength;
  return nameLength === 8 && strFromU8(bytes.subarray(30, 38)) === "mimetype" && strFromU8(bytes.subarray(start, start + TBV_MIME.length)) === TBV_MIME;
}

/** Only what a page of a book can hold: no scripts, nothing that runs or loads from elsewhere. */
export function safeHtml(html: string, picture: (path: string) => string | null): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  doc.body.querySelectorAll("script, style, iframe, object, embed, link, meta, base, form, input, button, textarea, select, frame, frameset, applet, template").forEach((el) => el.remove());
  for (const el of doc.body.querySelectorAll("*")) {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim();
      if (name.startsWith("on") || name === "srcdoc" || name === "formaction") el.removeAttribute(attr.name);
      else if ((name === "href" || name === "xlink:href") && !/^(https?:|mailto:|#)/i.test(value)) el.removeAttribute(attr.name);
    }
    if (el.tagName === "IMG") {
      const src = el.getAttribute("src") ?? "";
      const kept = /^data:image\/(png|jpe?g|gif|webp);base64,/i.test(src) ? src : picture(src);
      if (kept) el.setAttribute("src", kept);
      else el.remove();
    }
  }
  return doc.body.innerHTML;
}

/** Opens a .tbv file. Throws, in plain words, when it isn't one or can't be read. */
export function readTbv(bytes: Uint8Array): TbvBook {
  let files: Record<string, Uint8Array>;
  try {
    let total = 0;
    files = unzipSync(bytes, {
      filter: (f) => {
        total += f.originalSize;
        if (total > MAX_UNPACKED) throw new Error("too large");
        return true;
      },
    });
  } catch {
    throw new Error("That Scribe book file couldn't be opened. It may be damaged or only partly copied.");
  }
  const text = (path: unknown) => (typeof path === "string" && files[path] ? strFromU8(files[path]) : "");
  if (files.mimetype && text("mimetype").trim() !== TBV_MIME) throw new Error("That isn't a Scribe book file.");
  const json = parseJson(text("book.json"));
  if (!files["book.json"] || json.format !== "The Bound Vigil book") throw new Error("That isn't a Scribe book file, or its book.json is damaged.");
  const formatVersion = typeof json.formatVersion === "number" ? json.formatVersion : 1;
  const details = (json.book && typeof json.book === "object" ? json.book : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);

  const picture = (path: string) => {
    const bytes = files[path.replace(/^\.?\//, "")];
    const mime = IMAGE_TYPES[(/\.([a-z]+)$/i.exec(path)?.[1] ?? "").toLowerCase().replace("jpeg", "jpg")];
    // SVG pictures can carry scripts, so they don't come in.
    return bytes && mime && mime !== "image/svg+xml" ? `data:${mime};base64,${toBase64(bytes)}` : null;
  };

  const listed = Array.isArray(json.pages) ? (json.pages as unknown[]) : [];
  const raw = listed.filter((x): x is Record<string, unknown> => !!x && typeof x === "object");
  const pages: TbvPage[] = raw.map((x) => {
    const role = ROLES.includes(x.role as WritingChapter["role"]) ? (x.role as WritingChapter["role"]) : "chapter";
    return {
      title: typeof x.title === "string" ? x.title.slice(0, 500) : "",
      role,
      part: null,
      page: role === "part" ? {} : x.page && typeof x.page === "object" && !Array.isArray(x.page) ? (x.page as Record<string, unknown>) : {},
      body: safeHtml(text(x.file), picture),
    };
  });
  // A part is only kept when it points at a part.
  raw.forEach((x, i) => {
    const at = x.part;
    if (pages[i].role !== "part" && typeof at === "number" && Number.isInteger(at) && pages[at]?.role === "part") pages[i].part = at;
  });
  const notes: TbvNote[] = (Array.isArray(json.notes) ? (json.notes as unknown[]) : [])
    .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
    .map((x) => ({
      title: str(x.title),
      body: safeHtml(text(x.file), picture),
      tags: Array.isArray(x.tags) ? x.tags.filter((t): t is string => typeof t === "string").slice(0, 50) : [],
      pinned: x.pinned === true,
    }));
  const coverPath = str(details.cover);
  const coverBytes = coverPath ? files[coverPath] : undefined;
  const opens = details.coverPage;
  return {
    formatVersion,
    madeBy: str(json.madeBy),
    madeAt: str(json.madeAt),
    title: str(details.title) ?? "Untitled",
    author: str(details.author),
    series: str(details.series),
    seriesIndex: typeof details.seriesIndex === "number" ? details.seriesIndex : null,
    language: str(details.language),
    description: str(details.description),
    coverPage: opens === "cover" || opens === "title" || opens === "none" ? opens : null,
    settings: details.settings && typeof details.settings === "object" && !Array.isArray(details.settings) ? (details.settings as Record<string, unknown>) : {},
    cover: coverBytes?.length ? { bytes: coverBytes, extension: isPng(coverBytes) ? "png" : "jpg" } : null,
    pages,
    notes,
    history: Array.isArray(json.history) ? json.history.slice(0, 200) : [],
    newer: formatVersion > TBV_VERSION,
  };
}

/** The file's name for a book: its title, with what file names can't hold taken out. */
export function tbvFileName(title: string): string {
  const name = title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "Book";
  return `${name}.${TBV_EXTENSION}`;
}

// A Quire book written by hand, in any text editor (embre's plan, 17 November):
//
//   book.md       the book's details at the top, then its pages:
//
//                   Title: Night Lanterns
//                   Subtitle: Poems of the Long Dark
//                   Author: Embre Vale
//
//                   === Dedication ===
//                   For the lamplighters.
//
//                   === Chapter: The Long Night ===
//                   Words, in Markdown. ![A lamp at dusk](pictures/lamp.jpg)
//
//                   === Picture page: pictures/map.jpg ===
//                   The valley, as the lamplighters knew it.
//
//   pictures/     the pictures the pages name
//
// The two come as a zip (named .zip or .tbv), as the folder itself, or as
// book.md alone. It's read like any marked manuscript: every "=== kind: title"
// line starts a page of that kind, and nothing is guessed.

import { strFromU8, unzipSync, zipSync, type Zippable } from "fflate";
import { markdownToHtml, type ImportedDocument, type ImportWarning } from "./importDoc";

/** Larger than any book; a file that unpacks to more is refused. */
const MAX_UNPACKED = 1024 * 1024 * 1024;
const PICTURE_TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };
const TEXT_FILE = /\.(md|markdown|txt)$/i;
/** A details line at the top: "Title: Night Lanterns". */
const DETAIL = /^\s*(title|subtitle|author|language|description)\s*:\s*(.*?)\s*$/i;
/** A picture with a page of its own: "=== Picture page: pictures/map.jpg ===". */
const PICTURE_PAGE = /^\s*={3,}\s*picture(?:\s+page)?\s*:\s*(.+?)\s*=*\s*$/i;
const PAGE_START = /^\s*={3,}/;

const isZip = (b: Uint8Array) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 3 && b[3] === 4;
const depth = (path: string) => path.split("/").length;

/** The book's text file among a zip's or a folder's files: book.md first, else the only text file nearest the top. */
export function bookTextIn(names: string[]): string | null {
  const texts = names.filter((n) => TEXT_FILE.test(n) && !/(^|\/)(__MACOSX|\.)/.test(n));
  const named = texts.filter((n) => /(^|\/)book\.(md|markdown|txt)$/i.test(n)).sort((a, b) => depth(a) - depth(b));
  if (named.length) return named[0];
  const top = Math.min(...texts.map(depth));
  const nearest = texts.filter((n) => depth(n) === top);
  return nearest.length === 1 ? nearest[0] : null;
}

/** The names in a zip, without unpacking it. */
function zipNames(bytes: Uint8Array): string[] {
  const names: string[] = [];
  try {
    unzipSync(bytes, {
      filter: (f) => {
        names.push(f.name);
        return false;
      },
    });
  } catch {
    return [];
  }
  return names;
}

/** A zip holding a book written by hand (and not a book saved by Quire, which has book.json). */
export function isTextBookZip(bytes: Uint8Array): boolean {
  if (!isZip(bytes)) return false;
  const names = zipNames(bytes);
  return !names.includes("book.json") && bookTextIn(names) !== null;
}

/**
 * A text file that starts with the book's details ("Title: …") or has a
 * picture page: a book written by hand. Other marked text files are read as
 * they always were.
 */
export function looksHandWritten(text: string): boolean {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  const first = lines.find((l) => l.trim());
  return (!!first && /^\s*title\s*:/i.test(first)) || lines.some((l) => PICTURE_PAGE.test(l));
}

/** Files chosen together, or a folder's, put in one zip with their paths, to be read like any other. */
export function bundle(files: { path: string; bytes: Uint8Array }[]): Uint8Array {
  const zip: Zippable = {};
  for (const f of files) zip[f.path.replace(/\\/g, "/").replace(/^\/+/, "")] = [f.bytes, { level: 0 }];
  return zipSync(zip);
}

function dataUrl(bytes: Uint8Array, mime: string): string {
  let raw = "";
  for (let i = 0; i < bytes.length; i += 0x8000) raw += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${mime};base64,${btoa(raw)}`;
}

/** The details at the top of the text, and the rest. */
export function splitDetails(text: string): { details: Record<string, string>; rest: string } {
  const lines = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split("\n");
  const details: Record<string, string> = {};
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i++;
  for (; i < lines.length; i++) {
    const m = DETAIL.exec(lines[i]);
    if (!m) break;
    if (m[2]) details[m[1].toLowerCase()] = m[2];
  }
  return { details, rest: (Object.keys(details).length ? lines.slice(i) : lines).join("\n") };
}

/**
 * A picture page's mark becomes a marked page holding that picture at full
 * size, its caption taken from the line after the mark.
 */
export function pagesForPictures(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = PICTURE_PAGE.exec(lines[i]);
    if (!m) {
      out.push(lines[i]);
      continue;
    }
    let caption = "";
    let next = i + 1;
    while (next < lines.length && !lines[next].trim()) next++;
    if (next < lines.length && !PAGE_START.test(lines[next])) {
      caption = lines[next].trim().replace(/[[\]]/g, "");
      i = next;
    }
    out.push("", "=== picture page", "", `![${caption}](${m[1].trim()} "full")`, "");
  }
  return out.join("\n");
}

/**
 * Reads a book written by hand: a zip (or bundled folder) holding its text
 * and pictures, or the text alone. Pictures it can't find are listed.
 */
export function readTextBook(name: string, bytes: Uint8Array): ImportedDocument {
  let files: Record<string, Uint8Array> = {};
  let textPath: string | null = null;
  if (isZip(bytes)) {
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
      throw new Error("That book couldn't be opened. The zip may be damaged or only partly copied.");
    }
    textPath = bookTextIn(Object.keys(files));
    if (!textPath) throw new Error("There's no book.md inside. Put the book's text in a file called book.md, beside its pictures folder.");
  }
  const text = textPath ? strFromU8(files[textPath]) : new TextDecoder().decode(bytes);
  const home = textPath?.includes("/") ? textPath.slice(0, textPath.lastIndexOf("/") + 1) : "";
  // A picture's path is read from where the book's text is; failing that, by its name alone.
  const byName = new Map<string, string>();
  for (const path of Object.keys(files)) byName.set(path.slice(path.lastIndexOf("/") + 1).toLowerCase(), path);
  const missing = new Set<string>();
  const unread = new Set<string>();
  const picture = (written: string): string | null => {
    let path: string;
    try {
      path = decodeURIComponent(written);
    } catch {
      path = written;
    }
    const clean = path.replace(/^\.\//, "");
    const found = files[home + clean] ? home + clean : files[clean] ? clean : byName.get(clean.slice(clean.lastIndexOf("/") + 1).toLowerCase());
    if (!found) {
      missing.add(written);
      return null;
    }
    const mime = PICTURE_TYPES[(/\.([a-z]+)$/i.exec(found)?.[1] ?? "").toLowerCase()];
    if (!mime) {
      unread.add(written);
      return null;
    }
    return dataUrl(files[found], mime);
  };

  const { details, rest } = splitDetails(text);
  // Each mark on a line of its own, so it's never run into a paragraph.
  const marked = pagesForPictures(rest)
    .split("\n")
    .map((l) => (PAGE_START.test(l) ? `\n${l.trim()}\n` : l))
    .join("\n");
  const html = markdownToHtml(marked, picture);
  const warnings: ImportWarning[] = [
    ...[...missing].map((p) => ({ kind: "images" as const, message: `The picture “${p}” wasn't found, so it was left out. Put it in the pictures folder beside book.md.` })),
    ...[...unread].map((p) => ({ kind: "images" as const, message: `“${p}” isn't a picture Quire can show (PNG, JPEG, GIF or WebP), so it was left out.` })),
  ];
  const fallback = (textPath ?? name).replace(/^.*\//, "").replace(/\.[^.]+$/, "").replace(/_+/g, " ").trim();
  return {
    title: details.title || (fallback && !/^book$/i.test(fallback) ? fallback : "Untitled"),
    author: details.author || null,
    subtitle: details.subtitle || null,
    description: details.description || null,
    language: details.language || null,
    html,
    warnings,
  };
}

/** The ready-made example in Quire's guide: book.md, with a picture in a page and a picture page. */
export const EXAMPLE_BOOK = `Title: Night Lanterns
Subtitle: Poems of the Long Dark
Author: Your Name

=== Dedication ===
For the lamplighters.

=== Section: We Begin with Night ===

=== Chapter: The Long Night ===
The first lamp was lit at the edge of the valley, where the road bends toward the river.

Write in Markdown: *italic*, **bold**, and a footnote.[^1]

![A lamp at dusk](pictures/lamp.png)

[^1]: A footnote's words go on a line of their own, anywhere in the book.

=== Poem: Lanterns ===
One light, and then another,
down the long road home.

=== Picture page: pictures/lamp.png ===
The valley, as the lamplighters knew it.

=== End section ===

=== About the Author ===
A line or two about you.
`;

/** The example as a zip, named .tbv, with the picture given. */
export function exampleBook(picture: Uint8Array): Uint8Array {
  return bundle([
    { path: "Night Lanterns/book.md", bytes: new TextEncoder().encode(EXAMPLE_BOOK) },
    { path: "Night Lanterns/pictures/lamp.png", bytes: picture },
  ]);
}

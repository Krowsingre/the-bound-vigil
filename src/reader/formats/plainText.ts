// Plain text (TXT files, and the text of old Word documents) laid out as a
// book: paragraphs, and chapters wherever a line looks like a chapter heading.

import { escapeHtml, type Chapter } from "./htmlBook";

const HEADING =
  /^(chapter|book|part|volume|prologue|epilogue|preface|foreword|introduction|afterword|appendix|act|scene|letter|canto)\b.{0,60}$|^(?=[IVXLCDM]+\.?$)[IVXLCDM]{1,8}\.?$|^\d{1,3}\.?$/i;

/** A line that starts a chapter: "Chapter 4", "BOOK II. THE GOLDEN THREAD", "XIV". */
export function isHeading(line: string): boolean {
  const text = line.trim();
  if (!text || text.length > 80 || !HEADING.test(text)) return false;
  // "Chapter and verse, he said." is a sentence, not a heading.
  if (/[,;:!?]["”’)]?$/.test(text)) return false;
  return !(text.endsWith(".") && text.split(/\s+/).length > 4);
}

/** Chapters without headings are split up so no page-engine section is huge. */
const MAX_CHAPTER_CHARS = 60_000;

/**
 * Reads text as paragraphs. In most text files paragraphs are separated by a
 * blank line and lines inside them are wrapped at a fixed width; some files
 * (and Word's text) use one line per paragraph instead.
 */
export function paragraphsOf(text: string, linesAreParagraphs = false): string[][] {
  const lines = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split("\n");
  const blanks = lines.filter((l) => !l.trim()).length;
  const byBlankLines = !linesAreParagraphs && blanks > lines.length / 20;
  if (!byBlankLines) return lines.filter((l) => l.trim()).map((l) => [l.trim()]);
  const paragraphs: string[][] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (line.trim()) current.push(line.trimEnd());
    else if (current.length) {
      paragraphs.push(current);
      current = [];
    }
  }
  if (current.length) paragraphs.push(current);
  return paragraphs;
}

function paragraphHtml(lines: string[]): string {
  // Short lines (verse, addresses, lists) keep their line breaks; wrapped
  // prose is joined back into one flowing paragraph.
  const average = lines.reduce((n, l) => n + l.length, 0) / lines.length;
  if (lines.length > 1 && average < 50) {
    return `<div class="verse">${lines.map((l) => `<p>${escapeHtml(l.trim())}</p>`).join("")}</div>`;
  }
  return `<p>${escapeHtml(lines.map((l) => l.trim()).join(" "))}</p>`;
}

export function textToChapters(text: string, linesAreParagraphs = false): Chapter[] {
  const chapters: Chapter[] = [];
  let title: string | null = null;
  let parts: string[] = [];
  let size = 0;
  const finish = () => {
    if (parts.length || title) chapters.push({ title, html: parts.join("\n") });
    parts = [];
    size = 0;
  };
  for (const paragraph of paragraphsOf(text, linesAreParagraphs)) {
    if (paragraph.length === 1 && isHeading(paragraph[0])) {
      finish();
      title = paragraph[0].trim();
      parts.push(`<h1>${escapeHtml(title)}</h1>`);
      continue;
    }
    if (size > MAX_CHAPTER_CHARS) {
      // A long stretch without headings carries on under the same title.
      finish();
    }
    const html = paragraphHtml(paragraph);
    parts.push(html);
    size += html.length;
  }
  finish();
  return chapters.length ? chapters : [{ title: null, html: "" }];
}

/** Text files are usually UTF-8; older ones are often Windows-1252. */
export function decodeText(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  if (view[0] === 0xff && view[1] === 0xfe) return new TextDecoder("utf-16le").decode(view);
  if (view[0] === 0xfe && view[1] === 0xff) return new TextDecoder("utf-16be").decode(view);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(view);
  } catch {
    return new TextDecoder("windows-1252").decode(view);
  }
}

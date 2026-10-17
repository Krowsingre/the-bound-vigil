// Word documents (DOCX), turned into chapters with their formatting kept:
// headings, bold and italic, lists, tables, pictures and footnotes.

import type { Chapter } from "./htmlBook";

const MAX_CHAPTER_CHARS = 60_000;

/** Splits converted HTML at its top headings, so each chapter is a section. */
export function htmlToChapters(html: string): Chapter[] {
  const body = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html").body;
  const children = Array.from(body.children);
  // The highest heading level used at least twice marks the chapters.
  const level = ["H1", "H2"].find((tag) => children.filter((c) => c.tagName === tag).length >= 2);
  const chapters: Chapter[] = [];
  let current: Chapter = { title: null, html: "" };
  const finish = () => {
    if (current.html.trim() || current.title) chapters.push(current);
  };
  for (const child of children) {
    if (child.tagName === level) {
      finish();
      current = { title: (child.textContent ?? "").trim() || null, html: "" };
    } else if (!level && current.html.length > MAX_CHAPTER_CHARS) {
      finish();
      current = { title: null, html: "" };
    }
    current.html += child.outerHTML;
  }
  finish();
  return chapters.length ? chapters : [{ title: null, html: "" }];
}

export async function wordDocumentChapters(bytes: ArrayBuffer): Promise<Chapter[]> {
  const mammoth = (await import("mammoth")).default;
  const { value } = await mammoth.convertToHtml({ arrayBuffer: bytes });
  return htmlToChapters(value);
}

// The book's look in the editor: the same export settings and book style that
// shape the EPUB, the preview and the PDF, written for the editor's page, so
// what's written looks like the book while it's written (embre, 18 November).

import { styleCss } from "./bookStyles";
import { bookOrder, type ExportSettings } from "./epub";
import { numberInWords, readPage } from "./pages";
import type { WritingChapter } from "../api/types";

/** Every rule here sits under this, so it shapes the editor's page and nothing else. */
const PAGE = ".writing-sheet.book-look";
/** A body chapter's page: the book style's headings, first letters and first lines are for these, as in the book. */
const CHAPTER = `${PAGE}.is-chapter`;

const FAMILY: Record<ExportSettings["font"], string | null> = { none: null, lora: `"Lora", serif`, crimson: `"Crimson Pro", serif`, echolume: `"Echolume", serif` };
const SCENE: Record<ExportSettings["sceneBreak"], string> = { asterisks: "* * *", ornament: "❦", space: " ", line: "" };

/** A book style's CSS (written for the book's pages), moved onto the editor's. */
export function styleForEditor(css: string): string {
  return css
    .split("}")
    .map((rule) => {
      const at = rule.indexOf("{");
      if (at < 0) return "";
      const selectors = rule
        .slice(0, at)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map(
          (s) =>
            `${CHAPTER} ${s
              .replace(/section\.chapter > h1::after/g, ".writing-chapter-head::after")
              .replace(/section\.chapter > h1/g, ".writing-chapter-title")
              .replace(/\.chapter-label/g, ".writing-chapter-label")
              .replace(/^h([23])\b/, ".writing-page h$1")}`,
        );
      return selectors.length ? `${selectors.join(", ")} {${rule.slice(at + 1)}}` : "";
    })
    .filter(Boolean)
    .join("\n");
}

/** The editor's stylesheet for a book with these settings. */
export function editorLookCss(settings: ExportSettings): string {
  const family = FAMILY[settings.font];
  const indent = settings.paragraphs === "indent";
  const scene = SCENE[settings.sceneBreak];
  return `${family ? `${PAGE} .writing-page, ${PAGE} .writing-chapter-title, ${PAGE} .writing-chapter-label { font-family: ${family}; }\n` : ""}${PAGE} .writing-chapter-head { margin: 0 0 1.6em; text-align: ${settings.titles}; }
${PAGE} .writing-chapter-title { margin: 0; font-size: 1.6em; font-weight: normal; text-align: ${settings.titles}; }
${PAGE} .writing-chapter-label { margin: 0 0 0.4em; color: var(--text); font-size: 0.85em; letter-spacing: 0.12em; text-transform: uppercase; text-align: ${settings.titles}; }
${["left", "center", "right"].map((t) => `${PAGE}.titles-${t} :is(.writing-chapter-head, .writing-chapter-title, .writing-chapter-label) { text-align: ${t}; }`).join("\n")}
${PAGE} .writing-page p { margin: ${indent ? "0" : "0 0 0.9em"}; text-indent: ${indent ? "1.5em" : "0"}; text-align: ${settings.align}; }
${PAGE} .writing-page > p:first-child, ${PAGE} .writing-page :is(h2, h3, hr, blockquote, ul, ol, figure, .writing-page-break) + p, ${PAGE} .writing-page p[style*="text-align: center"], ${PAGE} .writing-page p[style*="text-align: right"] { text-indent: 0; }
${PAGE} .writing-page hr::after { content: "${scene}"; white-space: pre; }
${
  settings.sceneBreak === "line"
    ? `${PAGE} .writing-page hr { width: 25%; border-top: 1px solid currentColor; }\n${PAGE} .writing-page hr::after { content: none; }\n`
    : ""
}${settings.dropCap ? `${CHAPTER} .writing-page > p:first-child::first-letter { float: left; font-size: 3.2em; line-height: 0.85; margin: 0.05em 0.08em 0 0; }\n` : ""}${
    settings.smallCaps ? `${CHAPTER} .writing-page > p:first-child::first-line { font-variant: small-caps; letter-spacing: 0.03em; }\n` : ""
  }${styleForEditor(styleCss(settings))}`;
}

/**
 * The line above each numbered chapter's title ("Chapter One", "1"), as the
 * book prints it: body chapters only, numbered from 1 again in each body
 * section unless they run on through the book. Empty when titles stand alone.
 */
export function chapterLabels(chapters: WritingChapter[], settings: ExportSettings): Map<string, string> {
  const labels = new Map<string, string>();
  let count = 0;
  for (const c of bookOrder(chapters, settings.freeOrder)) {
    const role = c.role ?? "chapter";
    if (role === "part") {
      if (settings.numbering === "restart") count = 0;
      continue;
    }
    if (role !== "chapter" || readPage(c.page, role).kind !== "chapter") continue;
    const n = ++count;
    const style = settings.chapterHeading;
    labels.set(c.id, style === "title" ? "" : style === "words" ? `Chapter ${numberInWords(n)}` : style === "numeral" ? String(n) : `Chapter ${n}`);
  }
  return labels;
}

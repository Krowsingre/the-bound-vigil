// A book written in Scribe as plain text, made from the same pages as the
// EPUB: titles in capitals, a blank line between paragraphs, scene breaks
// kept, and each chapter's notes after it. No cover or pictures.

import { bookSheets, type EpubInput } from "./epub";

/** Words inside an element, with line breaks kept and note marks as [1]. */
function inline(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? "").replace(/\s+/g, " ");
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  if (tag === "br") return "\n";
  if (tag === "img") return el.getAttribute("alt") ? `[Picture: ${el.getAttribute("alt")}]` : "";
  if (tag === "a" && el.getAttribute("epub:type") === "noteref") return `[${el.textContent ?? ""}]`;
  const inner = [...el.childNodes].map(inline).join("");
  if (tag === "sup" && el.querySelector("a")) return inner;
  return inner;
}

const clean = (text: string) =>
  text
    .split("\n")
    .map((line) => line.replace(/^ +| +$/g, ""))
    .join("\n")
    .trim();

/** Blocks of text in order, each a paragraph or a line of its own. */
function blocks(root: Element, out: string[], indent = "") {
  for (const node of root.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (node.textContent?.trim()) out.push(indent + clean(node.textContent));
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    const cls = el.getAttribute("class") ?? "";
    if (/^h[1-6]$/.test(tag)) {
      const text = clean(inline(el));
      if (text) out.push(indent + (tag === "h1" ? text.toUpperCase() : text));
    } else if (tag === "p") {
      if (cls.split(" ").includes("chapter-label")) out.push(indent + clean(inline(el)).toUpperCase());
      else if (cls.includes("scene")) out.push(clean(inline(el)) || "* * *");
      else if (cls.includes("blank")) continue;
      else {
        const text = clean(inline(el));
        if (text) out.push(indent + text.replace(/\n/g, `\n${indent}`));
      }
    } else if (tag === "hr") {
      out.push("* * *");
    } else if (tag === "div" && cls.includes("stanza")) {
      out.push(
        [...el.querySelectorAll("p")]
          .map((line) => {
            const left = /margin-left:\s*([\d.]+)em/.exec(line.getAttribute("style") ?? "");
            return indent + " ".repeat(left ? Math.round(Number(left[1]) * 2) : 0) + inline(line).replace(/ /g, " ").trimEnd();
          })
          .join("\n"),
      );
    } else if (tag === "blockquote") {
      blocks(el, out, indent + "    ");
    } else if (tag === "ul" || tag === "ol") {
      let n = 0;
      for (const li of el.children) {
        if (li.tagName.toLowerCase() !== "li") continue;
        n++;
        const nested = li.querySelector(":scope > ol, :scope > ul");
        const own = [...li.childNodes].filter((c) => c !== nested);
        const text = clean(own.map(inline).join(""));
        const mark = tag === "ol" && !cls.includes("contents") ? `${n}. ` : cls.includes("contents") || el.closest(".contents") ? "" : "• ";
        out.push(indent + mark + text);
        if (nested) blocks(li, out, indent + "    ");
      }
    } else if (tag === "pre") {
      out.push(el.textContent ?? "");
    } else if (tag === "aside" && el.getAttribute("epub:type") === "footnote") {
      out.push(indent + clean(inline(el)));
    } else if (tag === "section" && cls.includes("footnotes")) {
      out.push("Notes");
      blocks(el, out, indent);
    } else if (tag === "nav" && el.hasAttribute("hidden")) {
      continue;
    } else if (tag === "div" && cls.includes("pagebreak")) {
      continue;
    } else {
      blocks(el, out, indent);
    }
  }
}

/** The book as plain text (UTF-8). */
export function buildTxt(input: EpubInput): string {
  const { sheets } = bookSheets(input);
  const parts: string[] = [];
  for (const sheet of sheets) {
    if (sheet.cls.split(" ").includes("cover")) continue;
    const doc = new DOMParser().parseFromString(`<body>${sheet.html}</body>`, "text/html");
    const sections = doc.body.querySelectorAll(":scope > section");
    for (const section of sections.length ? [...sections] : [doc.body]) {
      const out: string[] = [];
      blocks(section, out);
      if (out.length) parts.push(out.join("\n\n"));
    }
  }
  return parts.join("\n\n\n") + "\n";
}

/** A file name for the book, with the given extension. */
export function bookFileName(title: string, extension: string): string {
  const name = title.replace(/[\\/:*?"<>|\u0000-\u001F]/g, " ").replace(/\s+/g, " ").trim().replace(/^\.+|\.+$/g, "").slice(0, 80);
  return `${name || "Book"}.${extension}`;
}

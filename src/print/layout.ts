// Lays a book's print HTML (see src/writing/printBook.ts) out as pages with
// Paged.js, in this page. Once the page count is known, the inside margin is
// checked against it, and the book laid out again if it needs a wider one.

import { Previewer } from "pagedjs";
import { gutterFor, printStyles, readPrint } from "../writing/printBook";

export async function layOut(html: string, onPage?: (n: number) => void): Promise<number> {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const book = doc.querySelector("style[data-book]")?.textContent ?? "";
  const meta = JSON.parse(doc.querySelector("meta[name='tbv-print']")?.getAttribute("content") ?? "{}") as { settings?: unknown; title?: string; gutter?: number };
  const settings = readPrint(meta.settings);
  const title = meta.title ?? "";
  document.title = title || "Print";
  document.documentElement.lang = doc.documentElement.lang || "en";
  const before = new Set(document.head.children);
  let print = doc.querySelector("style[data-print]")?.textContent ?? printStyles(settings, title, gutterFor(0));

  const run = async () => {
    const content = document.createElement("template");
    content.innerHTML = doc.body.innerHTML;
    const previewer = new Previewer();
    let pages = 0;
    previewer.on("page", () => onPage?.(++pages));
    const flow = await previewer.preview(content.content, [{ "book.css": book }, { "print.css": print }], document.body);
    return flow.total;
  };
  const clear = () => {
    for (const el of [...document.head.children]) if (!before.has(el)) el.remove();
    document.body.querySelectorAll(".pagedjs_pages").forEach((el) => el.remove());
  };

  let total = await run();
  // The gutter was a guess from the word count; with the real count, lay out again if it should be different.
  const wanted = gutterFor(total);
  if (settings.mirrored && wanted !== meta.gutter) {
    clear();
    print = printStyles(settings, title, wanted);
    total = await run();
  }
  return total;
}

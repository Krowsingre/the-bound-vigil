// Builds a book the page engine can show from plain HTML, for formats it
// doesn't read itself (plain text and Word documents). Each chapter becomes
// one page-engine section, the same shape foliate-js builds for FB2 books.

export interface Chapter {
  /** Shown in the contents. Null for text before the first heading. */
  title: string | null;
  /** The chapter's body, already escaped. */
  html: string;
}

export interface BookInfo {
  title?: string | null;
  author?: string | null;
  language?: string | null;
}

/** The parts of a foliate-js book that these formats provide. */
export interface HtmlBook {
  metadata: { title?: string; author?: string; language?: string };
  sections: { id: number; load: () => string; createDocument: () => Document; size: number; linear: "yes" }[];
  toc: { label: string; href: string; subitems: { label: string; href: string }[] | null }[];
  resolveHref: (href: string) => { index: number; anchor?: (doc: Document) => Element | null } | undefined;
  splitTOCHref: (href: string) => number[];
  getTOCFragment: (doc: Document, id: number) => Element | null;
  isExternal: (uri: string) => boolean;
  getCover: () => null;
  destroy: () => void;
}

const TOC_ID = "data-tbv-toc";

const STYLE = `
body { margin: 0; }
h1, h2, h3 { line-height: 1.25; margin: 1.6em 0 0.8em; }
h1 { font-size: 1.6em; text-align: center; }
h2 { font-size: 1.3em; }
p { margin: 0; text-indent: 1.4em; }
h1 + p, h2 + p, h3 + p, p.first, .verse p { text-indent: 0; }
.blank + p { text-indent: 0; }
.verse { margin: 0.8em 0; }
.verse p { margin: 0; }
img { max-width: 100%; height: auto; }
table { border-collapse: collapse; margin: 1em 0; }
td, th { border: 1px solid currentColor; padding: 0.25em 0.5em; vertical-align: top; }
`;

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

export function makeHtmlBook(info: BookInfo, chapters: Chapter[]): HtmlBook {
  const lang = info.language || "en";
  const urls: string[] = [];
  const idMap = new Map<string, number>();
  const toc: HtmlBook["toc"] = [];
  const parser = new DOMParser();

  const sections = chapters.map((chapter, index) => {
    // Headings inside a chapter become entries under it in the contents.
    const body = parser.parseFromString(`<body>${chapter.html}</body>`, "text/html").body;
    const subitems = Array.from(body.querySelectorAll("h2, h3"), (h, n) => {
      h.setAttribute(TOC_ID, String(n));
      return { label: (h.textContent ?? "").trim(), href: `${index}#${n}` };
    }).filter((s) => s.label);
    for (const el of body.querySelectorAll("[id]")) idMap.set(el.id, index);
    const label = chapter.title ?? (index === 0 ? info.title || "Beginning" : `Part ${index + 1}`);
    toc.push({ label, href: String(index), subitems: subitems.length ? subitems : null });

    const doc = `<!DOCTYPE html><html lang="${escapeHtml(lang)}"><head><meta charset="utf-8"><title>${escapeHtml(label)}</title><style>${STYLE}</style></head><body>${body.innerHTML}</body></html>`;
    const blob = new Blob([doc], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    urls.push(url);
    // Size is what the reader reads: the chapter's own text and markup, not
    // the page's styles, and not picture data stored inside the text.
    const pictureBytes = Array.from(body.querySelectorAll("img[src^='data:']"), (i) => i.getAttribute("src")!.length).reduce((a, b) => a + b, 0);
    const size = new Blob([body.innerHTML]).size - pictureBytes;
    return {
      id: index,
      load: () => url,
      createDocument: () => parser.parseFromString(doc, "text/html"),
      size: Math.max(1, size),
      linear: "yes" as const,
    };
  });

  return {
    metadata: { title: info.title ?? undefined, author: info.author ?? undefined, language: lang },
    sections,
    toc,
    resolveHref: (href) => {
      const [a, b] = href.split("#");
      if (a) return { index: Number(a), anchor: b ? (doc) => doc.querySelector(`[${TOC_ID}="${b}"]`) : undefined };
      const index = idMap.get(b);
      return index === undefined ? undefined : { index, anchor: (doc) => doc.getElementById(b) };
    },
    splitTOCHref: (href) => href?.split("#").map(Number) ?? [],
    getTOCFragment: (doc, id) => doc.querySelector(`[${TOC_ID}="${id}"]`),
    isExternal: (uri) => /^\w+:/i.test(uri),
    getCover: () => null,
    destroy: () => urls.forEach((u) => URL.revokeObjectURL(u)),
  };
}

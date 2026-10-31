// Turning a manuscript into a Scribe book: what kind of file it is (before
// anything is made), then the book's sections sorted into Front, Body and
// Back with what each one is, and a report of anything to check. The words
// themselves are never rewritten, reordered or added to: when it's unclear
// what a section is, it stays where the file had it and is flagged.

import { strFromU8, unzipSync } from "fflate";
import { IMPORT_ACCEPT, readDocumentBytes, splitChapters, type ImportedDocument, type SplitAt } from "./importDoc";
import { KINDS, type Area, type PageKind } from "./pages";

/** What a chosen file turned out to be. */
export interface Inspection {
  /** docx, odt, rtf, txt, md, html, epub, kindle_create, kpf, pdf… */
  format: string;
  label: string;
  /** Scribe can rebuild a book from it. */
  supported: boolean;
  /** Why not, and what to do instead, in plain words. */
  reason?: string;
}

export const MANUSCRIPT_ACCEPT = `${IMPORT_ACCEPT},.zip,.kcb,.kpf,.pdf`;

const LABELS: Record<string, string> = {
  docx: "Word document",
  odt: "OpenDocument text",
  rtf: "Rich Text",
  txt: "Plain text",
  md: "Markdown",
  markdown: "Markdown",
  html: "Web page",
  htm: "Web page",
  xhtml: "Web page",
  epub: "EPUB",
};

const extensionOf = (name: string) => /\.([^.]+)$/.exec(name)?.[1]?.toLowerCase() ?? "";

/** Looks at a file without making anything: its kind, and whether Scribe can rebuild a book from it. */
export function inspect(name: string, bytes: Uint8Array): Inspection {
  const ext = extensionOf(name);
  if (LABELS[ext]) return { format: ext === "markdown" ? "md" : ext === "htm" ? "html" : ext, label: LABELS[ext], supported: true };
  if (ext === "pdf")
    return { format: "pdf", label: "PDF", supported: false, reason: "Rebuilding a book from a PDF comes in a later update. If you have the Word or EPUB file the PDF was made from, import that instead." };
  if (ext === "kcb")
    return {
      format: "kindle_create",
      label: "Kindle Create project",
      supported: false,
      reason: "A .kcb file is only the cover sheet of a Kindle Create project; the book is in the folder beside it. Zip the whole project folder and choose the zip.",
    };
  if (ext === "kpf" || ext === "zip") {
    const names: string[] = [];
    try {
      unzipSync(bytes, {
        filter: (f) => {
          names.push(f.name);
          return false;
        },
      });
    } catch {
      return { format: ext, label: ext === "kpf" ? "Kindle package" : "Zip file", supported: false, reason: "That file couldn't be opened." };
    }
    const kindle = names.some((n) => /(^|\/)book\.kcb$/i.test(n) || /(^|\/)book\.kdf$/i.test(n) || /(^|\/)resources\/ManifestFile$/i.test(n));
    if (ext === "kpf" || kindle) {
      const fixed = kindle && fixedLayout(bytes, names);
      return {
        format: kindle ? "kindle_create" : "kpf",
        label: kindle ? "Kindle Create project" : "Kindle package",
        supported: false,
        reason: fixed
          ? "This Kindle Create project was made from a PDF, so its words are inside that PDF. Importing it comes with PDF import, in a later update."
          : "Rebuilding a book from Kindle Create comes in a later update. Until then, import the Word file the project was made from.",
      };
    }
    return { format: "zip", label: "Zip file", supported: false, reason: "Choose the manuscript itself: Word, OpenDocument, RTF, text, Markdown, HTML or EPUB." };
  }
  return { format: ext || "unknown", label: ext ? `.${ext} file` : "File", supported: false, reason: "Scribe can rebuild a book from Word, OpenDocument, RTF, plain text, Markdown, HTML and EPUB files." };
}

/** A Kindle Create project made from a PDF keeps it in resources/res. */
function fixedLayout(bytes: Uint8Array, names: string[]): boolean {
  try {
    const kcb = names.find((n) => /(^|\/)book\.kcb$/i.test(n));
    if (kcb) {
      const read = unzipSync(bytes, { filter: (f) => f.name === kcb })[kcb];
      if (read && /"book_input_type"\s*:\s*1\b/.test(strFromU8(read))) return true;
    }
    const resources = unzipSync(bytes, { filter: (f) => /resources\/res\//.test(f.name) && f.originalSize > 4 });
    return Object.values(resources).some((b) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46);
  } catch {
    return false;
  }
}

/** One section of the book as Scribe will make it. */
export interface ManuscriptSection {
  title: string;
  body: string;
  words: number;
  area: Area;
  kind: PageKind;
  /** Whether the sorting is certain. Unsure ones are flagged for checking. */
  sure: boolean;
  /** Why it was sorted as it was, when that's worth saying. */
  why?: string;
  /** Brought into the book. */
  include: boolean;
  /** Its words are the person's own copyright page, kept as written. */
  byHand?: boolean;
}

export type IssueKind = "classification" | "boundary" | "empty" | "images" | "formatting" | "poetry" | "text" | "breaks";

export interface ManuscriptIssue {
  kind: IssueKind;
  /** The section it's about, by its place in the list, or null for the whole book. */
  section: number | null;
  message: string;
}

export interface Manuscript {
  title: string;
  author: string | null;
  description: string | null;
  language: string | null;
  isbn: string | null;
  sections: ManuscriptSection[];
  issues: ManuscriptIssue[];
}

/** Section titles, and what each kind of page is called. Checked in order. */
const TITLES: [RegExp, PageKind][] = [
  [/^(table of )?contents$/i, "contents"],
  [/^copyright( page)?$/i, "copyright"],
  [/^dedication$/i, "dedication"],
  [/^epigraph$/i, "epigraph"],
  [/^title page$/i, "title_page"],
  [/^half[- ]title$/i, "half_title"],
  [/^foreword\b/i, "foreword"],
  [/^preface\b/i, "preface"],
  [/^introduction\b/i, "introduction"],
  [/^prologue\b/i, "prologue"],
  [/^epilogue\b/i, "epilogue"],
  [/^interlude\b/i, "interlude"],
  [/^afterword\b/i, "afterword"],
  [/^acknowledg(e)?ments?$/i, "acknowledgments"],
  [/^about the author$/i, "about_author"],
  [/^(also by\b|other books by\b|books by\b)/i, "also_by"],
  [/^(end ?notes|notes)$/i, "endnotes"],
  [/^glossary$/i, "glossary"],
  [/^appendi(x|ces)\b/i, "appendix"],
  [/^(bibliography|references|works cited|further reading)$/i, "bibliography"],
  [/^(discussion questions|reading group guide|book club questions)$/i, "discussion"],
  [/^(excerpt|a sneak peek|sneak peek|preview)\b/i, "excerpt"],
];

/** epub:type words, and the kind each means. */
const EPUB_TYPES: [RegExp, PageKind | "front" | "body" | "back"][] = [
  [/\btoc\b/, "contents"],
  [/\bcopyright-page\b/, "copyright"],
  [/\bdedication\b/, "dedication"],
  [/\bepigraph\b/, "epigraph"],
  [/\btitlepage\b/, "title_page"],
  [/\bhalftitlepage\b/, "half_title"],
  [/\bforeword\b/, "foreword"],
  [/\bpreface\b/, "preface"],
  [/\bintroduction\b/, "introduction"],
  [/\bprologue\b/, "prologue"],
  [/\bepilogue\b/, "epilogue"],
  [/\bafterword\b/, "afterword"],
  [/\backnowledgments\b/, "acknowledgments"],
  [/\bcontributors\b|\babout-author\b/, "about_author"],
  [/\bendnotes\b|\bfootnotes\b/, "endnotes"],
  [/\bglossary\b/, "glossary"],
  [/\bappendix\b/, "appendix"],
  [/\bbibliography\b/, "bibliography"],
  [/\bfrontmatter\b/, "front"],
  [/\bbodymatter\b/, "body"],
  [/\bbackmatter\b/, "back"],
];

const BODY_KINDS: PageKind[] = ["chapter", "prologue", "epilogue", "interlude", "poem", "haiku"];

/** Which area a kind of page goes in, when it can only go in one. */
const areaOf = (kind: PageKind): Area | null => {
  // A prologue or epilogue is part of the story (embre, 31 October 2026).
  if (kind === "prologue" || kind === "epilogue") return "chapter";
  const areas = KINDS[kind].areas;
  return areas.length === 1 ? areas[0] : null;
};

const ORDER: Record<Area, number> = { front: 0, chapter: 1, back: 2 };

/** Short lines in most paragraphs, or lines broken inside paragraphs: set out like a poem. */
export function looksLikePoem(body: string): boolean {
  const doc = new DOMParser().parseFromString(`<body>${body}</body>`, "text/html");
  const paragraphs = [...doc.body.querySelectorAll("p:not([data-blank])")];
  if (paragraphs.length < 3 && !paragraphs.some((p) => p.querySelector("br"))) return false;
  const lines = paragraphs.flatMap((p) => p.innerHTML.split(/<br\s*\/?>/i).map((l) => l.replace(/<[^>]+>/g, "").trim()));
  if (lines.length < 4) return false;
  const short = lines.filter((l) => l.length > 0 && l.length <= 60).length;
  const ends = lines.filter((l) => /[.!?]["'”’]?$/.test(l)).length;
  return short / lines.length >= 0.8 && ends / lines.length < 0.6;
}

/** A poem's lines as Scribe keeps them: a paragraph per stanza, a line break per line. Empty paragraphs part stanzas. */
export function asPoem(body: string): string {
  const doc = new DOMParser().parseFromString(`<body>${body}</body>`, "text/html");
  const out: string[] = [];
  let stanza: string[] = [];
  const end = () => {
    if (stanza.length) out.push(`<p>${stanza.join("<br>")}</p>`);
    stanza = [];
  };
  for (const node of [...doc.body.childNodes]) {
    if (!(node instanceof HTMLElement)) {
      if (node.textContent?.trim()) stanza.push(node.textContent);
      continue;
    }
    if (node.tagName === "P" && node.hasAttribute("data-blank")) end();
    else if (node.tagName === "P" && /<br\s*\/?>/i.test(node.innerHTML)) {
      // Already a stanza, its lines broken as written.
      end();
      out.push(`<p>${node.innerHTML}</p>`);
    } else if (node.tagName === "P") stanza.push(node.innerHTML);
    else {
      end();
      out.push(node.outerHTML);
    }
  }
  end();
  return out.join("");
}

/** Empty paragraphs in prose: dropped where the file puts one between every paragraph (spacing), else kept as breaks. */
function settleBlanks(body: string, spacing: boolean): { body: string; breaks: number } {
  const doc = new DOMParser().parseFromString(`<body>${body}</body>`, "text/html");
  let breaks = 0;
  const blanks = [...doc.body.querySelectorAll("p[data-blank]")];
  for (const p of blanks) {
    const prev = p.previousElementSibling;
    const first = !prev;
    const last = ![...doc.body.children].slice([...doc.body.children].indexOf(p) + 1).some((el) => !el.hasAttribute("data-blank"));
    if (spacing || first || last || prev?.tagName === "HR" || prev?.hasAttribute("data-blank")) p.remove();
    else {
      p.replaceWith(doc.createElement("hr"));
      breaks++;
    }
  }
  return { body: doc.body.innerHTML, breaks };
}

const textWords = (html: string) =>
  (new DOMParser().parseFromString(`<body>${html}</body>`, "text/html").body.textContent ?? "").split(/\s+/).filter((w) => /\w/.test(w)).length;

/** The kind a section's title, the file's own label, and its words point to. */
function sortSection(title: string, body: string, hint: string | undefined, index: number, bookTitle: string): { kind: PageKind; area: Area | null; sure: boolean; why?: string; byHand?: boolean; include?: boolean } {
  const t = title.replace(/[.:]+$/, "").trim();
  for (const [re, kind] of TITLES) if (re.test(t)) return { kind, area: areaOf(kind), sure: true };
  if (hint) {
    for (const [re, said] of EPUB_TYPES) {
      if (!re.test(hint)) continue;
      if (said === "front" || said === "back") return { kind: "custom", area: said, sure: true, why: "The file marks it as " + (said === "front" ? "front matter." : "back matter.") };
      if (said === "body") return { kind: "chapter", area: "chapter", sure: true };
      return { kind: said, area: areaOf(said), sure: true };
    }
  }
  if (/^(chapter|book|canto|letter|act|scene)\b|^(\d{1,3}|[IVXLC]{1,7})\.?$/i.test(t) || /^part\b/i.test(t)) return { kind: "chapter", area: "chapter", sure: true };
  const words = textWords(body);
  const text = new DOMParser().parseFromString(`<body>${body}</body>`, "text/html").body.textContent ?? "";
  if (index === 0) {
    if (/©|\bcopyright\b|all rights reserved/i.test(text) && words < 400)
      return { kind: "copyright", area: "front", sure: false, byHand: true, why: "Its words look like a copyright page, so they're kept as written." };
    if (words < 80 && (bookTitle && text.toLowerCase().includes(bookTitle.toLowerCase())))
      return { kind: "title_page", area: "front", sure: false, include: false, why: "Looks like a title page. Scribe makes one from the book's details, so it's left out unless you tick it." };
    if (t === "Opening") return { kind: "custom", area: "front", sure: false, why: "The words before the first chapter. Check whether they belong in the front matter or the story." };
  }
  if (/©|\ball rights reserved\b/i.test(text) && words < 400) return { kind: "copyright", area: "front", sure: false, byHand: true, why: "Its words look like a copyright page." };
  if (/^for\b/i.test(text.trim()) && words < 40) return { kind: "dedication", area: "front", sure: false, why: "Short and starting with “For”, like a dedication." };
  if (looksLikePoem(body)) return { kind: "poem", area: null, sure: false, why: "Set out like a poem, so its lines are kept as written." };
  return { kind: "chapter", area: "chapter", sure: true };
}

/** The whole manuscript, sorted, with the report of what to check. */
export function buildManuscript(doc: ImportedDocument, at: SplitAt): Manuscript {
  const chapters = splitChapters(doc.html, at, doc.title, true);
  const sourceDoc = new DOMParser().parseFromString(`<body>${doc.html}</body>`, "text/html");
  const sourcePictures = sourceDoc.body.querySelectorAll("img").length;
  const issues: ManuscriptIssue[] = [];

  // Blank lines between nearly every paragraph are only spacing.
  const all = new DOMParser().parseFromString(`<body>${chapters.map((c) => c.body).join("")}</body>`, "text/html").body;
  const blanks = all.querySelectorAll("p[data-blank]").length;
  const paragraphs = all.querySelectorAll("p:not([data-blank])").length;
  const spacing = blanks > paragraphs * 0.3;

  let reached: Area = "front";
  let breaks = 0;
  const sections: ManuscriptSection[] = chapters.map((c, i) => {
    const sorted = sortSection(c.title, c.body, c.hint, i, doc.title);
    // A kind that fits more than one area takes the one the book is in by now.
    let area: Area = sorted.area ?? (ORDER[reached] > 0 ? reached : sorted.kind === "poem" ? "chapter" : "front");
    let why = sorted.why;
    let sure = sorted.sure;
    let kind = sorted.kind;
    if (ORDER[area] < ORDER[reached]) {
      // Never moved out of order: it stays where the file has it, as a page of its own.
      why = `Looks like ${KINDS[kind].label.toLowerCase()}, but comes after ${reached === "chapter" ? "the chapters had begun" : "the back matter had begun"}, so it's kept where it is.`;
      area = reached;
      kind = KINDS[kind].areas.includes(reached) ? kind : "custom";
      sure = false;
    }
    if (!BODY_KINDS.includes(kind) && area === "chapter" && kind !== "custom") kind = "custom";
    reached = area;
    let body = c.body;
    if (kind === "poem") body = asPoem(body);
    else {
      const settled = settleBlanks(body, spacing);
      body = settled.body;
      breaks += settled.breaks;
    }
    return { title: kind === "poem" && c.title === "Untitled" ? "" : c.title, body, words: c.words, area, kind, sure, ...(why ? { why } : {}), include: sorted.include ?? true, ...(sorted.byHand ? { byHand: true } : {}) };
  });

  sections.forEach((s, i) => {
    if (!s.sure) issues.push({ kind: "classification", section: i, message: s.why ?? `Check that “${s.title || "this section"}” is in the right place.` });
    if ((s.title === "Untitled" || !s.title) && s.kind !== "poem") issues.push({ kind: "boundary", section: i, message: "No heading was found here. Check where this section starts and what it's called." });
    if (!s.words && !/<img/i.test(s.body)) issues.push({ kind: "empty", section: i, message: "This section has no words." });
    if (s.kind === "poem") issues.push({ kind: "poetry", section: i, message: "Check the poem's line breaks, stanzas and indents against the original." });
  });
  const kept = sections.reduce((n, s) => n + (s.body.match(/<img/gi)?.length ?? 0), 0);
  if (kept < sourcePictures) issues.push({ kind: "images", section: null, message: `${sourcePictures - kept} of the file's ${sourcePictures} pictures couldn't be brought in.` });
  if (sourceDoc.body.querySelector("table")) issues.push({ kind: "formatting", section: null, message: "The file has tables. Scribe doesn't hold tables, so their words became plain paragraphs." });
  const before = textWords(doc.html);
  const after = sections.reduce((n, s) => n + textWords(s.body.replace(/<sup[^>]*data-footnote="([^"]*)"[^>]*>.*?<\/sup>/g, " $1 ")), 0) + sections.reduce((n, s) => n + textWords(s.title), 0);
  if (before > 0 && after < before * 0.98)
    issues.push({ kind: "text", section: null, message: `About ${(before - after).toLocaleString()} words in the file weren't recognised. Compare the book with the original before publishing.` });
  if (breaks) issues.push({ kind: "breaks", section: null, message: `${breaks} blank ${breaks === 1 ? "line was" : "lines were"} kept as ${breaks === 1 ? "a scene break" : "scene breaks"}.` });

  return { title: doc.title, author: doc.author, description: doc.description, language: doc.language ?? null, isbn: doc.isbn ?? null, sections, issues };
}

/** Reads a supported file into a manuscript. */
export async function readManuscript(name: string, bytes: Uint8Array, at?: SplitAt): Promise<{ doc: ImportedDocument; manuscript: Manuscript }> {
  const doc = await readDocumentBytes(name, bytes);
  const { bestSplit } = await import("./importDoc");
  return { doc, manuscript: buildManuscript(doc, at ?? bestSplit(doc.html)) };
}

// The check before uploading: the EPUB's pages and links, the book's details
// and cover, and each store's own rules, with every problem said in plain
// words before a store turns the book away.

import { pictureSize } from "./docx";
import { epubFiles, type EpubInput } from "./epub";
import { imageMime } from "./fonts";
import { TRIMS, type TrimSize } from "./printSettings";

export type Store = "kdp" | "apple" | "kobo" | "bn" | "google" | "kdpPrint" | "ingram";

export const STORES: { value: Store; label: string; print: boolean }[] = [
  { value: "kdp", label: "Kindle", print: false },
  { value: "apple", label: "Apple Books", print: false },
  { value: "kobo", label: "Kobo", print: false },
  { value: "bn", label: "Barnes & Noble", print: false },
  { value: "google", label: "Google Play", print: false },
  { value: "kdpPrint", label: "KDP paperback", print: true },
  { value: "ingram", label: "IngramSpark", print: true },
];

export interface Finding {
  /** problem: the store will turn it away. warning: worth fixing. ok: checked and fine. */
  level: "problem" | "warning" | "ok";
  title: string;
  detail: string;
  /** The stores it matters to; none means all of them. */
  stores?: Store[];
  /** The pages it was found on. */
  where?: string[];
}

export interface PreflightInput {
  book: EpubInput;
  stores: Store[];
  /** The print PDF's page count and trim, when it's been made. */
  print?: { pages: number | null; trim: TrimSize } | null;
}

const ebook = (stores: Store[]) => stores.filter((s) => !STORES.find((x) => x.value === s)!.print);
const has = (stores: Store[], ...any: Store[]) => any.filter((s) => stores.includes(s));
const names = (stores: Store[]) => stores.map((s) => STORES.find((x) => x.value === s)!.label).join(", ");

/** A valid ISBN-10 or ISBN-13 (its check digit agrees). */
export function isbnValid(text: string): boolean {
  const s = text.replace(/^isbn[:\s]*/i, "").replace(/[\s-]/g, "").toUpperCase();
  if (/^\d{13}$/.test(s)) {
    const sum = [...s].reduce((n, d, i) => n + Number(d) * (i % 2 ? 3 : 1), 0);
    return sum % 10 === 0;
  }
  if (/^\d{9}[\dX]$/.test(s)) {
    const sum = [...s].reduce((n, d, i) => n + (d === "X" ? 10 : Number(d)) * (10 - i), 0);
    return sum % 11 === 0;
  }
  return false;
}

/** Words writers leave as a reminder to finish something, which stores turn away. */
const PLACEHOLDER = /\blorem ipsum\b|\[(?:insert|add|todo|tbd)[^\]]*\]|\bTK\b|\bTODO\b|\bXXX\b/;

const textOf = (xhtml: string) =>
  xhtml
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

export function preflight({ book, stores, print }: PreflightInput): Finding[] {
  const out: Finding[] = [];
  const add = (f: Finding) => out.push(f);
  const files = new Map(epubFiles(book).files);
  const pages = [...files].filter(([path]) => path.endsWith(".xhtml") && !path.endsWith("nav.xhtml")) as [string, string][];
  const titleOf = (path: string) => {
    const xhtml = String(files.get(path) ?? "");
    return /<title>([^<]*)<\/title>/.exec(xhtml)?.[1]?.trim() || path.replace(/^OEBPS\//, "");
  };
  const { project } = book;
  const copyright = book.settings.copyright;
  const e = ebook(stores);

  // The book's details.
  if (!project.title.trim()) add({ level: "problem", title: "The book has no title", detail: "Every store needs one. Add it in Book details." });
  if (!project.author?.trim()) add({ level: "problem", title: "There's no author's name", detail: "Every store needs one. Add it in Book details." });
  if (!project.language?.trim()) add({ level: "warning", title: "The book's language isn't set", detail: "Stores and e-readers use it to choose the right dictionary and hyphenation. Add it in Book details." });
  const description = (project.description ?? "").trim();
  if (!description) add({ level: "warning", title: "There's no description", detail: "Stores ask for the words on the back of the book when you upload. Add them in Book details." });
  else if (description.length > 4000)
    add({ level: "problem", title: "The description is too long", detail: `It's ${description.length.toLocaleString()} characters; Kindle and Apple Books take up to 4,000.`, stores: has(stores, "kdp", "apple", "kdpPrint") });

  // ISBN.
  const isbn = copyright.isbn.trim();
  if (isbn && !isbnValid(isbn)) add({ level: "problem", title: "The ISBN isn't valid", detail: `${isbn} doesn't add up (its last digit is a check on the others). Copy it again from where you bought it.` });
  else if (!isbn) {
    const needs = has(stores, "ingram");
    if (needs.length) add({ level: "problem", title: "IngramSpark needs your own ISBN", detail: "Buy one (Bowker in the US, Nielsen in the UK) and add it on the Copyright page.", stores: needs });
    if (has(stores, "kdpPrint").length) add({ level: "ok", title: "No ISBN for the paperback", detail: "KDP gives you a free one when you upload; add it to the Copyright page afterwards.", stores: ["kdpPrint"] });
    if (e.length) add({ level: "ok", title: "No ISBN for the e-book", detail: "Kindle, Apple, Kobo, Barnes & Noble and Google don't need one for e-books.", stores: e });
  } else add({ level: "ok", title: "ISBN", detail: `${isbn} is valid.` });

  // Cover.
  if (e.length) {
    const cover = book.cover;
    const size = cover ? pictureSize(cover.bytes, cover.mime) : null;
    if (!cover) add({ level: "problem", title: "There's no cover", detail: "E-book stores need one. Make one in Book details › Make a cover, or add a picture.", stores: e });
    else if (size) {
      const tooSmall = has(e, "apple", "bn", "kobo").filter(() => size.width < 1400);
      if (size.width < 625 || size.height < 1000) add({ level: "problem", title: "The cover is too small", detail: `It's ${size.width} × ${size.height}. Stores ask for at least 1600 × 2560.`, stores: e });
      else if (tooSmall.length) add({ level: "problem", title: "The cover is too narrow", detail: `It's ${size.width} wide; ${names(tooSmall)} ask for at least 1400.`, stores: tooSmall });
      else if (size.height < 2560) add({ level: "warning", title: "The cover could be sharper", detail: `It's ${size.width} × ${size.height}. 1600 × 2560 looks best everywhere.`, stores: e });
      else add({ level: "ok", title: "Cover", detail: `${size.width} × ${size.height}.` });
      const ratio = size.height / size.width;
      if (Math.abs(ratio - 1.6) > 0.15) add({ level: "warning", title: "The cover's shape is unusual", detail: `Stores show covers 1.6 times as tall as they're wide; this one is ${ratio.toFixed(2)}, so it may be cropped or padded.`, stores: e });
      if (cover.bytes.length > 50 * 1024 * 1024) add({ level: "problem", title: "The cover's file is too big", detail: "Kindle takes covers up to 50 MB.", stores: has(e, "kdp") });
    }
  }

  // The pages themselves.
  const ids = new Map<string, Set<string>>();
  const broken: string[] = [];
  const duplicates: string[] = [];
  const empty: string[] = [];
  const placeholders: string[] = [];
  const noAlt: string[] = [];
  const long: string[] = [];
  for (const [path, xhtml] of pages) {
    const doc = new DOMParser().parseFromString(xhtml, "application/xhtml+xml");
    if (doc.getElementsByTagName("parsererror").length) broken.push(titleOf(path));
    const seen = new Set<string>();
    for (const m of xhtml.matchAll(/\sid="([^"]+)"/g)) {
      if (seen.has(m[1])) duplicates.push(titleOf(path));
      seen.add(m[1]);
    }
    ids.set(path, seen);
    const text = textOf(/<body[\s\S]*<\/body>/.exec(xhtml)?.[0] ?? "");
    if (/class="[^"]*\bchapter\b/.test(xhtml) && text.length < 2 && !/<img\b/.test(xhtml)) empty.push(titleOf(path));
    if (PLACEHOLDER.test(text)) placeholders.push(titleOf(path));
    if (/<img\b(?![^>]*\balt="[^"]+")[^>]*>/.test(xhtml)) noAlt.push(titleOf(path));
    if (xhtml.length > 300 * 1024) long.push(titleOf(path));
  }
  const unique = (list: string[]) => [...new Set(list)];
  if (broken.length) add({ level: "problem", title: "Some pages aren't well-formed", detail: "E-readers and stores refuse pages they can't read. Open these and remove any odd pasted formatting.", where: unique(broken) });
  if (duplicates.length) add({ level: "problem", title: "Some pages use a name twice", detail: "A link target appears twice on the page, which the EPUB rules forbid.", where: unique(duplicates) });

  // Links.
  const deadLinks: string[] = [];
  const oddLinks: string[] = [];
  const storeLinks = { amazon: [] as string[], others: [] as string[] };
  for (const [path, xhtml] of [...pages, ...([...files].filter(([p]) => p.endsWith("nav.xhtml")) as [string, string][])]) {
    const dir = path.slice(0, path.lastIndexOf("/") + 1);
    for (const m of xhtml.matchAll(/<a\b[^>]*\shref="([^"]*)"/g)) {
      const href = m[1].replace(/&amp;/g, "&");
      if (/^(https?:|mailto:)/i.test(href)) {
        if (/amazon\.|amzn\.|audible\./i.test(href)) storeLinks.amazon.push(titleOf(path));
        if (/apple\.com|kobo\.com|barnesandnoble\.com|play\.google\.com/i.test(href)) storeLinks.others.push(titleOf(path));
        continue;
      }
      if (/^[a-z][a-z0-9+.-]*:/i.test(href) || !href) {
        oddLinks.push(titleOf(path));
        continue;
      }
      const [file, anchor] = href.split("#");
      const target = file ? dir + file : path;
      if (!files.has(target) || (anchor && !ids.get(target)?.has(anchor))) deadLinks.push(titleOf(path));
    }
  }
  if (deadLinks.length) add({ level: "problem", title: "Some links lead nowhere", detail: "A link points at a page or place that isn't in the book. Edit or remove it.", where: unique(deadLinks) });
  if (oddLinks.length) add({ level: "warning", title: "Some links aren't web addresses", detail: "Links should start with https:// or mailto:. Others don't open on e-readers.", where: unique(oddLinks) });
  if (storeLinks.amazon.length && has(stores, "apple", "kobo", "bn", "google").length)
    add({
      level: "problem",
      title: "Links to Amazon",
      detail: "Apple Books turns away books that link to another store, and Kobo, Barnes & Noble and Google can too. Give each store its own copy of the links.",
      stores: has(stores, "apple", "kobo", "bn", "google"),
      where: unique(storeLinks.amazon),
    });
  if (storeLinks.others.length && has(stores, "kdp").length)
    add({ level: "warning", title: "Links to other stores", detail: "Amazon can refuse Kindle books that link to Apple, Kobo, Barnes & Noble or Google.", stores: ["kdp"], where: unique(storeLinks.others) });
  if (!deadLinks.length && !oddLinks.length) add({ level: "ok", title: "Links", detail: "Every link inside the book goes somewhere." });

  if (placeholders.length) add({ level: "problem", title: "Unfinished words", detail: "Lorem ipsum, TK, TODO, XXX or [insert …] were found. Stores turn away books that look unfinished.", where: unique(placeholders) });
  if (empty.length) add({ level: "warning", title: "Empty chapters", detail: "These have a title but no words. Readers and reviewers notice.", where: unique(empty) });
  if (noAlt.length) add({ level: "warning", title: "Pictures without a description", detail: "Screen readers read a picture's description aloud, and accessibility rules (such as the EU's) ask for one. Add it in the picture's menu.", where: unique(noAlt) });
  if (long.length) add({ level: "warning", title: "Very long pages", detail: "Some e-readers slow down on pages over 300 KB. Splitting the chapter helps.", where: unique(long) });

  // Pictures for print.
  if (print && has(stores, "kdpPrint", "ingram").length) {
    const t = TRIMS.find((x) => x.value === print.trim) ?? TRIMS[3];
    const textWidth = t.width - 1.35;
    const low: string[] = [];
    for (const [path, data] of files) {
      if (!(data instanceof Uint8Array) || !/OEBPS\/images\//.test(path) || /cover\./.test(path)) continue;
      const mime = imageMime(data);
      const size = mime ? pictureSize(data, mime) : null;
      if (!size) continue;
      const printed = Math.min(size.width / 96, textWidth);
      if (size.width / printed < 300) low.push(path.replace(/^OEBPS\/images\//, ""));
    }
    if (low.length) add({ level: "warning", title: "Pictures may print soft", detail: `Printers ask for 300 dots an inch; at ${t.label.split(" (")[0]} these have fewer. Use larger pictures for the paperback.`, stores: has(stores, "kdpPrint", "ingram"), where: low });
    if (print.pages) {
      if (print.pages < 24 && has(stores, "kdpPrint").length) add({ level: "problem", title: "Too few pages for a KDP paperback", detail: `It's ${print.pages} pages; KDP prints from 24.`, stores: ["kdpPrint"] });
      if (print.pages < 18 && has(stores, "ingram").length) add({ level: "problem", title: "Too few pages for IngramSpark", detail: `It's ${print.pages} pages; IngramSpark prints from 18.`, stores: ["ingram"] });
      if (print.pages > 828 && has(stores, "kdpPrint").length) add({ level: "problem", title: "Too many pages for a KDP paperback", detail: `It's ${print.pages} pages; KDP prints up to 828 (fewer on cream paper and larger trims).`, stores: ["kdpPrint"] });
      if (print.pages % 2) add({ level: "ok", title: "Page count", detail: `${print.pages} pages; printers add a blank last page to make it even.` });
    } else add({ level: "warning", title: "Make the print PDF first", detail: "The page count it gives is needed to check the paperback's length and the cover's spine.", stores: has(stores, "kdpPrint", "ingram") });
  }

  // Size.
  let bytes = 0;
  for (const data of files.values()) bytes += typeof data === "string" ? data.length : data.length;
  const mb = bytes / (1024 * 1024);
  if (mb > 650 && has(stores, "kdp").length) add({ level: "problem", title: "The book is too big for Kindle", detail: `About ${Math.round(mb)} MB; Kindle takes up to 650 MB.`, stores: ["kdp"] });
  else if (has(stores, "kdp").length && mb > 3)
    add({ level: "warning", title: "Kindle's delivery fee", detail: `The book is about ${mb.toFixed(1)} MB. On the 70% royalty, Amazon takes a delivery fee by size (about 15 cents a megabyte in the US), so smaller pictures earn you more.`, stores: ["kdp"] });

  add({ level: "ok", title: "Fonts", detail: "Every font inside the book is one TBV carries with permission to embed it." });
  return out;
}

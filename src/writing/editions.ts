// Store editions: one copy of the book for each store, with "Also by" and buy
// links pointing to that store. Stores turn away books that send readers to
// another store (Apple and Kobo especially), so in each edition every link
// to a book in your store-links list goes to that store's page for it, and
// any other link to a rival store keeps its words but loses the link.

export type Store = "amazon" | "apple" | "kobo" | "bn" | "google";

export const STORES: { id: Store; label: string; edition: string }[] = [
  { id: "amazon", label: "Amazon", edition: "Kindle" },
  { id: "apple", label: "Apple Books", edition: "Apple Books" },
  { id: "kobo", label: "Kobo", edition: "Kobo" },
  { id: "bn", label: "Barnes & Noble", edition: "Barnes & Noble" },
  { id: "google", label: "Google Play", edition: "Google Play" },
];

/** One book's page in each store, plus a link that suits every store (your own site, or a universal book link). */
export interface StoreBook {
  id: string;
  title: string;
  links: Partial<Record<Store | "everywhere", string>>;
}

const HOSTS: Record<Store, RegExp> = {
  amazon: /(^|\.)(amazon\.[a-z.]+|amzn\.(to|com|eu)|a\.co)$/,
  apple: /(^|\.)(books\.apple\.com|itunes\.apple\.com|apple\.co)$/,
  kobo: /(^|\.)(kobo\.com)$/,
  bn: /(^|\.)(barnesandnoble\.com|bn\.com)$/,
  google: /(^|\.)(play\.google\.com|books\.google\.[a-z.]+)$/,
};

/** Which store a link goes to, or null for anywhere else. */
export function storeOf(href: string): Store | null {
  let host: string;
  try {
    host = new URL(href).hostname.toLowerCase();
  } catch {
    return null;
  }
  return (Object.keys(HOSTS) as Store[]).find((s) => HOSTS[s].test(host)) ?? null;
}

/** A link with the differences that don't matter taken out, for matching. */
function same(href: string): string {
  return href
    .trim()
    .replace(/^https?:\/\/(www\.)?/i, "")
    .replace(/[/?#]+$/, "")
    .toLowerCase();
}

const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export function readStoreBooks(saved: unknown): StoreBook[] {
  if (!Array.isArray(saved)) return [];
  return saved
    .filter((b): b is Record<string, unknown> => !!b && typeof b === "object")
    .slice(0, 200)
    .map((b) => {
      const raw = (b.links && typeof b.links === "object" ? b.links : {}) as Record<string, unknown>;
      const links: StoreBook["links"] = {};
      for (const key of [...STORES.map((s) => s.id), "everywhere"] as const) {
        const link = text(raw[key], 600);
        if (/^https?:\/\//i.test(link)) links[key] = link;
      }
      return { id: text(b.id, 60) || crypto.randomUUID(), title: text(b.title, 300), links };
    });
}

/** Where a link to this book goes in the given store's edition, or null to keep only its words. */
export function linkFor(book: StoreBook, store: Store): string | null {
  return book.links[store] ?? book.links.everywhere ?? null;
}

export interface Retargeted {
  html: string;
  /** Links sent to this store's page for the book. */
  changed: number;
  /** Links to another store, kept as words only: the words of each. */
  unlinked: string[];
}

/**
 * The EPUB's XHTML for one store's edition: links to books in the list go to
 * this store's page for them, and links to rival stores keep only their words.
 */
export function retarget(html: string, store: Store, books: StoreBook[]): Retargeted {
  const known = new Map<string, StoreBook>();
  for (const b of books) for (const link of Object.values(b.links)) if (link) known.set(same(link), b);
  let changed = 0;
  const unlinked: string[] = [];
  const out = html.replace(/<a href="([^"]+)">([\s\S]*?)<\/a>/g, (whole, rawHref: string, inner: string) => {
    const href = rawHref.replace(/&amp;/g, "&");
    if (!/^https?:/i.test(href)) return whole;
    const book = known.get(same(href));
    if (book) {
      const to = linkFor(book, store);
      if (to && same(to) === same(href)) return whole;
      if (to) {
        changed++;
        return `<a href="${to.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}">${inner}</a>`;
      }
    }
    const rival = storeOf(href);
    if ((book || rival) && rival !== store) {
      unlinked.push(inner.replace(/<[^>]*>/g, "").trim() || href);
      return inner;
    }
    return whole;
  });
  return { html: out, changed, unlinked };
}

/** An "Also by" page made from the list: each book's title, linked (it's sent to the right store in each edition). */
export function alsoByHtml(books: StoreBook[], leaveOut: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return books
    .filter((b) => b.title && b.title.trim().toLowerCase() !== leaveOut.trim().toLowerCase())
    .map((b) => {
      const link = STORES.map((s) => b.links[s.id]).find(Boolean) ?? b.links.everywhere;
      return link ? `<p><a href="${esc(link)}">${esc(b.title)}</a></p>` : `<p>${esc(b.title)}</p>`;
    })
    .join("");
}

/** The file name of one store's edition. */
export function editionFileName(title: string, store: Store | null): string {
  const name = title.replace(/[\\/:*?"<>|\u0000-\u001F]/g, " ").replace(/\s+/g, " ").trim().replace(/^\.+|\.+$/g, "").slice(0, 70) || "Book";
  const edition = store ? STORES.find((s) => s.id === store)!.edition : null;
  return `${name}${edition ? ` (${edition})` : ""}.epub`;
}

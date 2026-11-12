// Store editions: one copy of the book for each store, with "Also by" and buy
// links pointing to that store. Stores turn away books that send readers to
// another store (Apple and Kobo especially), so in each edition every link
// to a book in your store-links list goes to that store's page for it, and
// any other link to a rival store keeps its words but loses the link.
export const STORES = [
    { id: "amazon", label: "Amazon", edition: "Kindle" },
    { id: "apple", label: "Apple Books", edition: "Apple Books" },
    { id: "kobo", label: "Kobo", edition: "Kobo" },
    { id: "bn", label: "Barnes & Noble", edition: "Barnes & Noble" },
    { id: "google", label: "Google Play", edition: "Google Play" },
];
const HOSTS = {
    amazon: /(^|\.)(amazon\.[a-z.]+|amzn\.(to|com|eu)|a\.co)$/,
    apple: /(^|\.)(books\.apple\.com|itunes\.apple\.com|apple\.co)$/,
    kobo: /(^|\.)(kobo\.com)$/,
    bn: /(^|\.)(barnesandnoble\.com|bn\.com)$/,
    google: /(^|\.)(play\.google\.com|books\.google\.[a-z.]+)$/,
};
/** Which store a link goes to, or null for anywhere else. */
export function storeOf(href) {
    let host;
    try {
        host = new URL(href).hostname.toLowerCase();
    }
    catch {
        return null;
    }
    return Object.keys(HOSTS).find((s) => HOSTS[s].test(host)) ?? null;
}
/** A link with the differences that don't matter taken out, for matching. */
function same(href) {
    return href
        .trim()
        .replace(/^https?:\/\/(www\.)?/i, "")
        .replace(/[/?#]+$/, "")
        .toLowerCase();
}
const text = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
export function readStoreBooks(saved) {
    if (!Array.isArray(saved))
        return [];
    return saved
        .filter((b) => !!b && typeof b === "object")
        .slice(0, 200)
        .map((b) => {
        const raw = (b.links && typeof b.links === "object" ? b.links : {});
        const links = {};
        for (const key of [...STORES.map((s) => s.id), "everywhere"]) {
            const link = text(raw[key], 600);
            if (/^https?:\/\//i.test(link))
                links[key] = link;
        }
        return { id: text(b.id, 60) || crypto.randomUUID(), title: text(b.title, 300), links };
    });
}
/** Where a link to this book goes in the given store's edition, or null to keep only its words. */
export function linkFor(book, store) {
    return book.links[store] ?? book.links.everywhere ?? null;
}
/**
 * The EPUB's XHTML for one store's edition: links to books in the list go to
 * this store's page for them, and links to rival stores keep only their words.
 */
export function retarget(html, store, books) {
    const known = new Map();
    for (const b of books)
        for (const link of Object.values(b.links))
            if (link)
                known.set(same(link), b);
    let changed = 0;
    const unlinked = [];
    const out = html.replace(/<a href="([^"]+)">([\s\S]*?)<\/a>/g, (whole, rawHref, inner) => {
        const href = rawHref.replace(/&amp;/g, "&");
        if (!/^https?:/i.test(href))
            return whole;
        const book = known.get(same(href));
        if (book) {
            const to = linkFor(book, store);
            if (to && same(to) === same(href))
                return whole;
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
export function alsoByHtml(books, leaveOut) {
    const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    return books
        .filter((b) => b.title && b.title.trim().toLowerCase() !== leaveOut.trim().toLowerCase())
        .map((b) => {
        const link = STORES.map((s) => b.links[s.id]).find(Boolean) ?? b.links.everywhere;
        return link ? `<p><a href="${esc(link)}">${esc(b.title)}</a></p>` : `<p>${esc(b.title)}</p>`;
    })
        .join("");
}
/** The file name of one store's edition. */
export function editionFileName(title, store) {
    const name = title.replace(/[\\/:*?"<>|\u0000-\u001F]/g, " ").replace(/\s+/g, " ").trim().replace(/^\.+|\.+$/g, "").slice(0, 70) || "Book";
    const edition = store ? STORES.find((s) => s.id === store).edition : null;
    return `${name}${edition ? ` (${edition})` : ""}.epub`;
}

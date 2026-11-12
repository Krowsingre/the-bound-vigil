// Discover's Reading List: pages saved from reader view as small EPUBs. The
// books themselves are in the library like any other; this remembers which
// ones came from Discover, newest first, kept on this device.
const KEY = "tbv.browser.reading";
const CHANGED = "tbv:browser-reading";
const MOST = 500;
export function readReadingList() {
    try {
        const saved = JSON.parse(localStorage.getItem(KEY) ?? "[]");
        if (!Array.isArray(saved))
            return [];
        return saved.filter((e) => !!e && typeof e.bookId === "string" && typeof e.title === "string" && typeof e.url === "string" && typeof e.at === "number");
    }
    catch {
        return [];
    }
}
function save(list) {
    try {
        localStorage.setItem(KEY, JSON.stringify(list.slice(0, MOST)));
    }
    catch {
        // Full or unavailable: kept as it was.
    }
    window.dispatchEvent(new CustomEvent(CHANGED));
}
export function onReadingList(listener) {
    window.addEventListener(CHANGED, listener);
    return () => window.removeEventListener(CHANGED, listener);
}
/** Adds a saved page at the top; the same book saved again moves up. */
export function addToReadingList(entry, now = Date.now()) {
    save([{ ...entry, at: now }, ...readReadingList().filter((e) => e.bookId !== entry.bookId)]);
}
export function removeFromReadingList(bookId) {
    save(readReadingList().filter((e) => e.bookId !== bookId));
}
/** The id the library gives a book made of these bytes. */
export async function bookIdOf(bytes) {
    const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    return `sha256:${Array.from(hash, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

// Discover's Reading List: pages saved from reader view as small EPUBs. The
// books themselves are in the library like any other; this remembers which
// ones came from Discover, newest first, kept on this device.

export interface ReadingEntry {
  /** The saved book's id: "sha256:" and the hash of its file, as the library names it. */
  bookId: string;
  title: string;
  /** The page it was saved from. */
  url: string;
  /** When, as milliseconds since 1970. */
  at: number;
}

const KEY = "tbv.browser.reading";
const CHANGED = "tbv:browser-reading";
const MOST = 500;

export function readReadingList(): ReadingEntry[] {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "[]") as unknown;
    if (!Array.isArray(saved)) return [];
    return saved.filter((e): e is ReadingEntry => !!e && typeof e.bookId === "string" && typeof e.title === "string" && typeof e.url === "string" && typeof e.at === "number");
  } catch {
    return [];
  }
}

function save(list: ReadingEntry[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MOST)));
  } catch {
    // Full or unavailable: kept as it was.
  }
  window.dispatchEvent(new CustomEvent(CHANGED));
}

export function onReadingList(listener: () => void): () => void {
  window.addEventListener(CHANGED, listener);
  return () => window.removeEventListener(CHANGED, listener);
}

/** Adds a saved page at the top; the same book saved again moves up. */
export function addToReadingList(entry: Omit<ReadingEntry, "at">, now = Date.now()) {
  save([{ ...entry, at: now }, ...readReadingList().filter((e) => e.bookId !== entry.bookId)]);
}

export function removeFromReadingList(bookId: string) {
  save(readReadingList().filter((e) => e.bookId !== bookId));
}

/** The id the library gives a book made of these bytes. */
export async function bookIdOf(bytes: Uint8Array): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
  return `sha256:${Array.from(hash, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

// The sample book in Scribe: John Milton's Paradise Lost (public domain),
// shipped as a .tbv file (public/samples, made by scripts/make-sample-book.ts).
// It is added once, the first time Scribe has no books at all on this device,
// and can be added again from the New menu. Its author is Milton, never the
// writer's own name.
import { bookFromTbv } from "./openTbv";
import { readTbv } from "./tbvFile";
export const SAMPLE_URL = "/samples/paradise-lost.tbv";
export const SAMPLE_TITLE = "Paradise Lost";
export const SAMPLE_AUTHOR = "John Milton";
const OFFERED_KEY = "tbv.scribe.sampleOffered";
/** Adds the sample book and returns its id. */
export async function addSampleBook() {
    const response = await fetch(SAMPLE_URL);
    if (!response.ok)
        throw new Error("The sample book couldn't be found.");
    const book = readTbv(new Uint8Array(await response.arrayBuffer()));
    return bookFromTbv(book, { title: book.title, author: book.author });
}
let adding = null;
/**
 * The first time Scribe shows no books, the sample is added (once per device,
 * and never when books are already there, such as ones synced from another
 * device). True when it was added.
 */
export function addSampleOnce(list) {
    if (list.length)
        return Promise.resolve(false);
    try {
        if (localStorage.getItem(OFFERED_KEY))
            return Promise.resolve(false);
        localStorage.setItem(OFFERED_KEY, "1");
    }
    catch {
        return Promise.resolve(false);
    }
    adding ??= addSampleBook().then(() => true, () => false);
    return adding;
}
/** The sample book, which isn't one of the writer's own. */
export const isSample = (p) => p.title === SAMPLE_TITLE && p.author === SAMPLE_AUTHOR;

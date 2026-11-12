// Lining up an ebook with its audiobook, in the background, on whichever
// devices have both. The work itself is done by the app (crates/tbv-core
// lineup.rs, with speech recognition on the device, src-tauri lining.rs):
// the audiobook is heard a piece at a time (half a minute, each overlapping
// the next by a few seconds so no word falls between them), each piece's
// words are matched to the book, and the piece is saved straight away. A
// piece syncs on its own, so the work can stop at any moment and carry on
// later, here or on another device. Here is what the reader needs: putting
// the pieces together, and the book's words, which only the reader can count.
//
// What's kept for a pair:
// - read_along.timing: a LineUp (below), the plan and how it ended;
// - read_along_pieces: one row per piece, its [ms, word] anchors.
//
// Until every piece is lined up, the book can be read and the audiobook
// played, but not followed together.
import { api, isApp } from "../api";
import { readerSource } from "../reader/formats";
import { rising, sectionText, wordsIn } from "./timing";
/** Each piece of the audiobook heard: Whisper hears half a minute at a time. */
export const PIECE_MS = 30_000;
/** How much each piece overlaps the next, so a word cut at the edge is heard whole in one of them. */
export const OVERLAP_MS = 3_000;
const STEP_MS = PIECE_MS - OVERLAP_MS;
export function readLineUp(json) {
    if (!json)
        return null;
    try {
        const l = JSON.parse(json);
        return l.version === 2 && Array.isArray(l.sections) && l.pieces > 0 ? l : null;
    }
    catch {
        return null;
    }
}
/** How many pieces an audiobook of `durationMs` makes. */
export function pieceCount(durationMs) {
    return Math.max(1, Math.ceil((durationMs - OVERLAP_MS) / STEP_MS));
}
/** Where piece `i` starts in the audiobook, and the stretch whose anchors it keeps (the overlap is shared out). */
export function pieceSpan(i, pieces) {
    const start = i * STEP_MS;
    return {
        start,
        keepFrom: i === 0 ? -Infinity : start + OVERLAP_MS / 2,
        keepTo: i === pieces - 1 ? Infinity : start + STEP_MS + OVERLAP_MS / 2,
    };
}
/** The pieces lined up so far, put together as timing the reader can follow. */
export function combine(lineUp, pieces) {
    const anchors = [];
    for (const [, json] of [...pieces].sort((a, b) => a[0] - b[0])) {
        try {
            for (const a of JSON.parse(json))
                if (Array.isArray(a) && a.length === 2)
                    anchors.push([a[0], a[1]]);
        }
        catch {
            /* an unreadable piece is lined up again */
        }
    }
    const heard = Math.min(lineUp.durationMs, pieces.length * STEP_MS + OVERLAP_MS);
    return { version: 1, sections: lineUp.sections, anchors: rising(anchors), heard, done: lineUp.done };
}
export function lineUpState(lineUp, pieces) {
    if (!lineUp)
        return { done: false, failed: null, fraction: 0 };
    return { done: lineUp.done, failed: lineUp.failed, fraction: lineUp.done ? 1 : Math.min(0.99, pieces / lineUp.pieces) };
}
/** A pair's timing for the reader: the line-up's state, and the timing once it's done. */
export async function loadLineUp(ebookId, audiobookId) {
    const lineUp = readLineUp(await api.readAlongTiming(ebookId, audiobookId));
    const pieces = lineUp ? await api.readAlongPieces(ebookId, audiobookId) : [];
    return { state: lineUpState(lineUp, pieces.length), timing: lineUp?.done ? combine(lineUp, pieces) : null };
}
let current = null;
const listeners = new Set();
/** A pair finished (or stopped) lining up, so readers showing it look again. */
const finished = new Set();
let paused = false;
export function liningUp() {
    return current;
}
export function onLiningUp(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}
export function onLinedUp(listener) {
    finished.add(listener);
    return () => finished.delete(listener);
}
/** The ebook's words, section by section, as the reader will count them. */
async function bookWords(ebookId) {
    const { book: about } = await api.bookDetails(ebookId);
    // Opened the way the reader opens it, so both count the same words.
    const blob = await api.readBookFile(ebookId);
    const source = await readerSource(new File([blob], `book.${about.format}`), about.format, ebookId, {
        title: about.title,
        author: about.authors.join(", "),
    });
    const { makeBook } = await import("../vendor/foliate-js/view.js");
    const book = source instanceof File ? await makeBook(source) : { ...source, destroy: undefined };
    const words = [];
    const sections = [];
    try {
        for (const section of book.sections) {
            const doc = await Promise.resolve(section.createDocument?.()).catch(() => null);
            const found = doc ? wordsIn(sectionText(doc).text) : [];
            for (const w of found)
                words.push(w.word);
            sections.push(found.length);
        }
    }
    finally {
        book.destroy?.();
    }
    return { words, sections, language: about.language ?? null };
}
/** Page pictures and PDFs have no flowing text to follow word by word. */
export const linesUp = (format) => !["pdf", "cbz", "cbr"].includes(format.toLowerCase());
/** Pauses lining up on this device for `hours`, or until `resumeLiningUp` when none are given. The pause outlasts closing TBV. */
export function pauseLiningUp(hours = null) {
    pausedUntil = hours ? Date.now() + hours * 3_600_000 : null;
    setPause(true, false);
    void api.pauseLiningUp(true, hours).catch(() => undefined);
}
export function resumeLiningUp() {
    pausedUntil = null;
    setPause(false, false);
    void api.pauseLiningUp(false, null).catch(() => undefined);
}
/** Pauses once the pair being lined up now is finished; `false` carries on after all. */
export function pauseAfterThis(on) {
    setPause(paused, on);
    void api.pauseLiningUpAfter(on).catch(() => undefined);
}
export const liningUpPaused = () => paused;
/** When a timed pause ends (milliseconds), or null when it lasts until carried on. */
export const liningUpPausedUntil = () => (paused ? pausedUntil : null);
export const pausingAfterThis = () => pauseAfter;
let pauseAfter = false;
let pausedUntil = null;
const pauseListeners = new Set();
function setPause(now, after) {
    paused = now;
    pauseAfter = after;
    pauseListeners.forEach((f) => f());
}
/** Told when lining up is paused or carries on, or will pause after this pair. */
export function onPauseChange(listener) {
    pauseListeners.add(listener);
    return () => pauseListeners.delete(listener);
}
/** Looks for pairs to line up again now (a pair was just made, say). */
export function lookForPairs() {
    void api.wakeLiningUp().catch(() => undefined);
}
let started = false;
/**
 * Follows the app's lining up, and counts books' words for it when it
 * asks (one book at a time, so opening TBV stays quick).
 */
export function startLiningUp() {
    if (started || !isApp)
        return;
    started = true;
    const look = () => void api.liningUpPaused().then((p) => {
        pausedUntil = p.until;
        setPause(p.paused, pauseAfter);
    }, () => undefined);
    look();
    api.onLiningUpPaused(() => {
        pauseAfter = false;
        look();
    });
    api.onLiningUp((l) => {
        current = l;
        listeners.forEach((f) => f(current));
    });
    api.onLinedUp((e, a) => finished.forEach((f) => f(e, a)));
    let counting = Promise.resolve();
    const wanted = new Set();
    api.onBookWordsWanted((ebookId) => {
        if (wanted.has(ebookId))
            return;
        wanted.add(ebookId);
        counting = counting.then(async () => {
            try {
                await api.saveBookWords(ebookId, await bookWords(ebookId));
            }
            catch (e) {
                console.warn("Couldn't count the book's words for lining up:", e);
            }
            finally {
                wanted.delete(ebookId);
            }
        });
    });
}

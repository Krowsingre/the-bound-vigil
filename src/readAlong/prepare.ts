// Working out read-along timing, in the background while TBV is open. A
// stretch of the audiobook is heard every couple of minutes, turned into
// words on this computer, and found in the ebook. What's done is saved as
// it goes, so closing TBV loses little and the next run carries on.

import { api } from "../api";
import { readerSource } from "../reader/formats";
import { BookIndex, heardFrom, readTiming, rising, sectionText, thin, wordsIn, type Timing, type Word } from "./timing";

/** How often a stretch is heard, and how long each is. */
export const STEP_MS = 90_000;
export const LENGTH_MS = 20_000;
/** Saved after this many stretches, so little is lost if TBV closes. */
const SAVE_EVERY = 8;

export interface Preparing {
  ebookId: string;
  audiobookId: string;
  stage: "reading" | "model" | "listening" | "done" | "failed" | "stopped";
  /** How far through the audiobook, 0 to 1. */
  fraction: number;
  /** Downloading the speech model, the first time. */
  modelLoaded: number;
  modelTotal: number;
  problem: string | null;
}

let current: Preparing | null = null;
let stopRequested = false;
const listeners = new Set<(p: Preparing | null) => void>();

function tell(change: Partial<Preparing>) {
  if (!current) return;
  current = { ...current, ...change };
  listeners.forEach((l) => l(current));
}

export function preparing(): Preparing | null {
  return current;
}

export function onPreparing(listener: (p: Preparing | null) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function stopPreparing() {
  stopRequested = true;
}

/** The ebook's words, section by section, as the reader will count them. */
async function bookWords(ebookId: string): Promise<{ words: Word[]; sections: number[] }> {
  const { book: about } = await api.bookDetails(ebookId);
  if (["pdf", "cbz", "cbr"].includes(about.format)) throw new Error("Word timing works with books that have flowing text, not page images or PDFs.");
  // Opened the way the reader opens it, so both count the same words.
  const blob = await api.readBookFile(ebookId);
  const source = await readerSource(new File([blob], `book.${about.format}`), about.format, ebookId, {
    title: about.title,
    author: about.authors.join(", "),
  });
  const { makeBook } = await import("../vendor/foliate-js/view.js");
  const book = source instanceof File ? await makeBook(source) : { ...source, destroy: undefined };
  const words: Word[] = [];
  const sections: number[] = [];
  try {
    for (const section of book.sections) {
      const doc = await Promise.resolve(section.createDocument?.()).catch(() => null);
      const found = doc ? wordsIn(sectionText(doc).text) : [];
      for (const w of found) words.push(w.word);
      sections.push(found.length);
    }
  } finally {
    book.destroy?.();
  }
  return { words, sections };
}

/** Starts working out timing for an ebook and its audiobook, unless it's already under way. */
export async function prepareTiming(ebookId: string, audiobookId: string): Promise<void> {
  if (current && ["reading", "model", "listening"].includes(current.stage)) return;
  stopRequested = false;
  current = { ebookId, audiobookId, stage: "reading", fraction: 0, modelLoaded: 0, modelTotal: 0, problem: null };
  tell({});
  let recogniser: import("./recogniser").Recogniser | null = null;
  try {
    const audiobook = await api.audiobook(audiobookId);
    const duration = audiobook.durationMs;
    const { words, sections } = await bookWords(ebookId);
    if (!words.length) throw new Error("TBV couldn't find any words in this ebook to match.");
    const saved = readTiming(await api.readAlongTiming(ebookId, audiobookId));
    // Carry on from before, unless the book now reads differently.
    const fresh: Timing = { version: 1, sections, anchors: [], heard: 0, done: false };
    const timing = saved && saved.sections.join() === sections.join() && !saved.done ? saved : fresh;
    const index = new BookIndex(words);
    let found = [...timing.anchors];
    const save = () => api.saveReadAlongTiming(ebookId, audiobookId, JSON.stringify(timing));

    tell({ stage: "model" });
    // Left out of the phone version, which never works timing out.
    const hearing = import.meta.env.MODE === "web" ? null : await import("./recogniser");
    if (!hearing) throw new Error("Word timing is worked out in the desktop app.");
    recogniser = new hearing.Recogniser((loaded, total) => tell({ modelLoaded: loaded, modelTotal: total }));
    const pace = words.length / Math.max(1, duration);
    let count = 0;
    for (let start = timing.heard; start < duration; start += STEP_MS) {
      if (stopRequested) {
        await save();
        tell({ stage: "stopped" });
        return;
      }
      const samples = await api.audioClip(audiobookId, start, LENGTH_MS);
      if (!samples.length) break;
      const pieces = await recogniser.hear(samples);
      tell({ stage: "listening", fraction: Math.min(1, (start + LENGTH_MS) / duration) });
      const heard = heardFrom(pieces, start, LENGTH_MS);
      const last = timing.anchors[timing.anchors.length - 1];
      const expected = last ? last[1] + (start - last[0]) * pace : start * pace;
      // A little before the last match, in case that one was a stray.
      found = found.concat(index.find(heard, (last?.[1] ?? 0) - 200, expected));
      timing.anchors = thin(rising(found));
      timing.heard = start + LENGTH_MS;
      if (++count % SAVE_EVERY === 0) await save();
    }
    timing.done = true;
    timing.heard = duration;
    await save();
    tell({ stage: "done", fraction: 1 });
  } catch (e) {
    const problem = e instanceof Error ? e.message : String(e);
    tell({
      stage: "failed",
      problem: /fetch|network/i.test(problem) ? "TBV couldn't download the speech model. Check the internet connection, then try again." : problem,
    });
  } finally {
    recogniser?.close();
    void api.audioClipsDone().catch(() => undefined);
  }
}

// Lining up an ebook with its audiobook, in the background, on whichever
// device has both. The audiobook is heard a piece at a time (half a minute,
// each overlapping the next by a few seconds so no word falls between them),
// each piece's words are matched to the book (align.ts), and the piece is
// saved straight away. A piece syncs on its own, so TBV can stop at any
// moment (closed, the device asleep) and carry on later from the next piece,
// here or on another device, without starting over.
//
// What's kept for a pair:
// - read_along.timing: a LineUp (below), the plan and how it ended;
// - read_along_pieces: one row per piece, its [ms, word] anchors.
//
// Until every piece is lined up, the book can be read and the audiobook
// played, but not followed together.

import { api, isApp, isIOS } from "../api";
import type { ReadAlongPair } from "../api/types";
import { readerSource } from "../reader/formats";
import { alignPiece } from "./align";
import { BookIndex, heardFrom, rising, sectionText, wordsIn, type Timing, type Word } from "./timing";

/** Each piece of the audiobook heard: Whisper hears half a minute at a time. */
export const PIECE_MS = 30_000;
/** How much each piece overlaps the next, so a word cut at the edge is heard whole in one of them. */
export const OVERLAP_MS = 3_000;
const STEP_MS = PIECE_MS - OVERLAP_MS;
/** A phone leaves a pair to a computer that has worked on it this recently. */
const COMPUTER_RECENT_MS = 20 * 60_000;
/** How often the device doing the work says so, for the others. */
const CLAIM_EVERY_MS = 5 * 60_000;
/** A rest between pieces, so lining up never crowds out what you're doing. */
const REST_MS = 1_500;
/** With nothing to line up, how long before looking again. */
const IDLE_MS = 2 * 60_000;
/** After trouble (no internet for the speech model, say), how long before trying again. */
const AFTER_TROUBLE_MS = 30 * 60_000;
/** A finished line-up needs this many matched words, reaching across this share of the book. */
const ENOUGH_WORDS = 50;
const ENOUGH_REACH = 0.5;

/** What's kept in read_along.timing for a pair. */
export interface LineUp {
  version: 2;
  /** Words in each section of the ebook, as `wordsIn` counts them. */
  sections: number[];
  durationMs: number;
  pieceMs: number;
  overlapMs: number;
  /** How many pieces the audiobook makes. */
  pieces: number;
  /** Every piece is lined up and the result checked. */
  done: boolean;
  /** Why it couldn't be lined up (different editions, say), once that's known. */
  failed: string | null;
  /** The device working on it lately. */
  worker: { device: string; computer: boolean; at: string } | null;
}

export function readLineUp(json: string | null): LineUp | null {
  if (!json) return null;
  try {
    const l = JSON.parse(json) as LineUp;
    return l.version === 2 && Array.isArray(l.sections) && l.pieces > 0 ? l : null;
  } catch {
    return null;
  }
}

/** How many pieces an audiobook of `durationMs` makes. */
export function pieceCount(durationMs: number): number {
  return Math.max(1, Math.ceil((durationMs - OVERLAP_MS) / STEP_MS));
}

/** Where piece `i` starts in the audiobook, and the stretch whose anchors it keeps (the overlap is shared out). */
export function pieceSpan(i: number, pieces: number): { start: number; keepFrom: number; keepTo: number } {
  const start = i * STEP_MS;
  return {
    start,
    keepFrom: i === 0 ? -Infinity : start + OVERLAP_MS / 2,
    keepTo: i === pieces - 1 ? Infinity : start + STEP_MS + OVERLAP_MS / 2,
  };
}

/** The pieces lined up so far, put together as timing the reader can follow. */
export function combine(lineUp: LineUp, pieces: [number, string][]): Timing {
  const anchors: [number, number][] = [];
  for (const [, json] of [...pieces].sort((a, b) => a[0] - b[0])) {
    try {
      for (const a of JSON.parse(json) as [number, number][]) if (Array.isArray(a) && a.length === 2) anchors.push([a[0], a[1]]);
    } catch {
      /* an unreadable piece is lined up again */
    }
  }
  const heard = Math.min(lineUp.durationMs, pieces.length * STEP_MS + OVERLAP_MS);
  return { version: 1, sections: lineUp.sections, anchors: rising(anchors), heard, done: lineUp.done };
}

/** A pair's lining up as the reader shows it. */
export interface LineUpState {
  done: boolean;
  failed: string | null;
  /** How far, 0 to 1. */
  fraction: number;
}

export function lineUpState(lineUp: LineUp | null, pieces: number): LineUpState {
  if (!lineUp) return { done: false, failed: null, fraction: 0 };
  return { done: lineUp.done, failed: lineUp.failed, fraction: lineUp.done ? 1 : Math.min(0.99, pieces / lineUp.pieces) };
}

/** A pair's timing for the reader: the line-up's state, and the timing once it's done. */
export async function loadLineUp(ebookId: string, audiobookId: string): Promise<{ state: LineUpState; timing: Timing | null }> {
  const lineUp = readLineUp(await api.readAlongTiming(ebookId, audiobookId));
  const pieces = lineUp ? await api.readAlongPieces(ebookId, audiobookId) : [];
  return { state: lineUpState(lineUp, pieces.length), timing: lineUp?.done ? combine(lineUp, pieces) : null };
}

// ---- The background job ----

export interface LiningUp {
  ebookId: string;
  audiobookId: string;
  /** The ebook's title, for the sidebar. */
  title: string;
  stage: "reading" | "model" | "listening";
  fraction: number;
  /** Downloading the speech model, the first time. */
  modelLoaded: number;
  modelTotal: number;
}

let current: LiningUp | null = null;
const listeners = new Set<(l: LiningUp | null) => void>();
/** A pair finished (or stopped) lining up, so readers showing it look again. */
const finished = new Set<(ebookId: string, audiobookId: string) => void>();

function tell(next: LiningUp | null) {
  current = next;
  listeners.forEach((l) => l(current));
}

export function liningUp(): LiningUp | null {
  return current;
}

export function onLiningUp(listener: (l: LiningUp | null) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function onLinedUp(listener: (ebookId: string, audiobookId: string) => void): () => void {
  finished.add(listener);
  return () => finished.delete(listener);
}

const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

/** On a phone, nothing happens while TBV is out of sight (iOS pauses it anyway). */
async function onScreen() {
  if (typeof document === "undefined" || !document.hidden) return;
  await new Promise<void>((ok) => {
    const seen = () => {
      if (document.hidden) return;
      document.removeEventListener("visibilitychange", seen);
      ok();
    };
    document.addEventListener("visibilitychange", seen);
  });
}

/** This device, as it signs the work it does. */
function deviceId(): string {
  try {
    let id = localStorage.getItem("tbv.lineUp.device");
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem("tbv.lineUp.device", id);
    }
    return id;
  } catch {
    return "this-device";
  }
}

const computer = isApp && !isIOS;

/** The ebook's words, section by section, as the reader will count them. */
async function bookWords(ebookId: string): Promise<{ words: Word[]; sections: number[]; language: string | null }> {
  const { book: about } = await api.bookDetails(ebookId);
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
  return { words, sections, language: about.language ?? null };
}

/** Page pictures and PDFs have no flowing text to follow word by word. */
export const linesUp = (format: string) => !["pdf", "cbz", "cbr"].includes(format.toLowerCase());

/** Whether this device should work on a pair now. */
function ours(pair: ReadAlongPair): boolean {
  if (!pair.here || !linesUp(pair.ebookFormat)) return false;
  const lineUp = readLineUp(pair.timing);
  if (lineUp?.done || lineUp?.failed) return false;
  // A computer does the work when there is one: it's quicker and has no battery to drain.
  const w = lineUp?.worker;
  if (!computer && w?.computer && w.device !== deviceId() && Date.now() - Date.parse(w.at) < COMPUTER_RECENT_MS) return false;
  return true;
}

type Hearing = import("./recogniser").Recogniser;

/** Lines up one pair, carrying on from whatever pieces are already done. */
async function lineUpPair(pair: ReadAlongPair, hearing: () => Promise<Hearing>, stopped: () => boolean): Promise<void> {
  const { ebookId, audiobookId } = pair;
  const title = await api.bookDetails(ebookId).then(
    (d) => d.book.title,
    () => "",
  );
  tell({ ebookId, audiobookId, title, stage: "reading", fraction: 0, modelLoaded: 0, modelTotal: 0 });
  const audiobook = await api.audiobook(audiobookId);
  const duration = audiobook.durationMs;
  const { words, sections, language } = await bookWords(ebookId);
  const pieces = pieceCount(duration);
  let lineUp = readLineUp(await api.readAlongTiming(ebookId, audiobookId));
  const save = (l: LineUp) => api.saveReadAlongTiming(ebookId, audiobookId, JSON.stringify(l));
  const sign = (l: LineUp): LineUp => ({ ...l, worker: { device: deviceId(), computer, at: new Date().toISOString() } });

  // Start afresh when nothing's planned yet, or the book or audiobook now reads differently.
  if (!lineUp || lineUp.sections.join() !== sections.join() || lineUp.durationMs !== duration) {
    await api.clearReadAlongPieces(ebookId, audiobookId);
    lineUp = { version: 2, sections, durationMs: duration, pieceMs: PIECE_MS, overlapMs: OVERLAP_MS, pieces, done: false, failed: null, worker: null };
  }
  const finish = async (l: LineUp) => {
    await save(l);
    finished.forEach((f) => f(ebookId, audiobookId));
  };
  // The speech model only knows English.
  if (language && !/^en\b/i.test(language)) return finish({ ...lineUp, failed: "Lining up only works for books in English so far." });
  if (!words.length) return finish({ ...lineUp, failed: "TBV couldn't find any words in this ebook to line up." });
  lineUp = sign(lineUp);
  await save(lineUp);
  let claimedAt = Date.now();

  const done = new Map((await api.readAlongPieces(ebookId, audiobookId)).map(([i, json]) => [i, json]));
  const index = new BookIndex(words);
  const pace = words.length / Math.max(1, duration);
  const lastWord = (before: number): [number, number] | null => {
    for (let i = before - 1; i >= 0; i--) {
      try {
        const a = JSON.parse(done.get(i) ?? "[]") as [number, number][];
        if (a.length) return a[a.length - 1];
      } catch {
        /* looked past */
      }
    }
    return null;
  };

  const recogniser = await (async () => {
    tell({ ebookId, audiobookId, title, stage: "model", fraction: done.size / pieces, modelLoaded: 0, modelTotal: 0 });
    return hearing();
  })();
  for (let i = 0; i < pieces; i++) {
    if (done.has(i)) continue;
    await onScreen();
    if (stopped()) return;
    // Another device may have done this piece meanwhile.
    const there = await api.readAlongPieces(ebookId, audiobookId);
    for (const [k, json] of there) done.set(k, json);
    if (done.has(i)) continue;

    const span = pieceSpan(i, pieces);
    const samples = await api.audioClip(audiobookId, span.start, PIECE_MS);
    let anchors: [number, number][] = [];
    if (samples.length) {
      const heard = heardFrom(await recogniser.hear(samples), span.start, PIECE_MS);
      const last = lastWord(i);
      const expected = last ? last[1] + (span.start - last[0]) * pace : span.start * pace;
      anchors = alignPiece(heard, index, last ? last[1] : null, expected).filter(([t]) => t >= span.keepFrom && t < span.keepTo);
    }
    const json = JSON.stringify(anchors);
    await api.saveReadAlongPiece(ebookId, audiobookId, i, json);
    done.set(i, json);
    tell({ ebookId, audiobookId, title, stage: "listening", fraction: done.size / pieces, modelLoaded: 0, modelTotal: 0 });
    if (Date.now() - claimedAt > CLAIM_EVERY_MS) {
      lineUp = sign(lineUp);
      await save(lineUp);
      claimedAt = Date.now();
    }
    await sleep(REST_MS);
  }

  // Every piece is here: check the whole before it's followed.
  const all = [...done].sort((a, b) => a[0] - b[0]);
  const timing = combine({ ...lineUp, done: true }, all);
  const a = timing.anchors;
  const reach = a.length ? (a[a.length - 1][1] - a[0][1]) / words.length : 0;
  if (a.length < ENOUGH_WORDS || reach < ENOUGH_REACH) {
    return finish({ ...lineUp, failed: "TBV couldn't line this audiobook up with the ebook. They may be different editions." });
  }
  await finish({ ...lineUp, done: true, failed: null });
}

let running = false;
let paused = false;

/** Pauses lining up until TBV next opens, or `resumeLiningUp`. */
export function pauseLiningUp() {
  paused = true;
}

export function resumeLiningUp() {
  paused = false;
  wake?.();
}

export const liningUpPaused = () => paused;

let wake: (() => void) | null = null;
const rest = (ms: number) =>
  new Promise<void>((ok) => {
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      wake = null;
      ok();
    }
    wake = done;
  });

/** Looks for pairs to line up again now (a pair was just made, say). */
export function lookForPairs() {
  wake?.();
}

/**
 * Starts lining up in the background, for as long as TBV is open: each
 * pair this device has both files of, one after another.
 */
export function startLiningUp() {
  if (running || !isApp) return;
  running = true;
  const troubled = new Map<string, number>();
  const key = (p: ReadAlongPair) => `${p.ebookId}|${p.audiobookId}`;
  let recogniser = null as Hearing | null;
  const hearing = async () => {
    if (recogniser) return recogniser;
    // Left out of the web version, which never lines up.
    const loaded = import.meta.env.MODE === "web" ? null : await import("./recogniser");
    if (!loaded) throw new Error("Lining up happens in the app.");
    recogniser = new loaded.Recogniser((loaded, total) => {
      if (current) tell({ ...current, stage: "model", modelLoaded: loaded, modelTotal: total });
    });
    return recogniser;
  };
  void (async () => {
    // Out of the way while TBV opens.
    await rest(20_000);
    for (;;) {
      if (paused) {
        await rest(IDLE_MS);
        continue;
      }
      let pair: ReadAlongPair | undefined;
      try {
        const now = Date.now();
        pair = (await api.readAlongPairs()).find((p) => ours(p) && !((troubled.get(key(p)) ?? 0) > now));
      } catch {
        /* the library is busy; looked at again soon */
      }
      if (!pair) {
        recogniser?.close();
        recogniser = null;
        await rest(IDLE_MS);
        continue;
      }
      try {
        await lineUpPair(pair, hearing, () => paused);
      } catch (e) {
        console.warn("Lining up stopped:", e);
        // Kept as it is: the next try carries on from the last piece saved.
        // Meanwhile any other pair can go ahead.
        troubled.set(key(pair), Date.now() + AFTER_TROUBLE_MS);
        recogniser?.close();
        recogniser = null;
      } finally {
        tell(null);
        void api.audioClipsDone().catch(() => undefined);
      }
      await rest(REST_MS);
    }
  })();
}

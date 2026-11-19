// Read-along timing: when the narrator reaches which word of the ebook.
//
// It's worked out on a computer by hearing a short stretch of the audiobook
// every so often, turning the speech into words, and finding those words in
// the book. Each match is an anchor (a moment in the audiobook and a word in
// the book); between anchors the place is spread evenly, which is close
// enough for a sentence highlight because the anchors are only a minute or
// two apart. The timing is kept with the library and syncs, so a phone
// follows the narrator just as closely.

/** A word of the book: lower case, letters and digits only. */
export type Word = string;

export interface Timing {
  version: 1;
  /** Words in each section of the ebook, as `wordsIn` counts them. */
  sections: number[];
  /** [ms into the audiobook, word of the whole book], both rising. */
  anchors: [number, number][];
  /** How far into the audiobook it has listened, in ms. */
  heard: number;
  /** The whole audiobook has been heard. */
  done: boolean;
}

const WORD = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;

/** Lower case, apostrophes and accents dropped: "Don’t" and "dont" match. */
export function wordKey(word: string): Word {
  return word
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ'’]/g, "");
}

/** The words of some text, each with where it starts. */
export function wordsIn(text: string): { word: Word; at: number }[] {
  const out: { word: Word; at: number }[] = [];
  for (const m of text.matchAll(WORD)) out.push({ word: wordKey(m[0]), at: m.index ?? 0 });
  return out;
}

/** The text of a section as the reader sees it: its text nodes, in order, skipping blank ones. */
export function sectionText(doc: Document): { text: string; nodes: { node: Text; start: number }[] } {
  const nodes: { node: Text; start: number }[] = [];
  let text = "";
  const walker = doc.createTreeWalker(doc.body ?? doc.documentElement, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n as Text;
    if (!t.data.trim()) continue;
    nodes.push({ node: t, start: text.length });
    text += t.data;
  }
  return { text, nodes };
}

/** What the speech recognition heard in one stretch: its words and when each was said (ms into the audiobook). */
export interface Heard {
  words: Word[];
  times: number[];
}

/**
 * Spreads each recognised piece's words over its time by their length.
 * `pieces` are as Whisper gives them: text, and start and end in seconds
 * from the start of the stretch (end may be missing for the last one).
 */
export function heardFrom(pieces: { text: string; timestamp: [number, number | null] }[], startMs: number, lengthMs: number): Heard {
  const heard: Heard = { words: [], times: [] };
  for (const piece of pieces) {
    const words = wordsIn(piece.text);
    if (!words.length) continue;
    const from = startMs + piece.timestamp[0] * 1000;
    const to = startMs + (piece.timestamp[1] ?? lengthMs / 1000) * 1000;
    const length = piece.text.length || 1;
    for (const w of words) {
      heard.words.push(w.word);
      heard.times.push(Math.round(from + ((to - from) * w.at) / length));
    }
  }
  return heard;
}

/** Where each run of three words appears in the book, for finding what was heard. */
export class BookIndex {
  private readonly runs = new Map<string, number[]>();

  constructor(readonly words: Word[]) {
    for (let i = 0; i + 2 < words.length; i++) {
      const key = `${words[i]} ${words[i + 1]} ${words[i + 2]}`;
      const at = this.runs.get(key);
      if (at) {
        // A run that's everywhere ("said the man") tells nothing.
        if (at.length < 50) at.push(i);
      } else this.runs.set(key, [i]);
    }
  }

  /**
   * Anchors for one stretch: where its words are in the book. Words can be
   * misheard, skipped or added, so matches vote on where the stretch is,
   * and only those agreeing with the winner count. Places after `after`
   * are preferred, then those nearest `expected`.
   */
  find(heard: Heard, after: number, expected: number): [number, number][] {
    const hits: { k: number; p: number }[] = [];
    for (let k = 0; k + 2 < heard.words.length; k++) {
      for (const p of this.runs.get(`${heard.words[k]} ${heard.words[k + 1]} ${heard.words[k + 2]}`) ?? []) hits.push({ k, p });
    }
    if (!hits.length) return [];
    // Votes by where the stretch would start in the book, give or take a few words.
    const SLACK = 12;
    const votes = new Map<number, number>();
    for (const { k, p } of hits) {
      const bucket = Math.floor((p - k) / SLACK);
      votes.set(bucket, (votes.get(bucket) ?? 0) + 1);
    }
    let best: { bucket: number; score: number; distance: number } | null = null;
    for (const [bucket, count] of votes) {
      const score = count + (votes.get(bucket - 1) ?? 0) + (votes.get(bucket + 1) ?? 0);
      const start = bucket * SLACK;
      if (start + heard.words.length < after) continue;
      const distance = Math.abs(start - expected);
      if (!best || score > best.score || (score === best.score && distance < best.distance)) best = { bucket, score, distance };
    }
    // One run of three alone could be chance.
    if (!best || best.score < 2) return [];
    const lo = (best.bucket - 1) * SLACK;
    const hi = (best.bucket + 2) * SLACK;
    const anchors: [number, number][] = [];
    for (const { k, p } of hits) {
      if (p - k >= lo && p - k < hi && p > after) anchors.push([heard.times[k], p]);
    }
    return rising(anchors);
  }
}

/** The longest run of anchors rising in both time and word, so stray matches drop out. */
export function rising(anchors: [number, number][]): [number, number][] {
  const sorted = [...anchors].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  // Patience sorting on the word, keeping the time strictly rising too.
  const tails: number[] = [];
  const before: number[] = new Array(sorted.length).fill(-1);
  for (let i = 0; i < sorted.length; i++) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const t = sorted[tails[mid]];
      if (t[1] < sorted[i][1] && t[0] < sorted[i][0]) lo = mid + 1;
      else hi = mid;
    }
    before[i] = lo > 0 ? tails[lo - 1] : -1;
    tails[lo] = i;
  }
  const out: [number, number][] = [];
  for (let i = tails.length ? tails[tails.length - 1] : -1; i >= 0; i = before[i]) out.push(sorted[i]);
  return out.reverse();
}

/** Anchors at least `gapMs` apart: closer ones add nothing but size to what syncs. */
export function thin(anchors: [number, number][], gapMs = 2000): [number, number][] {
  const out: [number, number][] = [];
  for (const a of anchors) if (!out.length || a[0] - out[out.length - 1][0] >= gapMs) out.push(a);
  return out;
}

/** A narrator's usual pace when the timing can't tell: about 150 words a minute, in words per ms. */
const USUAL_PACE = 150 / 60_000;
/** Matches this many words or fewer, followed by a gap, are taken to be the title or credits, not the story. */
const STRAY = 3;
/** A stretch with no anchors this long, or this far off the narrator's pace, is a jump, not reading. */
const GAP_MS = 20_000;
const OFF_PACE = 2.5;
/** How long the narrator is followed past the last anchor before a jump, at their own pace. */
const RUN_ON_MS = 8_000;

interface Shape {
  /** The anchors that are the story, with stray front-matter matches left out. */
  anchors: [number, number][];
  /** The narrator's usual pace, in words per ms. */
  pace: number;
}
const shapes = new WeakMap<Timing, Shape>();

/** Whether going from one anchor to the next is reading at the narrator's pace, or a jump. */
function steady(a: [number, number], b: [number, number], pace: number): boolean {
  const dt = b[0] - a[0];
  const dw = b[1] - a[1];
  if (dt <= 0) return false;
  const expected = pace * dt;
  // A short stretch is reading whatever its pace: words are misheard and timed loosely.
  if (Math.abs(dw - expected) < 60) return true;
  const ratio = dw / Math.max(1e-9, expected);
  return dt < GAP_MS * 3 && ratio <= OFF_PACE && ratio >= 1 / OFF_PACE;
}

function shapeOf(timing: Timing): Shape {
  const known = shapes.get(timing);
  if (known) return known;
  const all = timing.anchors;
  const paces: number[] = [];
  for (let i = 1; i < all.length; i++) {
    const dt = all[i][0] - all[i - 1][0];
    const dw = all[i][1] - all[i - 1][1];
    if (dt > 0 && dw > 0 && dt < GAP_MS) paces.push(dw / dt);
  }
  paces.sort((x, y) => x - y);
  const pace = paces.length >= 3 ? paces[paces.length >> 1] : USUAL_PACE;
  // The audiobook's opening (the title, "written by", "narrated by") can
  // match the book's title page: a few words, then a jump to the story.
  let first = 0;
  for (;;) {
    let end = first + 1;
    while (end < all.length && steady(all[end - 1], all[end], pace)) end++;
    if (end >= all.length || end - first > STRAY) break;
    first = end;
  }
  const shape = { anchors: all.slice(first), pace };
  shapes.set(timing, shape);
  return shape;
}

/**
 * The word the narrator is at, `ms` into the audiobook, or null where the
 * narrator isn't reading the book: before the story starts (an opening
 * like "This is Audible"), after it ends (credits), during a stretch that
 * isn't in the book, or where the timing doesn't reach yet. A big jump in
 * the book (front matter that isn't narrated, a skipped passage) is jumped,
 * not crawled through. A dedication or foreword the narrator reads is
 * followed like the rest.
 */
export function wordAt(timing: Timing, ms: number, gapMs: number): number | null {
  const { anchors: a, pace } = shapeOf(timing);
  if (!a.length) return null;
  const total = timing.sections.reduce((s, n) => s + n, 0);
  const inBook = (w: number) => (w < 0 || w >= total ? null : Math.round(w));
  if (ms < a[0][0]) {
    // Before the first anchor: back from it at the narrator's pace, until the story's start.
    const w = a[0][1] - pace * (a[0][0] - ms);
    return w < a[0][1] - pace * Math.min(a[0][0], gapMs + RUN_ON_MS) ? null : inBook(w);
  }
  const last = a[a.length - 1];
  if (ms >= last[0]) {
    // After the last anchor: on at the narrator's pace for a little, then nothing (the credits, or not heard yet).
    if (ms > last[0] + Math.min(gapMs, RUN_ON_MS * 2)) return null;
    return inBook(Math.min(total - 1, last[1] + pace * (ms - last[0])));
  }
  let lo = 0;
  let hi = a.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (a[mid][0] <= ms) lo = mid;
    else hi = mid;
  }
  const [t0, w0] = a[lo];
  const [t1, w1] = a[hi];
  if (steady(a[lo], a[hi], pace)) return Math.round(w0 + ((w1 - w0) * (ms - t0)) / (t1 - t0));
  // A jump. The narrator finishes what they were reading, then either skips
  // ahead to where the next anchor is or talks about something not in the book.
  const back = w1 - pace * (t1 - ms);
  const on = w0 + pace * (ms - t0);
  if (ms - t0 <= Math.min(RUN_ON_MS, (t1 - t0) / 2) && on < w1) return Math.round(on);
  // Skipping ahead: on from where the next anchor says the narrator is.
  if (back > on) return Math.round(back);
  // Something not in the book: nothing, until the narrator is nearly back at it.
  if (t1 - ms <= RUN_ON_MS && back >= w0) return Math.round(back);
  return null;
}

/** A word of the whole book as a section and the word within it. */
export function placeOf(timing: Timing, word: number): { section: number; word: number } | null {
  let left = word;
  for (let i = 0; i < timing.sections.length; i++) {
    if (left < timing.sections[i]) return { section: i, word: left };
    left -= timing.sections[i];
  }
  return null;
}

/** Reads saved timing, or null if it's from a different kind of book or unreadable. */
export function readTiming(json: string | null): Timing | null {
  if (!json) return null;
  try {
    const t = JSON.parse(json) as Timing;
    return t.version === 1 && Array.isArray(t.sections) && Array.isArray(t.anchors) ? t : null;
  } catch {
    return null;
  }
}

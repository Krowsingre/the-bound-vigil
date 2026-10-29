import { describe, expect, it } from "vitest";
import { alignPiece, matchWords } from "./align";
import { combine, lineUpState, OVERLAP_MS, PIECE_MS, pieceCount, pieceSpan, readLineUp, type LineUp } from "./lineUp";
import { BookIndex, heardFrom, wordAt } from "./timing";

/** Numbers that come out the same every run. */
function seeded(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

/** A made-up book: common words far more often than rare ones, as in real writing. */
function makeBook(length: number, random: () => number): string[] {
  const common = "the and a of to was he she it in that i you his her said with for on at as had but not".split(" ");
  const rare = Array.from({ length: 3000 }, (_, i) => `w${i.toString(36)}${"aeiou"[i % 5]}`);
  return Array.from({ length }, () => (random() < 0.45 ? common[Math.floor(random() * common.length)] : rare[Math.floor(random() ** 2 * rare.length)]));
}

/**
 * What Whisper might make of the narrator reading `book` from `fromMs`: the
 * words said over that stretch in pieces of a few seconds, with some misheard,
 * missed or added.
 */
function hear(book: string[], said: number[], startMs: number, lengthMs: number, random: () => number) {
  const pieces: { text: string; timestamp: [number, number | null] }[] = [];
  let words: string[] = [];
  let from = -1;
  for (let w = 0; w < book.length; w++) {
    const t = said[w];
    if (t < startMs || t >= startMs + lengthMs) continue;
    if (from < 0) from = t;
    const r = random();
    if (r < 0.06) words.push("misheard");
    else if (r < 0.09) {
      /* missed */
    } else if (r < 0.12) words.push(book[w], "um");
    else words.push(book[w]);
    if (words.length >= 10 + Math.floor(random() * 8)) {
      pieces.push({ text: " " + words.join(" "), timestamp: [(from - startMs) / 1000, (t + 300 - startMs) / 1000] });
      words = [];
      from = -1;
    }
  }
  if (words.length) pieces.push({ text: " " + words.join(" "), timestamp: [(from - startMs) / 1000, null] });
  return pieces;
}

describe("lining up", () => {
  it("matches heard words to the book one by one, around mistakes", () => {
    const book = "it was a dark and stormy night the rain fell in torrents except at occasional intervals".split(" ");
    const heard = "a dark and stormy knight the rain fell fell in torrents".split(" ");
    const pairs = matchWords(heard, book, 0, book.length);
    const placed = new Map(pairs);
    expect(placed.get(0)).toBe(2); // a
    expect(placed.get(3)).toBe(5); // stormy
    expect(placed.has(4)).toBe(false); // "knight" isn't in the book
    expect(placed.get(10)).toBe(11); // torrents, after the repeated word
  });

  it("splits the audiobook into overlapping pieces that share out the overlap", () => {
    expect(pieceCount(PIECE_MS)).toBe(1);
    expect(pieceCount(10 * 60_000)).toBe(Math.ceil((10 * 60_000 - OVERLAP_MS) / (PIECE_MS - OVERLAP_MS)));
    const a = pieceSpan(0, 5);
    const b = pieceSpan(1, 5);
    expect(b.start).toBeLessThan(a.start + PIECE_MS);
    expect(a.keepTo).toBe(b.keepFrom);
    expect(pieceSpan(4, 5).keepTo).toBe(Infinity);
  });

  it("follows the narrator to within a few words across a whole book", () => {
    const random = seeded(7);
    const book = makeBook(12_000, random);
    // About 2.6 words a second, faster and slower by turns, with pauses.
    const said: number[] = [];
    let t = 4_000;
    for (let w = 0; w < book.length; w++) {
      said.push(t);
      t += 300 + random() * 160 + (w % 40 === 39 ? 700 : 0);
    }
    const duration = t + 2_000;
    const index = new BookIndex(book);
    const pieces = pieceCount(duration);
    const saved: [number, string][] = [];
    let last: [number, number] | null = null;
    for (let i = 0; i < pieces; i++) {
      const span = pieceSpan(i, pieces);
      const heard = heardFrom(hear(book, said, span.start, PIECE_MS, random), span.start, PIECE_MS);
      const expected: number = last ? last[1] + (span.start - last[0]) * (book.length / duration) : 0;
      const anchors: [number, number][] = alignPiece(heard, index, last ? last[1] : null, expected).filter(([ms]) => ms >= span.keepFrom && ms < span.keepTo);
      if (anchors.length) last = anchors[anchors.length - 1];
      saved.push([i, JSON.stringify(anchors)]);
    }
    const lineUp: LineUp = {
      version: 2,
      sections: [book.length],
      durationMs: duration,
      pieceMs: PIECE_MS,
      overlapMs: OVERLAP_MS,
      pieces,
      done: true,
      failed: null,
      worker: null,
    };
    // Lined up in any order (two devices sharing the work), it comes out the same.
    const timing = combine(lineUp, [...saved].reverse());
    expect(timing.anchors.length).toBeGreaterThan(book.length * 0.6);
    const misses = book.map((_, w) => Math.abs((wordAt(timing, said[w] + 50, 10_000) ?? -1000) - w)).sort((x, y) => x - y);
    expect(misses[Math.floor(misses.length / 2)]).toBeLessThanOrEqual(1);
    expect(misses[Math.floor(misses.length * 0.95)]).toBeLessThanOrEqual(4);
  });

  it("finds nothing in speech that isn't in the book", () => {
    const random = seeded(3);
    const index = new BookIndex(makeBook(2_000, random));
    const credits = "this audiobook was recorded in our studio and is published by sound books".split(" ");
    expect(alignPiece({ words: credits, times: credits.map((_, i) => i * 400) }, index, null, 0)).toEqual([]);
  });

  it("tells how far lining up has got, and only reads line-ups it understands", () => {
    const lineUp: LineUp = { version: 2, sections: [10], durationMs: 60_000, pieceMs: PIECE_MS, overlapMs: OVERLAP_MS, pieces: 4, done: false, failed: null, worker: null };
    expect(lineUpState(lineUp, 1)).toEqual({ done: false, failed: null, fraction: 0.25 });
    expect(lineUpState({ ...lineUp, done: true }, 4).fraction).toBe(1);
    expect(lineUpState(null, 0).done).toBe(false);
    expect(readLineUp(JSON.stringify(lineUp))?.pieces).toBe(4);
    // Timing from before (heard a few seconds every minute and a half) is lined up again.
    expect(readLineUp('{"version":1,"sections":[1],"anchors":[],"heard":0,"done":true}')).toBeNull();
    expect(readLineUp("nope")).toBeNull();
  });
});

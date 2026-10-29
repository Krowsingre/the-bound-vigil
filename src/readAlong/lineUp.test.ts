import { describe, expect, it } from "vitest";
import { lineUpState, OVERLAP_MS, PIECE_MS, pieceCount, pieceSpan, readLineUp, type LineUp } from "./lineUp";

// Matching what's heard to the book is tested with the app's core
// (crates/tbv-core/src/lineup.rs), which does it.
describe("lining up", () => {
  it("splits the audiobook into overlapping pieces that share out the overlap", () => {
    expect(pieceCount(PIECE_MS)).toBe(1);
    expect(pieceCount(10 * 60_000)).toBe(Math.ceil((10 * 60_000 - OVERLAP_MS) / (PIECE_MS - OVERLAP_MS)));
    const a = pieceSpan(0, 5);
    const b = pieceSpan(1, 5);
    expect(b.start).toBeLessThan(a.start + PIECE_MS);
    expect(a.keepTo).toBe(b.keepFrom);
    expect(pieceSpan(4, 5).keepTo).toBe(Infinity);
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

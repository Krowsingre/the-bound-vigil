import { describe, expect, it } from "vitest";
import { swipeTurn, wheelTurner } from "./pageSwipe";

describe("swipeTurn", () => {
  it("turns to the next page on a swipe to the left", () => {
    expect(swipeTurn(-120, 10)).toBe(1);
  });
  it("turns back on a swipe to the right", () => {
    expect(swipeTurn(120, -5)).toBe(-1);
  });
  it("leaves short or mostly up-and-down moves alone", () => {
    expect(swipeTurn(-30, 0)).toBe(0);
    expect(swipeTurn(-100, 90)).toBe(0);
  });
});

describe("wheelTurner", () => {
  /** A swipe: growing then gliding down, one event every 16 ms from `t`. */
  const swipe = (turn: ReturnType<typeof wheelTurner>, t: number, sizes: number[]) =>
    sizes.map((s, i) => turn(s, t + i * 16)).filter(Boolean);

  it("turns once per swipe, ignoring the glide after it", () => {
    const turn = wheelTurner();
    expect(swipe(turn, 0, [10, 25, 40, 30, 20, 14, 10, 7, 5, 3, 2, 1])).toEqual([1]);
  });

  it("takes a second swipe that starts during the first one's glide", () => {
    const turn = wheelTurner();
    // First swipe and part of its glide (0 to ~180 ms), then a new swipe speeds up at 400 ms
    // while the glide would still be running.
    expect(swipe(turn, 0, [10, 25, 40, 30, 20, 14, 10, 7, 5, 4, 3, 3])).toEqual([1]);
    expect(swipe(turn, 192, [3, 3, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2])).toEqual([]);
    expect(swipe(turn, 384, [12, 30, 45, 30, 20])).toEqual([1]);
  });

  it("goes back on a swipe the other way, and turns again after a pause", () => {
    const turn = wheelTurner();
    expect(swipe(turn, 0, [-20, -40, -30])).toEqual([-1]);
    expect(swipe(turn, 1000, [20, 40, 30])).toEqual([1]);
  });
});

import { describe, expect, it } from "vitest";
import { swipeTurn } from "./pageSwipe";

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

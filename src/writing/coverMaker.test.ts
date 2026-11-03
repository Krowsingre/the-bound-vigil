import { describe, expect, it } from "vitest";
import { COVER_HEIGHT, COVER_WIDTH, movePlace, placeOf } from "./CoverMaker";

describe("moving words on the cover", () => {
  const start = { x: 0.5, y: 0.5 };

  it("moves freely without Shift", () => {
    const p = movePlace(start, 160, -256, COVER_HEIGHT, false);
    expect(p.x).toBeCloseTo(0.6);
    expect(p.y).toBeCloseTo(0.4);
  });

  it("keeps to one direction with Shift, the way it moved most", () => {
    expect(movePlace(start, 300, 40, COVER_HEIGHT, true)).toEqual({ x: 0.5 + 300 / COVER_WIDTH, y: 0.5 });
    expect(movePlace(start, 30, -900, COVER_HEIGHT, true)).toEqual({ x: 0.5, y: 0.5 - 900 / COVER_HEIGHT });
  });

  it("snaps to the middle and stays on the cover", () => {
    expect(movePlace({ x: 0.3, y: 0.5 }, 0.2 * COVER_WIDTH + 8, 0, COVER_HEIGHT, false).x).toBe(0.5);
    expect(movePlace(start, -5000, 9000, COVER_HEIGHT, false)).toEqual({ x: 0, y: 1 });
  });

  it("finds a box's centre", () => {
    expect(placeOf({ x: 600, y: 1180, width: 400, height: 200 }, COVER_HEIGHT)).toEqual({ x: 0.5, y: 1280 / COVER_HEIGHT });
  });
});

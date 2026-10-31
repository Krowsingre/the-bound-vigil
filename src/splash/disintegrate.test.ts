import { describe, expect, it } from "vitest";
import { sweepWay } from "./disintegrate";

describe("sweepWay", () => {
  it("goes from the corner it starts at to the opposite one", () => {
    const right = sweepWay(0);
    expect(right.along(0, 0.5)).toBeCloseTo(0);
    expect(right.along(1, 0.5)).toBeCloseTo(1);
    const up = sweepWay(-Math.PI / 2);
    expect(up.along(0.5, 1)).toBeCloseTo(0);
    expect(up.along(0.5, 0)).toBeCloseTo(1);
  });

  it("keeps every point between 0 and 1, whichever way it goes", () => {
    for (let a = 0; a < 6.3; a += 0.37) {
      const way = sweepWay(a);
      for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1], [0.3, 0.8]]) {
        const t = way.along(x, y);
        expect(t).toBeGreaterThanOrEqual(-1e-9);
        expect(t).toBeLessThanOrEqual(1 + 1e-9);
      }
    }
  });
});

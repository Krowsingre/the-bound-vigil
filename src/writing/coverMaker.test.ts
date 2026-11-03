import { describe, expect, it } from "vitest";
import { COVER_HEIGHT, placeOf } from "./CoverMaker";
import { centreBlocks, dragBlocks } from "./coverLayout";

const reach = { x: 0.01, y: 0.01 };

describe("moving words on the cover", () => {
  const one = [{ x: 0.3, y: 0.3 }];
  const size = [{ w: 0.2, h: 0.05 }];

  it("moves freely without Shift", () => {
    const { places } = dragBlocks(one, size, 0.1, 0.1, { axisLock: false, reach: null });
    expect(places[0].x).toBeCloseTo(0.4);
    expect(places[0].y).toBeCloseTo(0.4);
  });

  it("keeps to one direction with Shift, the way it moved most", () => {
    const across = dragBlocks(one, size, 0.15, 0.02, { axisLock: true, reach: null }).places[0];
    expect(across.x).toBeCloseTo(0.45);
    expect(across.y).toBe(0.3);
    expect(dragBlocks(one, size, 0.02, -0.15, { axisLock: true, reach: null }).places[0].x).toBe(0.3);
  });

  it("snaps a block to the middle on both axes, and says so", () => {
    const r = dragBlocks(one, size, 0.195, 0.205, { axisLock: false, reach });
    expect(r.places[0]).toEqual({ x: 0.5, y: 0.5 });
    expect(r.snapped).toEqual({ x: true, y: true });
  });

  it("doesn't snap sideways while Shift keeps it moving up and down", () => {
    const r = dragBlocks([{ x: 0.495, y: 0.3 }], size, 0, 0.1, { axisLock: true, reach });
    expect(r.places[0].x).toBe(0.495);
  });

  it("snaps a group by its middle as well as by each block", () => {
    // Title at 0.4, author at 0.7 across: the pair's middle is 0.55.
    const from = [{ x: 0.4, y: 0.2 }, { x: 0.7, y: 0.8 }];
    const sizes = [{ w: 0.2, h: 0.1 }, { w: 0.2, h: 0.1 }];
    const r = dragBlocks(from, sizes, -0.052, 0, { axisLock: false, reach });
    expect(r.places[0].x).toBeCloseTo(0.35);
    expect(r.places[1].x).toBeCloseTo(0.65);
    expect(r.snapped.x).toBe(true);
  });

  it("centres several blocks together, keeping their places to each other", () => {
    const from = [{ x: 0.2, y: 0.2 }, { x: 0.4, y: 0.9 }];
    const sizes = [{ w: 0.2, h: 0.1 }, { w: 0.2, h: 0.1 }];
    const across = centreBlocks(from, sizes, "x");
    expect(across[0].x).toBeCloseTo(0.4);
    expect(across[1].x).toBeCloseTo(0.6);
    const down = centreBlocks(from, sizes, "y");
    expect(down[0].y + down[1].y).toBeCloseTo(1);
  });

  it("stays on the cover and finds a box's centre", () => {
    expect(dragBlocks(one, size, -5, 9, { axisLock: false, reach: null }).places[0]).toEqual({ x: 0, y: 1 });
    expect(placeOf({ x: 600, y: 1180, width: 400, height: 200 }, COVER_HEIGHT)).toEqual({ x: 0.5, y: 1280 / COVER_HEIGHT });
  });
});

describe("snapping to even spacing", () => {
  const size = [{ w: 0.3, h: 0.04 }];
  const others = [
    { place: { x: 0.5, y: 0.2 }, size: { w: 0.4, h: 0.1 } }, // title, 0.15 to 0.25
    { place: { x: 0.5, y: 0.8 }, size: { w: 0.3, h: 0.04 } }, // author, 0.78 to 0.82
  ];

  it("snaps halfway between two others, and marks both gaps", () => {
    // Halfway: the gap from 0.25 to 0.78 holds the 0.04 block with 0.245 either side, so its centre is 0.515.
    const r = dragBlocks([{ x: 0.3, y: 0.4 }], size, 0, 0.11, { axisLock: false, reach: { x: 0.001, y: 0.01 }, others });
    expect(r.places[0].y).toBeCloseTo(0.515);
    expect(r.gaps).toHaveLength(2);
    expect(r.gaps[0].b - r.gaps[0].a).toBeCloseTo(r.gaps[1].b - r.gaps[1].a);
  });

  it("snaps as far below one block as that block is below the next", () => {
    const two = [
      { place: { x: 0.5, y: 0.2 }, size: { w: 0.4, h: 0.1 } }, // 0.15 to 0.25
      { place: { x: 0.5, y: 0.37 }, size: { w: 0.3, h: 0.04 } }, // 0.35 to 0.39: a gap of 0.1
    ];
    // Below: top at 0.49, so the centre at 0.51.
    const r = dragBlocks([{ x: 0.3, y: 0.62 }], size, 0, -0.105, { axisLock: false, reach: { x: 0.001, y: 0.01 }, others: two });
    expect(r.places[0].y).toBeCloseTo(0.51);
  });

  it("prefers the middle of the cover when that's nearer", () => {
    const r = dragBlocks([{ x: 0.3, y: 0.49 }], size, 0, 0.008, { axisLock: false, reach: { x: 0.001, y: 0.03 }, others });
    expect(r.places[0].y).toBe(0.5);
    expect(r.snapped.y).toBe(true);
    expect(r.gaps).toEqual([]);
  });
});

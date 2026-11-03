// Moving the words on a cover by hand (embre, 3 November 2026): one block or
// several at once, Shift to keep to one direction, and a snap to the middle
// of the cover, across and up and down, for each block and for the group.
// Places are block centres as shares of the cover's width and height.

export interface Place {
  x: number;
  y: number;
}

/** A block's size as shares of the cover's width and height. */
export interface Size {
  w: number;
  h: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The box around several blocks, in shares of the cover. */
export function groupBounds(places: Place[], sizes: Size[]) {
  const left = Math.min(...places.map((p, i) => p.x - sizes[i].w / 2));
  const right = Math.max(...places.map((p, i) => p.x + sizes[i].w / 2));
  const top = Math.min(...places.map((p, i) => p.y - sizes[i].h / 2));
  const bottom = Math.max(...places.map((p, i) => p.y + sizes[i].h / 2));
  return { left, right, top, bottom, cx: (left + right) / 2, cy: (top + bottom) / 2 };
}

/** The nearest way to bring one of `centres` onto the middle, if it's within `reach`. */
function snapOffset(centres: number[], reach: number): number | null {
  let best: number | null = null;
  for (const c of centres) {
    const off = 0.5 - c;
    if (Math.abs(off) <= reach && (best === null || Math.abs(off) < Math.abs(best))) best = off;
  }
  return best;
}

export interface Drag {
  places: Place[];
  /** Which middle line the group was snapped to, for drawing a guide. */
  snapped: { x: boolean; y: boolean };
}

/**
 * Moves blocks that started at `from` by (dx, dy), given as shares of the
 * cover. With `axisLock`, only along the way it has moved most. With `reach`,
 * a block's centre or the group's centre within that share of the middle
 * snaps onto it.
 */
export function dragBlocks(from: Place[], sizes: Size[], dx: number, dy: number, opts: { axisLock: boolean; reach: { x: number; y: number } | null }): Drag {
  if (opts.axisLock) {
    if (Math.abs(dx) >= Math.abs(dy)) dy = 0;
    else dx = 0;
  }
  let moved = from.map((p) => ({ x: p.x + dx, y: p.y + dy }));
  const snapped = { x: false, y: false };
  if (opts.reach && moved.length) {
    const g = groupBounds(moved, sizes);
    // Only along a way it's moving, so Shift's straight line stays straight.
    const ox = opts.axisLock && dx === 0 ? null : snapOffset([g.cx, ...moved.map((p) => p.x)], opts.reach.x);
    const oy = opts.axisLock && dy === 0 ? null : snapOffset([g.cy, ...moved.map((p) => p.y)], opts.reach.y);
    if (ox !== null) snapped.x = true;
    if (oy !== null) snapped.y = true;
    moved = moved.map((p) => ({ x: p.x + (ox ?? 0), y: p.y + (oy ?? 0) }));
  }
  return { places: moved.map((p) => ({ x: clamp(p.x, 0, 1), y: clamp(p.y, 0, 1) })), snapped };
}

/** Centres the blocks together on the cover, across or up and down, keeping their places to each other. */
export function centreBlocks(places: Place[], sizes: Size[], axis: "x" | "y"): Place[] {
  if (!places.length) return places;
  const g = groupBounds(places, sizes);
  const off = 0.5 - (axis === "x" ? g.cx : g.cy);
  return places.map((p) => (axis === "x" ? { x: clamp(p.x + off, 0, 1), y: p.y } : { x: p.x, y: clamp(p.y + off, 0, 1) }));
}

// Moving the words on a cover by hand (embre, 3 November 2026): one block or
// several at once, Shift to keep to one direction, and a snap to the middle
// of the cover, across and up and down, for each block and for the group.
// Places are block centres as shares of the cover's width and height.
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
/** The box around several blocks, in shares of the cover. */
export function groupBounds(places, sizes) {
    const left = Math.min(...places.map((p, i) => p.x - sizes[i].w / 2));
    const right = Math.max(...places.map((p, i) => p.x + sizes[i].w / 2));
    const top = Math.min(...places.map((p, i) => p.y - sizes[i].h / 2));
    const bottom = Math.max(...places.map((p, i) => p.y + sizes[i].h / 2));
    return { left, right, top, bottom, cx: (left + right) / 2, cy: (top + bottom) / 2 };
}
/** The nearest way to bring one of `centres` onto the middle, if it's within `reach`. */
function snapOffset(centres, reach) {
    let best = null;
    for (const c of centres) {
        const off = 0.5 - c;
        if (Math.abs(off) <= reach && (best === null || Math.abs(off) < Math.abs(best)))
            best = off;
    }
    return best;
}
/**
 * Where the moving span could sit so the gaps around it match (embre,
 * 3 November 2026): halfway between two others, or as far from its
 * neighbour as that neighbour is from the next. Returns the nearest such
 * move within `reach`.
 */
function spacingSnap(moving, others, reach) {
    const size = moving.hi - moving.lo;
    const sorted = [...others].sort((p, q) => p.lo - q.lo);
    const options = [];
    for (let i = 0; i < sorted.length; i++) {
        for (let j = i + 1; j < sorted.length; j++) {
            const [first, second] = [sorted[i], sorted[j]];
            const gap = second.lo - first.hi;
            // Halfway between the two.
            const room = second.lo - first.hi - size;
            if (room > 0) {
                const lo = first.hi + room / 2;
                options.push({ offset: lo - moving.lo, gaps: [{ a: first.hi, b: lo }, { a: lo + size, b: second.lo }] });
            }
            if (gap > 0) {
                // After the second, as far as the second is from the first.
                const after = second.hi + gap;
                options.push({ offset: after - moving.lo, gaps: [{ a: first.hi, b: second.lo }, { a: second.hi, b: after }] });
                // Before the first, likewise.
                const before = first.lo - gap - size;
                options.push({ offset: before - moving.lo, gaps: [{ a: before + size, b: first.lo }, { a: first.hi, b: second.lo }] });
            }
        }
    }
    let best = null;
    for (const o of options)
        if (Math.abs(o.offset) <= reach && (!best || Math.abs(o.offset) < Math.abs(best.offset)))
            best = o;
    return best;
}
/**
 * Moves blocks that started at `from` by (dx, dy), given as shares of the
 * cover. With `axisLock`, only along the way it has moved most. With `reach`,
 * a block's centre or the group's centre within that share of the middle
 * snaps onto it, and so does an even spacing with the `others` (the blocks
 * not being moved): halfway between two of them, or as far from one as it is
 * from the next.
 */
export function dragBlocks(from, sizes, dx, dy, opts) {
    if (opts.axisLock) {
        if (Math.abs(dx) >= Math.abs(dy))
            dy = 0;
        else
            dx = 0;
    }
    let moved = from.map((p) => ({ x: p.x + dx, y: p.y + dy }));
    const snapped = { x: false, y: false };
    const gaps = [];
    if (opts.reach && moved.length) {
        const g = groupBounds(moved, sizes);
        const others = opts.others ?? [];
        const spans = (axis) => others.map((o) => (axis === "x" ? { lo: o.place.x - o.size.w / 2, hi: o.place.x + o.size.w / 2 } : { lo: o.place.y - o.size.h / 2, hi: o.place.y + o.size.h / 2 }));
        const offsets = { x: 0, y: 0 };
        for (const axis of ["x", "y"]) {
            // Only along a way it's moving, so Shift's straight line stays straight.
            if (opts.axisLock && (axis === "x" ? dx : dy) === 0)
                continue;
            const reach = opts.reach[axis];
            const middle = snapOffset(axis === "x" ? [g.cx, ...moved.map((p) => p.x)] : [g.cy, ...moved.map((p) => p.y)], reach);
            const span = axis === "x" ? { lo: g.left, hi: g.right } : { lo: g.top, hi: g.bottom };
            const spacing = spacingSnap(span, spans(axis), reach);
            if (middle !== null && (!spacing || Math.abs(middle) <= Math.abs(spacing.offset))) {
                offsets[axis] = middle;
                snapped[axis] = true;
            }
            else if (spacing) {
                offsets[axis] = spacing.offset;
                const at = axis === "x" ? g.cy + offsets.y : g.cx + offsets.x;
                for (const gap of spacing.gaps)
                    gaps.push({ axis, ...gap, at });
            }
        }
        moved = moved.map((p) => ({ x: p.x + offsets.x, y: p.y + offsets.y }));
    }
    return { places: moved.map((p) => ({ x: clamp(p.x, 0, 1), y: clamp(p.y, 0, 1) })), snapped, gaps };
}
/** Centres the blocks together on the cover, across or up and down, keeping their places to each other. */
export function centreBlocks(places, sizes, axis) {
    if (!places.length)
        return places;
    const g = groupBounds(places, sizes);
    const off = 0.5 - (axis === "x" ? g.cx : g.cy);
    return places.map((p) => (axis === "x" ? { x: clamp(p.x + off, 0, 1), y: p.y } : { x: p.x, y: clamp(p.y + off, 0, 1) }));
}

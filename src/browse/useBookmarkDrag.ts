// Arranging bookmarks: with a mouse, drag a row; on a touch screen, hold a
// row a moment, then slide it. Rows and folders say what they are with
// `data-drop` ("mark:<id>", "folder:<id>" or "end:<folder id or empty>").

import { useEffect, useRef, useState } from "react";

const HOLD_MS = 350;
const SLOP = 6;

export interface Drop {
  /** What it was let go over. */
  target: string;
  /** Over the top part of a folder row: before it, not into it. */
  upper: boolean;
}

interface Press {
  item: string;
  x: number;
  y: number;
  touch: boolean;
  lifted: boolean;
  timer: number | null;
}

export function useBookmarkDrag(onDrop: (item: string, drop: Drop) => void) {
  const press = useRef<Press | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
  const [over, setOver] = useState<Drop | null>(null);
  const overRef = useRef<Drop | null>(null);
  const swallow = useRef(false);
  const drop = useRef(onDrop);
  drop.current = onDrop;

  useEffect(() => {
    const at = (x: number, y: number): Drop | null => {
      const element = document.elementFromPoint(x, y)?.closest("[data-drop]") as HTMLElement | null;
      if (!element?.dataset.drop) return null;
      const box = element.getBoundingClientRect();
      return { target: element.dataset.drop, upper: y < box.top + box.height * 0.3 };
    };
    const end = () => {
      const p = press.current;
      press.current = null;
      if (!p) return;
      if (p.timer !== null) clearTimeout(p.timer);
      if (p.lifted) {
        swallow.current = true;
        setTimeout(() => (swallow.current = false), 0);
        const where = overRef.current;
        if (where && where.target !== p.item) drop.current(p.item, where);
      }
      overRef.current = null;
      setMoving(null);
      setOver(null);
    };
    const moved = (e: PointerEvent) => {
      const p = press.current;
      if (!p) return;
      const far = Math.hypot(e.clientX - p.x, e.clientY - p.y) > SLOP;
      if (!p.lifted) {
        if (!far) return;
        if (p.touch) return end(); // Moved before the hold: a scroll.
        p.lifted = true;
        setMoving(p.item);
      }
      const where = at(e.clientX, e.clientY);
      if (where?.target !== overRef.current?.target || where?.upper !== overRef.current?.upper) {
        overRef.current = where;
        setOver(where);
      }
    };
    const touchMoved = (e: TouchEvent) => {
      if (press.current?.lifted) e.preventDefault();
    };
    window.addEventListener("pointermove", moved);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    window.addEventListener("touchmove", touchMoved, { passive: false });
    return () => {
      window.removeEventListener("pointermove", moved);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      window.removeEventListener("touchmove", touchMoved);
    };
  }, []);

  /** For something that can be picked up (and is also a place to drop onto). */
  const handle = (item: string) => ({
    "data-drop": item,
    "data-moving": moving === item ? "" : undefined,
    "data-over": over?.target === item && moving !== null && moving !== item ? (over.upper ? "before" : "on") : undefined,
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0 || (e.target as HTMLElement).closest("input, .no-drag")) return;
      const touch = e.pointerType !== "mouse";
      const p: Press = { item, x: e.clientX, y: e.clientY, touch, lifted: false, timer: null };
      if (touch)
        p.timer = window.setTimeout(() => {
          p.timer = null;
          p.lifted = true;
          setMoving(item);
          navigator.vibrate?.(10);
        }, HOLD_MS);
      press.current = p;
    },
    onClickCapture: (e: React.MouseEvent) => {
      if (!swallow.current) return;
      e.preventDefault();
      e.stopPropagation();
    },
    onContextMenu: (e: React.MouseEvent) => {
      if (press.current?.touch) e.preventDefault();
    },
    onDragStart: (e: React.DragEvent) => e.preventDefault(),
  });
  /** Somewhere to drop that isn't picked up (a folder in the tree, the end of a list). */
  const target = (place: string) => ({
    "data-drop": place,
    "data-over": over?.target === place && moving !== null ? (over.upper && place.startsWith("folder:") ? "before" : "on") : undefined,
  });
  return { handle, target, moving };
}

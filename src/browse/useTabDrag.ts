// Putting Discover's tabs in your own order: with a mouse, drag a tab onto
// another; on a touch screen, hold a tab a moment, then slide it there.

import { useEffect, useRef, useState } from "react";

/** How long a finger holds still before the tab lifts. */
const HOLD_MS = 350;
/** Movement that starts a mouse drag, or cancels a hold (it was a scroll). */
const SLOP = 6;

interface Press {
  id: string;
  x: number;
  y: number;
  touch: boolean;
  lifted: boolean;
  timer: number | null;
}

export function useTabDrag(onMove: (id: string, before: string) => void) {
  const press = useRef<Press | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const overRef = useRef<string | null>(null);
  /** A drag just ended: the click that follows doesn't open the tab. */
  const swallow = useRef(false);
  const move = useRef(onMove);
  move.current = onMove;

  useEffect(() => {
    const target = (x: number, y: number) => (document.elementFromPoint(x, y)?.closest("[data-tab-id]") as HTMLElement | null)?.dataset.tabId ?? null;
    const end = () => {
      const p = press.current;
      press.current = null;
      if (!p) return;
      if (p.timer !== null) clearTimeout(p.timer);
      if (p.lifted) {
        swallow.current = true;
        setTimeout(() => (swallow.current = false), 0);
        if (overRef.current && overRef.current !== p.id) move.current(p.id, overRef.current);
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
        setMoving(p.id);
      }
      const at = target(e.clientX, e.clientY);
      if (at !== overRef.current) {
        overRef.current = at;
        setOver(at);
      }
    };
    // While a tab is lifted the finger moves it, not the page.
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

  return (id: string) => ({
    "data-tab-id": id,
    "data-moving": moving === id ? "" : undefined,
    "data-drop": over === id && moving !== null && moving !== id ? "" : undefined,
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      const touch = e.pointerType !== "mouse";
      const p: Press = { id, x: e.clientX, y: e.clientY, touch, lifted: false, timer: null };
      if (touch)
        p.timer = window.setTimeout(() => {
          p.timer = null;
          p.lifted = true;
          setMoving(id);
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
      // A hold on a touch screen is for moving the tab, not a menu.
      if (press.current?.touch) e.preventDefault();
    },
  });
}

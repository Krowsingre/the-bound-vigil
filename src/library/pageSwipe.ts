// Page turns in Paged mode on a computer (embre, 21 November): a swipe on a
// touch screen, a two-finger swipe on a touchpad, or tilting the mouse wheel.
// Swiping left (or tilting right) is the next page. Touchpad and wheel tilt
// arrive as sideways scrolling, already turned the way Windows' own scrolling
// setting says, so that setting is followed. One page per gesture; anything
// that scrolls sideways by itself (a row of covers) keeps its own gesture.

import { useEffect, useRef, type RefObject } from "react";

/** Sideways scrolling needed before a page turns. */
const WHEEL_DISTANCE = 60;
/** A pause this long between scroll events starts a new gesture. */
const WHEEL_GAP_MS = 150;
/** The least time between two turns, so one swipe never turns two pages. */
const TURN_GAP_MS = 300;

/**
 * Sideways scrolling, turned into page turns (embre, 21 November). After a
 * turn, Windows keeps sending a touchpad's glide for a while after the fingers
 * lift, shrinking as it slows; waiting for that to stop made a quick second
 * swipe do nothing. A new swipe speeds up instead, so scrolling that grows
 * again starts a new gesture straight away (embre, 27 November).
 */
export function wheelTurner() {
  let sideways = 0;
  let armed = true;
  let lastAt = -Infinity;
  let lastSize = 0;
  let turnedAt = -Infinity;
  /** Whether the scrolling has slowed since the last turn: only then can a speed-up be a new swipe. */
  let slowed = false;
  /** One sideways scroll event: 1 next, -1 back, 0 nothing. */
  return (deltaX: number, at: number): -1 | 0 | 1 => {
    const size = Math.abs(deltaX);
    if (at - lastAt > WHEEL_GAP_MS) {
      // A pause: a new gesture.
      armed = true;
      sideways = 0;
    } else if (!armed && slowed && size > lastSize * 1.5 && size >= 8) {
      // Speeding up again after the glide began: a new swipe, not the old one's glide.
      // A swipe still speeding up when it turned the page hasn't slowed, so it can't re-arm.
      armed = true;
      sideways = 0;
    } else if (!armed && size < lastSize) {
      slowed = true;
    }
    lastAt = at;
    lastSize = size;
    if (!armed) return 0;
    sideways += deltaX;
    if (Math.abs(sideways) < WHEEL_DISTANCE || at - turnedAt < TURN_GAP_MS) return 0;
    armed = false;
    slowed = false;
    turnedAt = at;
    const step = sideways > 0 ? 1 : -1;
    sideways = 0;
    return step;
  };
}
/** A touch swipe: at least this far, and mostly sideways. */
const SWIPE_DISTANCE = 60;

/** Whether this element, or one between it and `root`, scrolls sideways or takes typing. */
export function keepsOwnGesture(target: EventTarget | null, root: Element): boolean {
  for (let el = target instanceof Element ? target : null; el && el !== root; el = el.parentElement) {
    if (el.matches("input, textarea, select, [contenteditable='true'], [role='slider'], dialog, [role='dialog'], [role='menu']")) return true;
    if (el.scrollWidth > el.clientWidth + 1) {
      const overflow = getComputedStyle(el).overflowX;
      if (overflow === "auto" || overflow === "scroll") return true;
    }
  }
  return false;
}

/** Which way a touch swipe turns: 1 next, -1 back, 0 none. */
export function swipeTurn(dx: number, dy: number): -1 | 0 | 1 {
  if (Math.abs(dx) < SWIPE_DISTANCE || Math.abs(dx) < Math.abs(dy) * 1.5) return 0;
  return dx < 0 ? 1 : -1;
}

/**
 * Turns pages in `root` by `step` (1 next, -1 back) while `enabled`.
 * `turn` returns nothing; it does nothing past the first or last page.
 */
export function usePageSwipe(root: RefObject<HTMLElement | null>, enabled: boolean, turn: (step: 1 | -1) => void) {
  const latest = useRef(turn);
  latest.current = turn;

  useEffect(() => {
    const el = root.current;
    if (!enabled || !el) return;
    const wheel = wheelTurner();
    const onWheel = (e: WheelEvent) => {
      // Mostly up and down: ordinary scrolling.
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY) || e.ctrlKey) return;
      if (keepsOwnGesture(e.target, el)) return;
      e.preventDefault();
      // Lines or pages of scrolling (some mice) count as a full turn.
      const step = wheel(e.deltaMode === 0 ? e.deltaX : Math.sign(e.deltaX) * WHEEL_DISTANCE, e.timeStamp);
      if (step) latest.current(step);
    };

    let start: { x: number; y: number } | null = null;
    const onTouchStart = (e: TouchEvent) => {
      start = e.touches.length === 1 && !keepsOwnGesture(e.target, el) ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (!start || e.changedTouches.length !== 1) return;
      const t = e.changedTouches[0];
      const step = swipeTurn(t.clientX - start.x, t.clientY - start.y);
      start = null;
      if (step) latest.current(step);
    };
    const onTouchCancel = () => {
      start = null;
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    el.addEventListener("touchcancel", onTouchCancel, { passive: true });
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchCancel);
    };
  }, [root, enabled]);
}

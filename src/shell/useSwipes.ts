import { useEffect, type RefObject } from "react";

/** How far down the screen a pull from the top bar must reach to go Home. */
export const PULL_HOME = 0.8;

export interface Swipes {
  /** Finger moved right to left. */
  onLeft?: () => void;
  /** Finger moved left to right. */
  onRight?: () => void;
  /** Pulled from the top bar most of the way down the screen. */
  onPullDown?: () => void;
}

/** Whether something under the finger scrolls sideways, or takes the swipe itself. */
function takesSideways(target: Element | null, root: Element): boolean {
  for (let el = target; el && el !== root; el = el.parentElement) {
    if (el.matches("input, textarea, select, [role=slider], [role=dialog], .menu, .sidebar")) return true;
    if (el.scrollWidth > el.clientWidth + 1) {
      const overflow = getComputedStyle(el).overflowX;
      if (overflow === "auto" || overflow === "scroll") return true;
    }
  }
  return false;
}

/**
 * Phone swipes on `root`. A sideways swipe counts when the finger moves
 * mostly sideways and either a third of the screen or quickly; anything
 * else is left to scroll. A pull down counts only when it starts in the top
 * bar and ends 80% of the way down. `pull` is drawn while pulling.
 */
export function useSwipes(root: RefObject<HTMLElement | null>, pull: RefObject<HTMLElement | null>, enabled: boolean, swipes: Swipes) {
  const { onLeft, onRight, onPullDown } = swipes;
  useEffect(() => {
    const el = root.current;
    if (!enabled || !el) return;
    let start: { x: number; y: number; at: number; sideways: boolean; fromTop: boolean } | null = null;

    const showPull = (reach: number | null) => {
      const shown = pull.current;
      if (!shown) return;
      shown.style.opacity = reach === null ? "0" : String(Math.min(1, reach / PULL_HOME));
      shown.classList.toggle("is-ready", reach !== null && reach >= PULL_HOME);
    };

    const down = (e: TouchEvent) => {
      if (e.touches.length !== 1) {
        start = null;
        showPull(null);
        return;
      }
      const t = e.touches[0];
      const target = e.target as Element;
      start = {
        x: t.clientX,
        y: t.clientY,
        at: e.timeStamp,
        sideways: (!!onLeft || !!onRight) && !takesSideways(target, el),
        fromTop: !!onPullDown && !!target.closest(".header") && !target.closest(".menu"),
      };
    };

    const move = (e: TouchEvent) => {
      if (!start?.fromTop) return;
      const t = e.touches[0];
      const dy = t.clientY - start.y;
      showPull(dy > 24 && dy > Math.abs(t.clientX - start.x) ? t.clientY / window.innerHeight : null);
    };

    const up = (e: TouchEvent) => {
      const began = start;
      start = null;
      showPull(null);
      const t = e.changedTouches[0];
      if (!began || !t) return;
      const dx = t.clientX - began.x;
      const dy = t.clientY - began.y;
      if (began.fromTop && dy > 0 && dy > Math.abs(dx) * 1.5 && t.clientY >= window.innerHeight * PULL_HOME) {
        onPullDown?.();
        return;
      }
      if (!began.sideways || Math.abs(dx) < Math.abs(dy) * 2) return;
      const speed = Math.abs(dx) / Math.max(1, e.timeStamp - began.at);
      if (Math.abs(dx) < window.innerWidth / 3 && !(Math.abs(dx) > 60 && speed > 0.5)) return;
      if (dx < 0) onLeft?.();
      else onRight?.();
    };

    const cancel = () => {
      start = null;
      showPull(null);
    };

    el.addEventListener("touchstart", down, { passive: true });
    el.addEventListener("touchmove", move, { passive: true });
    el.addEventListener("touchend", up);
    el.addEventListener("touchcancel", cancel);
    return () => {
      el.removeEventListener("touchstart", down);
      el.removeEventListener("touchmove", move);
      el.removeEventListener("touchend", up);
      el.removeEventListener("touchcancel", cancel);
    };
  }, [root, pull, enabled, onLeft, onRight, onPullDown]);
}

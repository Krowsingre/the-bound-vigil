import { useEffect, useRef } from "react";

type Motion = { direction: 1 | -1; start: number; previous: number; held: boolean; carry: number };
const TAP_MS = 95;

export function useKeyboardScroll(scroll: (pixels: number) => void, speed: number, enabled: boolean) {
  const motion = useRef<Motion | null>(null);
  const frame = useRef(0);

  const stop = () => {
    motion.current = null;
    cancelAnimationFrame(frame.current);
  };

  useEffect(() => {
    if (!enabled) return;
    window.addEventListener("blur", stop);
    document.addEventListener("visibilitychange", stop);
    return () => {
      stop();
      window.removeEventListener("blur", stop);
      document.removeEventListener("visibilitychange", stop);
    };
  }, [enabled]);

  const tick = (now: number) => {
    const current = motion.current;
    if (!current) return;
    const end = current.held ? now : Math.min(now, current.start + TAP_MS);
    current.carry += Math.max(0, Math.min(32, end - current.previous)) * speed / 1000;
    current.previous = now;
    const pixels = Math.floor(current.carry);
    current.carry -= pixels;
    if (pixels) scroll(pixels * current.direction);
    if (current.held || now < current.start + TAP_MS) frame.current = requestAnimationFrame(tick);
    else motion.current = null;
  };

  return {
    press(direction: 1 | -1, repeat: boolean) {
      if (!enabled || repeat || motion.current?.held && motion.current.direction === direction) return;
      stop();
      const now = performance.now();
      motion.current = { direction, start: now, previous: now, held: true, carry: 0 };
      frame.current = requestAnimationFrame(tick);
    },
    release(event: KeyboardEvent) {
      const current = motion.current;
      const key = current?.direction === 1 ? "ArrowDown" : "ArrowUp";
      if (!current || event.key !== key) return;
      if (performance.now() - current.start >= TAP_MS) stop();
      else current.held = false;
    },
  };
}

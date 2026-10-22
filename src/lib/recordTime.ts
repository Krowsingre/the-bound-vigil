// Records time spent reading and listening as it happens (see timeSpent.ts).

import { api } from "../api";
import { dayOf } from "./timeSpent";

/** How often recorded time is sent to be saved. */
const SAVE_EVERY_MS = 30_000;
/** How often the clock is checked; a longer gap (the computer slept) counts only this much. */
const CHECK_EVERY_MS = 5_000;

/**
 * Counts time while `counting()` is true, saving it every half a minute and
 * when stopped or the page is hidden. Returns the stop function.
 *
 * `longestGapMs` is the most one check may add: timers slow down in the
 * background, which matters for listening, where the screen may be off.
 */
export function recordTime(kind: "read" | "listen", counting: () => boolean, longestGapMs = CHECK_EVERY_MS * 2): () => void {
  let last = Date.now();
  let pendingMs = 0;
  let lastSave = last;
  const check = () => {
    const now = Date.now();
    if (counting()) pendingMs += Math.min(now - last, longestGapMs);
    last = now;
  };
  const save = () => {
    check();
    lastSave = Date.now();
    const seconds = Math.floor(pendingMs / 1000);
    if (seconds < 1) return;
    pendingMs -= seconds * 1000;
    api.addTime(dayOf(), kind, seconds).catch(() => undefined);
  };
  const timer = window.setInterval(() => {
    check();
    if (Date.now() - lastSave >= SAVE_EVERY_MS) save();
  }, CHECK_EVERY_MS);
  const hidden = () => {
    if (document.visibilityState === "hidden") save();
  };
  document.addEventListener("visibilitychange", hidden);
  window.addEventListener("pagehide", save);
  return () => {
    window.clearInterval(timer);
    document.removeEventListener("visibilitychange", hidden);
    window.removeEventListener("pagehide", save);
    save();
  };
}

/** Reading counts while the reader is on screen and was used in the last ten minutes. */
const IDLE_AFTER_MS = 10 * 60_000;
let lastReading = 0;

/** Something happened in the reader: a page turned, a key, a tap. */
export function noteReading() {
  lastReading = Date.now();
}

/** Counts reading while the reader is open; returns the stop function. */
export function recordReading(): () => void {
  noteReading();
  const seen = () => noteReading();
  const events = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
  events.forEach((e) => window.addEventListener(e, seen, { passive: true }));
  const stop = recordTime("read", () => document.visibilityState === "visible" && Date.now() - lastReading < IDLE_AFTER_MS);
  return () => {
    events.forEach((e) => window.removeEventListener(e, seen));
    stop();
  };
}

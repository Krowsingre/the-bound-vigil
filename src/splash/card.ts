// The splash card on a computer, in its own small window. The main window
// tells it how far opening has got, and when to go: breaking up as the
// iPhone's does, or fading with Reduce motion on.

import "@fontsource/gelasio/400.css";
import { disintegrate } from "./disintegrate";
import { setSplash, showSplash } from "./splashView";

const card = showSplash(true);
let leaving = false;

if ("__TAURI_INTERNALS__" in window) {
  void import("@tauri-apps/api/event").then(({ listen }) =>
    listen<{ progress: number; label: string | null; done: boolean; still: boolean }>("tbv://splash", ({ payload }) => {
      if (leaving) return;
      setSplash(card, payload.progress, payload.label ?? "Loading…");
      if (!payload.done) return;
      leaving = true;
      const fade = () => card.classList.add("is-leaving");
      // The card's window goes once the last page has fallen out of it (embre, 28 November);
      // TBV closes it anyway after a while, should this never say so.
      const gone = () => void import("@tauri-apps/api/core").then(({ invoke }) => invoke("splash_finished")).catch(() => undefined);
      if (payload.still) fade();
      // Slower than the iPhone's, and only once the window behind has drawn itself,
      // so it plays out whole and smoothly (embre, 28 November).
      else void disintegrate(card, { pace: 1.7, hold: 350 }).then(gone, fade);
    }),
  );
}

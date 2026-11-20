// The splash card on a computer, in its own small window. The main window
// tells it how far opening has got. It tells TBV where it sits and which
// painting it shows, so the main window can draw a copy of it at the same
// spot and glide its emblem, name and tagline into the side bar (glide.ts).
// If that can't happen it settles away by itself, or fades with Reduce motion on.

import "@fontsource/gelasio/400.css";
import { settle } from "./settle";
import { setSplash, showSplash } from "./splashView";

const card = showSplash(true);
let leaving = false;

if ("__TAURI_INTERNALS__" in window) {
  // Once laid out, so the spot is where it's drawn.
  requestAnimationFrame(() => {
    const r = card.getBoundingClientRect();
    void import("@tauri-apps/api/core").then(({ invoke }) =>
      invoke("splash_card", {
        card: { left: r.left, top: r.top, width: r.width, height: r.height, painting: card.dataset.painting ?? null },
      }).catch(() => undefined),
    );
  });
  void import("@tauri-apps/api/event").then(({ listen }) =>
    listen<{ progress: number; label: string | null; done: boolean; still: boolean }>("tbv://splash", ({ payload }) => {
      if (leaving) return;
      setSplash(card, payload.progress, payload.label ?? "Loading…");
      if (!payload.done) return;
      leaving = true;
      const fade = () => card.classList.add("is-leaving");
      if (payload.still) fade();
      else void settle(card);
    }),
  );
}

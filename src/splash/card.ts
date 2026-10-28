// The splash card on a computer, in its own small window. The main window
// tells it how far opening has got, and when to fade.

import "@fontsource/gelasio/400.css";
import { setSplash, showSplash } from "./splashView";

const card = showSplash(true);

if ("__TAURI_INTERNALS__" in window) {
  void import("@tauri-apps/api/event").then(({ listen }) =>
    listen<{ progress: number; label: string | null; done: boolean }>("tbv://splash", ({ payload }) => {
      setSplash(card, payload.progress, payload.label ?? "Loading…");
      if (payload.done) card.classList.add("is-leaving");
    }),
  );
}

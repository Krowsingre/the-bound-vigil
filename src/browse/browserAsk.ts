// Other pages asking Discover to show something: Sanctum's Quick Links open
// a website there, or one of its panels. Discover may not be open yet, so
// the ask waits here until the browser is ready for it.

import type { StartPanel } from "./StartPage";

export type BrowserAsk = { panel: StartPanel } | { url: string } | { home: true };

const ASKED = "tbv:browser-ask";
let waiting: BrowserAsk | null = null;

/** Asks Discover; open Discover after this. */
export function askBrowser(ask: BrowserAsk) {
  waiting = ask;
  window.dispatchEvent(new CustomEvent(ASKED));
}

/** The browser takes what was asked, once, now and whenever more is. */
export function onBrowserAsk(take: (ask: BrowserAsk) => void): () => void {
  const heard = () => {
    const ask = waiting;
    waiting = null;
    if (ask) take(ask);
  };
  heard();
  window.addEventListener(ASKED, heard);
  return () => window.removeEventListener(ASKED, heard);
}

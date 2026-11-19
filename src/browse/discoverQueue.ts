// Pages asked for from elsewhere in TBV (the reader's Search, Sanctum's
// watched books), opened as new tabs when Discover shows. Kept apart from
// Browser.tsx so asking doesn't load the whole browser.

export const waiting: string[] = [];
export const WAITING = "tbv:browser-waiting";

export function openInDiscover(url: string) {
  waiting.push(url);
  window.dispatchEvent(new Event(WAITING));
}

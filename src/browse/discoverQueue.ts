// Pages asked for from elsewhere in TBV (the reader's Search, Sanctum's
// watched books), opened as new tabs when Discover shows. Kept apart from
// Browser.tsx so asking doesn't load the whole browser.

export const waiting: string[] = [];
export const WAITING = "tbv:browser-waiting";

export function openInDiscover(url: string) {
  waiting.push(url);
  window.dispatchEvent(new Event(WAITING));
}

/** A tab to bring to the front when Discover shows (a popped-out video brought back). */
export const tabWaiting: { id: string | null } = { id: null };
export const TAB_WAITING = "tbv:browser-tab-waiting";

export function showTabInDiscover(id: string) {
  tabWaiting.id = id;
  window.dispatchEvent(new Event(TAB_WAITING));
}

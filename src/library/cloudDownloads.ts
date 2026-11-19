// Cloud books coming down to this device, so each can be stopped: from the
// toast that says it started, or from its menu while it runs.

import { useSyncExternalStore } from "react";

/** What a stopped download ends with. */
export const STOPPED = "Stopped.";
export const wasStopped = (error: unknown) => String(error).replace(/^Error:\s*/, "") === STOPPED;

const running = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;

function changed() {
  version += 1;
  listeners.forEach((listener) => listener());
}

/** Remembers a book as coming down until `work` ends. */
export function tracked(bookId: string, work: Promise<void>): Promise<void> {
  running.add(bookId);
  changed();
  return work.finally(() => {
    running.delete(bookId);
    changed();
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Re-renders the caller whenever a download starts or ends, so book menus
 *  offer Stop download (or Download again) at the right time. */
export function useDownloadsChanging(): number {
  return useSyncExternalStore(subscribe, () => version, () => version);
}

export const isDownloading = (bookId: string) => running.has(bookId);

/** The name a cloud book's download is stopped by. */
export const bookDownload = (bookId: string) => `book:${bookId}`;

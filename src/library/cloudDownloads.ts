// Cloud books coming down to this device, so each can be stopped: from the
// toast that says it started, or from its menu while it runs.

/** What a stopped download ends with. */
export const STOPPED = "Stopped.";
export const wasStopped = (error: unknown) => String(error).replace(/^Error:\s*/, "") === STOPPED;

const running = new Set<string>();

/** Remembers a book as coming down until `work` ends. */
export function tracked(bookId: string, work: Promise<void>): Promise<void> {
  running.add(bookId);
  return work.finally(() => running.delete(bookId));
}

export const isDownloading = (bookId: string) => running.has(bookId);

/** The name a cloud book's download is stopped by. */
export const bookDownload = (bookId: string) => `book:${bookId}`;

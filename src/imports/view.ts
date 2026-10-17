import type { ImportItem, ImportsView } from "../api/types";

/** The Imports page's view of a whole list, as the app builds it (for the preview and tests). */
export function importsViewOf(items: ImportItem[], show = 100): ImportsView {
  const done = items.filter((i) => i.stage === "done");
  const count = (outcome: string) => done.filter((i) => i.result?.outcome === outcome).length;
  const added = done.filter((i) => i.result?.outcome === "imported");
  const failed = done.flatMap((i) => (i.result?.outcome === "failed" ? [i.result.reason] : []));
  const current = items.filter((i) => i.stage === "reading" || i.stage === "adding");
  const waiting = items.filter((i) => i.stage === "waiting");
  const only = added.length === 1 ? added[0].result : null;
  return {
    total: items.length,
    done: done.length,
    added: added.length,
    already: count("alreadyInLibrary"),
    unsupported: count("unsupported"),
    failed: failed.length,
    onlyAdded: only && "title" in only ? only.title : null,
    onlyFailure: failed.length === 1 ? failed[0] : null,
    waitingCount: waiting.length,
    current,
    waiting: waiting.slice(0, show),
    finished: done.reverse().slice(0, show),
    currentRead: current.reduce((sum, i) => sum + i.bytesRead, 0),
    currentBytes: current.reduce((sum, i) => sum + i.bytes, 0),
    pdfCovers: 0,
  };
}

export const NO_IMPORTS: ImportsView = importsViewOf([]);

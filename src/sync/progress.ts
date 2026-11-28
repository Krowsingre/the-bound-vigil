// How far a sync has got, as a fraction and a counter (embre, 28 November):
// "Changes: 1,240 of 43,729 sent", "Files: 120 of 2,340". Shared by the sync
// menu and Activity › Sync.

import type { PlaceActivity, SyncActivity } from "../api/types";

export interface SyncProgress {
  /** 0 to 1, or null while there's nothing to count against (receiving). */
  fraction: number | null;
  text: string;
}

const n = (value: number) => value.toLocaleString();

/** One place's progress in the step it's on, or null when it isn't running. */
export function placeProgress(place: PlaceActivity): SyncProgress | null {
  if (place.finished) return null;
  if (place.step === "receiving") return { fraction: null, text: place.received ? `Getting changes: ${n(place.received)} received` : "Getting changes…" };
  if (place.step === "sending") {
    const total = Math.max(place.toSend, place.sent);
    if (!total) return { fraction: null, text: "Sending changes…" };
    return { fraction: place.sent / total, text: `Changes: ${n(place.sent)} of ${n(total)} sent` };
  }
  if (place.step === "files") {
    if (!place.filesTotal) return { fraction: null, text: "Checking files…" };
    return { fraction: place.filesDone / place.filesTotal, text: `Files: ${n(place.filesDone)} of ${n(place.filesTotal)}` };
  }
  return { fraction: null, text: "Connecting…" };
}

/** The progress the sync menu shows: the first place still going. */
export function runProgress(activity: SyncActivity): SyncProgress | null {
  for (const place of activity.places) {
    const progress = placeProgress(place);
    if (progress) return progress;
  }
  return null;
}

/** A fraction as a whole percent, never 100% before it's done. */
export function percentOf(fraction: number): string {
  return `${Math.min(99, Math.floor(fraction * 100))}%`;
}

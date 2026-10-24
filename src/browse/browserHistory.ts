// Discover's history: the pages visited and the words searched for, for as
// long as Preferences › Discover says. The library keeps it (and syncs it
// when Preferences › Sync says so); a copy here is read straight away.

import { api } from "../api";
import type { HistoryEntry } from "../api/types";

export type { HistoryEntry };

/** Every change goes to the library too; outside the app (previews) there's none to tell. */
const tell = (done: Promise<void>) => void done.catch(() => undefined);

export type HistoryKeep = "forever" | "day" | "week" | "month" | "quarter";

export const HISTORY_KEEPS: { value: HistoryKeep; label: string; days: number | null }[] = [
  { value: "day", label: "A day", days: 1 },
  { value: "week", label: "A week", days: 7 },
  { value: "month", label: "A month", days: 30 },
  { value: "quarter", label: "Three months", days: 91 },
  { value: "forever", label: "Until you clear it", days: null },
];

const KEY = "tbv.browser.history";
const CHANGED = "tbv:browser-history";
/** Past this the oldest go, so the list stays quick to load. */
export const MOST_HISTORY = 5000;
const DAY = 86_400_000;

export function readHistory(): HistoryEntry[] {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "[]") as unknown;
    if (!Array.isArray(saved)) return [];
    return saved.filter(
      (e): e is HistoryEntry =>
        !!e && typeof e.id === "string" && (e.kind === "page" || e.kind === "search") && typeof e.url === "string" && typeof e.at === "number",
    );
  } catch {
    return [];
  }
}

function save(list: HistoryEntry[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MOST_HISTORY)));
  } catch {
    // Full or unavailable: kept as it was.
  }
  window.dispatchEvent(new CustomEvent(CHANGED));
}

export function onHistory(listener: () => void): () => void {
  window.addEventListener(CHANGED, listener);
  return () => window.removeEventListener(CHANGED, listener);
}

/** Leaves out what's older than `keep` allows. */
export function trimmed(list: HistoryEntry[], keep: HistoryKeep, now = Date.now()): HistoryEntry[] {
  const days = HISTORY_KEEPS.find((k) => k.value === keep)?.days ?? null;
  return days === null ? list : list.filter((e) => now - e.at < days * DAY);
}

/** The oldest time `keep` keeps, or null for keeping everything. */
const keptFrom = (keep: HistoryKeep, now: number) => {
  const days = HISTORY_KEEPS.find((k) => k.value === keep)?.days ?? null;
  return days === null ? null : now - days * DAY;
};

/**
 * Adds a visit or a search, newest first. The same page again straight
 * after (a reload, or its title arriving) updates the entry already there.
 */
export function addToHistory(entry: Omit<HistoryEntry, "id" | "at">, keep: HistoryKeep, now = Date.now()) {
  const all = readHistory();
  const list = trimmed(all, keep, now);
  const from = keptFrom(keep, now);
  if (list.length !== all.length && from !== null) tell(api.trimBrowserHistory(from));
  const last = list[0];
  if (last && last.kind === entry.kind && last.url === entry.url) {
    list[0] = { ...last, title: entry.title ?? last.title, at: now };
  } else {
    list.unshift({ ...entry, id: `h${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`, at: now });
  }
  save(list);
  tell(api.putBrowserHistory([list[0]]));
}

export function removeFromHistory(ids: string[]) {
  const gone = new Set(ids);
  save(readHistory().filter((e) => !gone.has(e.id)));
  tell(api.removeBrowserHistory(ids));
}

/** Clears what's newer than `since` (milliseconds ago), or everything. */
export function clearHistory(since: number | null = null, now = Date.now()) {
  save(since === null ? [] : readHistory().filter((e) => now - e.at > since));
  tell(api.clearBrowserHistory(since === null ? null : now - since));
}

/** Applies a shorter keeping time straight away. */
export function trimHistory(keep: HistoryKeep) {
  const list = readHistory();
  const kept = trimmed(list, keep);
  if (kept.length !== list.length) save(kept);
  const from = keptFrom(keep, Date.now());
  if (from !== null) tell(api.trimBrowserHistory(from));
}

const MOVED = "tbv.browser.history.moved";

/**
 * Takes the library's history into the copy here: at start, and when sync
 * brings history from other devices. The first time, the history kept here
 * before the library kept it moves there.
 */
export async function loadHistory(keep: HistoryKeep): Promise<void> {
  let moved = false;
  try {
    moved = localStorage.getItem(MOVED) === "1";
  } catch {
    // Asked again next time.
  }
  try {
    if (!moved) {
      const here = readHistory();
      // Oldest first, so a long history goes in a few at a time.
      for (let i = 0; i < here.length; i += 500) await api.putBrowserHistory(here.slice(i, i + 500));
      try {
        localStorage.setItem(MOVED, "1");
      } catch {
        // Moved again next time; the same entries just update.
      }
    }
    const from = keptFrom(keep, Date.now());
    if (from !== null) await api.trimBrowserHistory(from);
    save((await api.browserHistory()).slice(0, MOST_HISTORY));
  } catch {
    // Outside the app, or the library isn't open yet: the copy here stays as it is.
  }
}

/** Today, Yesterday, or the date, for grouping the list. */
export function dayLabel(at: number, now = Date.now()): string {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (at >= start.getTime()) return "Today";
  if (at >= start.getTime() - DAY) return "Yesterday";
  return new Date(at).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: new Date(at).getFullYear() === new Date(now).getFullYear() ? undefined : "numeric" });
}

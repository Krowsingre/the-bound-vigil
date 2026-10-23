// Discover's history: the pages visited and the words searched for, kept on
// this device only (never synced), for as long as Preferences › Browser says.

export interface HistoryEntry {
  id: string;
  kind: "page" | "search";
  /** The page's address, or the search's results page. */
  url: string;
  /** The page's title, or the words searched for. */
  title: string | null;
  /** When, as milliseconds since 1970. */
  at: number;
}

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

/**
 * Adds a visit or a search, newest first. The same page again straight
 * after (a reload, or its title arriving) updates the entry already there.
 */
export function addToHistory(entry: Omit<HistoryEntry, "id" | "at">, keep: HistoryKeep, now = Date.now()) {
  const list = trimmed(readHistory(), keep, now);
  const last = list[0];
  if (last && last.kind === entry.kind && last.url === entry.url) {
    list[0] = { ...last, title: entry.title ?? last.title, at: now };
  } else {
    list.unshift({ ...entry, id: `h${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`, at: now });
  }
  save(list);
}

export function removeFromHistory(ids: string[]) {
  const gone = new Set(ids);
  save(readHistory().filter((e) => !gone.has(e.id)));
}

/** Clears what's newer than `since` (milliseconds ago), or everything. */
export function clearHistory(since: number | null = null, now = Date.now()) {
  save(since === null ? [] : readHistory().filter((e) => now - e.at > since));
}

/** Applies a shorter keeping time straight away. */
export function trimHistory(keep: HistoryKeep) {
  const list = readHistory();
  const kept = trimmed(list, keep);
  if (kept.length !== list.length) save(kept);
}

/** Today, Yesterday, or the date, for grouping the list. */
export function dayLabel(at: number, now = Date.now()): string {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (at >= start.getTime()) return "Today";
  if (at >= start.getTime() - DAY) return "Yesterday";
  return new Date(at).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: new Date(at).getFullYear() === new Date(now).getFullYear() ? undefined : "numeric" });
}

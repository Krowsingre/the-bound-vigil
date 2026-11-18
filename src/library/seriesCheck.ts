// The series check (embre, 17 November): every series in the library is
// looked up online on a schedule (Preferences › Compendium; once a month
// unless changed), quietly, one series at a time with a rest between, so it
// never gets in the way. Books found that weren't on a series' list before
// are kept here as "New in your series", for Sanctum and the series page.
// Nothing is added to the library: the person decides.

import { useEffect, useState } from "react";
import { api, isApp, isHome, isWeb } from "../api";
import type { MissingBook } from "../api/types";
import type { AppSettings } from "../settings/appSettings";

const LAST_KEY = "tbv.series.lastCheck";
const NEWS_KEY = "tbv.series.news";
/** Sent when the news or the last check changes. */
export const SERIES_NEWS = "tbv:series-news";
/** A rest between series, so a large library's check never crowds other work. */
const REST_MS = 3_000;
/** How long after opening before a due check starts, and how often it's looked at after. */
const FIRST_LOOK_MS = 90_000;
const LOOK_EVERY_MS = 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

/** A book found by the check that wasn't on its series' list before. */
export interface SeriesNews {
  series: string;
  key: string;
  title: string;
  position: number | null;
  authors: string[];
  coverUrl: string | null;
  foundAt: string;
}

/** The series check can run here: the app, not the web or home versions. */
export const canCheckSeries = (isApp || api.kind === "preview") && !isWeb && !isHome;

/** Days between checks, or null for never. */
export function checkEveryDays(s: Pick<AppSettings, "seriesCheck" | "seriesCheckDays">): number | null {
  switch (s.seriesCheck) {
    case "never":
      return null;
    case "day":
      return 1;
    case "week":
      return 7;
    case "month":
      return 30;
    case "year":
      return 365;
    case "custom":
      return Math.max(1, s.seriesCheckDays);
  }
}

/** Whether a check is due: never run, or the days have passed since the last. */
export function checkDue(s: Pick<AppSettings, "seriesCheck" | "seriesCheckDays">, last: string | null, now = Date.now()): boolean {
  const days = checkEveryDays(s);
  if (days === null) return false;
  const at = last ? Date.parse(last) : NaN;
  return Number.isNaN(at) || now - at >= days * DAY_MS;
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Kept for this session only.
  }
  window.dispatchEvent(new Event(SERIES_NEWS));
}

export const lastSeriesCheck = (): string | null => read<string | null>(LAST_KEY, null);
export const seriesNews = (): SeriesNews[] => read<SeriesNews[]>(NEWS_KEY, []);

/** Takes books off the news: one series', one book, or all. */
export function clearSeriesNews(series?: string, key?: string) {
  const left = series === undefined ? [] : seriesNews().filter((n) => !(n.series === series && (key === undefined || n.key === key)));
  write(NEWS_KEY, left);
}

/** The books on a series' list now that weren't on it before. */
export function newlyListed(before: MissingBook[], after: MissingBook[]): MissingBook[] {
  const known = new Set(before.map((m) => m.key));
  return after.filter((m) => !m.hidden && !known.has(m.key));
}

let running: Promise<void> | null = null;
/** How far the running check is, for Preferences. */
let progress: { done: number; total: number } | null = null;
export const seriesCheckProgress = () => progress;

/** Looks every series up online, one at a time. A check already running is joined, not started again. */
export function checkAllSeries(): Promise<void> {
  running ??= (async () => {
    try {
      const { series } = await api.getCollectionsOverview();
      progress = { done: 0, total: series.length };
      write(NEWS_KEY, seriesNews());
      for (const s of series) {
        try {
          const before = await api.seriesReview(s.name);
          const after = await api.findSeriesBooks(s.name, s.authors[0] ?? "");
          const found = newlyListed(before.missing, after.missing);
          if (found.length) {
            const now = new Date().toISOString();
            const news = seriesNews().filter((n) => !(n.series === s.name && found.some((f) => f.key === n.key)));
            write(NEWS_KEY, [...news, ...found.map((f) => ({ series: s.name, key: f.key, title: f.title, position: f.position, authors: f.authors, coverUrl: f.coverUrl, foundAt: now }))]);
          }
        } catch {
          // One series that can't be found online doesn't stop the rest.
        }
        progress = { done: progress.done + 1, total: progress.total };
        window.dispatchEvent(new Event(SERIES_NEWS));
        await new Promise((r) => setTimeout(r, REST_MS));
      }
      write(LAST_KEY, new Date().toISOString());
    } finally {
      progress = null;
      running = null;
      window.dispatchEvent(new Event(SERIES_NEWS));
    }
  })();
  return running;
}

/** Runs the check in the background when it's due (App). */
export function useSeriesSchedule(settings: Pick<AppSettings, "seriesCheck" | "seriesCheckDays">) {
  const { seriesCheck, seriesCheckDays } = settings;
  useEffect(() => {
    if (!canCheckSeries || seriesCheck === "never") return;
    const look = () => {
      if (!running && navigator.onLine !== false && checkDue({ seriesCheck, seriesCheckDays }, lastSeriesCheck())) void checkAllSeries();
    };
    const first = window.setTimeout(look, FIRST_LOOK_MS);
    const every = window.setInterval(look, LOOK_EVERY_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(every);
    };
  }, [seriesCheck, seriesCheckDays]);
}

/** The news, the last check and how far a running one is, kept up to date. */
export function useSeriesNews() {
  const [state, setState] = useState(() => ({ news: seriesNews(), last: lastSeriesCheck(), progress: seriesCheckProgress() }));
  useEffect(() => {
    const changed = () => setState({ news: seriesNews(), last: lastSeriesCheck(), progress: seriesCheckProgress() });
    window.addEventListener(SERIES_NEWS, changed);
    window.addEventListener("storage", changed);
    return () => {
      window.removeEventListener(SERIES_NEWS, changed);
      window.removeEventListener("storage", changed);
    };
  }, []);
  return state;
}

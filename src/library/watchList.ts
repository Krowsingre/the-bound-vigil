// Watching authors and books (embre, 19 November). Each watched author's
// books are looked up online with the series check (same schedule, set in
// Attune › Compendium), and each watched book's release date. News is
// a book newly announced, or one whose release date has come; it shows in
// Sanctum and as a message when a check finds it. Nothing is added to the
// library. The list is kept on this device, like the series news.

import { useEffect, useState } from "react";
import { api } from "../api";
import type { WatchedBook } from "../api/types";

const LIST_KEY = "tbv.watch.list";
const NEWS_KEY = "tbv.watch.news";
/** Sent when the list or the news changes. */
export const WATCH_CHANGED = "tbv:watch";
const REST_MS = 3_000;

export interface WatchedAuthor {
  kind: "author";
  name: string;
  addedAt: string;
  /** Books already seen, so only new ones are news. */
  known: string[];
  /** Looked up at least once. */
  primed: boolean;
}

export interface WatchedTitle {
  kind: "book";
  key: string;
  title: string;
  author: string;
  date: string | null;
  coverUrl: string | null;
  link: string | null;
  addedAt: string;
  released: boolean;
  /** Followed for a watched author until it's out, then let go. */
  auto?: boolean;
}

export type Watched = WatchedAuthor | WatchedTitle;

export interface WatchNews {
  kind: "announced" | "released";
  key: string;
  title: string;
  authors: string[];
  date: string | null;
  coverUrl: string | null;
  link: string | null;
  foundAt: string;
}

/** When a date ("2027-03-04", "2027-03" or "2027") begins. */
export function dateStart(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, (m || 1) - 1, d || 1);
}

/** Whether a book is out by `now`. A book with no date isn't. */
export const isOut = (date: string | null, now = Date.now()) => date !== null && dateStart(date) <= now;

const fold = (s: string) => s.trim().toLowerCase();

/**
 * A book's title as one key, the same as TBV's core makes for books found
 * online: no subtitle, punctuation or leading "The/A/An", lower case. So a
 * book watched by hand and the same book found for its author are one.
 */
export function titleKey(title: string): string {
  const main = title.split(/[:([]/)[0] ?? title;
  const words = main.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const skip = words.length > 1 && ["the", "a", "an"].includes(words[0] ?? "") ? 1 : 0;
  return words.slice(skip).join(" ");
}

function news(kind: WatchNews["kind"], b: WatchedBook, at: string): WatchNews {
  return { kind, key: b.key, title: b.title, authors: b.authors, date: b.date, coverUrl: b.coverUrl, link: b.link, foundAt: at };
}

function tracked(b: WatchedBook, author: string, at: string): WatchedTitle {
  return { kind: "book", key: b.key, title: b.title, author, date: b.date, coverUrl: b.coverUrl, link: b.link, addedAt: at, released: false, auto: true };
}

/**
 * A watched author against the books found for them now. The first look only
 * learns what's there, except books still to come, which are news. After
 * that, a book not seen before is news: out already, or announced. Books
 * still to come are followed until they're out.
 */
export function authorUpdate(author: WatchedAuthor, found: WatchedBook[], now = Date.now()) {
  const at = new Date(now).toISOString();
  const known = new Set(author.known);
  const fresh = found.filter((b) => !known.has(b.key));
  const items: WatchNews[] = [];
  const follow: WatchedTitle[] = [];
  for (const b of fresh) {
    const coming = !isOut(b.date, now);
    if (coming) follow.push(tracked(b, author.name, at));
    if (coming) items.push(news("announced", b, at));
    else if (author.primed) items.push(news("released", b, at));
  }
  return {
    author: { ...author, primed: true, known: [...author.known, ...fresh.map((b) => b.key)] },
    news: items,
    follow,
  };
}

/** A watched book against what's known of it now (`found` is null offline or when it can't be found). */
export function bookUpdate(book: WatchedTitle, found: WatchedBook | null, now = Date.now()) {
  const at = new Date(now).toISOString();
  const was = book.date;
  const next: WatchedTitle = found
    ? { ...book, date: found.date ?? book.date, coverUrl: found.coverUrl ?? book.coverUrl, link: found.link ?? book.link }
    : book;
  const items: WatchNews[] = [];
  const asFound: WatchedBook = { key: next.key, title: next.title, authors: [next.author], date: next.date, coverUrl: next.coverUrl, link: next.link };
  if (!next.released && isOut(next.date, now)) {
    next.released = true;
    items.push(news("released", asFound, at));
  } else if (was === null && next.date !== null && !next.released) {
    items.push(news("announced", asFound, at));
  }
  return { book: next, news: items };
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
  window.dispatchEvent(new Event(WATCH_CHANGED));
}

export const watchList = (): Watched[] => read<Watched[]>(LIST_KEY, []);
export const watchNews = (): WatchNews[] => read<WatchNews[]>(NEWS_KEY, []);
/** Watching here: the app's own lookups. */
export const canWatch = () => !!api.watchAuthorBooks && !!api.watchFindBook;

export const isWatchingAuthor = (name: string) => watchList().some((w) => w.kind === "author" && fold(w.name) === fold(name));

export const isWatchingBook = (title: string) => watchList().some((w) => w.kind === "book" && !w.auto && titleKey(w.title) === titleKey(title));

export function watchAuthor(name: string) {
  if (!name.trim() || isWatchingAuthor(name)) return;
  write(LIST_KEY, [...watchList(), { kind: "author", name: name.trim(), addedAt: new Date().toISOString(), known: [], primed: false }]);
  void checkWatched();
}

export function watchBook(title: string, author: string) {
  const key = titleKey(title);
  if (!key) return;
  const list = watchList().filter((w) => !(w.kind === "book" && w.auto && titleKey(w.title) === key));
  if (list.some((w) => w.kind === "book" && titleKey(w.title) === key)) return;
  const book: WatchedTitle = { kind: "book", key, title: title.trim(), author: author.trim(), date: null, coverUrl: null, link: null, addedAt: new Date().toISOString(), released: false };
  write(LIST_KEY, [...list, book]);
  void checkWatched();
}

/** Stops watching a book by its title. */
export function unwatchBook(title: string) {
  write(LIST_KEY, watchList().filter((w) => !(w.kind === "book" && titleKey(w.title) === titleKey(title))));
}

/** Stops watching one. An author takes the books followed for them along. */
export function unwatch(item: Watched) {
  write(LIST_KEY, watchList().filter((w) => {
    if (item.kind === "author") {
      if (w.kind === "author") return fold(w.name) !== fold(item.name);
      return !(w.auto && fold(w.author) === fold(item.name));
    }
    return !(w.kind === "book" && w.key === item.key);
  }));
}

export function clearWatchNews(key?: string) {
  write(NEWS_KEY, key === undefined ? [] : watchNews().filter((n) => n.key !== key));
}

let running: Promise<number> | null = null;
/** Something was added while a check ran: it goes round again for it. */
let again = false;

/** Looks every watched author and book up, one at a time. Says how much news it found. */
export function checkWatched(): Promise<number> {
  if (!canWatch()) return Promise.resolve(0);
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    let found = 0;
    // Waits a turn first, so `running` is set before the end clears it
    // (an empty list would otherwise finish at once and never be cleared).
    await Promise.resolve();
    try {
      const rest = () => new Promise((r) => setTimeout(r, REST_MS));
      do {
        again = false;
        // What each author's lookup just said about their books, so books
        // followed for them pick up a newly set or moved release date.
        const latest = new Map<string, WatchedBook>();
        for (const item of watchList()) {
          try {
            if (item.kind === "author") {
              const books = await api.watchAuthorBooks!(item.name);
              for (const b of books) latest.set(b.key, b);
              // Stopped watching while the lookup ran: nothing of it is kept.
              if (!isWatchingAuthor(item.name)) continue;
              const update = authorUpdate(item, books);
              const list = watchList();
              // Books already watched (by hand, or for another author) are
              // one watch, with one set of news, however their titles are written.
              const watched = list.filter((w): w is WatchedTitle => w.kind === "book");
              const keys = new Set(watched.flatMap((w) => [w.key, titleKey(w.title)]));
              const byHand = new Set(watched.filter((w) => !w.auto).flatMap((w) => [w.key, titleKey(w.title)]));
              write(LIST_KEY, [
                ...list.map((w) => (w.kind === "author" && fold(w.name) === fold(item.name) ? update.author : w)),
                ...update.follow.filter((b) => !keys.has(b.key)),
              ]);
              found += addNews(update.news.filter((n) => !byHand.has(n.key)));
              await rest();
            } else {
              // Followed for an author: their lookup just above says what's new, so no lookup of its own.
              const online = item.auto ? latest.get(item.key) ?? null : await api.watchFindBook!(item.title, item.author).catch(() => null);
              // Stopped watching (it, or its author) while it was looked up: nothing of it is kept.
              if (!watchList().some((w) => w.kind === "book" && w.key === item.key)) continue;
              const update = bookUpdate(item, online);
              write(LIST_KEY, watchList().flatMap((w) => {
                if (w.kind !== "book" || w.key !== item.key) return [w];
                return update.book.auto && update.book.released ? [] : [update.book];
              }));
              found += addNews(update.news);
              if (!item.auto) await rest();
            }
          } catch {
            // One that can't be looked up doesn't stop the rest.
          }
        }
      } while (again);
    } finally {
      running = null;
      window.dispatchEvent(new Event(WATCH_CHANGED));
    }
    return found;
  })();
  return running;
}

/** Sent with the news a check just found, for its message. */
export const WATCH_NEWS = "tbv:watch-news";

function addNews(items: WatchNews[]): number {
  if (!items.length) return 0;
  const keep = watchNews().filter((n) => !items.some((i) => i.key === n.key));
  write(NEWS_KEY, [...keep, ...items]);
  window.dispatchEvent(new CustomEvent<WatchNews[]>(WATCH_NEWS, { detail: items }));
  return items.length;
}

/** The message for news just found: one book by name, or how many. */
export function alertText(items: WatchNews[]): string {
  if (items.length === 1) {
    const n = items[0];
    return n.kind === "released" ? `“${n.title}” is out now.` : `“${n.title}” is announced: ${whenLine(n).replace(/^Coming /, "coming ")}.`;
  }
  return `${items.length} new from authors and books you watch. See them in Sanctum.`;
}

/** Shows a message whenever a check finds news (App). */
export function useWatchAlerts(show: (text: string) => void) {
  useEffect(() => {
    const heard = (e: Event) => show(alertText((e as CustomEvent<WatchNews[]>).detail));
    window.addEventListener(WATCH_NEWS, heard);
    return () => window.removeEventListener(WATCH_NEWS, heard);
  }, [show]);
}

/** The watch list and its news, kept up to date. */
export function useWatch() {
  const [state, setState] = useState(() => ({ list: watchList(), news: watchNews() }));
  useEffect(() => {
    const changed = () => setState({ list: watchList(), news: watchNews() });
    window.addEventListener(WATCH_CHANGED, changed);
    window.addEventListener("storage", changed);
    return () => {
      window.removeEventListener(WATCH_CHANGED, changed);
      window.removeEventListener("storage", changed);
    };
  }, []);
  return state;
}

/** "Out now", "Coming 4 March 2027", "Coming March 2027" or "Coming 2027". */
export function whenLine(n: Pick<WatchNews, "kind" | "date">): string {
  if (n.kind === "released") return "Out now";
  if (!n.date) return "Announced";
  const parts = n.date.split("-");
  const when = new Date(dateStart(n.date));
  const opts: Intl.DateTimeFormatOptions =
    parts.length === 3 ? { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }
      : parts.length === 2 ? { month: "long", year: "numeric", timeZone: "UTC" } : { year: "numeric", timeZone: "UTC" };
  return `Coming ${when.toLocaleDateString(undefined, opts)}`;
}

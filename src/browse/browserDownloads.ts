// Discover's Downloads list: what the browser brought down, kept on this
// device (the last 50), so it's still there next time with Retry, Read now
// and Send with Grimoire.

import { useSyncExternalStore } from "react";
import { api } from "../api";
import { readBrowserPrefs } from "./browserPrefs";

export const BOOK_FILE = /\.(epub|kepub|pdf|mobi|azw3?|fb2|cbz|cbr|djvu|txt|docx?|rtf|m4b|mp3|m4a)(\?|#|$)/i;

export interface Fetched {
  id: string;
  name: string;
  state: "coming" | "done" | "failed" | "importing" | "importFailed" | "added" | "kept";
  direct?: boolean;
  error?: string;
  path?: string;
  /** Where it came from, for Retry. */
  url?: string;
  /** The tab it came down in. */
  tab?: string;
  /** Once added: the id its book has in the library. */
  bookId?: string;
  /** Still waiting for an answer: add it, keep it, or not. */
  asking?: boolean;
  /** When it started, as milliseconds since 1970. */
  at: number;
}

const KEY = "tbv.browser.downloads";
export const MOST_DOWNLOADS = 50;

export function readDownloads(): Fetched[] {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "[]") as unknown;
    if (!Array.isArray(saved)) return [];
    return (
      saved
        .filter((d): d is Fetched => !!d && typeof d.id === "string" && typeof d.name === "string" && typeof d.state === "string")
        .map((d) => ({ ...d, at: typeof d.at === "number" ? d.at : 0 }))
    );
  } catch {
    return [];
  }
}

export function writeDownloads(list: Fetched[]): void {
  try {
    const pending = (d: Fetched) => isActiveDownload(d) || d.asking;
    localStorage.setItem(KEY, JSON.stringify([...list.filter(pending), ...list.filter((d) => !pending(d)).slice(0, MOST_DOWNLOADS)]));
  } catch {
    // Forgotten after this visit.
  }
}

export const isActiveDownload = (d: Fetched) => d.state === "coming" || d.state === "importing";

let downloads: Fetched[] | undefined;
const listeners = new Set<() => void>();
const answering = new Set<string>();

// Only a new app session interrupts its saved transfers. Switching screens
// leaves this store and its native event subscription in place.
function snapshot(): Fetched[] {
  return downloads ??= readDownloads().map((d) => {
    if (d.state === "coming") return { ...d, state: "failed" };
    if (d.state === "importing") return { ...d, state: "importFailed", asking: !!d.path, error: "The app closed during import." };
    return d;
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useDownloads() {
  return useSyncExternalStore(subscribe, snapshot);
}

export function setDownloads(update: (rows: Fetched[]) => Fetched[]) {
  const next = update(snapshot());
  downloads = [...next.filter((d) => isActiveDownload(d) || d.asking), ...next.filter((d) => !isActiveDownload(d) && !d.asking).slice(0, MOST_DOWNLOADS)]
    .sort((a, b) => b.at - a.at);
  writeDownloads(downloads);
  listeners.forEach((listener) => listener());
}

function updateDownload(id: string, change: Partial<Fetched>) {
  setDownloads((rows) => rows.map((d) => d.id === id ? { ...d, ...change } : d));
}

export async function answerDownload(d: Fetched, how: "add" | "keep" | "drop", toast: (message: string) => void) {
  const current = snapshot().find((row) => row.id === d.id);
  if (!current?.path || !current.asking || answering.has(d.id)) return;
  const path = current.path;
  answering.add(d.id);
  try {
    if (how === "add") {
      updateDownload(d.id, { state: "importing", asking: false, error: undefined });
      await api.browserAddDownload(path, d.id);
    } else if (how === "keep") {
      const where = await api.browserKeepDownload(path);
      updateDownload(d.id, { state: "kept", asking: false, path: undefined, error: undefined });
      toast(`Saved to ${where}`);
    } else {
      await api.browserDiscardDownload(path);
      setDownloads((rows) => rows.filter((row) => row.id !== d.id));
    }
  } catch (e) {
    if (how === "add") updateDownload(d.id, { state: "importFailed", asking: true, error: String(e) });
    toast(String(e));
  } finally {
    answering.delete(d.id);
  }
}

export function listenForDownloads(toast: (message: string) => void) {
  return api.onBrowserEvent((event) => {
    if (event.kind === "downloadStart" || event.kind === "directDownloadStart") {
      const row: Fetched = {
        id: event.id, name: event.name, url: event.url, at: Date.now(), state: "coming",
        ...(event.kind === "directDownloadStart" ? { direct: true } : { tab: event.tab }),
      };
      setDownloads((rows) => [row, ...rows.filter((d) => d.id !== row.id)]);
    } else if (event.kind === "download") {
      const before = snapshot().find((d) => d.id === event.id);
      const direct = before?.direct || !event.tab;
      const row: Fetched = {
        ...before, direct, id: event.id, name: event.name, tab: event.tab,
        path: event.path || undefined, at: before?.at ?? Date.now(),
        state: event.ok ? direct ? "importing" : "done" : "failed",
        asking: event.ok && !direct,
      };
      setDownloads((rows) => [row, ...rows.filter((d) => d.id !== row.id)]);
      if (row.asking && BOOK_FILE.test(row.name) && readBrowserPrefs().addWithoutAsking) {
        void answerDownload(row, "add", toast);
      }
    } else if (event.kind === "downloadImport") {
      updateDownload(event.id, {
        state: event.bookId ? "added" : "importFailed",
        bookId: event.bookId ?? undefined, asking: !event.bookId,
        error: event.error ?? undefined,
      });
      if (event.error) toast(event.error);
    }
  });
}

/** What a download's line says under its name. */
export function downloadState(d: Fetched): string {
  switch (d.state) {
    case "coming":
      return "Coming down…";
    case "failed":
      return "Didn't finish";
    case "importing":
      return "Adding to your library…";
    case "importFailed":
      return "Couldn't add to your library";
    case "added":
      return "Added to your library";
    case "kept":
      return "Kept in Downloads";
    default:
      return "Downloaded";
  }
}

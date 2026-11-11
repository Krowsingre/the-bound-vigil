// Discover's Downloads list: what the browser brought down, kept on this
// device (the last 50), so it's still there next time with Retry, Read now
// and Send with Grimoire.

import { useSyncExternalStore } from "react";
import { api } from "../api";
import type { BrowserEvent } from "../api/types";
import { workspaceFrame, workspaceHost } from "../shell/workspaceFrame";
import { readBrowserPrefs } from "./browserPrefs";

export const BOOK_FILE = /\.(epub|kepub|pdf|mobi|azw3?|fb2|cbz|cbr|djvu|txt|docx?|rtf|m4b|mp3|m4a)(\?|#|$)/i;

export interface Fetched {
  id: string;
  name: string;
  state: "coming" | "checking" | "done" | "failed" | "importing" | "importFailed" | "added" | "kept";
  direct?: boolean;
  media?: "ebook" | "audio" | "document" | "other";
  savedTo?: string;
  error?: string;
  securityBlocked?: boolean;
  path?: string;
  /** Where it came from, for Retry. */
  url?: string;
  sourceUrl?: string;
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
const interrupted = "The transfer is no longer running.";

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

export const isActiveDownload = (d: Fetched) => d.state === "coming" || d.state === "checking" || d.state === "importing";

interface DownloadStore {
  downloads?: Fetched[];
  listeners: Set<() => void>;
  answering: Set<string>;
  sources: Map<string, string>;
  classifying: Set<string>;
}
const host = workspaceHost as Window & { tbvDownloadStore?: DownloadStore };
const store = (workspaceFrame ? host.tbvDownloadStore : undefined) ?? {
  listeners: new Set(), answering: new Set(), sources: new Map(), classifying: new Set(),
} as DownloadStore;
if (!workspaceFrame) host.tbvDownloadStore = store;
const { listeners, answering } = store;

export function rememberDownloadSource(tab: string, url: string | undefined) {
  if (url && /^https?:\/\//i.test(url) && !BOOK_FILE.test(url)) store.sources.set(tab, url);
  else if (!url) store.sources.delete(tab);
}

export function downloadSource(tab: string, file?: string) {
  const source = store.sources.get(tab);
  return source === file ? undefined : source;
}

export function hasActiveTransfer(tab: string) {
  return snapshot().some((row) => row.tab === tab && row.state === "coming");
}

// Switching screens
// leaves this store and its native event subscription in place.
function snapshot(): Fetched[] {
  return store.downloads ??= readDownloads().map((d) => {
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
  store.downloads = [...next.filter((d) => isActiveDownload(d) || d.asking), ...next.filter((d) => !isActiveDownload(d) && !d.asking).slice(0, MOST_DOWNLOADS)]
    .sort((a, b) => b.at - a.at);
  writeDownloads(store.downloads);
  listeners.forEach((listener) => listener());
}

function updateDownload(id: string, change: Partial<Fetched>) {
  setDownloads((rows) => rows.map((d) => d.id === id ? { ...d, ...change } : d));
}

export async function answerDownload(d: Fetched, how: "add" | "keep", toast: (message: string) => void) {
  const current = snapshot().find((row) => row.id === d.id);
  if (!current?.path || !current.asking || answering.has(d.id)) return;
  const path = current.path;
  answering.add(d.id);
  try {
    if (how === "add") {
      updateDownload(d.id, { state: "importing", asking: false, error: undefined });
      await api.browserAddDownload(path, d.id);
    } else {
      const prefs = readBrowserPrefs();
      const folder = prefs.askDownloadFolder ? await api.chooseFolder("Save download to this folder", prefs.downloadFolder) : prefs.downloadFolder;
      if (prefs.askDownloadFolder && !folder) return;
      const where = await api.browserKeepDownload(path, folder);
      updateDownload(d.id, { state: "kept", asking: false, savedTo: where, error: undefined });
      toast(`Saved to ${where}`);
    }
  } catch (e) {
    if (how === "add") updateDownload(d.id, { state: "importFailed", asking: true, error: String(e) });
    toast(String(e));
  } finally {
    answering.delete(d.id);
  }
}

export async function removeDownloads(ids: string[], toast: (message: string) => void) {
  const deleteFiles = readBrowserPrefs().deleteTemporaryWithHistory;
  for (const id of ids) {
    const row = snapshot().find((item) => item.id === id);
    if (!row || isActiveDownload(row) || answering.has(id)) continue;
    answering.add(id);
    try {
      if (deleteFiles && row.path) await api.browserDiscardDownload(row.path);
      setDownloads((rows) => rows.filter((item) => item.id !== id));
    } catch (error) {
      toast(String(error));
    } finally {
      answering.delete(id);
    }
  }
}

export async function temporaryDownloads(remove: boolean) {
  const active = snapshot().filter((row) => isActiveDownload(row) || answering.has(row.id)).map((row) => row.id);
  const result = await api.browserTemporaryDownloads(active, remove);
  if (remove && result.removed.length) {
    const gone = new Set(result.removed.map((id) => id.toLowerCase()));
    setDownloads((rows) => rows.map((row) => {
      const directory = row.path?.split(/[\\/]/).at(-2);
      return directory && gone.has(directory.toLowerCase())
        ? { ...row, path: undefined, asking: false } : row;
    }));
  }
  return result;
}

async function finishDownload(row: Fetched, toast: (message: string) => void) {
  if (!row.path || store.classifying.has(row.id)) return;
  store.classifying.add(row.id);
  try {
    const media = await api.browserDownloadKind(row.path);
    updateDownload(row.id, { state: "done", media, asking: true });
    if (media === "other") await answerDownload(row, "keep", toast);
    else if (media === "ebook" && readBrowserPrefs().addWithoutAsking) await answerDownload(row, "add", toast);
  } catch (error) {
    // Keep a completed file available for manual import if classification failed.
    updateDownload(row.id, { state: "done", asking: true, error: String(error) });
  } finally {
    store.classifying.delete(row.id);
  }
}

function receiveDownload(event: BrowserEvent, toast: (message: string) => void) {
  if (event.kind === "downloadStart" || event.kind === "directDownloadStart") {
    const row: Fetched = {
      id: event.id, name: event.name, url: event.url, at: Date.now(), state: "coming",
      ...(event.kind === "directDownloadStart" ? { direct: true, sourceUrl: event.sourceUrl ?? undefined } : {
        tab: event.tab,
        sourceUrl: downloadSource(event.tab, event.url),
      }),
    };
    setDownloads((rows) => [row, ...rows.filter((d) => d.id !== row.id)]);
  } else if (event.kind === "download") {
    const before = snapshot().find((d) => d.id === event.id);
    if (before && before.state !== "coming" && before.error !== interrupted) return;
    const direct = before?.direct === true;
    const row: Fetched = {
      ...before, direct, id: event.id, name: event.name, tab: event.tab,
      path: event.path || undefined, at: before?.at ?? Date.now(),
      state: event.ok && event.path ? direct ? "importing" : "checking" : "failed",
      asking: false,
      error: event.error ?? undefined,
      securityBlocked: event.securityBlocked,
    };
    setDownloads((rows) => [row, ...rows.filter((d) => d.id !== row.id)]);
    if (row.state === "checking" && row.path) void finishDownload(row, toast);
  } else if (event.kind === "downloadImport") {
    if (!snapshot().some((row) => row.id === event.id && row.state === "importing")) return;
    updateDownload(event.id, {
      state: event.bookId ? "added" : "importFailed",
      bookId: event.bookId ?? undefined, asking: !event.bookId,
      ...(event.bookId && !event.error ? { path: undefined } : {}),
      error: event.error ?? undefined,
    });
    if (event.error) toast(event.error);
  }
}

export function listenForDownloads(toast: (message: string) => void) {
  const stop = api.onBrowserEvent((event) => receiveDownload(event, toast));
  for (const row of snapshot()) {
    if (row.state === "checking") {
      if (row.path) void finishDownload(row, toast);
      else updateDownload(row.id, { state: "failed", error: "The downloaded file is missing." });
    }
  }
  const missing = new Set<string>();
  let disposed = false;
  let checking = false;
  const reconcile = async () => {
    if (checking || !api.browserDownloadStatus) return;
    const pending = snapshot().filter((row) => row.state === "coming" || (row.direct && row.state === "importing"));
    if (!pending.length) return;
    checking = true;
    try {
      const status = await api.browserDownloadStatus(pending.map((row) => row.id));
      if (disposed) return;
      const finished = new Set(status.finished.filter((event) => event.kind === "download").map((event) => event.id));
      for (const event of status.finished) {
        if (snapshot().some((row) => row.id === event.id)) receiveDownload(event, toast);
      }
      const active = new Set(status.active);
      for (const row of pending) {
        if (snapshot().find((item) => item.id === row.id)?.state !== "coming") continue;
        if (finished.has(row.id) || active.has(row.id)) missing.delete(row.id);
        else if (missing.has(row.id)) {
          updateDownload(row.id, { state: "failed", error: interrupted });
        } else {
          // WebKit can finish just before its completion event reaches Rust.
          missing.add(row.id);
        }
      }
      const waiting = new Set(snapshot().filter((row) => row.state === "coming").map((row) => row.id));
      for (const id of missing) if (!waiting.has(id)) missing.delete(id);
    } catch {
      // A failed status check cannot establish that a download stopped.
      missing.clear();
    } finally {
      checking = false;
    }
  };
  void reconcile();
  const timer = api.browserDownloadStatus ? setInterval(() => void reconcile(), 2_000) : undefined;
  return () => {
    disposed = true;
    clearInterval(timer);
    stop();
  };
}

/** What a download's line says under its name. */
export function downloadState(d: Fetched): string {
  switch (d.state) {
    case "coming":
      return "Coming down…";
    case "checking":
      return "Checking file…";
    case "failed":
      return "Didn't finish";
    case "importing":
      return "Adding to your library…";
    case "importFailed":
      return "Couldn't add to your library";
    case "added":
      return "Added to your library";
    case "kept":
      return d.savedTo ? `Saved to ${d.savedTo}` : "Saved to Downloads";
    default:
      return "Downloaded";
  }
}

// The iPhone's Home Screen and Lock Screen widgets (see src-tauri/src/widgets.rs).
// TBV rewrites what they show when it starts, when it goes off screen and
// when an audiobook starts or stops; a tap on a widget opens a
// theboundvigil:// link, which App.tsx follows.
import { useEffect } from "react";
import { isIOS } from "./api";
import { dayOf } from "./lib/timeSpent";
import type { Route } from "./shell/routes";

/** What the player tells the widgets. */
export interface WidgetAudio {
  bookId: string;
  title: string;
  author: string;
  playing: boolean;
  progress: number;
}

/** What a widget tap asks for. */
export type WidgetLink =
  | { kind: "book"; id: string }
  | { kind: "audio"; action: "toggle" | "back" | "play"; bookId: string | null }
  | { kind: "sigil"; id: string }
  | { kind: "page"; route: Route }
  | { kind: "scribe"; open: "new" | "note" | "book"; id: string | null }
  | { kind: "home" };

/** A widget asking Scribe for a new note (`n` counts asks), or to show one. */
export interface ScribeAsk {
  open: "new" | "note";
  id: string | null;
  n: number;
}

/** Pages a Quick Access widget can open. */
const PAGES: Route[] = ["home", "library", "documents", "collections", "audiobooks", "writing", "catalogs", "geas", "libram", "settings"];

const core = () => import("@tauri-apps/api/core");

/** Rewrites the widgets, with the player's latest state when it's given. */
export function refreshWidgets(audio?: WidgetAudio | null) {
  if (!isIOS) return;
  void core()
    .then(({ invoke }) => invoke("widget_refresh", { today: dayOf(), audio: audio ?? null }))
    .catch(() => undefined);
}

/** Reads a link such as theboundvigil://book/<id>. */
export function readWidgetLink(text: string): WidgetLink | null {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== "theboundvigil:") return null;
  // theboundvigil://book/abc: the host is "book" and the path "/abc".
  const parts = [url.hostname, ...url.pathname.split("/")].filter(Boolean).map(decodeURIComponent);
  const [kind, rest] = [parts[0], parts.slice(1).join("/")];
  if (kind === "book" && rest) return { kind: "book", id: rest };
  if (kind === "sigil" && rest) return { kind: "sigil", id: rest };
  if (kind === "audio" && (rest === "toggle" || rest === "back" || rest === "play")) return { kind: "audio", action: rest, bookId: url.searchParams.get("book") };
  if (kind === "page" && (PAGES as string[]).includes(rest)) return { kind: "page", route: rest as Route };
  if (kind === "scribe" && rest === "new") return { kind: "scribe", open: "new", id: null };
  if (kind === "scribe" && (rest.startsWith("note/") || rest.startsWith("book/")) && rest.length > 5)
    return { kind: "scribe", open: rest.startsWith("note/") ? "note" : "book", id: rest.slice(5) };
  if (kind === "home") return { kind: "home" };
  return null;
}

/** Follows each widget tap, including the one TBV was opened with. */
export function useWidgetLinks(follow: (link: WidgetLink) => void) {
  useEffect(() => {
    if (!isIOS) return;
    let stopped = false;
    let stop: (() => void) | null = null;
    const take = () =>
      core()
        .then(({ invoke }) => invoke<string[]>("widget_links"))
        .then((links) => {
          if (stopped) return;
          for (const text of links) {
            const link = readWidgetLink(text);
            if (link) follow(link);
          }
        })
        .catch(() => undefined);
    void take();
    void import("@tauri-apps/api/event").then(async ({ listen }) => {
      const unlisten = await listen("tbv://widget-link", () => void take());
      if (stopped) unlisten();
      else stop = unlisten;
    });
    return () => {
      stopped = true;
      stop?.();
    };
  }, [follow]);
}

/** Rewrites the widgets when TBV starts and each time it goes off screen. */
export function useWidgetRefresh() {
  useEffect(() => {
    if (!isIOS) return;
    refreshWidgets();
    const hidden = () => document.visibilityState === "hidden" && refreshWidgets();
    document.addEventListener("visibilitychange", hidden);
    return () => document.removeEventListener("visibilitychange", hidden);
  }, []);
}

import type { IconName } from "../components/Icon";

export type Route = "home" | "library" | "documents" | "collections" | "audiobooks" | "notes" | "settings" | "sync" | "imports" | "activity" | "lining" | "places" | "book" | "writing" | "catalogs" | "geas" | "libram";

/** Each page's name, and the few words under it in the sidebar (Discover has none: its submenu says it). */
export const PAGE: Record<"home" | "library" | "collections" | "audiobooks" | "writing" | "catalogs" | "settings", { label: string; caption: string }> = {
  home: { label: "Sanctum", caption: "Your home" },
  library: { label: "Archive", caption: "Books & documents" },
  audiobooks: { label: "Resonance", caption: "Audiobooks" },
  collections: { label: "Compendium", caption: "Your collections" },
  writing: { label: "Scribe", caption: "Notes & manuscripts" },
  catalogs: { label: "Discover", caption: "" },
  settings: { label: "Preferences", caption: "Settings & sync" },
};

/** Discover's submenu in the sidebar: the browser (Scry), bringing things in
 * from servers (Geas), and the catalogues (Libram) (embre, 13 November). */
export const DISCOVER_MENU: { route: Route; label: string; caption: string; icon: IconName }[] = [
  { route: "catalogs", label: "Scry", caption: "The web", icon: "globe" },
  { route: "geas", label: "Geas", caption: "Transfers", icon: "database" },
  { route: "libram", label: "Libram", caption: "Catalogues & Bibles", icon: "bookClosed" },
];

export const NAV: { route: Route; label: string; caption: string; icon: IconName }[] = [
  { route: "home", ...PAGE.home, icon: "home" },
  { route: "library", ...PAGE.library, icon: "library" },
  { route: "audiobooks", ...PAGE.audiobooks, icon: "headphones" },
  { route: "collections", ...PAGE.collections, icon: "layers" },
  { route: "writing", ...PAGE.writing, icon: "pen" },
  { route: "catalogs", ...PAGE.catalogs, icon: "compass" },
  { route: "settings", ...PAGE.settings, icon: "settings" },
];

/** The pages this copy of TBV shows. Discover needs the app (a web page can't
 * reach most catalogs or hold a browser). Scribe holds notes too; the books you
 * write need synced records, which the phone at home doesn't keep, so there
 * it's only notes. */
export function navFor({ web, home, android = false }: { web: boolean; home: boolean; android?: boolean }) {
  // Android's test version has no browser yet.
  return NAV.filter((n) => !(n.route === "catalogs" && (web || home || android))).map((n) =>
    n.route === "writing" && home ? { ...n, caption: "Your notes" } : n,
  );
}

/** Every page there is a button for: the sidebar's, with Discover's submenu. */
export function routesFor(flags: { web: boolean; home: boolean; android?: boolean }): Route[] {
  return navFor(flags).flatMap((n) => (n.route === "catalogs" ? DISCOVER_MENU.map((d) => d.route) : [n.route]));
}

/** Sync & Accounts lives inside Preferences, so Preferences stays highlighted;
 * notes are part of Scribe, and documents of the Archive. */
export function navRouteOf(route: Route): Route {
  return route === "sync" ? "settings" : route === "notes" ? "writing" : route === "documents" ? "library" : route;
}

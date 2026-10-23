import type { IconName } from "../components/Icon";

export type Route = "home" | "library" | "documents" | "collections" | "audiobooks" | "notes" | "settings" | "sync" | "imports" | "activity" | "places" | "book" | "writing" | "catalogs";

export const NAV: { route: Route; label: string; icon: IconName }[] = [
  { route: "home", label: "Home", icon: "home" },
  { route: "library", label: "Library", icon: "library" },
  { route: "documents", label: "Documents", icon: "file" },
  { route: "collections", label: "Collections", icon: "collections" },
  { route: "audiobooks", label: "Audiobooks", icon: "headphones" },
  { route: "writing", label: "Writing", icon: "pen" },
  { route: "catalogs", label: "Browse", icon: "globe" },
  { route: "settings", label: "Settings", icon: "settings" },
];

/** The pages this copy of TBV shows. Browse needs the app (a web page can't
 * reach most catalogs or hold a browser). Writing holds Notes too; the books you
 * write need synced records, which the phone at home doesn't keep, so there
 * it's only Notes. */
export function navFor({ web, home }: { web: boolean; home: boolean }) {
  return NAV.filter((n) => !(n.route === "catalogs" && (web || home))).map((n) =>
    n.route === "writing" && home ? { ...n, label: "Notes", icon: "notes" as IconName } : n,
  );
}

/** Sync & Accounts lives inside Settings, so Settings stays highlighted; Notes is a tab of Writing. */
export function navRouteOf(route: Route): Route {
  return route === "sync" ? "settings" : route === "notes" ? "writing" : route;
}

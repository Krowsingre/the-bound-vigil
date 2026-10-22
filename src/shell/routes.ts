import type { IconName } from "../components/Icon";

export type Route = "home" | "library" | "documents" | "collections" | "audiobooks" | "notes" | "settings" | "sync" | "imports" | "activity" | "places" | "book" | "writing" | "catalogs";

export const NAV: { route: Route; label: string; icon: IconName }[] = [
  { route: "home", label: "Home", icon: "home" },
  { route: "library", label: "Library", icon: "library" },
  { route: "documents", label: "Documents", icon: "file" },
  { route: "collections", label: "Collections", icon: "collections" },
  { route: "audiobooks", label: "Audiobooks", icon: "headphones" },
  { route: "notes", label: "Notes", icon: "notes" },
  { route: "writing", label: "Writing", icon: "pen" },
  { route: "catalogs", label: "Catalogs", icon: "globe" },
  { route: "settings", label: "Settings", icon: "settings" },
];

/** The pages this copy of TBV shows. Catalogs need the desktop app (a
 * browser can't reach most catalogs); writing needs synced records, which the
 * phone at home doesn't keep. */
export function navFor({ web, home }: { web: boolean; home: boolean }) {
  return NAV.filter((n) => !(n.route === "catalogs" && (web || home)) && !(n.route === "writing" && home));
}

/** Sync & Accounts lives inside Settings, so Settings stays highlighted. */
export function navRouteOf(route: Route): Route {
  return route === "sync" ? "settings" : route;
}

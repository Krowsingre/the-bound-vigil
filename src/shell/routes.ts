import type { IconName } from "../components/Icon";

export type Route = "home" | "library" | "documents" | "collections" | "audiobooks" | "notes" | "settings" | "sync" | "imports" | "activity" | "book";

export const NAV: { route: Route; label: string; icon: IconName }[] = [
  { route: "home", label: "Home", icon: "home" },
  { route: "library", label: "Library", icon: "library" },
  { route: "documents", label: "Documents", icon: "file" },
  { route: "collections", label: "Collections", icon: "collections" },
  { route: "audiobooks", label: "Audiobooks", icon: "headphones" },
  { route: "notes", label: "Notes", icon: "notes" },
  { route: "settings", label: "Settings", icon: "settings" },
];

/** Sync & Accounts lives inside Settings, so Settings stays highlighted. */
export function navRouteOf(route: Route): Route {
  return route === "sync" ? "settings" : route;
}

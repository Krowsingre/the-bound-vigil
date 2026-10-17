import type { IconName } from "../components/Icon";

export type Route = "home" | "library" | "collections" | "notes" | "settings" | "sync" | "imports";

export const NAV: { route: Route; label: string; icon: IconName }[] = [
  { route: "home", label: "Home", icon: "home" },
  { route: "library", label: "Library", icon: "library" },
  { route: "collections", label: "Collections", icon: "collections" },
  { route: "notes", label: "Notes", icon: "notes" },
  { route: "settings", label: "Settings", icon: "settings" },
];

/** Sync & Accounts lives inside Settings, so Settings stays highlighted. */
export function navRouteOf(route: Route): Route {
  return route === "sync" ? "settings" : route;
}

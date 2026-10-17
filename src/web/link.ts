// The link the desktop app gives for opening the library on a phone. Kept
// apart from the screens so the web Api can read it before anything loads.

import type { SupabaseProject } from "../api/types";

/** Where the web version is published. */
export const WEB_URL = "https://krowsingre.github.io/the-bound-vigil/";

/** A Supabase project's address. (A local one is allowed for trying the web version out.) */
export const urlOk = (url: string) => /^https:\/\/[a-z0-9-]+\.supabase\.(co|in)\/?$/i.test(url.trim()) || /^http:\/\/(localhost|127\.0\.0\.1):\d+\/?$/.test(url.trim());

/** The project's address and key, as the desktop app's "Use on your phone" link carries them. */
export function projectFromLink(hash: string): SupabaseProject | null {
  const m = /[#&]connect=([A-Za-z0-9_-]+)/.exec(hash);
  if (!m) return null;
  try {
    const json = atob(m[1].replace(/-/g, "+").replace(/_/g, "/"));
    const p = JSON.parse(json) as Partial<SupabaseProject>;
    return typeof p.url === "string" && urlOk(p.url) && typeof p.anonKey === "string" && p.anonKey ? { url: p.url.replace(/\/$/, ""), anonKey: p.anonKey } : null;
  } catch {
    return null;
  }
}

/** A link that opens the web version already pointed at this project. */
export function phoneLink(project: SupabaseProject): string {
  const packed = btoa(JSON.stringify({ url: project.url, anonKey: project.anonKey })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${WEB_URL}#connect=${packed}`;
}

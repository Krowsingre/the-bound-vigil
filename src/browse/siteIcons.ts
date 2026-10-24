// Each site's own small icon (its favicon), fetched from the site the first
// time it shows on the start page and kept on this device, by host.

import { useEffect, useState } from "react";
import { api } from "../api";
import { siteOf } from "./browserPrefs";

interface Kept {
  /** A data: address, or "" when the site has none TBV could use. */
  icon: string;
  at: number;
}

const KEY = "tbv.browser.icons";
const CHANGED = "tbv:browser-icons";
/** Sites without an icon (or offline when asked) are asked again after this long. */
const RETRY = 86_400_000;
/** The most kept, newest first, so the store stays small. */
const MOST = 300;
/** Bigger icons aren't kept (a few are whole pictures). */
const BIGGEST = 64_000;

function readIcons(): Record<string, Kept> {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}") as unknown;
    return saved && typeof saved === "object" ? (saved as Record<string, Kept>) : {};
  } catch {
    return {};
  }
}

function keep(host: string, icon: string) {
  const all = readIcons();
  all[host] = { icon: icon.length <= BIGGEST ? icon : "", at: Date.now() };
  const newest = Object.entries(all)
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, MOST);
  try {
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(newest)));
  } catch {
    // Full: fetched again next time.
  }
  window.dispatchEvent(new CustomEvent(CHANGED, { detail: host }));
}

/** Hosts being fetched now, so ten rows of one site ask once. */
const asking = new Set<string>();

function kept(host: string | null): string | null {
  if (!host) return null;
  const k = readIcons()[host];
  return k?.icon || null;
}

/** The site's icon as a picture address, or null while there isn't one (a letter stands in). */
export function useSiteIcon(url: string): string | null {
  const host = siteOf(url);
  const [icon, setIcon] = useState(() => kept(host));
  useEffect(() => {
    setIcon(kept(host));
    if (!host) return;
    const heard = (e: Event) => (e as CustomEvent<string>).detail === host && setIcon(kept(host));
    window.addEventListener(CHANGED, heard);
    const k = readIcons()[host];
    if (!(k && (k.icon || Date.now() - k.at < RETRY)) && !asking.has(host)) {
      asking.add(host);
      api
        .siteIcon(url)
        .then(
          (found) => keep(host, found),
          // None, or offline: a letter for now, asked again tomorrow.
          () => keep(host, ""),
        )
        .finally(() => asking.delete(host));
    }
    return () => window.removeEventListener(CHANGED, heard);
  }, [host, url]);
  return icon;
}

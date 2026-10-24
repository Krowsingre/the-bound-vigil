// Discover's browser choices, kept on this device: the search engine, the
// home page, whether ebook downloads go straight into the library, and how
// much the browser blocks (and for which sites that's lowered).

import { HISTORY_KEEPS, type HistoryKeep } from "./browserHistory";

export type SearchEngine = "duckduckgo" | "google" | "bing" | "brave" | "startpage" | "ecosia";

export const SEARCH_ENGINES: { value: SearchEngine; label: string; url: string }[] = [
  { value: "duckduckgo", label: "DuckDuckGo", url: "https://duckduckgo.com/?q=" },
  { value: "google", label: "Google", url: "https://www.google.com/search?q=" },
  { value: "bing", label: "Bing", url: "https://www.bing.com/search?q=" },
  { value: "brave", label: "Brave Search", url: "https://search.brave.com/search?q=" },
  { value: "startpage", label: "Startpage", url: "https://www.startpage.com/do/search?q=" },
  { value: "ecosia", label: "Ecosia", url: "https://www.ecosia.org/search?q=" },
];

export const DEFAULT_HOME = "https://www.gutenberg.org/";

export type ProtectionLevel = "strict" | "balanced" | "off";

export const PROTECTION_LEVELS: { value: ProtectionLevel; label: string; hint: string }[] = [
  { value: "strict", label: "Strict", hint: "Blocks trackers, advertising, cryptocurrency miners and fingerprinting, and cookies from other sites." },
  { value: "balanced", label: "Balanced", hint: "Blocks trackers and miners, and lets advertising and sign-in cookies through." },
  { value: "off", label: "Off", hint: "Blocks nothing." },
];

export type ComeBack = "keep" | "leave" | "close";

export const COME_BACK: { value: ComeBack; label: string }[] = [
  { value: "keep", label: "Where you left off, with your tabs" },
  { value: "leave", label: "At the home page, after leaving Discover" },
  { value: "close", label: "At the home page, after closing TBV" },
];

export interface BrowserPrefs {
  search: SearchEngine;
  home: string;
  /** Ebook downloads join the library without asking first. */
  addWithoutAsking: boolean;
  protection: ProtectionLevel;
  /** Videos and sound go on playing after leaving Discover (otherwise they pause). */
  keepPlaying: boolean;
  /** Where Discover is when you come back: as you left it, or at the home
   * page with the other tabs closed after leaving Discover or after closing TBV. */
  comeBack: ComeBack;
  /** Pages visited are kept in History (••• › History). */
  historyOn: boolean;
  /** Words searched for from the address box are kept too. */
  historySearches: boolean;
  /** How long History keeps things. */
  historyKeep: HistoryKeep;
  /** Sites (hosts, without "www.") whose protection was lowered from Discover's ••• menu. */
  lowered: string[];
  /** New tabs and the Home button open TBV's own start page, not the home page website. */
  startPage: boolean;
  /** The start page lists sites from History. */
  showRecent: boolean;
  /** The button row hides while a page scrolls down, and comes back scrolling up. */
  hideBar: boolean;
  /** The address box suggests from History, bookmarks, Quick Links and open tabs. */
  suggest: boolean;
}

/** What a tab showing TBV's start page has for its address. */
export const START_PAGE = "tbv:start";

export const isStartPage = (url: string) => url === START_PAGE;

/** Where new tabs and the Home button go. */
export function homeOf(prefs: BrowserPrefs = readBrowserPrefs()): string {
  return prefs.startPage ? START_PAGE : prefs.home;
}

const KEY = "tbv.browser.prefs";
/** Where the home page was kept before these choices were gathered together. */
const OLD_HOME_KEY = "tbv.browser.home";
const CHANGED = "tbv:browser-prefs";

export function readBrowserPrefs(): BrowserPrefs {
  let saved: Partial<BrowserPrefs> = {};
  let oldHome: string | null = null;
  try {
    saved = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<BrowserPrefs>;
    oldHome = localStorage.getItem(OLD_HOME_KEY);
  } catch {
    // The defaults, then.
  }
  const home = typeof saved.home === "string" && /^https?:\/\//i.test(saved.home) ? saved.home : oldHome ?? DEFAULT_HOME;
  return {
    search: SEARCH_ENGINES.some((e) => e.value === saved.search) ? (saved.search as SearchEngine) : "duckduckgo",
    home,
    addWithoutAsking: saved.addWithoutAsking === true,
    keepPlaying: saved.keepPlaying === true,
    historyOn: saved.historyOn !== false,
    historySearches: saved.historySearches !== false,
    historyKeep: HISTORY_KEEPS.some((k) => k.value === saved.historyKeep) ? (saved.historyKeep as HistoryKeep) : "quarter",
    comeBack: COME_BACK.some((c) => c.value === saved.comeBack) ? (saved.comeBack as ComeBack) : "keep",
    protection: PROTECTION_LEVELS.some((p) => p.value === saved.protection) ? (saved.protection as ProtectionLevel) : "strict",
    lowered: Array.isArray(saved.lowered) ? saved.lowered.filter((h): h is string => typeof h === "string") : [],
    startPage: saved.startPage !== false,
    showRecent: saved.showRecent !== false,
    hideBar: saved.hideBar !== false,
    suggest: saved.suggest !== false,
  };
}

export function writeBrowserPrefs(change: Partial<BrowserPrefs>): BrowserPrefs {
  const next = { ...readBrowserPrefs(), ...change };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Kept for this visit only.
  }
  window.dispatchEvent(new CustomEvent(CHANGED));
  return next;
}

export function onBrowserPrefs(listener: () => void): () => void {
  window.addEventListener(CHANGED, listener);
  return () => window.removeEventListener(CHANGED, listener);
}

/** What was typed, as an address: a web address as is, anything else searched for. */
/** Whether what's typed is a web address rather than words to search for. */
export function isAddress(typed: string): boolean {
  const text = typed.trim();
  return /^https?:\/\//i.test(text) || (!/\s/.test(text) && /^[^/]+\.[a-z]{2,}(\/|$|:)/i.test(text));
}

export function addressFor(typed: string, engine: SearchEngine = "duckduckgo"): string | null {
  const text = typed.trim();
  if (!text) return null;
  if (/^https?:\/\//i.test(text)) return text;
  if (isAddress(text)) return `https://${text}`;
  const search = SEARCH_ENGINES.find((e) => e.value === engine) ?? SEARCH_ENGINES[0];
  return `${search.url}${encodeURIComponent(text)}`;
}

/** A page's site, as protection is lowered for it: its host without "www.". */
export function siteOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    return /^https?:$/.test(parsed.protocol) ? parsed.hostname.replace(/^www\./, "").toLowerCase() : null;
  } catch {
    return null;
  }
}

/** The address box's address while not typing: just the site, without "www.". */
export function shortAddress(url: string): string {
  return siteOf(url) ?? url;
}

/** An address as people read it: without "https://", "www." or a lone "/" at the end. */
export function readableAddress(url: string): string {
  return url.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "");
}

/** What the browser is told about protection. */
export function protectionOf(prefs: BrowserPrefs): { level: ProtectionLevel; lowered: string[] } {
  return { level: prefs.protection, lowered: prefs.lowered };
}

/** Lowers protection for a site, or puts it back. */
export function lowerFor(site: string, lowered: boolean): BrowserPrefs {
  const list = readBrowserPrefs().lowered.filter((h) => h !== site);
  return writeBrowserPrefs({ lowered: lowered ? [...list, site] : list });
}

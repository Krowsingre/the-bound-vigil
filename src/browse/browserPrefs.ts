// Discover's browser choices, kept on this device: the search engine, the
// home page, whether ebook downloads go straight into the library, and how
// much the browser blocks (and for which sites that's lowered).

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
  /** Sites (hosts, without "www.") whose protection was lowered from Discover's ••• menu. */
  lowered: string[];
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
    comeBack: COME_BACK.some((c) => c.value === saved.comeBack) ? (saved.comeBack as ComeBack) : "keep",
    protection: PROTECTION_LEVELS.some((p) => p.value === saved.protection) ? (saved.protection as ProtectionLevel) : "strict",
    lowered: Array.isArray(saved.lowered) ? saved.lowered.filter((h): h is string => typeof h === "string") : [],
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
export function addressFor(typed: string, engine: SearchEngine = "duckduckgo"): string | null {
  const text = typed.trim();
  if (!text) return null;
  if (/^https?:\/\//i.test(text)) return text;
  if (!/\s/.test(text) && /^[^/]+\.[a-z]{2,}(\/|$|:)/i.test(text)) return `https://${text}`;
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

/** What the browser is told about protection. */
export function protectionOf(prefs: BrowserPrefs): { level: ProtectionLevel; lowered: string[] } {
  return { level: prefs.protection, lowered: prefs.lowered };
}

/** Lowers protection for a site, or puts it back. */
export function lowerFor(site: string, lowered: boolean): BrowserPrefs {
  const list = readBrowserPrefs().lowered.filter((h) => h !== site);
  return writeBrowserPrefs({ lowered: lowered ? [...list, site] : list });
}

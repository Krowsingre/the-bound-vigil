// Discover's browser choices, kept on this device: the search engine, the
// home page, and whether ebook downloads go straight into the library.

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

export interface BrowserPrefs {
  search: SearchEngine;
  home: string;
  /** Ebook downloads join the library without asking first. */
  addWithoutAsking: boolean;
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

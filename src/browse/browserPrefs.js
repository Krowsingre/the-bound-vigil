// Discover's browser choices, kept on this device: the search engine, the
// home page, whether ebook downloads go straight into the library, and how
// much the browser blocks (and for which sites that's lowered).
import { HISTORY_KEEPS } from "./browserHistory";
export const SEARCH_ENGINES = [
    { value: "duckduckgo", label: "DuckDuckGo", url: "https://duckduckgo.com/?q=" },
    { value: "google", label: "Google", url: "https://www.google.com/search?q=" },
    { value: "bing", label: "Bing", url: "https://www.bing.com/search?q=" },
    { value: "brave", label: "Brave Search", url: "https://search.brave.com/search?q=" },
    { value: "startpage", label: "Startpage", url: "https://www.startpage.com/do/search?q=" },
    { value: "ecosia", label: "Ecosia", url: "https://www.ecosia.org/search?q=" },
];
export const DEFAULT_HOME = "https://www.gutenberg.org/";
export const REDIRECT_MODES = [
    { value: "allow", label: "Automatically approve" },
    { value: "block", label: "Automatically reject" },
    { value: "ask", label: "Ask every time" },
];
export function redirectHost(value) {
    const text = value.trim();
    try {
        const url = new URL(/^https?:\/\//i.test(text) ? text : "https://" + text);
        return /^https?:$/.test(url.protocol) && url.hostname && !url.username && !url.password
            ? url.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "") : null;
    }
    catch {
        return null;
    }
}
export const PROTECTION_LEVELS = [
    { value: "strict", label: "Strict", hint: "Blocks trackers, advertising, harmful sites, cryptocurrency miners and fingerprinting, and cookies from other sites. Uses the EasyList, EasyPrivacy and Malicious URL lists, updated daily." },
    { value: "balanced", label: "Balanced", hint: "Blocks trackers, harmful sites and miners, and lets advertising and sign-in cookies through. Uses the EasyPrivacy and Malicious URL lists, updated daily." },
    { value: "off", label: "Off", hint: "Blocks nothing." },
];
export const COME_BACK = [
    { value: "keep", label: "Where you left off, with your tabs" },
    { value: "leave", label: "At the home page, after leaving Discover" },
    { value: "close", label: "At the home page, after closing TBV" },
];
export const LINKS_OPEN = [
    { value: "newTab", label: "In a new tab" },
    { value: "current", label: "In the tab you're on" },
];
/** The sizes Zoom steps through. */
export const ZOOMS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5];
/** What a tab showing TBV's start page has for its address. */
export const START_PAGE = "tbv:start";
export const isStartPage = (url) => url === START_PAGE;
/** Where new tabs and the Home button go. */
export function homeOf(prefs = readBrowserPrefs()) {
    return prefs.startPage ? START_PAGE : prefs.home;
}
const KEY = "tbv.browser.prefs";
/** Where the home page was kept before these choices were gathered together. */
const OLD_HOME_KEY = "tbv.browser.home";
const CHANGED = "tbv:browser-prefs";
export function readBrowserPrefs() {
    let saved = {};
    let oldHome = null;
    try {
        saved = JSON.parse(localStorage.getItem(KEY) ?? "{}");
        oldHome = localStorage.getItem(OLD_HOME_KEY);
    }
    catch {
        // The defaults, then.
    }
    const home = typeof saved.home === "string" && /^https?:\/\//i.test(saved.home) ? saved.home : oldHome ?? DEFAULT_HOME;
    return {
        search: SEARCH_ENGINES.some((e) => e.value === saved.search) ? saved.search : "duckduckgo",
        home,
        addWithoutAsking: saved.addWithoutAsking === true,
        deleteTemporaryWithHistory: saved.deleteTemporaryWithHistory !== false,
        downloadFolder: typeof saved.downloadFolder === "string" ? saved.downloadFolder : null,
        askDownloadFolder: saved.askDownloadFolder === true,
        redirects: saved.redirects === "block" || saved.redirects === "ask" ? saved.redirects : "allow",
        redirectAllowlist: [...new Set((Array.isArray(saved.redirectAllowlist) ? saved.redirectAllowlist : [])
                .flatMap((host) => typeof host === "string" ? redirectHost(host) ?? [] : []))],
        keepPlaying: saved.keepPlaying === true,
        historyOn: saved.historyOn !== false,
        historySearches: saved.historySearches !== false,
        historyKeep: HISTORY_KEEPS.some((k) => k.value === saved.historyKeep) ? saved.historyKeep : "quarter",
        comeBack: COME_BACK.some((c) => c.value === saved.comeBack) ? saved.comeBack : "keep",
        linksOpen: saved.linksOpen === "current" ? "current" : "newTab",
        protection: PROTECTION_LEVELS.some((p) => p.value === saved.protection) ? saved.protection : "strict",
        lowered: Array.isArray(saved.lowered) ? saved.lowered.filter((h) => typeof h === "string") : [],
        startPage: saved.startPage !== false,
        showRecent: saved.showRecent !== false,
        background: typeof saved.background === "string" && /^(own|gallery:[a-z-]+)$/.test(saved.background) ? saved.background : "",
        suggest: saved.suggest !== false,
        sites: readSites(saved.sites),
        askApps: saved.askApps !== false,
        clearOnStart: saved.clearOnStart === true,
    };
}
function readSites(saved) {
    if (!saved || typeof saved !== "object")
        return {};
    const sites = {};
    for (const [site, value] of Object.entries(saved)) {
        if (!value || typeof value !== "object")
            continue;
        const v = value;
        const kept = {};
        if (typeof v.zoom === "number" && v.zoom >= 0.3 && v.zoom <= 3 && v.zoom !== 1)
            kept.zoom = v.zoom;
        if (v.desktop === true)
            kept.desktop = true;
        if (Object.keys(kept).length)
            sites[site] = kept;
    }
    return sites;
}
export function writeBrowserPrefs(change) {
    const next = { ...readBrowserPrefs(), ...change };
    try {
        localStorage.setItem(KEY, JSON.stringify(next));
    }
    catch {
        // Kept for this visit only.
    }
    window.dispatchEvent(new CustomEvent(CHANGED));
    return next;
}
export function onBrowserPrefs(listener) {
    window.addEventListener(CHANGED, listener);
    return () => window.removeEventListener(CHANGED, listener);
}
/** What was typed, as an address: a web address as is, anything else searched for. */
/** Whether what's typed is a web address rather than words to search for. */
export function isAddress(typed) {
    const text = typed.trim();
    return /^https?:\/\//i.test(text) || (!/\s/.test(text) && /^[^/]+\.[a-z]{2,}(\/|$|:)/i.test(text));
}
export function addressFor(typed, engine = "duckduckgo") {
    const text = typed.trim();
    if (!text)
        return null;
    if (/^https?:\/\//i.test(text))
        return text;
    if (isAddress(text))
        return `https://${text}`;
    const search = SEARCH_ENGINES.find((e) => e.value === engine) ?? SEARCH_ENGINES[0];
    return `${search.url}${encodeURIComponent(text)}`;
}
/** A page's site, as protection is lowered for it: its host without "www.". */
export function siteOf(url) {
    try {
        const parsed = new URL(url);
        return /^https?:$/.test(parsed.protocol) ? parsed.hostname.replace(/^www\./, "").toLowerCase() : null;
    }
    catch {
        return null;
    }
}
/** The address box's address while not typing: just the site, without "www.". */
export function shortAddress(url) {
    return siteOf(url) ?? url;
}
/** An address as people read it: without "https://", "www." or a lone "/" at the end. */
export function readableAddress(url) {
    return url.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "");
}
/** What the browser is told about protection. */
export function protectionOf(prefs) {
    return { level: prefs.protection, lowered: prefs.lowered, redirects: prefs.redirects, redirectAllowlist: prefs.redirectAllowlist };
}
/** Lowers protection for a site, or puts it back. */
export function lowerFor(site, lowered) {
    const list = readBrowserPrefs().lowered.filter((h) => h !== site);
    return writeBrowserPrefs({ lowered: lowered ? [...list, site] : list });
}
/** A site's own choices, or none. */
export function siteSettings(site, prefs = readBrowserPrefs()) {
    return (site && prefs.sites[site]) || {};
}
/** Changes a site's own choices; one back to how it is everywhere else is forgotten. */
export function setSiteSettings(site, change) {
    const prefs = readBrowserPrefs();
    const next = { ...prefs.sites, [site]: { ...prefs.sites[site], ...change } };
    return writeBrowserPrefs({ sites: readSites(next) });
}
/** Every site with a choice of its own (protection, zoom or desktop version), A to Z. */
export function sitesWithSettings(prefs = readBrowserPrefs()) {
    return [...new Set([...prefs.lowered, ...Object.keys(prefs.sites)])].sort();
}
/** Puts a site back as everywhere else. */
export function resetSite(site) {
    const prefs = readBrowserPrefs();
    const sites = { ...prefs.sites };
    delete sites[site];
    return writeBrowserPrefs({ sites, lowered: prefs.lowered.filter((h) => h !== site) });
}
/** The hosts given their desktop version, as Apple's web view names them (with and without "www."). */
export function desktopHosts(prefs = readBrowserPrefs()) {
    return Object.entries(prefs.sites).flatMap(([site, s]) => (s.desktop ? [site, `www.${site}`] : []));
}
/** A zoom as people read it: "125%". */
export const zoomLabel = (zoom) => `${Math.round(zoom * 100)}%`;

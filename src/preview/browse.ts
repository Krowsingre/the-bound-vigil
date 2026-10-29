// Browse's calls where there's no app: bookmarks kept in memory, and a
// browser that only works in the app.

import type { Api } from "../api";
import type { Bookmark, QuickLink, SanctumLink } from "../api/types";

/** The ones a library starts with (the same as crates/tbv-core/src/quick_links.rs). */
export const STARTER_LINKS: QuickLink[] = [
  { id: "ql:gutenberg", title: "Project Gutenberg", url: "https://www.gutenberg.org/", picture: "vintage-herbarium" },
  { id: "ql:archive", title: "Internet Archive", url: "https://archive.org/", picture: "ancient-halls" },
  { id: "ql:wikipedia", title: "Wikipedia", url: "https://www.wikipedia.org/", picture: "snowbound-peaks" },
  { id: "ql:youtube", title: "YouTube", url: "https://www.youtube.com/", picture: "alien-desert" },
  { id: "ql:google", title: "Google", url: "https://www.google.com/", picture: "stormbound-harbor" },
  { id: "ql:reddit", title: "Reddit", url: "https://www.reddit.com/", picture: "colossal-planet" },
];

/** Sanctum's to start with (the same as crates/tbv-core/src/sanctum_links.rs). */
export const STARTER_SANCTUM_LINKS: SanctumLink[] = [
  { id: "sl:discover", title: "Discover", target: "tbv:discover", icon: "compass" },
  { id: "sl:bookmarks", title: "Bookmarks", target: "tbv:bookmarks", icon: "bookOpen" },
  { id: "sl:downloads", title: "Downloads", target: "tbv:downloads", icon: "download" },
  { id: "sl:reading", title: "Reading List", target: "tbv:reading", icon: "file" },
  { id: "sl:history", title: "History", target: "tbv:history", icon: "clock" },
];

type Calls = Pick<
  Api,
  | "downloadWebBook"
  | "bookmarks"
  | "addBookmark"
  | "renameBookmark"
  | "removeBookmark"
  | "quickLinks"
  | "addQuickLink"
  | "updateQuickLink"
  | "removeQuickLink"
  | "moveQuickLink"
  | "sanctumLinks"
  | "addSanctumLink"
  | "updateSanctumLink"
  | "removeSanctumLink"
  | "moveSanctumLink"
  | "siteIcon"
  | "browserShow"
  | "browserPlace"
  | "browserHide"
  | "browserAct"
  | "browserClear"
  | "browserFind"
  | "browserProtect"
  | "browserRead"
  | "browserCancelDownload"
  | "browserFetchPicture"
  | "onBrowserEvent"
  | "browserAddDownload"
  | "browserKeepDownload"
  | "browserDiscardDownload"
  | "browserZoom"
  | "browserDesktopSites"
  | "browserClearSite"
  | "browserShare"
  | "browserOpenApp"
  | "browserHistory"
  | "browserTravelled"
  | "putBrowserHistory"
  | "removeBrowserHistory"
  | "clearBrowserHistory"
  | "trimBrowserHistory"
>;

const APP_ONLY = "The browser works in the TBV app.";

export function browseStub(): Calls {
  let marks: Bookmark[] = [];
  let links: QuickLink[] = [...STARTER_LINKS];
  let sanctum: SanctumLink[] = [...STARTER_SANCTUM_LINKS];
  return {
    downloadWebBook: async () => {
      throw new Error("Books come down from the web in the TBV app.");
    },
    bookmarks: async () => marks,
    addBookmark: async (title, url) => {
      const found = marks.find((m) => m.url === url);
      if (found) return Object.assign(found, { title: title || url });
      const made = { id: crypto.randomUUID(), title: title || url, url };
      marks = [...marks, made];
      return made;
    },
    renameBookmark: async (id, title) => {
      marks = marks.map((m) => (m.id === id ? { ...m, title } : m));
    },
    removeBookmark: async (id) => {
      marks = marks.filter((m) => m.id !== id);
    },
    quickLinks: async () => links,
    addQuickLink: async (title, url, picture) => {
      const made = { id: crypto.randomUUID(), title: title || url, url, picture };
      links = [...links, made];
      return made;
    },
    updateQuickLink: async (id, title, url, picture) => {
      links = links.map((l) => (l.id === id ? { id, title: title || url, url, picture } : l));
    },
    removeQuickLink: async (id) => {
      links = links.filter((l) => l.id !== id);
    },
    moveQuickLink: async (id, to) => {
      const moving = links.find((l) => l.id === id);
      if (!moving) return;
      const rest = links.filter((l) => l.id !== id);
      rest.splice(Math.min(to, rest.length), 0, moving);
      links = rest;
    },
    sanctumLinks: async () => sanctum,
    addSanctumLink: async (title, target, icon) => {
      const made = { id: crypto.randomUUID(), title: title || target, target, icon };
      sanctum = [...sanctum, made];
      return made;
    },
    updateSanctumLink: async (id, title, target, icon) => {
      sanctum = sanctum.map((l) => (l.id === id ? { id, title: title || target, target, icon } : l));
    },
    removeSanctumLink: async (id) => {
      sanctum = sanctum.filter((l) => l.id !== id);
    },
    moveSanctumLink: async (id, to) => {
      const moving = sanctum.find((l) => l.id === id);
      if (!moving) return;
      const rest = sanctum.filter((l) => l.id !== id);
      rest.splice(Math.min(to, rest.length), 0, moving);
      sanctum = rest;
    },
    browserShow: async () => {
      throw new Error(APP_ONLY);
    },
    browserPlace: async () => undefined,
    browserHide: async () => undefined,
    browserAct: async () => undefined,
    browserClear: async () => undefined,
    browserFind: async () => undefined,
    browserProtect: async () => undefined,
    browserRead: async () => {
      throw new Error(APP_ONLY);
    },
    browserCancelDownload: async () => undefined,
    siteIcon: async () => {
      throw new Error(APP_ONLY);
    },
    browserFetchPicture: async () => {
      throw new Error(APP_ONLY);
    },
    // Design previews can act out what a page did: window.tbvPreviewBrowserEvent({ kind: "failed", … }).
    onBrowserEvent: (listener) => {
      (window as unknown as { tbvPreviewBrowserEvent?: typeof listener }).tbvPreviewBrowserEvent = listener;
      return () => undefined;
    },
    browserAddDownload: async () => {
      throw new Error(APP_ONLY);
    },
    browserKeepDownload: async () => {
      throw new Error(APP_ONLY);
    },
    browserDiscardDownload: async () => undefined,
    browserZoom: async () => undefined,
    browserDesktopSites: async () => undefined,
    browserClearSite: async () => undefined,
    browserShare: async () => {
      throw new Error(APP_ONLY);
    },
    browserOpenApp: async () => {
      throw new Error(APP_ONLY);
    },
    // History stays in the page's own copy in previews.
    browserHistory: async () => {
      throw new Error(APP_ONLY);
    },
    putBrowserHistory: async () => undefined,
    browserTravelled: async () => ({
      back: [
        { url: "https://www.gutenberg.org/ebooks/search/?query=shelley", title: "Books: shelley | Project Gutenberg" },
        { url: "https://www.gutenberg.org/", title: "Free eBooks | Project Gutenberg" },
      ],
      forward: [],
    }),
    removeBrowserHistory: async () => undefined,
    clearBrowserHistory: async () => undefined,
    trimBrowserHistory: async () => undefined,
  };
}

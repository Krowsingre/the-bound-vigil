// Browse's calls where there's no app: bookmarks kept in memory, and a
// browser that only works in the app.

import type { Api } from "../api";
import type { Bookmark, BrowserSession, BrowserEvent, CustomTheme, QuickLink, SanctumLink, WordDefinition, WordSense } from "../api/types";

const browserListeners = new Set<(event: BrowserEvent) => void>();

/** The ones a library starts with (the same as crates/tbv-core/src/quick_links.rs). */
let previewMedia: import("../api/types").MediaServerView[] = [{ id: "m1", name: "Home server", kind: "jellyfin", url: "http://192.168.1.20:8096", username: "reader" }];

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
  | "editBookmark"
  | "moveBookmark"
  | "removeBookmark"
  | "quickLinks"
  | "addQuickLink"
  | "updateQuickLink"
  | "removeQuickLink"
  | "moveQuickLink"
  | "sanctumLinks"
  | "customThemes"
  | "saveCustomTheme"
  | "removeCustomTheme"
  | "addSanctumLink"
  | "updateSanctumLink"
  | "removeSanctumLink"
  | "moveSanctumLink"
  | "setSanctumLinkPictureFile"
  | "siteIcon"
  | "browserShow"
  | "browserPlace"
  | "browserLayout"
  | "browserHide"
  | "browserAct"
  | "browserClear"
  | "lookUpWord"
  | "translateText"
  | "browserFind"
  | "browserProtect"
  | "browserRead"
  | "browserPip"
  | "browserVideo"
  | "mediaServers"
  | "mediaSignIn"
  | "mediaPlexStart"
  | "mediaPlexFinish"
  | "mediaRemove"
  | "mediaList"
  | "mediaPlay"
  | "browserReport"
  | "browserCancelDownload"
  | "browserFetchPicture"
  | "onBrowserEvent"
  | "browserAddDownload"
  | "browserKeepDownload"
  | "browserDownloadKind"
  | "browserTemporaryDownloads"
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
  | "setBrowserOpenTabs"
  | "browserOtherTabs"
  | "browserKeepPlaying"
  | "browserSessions"
  | "putBrowserSession"
  | "removeBrowserSession"
>;

const APP_ONLY = "The browser works in the TBV app.";

/** Sample sessions for design previews: one saved here, one on a phone. */
let previewSessions: BrowserSession[] = [
  { id: "sReading", name: "Reading list", active: 0, deviceId: "here", tabs: [
    { url: "https://www.gutenberg.org/ebooks/84", title: "Frankenstein" },
    { url: "https://standardebooks.org/", title: "Standard Ebooks" },
  ] },
  { id: "sPhone", name: "Gothic research", active: 0, deviceId: "phone", device: "Phone", tabs: [
    { url: "https://en.wikipedia.org/wiki/Gothic_fiction", title: "Gothic fiction - Wikipedia" },
  ] },
];

const lookSenses: WordSense[] = [
  { part: "noun", definition: "the feelings expressed on a person's face", example: "a sad expression" },
  { part: "noun", definition: "physical appearance", example: "I don't like the looks of this place" },
  { part: "verb", definition: "perceive with attention; direct one's gaze towards", example: "She looked over the expanse of land" },
];
/** A few words from the app's dictionary, to show what Define looks like. */
const PREVIEW_WORDS: Record<string, WordDefinition[]> = {
  lantern: [{ word: "lantern", senses: [{ part: "noun", definition: "light in a transparent protective case", example: null }] }],
  looking: [
    {
      word: "looking",
      senses: [
        { part: "noun", definition: "the act of directing the eyes toward something and perceiving it visually", example: "he went out to have a look" },
        { part: "noun", definition: "the act of searching visually", example: null },
        { part: "adjective", definition: "appearing to be as specified; usually used as combining forms", example: "left their clothes dirty looking" },
      ],
    },
    { word: "look", senses: lookSenses },
  ],
  look: [{ word: "look", senses: lookSenses }],
  melancholy: [
    {
      word: "melancholy",
      senses: [
        { part: "noun", definition: "a constitutional tendency to be gloomy and depressed", example: null },
        { part: "adjective", definition: "characterized by or causing or expressing sadness", example: "growing more melancholy every hour" },
      ],
    },
  ],
};

export function browseStub(): Calls {
  let marks: Bookmark[] = [];
  let links: QuickLink[] = [...STARTER_LINKS];
  let sanctum: SanctumLink[] = [...STARTER_SANCTUM_LINKS];
  let themes: CustomTheme[] = [];
  return {
    customThemes: async () => themes,
    saveCustomTheme: async (theme) => {
      const name = theme.name.trim().slice(0, 40);
      if (!name) throw new Error("Give the theme a name.");
      const saved = { ...theme, name, id: theme.id || crypto.randomUUID() };
      themes = themes.some((t) => t.id === saved.id) ? themes.map((t) => (t.id === saved.id ? saved : t)) : [...themes, saved];
      return saved;
    },
    removeCustomTheme: async (id) => {
      themes = themes.filter((t) => t.id !== id);
    },
    downloadWebBook: async () => {
      throw new Error("Books come down from the web in the TBV app.");
    },
    bookmarks: async () => marks,
    addBookmark: async (title, url, folder) => {
      const found = marks.find((m) => m.url === url);
      if (found) return Object.assign(found, { title: title || url });
      const made = { id: crypto.randomUUID(), title: title || url, url, folder };
      marks = [...marks, made];
      return made;
    },
    renameBookmark: async (id, title) => {
      marks = marks.map((m) => (m.id === id ? { ...m, title } : m));
    },
    editBookmark: async (id, title, url, folder) => {
      if (marks.some((m) => m.id !== id && m.url === url)) throw new Error("That address is already bookmarked.");
      marks = marks.map((m) => (m.id === id ? { ...m, title, url, folder } : m));
    },
    moveBookmark: async (id, direction) => {
      const index = marks.findIndex((m) => m.id === id);
      if (index < 0) return;
      let next = index + direction;
      while (marks[next] && (marks[next].folder ?? null) !== (marks[index].folder ?? null)) next += direction;
      if (marks[next]) [marks[index], marks[next]] = [marks[next], marks[index]];
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
    addSanctumLink: async (title, target, icon, picture) => {
      const made = { id: crypto.randomUUID(), title: title || target, target, icon, picture };
      sanctum = [...sanctum, made];
      return made;
    },
    updateSanctumLink: async (id, title, target, icon, picture) => {
      sanctum = sanctum.map((l) => (l.id === id ? { id, title: title || target, target, icon, picture } : l));
    },
    setSanctumLinkPictureFile: async () => {
      throw new Error("Pictures from the computer work in the TBV app.");
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
    browserLayout: async () => undefined,
    browserHide: async () => undefined,
    browserAct: async () => undefined,
    browserClear: async () => undefined,
    // A few words to show what Define looks like; the app has the whole dictionary.
    lookUpWord: async (text) => {
      const word = text.trim().toLowerCase().replace(/[^a-z' -]/g, "");
      return { shown: false, definitions: PREVIEW_WORDS[word] ?? [] };
    },
    translateText: async () => false,
    browserFind: async () => undefined,
    browserProtect: async () => undefined,
    browserRead: async () => {
      throw new Error(APP_ONLY);
    },
    browserPip: async () => "none" as const,
    browserVideo: async () => null,
    // A pretend Jellyfin server, so the screens can be seen in the preview.
    mediaServers: async () => previewMedia,
    mediaSignIn: async (kind, url, username) => {
      const added = { id: `m${previewMedia.length + 1}`, name: kind === "webdav" ? "Files" : "Home server", kind, url, username };
      previewMedia = [...previewMedia, added];
      return [added];
    },
    mediaPlexStart: async () => {
      throw new Error(APP_ONLY);
    },
    mediaPlexFinish: async () => null,
    mediaRemove: async (id) => {
      previewMedia = previewMedia.filter((s) => s.id !== id);
    },
    mediaList: async (_id, folder) => (folder
      ? [
        { id: "f1", title: "Nosferatu", kind: "video" as const, detail: "1922" },
        { id: "f2", title: "Metropolis", kind: "video" as const, detail: "1927" },
        { id: "f3", title: "The Cabinet of Dr. Caligari", kind: "video" as const, detail: "1920" },
        { id: "a1", title: "Night on Bald Mountain", kind: "audio" as const, detail: "Mussorgsky" },
      ]
      : [
        { id: "films", title: "Films", kind: "folder" as const },
        { id: "shows", title: "Shows", kind: "folder" as const },
        { id: "music", title: "Music", kind: "folder" as const },
      ]),
    mediaPlay: async () => {
      throw new Error(APP_ONLY);
    },
    browserReport: async () => [],
    browserCancelDownload: async () => undefined,
    siteIcon: async () => {
      throw new Error(APP_ONLY);
    },
    browserFetchPicture: async () => {
      throw new Error(APP_ONLY);
    },
    // Design previews can act out what a page did: window.tbvPreviewBrowserEvent({ kind: "failed", … }).
    onBrowserEvent: (listener) => {
      browserListeners.add(listener);
      (window as unknown as { tbvPreviewBrowserEvent?: typeof listener }).tbvPreviewBrowserEvent = (event) => {
        browserListeners.forEach((take) => take(event));
      };
      return () => { browserListeners.delete(listener); };
    },
    browserAddDownload: async () => {
      throw new Error(APP_ONLY);
    },
    browserKeepDownload: async () => {
      throw new Error(APP_ONLY);
    },
    browserDownloadKind: async () => "other",
    browserTemporaryDownloads: async () => ({ files: 0, bytes: 0, removed: [], failed: 0 }),
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
    setBrowserOpenTabs: async () => undefined,
    browserOtherTabs: async () => [
      { deviceId: "phone", name: "Phone", kind: "phone", updatedAt: new Date().toISOString(), tabs: [
        { url: "https://www.gutenberg.org/ebooks/84", title: "Frankenstein by Mary Wollstonecraft Shelley | Project Gutenberg" },
        { url: "https://en.wikipedia.org/wiki/Gothic_fiction", title: "Gothic fiction - Wikipedia" },
      ] },
    ],
    browserKeepPlaying: async () => undefined,
    browserSessions: async () => previewSessions,
    putBrowserSession: async (session) => {
      const at = previewSessions.findIndex((s) => s.id === session.id);
      const kept = { ...session, deviceId: previewSessions[at]?.deviceId ?? "here", device: previewSessions[at]?.device };
      if (at >= 0) previewSessions[at] = kept;
      else previewSessions.push(kept);
    },
    removeBrowserSession: async (id) => {
      previewSessions = previewSessions.filter((s) => s.id !== id);
    },
  };
}

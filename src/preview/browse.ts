// Browse's calls where there's no app: bookmarks kept in memory, and a
// browser that only works in the app.

import type { Api } from "../api";
import type { Bookmark, BookmarkFolder, BookmarkUndo, BrowserSession, BrowserEvent, CustomTheme, QuickLink, SanctumLink, WordDefinition, WordSense } from "../api/types";

const browserListeners = new Set<(event: BrowserEvent) => void>();

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
  | "editBookmark"
  | "moveBookmark"
  | "removeBookmark"
  | "bookmarkFolders"
  | "createBookmarkFolder"
  | "renameBookmarkFolder"
  | "deleteBookmarkFolder"
  | "moveBookmarks"
  | "moveBookmarkFolder"
  | "sortBookmarkFolder"
  | "removeBookmarks"
  | "undoBookmarks"
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
  | "browserTabKeys"
  | "browserFormMemory"
  | "browserClearForms"
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
  let folders: BookmarkFolder[] = [];
  const gone = new Set<string>();
  const live = () => marks.filter((m) => !gone.has(m.id));
  const name = (id?: string | null) => (id ? folders.find((f) => f.id === id && !gone.has(f.id))?.name ?? null : null);
  const place = (mark: Bookmark, folderId: string | null) => {
    marks = [...marks.filter((m) => m !== mark), mark];
    mark.folderId = folderId;
  };
  // Undo here puts the whole list back in its old order (the app only notes what moved).
  const snapshot = (): BookmarkUndo => ({
    places: [...marks.map((m, i) => ({ id: m.id, folder: false, parentId: m.folderId ?? null, position: i })), ...folders.map((f, i) => ({ id: f.id, folder: true, parentId: f.parentId, position: i }))],
    removedBookmarks: [],
    removedFolders: [],
  });
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
    bookmarks: async () => marks.filter((m) => !gone.has(m.id)).map((m) => ({ ...m, folder: name(m.folderId) })),
    bookmarkFolders: async () => folders.filter((f) => !gone.has(f.id)),
    addBookmark: async (title, url, folderId) => {
      const found = live().find((m) => m.url === url);
      if (found) {
        found.title = title || url;
        if (folderId) place(found, folderId);
        return { ...found };
      }
      const made: Bookmark = { id: crypto.randomUUID(), title: title || url, url, folderId: folderId ?? null, folder: name(folderId), createdAt: new Date().toISOString() };
      marks = [...marks, made];
      return made;
    },
    renameBookmark: async (id, title) => {
      marks = marks.map((m) => (m.id === id ? { ...m, title } : m));
    },
    editBookmark: async (id, title, url, folderId) => {
      if (live().some((m) => m.id !== id && m.url === url)) throw new Error("That address is already bookmarked.");
      const mark = marks.find((m) => m.id === id);
      if (!mark) return;
      Object.assign(mark, { title, url });
      if ((mark.folderId ?? null) !== (folderId ?? null)) place(mark, folderId ?? null);
    },
    moveBookmark: async (id, direction) => {
      const index = marks.findIndex((m) => m.id === id);
      if (index < 0) return;
      let next = index + direction;
      while (marks[next] && ((marks[next].folderId ?? null) !== (marks[index].folderId ?? null) || gone.has(marks[next].id))) next += direction;
      if (marks[next]) [marks[index], marks[next]] = [marks[next], marks[index]];
    },
    removeBookmark: async (id) => {
      gone.add(id);
    },
    createBookmarkFolder: async (folderName, parentId) => {
      if (!folderName.trim()) throw new Error("A folder needs a name.");
      const made = { id: crypto.randomUUID(), name: folderName.trim(), parentId, createdAt: new Date().toISOString() };
      folders = [...folders, made];
      return made;
    },
    renameBookmarkFolder: async (id, folderName) => {
      if (!folderName.trim()) throw new Error("A folder needs a name.");
      folders = folders.map((f) => (f.id === id ? { ...f, name: folderName.trim() } : f));
    },
    deleteBookmarkFolder: async (id, keepContents) => {
      const undo = snapshot();
      const folder = folders.find((f) => f.id === id);
      if (!folder) return undo;
      if (keepContents) {
        for (const m of live().filter((m) => m.folderId === id)) { marks = [...marks.filter((x) => x !== m), m]; m.folderId = folder.parentId; }
        for (const f of folders.filter((f) => f.parentId === id)) { folders = [...folders.filter((x) => x !== f), f]; f.parentId = folder.parentId; }
        gone.add(id);
        undo.removedFolders = [id];
      } else {
        const inside = [id];
        for (let i = 0; i < inside.length; i++) inside.push(...folders.filter((f) => f.parentId === inside[i] && !gone.has(f.id)).map((f) => f.id));
        undo.removedFolders = inside;
        undo.removedBookmarks = live().filter((m) => m.folderId && inside.includes(m.folderId)).map((m) => m.id);
        [...inside, ...undo.removedBookmarks].forEach((x) => gone.add(x));
      }
      return undo;
    },
    moveBookmarks: async (ids, folderId, before) => {
      const undo = snapshot();
      const moving = marks.filter((m) => ids.includes(m.id));
      marks = marks.filter((m) => !ids.includes(m.id));
      const at = before ? marks.findIndex((m) => m.id === before) : -1;
      moving.forEach((m) => (m.folderId = folderId));
      marks.splice(at < 0 ? marks.length : at, 0, ...moving);
      return undo;
    },
    moveBookmarkFolder: async (id, parentId, before) => {
      for (let at: string | null = parentId; at; at = folders.find((f) => f.id === at)?.parentId ?? null) {
        if (at === id) throw new Error("A folder can't go inside itself.");
      }
      const undo = snapshot();
      const folder = folders.find((f) => f.id === id);
      if (!folder) return undo;
      folders = folders.filter((f) => f.id !== id);
      const at = before ? folders.findIndex((f) => f.id === before) : -1;
      folder.parentId = parentId;
      folders.splice(at < 0 ? folders.length : at, 0, folder);
      return undo;
    },
    sortBookmarkFolder: async (folderId, by) => {
      const undo = snapshot();
      const key = (a: { title?: string; name?: string; createdAt?: string }) => (by === "name" ? (a.title ?? a.name ?? "").toLowerCase() : "");
      const order = <T extends { createdAt?: string; title?: string; name?: string }>(list: T[], inside: (x: T) => boolean) => {
        const picked = list.filter(inside).sort((a, b) => (by === "name" ? key(a).localeCompare(key(b)) : (b.createdAt ?? "").localeCompare(a.createdAt ?? "")));
        return [...list.filter((x) => !inside(x)), ...picked];
      };
      marks = order(marks, (m) => (m.folderId ?? null) === folderId);
      folders = order(folders, (f) => f.parentId === folderId);
      return undo;
    },
    removeBookmarks: async (ids) => {
      ids.forEach((id) => gone.add(id));
      return { places: [], removedBookmarks: ids, removedFolders: [] };
    },
    undoBookmarks: async (undo) => {
      [...undo.removedBookmarks, ...undo.removedFolders].forEach((id) => gone.delete(id));
      if (undo.places.length) {
        const where = new Map(undo.places.map((p) => [p.id, p]));
        const back = <T extends { id: string }>(list: T[]) => [...list].sort((a, b) => (where.get(a.id)?.position ?? 0) - (where.get(b.id)?.position ?? 0));
        marks = back(marks).map((m) => (where.has(m.id) ? { ...m, folderId: where.get(m.id)!.parentId } : m));
        folders = back(folders).map((f) => (where.has(f.id) ? { ...f, parentId: where.get(f.id)!.parentId } : f));
      }
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
    browserTabKeys: async () => undefined,
    browserFormMemory: async () => undefined,
    browserClearForms: async () => undefined,
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

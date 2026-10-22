// Browse's calls where there's no app: bookmarks kept in memory, and a
// browser that only works in the app.

import type { Api } from "../api";
import type { Bookmark } from "../api/types";

type Calls = Pick<
  Api,
  | "downloadWebBook"
  | "bookmarks"
  | "addBookmark"
  | "renameBookmark"
  | "removeBookmark"
  | "browserShow"
  | "browserPlace"
  | "browserHide"
  | "browserAct"
  | "onBrowserPage"
  | "onBrowserDownload"
  | "browserAddDownload"
  | "browserKeepDownload"
  | "browserDiscardDownload"
>;

const APP_ONLY = "The browser works in the TBV app.";

export function browseStub(): Calls {
  let marks: Bookmark[] = [];
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
    browserShow: async () => {
      throw new Error(APP_ONLY);
    },
    browserPlace: async () => undefined,
    browserHide: async () => undefined,
    browserAct: async () => undefined,
    onBrowserPage: () => () => undefined,
    onBrowserDownload: () => () => undefined,
    browserAddDownload: async () => {
      throw new Error(APP_ONLY);
    },
    browserKeepDownload: async () => {
      throw new Error(APP_ONLY);
    },
    browserDiscardDownload: async () => undefined,
  };
}

// The one place the UI talks to the app core. Inside the desktop app this
// calls Rust commands; in a plain browser (design previews only) it serves a
// clearly labelled sample library so screens can be looked at without the app.

import type { HomeViewModel, ImportResult, ReadStatus } from "./types";

export interface Api {
  readonly kind: "app" | "preview";
  getHome(): Promise<HomeViewModel>;
  importBooks(paths: string[]): Promise<ImportResult[]>;
  setBookStatus(bookId: string, status: ReadStatus): Promise<void>;
  pickBooks(): Promise<string[]>;
  pickFolder(): Promise<string[]>;
  coverUrl(path: string): string;
}

export const isApp = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const BOOK_EXTENSIONS = ["epub", "pdf", "mobi", "azw3", "cbz", "fb2"];

function appApi(): Api {
  // Loaded lazily so the browser preview never touches Tauri internals.
  const core = import("@tauri-apps/api/core");
  const dialog = import("@tauri-apps/plugin-dialog");
  let convert: ((path: string) => string) | null = null;
  void core.then((c) => (convert = c.convertFileSrc));

  const asList = (picked: string | string[] | null) =>
    picked === null ? [] : Array.isArray(picked) ? picked : [picked];

  return {
    kind: "app",
    getHome: async () => (await core).invoke<HomeViewModel>("get_home"),
    importBooks: async (paths) => (await core).invoke<ImportResult[]>("import_books", { paths }),
    setBookStatus: async (bookId, status) => (await core).invoke("set_book_status", { bookId, status }),
    pickBooks: async () =>
      asList(
        await (await dialog).open({
          multiple: true,
          title: "Import books",
          filters: [{ name: "Books", extensions: BOOK_EXTENSIONS }],
        }),
      ),
    pickFolder: async () =>
      asList(await (await dialog).open({ directory: true, multiple: false, title: "Import a folder of books" })),
    coverUrl: (path) => (convert ? convert(path) : ""),
  };
}

export const api: Api = isApp ? appApi() : (await import("./preview")).previewApi();

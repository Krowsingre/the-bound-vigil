// The one place the UI talks to the app core. Inside the desktop app this
// calls Rust commands; in a plain browser (design previews only) it serves a
// clearly labelled sample library so screens can be looked at without the app.

import type {
  Annotation,
  AnnotationInput,
  CollectionDetail,
  CollectionInput,
  CollectionPreview,
  CollectionRef,
  CollectionSummary,
  CollectionsOverview,
  HomeViewModel,
  ImportResult,
  LibraryPage,
  LibraryQuery,
  Profile,
  ReadStatus,
  ReaderBook,
  ReaderLocator,
} from "./types";

export interface Api {
  readonly kind: "app" | "preview";
  getHome(): Promise<HomeViewModel>;
  importBooks(paths: string[]): Promise<ImportResult[]>;
  setBookStatus(bookId: string, status: ReadStatus): Promise<void>;
  getLibrary(query: LibraryQuery): Promise<LibraryPage>;
  getCollections(): Promise<CollectionPreview[]>;
  setFavorite(bookId: string, favorite: boolean): Promise<void>;
  setWantToRead(bookId: string, want: boolean): Promise<void>;
  getProfile(): Promise<Profile>;
  /** Asks for a picture, copies it into TBV, and returns the new profile. Null if cancelled. */
  chooseAvatar(): Promise<Profile | null>;
  clearAvatar(): Promise<Profile>;
  pickBooks(): Promise<string[]>;
  pickFolder(): Promise<string[]>;
  coverUrl(path: string): string;
  /** Opens a book for reading (records when, and moves Unread to In progress). */
  openBook(bookId: string): Promise<ReaderBook>;
  /** The book file itself, for the reader's page engine. */
  readBookFile(bookId: string): Promise<Blob>;
  savePosition(bookId: string, locator: ReaderLocator): Promise<void>;
  getAnnotations(bookId: string): Promise<Annotation[]>;
  saveAnnotation(annotation: AnnotationInput): Promise<Annotation>;
  deleteAnnotation(id: string): Promise<void>;
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): Promise<void>;
  /** Quits the whole app. */
  quit(): Promise<void>;
  getCollectionsOverview(): Promise<CollectionsOverview>;
  getCollection(collection: CollectionRef): Promise<CollectionDetail>;
  createCollection(input: CollectionInput): Promise<CollectionSummary>;
  updateCollection(id: string, input: CollectionInput): Promise<CollectionSummary>;
  deleteCollection(id: string): Promise<void>;
  /** A gallery picture (`gallery:<name>`), a book's cover (`cover:<book id>`), or none. */
  setCollectionPicture(id: string, picture: string | null): Promise<CollectionSummary>;
  /** Asks for a picture on the computer. Null if cancelled. */
  pickCollectionPicture(): Promise<string | null>;
  /** Uses a copy of a picture on the computer for a collection. */
  setCollectionPictureFile(id: string, path: string): Promise<CollectionSummary>;
  addToCollection(id: string, bookIds: string[]): Promise<void>;
  removeFromCollection(id: string, bookId: string): Promise<void>;
  /** Moves one of your collections to a new place (zero-based) in "Your order". */
  moveCollection(id: string, toIndex: number): Promise<void>;
  moveInCollection(id: string, bookId: string, toIndex: number): Promise<void>;
  /** Ids of the user's collections a book is in. */
  collectionsForBook(bookId: string): Promise<string[]>;
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
    getLibrary: async (query) => (await core).invoke<LibraryPage>("get_library", { query }),
    getCollections: async () => (await core).invoke<CollectionPreview[]>("get_collections"),
    setFavorite: async (bookId, favorite) => (await core).invoke("set_favorite", { bookId, favorite }),
    setWantToRead: async (bookId, want) => (await core).invoke("set_want_to_read", { bookId, want }),
    getProfile: async () => (await core).invoke<Profile>("get_profile"),
    chooseAvatar: async () => {
      const [path] = asList(
        await (await dialog).open({
          multiple: false,
          title: "Choose a profile picture",
          filters: [{ name: "Pictures", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }],
        }),
      );
      return path ? (await core).invoke<Profile>("set_avatar", { path }) : null;
    },
    clearAvatar: async () => (await core).invoke<Profile>("clear_avatar"),
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
    openBook: async (bookId) => (await core).invoke<ReaderBook>("open_book", { bookId }),
    readBookFile: async (bookId) => {
      // Raw bytes normally arrive as an ArrayBuffer, but if Tauri has to fall
      // back to its slower message channel they come as a list of numbers.
      const bytes = await (await core).invoke<ArrayBuffer | number[]>("read_book_file", { bookId });
      return new Blob([Array.isArray(bytes) ? new Uint8Array(bytes) : bytes]);
    },
    savePosition: async (bookId, locator) => (await core).invoke("save_position", { bookId, locator }),
    getAnnotations: async (bookId) => (await core).invoke<Annotation[]>("get_annotations", { bookId }),
    saveAnnotation: async (annotation) => (await core).invoke<Annotation>("save_annotation", { annotation }),
    deleteAnnotation: async (id) => (await core).invoke("delete_annotation", { id }),
    getSetting: async (key) => (await core).invoke<string | null>("get_setting", { key }),
    setSetting: async (key, value) => (await core).invoke("set_setting", { key, value }),
    quit: async () => (await core).invoke("quit_app"),
    getCollectionsOverview: async () => (await core).invoke<CollectionsOverview>("get_collections_overview"),
    getCollection: async (collection) => (await core).invoke<CollectionDetail>("get_collection", { collection }),
    createCollection: async (input) => (await core).invoke<CollectionSummary>("create_collection", { input }),
    updateCollection: async (id, input) => (await core).invoke<CollectionSummary>("update_collection", { id, input }),
    deleteCollection: async (id) => (await core).invoke("delete_collection", { id }),
    setCollectionPicture: async (id, picture) =>
      (await core).invoke<CollectionSummary>("set_collection_picture", { id, picture }),
    pickCollectionPicture: async () => {
      const [path] = asList(
        await (await dialog).open({
          multiple: false,
          title: "Choose a picture for this collection",
          filters: [{ name: "Pictures", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }],
        }),
      );
      return path ?? null;
    },
    setCollectionPictureFile: async (id, path) => (await core).invoke<CollectionSummary>("set_collection_picture_file", { id, path }),
    addToCollection: async (id, bookIds) => (await core).invoke("add_to_collection", { id, bookIds }),
    removeFromCollection: async (id, bookId) => (await core).invoke("remove_from_collection", { id, bookId }),
    moveCollection: async (id, toIndex) => (await core).invoke("move_collection", { id, toIndex }),
    moveInCollection: async (id, bookId, toIndex) => (await core).invoke("move_in_collection", { id, bookId, toIndex }),
    collectionsForBook: async (bookId) => (await core).invoke<string[]>("collections_for_book", { bookId }),
  };
}

/** Opens a web link in the person's browser, never inside TBV. */
export async function openExternal(url: string): Promise<void> {
  if (!/^https?:\/\//i.test(url)) return;
  if (isApp) await (await import("@tauri-apps/plugin-opener")).openUrl(url);
  else window.open(url, "_blank", "noopener");
}

export const api: Api = isApp ? appApi() : (await import("./preview")).previewApi();

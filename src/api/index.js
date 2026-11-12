// The one place the UI talks to the app core. Inside the desktop app this
// calls Rust commands; in a plain browser (design previews only) it serves a
// clearly labelled sample library so screens can be looked at without the app.
import { homeAudioUrl, homeCore, homeEvents } from "./homeCore";
export const isApp = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
/** Starts the id of an audiobook played straight from an Audiobookshelf server (it isn't in the library). */
export const SERVER_BOOK = "abs~";
export const isServerBook = (bookId) => bookId.startsWith(SERVER_BOOK);
/** The player's id for an audiobook on a saved Audiobookshelf catalogue. */
export const serverBookId = (catalogId, itemId) => `${SERVER_BOOK}${catalogId}~${itemId}`;
/** The pages TBV on the computer serves to a phone at home (Preferences › Sync › Stream to your phone at home). */
export const isHome = !isApp && typeof document !== "undefined" && !!document.querySelector('meta[name="tbv-home"]');
/** The iPhone app: the full app, laid out for a phone. iPads say they're Macs. */
export const isIOS = isApp &&
    typeof navigator !== "undefined" &&
    (/iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1));
/** The Android test version: the phone layout, without iCloud, the browser or saving files to the phone. */
export const isAndroid = isApp && typeof navigator !== "undefined" && /Android/.test(navigator.userAgent);
/** The Mac app: the computer's layout, with the Mac's own window buttons. */
export const isMac = isApp && !isIOS && !isAndroid && typeof navigator !== "undefined" && /Macintosh/.test(navigator.userAgent);
/** The web version, for phones: built with `npm run build:web`, syncing through Supabase. */
/** The Windows app, where a PDF can be saved straight to a file. */
export const isWindows = isApp && !isIOS && !isAndroid && typeof navigator !== "undefined" && /Windows/.test(navigator.userAgent);
export const isWeb = !isApp && import.meta.env.VITE_TBV_WEB === "1";
const NOT_ON_ANDROID = "Saving to a file on the phone isn't in the Android test version yet.";
/** Files chosen in the web view's own picker (empty if cancelled). */
function pickInPage(multiple) {
    return new Promise((resolve) => {
        const input = document.createElement("input");
        input.type = "file";
        input.multiple = multiple;
        input.style.display = "none";
        const done = (files) => {
            input.remove();
            resolve(files);
        };
        input.addEventListener("change", () => done(Array.from(input.files ?? [])), { once: true });
        input.addEventListener("cancel", () => done([]), { once: true });
        document.body.appendChild(input);
        input.click();
    });
}
const BOOK_EXTENSIONS = ["epub", "pdf", "mobi", "azw", "azw3", "fb2", "fbz", "cbz", "cbr", "txt", "docx", "doc"];
// At home on the phone there's no app window to hear events from.
const tauriEvents = () => (isHome ? Promise.resolve(homeEvents) : import("@tauri-apps/api/event"));
/** Listens for an event from the app, until the returned function is called. */
function listenFor(name, listener) {
    let stop = null;
    let stopped = false;
    void tauriEvents().then(async ({ listen }) => {
        const unlisten = await listen(name, (e) => listener(e.payload));
        if (stopped)
            unlisten();
        else
            stop = unlisten;
    });
    return () => {
        stopped = true;
        stop?.();
    };
}
/** Listens for one of the app's events until the returned function is called. */
function onEvent(name, listener) {
    let stop = null;
    let stopped = false;
    void tauriEvents().then(async ({ listen }) => {
        const unlisten = await listen(name, (e) => listener(e.payload));
        if (stopped)
            unlisten();
        else
            stop = unlisten;
    });
    return () => {
        stopped = true;
        stop?.();
    };
}
function appApi() {
    // Loaded lazily so the browser preview never touches Tauri internals.
    const core = (isHome ? Promise.resolve(homeCore) : import("@tauri-apps/api/core"));
    const dialog = import("@tauri-apps/plugin-dialog");
    // The Mac App Store's sandbox lets TBV into a folder the person chose only
    // until it quits, unless TBV keeps a bookmark to it.
    const keepAccess = async (paths) => {
        if (isMac)
            await Promise.all(paths.map((path) => core.then((c) => c.invoke("keep_folder_access", { path })).catch(() => undefined)));
        return paths;
    };
    let convert = null;
    void core.then((c) => (convert = c.convertFileSrc));
    const asList = (picked) => picked === null ? [] : Array.isArray(picked) ? picked : [picked];
    // On iPhone the dialog answers with addresses the core can't open, and
    // iCloud files may not be on the phone yet, so TBV's own picker copies
    // them in first.
    // `keep` is for a file read again later (a key file), not just imported.
    // On Android the dialog answers with addresses the core can't open
    // either, so the page's own picker hands the files over and TBV keeps them.
    const pickOnAndroid = async (multiple, keep) => {
        const files = await pickInPage(multiple);
        const paths = [];
        for (const file of files)
            paths.push(await (await core).invoke("keep_picked_file", new Uint8Array(await file.arrayBuffer()), {
                headers: { "file-name": encodeURIComponent(file.name), keep: keep ? "1" : "0" },
            }));
        return paths;
    };
    const openFiles = async ({ keep, ...options }) => isIOS
        ? (await (await core).invoke("ios_pick_files", { keep: !!keep })).slice(0, options.multiple ? undefined : 1)
        : isAndroid
            ? pickOnAndroid(options.multiple, !!keep)
            : asList(await (await dialog).open(options));
    // Android's test version can't save to a file or open a folder on the phone yet.
    const savePicker = async (options) => {
        if (isAndroid)
            throw new Error(NOT_ON_ANDROID);
        return (await dialog).save(options);
    };
    const folderPicker = async (options) => {
        if (isAndroid)
            throw new Error("Choosing a folder isn't in the Android test version yet.");
        return (await dialog).open(options);
    };
    const today = () => new Date().toISOString().slice(0, 10);
    const saveTo = async (command, title, defaultPath, name, extensions) => {
        const path = await savePicker({ title, defaultPath, filters: [{ name, extensions }] });
        if (!path)
            return false;
        await (await core).invoke(command, { path });
        return true;
    };
    return {
        kind: "app",
        getHome: async () => (await core).invoke("get_home"),
        queueImports: async (paths) => (await core).invoke("queue_imports", { paths }),
        importQueue: async () => (await core).invoke("import_queue"),
        takePdfCovers: async () => (await core).invoke("take_pdf_covers"),
        cancelImports: async () => (await core).invoke("cancel_imports"),
        clearFinishedImports: async () => (await core).invoke("clear_finished_imports"),
        syncActivity: async () => (await core).invoke("sync_activity"),
        clearSyncChanges: async () => (await core).invoke("clear_sync_changes"),
        onSyncActivity: (listener) => {
            let stop = null;
            let stopped = false;
            void tauriEvents().then(async ({ listen }) => {
                let heard = false;
                const unlisten = await listen("sync-activity", (e) => {
                    heard = true;
                    listener(e.payload);
                });
                if (stopped)
                    return unlisten();
                stop = unlisten;
                // The snapshot is asked for only once updates are heard, so none slips between
                // the two, and it's dropped if an update has already arrived.
                const snapshot = await (await core).invoke("sync_activity").catch(() => null);
                if (snapshot && !heard && !stopped)
                    listener(snapshot);
            });
            return () => {
                stopped = true;
                stop?.();
            };
        },
        onImports: (listener) => {
            let stop = null;
            let stopped = false;
            void tauriEvents().then(async ({ listen }) => {
                const unlisten = await listen("imports-changed", (e) => listener(e.payload));
                if (stopped)
                    unlisten();
                else
                    stop = unlisten;
            });
            return () => {
                stopped = true;
                stop?.();
            };
        },
        setBookStatus: async (bookId, status) => {
            if (!isServerBook(bookId))
                await (await core).invoke("set_book_status", { bookId, status });
        },
        getLibrary: async (query) => (await core).invoke("get_library", { query }),
        getCollections: async () => (await core).invoke("get_collections"),
        setFavorite: async (bookId, favorite) => (await core).invoke("set_favorite", { bookId, favorite }),
        archiveSeriesPins: async () => (await core).invoke("archive_series_pins"),
        setArchiveSeriesPin: async (name, pinned) => (await core).invoke("set_archive_series_pin", { name, pinned }),
        setAudioType: async (bookId, kind) => (await core).invoke("set_audio_type", { bookId, kind }),
        setPinned: async (bookId, pinned) => (await core).invoke("set_pinned", { bookId, pinned }),
        setWantToRead: async (bookId, want, replace) => (await core).invoke("set_want_to_read", { bookId, want, replace }),
        setPhoneWanted: async (bookIds, wanted) => (await core).invoke("set_phone_wanted", { bookIds, wanted }),
        setRating: async (bookId, rating) => (await core).invoke("set_rating", { bookId, rating }),
        importGoodreads: async () => {
            const [path] = await openFiles({
                multiple: false,
                title: "Import your Goodreads export",
                filters: [{ name: "Goodreads export", extensions: ["csv"] }],
            });
            return path ? (await core).invoke("import_goodreads", { path }) : null;
        },
        importKindle: async (path) => (await core).invoke("import_kindle", { path }),
        kindleReview: async () => (await core).invoke("kindle_review"),
        applyKindle: async (confirmed, markRead) => (await core).invoke("apply_kindle", { confirmed, markRead }),
        kindleSummary: async () => (await core).invoke("kindle_summary"),
        matchKindleManually: async (asin, bookIds, markRead) => (await core).invoke("match_kindle_manually", { asin, bookIds, markRead }),
        kindleMissing: async (removed) => (await core).invoke("kindle_missing", { removed }),
        setKindleRemoved: async (asins, removed) => (await core).invoke("set_kindle_removed", { asins, removed }),
        exportGoodreads: async () => {
            const path = await savePicker({
                title: "Export for Goodreads",
                defaultPath: `TBV for Goodreads ${today()}.csv`,
                filters: [{ name: "Goodreads file", extensions: ["csv"] }],
            });
            return path ? (await core).invoke("export_goodreads", { path }) : null;
        },
        hardcoverStatus: async () => (await core).invoke("hardcover_status"),
        hardcoverSignIn: async () => (await core).invoke("hardcover_sign_in"),
        hardcoverSignOut: async () => (await core).invoke("hardcover_sign_out"),
        canvaStatus: async () => (await core).invoke("canva_status"),
        canvaSignIn: async () => (await core).invoke("canva_sign_in"),
        canvaSignOut: async () => (await core).invoke("canva_sign_out"),
        canvaNewDesign: async (title, width, height) => (await core).invoke("canva_new_design", { title, width: Math.round(width), height: Math.round(height) }),
        canvaDesign: async (id) => (await core).invoke("canva_design", { id }),
        canvaImport: async (title, mime, bytes) => (await core).invoke("canva_import", bytes, { headers: { title: encodeURIComponent(title), mime: encodeURIComponent(mime) } }),
        canvaImportFile: async (path, title) => (await core).invoke("canva_import_file", { path, title }),
        canvaExport: async (id, format) => new Uint8Array(await (await core).invoke("canva_export", { id, format })),
        canvaOpen: async (url) => (await core).invoke("canva_open", { url }),
        hardcoverSetSending: async (on) => (await core).invoke("hardcover_set_sending", { on }),
        hardcoverSendAll: async () => (await core).invoke("hardcover_send_all"),
        onHardcoverNotice: (listener) => {
            let stop = null;
            let stopped = false;
            void tauriEvents().then(async ({ listen }) => {
                const unlisten = await listen("hardcover-notice", (e) => listener(e.payload.message));
                if (stopped)
                    unlisten();
                else
                    stop = unlisten;
            });
            return () => {
                stopped = true;
                stop?.();
            };
        },
        onSharedBooks: (listener) => {
            let stop = null;
            let stopped = false;
            void tauriEvents().then(async ({ listen }) => {
                const unlisten = await listen("shared-books", (e) => listener(e.payload.message));
                if (stopped)
                    unlisten();
                else
                    stop = unlisten;
            });
            return () => {
                stopped = true;
                stop?.();
            };
        },
        bookText: async (bookId) => (await core).invoke("book_text", { bookId }),
        fillCover: async (bookId, picture) => (await core).invoke("fill_cover", picture, { headers: { "book-id": bookId } }),
        fetchCover: async (bookId, url) => (await core).invoke("fetch_cover", { bookId, url }),
        // A book played straight from an Audiobookshelf server isn't in the library: the server keeps its place.
        audiobook: async (bookId) => (await core).invoke(isServerBook(bookId) ? "server_audiobook" : "audiobook", { bookId }),
        saveListening: async (bookId, positionMs, chapter) => isServerBook(bookId)
            ? (await core).invoke("server_listening", { bookId, positionMs: Math.max(0, Math.round(positionMs)) })
            : (await core).invoke("save_listening", { bookId, positionMs: Math.max(0, Math.round(positionMs)), chapter }),
        addTime: async (day, kind, seconds) => (await core).invoke("add_time", { day, kind, seconds: Math.round(seconds) }),
        timeSpent: async () => (await core).invoke("time_spent"),
        linkEbook: async (audiobookId, ebookId) => (await core).invoke("link_ebook", { audiobookId, ebookId }),
        audiobookForEbook: async (ebookId) => (await core).invoke("audiobook_for_ebook", { ebookId }),
        readAlongTiming: async (ebookId, audiobookId) => (await core).invoke("read_along_timing", { ebookId, audiobookId }),
        saveReadAlongTiming: async (ebookId, audiobookId, timing) => (await core).invoke("save_read_along_timing", { ebookId, audiobookId, timing }),
        readAlongPieces: async (ebookId, audiobookId) => (await core).invoke("read_along_pieces", { ebookId, audiobookId }),
        saveReadAlongPiece: async (ebookId, audiobookId, piece, anchors) => (await core).invoke("save_read_along_piece", { ebookId, audiobookId, piece, anchors }),
        clearReadAlongPieces: async (ebookId, audiobookId) => (await core).invoke("clear_read_along_pieces", { ebookId, audiobookId }),
        readAlongPairs: async () => (await core).invoke("read_along_pairs"),
        setReadAlongQueued: async (ebookId, audiobookId, queued) => (await core).invoke("set_read_along_queued", { ebookId, audiobookId, queued }),
        orderReadAlongQueue: async (order) => (await core).invoke("order_read_along_queue", { order }),
        onLiningUp: (listener) => {
            let stop = null;
            let stopped = false;
            void tauriEvents().then(async ({ listen }) => {
                let heard = false;
                const unlisten = await listen("lining-up", (e) => {
                    heard = true;
                    listener(e.payload);
                });
                if (stopped)
                    return unlisten();
                stop = unlisten;
                const now = await (await core).invoke("lining_up_status").catch(() => null);
                if (!heard && !stopped)
                    listener(now);
            });
            return () => {
                stopped = true;
                stop?.();
            };
        },
        onLinedUp: (listener) => listenFor("lined-up", ([e, a]) => listener(e, a)),
        onBookWordsWanted: (listener) => listenFor("lining-up-needs-words", listener),
        saveBookWords: async (ebookId, words) => (await core).invoke("save_book_words", { ebookId, words }),
        pauseLiningUp: async (paused, hours) => (await core).invoke("lining_up_pause", { paused, hours }),
        liningUpPaused: async () => (await core).invoke("lining_up_paused"),
        pauseLiningUpAfter: async (on) => (await core).invoke("lining_up_pause_after", { on }),
        onLiningUpPaused: (listener) => listenFor("lining-up-paused", listener),
        wakeLiningUp: async () => (await core).invoke("lining_up_wake"),
        speechModels: async () => (await core).invoke("speech_models"),
        removeSpeechModels: async () => (await core).invoke("remove_speech_models"),
        // Windows and Android reach custom schemes through http://<scheme>.localhost.
        prepareStream: async (bookId) => {
            await (await core).invoke("prepare_stream", { bookId });
            return null;
        },
        homeStatus: async () => (await core).invoke("home_status"),
        setHome: async (on) => (await core).invoke("set_home", { on }),
        newHomeCode: async () => (await core).invoke("new_home_code"),
        forgetHomePhones: async () => (await core).invoke("forget_home_phones"),
        onHomeChanged: (listener) => onEvent("home-changed", () => listener()),
        audioUrl: (bookId, part) => isHome
            ? homeAudioUrl(bookId, part)
            : `${/windows|android/i.test(navigator.userAgent) ? "http://tbvaudio.localhost" : "tbvaudio://localhost"}/${encodeURIComponent(bookId)}/${part}`,
        getProfile: async () => (await core).invoke("get_profile"),
        chooseAvatar: async (from) => {
            if (from === "photos" && isIOS) {
                const photo = await (await core).invoke("ios_pick_photo");
                return photo ? (await core).invoke("set_avatar", { path: photo }) : null;
            }
            const [path] = await openFiles({
                multiple: false,
                title: "Choose a profile picture",
                filters: [{ name: "Pictures", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }],
            });
            return path ? (await core).invoke("set_avatar", { path }) : null;
        },
        clearAvatar: async () => (await core).invoke("clear_avatar"),
        setAccountName: async (name) => (await core).invoke("set_account_name", { name }),
        setDeviceName: async (name) => (await core).invoke("set_device_name", { name }),
        pickBooks: async () => openFiles({
            multiple: true,
            title: "Import books",
            // A list of books bought on Kindle (.json) can be chosen here too,
            // under All files: it's read as a list, not imported as a book.
            filters: isIOS || isAndroid ? [{ name: "Books", extensions: [...BOOK_EXTENSIONS, "json"] }] : [{ name: "Books", extensions: BOOK_EXTENSIONS }, { name: "All files", extensions: ["*"] }],
        }),
        pickFolder: async () => isIOS
            ? asList(await (await core).invoke("ios_pick_folder"))
            : keepAccess(asList(await folderPicker({ directory: true, multiple: false, title: "Import a folder of books" }))),
        coverUrl: (path) => (convert ? convert(path) : ""),
        openBook: async (bookId) => (await core).invoke("open_book", { bookId }),
        readBookFile: async (bookId) => {
            // Raw bytes normally arrive as an ArrayBuffer, but if Tauri has to fall
            // back to its slower message channel they come as a list of numbers.
            const bytes = await (await core).invoke("read_book_file", { bookId });
            return new Blob([Array.isArray(bytes) ? new Uint8Array(bytes) : bytes]);
        },
        savePosition: async (bookId, locator) => (await core).invoke("save_position", { bookId, locator }),
        getAnnotations: async (bookId) => (await core).invoke("get_annotations", { bookId }),
        saveAnnotation: async (annotation) => (await core).invoke("save_annotation", { annotation }),
        deleteAnnotation: async (id) => (await core).invoke("delete_annotation", { id }),
        getSetting: async (key) => (await core).invoke("get_setting", { key }),
        setSetting: async (key, value) => (await core).invoke("set_setting", { key, value }),
        quit: async () => (await core).invoke("quit_app"),
        getCollectionsOverview: async () => (await core).invoke("get_collections_overview"),
        getCollection: async (collection) => (await core).invoke("get_collection", { collection }),
        createCollection: async (input) => (await core).invoke("create_collection", { input }),
        countRuleMatches: async (rules) => (await core).invoke("count_rule_matches", { rules }),
        updateCollection: async (id, input) => (await core).invoke("update_collection", { id, input }),
        deleteCollection: async (id) => (await core).invoke("delete_collection", { id }),
        setCollectionPicture: async (id, picture) => (await core).invoke("set_collection_picture", { id, picture }),
        pickCollectionPicture: async () => {
            const [path] = await openFiles({
                multiple: false,
                title: "Choose a picture for this collection",
                filters: [{ name: "Pictures", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }],
            });
            return path ?? null;
        },
        setCollectionPictureFile: async (id, path) => (await core).invoke("set_collection_picture_file", { id, path }),
        addToCollection: async (id, bookIds) => (await core).invoke("add_to_collection", { id, bookIds }),
        removeFromCollection: async (id, bookId) => (await core).invoke("remove_from_collection", { id, bookId }),
        moveCollection: async (id, toIndex) => (await core).invoke("move_collection", { id, toIndex }),
        moveInCollection: async (id, bookId, toIndex) => (await core).invoke("move_in_collection", { id, bookId, toIndex }),
        collectionsForBook: async (bookId) => (await core).invoke("collections_for_book", { bookId }),
        getNotes: async (query) => (await core).invoke("get_notes", { query }),
        saveBookNote: async (bookId, id, text) => (await core).invoke("save_book_note", { bookId, id, text }),
        savePersonalNote: async (id, title, body, tags) => (await core).invoke("save_personal_note", { id, title, body, tags }),
        setAnnotationNote: async (id, note) => (await core).invoke("set_annotation_note", { id, note }),
        deleteNote: async (id, kind) => (await core).invoke("delete_note", { id, kind }),
        setNotePinned: async (id, pinned) => (await core).invoke("set_note_pinned", { id, pinned }),
        setNoteTags: async (id, tags) => (await core).invoke("set_note_tags", { id, tags }),
        setNoteProject: async (id, projectId) => (await core).invoke("set_note_project", { id, projectId }),
        libraryInfo: async () => (await core).invoke("library_info"),
        exportLibrary: () => saveTo("export_library", "Export library data", `TBV library ${today()}.json`, "JSON", ["json"]),
        exportNotesMarkdown: () => saveTo("export_notes_markdown", "Export notes", `TBV notes ${today()}.md`, "Markdown", ["md"]),
        createBackup: () => saveTo("create_backup", "Create a backup", `TBV backup ${today()}.tbvbackup`, "TBV backup", ["tbvbackup"]),
        restoreBackup: async () => {
            const [path] = await openFiles({
                multiple: false,
                title: "Restore from a backup",
                filters: [{ name: "TBV backup", extensions: ["tbvbackup", "db", "sqlite"] }],
            });
            if (!path)
                return false;
            await (await core).invoke("restore_backup", { path });
            return true;
        },
        coverAccent: async (bookId) => (await core).invoke("cover_accent", { bookId }),
        showFolder: async (path) => (await core).invoke("show_folder", { path }),
        syncOverview: async () => (await core).invoke("sync_overview"),
        syncNow: async () => (await core).invoke("sync_now"),
        syncSignIn: async (email, password, create) => (await core).invoke("sync_sign_in", { email, password, create }),
        syncSignOut: async () => (await core).invoke("sync_sign_out"),
        setSupabaseProject: async (project) => (await core).invoke("set_supabase_project", { project }),
        setSyncProvider: async (provider) => (await core).invoke("set_sync_provider", { provider }),
        setAlsoSync: async (provider) => (await core).invoke("set_also_sync", { provider }),
        chooseFolder: async (title, start) => {
            // On iPhone a folder is chosen in Files, and TBV keeps permission to open it.
            if (isIOS)
                return (await core).invoke("ios_pick_folder");
            const picked = await folderPicker({ directory: true, multiple: false, title, defaultPath: start ?? undefined });
            if (typeof picked !== "string")
                return null;
            await keepAccess([picked]);
            return picked;
        },
        suggestSyncFolder: async (service) => (await core).invoke("suggest_sync_folder", { service }),
        welcomedBack: async () => (await core).invoke("welcomed_back"),
        cloudSignIn: async (service) => (await core).invoke("cloud_sign_in", { service }),
        cloudServices: async () => (await core).invoke("cloud_services"),
        checkForUpdate: async () => (await core).invoke("update_check"),
        installUpdate: async () => (await core).invoke("update_install"),
        onUpdateProgress: (listener) => onEvent("update-progress", listener),
        licenseStatus: async () => (await core).invoke("license_status"),
        buyLicense: async (plan) => (await core).invoke("license_buy", { plan }),
        restoreLicense: async () => (await core).invoke("license_restore"),
        unlockLicense: async (code) => (await core).invoke("license_unlock", { code }),
        activateLicense: async (key) => (await core).invoke("license_activate", { key }),
        resolveSyncConflict: async (kind, key, keepCloud) => (await core).invoke("resolve_sync_conflict", { kind, key, keepCloud }),
        downloadBook: async (bookId, temporary) => (await core).invoke("download_book", { bookId, temporary: temporary ?? false }),
        bookLocations: async (bookId) => (await core).invoke("book_locations", { bookId }),
        keepDownload: async (bookId, keep) => (await core).invoke("keep_download", { bookId, keep }),
        coverOnView: async (bookId) => (await core).invoke("cover_on_view", { bookId }),
        moveStatus: async () => (await core).invoke("move_status"),
        moveSignIn: async (project, email, password, create) => (await core).invoke("move_sign_in", { project, email, password, create }),
        moveSignOut: async () => (await core).invoke("move_sign_out"),
        planTidyCloud: async () => (await core).invoke("plan_tidy_cloud"),
        supabaseUsage: async () => (await core).invoke("supabase_usage"),
        supabaseContents: async () => (await core).invoke("supabase_contents"),
        bookPlaces: async () => (await core).invoke("book_places"),
        removeSupabaseFiles: async (paths, onProgress) => {
            const { listen } = await tauriEvents();
            const stop = await listen("tidy-progress", (e) => onProgress(e.payload));
            try {
                return await (await core).invoke("remove_supabase_files", { paths });
            }
            finally {
                stop();
            }
        },
        tidyCloud: async (onProgress) => {
            const { listen } = await tauriEvents();
            const stop = await listen("tidy-progress", (e) => onProgress(e.payload));
            try {
                return await (await core).invoke("tidy_cloud");
            }
            finally {
                stop();
            }
        },
        startMove: async (mode, scope, to) => (await core).invoke("start_move", { mode, scope, to }),
        retryMove: async () => (await core).invoke("retry_move"),
        cancelMove: async () => (await core).invoke("cancel_move"),
        clearMove: async () => (await core).invoke("clear_move"),
        onMove: (listener) => {
            let stop = null;
            let stopped = false;
            void tauriEvents().then(async ({ listen }) => {
                const unlisten = await listen("move-changed", (e) => listener(e.payload));
                if (stopped)
                    unlisten();
                else
                    stop = unlisten;
            });
            return () => {
                stopped = true;
                stop?.();
            };
        },
        allTags: async () => (await core).invoke("all_tags"),
        addTag: async (bookIds, tag) => (await core).invoke("add_tag", { bookIds, tag }),
        removeTag: async (bookIds, tag) => (await core).invoke("remove_tag", { bookIds, tag }),
        setBookTags: async (bookId, tags) => (await core).invoke("set_book_tags", { bookId, tags }),
        deleteBook: async (bookId) => (await core).invoke("delete_book", { bookId }),
        mergeReading: async (keepId, fromId) => (await core).invoke("merge_reading", { keepId, fromId }),
        keepTogether: async (mainId, otherIds) => (await core).invoke("keep_together", { mainId, otherIds }),
        keepApart: async (bookId) => (await core).invoke("keep_apart", { bookId }),
        bookFiles: async (bookId) => (await core).invoke("book_files", { bookId }),
        removeFromLibrary: async (bookId) => (await core).invoke("remove_from_library", { bookId }),
        saveCopies: async (bookIds) => {
            const picked = isIOS
                ? await (await core).invoke("ios_pick_folder")
                : await folderPicker({ directory: true, multiple: false, title: "Save copies to this folder" });
            if (typeof picked !== "string")
                return null;
            const saved = await (await core).invoke("save_copies", { bookIds, folder: picked });
            return { saved, folder: picked };
        },
        removeDownload: async (bookId) => (await core).invoke("remove_download", { bookId }),
        findDuplicates: async () => (await core).invoke("find_duplicates"),
        dismissDuplicates: async (key) => (await core).invoke("dismiss_duplicates", { key }),
        shareBestCover: async (bookIds) => (await core).invoke("share_best_cover", { bookIds }),
        bookDetails: async (bookId) => (await core).invoke("book_details", { bookId }),
        editDetails: async (bookIds, changes) => (await core).invoke("edit_details", { bookIds, changes }),
        resetDetails: async (bookId, fetched) => (await core).invoke("reset_details", { bookId, fetched }),
        saveFetched: async (bookId, source, values) => (await core).invoke("save_fetched", { bookId, source, values }),
        listEreaders: async () => (await core).invoke("list_ereaders"),
        copyToEreader: async (bookId, root) => (await core).invoke("copy_to_ereader", { bookId, root }),
        kindleEmailSettings: async () => (await core).invoke("kindle_email_settings"),
        saveKindleEmail: async (settings) => (await core).invoke("save_kindle_email", { settings }),
        forgetKindleEmail: async () => (await core).invoke("forget_kindle_email"),
        sendToKindle: async (bookId) => (await core).invoke("send_to_kindle", { bookId }),
        sendKindleTest: async () => (await core).invoke("send_kindle_test"),
        listServers: async () => (await core).invoke("list_servers"),
        saveServer: async (server) => (await core).invoke("save_server", { server }),
        removeServer: async (id) => (await core).invoke("remove_server", { id }),
        trustServerKey: async (id, fingerprint) => (await core).invoke("trust_server_key", { id, fingerprint }),
        testServer: async (id) => (await core).invoke("test_server", { id }),
        browseServer: async (id, path) => (await core).invoke("browse_server", { id, path }),
        downloadFromServer: async (id, chosen) => (await core).invoke("download_from_server", { id, chosen }),
        serverQueue: async () => (await core).invoke("server_queue"),
        serverQueuePage: async (offset, limit) => (await core).invoke("server_queue_page", { offset, limit }),
        retryServerFile: async (id) => (await core).invoke("retry_server_file", { id }),
        removeServerFile: async (id) => (await core).invoke("remove_server_file", { id }),
        cancelServerQueue: async () => (await core).invoke("cancel_server_queue"),
        clearServerFinished: async () => (await core).invoke("clear_server_finished"),
        setServerConnections: async (count) => (await core).invoke("set_server_connections", { count }),
        searchDetailsMore: async (source, title, author) => (await core).invoke("search_details_more", { source, title, author }),
        findSeriesBooks: async (name, author) => (await core).invoke("find_series_books", { name, author }),
        seriesReview: async (name) => (await core).invoke("series_review", { name }),
        hideSeriesBook: async (name, key, hidden) => (await core).invoke("hide_series_book", { name, key, hidden }),
        markSeriesBookRead: async (name, key, read) => (await core).invoke("mark_series_book_read", { name, key, read }),
        addSeriesBook: async (name, title, position, authors) => (await core).invoke("add_series_book", { name, title, position, authors }),
        removeSeriesBook: async (name, key) => (await core).invoke("remove_series_book", { name, key }),
        approveSeriesMatches: async (name, approvals) => (await core).invoke("approve_series_matches", { name, approvals }),
        denySeriesMatches: async (name, bookIds) => (await core).invoke("deny_series_matches", { name, bookIds }),
        localSendStatus: async () => (await core).invoke("localsend_status"),
        setLocalSend: async (on) => (await core).invoke("set_localsend", { on }),
        answerLocalSend: async (session, accept) => (await core).invoke("answer_localsend", { session, accept }),
        onLocalSendOffer: (listener) => onEvent("localsend-offer", listener),
        localSendFiles: async () => (await core).invoke("localsend_files"),
        clearLocalSendFinished: async () => (await core).invoke("clear_localsend_finished"),
        onLocalSendChanged: (listener) => onEvent("localsend-changed", () => listener()),
        localSendNearby: async () => (await core).invoke("localsend_nearby"),
        localSendDeviceAt: async (address) => (await core).invoke("localsend_device_at", { address }),
        sendWithLocalSend: async (device, bookIds) => (await core).invoke("localsend_send", { device, bookIds }),
        stopSendingWithLocalSend: async () => (await core).invoke("localsend_stop_sending"),
        onLocalSendSending: (listener) => onEvent("localsend-sending", listener),
        onServerQueue: (listener) => {
            let stop = null;
            let stopped = false;
            void tauriEvents().then(async ({ listen }) => {
                const unlisten = await listen("server-queue-changed", () => listener());
                if (stopped)
                    unlisten();
                else
                    stop = unlisten;
            });
            return () => {
                stopped = true;
                stop?.();
            };
        },
        catalogs: async () => (await core).invoke("catalogs"),
        saveCatalog: async (catalog) => (await core).invoke("save_catalog", { catalog }),
        saveAbsServer: async (server) => (await core).invoke("save_abs_server", server),
        signOutAbsServer: async (id) => (await core).invoke("sign_out_abs_server", { id }),
        removeCatalog: async (id) => (await core).invoke("remove_catalog", { id }),
        catalogFeed: async (id, url) => (await core).invoke("catalog_feed", { id, url }),
        catalogSearch: async (id, search, words) => (await core).invoke("catalog_search", { id, search, words }),
        downloadFromCatalog: async (id, file, title) => (await core).invoke("download_from_catalog", { id, file, title }),
        downloadWebBook: async (url, title, sourceUrl) => (await core).invoke("download_web_book", { url, title, sourceUrl }),
        bookmarks: async () => (await core).invoke("bookmarks"),
        addBookmark: async (title, url, folder) => (await core).invoke("add_bookmark", { title, url, folder }),
        editBookmark: async (id, title, url, folder) => (await core).invoke("edit_bookmark", { id, title, url, folder }),
        moveBookmark: async (id, direction) => (await core).invoke("move_bookmark", { id, direction }),
        renameBookmark: async (id, title) => (await core).invoke("rename_bookmark", { id, title }),
        removeBookmark: async (id) => (await core).invoke("remove_bookmark", { id }),
        quickLinks: async () => (await core).invoke("quick_links"),
        addQuickLink: async (title, url, picture) => (await core).invoke("add_quick_link", { title, url, picture }),
        updateQuickLink: async (id, title, url, picture) => (await core).invoke("update_quick_link", { id, title, url, picture }),
        removeQuickLink: async (id) => (await core).invoke("remove_quick_link", { id }),
        moveQuickLink: async (id, to) => (await core).invoke("move_quick_link", { id, to }),
        customThemes: async () => (await core).invoke("custom_themes"),
        saveCustomTheme: async (theme) => (await core).invoke("save_custom_theme", { theme }),
        removeCustomTheme: async (id) => (await core).invoke("remove_custom_theme", { id }),
        sanctumLinks: async () => (await core).invoke("sanctum_links"),
        addSanctumLink: async (title, target, icon, picture) => (await core).invoke("add_sanctum_link", { title, target, icon, picture }),
        updateSanctumLink: async (id, title, target, icon, picture) => (await core).invoke("update_sanctum_link", { id, title, target, icon, picture }),
        setSanctumLinkPictureFile: async (id, path) => (await core).invoke("set_sanctum_link_picture_file", { id, path }),
        removeSanctumLink: async (id) => (await core).invoke("remove_sanctum_link", { id }),
        moveSanctumLink: async (id, to) => (await core).invoke("move_sanctum_link", { id, to }),
        ownedTitles: async (titles) => (await core).invoke("owned_titles", { titles }),
        siteIcon: async (url) => (await core).invoke("site_icon", { url }),
        browserShow: async (tab, url, frame, protection, privately, background) => (await core).invoke("browser_show", { tab, url, frame, protection: protection ?? null, private: privately ?? false, background: background ?? false }),
        browserPlace: async (frame) => (await core).invoke("browser_place", { frame }),
        browserLayout: async (panes, active) => (await core).invoke("browser_layout", { panes, active }),
        browserHide: async () => (await core).invoke("browser_hide"),
        browserAct: async (tab, action, url) => (await core).invoke("browser_act", { tab, action, url: url ?? null }),
        browserClear: async () => (await core).invoke("browser_clear"),
        lookUpWord: async (text, spot) => (await core).invoke("look_up_word", { text, spot }),
        translateText: async (text, spot) => (await core).invoke("translate_text", { text, spot }),
        browserFind: async (tab, text, backwards) => (await core).invoke("browser_find", { tab, text, backwards }),
        browserProtect: async (protection) => (await core).invoke("browser_protect", { protection }),
        browserRead: async (tab, script) => (await core).invoke("browser_read", { tab, script }),
        browserPip: async (tab) => (await core).invoke("browser_pip", { tab }),
        browserReport: async (tab) => (await core).invoke("browser_report", { tab }),
        browserDownloadStatus: async (ids) => (await core).invoke("browser_download_status", { ids }),
        browserCancelDownload: async (id) => (await core).invoke("browser_cancel_download", { id }),
        browserFetchPicture: async (url) => new Uint8Array(await (await core).invoke("browser_fetch_picture", { url })),
        onBrowserEvent: (listener) => onEvent("browser-event", listener),
        browserAddDownload: async (path, id) => (await core).invoke("browser_add_download", { path, id }),
        browserZoom: async (tab, zoom) => (await core).invoke("browser_zoom", { tab, zoom }),
        browserDesktopSites: async (hosts) => (await core).invoke("browser_desktop_sites", { hosts }),
        browserClearSite: async (site) => (await core).invoke("browser_clear_site", { site }),
        browserShare: async (url, title, anchor) => (await core).invoke("browser_share", { url, title, anchor }),
        browserOpenApp: async (url) => (await core).invoke("browser_open_app", { url }),
        browserTravelled: async (tab) => (await core).invoke("browser_travelled", { tab }),
        browserHistory: async () => (await core).invoke("browser_history"),
        putBrowserHistory: async (entries) => (await core).invoke("put_browser_history", { entries }),
        removeBrowserHistory: async (ids) => (await core).invoke("remove_browser_history", { ids }),
        clearBrowserHistory: async (since, kind) => (await core).invoke("clear_browser_history", { since, kind: kind ?? null }),
        trimBrowserHistory: async (before) => (await core).invoke("trim_browser_history", { before: Math.round(before) }),
        setBrowserOpenTabs: async (tabs) => (await core).invoke("set_browser_open_tabs", { tabs }),
        browserOtherTabs: async () => (await core).invoke("browser_other_tabs"),
        browserSessions: async () => (await core).invoke("browser_sessions"),
        putBrowserSession: async (session) => (await core).invoke("put_browser_session", { session }),
        removeBrowserSession: async (id) => (await core).invoke("remove_browser_session", { id }),
        browserKeepDownload: async (path, folder) => (await core).invoke("browser_keep_download", { path, folder }),
        browserDownloadKind: async (path) => (await core).invoke("browser_download_kind", { path }),
        browserTemporaryDownloads: async (active, remove) => (await core).invoke("browser_temporary_downloads", { active, remove }),
        browserDiscardDownload: async (path) => (await core).invoke("browser_discard_download", { path }),
        writingProjects: async () => (await core).invoke("writing_projects"),
        writingProject: async (id) => (await core).invoke("writing_project", { id }),
        createWritingProject: async (title, author) => (await core).invoke("create_writing_project", { title, author }),
        updateWritingDetails: async (id, details) => (await core).invoke("update_writing_details", { id, details }),
        setWritingExport: async (id, exportSettings) => (await core).invoke("set_writing_export", { id, export: exportSettings }),
        setWritingCover: async (id, path) => (await core).invoke("set_writing_cover", { id, path }),
        deleteWritingProject: async (id) => (await core).invoke("delete_writing_project", { id }),
        addWritingChapter: async (projectId, title, after) => (await core).invoke("add_writing_chapter", { projectId, title, after }),
        saveWritingChapter: async (id, title, body) => (await core).invoke("save_writing_chapter", { id, title, body }),
        orderWritingChapters: async (projectId, order) => (await core).invoke("order_writing_chapters", { projectId, order }),
        deleteWritingChapter: async (id) => (await core).invoke("delete_writing_chapter", { id }),
        setWritingChapterRole: async (id, role) => (await core).invoke("set_writing_chapter_role", { id, role }),
        setWritingCoverPicture: async (id, bytes, extension) => (await core).invoke("set_writing_cover_bytes", bytes, { headers: { "project-id": id, extension } }),
        writingCover: async (id) => {
            const bytes = await (await core).invoke("writing_cover", { id });
            return Array.isArray(bytes) ? new Uint8Array(bytes) : new Uint8Array(bytes);
        },
        pickWritingCover: async () => {
            const [path] = await openFiles({
                multiple: false,
                title: "Choose a cover picture",
                filters: [{ name: "Pictures", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }],
            });
            return path ?? null;
        },
        pickEpubSavePath: async (fileName) => (await savePicker({ title: "Save the EPUB", defaultPath: fileName, filters: [{ name: "EPUB", extensions: ["epub"] }] })) ?? null,
        saveWritingEpub: async (bytes, fileName, path, addToLibrary) => (await core).invoke("save_writing_epub", bytes, {
            headers: { path: encodeURIComponent(path ?? ""), add: addToLibrary ? "1" : "0", "file-name": encodeURIComponent(fileName) },
        }),
        pickExportPath: async (fileName, format) => (await savePicker({
            title: format === "html" ? "Export bookmarks" : format === "pdf" ? "Save the PDF" : format === "docx" ? "Save the Word file" : format === "tbv" ? "Save the Scribe book file" : "Save the text file",
            defaultPath: fileName,
            filters: [{ name: format === "html" ? "Bookmarks HTML" : format === "pdf" ? "PDF" : format === "docx" ? "Word document" : format === "tbv" ? "Scribe book file" : "Text", extensions: [format] }],
        })) ?? null,
        saveExportFile: async (bytes, fileName, path) => (await core).invoke("save_writing_epub", bytes, { headers: { path: encodeURIComponent(path ?? ""), add: "0", "file-name": encodeURIComponent(fileName) } }),
        printBook: async (html, path) => (await core).invoke("print_book", { html, path }),
        copyCheck: async (sections, leaveOutTitle) => (await core).invoke("copy_check", { sections, leaveOutTitle }),
        copyCheckStop: async () => (await core).invoke("copy_check_stop"),
        onCopyCheckProgress: (listener) => listenFor("copy-check-progress", listener),
        saveWritingDraft: async (projectId, bytes) => (await core).invoke("save_writing_draft", bytes, { headers: { "project-id": projectId } }),
        writingDrafts: async (projectId) => (await core).invoke("writing_drafts", { projectId }),
        restoreWritingDraft: async (projectId, draftId, revision, sections) => (await core).invoke("restore_writing_draft", { projectId, draftId, revision, sections }),
        deleteWritingDraft: async (id) => (await core).invoke("delete_writing_draft", { id }),
        setWritingCoverPage: async (id, page) => (await core).invoke("set_writing_cover_page", { id, page }),
        setWritingChapterPart: async (id, part) => (await core).invoke("set_writing_chapter_part", { id, part }),
        addWritingSection: async (projectId, section) => (await core).invoke("add_writing_section", {
            projectId,
            section: { title: section.title, body: section.body ?? "", role: section.role, part: section.part ?? null, page: section.page ?? "{}", after: section.after ?? null },
        }),
        setWritingChapterPage: async (id, page) => (await core).invoke("set_writing_chapter_page", { id, page }),
        recordWritingImport: async (projectId, acknowledgment) => (await core).invoke("record_writing_import", { projectId, acknowledgment }),
        keepWritingSound: async (fileName, bytes) => (await core).invoke("keep_writing_sound", bytes, { headers: { "file-name": encodeURIComponent(fileName) } }),
        writingSound: async (file) => {
            const raw = await (await core).invoke("writing_sound", { file });
            const bytes = raw instanceof ArrayBuffer ? new Uint8Array(raw) : new Uint8Array(raw);
            return bytes.length ? bytes : null;
        },
        keepWritingSource: async (projectId, fileName, bytes) => (await core).invoke("keep_writing_source", bytes, { headers: { "project-id": projectId, "file-name": encodeURIComponent(fileName) } }),
        writingProvenance: async (projectId) => (await core).invoke("writing_provenance", { projectId }),
        deleteWritingSource: async (projectId, sha256) => (await core).invoke("delete_writing_source", { projectId, sha256 }),
        duplicateWritingProject: async (id) => (await core).invoke("duplicate_writing_project", { id }),
        readingHistory: async () => (await core).invoke("reading_history"),
        forgetReading: async (bookId) => (await core).invoke("forget_reading", { bookId }),
        markSuggestion: async (key, title, authors, status, stars) => (await core).invoke("mark_suggestion", { key, title, authors, status, stars }),
        pickKeyFile: async () => {
            const [picked] = await openFiles({ multiple: false, title: "Choose your private key file", keep: true });
            return picked ?? null;
        },
        onSync: ({ status, libraryChanged }) => {
            const stops = [];
            let stopped = false;
            void tauriEvents().then(async ({ listen }) => {
                const add = (stop) => (stopped ? stop() : stops.push(stop));
                if (status)
                    add(await listen("sync-status", (e) => status(e.payload)));
                if (libraryChanged)
                    add(await listen("library-changed", () => libraryChanged()));
            });
            return () => {
                stopped = true;
                stops.forEach((stop) => stop());
            };
        },
    };
}
/** Opens a web link in the person's browser, never inside TBV. */
export async function openExternal(url) {
    if (!/^https?:\/\//i.test(url))
        return;
    if (isApp)
        await (await import("@tauri-apps/plugin-opener")).openUrl(url);
    else
        window.open(url, "_blank", "noopener");
}
export const api = isApp || isHome
    ? appApi()
    : isWeb
        ? await (await import("../web/webApi")).webApi()
        : (await import("./preview")).previewApi();

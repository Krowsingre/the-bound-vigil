import { useCallback, useEffect, useRef, useState } from "react";
import { api, isApp, isHome, isWeb } from "./api";
import type { CollectionRef, HomeViewModel, ImportsView, Profile, SyncStatus } from "./api/types";
import { AddToCollectionHost } from "./collections/AddToCollection";
import { ContextMenuHost } from "./components/ContextMenu";
import { BookDialogsHost } from "./library/BookDialogs";
import { SendToEreaderHost } from "./ereaders/SendToEreader";
import { SendWithLocalSendHost } from "./localsend/SendWithLocalSend";
import { BookDetailsPage } from "./details/BookDetailsPage";
import { DetailsHost } from "./details/DetailsHost";
import { onShowBookDetails, onShowInLibrary } from "./details/openDetails";
import { Collections } from "./collections/Collections";
import { Writing } from "./writing/Writing";
import { Browse } from "./browse/Browse";
import { Audiobooks } from "./audio/Audiobooks";
import { PlayerBar } from "./audio/PlayerBar";
import { usePlayer } from "./audio/player";
import { useToast } from "./components/Toast";
import { Home } from "./home/Home";
import { Imports, importCounts } from "./imports/Imports";
import { NO_IMPORTS as NOTHING_IMPORTED } from "./imports/view";
import { useServerQueue } from "./imports/serverQueue";
import { useLocalSendRows } from "./imports/LocalSendRows";
import { LocalSendOffers } from "./imports/LocalSendOffer";
import { PROFILE_CHANGED } from "./settings/NamesSection";
import { SyncActivity } from "./sync/SyncActivity";
import { BookPlacesPage } from "./sync/BookPlaces";
import { importSummary } from "./lib/importSummary";
import { Library } from "./library/Library";
import { Reader } from "./reader/Reader";
import { initialView, rememberView, type LibraryView } from "./library/libraryView";
import { useAppSettings } from "./settings/appSettings";
import { Settings } from "./settings/Settings";
import type { SettingsTab } from "./settings/settingsIndex";
import { Header } from "./shell/Header";
import { navFor, type Route } from "./shell/routes";
import { Sidebar } from "./shell/Sidebar";
import { Icon } from "./components/Icon";
import { PairHost } from "./audio/LinkEbook";
import { useNarrow } from "./lib/useNarrow";
import { useSwipes } from "./shell/useSwipes";
import { drawImportedCovers } from "./reader/formats";

const COLLAPSE_KEY = "tbv.sidebarCollapsed";
const NO_IMPORTS = isHome
  ? "Add books in TBV on the computer. They show up here straight away."
  : "Importing works in the desktop app. This browser preview uses sample books.";

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}

export function App() {
  const [route, setRoute] = useState<Route>("home");
  const [collapsedWide, setCollapsed] = useState(readCollapsed);
  // On a phone the sidebar is a menu opened from the header, always with names.
  const narrow = useNarrow();
  const collapsed = collapsedWide && !narrow;
  const [menuOpen, setMenuOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [sync, setSync] = useState<SyncStatus | null>(null);
  const [dropping, setDropping] = useState(false);
  const [imports, setImports] = useState<ImportsView>(NOTHING_IMPORTED);
  const servers = useServerQueue(!isWeb && !isHome);
  const serverCounts = servers.view.counts;
  const sent = useLocalSendRows(!isWeb && !isHome);
  // PDF covers are drawn one at a time, in the background.
  const drawingCovers = useRef(false);
  const wasRunning = useRef(false);
  const [libraryView, setLibraryView] = useState<LibraryView>(() => initialView("books"));
  const [documentsView, setDocumentsView] = useState<LibraryView>(() => initialView("documents"));
  const [audiobooksView, setAudiobooksView] = useState<LibraryView>(() => initialView("audiobooks"));
  const player = usePlayer();
  // The book the details page shows, and the page to go back to.
  const [details, setDetails] = useState<{ bookId: string; from: Route } | null>(null);
  const [searchText, setSearchText] = useState("");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [reading, setReading] = useState<{ bookId: string; at?: string; fileId?: string } | null>(null);
  const [openCollection, setOpenCollection] = useState<CollectionRef | null>(null);
  const [settingsTab, setSettingsTab] = useState<SettingsTab | null>(null);
  const search = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const { refreshAdaptive, togglePrivacy } = useAppSettings();

  const navigate = useCallback((r: Route) => {
    setMenuOpen(false);
    // The sidebar's Collections always starts at the overview.
    if (r === "collections") setOpenCollection(null);
    // Sync & Accounts is a page inside Settings.
    if (r === "sync") {
      setSettingsTab("sync");
      r = "settings";
    } else if (r === "settings") {
      // Settings opens at its landing page of tabs.
      setSettingsTab(null);
    }
    setRoute(r);
  }, []);

  const toggleSidebar = useCallback(() => {
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1");
      } catch {
        /* the choice just won't be remembered */
      }
      return !c;
    });
  }, []);

  // Any change except turning the page starts again from page one.
  const changeLibraryView = useCallback((change: Partial<LibraryView>) => {
    setLibraryView((v) => {
      const next = { ...v, ...change, page: change.page ?? 0 };
      rememberView(next);
      return next;
    });
  }, []);

  const changeDocumentsView = useCallback((change: Partial<LibraryView>) => {
    setDocumentsView((v) => {
      const next = { ...v, ...change, page: change.page ?? 0 };
      rememberView(next, "documents");
      return next;
    });
  }, []);

  const changeAudiobooksView = useCallback((change: Partial<LibraryView>) => {
    setAudiobooksView((v) => {
      const next = { ...v, ...change, page: change.page ?? 0 };
      rememberView(next, "audiobooks");
      return next;
    });
  }, []);

  // Any book menu can open the details page.
  const routeNow = useRef(route);
  routeNow.current = route;
  useEffect(
    () =>
      onShowBookDetails((bookId) => {
        const from = routeNow.current;
        setDetails((d) => ({ bookId, from: from === "book" ? (d?.from ?? "library") : from }));
        setRoute("book");
      }),
    [],
  );

  // Show series / Show author, from any book menu.
  useEffect(
    () =>
      onShowInLibrary((kind, change) => {
        setSearchText("");
        if (kind === "documents") changeDocumentsView(change);
        else if (kind === "audiobooks") changeAudiobooksView(change);
        else changeLibraryView(change);
        setRoute(kind === "books" ? "library" : kind);
      }),
    [changeLibraryView, changeDocumentsView, changeAudiobooksView],
  );

  const openLibrary = useCallback(
    (change: Partial<LibraryView> = {}) => {
      changeLibraryView(change);
      setRoute("library");
    },
    [changeLibraryView],
  );

  const changeSearch = useCallback(
    (text: string) => {
      setSearchText(text);
      // Typing on the Library page filters it straight away, from page one.
      setLibraryView((v) => (v.page === 0 ? v : { ...v, page: 0 }));
      setDocumentsView((v) => (v.page === 0 ? v : { ...v, page: 0 }));
      setAudiobooksView((v) => (v.page === 0 ? v : { ...v, page: 0 }));
    },
    [],
  );

  useEffect(() => api.onHardcoverNotice((message) => toast(message)), [toast]);

  useEffect(() => {
    const load = () => api.getProfile().then(setProfile, () => setProfile({ avatarPath: null }));
    void load();
    // The picture is shared by every device, so one chosen elsewhere arrives with sync.
    return api.onSync({ libraryChanged: () => void load() });
  }, []);

  // Names changed in Settings show in the sync circle's menu straight away.
  useEffect(() => {
    const changed = (e: Event) => setProfile((e as CustomEvent<Profile>).detail);
    window.addEventListener(PROFILE_CHANGED, changed);
    return () => window.removeEventListener(PROFILE_CHANGED, changed);
  }, []);

  const chooseAvatar = useCallback((from?: "photos" | "files") => {
    if (!isApp && !isWeb) return toast("Choosing a picture works in the desktop app.");
    api.chooseAvatar(from).then(
      (p) => p && setProfile(p),
      (e: unknown) => toast(`That picture couldn't be used: ${String(e)}`),
    );
  }, [toast]);
  const clearAvatar = useCallback(() => {
    api.clearAvatar().then(setProfile, (e: unknown) => toast(String(e)));
  }, [toast]);

  // Imports run in the background, book by book; the Imports page follows them.
  useEffect(() => {
    const drawCovers = async () => {
      if (drawingCovers.current) return;
      drawingCovers.current = true;
      try {
        for (let ids = await api.takePdfCovers(); ids.length; ids = await api.takePdfCovers()) {
          if (await drawImportedCovers(ids)) setRefreshKey((k) => k + 1);
        }
      } finally {
        drawingCovers.current = false;
      }
    };
    const seen = (view: ImportsView) => {
      setImports(view);
      // PDF covers are drawn here, after the books show up.
      if (view.pdfCovers > 0) void drawCovers();
      const { running } = importCounts(view);
      if (wasRunning.current && !running) {
        toast(importSummary(view));
        setRefreshKey((k) => k + 1);
      }
      wasRunning.current = running;
    };
    void api.importQueue().then(seen, () => undefined);
    return api.onImports(seen);
  }, [toast]);

  const runImport = useCallback(
    async (paths: string[]) => {
      if (paths.length === 0) return;
      try {
        const found = await api.queueImports(paths);
        toast(found === 0 ? "No book files were found there." : `Importing ${found} ${found === 1 ? "book" : "books"}. Follow along in Imports.`);
      } catch (e) {
        toast(`Import didn't start: ${String(e)}`);
      }
    },
    [toast],
  );
  const reloadImports = useCallback(() => void api.importQueue().then(setImports, () => undefined), []);

  const importBooks = useCallback(() => {
    if (isHome || (!isApp && !isWeb)) return toast(NO_IMPORTS);
    void api.pickBooks().then(runImport);
  }, [runImport, toast]);
  const importFolder = useCallback(() => {
    if (isHome || (!isApp && !isWeb)) return toast(NO_IMPORTS);
    void api.pickFolder().then(runImport);
  }, [runImport, toast]);

  // Dropping files or folders anywhere on the window imports them.
  useEffect(() => {
    if (!isApp) return;
    let unlisten: (() => void) | undefined;
    void import("@tauri-apps/api/webview").then(async ({ getCurrentWebview }) => {
      unlisten = await getCurrentWebview().onDragDropEvent(({ payload }) => {
        if (payload.type === "enter" || payload.type === "over") setDropping(true);
        else if (payload.type === "leave") setDropping(false);
        else if (payload.type === "drop") {
          setDropping(false);
          void runImport(payload.paths);
        }
      });
    });
    return () => unlisten?.();
  }, [runImport]);

  // Back (Alt + Left, or the mouse's back button): the page before, as it was.
  type Place = { route: Route; collection: CollectionRef | null; details: typeof details };
  const past = useRef<Place[]>([]);
  const here = useRef<Place>({ route, collection: openCollection, details });
  const goingBack = useRef(false);
  useEffect(() => {
    const now = { route, collection: openCollection, details };
    const was = here.current;
    const same =
      was.route === now.route &&
      JSON.stringify(was.collection) === JSON.stringify(now.collection) &&
      was.details?.bookId === now.details?.bookId;
    if (same) return;
    if (!goingBack.current) past.current = [...past.current.slice(-49), was];
    goingBack.current = false;
    here.current = now;
  }, [route, openCollection, details]);
  const back = useCallback(() => {
    const was = past.current.pop();
    if (!was) return;
    goingBack.current = true;
    setDetails(was.details);
    setOpenCollection(was.collection);
    setRoute(was.route);
  }, []);
  useEffect(() => {
    const onMouse = (e: MouseEvent) => {
      if (e.button !== 3 || reading) return;
      e.preventDefault();
      back();
    };
    window.addEventListener("mouseup", onMouse);
    return () => window.removeEventListener("mouseup", onMouse);
  }, [back, reading]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.key === "ArrowLeft" && !reading) {
        e.preventDefault();
        back();
        return;
      }
      // Privacy mode works everywhere, the reader included.
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === "h") {
        e.preventDefault();
        togglePrivacy();
        return;
      }
      if (!(e.ctrlKey || e.metaKey) || e.altKey || reading) return;
      const n = Number(e.key);
      if (e.key === "\\") toggleSidebar();
      else if (e.key.toLowerCase() === "o" && !e.shiftKey) importBooks();
      else if (e.key.toLowerCase() === "f" || e.key.toLowerCase() === "k") search.current?.focus();
      else if (n >= 1 && n <= navFor({ web: isWeb, home: isHome }).length) navigate(navFor({ web: isWeb, home: isHome })[n - 1].route);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleSidebar, importBooks, reading, navigate, togglePrivacy, back]);

  const onHomeLoaded = useCallback((home: HomeViewModel) => setSync(home.sync), []);
  const openBook = useCallback((bookId: string, at?: string, fileId?: string) => setReading({ bookId, at, fileId }), []);
  const showCollection = useCallback((id: string) => {
    setOpenCollection({ kind: "collection", id });
    setRoute("collections");
  }, []);
  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  // Sync runs in the background; show its state, and what it brings in.
  useEffect(() => {
    api.syncOverview().then(
      (o) => setSync(o.status),
      () => undefined,
    );
    return api.onSync({ status: setSync, libraryChanged: refresh });
  }, [refresh]);

  const closeBook = useCallback(() => {
    setReading(null);
    setRefreshKey((k) => k + 1);
    // Adaptive takes its colour from the book just read.
    refreshAdaptive();
  }, [refreshAdaptive]);

  const shell = {
    sync,
    profile,
    onChooseAvatar: chooseAvatar,
    onClearAvatar: clearAvatar,
    onImportBooks: importBooks,
    onImportFolder: importFolder,
    onOpenSyncSettings: () => {
      setReading(null);
      navigate("sync");
    },
    // The phone version syncs in the background with no activity page.
    onOpenActivity:
      api.kind === "web"
        ? undefined
        : () => {
            setReading(null);
            navigate("activity");
          },
    onOpenPlaces:
      api.kind === "web"
        ? undefined
        : () => {
            setReading(null);
            navigate("places");
          },
  };

  // Phone swipes: from Home, left to the Library and right to Settings; from
  // anywhere else, a long pull down from the top bar goes Home. The Reader
  // keeps its swipes for turning pages.
  const appRoot = useRef<HTMLDivElement>(null);
  const pullHome = useRef<HTMLDivElement>(null);
  const toLibrary = useCallback(() => navigate("library"), [navigate]);
  const toSettings = useCallback(() => navigate("settings"), [navigate]);
  const toHome = useCallback(() => navigate("home"), [navigate]);
  useSwipes(appRoot, pullHome, narrow && !menuOpen && !reading, {
    // From any page but the one it leads to.
    onLeft: route !== "library" ? toLibrary : undefined,
    onRight: route !== "settings" ? toSettings : undefined,
    onPullDown: route !== "home" ? toHome : undefined,
  });

  if (reading) return <Reader key={`${reading.bookId}/${reading.fileId ?? ""}`} bookId={reading.bookId} fileId={reading.fileId} openAt={reading.at} shell={shell} onClose={closeBook} />;

  return (
    <div ref={appRoot} className={`app${collapsed ? " sidebar-collapsed" : ""}${player.book ? " has-player" : ""}`}>
      {narrow && route !== "home" && (
        <div ref={pullHome} className="pull-home" aria-hidden>
          <Icon name="home" size={16} /> <span className="pull-home-far">Keep pulling for Home</span>
          <span className="pull-home-ready">Let go for Home</span>
        </div>
      )}
      <Sidebar
        route={route === "book" && details ? details.from : route}
        collapsed={collapsed}
        drawerOpen={narrow && menuOpen}
        onCloseDrawer={() => setMenuOpen(false)}
        onNavigate={navigate}
        onToggle={toggleSidebar}
        preview={api.kind === "preview"}
        imports={
          imports.total
            ? importCounts(imports)
            : serverCounts.total
              ? { done: serverCounts.done, total: serverCounts.total, running: serverCounts.done + serverCounts.failed < serverCounts.total }
              : sent.length
                ? {
                    done: sent.filter((f) => f.state !== "waiting" && f.state !== "arriving").length,
                    total: sent.length,
                    running: sent.some((f) => f.state === "waiting" || f.state === "arriving"),
                  }
                : null
        }
      />
      <div className="main">
        <Header
          ref={search}
          onOpenMenu={() => setMenuOpen(true)}
          sync={sync}
          profile={profile}
          search={searchText}
          onSearchChange={changeSearch}
          placeholder={route === "notes" ? "Search notes, books, authors or words…" : route === "audiobooks" ? "Search audiobooks…" : undefined}
          onSearchSubmit={() => route !== "notes" && route !== "documents" && route !== "audiobooks" && setRoute("library")}
          onChooseAvatar={chooseAvatar}
          onClearAvatar={clearAvatar}
          onImportBooks={importBooks}
          onImportFolder={importFolder}
          onOpenSyncSettings={() => navigate("sync")}
          onOpenActivity={shell.onOpenActivity}
          onOpenPlaces={shell.onOpenPlaces}
        />
        <main className="content">
          {route === "home" ? (
            <Home
              refreshKey={refreshKey}
              onNavigate={navigate}
              onOpenLibrary={openLibrary}
              onImportBooks={importBooks}
              onImportFolder={importFolder}
              onLoaded={onHomeLoaded}
              onOpenBook={openBook}
              onOpenCollection={showCollection}
            />
          ) : route === "library" ? (
            <Library
              view={libraryView}
              search={searchText}
              refreshKey={refreshKey}
              onChange={changeLibraryView}
              onClearSearch={() => changeSearch("")}
              onImportBooks={importBooks}
              onImportFolder={importFolder}
              onOpenBook={openBook}
              onOpenCollection={showCollection}
            />
          ) : route === "documents" ? (
            <Library
              kind="documents"
              view={documentsView}
              search={searchText}
              refreshKey={refreshKey}
              onChange={changeDocumentsView}
              onClearSearch={() => changeSearch("")}
              onImportBooks={importBooks}
              onImportFolder={importFolder}
              onOpenBook={openBook}
              onOpenCollection={showCollection}
            />
          ) : route === "book" && details ? (
            <BookDetailsPage
              bookId={details.bookId}
              refreshKey={refreshKey}
              onBack={() => setRoute(details.from)}
              onOpenBook={openBook}
              onOpenCollection={showCollection}
              onOpenLibrary={(genre, documents) => {
                const change = { tab: "all" as const, genres: [genre], formats: [], tags: [], location: null };
                if (documents) {
                  changeDocumentsView(change);
                  setRoute("documents");
                } else openLibrary(change);
              }}
            />
          ) : route === "collections" ? (
            <Collections
              open={openCollection}
              refreshKey={refreshKey}
              onOpen={setOpenCollection}
              onOpenBook={openBook}
              onChanged={refresh}
            />
          ) : route === "audiobooks" ? (
            <Audiobooks
              view={audiobooksView}
              search={searchText}
              refreshKey={refreshKey}
              onChange={changeAudiobooksView}
              onClearSearch={() => changeSearch("")}
              onImportBooks={importBooks}
              onImportFolder={importFolder}
              onOpenCollection={showCollection}
              onReadAlong={(ebookId) => openBook(ebookId)}
            />
          ) : route === "imports" ? (
            <Imports
              view={imports}
              servers={isWeb ? undefined : servers}
              sent={sent}
              onCancel={() => void api.cancelImports().then(reloadImports)}
              onClear={() => {
                void api.clearFinishedImports().then(reloadImports);
              }}
              onImportBooks={importBooks}
              onImportFolder={importFolder}
              onOpenBook={openBook}
            />
          ) : route === "activity" ? (
            <SyncActivity sync={sync} onOpenSyncSettings={() => navigate("sync")} />
          ) : route === "places" ? (
            <BookPlacesPage onOpenSyncSettings={() => navigate("sync")} />
          ) : route === "notes" || route === "writing" ? (
            <Writing
              tab={route === "writing" ? "books" : "notes"}
              onTab={(t) => navigate(t === "books" ? "writing" : "notes")}
              booksShown={!isHome}
              search={searchText}
              refreshKey={refreshKey}
              onClearSearch={() => changeSearch("")}
              onOpenBook={openBook}
            />
          ) : route === "catalogs" ? (
            <Browse refreshKey={refreshKey} onOpenBook={openBook} />
          ) : (
            <Settings
              tab={settingsTab}
              onTab={setSettingsTab}
              libraryLayout={libraryView.layout}
              librarySort={libraryView.sort}
              onLibraryView={changeLibraryView}
              sidebarShown={!collapsed}
              onSidebarShown={(shown) => shown === collapsed && toggleSidebar()}
              // Settings, profile and reader preferences are held all over the app,
              // so a restore starts the window afresh to read them back.
              onRestored={() => window.location.reload()}
            />
          )}
        </main>
      </div>
      {dropping && (
        <div className="drop-overlay" aria-hidden>
          <p>Drop to add to your library</p>
        </div>
      )}
      {route !== "imports" && importCounts(imports).running && (
        <button type="button" className="import-progress" onClick={() => navigate("imports")}>
          Imported {importCounts(imports).done} of {importCounts(imports).total} books <span className="import-progress-link">View</span>
        </button>
      )}
      {!isWeb && !isHome && <LocalSendOffers />}
      <PlayerBar onShowAudiobooks={() => navigate("audiobooks")} />
      <AddToCollectionHost onChanged={refresh} />
      <BookDialogsHost onChanged={refresh} />
      <DetailsHost onChanged={refresh} />
      <SendToEreaderHost
        onSetUp={() => {
          setSettingsTab("ereaders");
          navigate("settings");
        }}
      />
      <SendWithLocalSendHost />
      <ContextMenuHost />
      <PairHost />
    </div>
  );
}

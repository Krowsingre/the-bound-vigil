import { useCallback, useEffect, useRef, useState } from "react";
import { api, isApp } from "./api";
import type { CollectionRef, HomeViewModel, Profile, SyncStatus } from "./api/types";
import { AddToCollectionHost } from "./collections/AddToCollection";
import { Collections } from "./collections/Collections";
import { Notes } from "./notes/Notes";
import { useToast } from "./components/Toast";
import { Home } from "./home/Home";
import { importSummary } from "./lib/importSummary";
import { Library } from "./library/Library";
import { Reader } from "./reader/Reader";
import { initialView, rememberView, type LibraryView } from "./library/libraryView";
import { useAppSettings } from "./settings/appSettings";
import { Settings } from "./settings/Settings";
import type { SettingsTab } from "./settings/settingsIndex";
import { Header } from "./shell/Header";
import { NAV, type Route } from "./shell/routes";
import { Sidebar } from "./shell/Sidebar";

const COLLAPSE_KEY = "tbv.sidebarCollapsed";

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}

export function App() {
  const [route, setRoute] = useState<Route>("home");
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [refreshKey, setRefreshKey] = useState(0);
  const [sync, setSync] = useState<SyncStatus | null>(null);
  const [dropping, setDropping] = useState(false);
  const [importing, setImporting] = useState(false);
  const [libraryView, setLibraryView] = useState<LibraryView>(initialView);
  const [searchText, setSearchText] = useState("");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [reading, setReading] = useState<{ bookId: string; at?: string } | null>(null);
  const [openCollection, setOpenCollection] = useState<CollectionRef | null>(null);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("appearance");
  const search = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const { refreshAdaptive } = useAppSettings();

  const navigate = useCallback((r: Route) => {
    // The sidebar's Collections always starts at the overview.
    if (r === "collections") setOpenCollection(null);
    // Sync & Accounts is a page inside Settings.
    if (r === "sync") {
      setSettingsTab("sync");
      r = "settings";
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
    },
    [],
  );

  useEffect(() => {
    api.getProfile().then(setProfile, () => setProfile({ avatarPath: null }));
  }, []);

  const chooseAvatar = useCallback(() => {
    if (!isApp) return toast("Choosing a picture works in the desktop app.");
    api.chooseAvatar().then(
      (p) => p && setProfile(p),
      (e: unknown) => toast(`That picture couldn't be used: ${String(e)}`),
    );
  }, [toast]);
  const clearAvatar = useCallback(() => {
    api.clearAvatar().then(setProfile, (e: unknown) => toast(String(e)));
  }, [toast]);

  const runImport = useCallback(
    async (paths: string[]) => {
      if (paths.length === 0) return;
      setImporting(true);
      try {
        const results = await api.importBooks(paths);
        toast(importSummary(results));
        setRefreshKey((k) => k + 1);
      } catch (e) {
        toast(`Import didn't finish: ${String(e)}`);
      } finally {
        setImporting(false);
      }
    },
    [toast],
  );

  const importBooks = useCallback(() => {
    if (!isApp) return toast("Importing works in the desktop app. This browser preview uses sample books.");
    void api.pickBooks().then(runImport);
  }, [runImport, toast]);
  const importFolder = useCallback(() => {
    if (!isApp) return toast("Importing works in the desktop app. This browser preview uses sample books.");
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || reading) return;
      const n = Number(e.key);
      if (e.key === "\\") toggleSidebar();
      else if (e.key.toLowerCase() === "o" && !e.shiftKey) importBooks();
      else if (e.key.toLowerCase() === "f" || e.key.toLowerCase() === "k") search.current?.focus();
      else if (n >= 1 && n <= NAV.length) navigate(NAV[n - 1].route);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleSidebar, importBooks, reading, navigate]);

  const onHomeLoaded = useCallback((home: HomeViewModel) => setSync(home.sync), []);
  const openBook = useCallback((bookId: string, at?: string) => setReading({ bookId, at }), []);
  const showCollection = useCallback((id: string) => {
    setOpenCollection({ kind: "collection", id });
    setRoute("collections");
  }, []);
  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

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
  };

  if (reading) return <Reader key={reading.bookId} bookId={reading.bookId} openAt={reading.at} shell={shell} onClose={closeBook} />;

  return (
    <div className={`app${collapsed ? " sidebar-collapsed" : ""}`}>
      <Sidebar route={route} collapsed={collapsed} onNavigate={navigate} onToggle={toggleSidebar} preview={api.kind === "preview"} />
      <div className="main">
        <Header
          ref={search}
          sync={sync}
          profile={profile}
          search={searchText}
          onSearchChange={changeSearch}
          placeholder={route === "notes" ? "Search notes, books, authors or words…" : undefined}
          onSearchSubmit={() => route !== "notes" && setRoute("library")}
          onChooseAvatar={chooseAvatar}
          onClearAvatar={clearAvatar}
          onImportBooks={importBooks}
          onImportFolder={importFolder}
          onOpenSyncSettings={() => navigate("sync")}
        />
        <main className="content" aria-busy={importing}>
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
          ) : route === "collections" ? (
            <Collections
              open={openCollection}
              refreshKey={refreshKey}
              onOpen={setOpenCollection}
              onOpenBook={openBook}
              onChanged={refresh}
            />
          ) : route === "notes" ? (
            <Notes search={searchText} refreshKey={refreshKey} onClearSearch={() => changeSearch("")} onOpenBook={openBook} />
          ) : (
            <Settings
              tab={settingsTab}
              onTab={setSettingsTab}
              libraryLayout={libraryView.layout}
              librarySort={libraryView.sort}
              onLibraryView={changeLibraryView}
              sidebarShown={!collapsed}
              onSidebarShown={(shown) => shown === collapsed && toggleSidebar()}
              onRestored={refresh}
            />
          )}
        </main>
      </div>
      {dropping && (
        <div className="drop-overlay" aria-hidden>
          <p>Drop to add to your library</p>
        </div>
      )}
      {importing && <div className="import-progress" role="status">Importing…</div>}
      <AddToCollectionHost onChanged={refresh} />
    </div>
  );
}

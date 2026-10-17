import { useCallback, useEffect, useRef, useState } from "react";
import { api, isApp } from "./api";
import type { HomeViewModel, Profile, SyncStatus } from "./api/types";
import { useToast } from "./components/Toast";
import { Home } from "./home/Home";
import { importSummary } from "./lib/importSummary";
import { Library } from "./library/Library";
import { initialView, rememberView, type LibraryView } from "./library/libraryView";
import { ComingSoon } from "./pages/ComingSoon";
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
  const search = useRef<HTMLInputElement>(null);
  const toast = useToast();

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
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const n = Number(e.key);
      if (e.key === "\\") toggleSidebar();
      else if (e.key.toLowerCase() === "o" && !e.shiftKey) importBooks();
      else if (e.key.toLowerCase() === "f" || e.key.toLowerCase() === "k") search.current?.focus();
      else if (n >= 1 && n <= NAV.length) setRoute(NAV[n - 1].route);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleSidebar, importBooks]);

  const onHomeLoaded = useCallback((home: HomeViewModel) => setSync(home.sync), []);

  return (
    <div className={`app${collapsed ? " sidebar-collapsed" : ""}`}>
      <Sidebar route={route} collapsed={collapsed} onNavigate={setRoute} onToggle={toggleSidebar} preview={api.kind === "preview"} />
      <div className="main">
        <Header
          ref={search}
          sync={sync}
          profile={profile}
          search={searchText}
          onSearchChange={changeSearch}
          onSearchSubmit={() => setRoute("library")}
          onChooseAvatar={chooseAvatar}
          onClearAvatar={clearAvatar}
          onImportBooks={importBooks}
          onImportFolder={importFolder}
          onOpenSyncSettings={() => setRoute("sync")}
        />
        <main className="content" aria-busy={importing}>
          {route === "home" ? (
            <Home
              refreshKey={refreshKey}
              onNavigate={setRoute}
              onOpenLibrary={openLibrary}
              onImportBooks={importBooks}
              onImportFolder={importFolder}
              onLoaded={onHomeLoaded}
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
            />
          ) : (
            <ComingSoon route={route} />
          )}
        </main>
      </div>
      {dropping && (
        <div className="drop-overlay" aria-hidden>
          <p>Drop to add to your library</p>
        </div>
      )}
      {importing && <div className="import-progress" role="status">Importing…</div>}
    </div>
  );
}

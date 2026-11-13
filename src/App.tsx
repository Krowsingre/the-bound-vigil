import { useCallback, useEffect, useRef, useState } from "react";
import { api, isAndroid, isApp, isHome, isWeb } from "./api";
import type { CollectionRef, HomeViewModel, ImportsView, KindleImport, Profile, SmartKind, SyncStatus } from "./api/types";
import { isKindleList, KINDLE_CHANGED, KindleReviewDialog } from "./imports/KindleReview";
import { AddToCollectionHost } from "./collections/AddToCollection";
import { ContextMenuHost } from "./components/ContextMenu";
import { BookDialogsHost } from "./library/BookDialogs";
import { SendToEreaderHost } from "./ereaders/SendToEreader";
import { SendWithLocalSendHost } from "./localsend/SendWithLocalSend";
import { BookDetailsPage } from "./details/BookDetailsPage";
import { DetailsHost } from "./details/DetailsHost";
import { onShowBookDetails, onShowInLibrary } from "./details/openDetails";
import { Collections } from "./collections/Collections";
import { Writing, type WritingSection } from "./writing/Writing";
import { Browse } from "./browse/Browse";
import { Libram } from "./catalogs/Libram";
import { Geas } from "./browse/Geas";
import { UpNextReplacementHost } from "./library/UpNextReplacement";
import { workspaceFrame } from "./shell/workspaceFrame";
import { BROWSER_GO, BROWSER_PAGE, BROWSER_SWITCH, BrowserNav, BrowserSiteButton, navigateBrowserHistory, openInDiscover } from "./browse/Browser";
import { AddressSuggestions } from "./browse/AddressSuggestions";
import { readBrowserPrefs, shortAddress } from "./browse/browserPrefs";
import { loadHistory } from "./browse/browserHistory";
import { askBrowser } from "./browse/browserAsk";
import { isActiveDownload, listenForDownloads, useDownloads } from "./browse/browserDownloads";
import { Audiobooks } from "./audio/Audiobooks";
import { PlayerBar } from "./audio/PlayerBar";
import { usePlayer } from "./audio/player";
import { useWidgetLinks, useWidgetRefresh, type WidgetLink } from "./widgets";
import { followLink } from "./home/QuickLinks";
import { useToast } from "./components/Toast";
import { useStartupUpdateCheck } from "./settings/updates";
import { Home } from "./home/Home";
import { Imports, importCounts } from "./imports/Imports";
import { NO_IMPORTS as NOTHING_IMPORTED } from "./imports/view";
import { useServerQueue } from "./imports/serverQueue";
import { useLocalSendRows } from "./imports/LocalSendRows";
import { LocalSendOffers } from "./imports/LocalSendOffer";
import { PROFILE_CHANGED } from "./settings/ProfileSection";
import { SyncActivity } from "./sync/SyncActivity";
import { startLiningUp } from "./readAlong/lineUp";
import type { ActivitySide } from "./settings/ActivityTab";
import { BookPlacesPage } from "./sync/BookPlaces";
import { importSummary } from "./lib/importSummary";
import { Library, PageSwitch } from "./library/Library";
import { Reader } from "./reader/Reader";
import { initialView, NO_FILTERS, rememberView, type LibraryView } from "./library/libraryView";
import { useAppSettings } from "./settings/appSettings";
import { Settings } from "./settings/Settings";
import type { SettingsTab } from "./settings/settingsIndex";
import { Header } from "./shell/Header";
import { navFor, navRouteOf, routesFor, type Route } from "./shell/routes";
import { Sidebar } from "./shell/Sidebar";
import { Icon } from "./components/Icon";
import { PairHost } from "./audio/LinkEbook";
import { useNarrow } from "./lib/useNarrow";
import { useSwipes } from "./shell/useSwipes";
import { drawImportedCovers } from "./reader/formats";
import { useNavigationHistory } from "./shell/useNavigationHistory";
import { useNavigationShortcuts } from "./shell/useNavigationShortcuts";

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

export function App({ initialRoute = "home", requestedRoute, onRouteHandled, onSplit, workspaceSplit = false, compactReader = false }: {
  initialRoute?: Route;
  requestedRoute?: Route;
  onRouteHandled?: () => void;
  onSplit?: (route: Route) => void;
  workspaceSplit?: boolean;
  compactReader?: boolean;
} = {}) {
  const [route, setRoute] = useState<Route>(initialRoute);
  const [collapsedWide, setCollapsed] = useState(readCollapsed);
  // On a phone the sidebar is a menu opened from the header, always with names.
  const narrow = useNarrow();
  const collapsed = workspaceSplit || (collapsedWide && !narrow);
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
  type SeriesPlace = { route: "library" | "audiobooks"; name: string; parentScroll: number; showAll?: boolean };
  const [seriesPlace, setSeriesPlace] = useState<SeriesPlace | null>(null);
  const [unfilteredSeries, setUnfilteredSeries] = useState<SeriesPlace | null>(null);
  const [seriesScroll, setSeriesScroll] = useState<number | null>(null);
  const [seriesSearch, setSeriesSearch] = useState("");
  const [seriesPage, setSeriesPage] = useState(0);
  const openSeries = (destination: SeriesPlace["route"], name: string) => {
    setSeriesPlace({ route: destination, name, showAll: route !== destination, parentScroll: document.querySelector(".content")?.scrollTop ?? 0 });
    setSeriesSearch(route === destination ? searchText : "");
    setSeriesPage(0);
  };
  const [documentsView, setDocumentsView] = useState<LibraryView>(() => initialView("documents"));
  const [audiobooksView, setAudiobooksView] = useState<LibraryView>(() => initialView("audiobooks"));
  const player = usePlayer();
  // The book the details page shows, and the page to go back to.
  const [details, setDetails] = useState<{ bookId: string; from: Route } | null>(null);
  const [searchText, setSearchText] = useState("");
  const [kindleSearch, setKindleSearch] = useState("");
  const [kindleOpen, setKindleOpen] = useState(false);
  const [browserDraft, setBrowserDraft] = useState("");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [reading, setReading] = useState<{ bookId: string; at?: string; fileId?: string } | null>(null);
  const [writingSection, setWritingSection] = useState<WritingSection>("notes");
  const [writingBook, setWritingBook] = useState<string | null>(null);
  const [openCollection, setOpenCollection] = useState<CollectionRef | null>(null);
  const [settingsTab, setSettingsTab] = useState<SettingsTab | null>(null);
  /** A section of Preferences to show once it opens. */
  const [settingsJump, setSettingsJump] = useState<string | null>(null);
  const [activitySide, setActivitySide] = useState<ActivitySide>("imports");
  const search = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const activeDownloads = useDownloads().filter(isActiveDownload).length;
  useEffect(() => workspaceFrame ? undefined : listenForDownloads(toast), [toast]);
  const { refreshAdaptive, togglePrivacy } = useAppSettings();
  useStartupUpdateCheck(!workspaceFrame);

  const navigate = useCallback((r: Route) => {
    setMenuOpen(false);
    setSeriesPlace(null);
    setSeriesScroll(null);
    // The sidebar's Collections always starts at the overview.
    if (r === "collections") setOpenCollection(null);
    // Sync & Accounts is a page inside Settings.
    if (r === "sync") {
      setSettingsTab("sync");
      r = "settings";
    } else if (r === "imports" || r === "activity" || r === "lining") {
      // Imports, Sync activity and lining up are sides of Preferences › Activity.
      setSettingsTab("activity");
      setActivitySide(r === "imports" ? "imports" : r === "activity" ? "sync" : "lining");
      r = "settings";
    } else if (r === "settings") {
      // Settings opens at its landing page of tabs.
      setSettingsTab(null);
    }
    setRoute(r);
  }, []);

  type SidebarPlace = {
    route: Route;
    details: typeof details;
    series: typeof seriesPlace;
    seriesSearch: string;
    seriesPage: number;
    scroll: number;
    collection: typeof openCollection;
    kindle: boolean;
    settings: typeof settingsTab;
    activity: ActivitySide;
    writingSection: WritingSection;
    writingBook: string | null;
  };
  const sidebarPlaces = useRef(new Map<Route, SidebarPlace>());
  const section = navRouteOf(route === "book" ? details?.from ?? "library" : route);
  const selectSidebar = (target: Route) => {
    if (!routesFor({ web: isWeb, home: isHome, android: isAndroid }).some((route) => route === target)) {
      navigate(target);
      return;
    }
    const content = document.querySelector<HTMLElement>(".workspace-content > .content");
    const same = target === section;
    if (!same) {
      sidebarPlaces.current.set(section, {
        route, details, series: seriesPlace, seriesSearch, seriesPage,
        scroll: content?.scrollTop ?? 0, collection: openCollection, kindle: kindleOpen,
        settings: settingsTab, activity: activitySide, writingSection, writingBook,
      });
    }
    const place = same ? undefined : sidebarPlaces.current.get(target);
    setMenuOpen(false);
    setReading(null);
    setDetails(place?.details ?? null);
    setSeriesPlace(place?.series ?? null);
    setSeriesSearch(place?.seriesSearch ?? "");
    setSeriesPage(place?.seriesPage ?? 0);
    setOpenCollection(place?.collection ?? null);
    setKindleOpen(place?.kindle ?? false);
    setSettingsTab(place?.settings ?? null);
    setSettingsJump(null);
    setActivitySide(place?.activity ?? "imports");
    setWritingSection(place?.writingSection ?? "notes");
    setWritingBook(place?.writingBook ?? null);
    setRoute(place?.route ?? target);
    if (target === "library" || target === "audiobooks") setSeriesScroll(place?.scroll ?? 0);
    else if (same && content) content.scrollTop = 0;
    if (same && target === "catalogs") {
      setBrowserDraft("");
      askBrowser({ start: true });
    }
  };
  const sidebarAction = useRef(selectSidebar);
  sidebarAction.current = selectSidebar;

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
        setSeriesPlace(null);
        setSeriesScroll(null);
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
      setSeriesPlace(null);
      setSeriesScroll(null);
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
  useEffect(() => api.onSharedBooks((message) => toast(message)), [toast]);
  // Installed again: the old install's place in sync, name and sign-ins came back.
  useEffect(() => {
    void api.welcomedBack().then((back) => back && toast("Welcome back. TBV is picking up where you left off."), () => undefined);
  }, [toast]);

  // Chosen in Preferences › Discover: every site's cookies and data go each time TBV starts.
  useEffect(() => {
    if (!workspaceFrame && api.kind === "app" && readBrowserPrefs().clearOnStart) void api.browserClear().catch(() => undefined);
  }, []);

  // Discover's history comes from the library, and again when sync brings some from another device.
  useEffect(() => {
    if (api.kind !== "app") return;
    const load = () => void loadHistory(readBrowserPrefs().historyKeep);
    load();
    return api.onSync({ libraryChanged: load });
  }, []);

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

  // Preferences › Appearance, at the Profile card.
  const openProfile = useCallback(() => {
    setReading(null);
    setMenuOpen(false);
    setSettingsTab("appearance");
    setSettingsJump("profile");
    setRoute("settings");
  }, []);

  // Preferences › Your plan, where nothing can be bought it isn't offered.
  const openPlan = useCallback(() => {
    setReading(null);
    setMenuOpen(false);
    setSettingsTab("plan");
    setRoute("settings");
  }, []);

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

  const [kindleReview, setKindleReview] = useState<KindleImport | null>(null);
  const runImport = useCallback(
    async (chosen: string[]) => {
      // A list of books bought on Kindle is read as a list, then reviewed.
      const lists = chosen.filter(isKindleList);
      const paths = chosen.filter((p) => !isKindleList(p));
      for (const list of lists) {
        try {
          setKindleReview(await api.importKindle(list));
        } catch (e) {
          toast(`${list.split(/[\\/]/).pop()} isn't a book TBV can read.`);
          console.warn(e);
        }
      }
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

  // Lining up paired books and audiobooks word by word, in the background.
  useEffect(() => {
    if (isApp && !workspaceFrame) startLiningUp();
  }, []);

  // Dropping files or folders anywhere on the window imports them.
  useEffect(() => {
    if (!isApp || workspaceFrame) return;
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

  // App Back/Forward (Alt+Shift+Left/Right), independent of webpage history.
  type Place = { route: Route; collection: CollectionRef | null; details: typeof details; series: SeriesPlace | null };
  const { back, forward } = useNavigationHistory<Place>(
    { route, collection: openCollection, details, series: seriesPlace },
    (place) => {
      if (seriesPlace && !place.series && seriesPlace.route === place.route) setSeriesScroll(seriesPlace.parentScroll);
      if (place.series !== seriesPlace) {
        setSeriesSearch("");
        setSeriesPage(0);
      }
      setSeriesPlace(place.series);
      setDetails(place.details);
      setOpenCollection(place.collection);
      setRoute(place.route);
    },
    (a, b) => a.route === b.route && JSON.stringify(a.collection) === JSON.stringify(b.collection) &&
      a.details?.bookId === b.details?.bookId && a.details?.from === b.details?.from && a.series === b.series,
  );
  const showingSeries = seriesPlace?.route === route ? seriesPlace : null;
  const showAllSeries = !!showingSeries && (showingSeries.showAll || unfilteredSeries === showingSeries);
  const searchingKindle = route === "collections" && kindleOpen && !openCollection;

  useEffect(() => {
    if (!requestedRoute) return;
    setReading(null);
    navigate(requestedRoute);
    onRouteHandled?.();
  }, [requestedRoute, onRouteHandled, navigate]);
  useEffect(() => {
    const open = (event: Event) => {
      setReading(null);
      navigate((event as CustomEvent<Route>).detail);
    };
    if (!workspaceFrame) return;
    window.addEventListener("tbv:workspace-navigate", open);
    return () => window.removeEventListener("tbv:workspace-navigate", open);
  }, [navigate]);
  const seriesView = (base: LibraryView): LibraryView => showingSeries
    ? { ...base, ...(showAllSeries ? { ...NO_FILTERS, tab: "all" as const } : {}), series: [showingSeries.name], sort: "series", seriesGrouping: "individual", page: seriesPage }
    : base;
  useNavigationShortcuts({ back, forward, reading: !!reading, discover: route === "catalogs", webpage: navigateBrowserHistory });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Privacy mode works everywhere, the reader included.
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === "h") {
        e.preventDefault();
        togglePrivacy();
        return;
      }
      if (!(e.ctrlKey || e.metaKey) || e.altKey || reading) return;
      const n = Number(e.key);
      if (e.key === "\\") { if (!workspaceSplit) toggleSidebar(); }
      else if (e.key.toLowerCase() === "o" && !e.shiftKey) importBooks();
      else if (e.key.toLowerCase() === "f" || e.key.toLowerCase() === "k") {
        search.current?.focus();
      }
      else if (n >= 1 && n <= navFor({ web: isWeb, home: isHome, android: isAndroid }).length) sidebarAction.current(navFor({ web: isWeb, home: isHome, android: isAndroid })[n - 1].route);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleSidebar, importBooks, reading, navigate, togglePrivacy, workspaceSplit]);

  const onHomeLoaded = useCallback((home: HomeViewModel) => setSync(home.sync), []);
  const openBook = useCallback((bookId: string, at?: string, fileId?: string) => setReading({ bookId, at, fileId }), []);
  const showCollection = useCallback((id: string) => {
    setOpenCollection({ kind: "collection", id });
    setRoute("collections");
  }, []);
  const openCompendium = useCallback((smart: SmartKind) => {
    setOpenCollection({ kind: "smart", smart });
    setRoute("collections");
  }, []);
  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  // Taps on the iPhone's widgets.
  const playerNow = useRef(player);
  playerNow.current = player;
  const followWidget = useCallback(
    (link: WidgetLink) => {
      const p = playerNow.current;
      if (link.kind === "book") openBook(link.id);
      else if (link.kind === "home") navigate("home");
      else if (link.kind === "sigil")
        void api.sanctumLinks().then(
          (links) => {
            const sigil = links.find((l) => l.id === link.id);
            if (sigil) followLink(sigil.target, { onNavigate: navigate, onOpenBook: (id) => openBook(id), onOpenCollection: showCollection });
          },
          () => undefined,
        );
      else {
        const loaded = p.book?.book.id;
        const want = link.bookId ?? loaded;
        if (!want) return;
        if (want !== loaded) {
          void p.load(want, link.action === "toggle").then(() => link.action === "back" && playerNow.current.skip(-30_000));
        } else if (link.action === "toggle") p.toggle();
        else p.skip(-30_000);
      }
    },
    [openBook, navigate, showCollection],
  );
  useWidgetLinks(followWidget);
  useWidgetRefresh();

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
    onOpenProfile: openProfile,
    onOpenPlan: isApp || api.kind === "preview" ? openPlan : undefined,
    onImportBooks: importBooks,
    onImportFolder: importFolder,
    onOpenSyncSettings: () => {
      setReading(null);
      navigate("sync");
    },
    // The reader's Search (and Translate where Apple's isn't there): a new Discover tab.
    onOpenWeb: (url: string) => {
      closeBook();
      navigate("catalogs");
      openInDiscover(url);
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

  // Phone swipes: left to the Archive, right opens the sidebar; a long pull
  // down from the top bar goes to Sanctum. The Reader keeps its swipes for
  // turning pages.
  const appRoot = useRef<HTMLDivElement>(null);
  const pullHome = useRef<HTMLDivElement>(null);
  const toLibrary = useCallback(() => navigate("library"), [navigate]);
  const openMenu = useCallback(() => setMenuOpen(true), []);
  // On Discover the top search box shows the address of the page in front.
  const [browserAddress, setBrowserAddress] = useState("");
  useEffect(() => {
    const heard = (e: Event) => setBrowserAddress((e as CustomEvent<string>).detail);
    window.addEventListener(BROWSER_PAGE, heard);
    return () => window.removeEventListener(BROWSER_PAGE, heard);
  }, []);
  // The Archive holds books and documents, one switch apart.
  const archiveSwitch = (
    <PageSwitch<"library" | "documents">
      label="Books or documents"
      value={route === "documents" ? "documents" : "library"}
      options={[
        { value: "library", label: "Books" },
        { value: "documents", label: "Documents" },
      ]}
      onChange={(next) => next !== route && navigate(next)}
    />
  );
  const toHome = useCallback(() => navigate("home"), [navigate]);
  useSwipes(appRoot, pullHome, narrow && !workspaceSplit && !menuOpen && !reading, {
    // Left goes to the library from any other page; right opens the menu of pages.
    onLeft: route !== "library" ? toLibrary : undefined,
    onRight: openMenu,
    onPullDown: route !== "home" ? toHome : undefined,
  });
  // With the menu of pages open, a swipe left closes it, back to the page underneath.
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  useSwipes(appRoot, pullHome, narrow && !workspaceSplit && menuOpen && !reading, { onLeft: closeMenu, overMenu: true });

  const leaveSeries = () => {
    if (seriesPlace) setSeriesScroll(seriesPlace.parentScroll);
    setSeriesPlace(null);
    setSeriesSearch("");
    setSeriesPage(0);
  };
  const closeDetails = () => {
    const destination = details?.from;
    setDetails(null);
    setRoute(destination && destination !== "book" ? destination : "library");
  };
  const sidebar = (
    <Sidebar
      route={route === "book" && details ? details.from : route}
      collapsed={collapsed}
      lockedCollapsed={workspaceSplit}
      drawerOpen={!workspaceSplit && narrow && menuOpen}
      onCloseDrawer={() => setMenuOpen(false)}
      onNavigate={selectSidebar}
      onSplit={onSplit && ((target) => {
        setMenuOpen(false);
        onSplit(target);
      })}
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
  );
  if (reading) {
    const reader = <Reader key={`${reading.bookId}/${reading.fileId ?? ""}`} bookId={reading.bookId}
      fileId={reading.fileId} openAt={reading.at} compact={compactReader || workspaceSplit} shell={shell} onClose={closeBook} />;
    return <>
      {workspaceSplit ? <div className="app sidebar-collapsed workspace-rail">{sidebar}<div className="main">{reader}</div></div> : reader}
      {workspaceSplit && <ContextMenuHost />}
    </>;
  }

  return (
    <div ref={appRoot} className={`app${collapsed ? " sidebar-collapsed" : ""}${workspaceSplit ? " workspace-rail" : ""}${player.book ? " has-player" : ""}`}>
      {narrow && !workspaceSplit && route !== "home" && (
        <div ref={pullHome} className="pull-home" aria-hidden>
          <Icon name="home" size={16} /> <span className="pull-home-far">Keep pulling for Home</span>
          <span className="pull-home-ready">Let go for Home</span>
        </div>
      )}
      {sidebar}
      <div className="main">
        <Header
          ref={search}
          onOpenMenu={workspaceSplit ? undefined : () => setMenuOpen(true)}
          sync={sync}
          profile={profile}
          search={route === "catalogs" ? browserDraft : searchingKindle ? kindleSearch : showingSeries ? seriesSearch : searchText}
          onSearchChange={route === "catalogs" ? setBrowserDraft : searchingKindle ? setKindleSearch : showingSeries ? (value) => { setSeriesSearch(value); setSeriesPage(0); } : changeSearch}
          placeholder={
            route === "notes" || route === "writing"
              ? "Search notes, books, authors or words…"
              : route === "audiobooks"
                ? "Search audiobooks…"
                : route === "catalogs"
                  ? "Search or enter a website…"
                  : route === "collections"
                    ? searchingKindle ? "Find a Kindle title or author…" : "Search the Compendium…"
                    : route === "settings"
                      ? "Search preferences…"
                  : undefined
          }
          onSearchSubmit={() => {
            // On Discover the top search box is the browser's address bar.
            if (route === "catalogs") {
              window.dispatchEvent(new CustomEvent(BROWSER_GO, { detail: browserDraft }));
              setBrowserDraft("");
            } else if (route === "library" || route === "audiobooks" || route === "documents") {
              window.dispatchEvent(new Event("tbv:submit-library-search"));
            } else if (route !== "notes" && route !== "writing" && route !== "collections" && route !== "settings") setRoute("library");
          }}
          onPasteAndGo={route === "catalogs" && !narrow ? (text) => {
            window.dispatchEvent(new CustomEvent(BROWSER_GO, { detail: text }));
          } : undefined}
          address={route === "catalogs" ? browserAddress : undefined}
          pageAction={route === "catalogs" ? <BrowserNav /> : undefined}
          searchStart={route === "catalogs" ? <BrowserSiteButton url={browserAddress} /> : undefined}
          addressLabel={route === "catalogs" ? shortAddress(browserAddress) : undefined}
          typingPanel={
            route === "catalogs"
              ? (typed, done) => (
                  <AddressSuggestions
                    showPaste={narrow}
                    typed={typed}
                    current={browserAddress}
                    onGo={(text) => {
                      window.dispatchEvent(new CustomEvent(BROWSER_GO, { detail: text }));
                      done();
                    }}
                    onOpen={(url) => {
                      // Like any browser: a suggestion opens in the tab it was typed in.
                      window.dispatchEvent(new CustomEvent(BROWSER_GO, { detail: url }));
                      done();
                    }}
                    onTab={(id) => {
                      window.dispatchEvent(new CustomEvent(BROWSER_SWITCH, { detail: id }));
                      done();
                    }}
                  />
                )
              : undefined
          }
          onOpenProfile={openProfile}
          onOpenPlan={isApp || api.kind === "preview" ? openPlan : undefined}
          onImportBooks={importBooks}
          onImportFolder={importFolder}
          onOpenSyncSettings={() => navigate("sync")}
          onOpenActivity={shell.onOpenActivity}
          onOpenPlaces={shell.onOpenPlaces}
        />
        <div className="workspace-content">
        {route !== "catalogs" && <main className="content">
          {route === "home" ? (
            <Home
              refreshKey={refreshKey}
              onNavigate={navigate}
              onOpenLibrary={openLibrary}
              onOpenSeries={(name) => {
                setRoute("library");
                openSeries("library", name);
              }}
              onImportBooks={importBooks}
              onImportFolder={importFolder}
              onLoaded={onHomeLoaded}
              onOpenBook={openBook}
              onOpenCompendium={openCompendium}
              onOpenCollection={showCollection}
            />
          ) : route === "library" ? (
            <Library
              switcher={archiveSwitch}
              view={seriesView(libraryView)}
              search={showingSeries ? seriesSearch : searchText}
              refreshKey={refreshKey}
              onChange={showingSeries ? (change) => setSeriesPage(change.page ?? 0) : changeLibraryView}
              onClearSearch={() => showingSeries ? setSeriesSearch("") : changeSearch("")}
              onOpenSeries={(name) => openSeries("library", name)}
              seriesBack={showingSeries ? leaveSeries : undefined}
              onShowAllSeries={showingSeries && !showAllSeries ? () => { setUnfilteredSeries(showingSeries); setSeriesSearch(""); setSeriesPage(0); } : undefined}
              restoreScroll={seriesScroll}
              onScrollRestored={() => setSeriesScroll(null)}
              onImportBooks={importBooks}
              onImportFolder={importFolder}
              onOpenBook={openBook}
              onOpenCollection={showCollection}
            />
          ) : route === "documents" ? (
            <Library
              kind="documents"
              switcher={archiveSwitch}
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
              onBack={closeDetails}
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
              kindleOpen={kindleOpen} setKindleOpen={setKindleOpen} kindleSearch={kindleSearch}
              refreshKey={refreshKey}
              onOpen={setOpenCollection}
              onDiscover={navFor({ web: isWeb, home: isHome, android: isAndroid }).some((item) => item.route === "catalogs") ? () => navigate("catalogs") : undefined}
              onOpenBook={openBook}
              onChanged={refresh}
              search={searchText}
            />
          ) : route === "audiobooks" ? (
            <Audiobooks
              view={seriesView(audiobooksView)}
              search={showingSeries ? seriesSearch : searchText}
              refreshKey={refreshKey}
              onChange={showingSeries ? (change) => setSeriesPage(change.page ?? 0) : changeAudiobooksView}
              onClearSearch={() => showingSeries ? setSeriesSearch("") : changeSearch("")}
              onOpenSeries={(name) => openSeries("audiobooks", name)}
              seriesBack={showingSeries ? leaveSeries : undefined}
              onShowAllSeries={showingSeries && !showAllSeries ? () => { setUnfilteredSeries(showingSeries); setSeriesSearch(""); setSeriesPage(0); } : undefined}
              restoreScroll={seriesScroll}
              onScrollRestored={() => setSeriesScroll(null)}
              onImportBooks={importBooks}
              onImportFolder={importFolder}
              onOpenCollection={showCollection}
              onReadAlong={(ebookId) => openBook(ebookId)}
            />
          ) : route === "geas" ? (
            <Geas />
          ) : route === "libram" ? (
            <Libram
              refreshKey={refreshKey}
              onOpenBook={openBook}
              onOpenSite={(url) => {
                navigate("catalogs");
                askBrowser({ url });
              }}
            />
          ) : route === "places" ? (
            <BookPlacesPage onOpenSyncSettings={() => navigate("sync")} />
          ) : route === "notes" || route === "writing" ? (
            <Writing
              chip={writingSection} setChip={setWritingSection}
              openId={writingBook} setOpenId={setWritingBook}
              booksShown={!isHome}
              search={searchText}
              refreshKey={refreshKey}
              onClearSearch={() => changeSearch("")}
              onOpenBook={openBook}
            />
          ) : (
            <Settings
              tab={settingsTab}
              onTab={setSettingsTab}
              jump={settingsJump}
              onJumped={() => setSettingsJump(null)}
              libraryLayout={libraryView.layout}
              librarySort={libraryView.sort}
              onLibraryView={changeLibraryView}
              sidebarShown={!collapsed}
              onSidebarShown={(shown) => shown === collapsed && toggleSidebar()}
              // Settings, profile and reader preferences are held all over the app,
              // so a restore starts the window afresh to read them back.
              onRestored={() => window.location.reload()}
              query={searchText}
              onQuery={changeSearch}
              activity={{
                side: activitySide,
                onSide: setActivitySide,
                imports: (
                  <Imports
                    embedded
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
                ),
                sync: <SyncActivity embedded sync={sync} onOpenSyncSettings={() => navigate("sync")} />,
              }}
            />
          )}
        </main>}
        {route === "catalogs" && <main className="content discover-workspace-pane" key="discover-workspace">
          <Browse onOpenBook={openBook}
            search={browserDraft} onSearchChange={setBrowserDraft}
            allowTabSplit={!workspaceSplit && !workspaceFrame}
            onSplitWith={workspaceSplit ? undefined : onSplit} />
        </main>}
        </div>
      </div>
      {dropping && (
        <div className="drop-overlay" aria-hidden>
          <p>Drop to add to your library</p>
        </div>
      )}
      {route !== "catalogs" && activeDownloads > 0 ? (
        <button type="button" className="import-progress" onClick={() => { askBrowser({ panel: "downloads" }); navigate("catalogs"); }}>
          {activeDownloads} {activeDownloads === 1 ? "download" : "downloads"} in progress <span className="import-progress-link">View</span>
        </button>
      ) : !(route === "settings" && settingsTab === "activity" && activitySide === "imports") && importCounts(imports).running && (
        <button type="button" className="import-progress" onClick={() => navigate("imports")}>
          Imported {importCounts(imports).done} of {importCounts(imports).total} books <span className="import-progress-link">View</span>
        </button>
      )}
      {kindleReview && (
        <KindleReviewDialog
          review={kindleReview.review}
          imported={kindleReview}
          onClose={(applied) => {
            setKindleReview(null);
            // The list was kept even when nothing was applied, so the Compendium shows it.
            window.dispatchEvent(new Event(KINDLE_CHANGED));
            if (applied) refresh();
          }}
        />
      )}
      {!isWeb && !isHome && <LocalSendOffers />}
      <PlayerBar onShowAudiobooks={() => navigate("audiobooks")} />
      <AddToCollectionHost onChanged={refresh} />
      <BookDialogsHost onChanged={refresh} />
      <UpNextReplacementHost onChanged={refresh} />
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

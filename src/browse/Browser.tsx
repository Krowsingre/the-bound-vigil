// Discover: a web browser inside TBV. Each tab's page shows in a view of its
// own laid over the space below the button row (see src-tauri/src/browser.rs);
// this draws the row, the tabs, the Downloads list and reader mode, and keeps
// the page's view in place. The top bar's search box is the address bar.

import { useCallback, useEffect, useRef, useState } from "react";
import { api, isIOS, openExternal } from "../api";
import type { Bookmark, BrowserEvent, BrowserFrame, ReaderArticle } from "../api/types";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { openContextMenu, openContextMenuAt } from "../components/ContextMenu";
import { Icon } from "../components/Icon";
import { Menu, type MenuEntry } from "../components/Menu";
import { useToast } from "../components/Toast";
import { askSendWithLocalSend } from "../localsend/SendWithLocalSend";
import { formatLabel } from "../lib/queryBooks";
import { useNarrow } from "../lib/useNarrow";
import {
  addressFor,
  desktopHosts,
  homeOf,
  isAddress,
  isStartPage,
  lowerFor,
  onBrowserPrefs,
  protectionOf,
  readableAddress,
  readBrowserPrefs,
  setSiteSettings,
  siteOf,
  siteSettings,
  START_PAGE,
  writeBrowserPrefs,
} from "./browserPrefs";
import {
  closeOtherTabs,
  closeTab,
  duplicateTab,
  freshTabs,
  moveTab,
  newTabId,
  onClosedTabs,
  openTab,
  readClosedTabs,
  readTabs,
  rememberClosed,
  reopenTab,
  takeClosed,
  updateTab,
  writeTabs,
  type ClosedTab,
  type TabsState,
} from "./browserTabs";
import { downloadState, readDownloads, writeDownloads, type Fetched } from "./browserDownloads";
import { addToHistory } from "./browserHistory";
import { HistoryPanel } from "./HistoryPanel";
import { addToReadingList, bookIdOf } from "./readingList";
import { ClosedList } from "./ClosedList";
import { SiteInfo } from "./SiteInfo";
import { BookmarksPanel, ReadingListPanel } from "./StartPanels";
import { StartPage, type StartPanel } from "./StartPage";
import { useTabDrag } from "./useTabDrag";
import { articleByline, articleEpub, articleFrom, cleanArticle, readerScript } from "./readerArticle";

/** The header's search box, on Discover, sends what's typed here. */
export const BROWSER_GO = "tbv:browser-go";
/** The page in front, told to the header so its search box can show the address. */
export const BROWSER_PAGE = "tbv:browser-page";

/** The top bar's buttons, on Discover, ask the browser here: "home", "reload", "stop", "top" (back to the top of the page), "site" (the Site information sheet). */
const BROWSER_DO = "tbv:browser-do";
/** The address suggestions' "Switch to tab", with the tab's id. */
export const BROWSER_SWITCH = "tbv:browser-switch";
/** Whether the page in front is loading, told to the top bar's Reload button. */
const BROWSER_BUSY = "tbv:browser-busy";

/** Book sites to start from, until you've bookmarked your own. */
export const SUGGESTED_SITES: { title: string; url: string }[] = [
  { title: "Project Gutenberg", url: "https://www.gutenberg.org/" },
  { title: "Internet Archive", url: "https://archive.org/details/texts" },
  { title: "Open Library", url: "https://openlibrary.org/" },
  { title: "Standard Ebooks", url: "https://standardebooks.org/" },
  { title: "Faded Page", url: "https://www.fadedpage.com/" },
  { title: "LibriVox (audiobooks)", url: "https://librivox.org/" },
];

/** Files TBV can bring in, by the end of their name. */
const BOOK_FILE = /\.(epub|kepub|pdf|mobi|azw3?|fb2|cbz|cbr|djvu|txt|docx?|rtf|m4b|mp3|m4a)(\?|#|$)/i;

const ROW_KEY = "tbv.browser.row";
const ROW_CHANGED = "tbv:browser-row";

/** A phone held sideways, where height is short: the row starts folded. */
const sideways = () => typeof matchMedia === "function" && matchMedia("(max-height: 500px) and (orientation: landscape)").matches;

function readRow(): boolean {
  try {
    const saved = localStorage.getItem(ROW_KEY);
    if (saved === "open") return true;
    if (saved === "folded") return false;
  } catch {
    // The default, then.
  }
  return !sideways();
}

/** Whether Discover's button row is unfolded, shared by the row and the top bar's arrow. */
export function useBrowserRow(): [boolean, () => void] {
  const [open, setOpen] = useState(readRow);
  useEffect(() => {
    const changed = () => setOpen(readRow());
    window.addEventListener(ROW_CHANGED, changed);
    return () => window.removeEventListener(ROW_CHANGED, changed);
  }, []);
  const toggle = useCallback(() => {
    try {
      localStorage.setItem(ROW_KEY, readRow() ? "folded" : "open");
    } catch {
      // For this visit only.
    }
    window.dispatchEvent(new CustomEvent(ROW_CHANGED));
  }, []);
  return [open, toggle];
}

/** The arrow inside the right end of the address that folds the row. */
export function BrowserRowToggle() {
  const [open, toggle] = useBrowserRow();
  const [hideBar, setHideBar] = useState(() => readBrowserPrefs().hideBar);
  useEffect(() => onBrowserPrefs(() => setHideBar(readBrowserPrefs().hideBar)), []);
  // The row hides itself while the page scrolls down, so the arrow takes you back up instead.
  if (hideBar)
    return (
      <button type="button" className="search-action browser-row-toggle" onPointerDown={(e) => e.preventDefault()} aria-label="Back to top" title="Back to top" onClick={() => window.dispatchEvent(new CustomEvent(BROWSER_DO, { detail: "top" }))}>
        <Icon name="arrowUp" size={18} />
      </button>
    );
  return (
    <button type="button" className="search-action browser-row-toggle" onPointerDown={(e) => e.preventDefault()} aria-expanded={open} aria-label={open ? "Hide the browser buttons" : "Show the browser buttons"} onClick={toggle}>
      <Icon name={open ? "chevronUp" : "chevronDown"} size={18} />
    </button>
  );
}

/** The top bar's Home button, between the menu button and the address. */
export function BrowserHomeButton() {
  return (
    <button type="button" className="header-action" aria-label="Home page" title="Home page" onClick={() => window.dispatchEvent(new CustomEvent(BROWSER_DO, { detail: "home" }))}>
      <Icon name="home" size={21} />
    </button>
  );
}

/**
 * Inside the left of the address, where the magnifier sits on other pages: a
 * lock for a secure page, a warning for one that isn't, opening the Site
 * information sheet.
 */
export function BrowserSiteButton({ url }: { url: string }) {
  const web = /^https?:/i.test(url);
  if (!web) return <Icon name={url ? "compass" : "search"} size={18} />;
  const secure = /^https:/i.test(url);
  return (
    <button
      type="button"
      className={`search-action browser-site${secure ? "" : " is-unsafe"}`}
      onPointerDown={(e) => e.preventDefault()}
      aria-label={secure ? "Secure connection: about this site" : "Not secure: about this site"}
      title="About this site"
      onClick={() => window.dispatchEvent(new CustomEvent(BROWSER_DO, { detail: "site" }))}
    >
      <Icon name={secure ? "lock" : "warning"} size={17} />
    </button>
  );
}

/** What a link for another app will do, for asking first. */
export function appLinkAsk(url: string): string {
  const [scheme, ...rest] = url.split(":");
  const raw = rest.join(":").replace(/^\/\//, "").split("?")[0];
  let what = raw;
  try {
    what = decodeURIComponent(raw);
  } catch {
    // A badly written address is shown as it is.
  }
  switch (scheme.toLowerCase()) {
    case "mailto":
      return what ? `This page wants to open your mail app to write to ${what}.` : "This page wants to open your mail app.";
    case "tel":
      return `This page wants to call ${what}.`;
    case "sms":
      return `This page wants to send a text message to ${what}.`;
    default:
      return `This page wants to open another app with a "${scheme}:" link.`;
  }
}

/** A file name from an address, for its title in the library. */
const fileTitle = (url: string) => {
  try {
    const name = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "");
    return name.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ").trim() || "A book from the web";
  } catch {
    return "A book from the web";
  }
};

/** Whether Discover has opened since TBV started, for starting afresh after closing TBV. */
let openedThisRun = false;

/** The tabs Discover opens with, as chosen in Preferences › Discover. */
function startingTabs(): TabsState {
  const prefs = readBrowserPrefs();
  const home = homeOf(prefs);
  const first = !openedThisRun;
  openedThisRun = true;
  if (!(prefs.comeBack === "leave" || (prefs.comeBack === "close" && first))) return readTabs(home);
  // Pages kept from before (when the choice was still to keep them) would
  // otherwise go on without a tab to close them by.
  if (!first) for (const t of readTabs(home).tabs) void api.browserAct(t.id, "close").catch(() => undefined);
  return freshTabs(home);
}

const titleOf = (title: string | null, url: string, privately = false) => (isStartPage(url) ? (privately ? "Private tab" : "Start page") : title?.trim() || siteOf(url) || url);

/** How far down the page is, for hiding the row while scrolling. */
const SCROLL_Y = `JSON.stringify(Math.round(window.scrollY || (document.scrollingElement && document.scrollingElement.scrollTop) || 0))`;
const TO_TOP = `(function () { window.scrollTo({ top: 0, behavior: "smooth" }); return JSON.stringify(null); })()`;

/** Pauses every video and sound on a page, for leaving Discover. */
const PAUSE_ALL = `(function () {
  document.querySelectorAll("video, audio").forEach(function (m) { try { m.pause(); } catch (e) {} });
  return JSON.stringify(null);
})()`;

/** Something on top (a menu, a dialog, the phone's menu of pages) would be hidden under the page, so the page steps aside. */
const covered = () => !!document.querySelector(".dialog-backdrop, [role=menu], [role=alertdialog], .sidebar-backdrop, .address-suggestions");

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));
const clean = (e: unknown) => String(e).replace(/^Error: /, "");

export function Browser({ onOpenCatalogues, onOpenBook }: { onOpenCatalogues: () => void; onOpenBook: (bookId: string) => void }) {
  const narrow = useNarrow();
  const [rowOpen] = useBrowserRow();
  const [tabs, setTabs] = useState<TabsState>(startingTabs);
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [marks, setMarks] = useState<Bookmark[]>([]);
  const [fetched, setFetched] = useState<Fetched[]>(readDownloads);
  const [panel, setPanel] = useState<null | "tabs" | "site" | StartPanel>(null);
  /** Pages that couldn't open, by tab: TBV's own page says why. */
  const [failed, setFailed] = useState<Record<string, { url: string; reason: string }>>({});
  /** Tabs just closed, for the Undo line. */
  const [undo, setUndo] = useState<{ count: number; at: number } | null>(null);
  const [closedTabs, setClosedTabs] = useState(readClosedTabs);
  /** A link for another app, waiting for an answer. */
  const [appLink, setAppLink] = useState<string | null>(null);
  /** Scrolled down the page: the row is out of the way until it scrolls back up. */
  const [scrolledAway, setScrolledAway] = useState(false);
  const [finding, setFinding] = useState<string | null>(null);
  const [article, setArticle] = useState<ReaderArticle | null>(null);
  const [saving, setSaving] = useState(false);
  const [prefs, setPrefs] = useState(readBrowserPrefs);
  const [problem, setProblem] = useState<string | null>(null);
  const area = useRef<HTMLDivElement>(null);
  /** Tabs whose page view has been made. */
  const made = useRef(new Set<string>());
  const shown = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => void (mounted.current = false);
  }, []);
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const fetchedRef = useRef(fetched);
  fetchedRef.current = fetched;
  const refit = useRef<() => void>(() => undefined);
  const toast = useToast();

  const active = tabs.tabs.find((t) => t.id === tabs.active) ?? tabs.tabs[0];
  const url = active?.url ?? "";
  const onStart = isStartPage(url);
  const failure = onStart ? null : failed[active.id] ?? null;
  /** Reader mode, the tab grid, the start page and the error page cover the page, so the page's view steps aside. */
  const aside = useRef(false);
  aside.current = !!article || panel === "tabs" || onStart || !!failure;

  useEffect(() => writeTabs(tabs), [tabs]);
  useEffect(() => writeDownloads(fetched), [fetched]);
  useEffect(() => onClosedTabs(() => setClosedTabs(readClosedTabs())), []);
  useEffect(() => {
    if (!undo) return;
    const gone = window.setTimeout(() => setUndo(null), 7000);
    return () => window.clearTimeout(gone);
  }, [undo]);
  // A tab that's gone (the oldest, past the most kept) has its page closed too.
  useEffect(() => {
    for (const id of [...made.current]) {
      if (tabs.tabs.some((t) => t.id === id)) continue;
      made.current.delete(id);
      void api.browserAct(id, "close");
    }
  }, [tabs.tabs]);
  useEffect(() => onBrowserPrefs(() => setPrefs(readBrowserPrefs())), []);

  /** The zoom each tab's page has now, so it's changed only when its site wants another. */
  const zoomed = useRef<Record<string, number>>({});
  const fitZoom = useCallback((tab: string, at: string) => {
    if (!/^https?:/i.test(at) || !made.current.has(tab)) return;
    const want = siteSettings(siteOf(at)).zoom ?? 1;
    if ((zoomed.current[tab] ?? 1) === want) return;
    zoomed.current[tab] = want;
    void api.browserZoom(tab, want).catch(() => undefined);
  }, []);
  // A site's zoom changed in its sheet, or was reset in Preferences.
  useEffect(() => {
    for (const t of tabsRef.current.tabs) fitZoom(t.id, t.url);
  }, [prefs.sites, fitZoom]);
  // iPhone and iPad: the sites shown in their computer version.
  const desktopList = desktopHosts(prefs).join("\n");
  useEffect(() => {
    if (isIOS) void api.browserDesktopSites(desktopList ? desktopList.split("\n") : []).catch(() => undefined);
  }, [desktopList]);

  // The top bar shows the address of the page in front.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent(BROWSER_PAGE, { detail: isStartPage(url) ? "" : url }));
  }, [url]);
  useEffect(() => () => void window.dispatchEvent(new CustomEvent(BROWSER_PAGE, { detail: "" })), []);

  const frame = (): BrowserFrame | null => {
    const r = area.current?.getBoundingClientRect();
    return r && r.width > 0 && r.height > 0 ? { x: r.left, y: r.top, width: r.width, height: r.height } : null;
  };

  /** Shows the tab in front, making its view first if it's new. */
  const showActive = useCallback(async (at: BrowserFrame) => {
    const { tabs: list, active: id } = tabsRef.current;
    const tab = list.find((t) => t.id === id) ?? list[0];
    // TBV's own start page: no web page to show.
    if (isStartPage(tab.url)) return api.browserHide();
    const fresh = !made.current.has(tab.id);
    await api.browserShow(tab.id, fresh ? tab.url : null, at, protectionOf(readBrowserPrefs()), !!tab.private);
    made.current.add(tab.id);
    if (fresh) fitZoom(tab.id, tab.url);
    // A new tab's page can take a moment to come up (iPhone readies its
    // protection first). Left Discover, or covered, in that moment: the page
    // would show over whatever's there now, so it goes away again.
    if (!mounted.current || covered() || aside.current) await api.browserHide();
  }, [fitZoom]);

  const reloadMarks = useCallback(() => api.bookmarks().then(setMarks, () => undefined), []);
  useEffect(() => void reloadMarks(), [reloadMarks]);

  const answer = useCallback(
    async (d: Fetched, how: "add" | "keep" | "drop") => {
      if (!d.path) return;
      let bookId: string | undefined;
      try {
        if (how === "add") {
          bookId = await api.browserAddDownload(d.path);
          toast(`${d.name} is being added to your library.`);
        } else if (how === "keep") {
          const where = await api.browserKeepDownload(d.path);
          toast(`Saved to ${where}`);
        } else await api.browserDiscardDownload(d.path);
      } catch (e) {
        // Left as it was, so it can be tried again.
        toast(String(e));
        return;
      }
      setFetched((list) =>
        how === "drop" ? list.filter((x) => x.id !== d.id) : list.map((x) => (x.id === d.id ? { ...x, asking: false, state: how === "add" ? "added" : "kept", bookId: bookId ?? x.bookId } : x)),
      );
    },
    [toast],
  );

  // What the tabs did.
  useEffect(() => {
    const heard = (ev: BrowserEvent) => {
      switch (ev.kind) {
        case "page": {
          setLoading((l) => ({ ...l, [ev.tab]: ev.loading }));
          // Loading again (Try again, or another page): the error page goes.
          if (ev.loading) setFailed((f) => (f[ev.tab] ? Object.fromEntries(Object.entries(f).filter(([t]) => t !== ev.tab)) : f));
          fitZoom(ev.tab, ev.url);
          // Chosen in Preferences › Discover: each page visited goes in History (not from a private tab).
          const keep = readBrowserPrefs();
          const privately = !!tabsRef.current.tabs.find((t) => t.id === ev.tab)?.private;
          if (!ev.loading && !privately && keep.historyOn && /^https?:/i.test(ev.url)) addToHistory({ kind: "page", url: ev.url, title: ev.title ?? null }, keep.historyKeep);
          if (/^https?:/i.test(ev.url)) {
            setTabs((s) => {
              const before = s.tabs.find((t) => t.id === ev.tab);
              // Gone home to the start page while this page was still coming: it stays there.
              if (before && isStartPage(before.url)) return s;
              const title = ev.title ?? (before?.url === ev.url ? before.title : null);
              return updateTab(s, ev.tab, { url: ev.url, title });
            });
          }
          break;
        }
        case "newTab": {
          const id = ev.tab ?? newTabId();
          // On iPhone a pop-up's view is made already, still joined to its page.
          if (ev.tab) made.current.add(id);
          // Opened from a private tab, it's private too.
          const privately = !!tabsRef.current.tabs.find((t) => t.id === ev.from)?.private;
          setTabs((s) => openTab(s, { id, url: /^https?:/i.test(ev.url) ? ev.url : homeOf(), title: null, private: privately || undefined }));
          break;
        }
        case "failed":
          setFailed((f) => ({ ...f, [ev.tab]: { url: ev.url, reason: ev.reason } }));
          if (/^https?:/i.test(ev.url)) setTabs((s) => updateTab(s, ev.tab, { url: ev.url }));
          break;
        case "external":
          if (readBrowserPrefs().askApps) setAppLink(ev.url);
          else void api.browserOpenApp(ev.url).catch((e: unknown) => toast(clean(e)));
          break;
        case "menu":
          if (!/^https?:/i.test(ev.url)) break;
          if (ev.action === "newTab") {
            const privately = !!tabsRef.current.tabs.find((t) => t.id === ev.tab)?.private;
            setTabs((s) => openTab(s, { id: newTabId(), url: ev.url, title: null, private: privately || undefined }));
          } else {
            void api.downloadWebBook(ev.url, fileTitle(ev.url)).then(
              () => toast("It's being added to your library."),
              (e: unknown) => toast(clean(e)),
            );
          }
          break;
        case "closed":
          made.current.delete(ev.tab);
          void api.browserAct(ev.tab, "close");
          setTabs((s) => closeTab(s, ev.tab, homeOf()));
          break;
        case "downloadStart":
          setFetched((list) => [{ id: ev.id, name: ev.name, state: "coming" as const, url: ev.url, tab: ev.tab, at: Date.now() }, ...list.filter((x) => x.id !== ev.id)]);
          break;
        case "download": {
          const before = fetchedRef.current.find((x) => x.id === ev.id);
          const done: Fetched = { ...before, id: ev.id, name: ev.name, path: ev.path, state: ev.ok ? "done" : "failed", asking: ev.ok, tab: ev.tab, at: before?.at ?? Date.now() };
          // Chosen in Preferences › Discover: ebooks go straight in.
          const straightIn = ev.ok && BOOK_FILE.test(ev.name) && readBrowserPrefs().addWithoutAsking;
          setFetched((list) => [done, ...list.filter((x) => x.id !== ev.id)]);
          if (straightIn) void answer(done, "add");
          break;
        }
      }
    };
    return api.onBrowserEvent(heard);
  }, [answer, fitZoom, toast]);

  // The page shows over the space below the row, follows it as it moves,
  // and steps aside for menus, dialogs and reader mode. Hidden on leaving.
  useEffect(() => {
    let live = true;
    let hidden = false;
    let placed = "";
    const fit = () => {
      if (!shown.current) return;
      const now = frame();
      const hide = covered() || aside.current || !now;
      if (hide !== hidden) {
        hidden = hide;
        placed = hide ? "" : JSON.stringify(now);
        void (hide ? api.browserHide() : showActive(now!));
      } else if (!hide && now && JSON.stringify(now) !== placed) {
        placed = JSON.stringify(now);
        void api.browserPlace(now);
      }
    };
    refit.current = () => {
      // A different tab in front, or the page stepping aside: shown or hidden
      // again, whatever was done before.
      hidden = !(covered() || aside.current || !frame());
      fit();
    };
    // Once laid out, so the space has its size.
    const starting = requestAnimationFrame(() => {
      const start = frame();
      if (!start) return;
      placed = JSON.stringify(start);
      showActive(start).then(
        () => {
          shown.current = true;
          if (!live) void api.browserHide();
          else fit();
        },
        (e: unknown) => live && setProblem(String(e).replace(/^Error: /, "")),
      );
    });
    const resized = new ResizeObserver(fit);
    if (area.current) resized.observe(area.current);
    const watching = new MutationObserver(fit);
    watching.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", fit);
    return () => {
      live = false;
      shown.current = false;
      refit.current = () => undefined;
      cancelAnimationFrame(starting);
      resized.disconnect();
      watching.disconnect();
      window.removeEventListener("resize", fit);
      void api.browserHide();
      // Chosen in Preferences › Discover: back to the home page next time, so
      // every tab's page is closed now.
      if (readBrowserPrefs().comeBack === "leave") {
        for (const id of made.current) void api.browserAct(id, "close").catch(() => undefined);
        made.current.clear();
        return;
      }
      // Chosen in Preferences › Discover: whatever was playing stops on leaving.
      if (!readBrowserPrefs().keepPlaying) for (const id of made.current) void api.browserRead(id, PAUSE_ALL).catch(() => undefined);
    };
  }, [showActive]);

  // Another tab came forward, reader mode opened or closed, or a page failed or came back.
  useEffect(() => refit.current(), [tabs.active, article, panel, !!failure]);

  const act = (action: "back" | "forward" | "reload" | "stop") => void api.browserAct(active.id, action).catch(() => undefined);

  /** Holding Back or Forward (or right-clicking it) lists the pages that way, to jump to one. */
  const travelHeld = useRef<{ timer: number; x: number; y: number } | null>(null);
  const swallowClick = useRef(0);
  const showTravel = (way: "back" | "forward", x: number, y: number) => {
    const tab = active.id;
    if (!made.current.has(tab)) return;
    void api.browserTravelled(tab).then(
      (pages) => {
        const list = pages[way].slice(0, 15);
        if (!list.length) return;
        openContextMenuAt(
          x,
          y,
          way === "back" ? "Pages behind" : "Pages ahead",
          list.map((p, i) => ({
            label: p.title.trim() || readableAddress(p.url),
            icon: "globe" as const,
            hint: siteOf(p.url) ?? undefined,
            onSelect: () => void api.browserRead(tab, `(function () { history.go(${way === "back" ? -(i + 1) : i + 1}); return JSON.stringify(null); })()`).catch(() => undefined),
          })),
        );
      },
      () => undefined,
    );
  };
  const travelProps = (way: "back" | "forward") => ({
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
      showTravel(way, e.clientX, e.clientY);
    },
    onTouchStart: (e: React.TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      const at = { x: t.clientX, y: t.clientY };
      travelHeld.current = {
        ...at,
        timer: window.setTimeout(() => {
          travelHeld.current = null;
          swallowClick.current = Date.now() + 800;
          showTravel(way, at.x, at.y);
        }, 500),
      };
    },
    onTouchEnd: () => {
      if (travelHeld.current) window.clearTimeout(travelHeld.current.timer);
      travelHeld.current = null;
    },
    onClickCapture: (e: React.MouseEvent) => {
      // The press that opened the list doesn't also go back a page.
      if (Date.now() < swallowClick.current) {
        swallowClick.current = 0;
        e.preventDefault();
        e.stopPropagation();
      }
    },
  });

  const go = (text: string) => {
    const prefsNow = readBrowserPrefs();
    const to = addressFor(text, prefsNow.search);
    if (!to) return;
    // Words rather than an address: a search, kept in History if chosen.
    if (prefsNow.historyOn && prefsNow.historySearches && !isAddress(text) && !tabsRef.current.tabs.find((t) => t.id === tabsRef.current.active)?.private)
      addToHistory({ kind: "search", url: to, title: text.trim() }, prefsNow.historyKeep);
    setArticle(null);
    setTabs((s) => updateTab(s, s.active, { url: to, title: null }));
    if (made.current.has(tabsRef.current.active)) void api.browserAct(tabsRef.current.active, "go", to).catch((e: unknown) => toast(String(e)));
    else refit.current();
  };
  const goRef = useRef(go);
  goRef.current = go;
  useEffect(() => {
    const fromHeader = (e: Event) => goRef.current((e as CustomEvent<string>).detail);
    window.addEventListener(BROWSER_GO, fromHeader);
    return () => window.removeEventListener(BROWSER_GO, fromHeader);
  }, []);

  const newTab = (privately = false) => {
    setArticle(null);
    setPanel(null);
    setTabs((s) => openTab(s, { id: newTabId(), url: homeOf(), title: null, private: privately || undefined }));
  };
  /** A page in a tab of its own, from the start page's ⋮ menus. */
  const openInNewTab = (to: string) => {
    setArticle(null);
    setPanel(null);
    setTabs((s) => openTab(s, { id: newTabId(), url: to, title: null }));
  };
  /** Home: the start page (with the page left as it was, quiet), or the home page website. */
  const goHome = () => {
    const prefsNow = readBrowserPrefs();
    if (!prefsNow.startPage) return go(prefsNow.home);
    setArticle(null);
    setPanel(null);
    const id = tabsRef.current.active;
    if (made.current.has(id)) {
      void api.browserAct(id, "stop").catch(() => undefined);
      void api.browserRead(id, PAUSE_ALL).catch(() => undefined);
    }
    setTabs((s) => updateTab(s, s.active, { url: START_PAGE, title: null }));
  };
  const switchTo = (id: string) => {
    setArticle(null);
    setPanel(null);
    setTabs((s) => ({ ...s, active: id }));
  };
  const drag = useTabDrag((id, onto) => setTabs((s) => moveTab(s, id, onto)));
  /** Closes tabs' pages; the tabs are remembered for Reopen closed tab and Undo. */
  const forget = (ids: string[]) => {
    const remembered = tabsRef.current.tabs.filter((t) => ids.includes(t.id) && /^https?:/i.test(t.url)).length;
    rememberClosed(tabsRef.current, ids);
    for (const id of ids) {
      made.current.delete(id);
      delete zoomed.current[id];
      void api.browserAct(id, "close");
    }
    setFailed((f) => Object.fromEntries(Object.entries(f).filter(([t]) => !ids.includes(t))));
    setUndo(remembered ? { count: remembered, at: Date.now() } : null);
  };
  const close = (id: string) => {
    forget([id]);
    setTabs((s) => closeTab(s, id, homeOf()));
  };
  const closeOthers = (id: string) => {
    setArticle(null);
    forget(tabsRef.current.tabs.filter((t) => t.id !== id).map((t) => t.id));
    setTabs((s) => closeOtherTabs(s, id));
  };
  const duplicate = (id: string) => {
    setArticle(null);
    setPanel(null);
    setTabs((s) => duplicateTab(s, id));
  };
  /** Opens closed tabs again, back where they were: the last `count`, or the one at `index` in the list. */
  const reopen = (count = 1, index?: number) => {
    const back: ClosedTab[] = [];
    for (let i = 0; i < count; i++) {
      const taken = takeClosed(index ?? 0);
      if (taken) back.push(taken);
    }
    if (!back.length) return;
    setArticle(null);
    setPanel(null);
    setUndo(null);
    setTabs((s) => back.sort((a, b) => a.at - b.at).reduce(reopenTab, s));
  };
  const tabMenu = (id: string): MenuEntry[] => [
    { label: "New tab", icon: "plus", onSelect: () => newTab() },
    { label: "New private tab", icon: "eyeOff", onSelect: () => newTab(true) },
    { label: "Duplicate tab", icon: "copy", disabled: isStartPage(tabsRef.current.tabs.find((t) => t.id === id)?.url ?? ""), onSelect: () => duplicate(id) },
    { label: "Reopen closed tab", icon: "undo", disabled: !closedTabs.length, onSelect: () => reopen() },
    "divider",
    { label: "Close other tabs", icon: "layers", disabled: tabs.tabs.length < 2, onSelect: () => closeOthers(id) },
    { label: "Close tab", icon: "close", onSelect: () => close(id) },
  ];
  // Phone: a sideways swipe along the address box goes to the next tab, or the one before.
  const switchBy = useRef<(by: number) => void>(() => undefined);
  switchBy.current = (by) => {
    const list = tabsRef.current.tabs;
    const at = list.findIndex((t) => t.id === tabsRef.current.active);
    const to = list[at + by];
    if (to) switchTo(to.id);
  };
  useEffect(() => {
    if (!narrow) return;
    const pill = document.getElementById("global-search")?.closest("form");
    if (!pill) return;
    pill.dataset.ownSwipe = "";
    let start: { x: number; y: number } | null = null;
    const down = (e: TouchEvent) => {
      start = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
    };
    const up = (e: TouchEvent) => {
      const from = start;
      start = null;
      const t = e.changedTouches[0];
      // While typing, a sideways drag moves along the words instead.
      if (!from || !t || document.activeElement?.id === "global-search") return;
      const dx = t.clientX - from.x;
      if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(t.clientY - from.y) * 1.5) return;
      switchBy.current(dx < 0 ? 1 : -1);
    };
    pill.addEventListener("touchstart", down, { passive: true });
    pill.addEventListener("touchend", up);
    return () => {
      delete pill.dataset.ownSwipe;
      pill.removeEventListener("touchstart", down);
      pill.removeEventListener("touchend", up);
    };
  }, [narrow]);

  const marked = marks.find((m) => m.url === url) ?? null;
  const isFile = BOOK_FILE.test(url);
  const site = siteOf(url);
  const busy = !!loading[active.id];
  const coming = fetched.filter((d) => d.state === "coming").length;
  const asking = fetched.filter((d) => d.asking);
  useEffect(() => {
    window.dispatchEvent(new CustomEvent(BROWSER_BUSY, { detail: busy }));
  }, [busy]);
  const fromTop = useRef<(what: string) => void>(() => undefined);
  fromTop.current = (what) => {
    if (what === "home") goHome();
    else if (what === "site") setPanel("site");
    else if (what === "top") {
      setScrolledAway(false);
      if (onStart) document.querySelector(".start-page")?.scrollTo({ top: 0, behavior: "smooth" });
      else void api.browserRead(active.id, TO_TOP).catch(() => undefined);
    } else act(what === "stop" ? "stop" : "reload");
  };
  const switchRef = useRef<(id: string) => void>(() => undefined);
  switchRef.current = (id) => void (tabsRef.current.tabs.some((t) => t.id === id) && switchTo(id));
  useEffect(() => {
    const heard = (e: Event) => fromTop.current((e as CustomEvent<string>).detail);
    const toTab = (e: Event) => switchRef.current((e as CustomEvent<string>).detail);
    window.addEventListener(BROWSER_DO, heard);
    window.addEventListener(BROWSER_SWITCH, toTab);
    return () => {
      window.removeEventListener(BROWSER_DO, heard);
      window.removeEventListener(BROWSER_SWITCH, toTab);
      window.dispatchEvent(new CustomEvent(BROWSER_BUSY, { detail: false }));
    };
  }, []);

  // Chosen in Preferences › Discover: the row hides while the page scrolls
  // down and comes back as it scrolls up. Pages can't tell TBV themselves,
  // so TBV looks at how far down the page in front is, a few times a second.
  const watchScroll = prefs.hideBar && !onStart && !article && panel !== "tabs" && !problem;
  /** The start page scrolls in TBV itself, so it says how far as it goes. */
  const startY = useRef(0);
  const startScrolled = (y: number, room: number) => {
    // Too little to scroll: hiding the bar would make it all fit, and it would bounce back.
    if (!prefs.hideBar || room < 140) return;
    if (y < 48 || y < startY.current - 24) setScrolledAway(false);
    else if (y > startY.current + 24) setScrolledAway(true);
    if (Math.abs(y - startY.current) > 24 || y < 48) startY.current = y;
  };
  useEffect(() => {
    setScrolledAway(false);
    startY.current = 0;
    if (!watchScroll) return;
    let last = -1;
    let asking = false;
    const tab = active.id;
    const look = () => {
      if (asking || !shown.current || covered()) return;
      asking = true;
      api
        .browserRead(tab, SCROLL_Y)
        .then((y) => {
          if (typeof y !== "number") return;
          if (last >= 0) {
            if (y < 48 || y < last - 24) setScrolledAway(false);
            else if (y > last + 24) setScrolledAway(true);
          }
          // Small moves add up until they pass the line either way.
          if (last < 0 || Math.abs(y - last) > 24 || y < 48) last = y;
        })
        .catch(() => undefined)
        .finally(() => (asking = false));
    };
    const every = window.setInterval(look, 350);
    return () => window.clearInterval(every);
  }, [watchScroll, active.id, url]);


  const share = (to: string, title: string) => {
    setPanel(null);
    void api.browserShare(to, title, null).catch((e: unknown) => toast(clean(e)));
  };

  const tryAgain = () => {
    if (!failure) return;
    const id = active.id;
    setFailed((f) => Object.fromEntries(Object.entries(f).filter(([t]) => t !== id)));
    void api.browserAct(id, "go", failure.url || url).catch((e: unknown) => toast(clean(e)));
  };

  /** Downloads › Retry: the same address again, in its tab if that's still open. */
  const retry = (d: Fetched) => {
    if (!d.url) return;
    setFetched((list) => list.filter((x) => x.id !== d.id));
    const tab = d.tab && made.current.has(d.tab) ? d.tab : made.current.has(active.id) && !onStart ? active.id : null;
    if (tab) void api.browserAct(tab, "go", d.url).catch((e: unknown) => toast(clean(e)));
    else go(d.url);
  };

  /** The book a download became, once the library has it (it can take a moment to be added). */
  const bookOf = async (d: Fetched) => {
    if (!d.bookId) return null;
    for (let tries = 0; tries < 30; tries++) {
      try {
        return await api.bookDetails(d.bookId);
      } catch {
        if (tries === 0) toast("It's still being added. One moment…");
        await wait(1500);
      }
    }
    toast("It isn't in your library yet. Try again in a moment.");
    return null;
  };
  const readNow = async (d: Fetched) => {
    const found = await bookOf(d);
    if (!found) return;
    setPanel(null);
    onOpenBook(found.book.id);
  };
  const sendWithGrimoire = async (d: Fetched) => {
    const found = await bookOf(d);
    if (!found) return;
    setPanel(null);
    askSendWithLocalSend([found.book]);
  };

  const siteActions = {
    onProtection: (lower: boolean) => {
      if (!site) return;
      void api.browserProtect(protectionOf(lowerFor(site, lower))).then(() => act("reload"));
    },
    onZoom: (zoom: number) => site && setSiteSettings(site, { zoom }),
    onDesktop: (desktop: boolean) => {
      if (!site) return;
      const hosts = desktopHosts(setSiteSettings(site, { desktop }));
      // Told first, so the reload asks for the right version.
      void api.browserDesktopSites(hosts).then(() => act("reload"), () => undefined);
    },
    onClearData: () => {
      if (!site) return;
      void api.browserClearSite(site).then(
        () => {
          toast(`${site}'s cookies and data are cleared.`);
          act("reload");
        },
        (e: unknown) => toast(clean(e)),
      );
    },
    onCopy: () => void navigator.clipboard?.writeText(url).then(() => toast("Link copied.")),
    onShare: () => share(url, titleOf(active.title, url)),
    onClose: () => setPanel(null),
  };

  const toggleMark = async () => {
    if (!url.startsWith("http")) return;
    try {
      if (marked) await api.removeBookmark(marked.id);
      else await api.addBookmark(titleOf(active.title, url), url);
      await reloadMarks();
    } catch (e) {
      toast(String(e));
    }
  };

  const addThisFile = async () => {
    try {
      await api.downloadWebBook(url, fileTitle(url));
      toast("It's being added to your library.");
    } catch (e) {
      toast(String(e));
    }
  };

  /** ••• › Save to Reading List: the page's article, saved without opening reader view. */
  const saveToReadingList = async () => {
    try {
      const found = articleFrom(await api.browserRead(active.id, readerScript()));
      if (found) await saveArticle(found);
      else toast("This page doesn't have an article TBV can find.");
    } catch (e) {
      toast(String(e).replace(/^Error: /, ""));
    }
  };

  const openReader = async () => {
    try {
      const found = articleFrom(await api.browserRead(active.id, readerScript()));
      if (found) setArticle(found);
      else toast("This page doesn't have an article TBV can find.");
    } catch (e) {
      toast(String(e).replace(/^Error: /, ""));
    }
  };

  /** Saves the article as a small EPUB, into the library and the Reading List. */
  const saveArticle = async (from: ReaderArticle | null = article) => {
    if (!from) return;
    setSaving(true);
    try {
      const { bytes, fileName } = await articleEpub(from, (src) => api.browserFetchPicture(src));
      await api.saveWritingEpub(bytes, fileName, null, true);
      addToReadingList({ bookId: await bookIdOf(bytes), title: from.title, url: from.url });
      toast(`"${from.title}" is being added to your library and Reading List.`);
    } catch (e) {
      toast(String(e).replace(/^Error: /, ""));
    } finally {
      setSaving(false);
    }
  };

  const sites = marks.length ? marks : SUGGESTED_SITES.map((s, i) => ({ id: `suggested-${i}`, ...s }));
  const bookmarkItems: MenuEntry[] = [
    { heading: <strong>{marks.length ? "Bookmarks" : "Book sites to start with"}</strong> },
    ...sites.map((m) => ({ label: m.title, icon: "globe" as const, onSelect: () => go(m.url) })),
  ];
  const moreItems: MenuEntry[] = [
    { label: "Copy link", icon: "copy", disabled: !url.startsWith("http"), onSelect: () => void navigator.clipboard?.writeText(url).then(() => toast("Link copied.")) },
    { label: "Share…", icon: "share", disabled: !url.startsWith("http"), onSelect: () => share(url, titleOf(active.title, url)) },
    { label: "Open in your normal browser", icon: "link", disabled: !url.startsWith("http"), onSelect: () => void openExternal(url) },
    { label: "Save to Reading List", icon: "notes", disabled: !url.startsWith("http") || saving, onSelect: () => void saveToReadingList() },
    { label: "Bookmarks", icon: "bookmark", onSelect: () => setPanel("bookmarks") },
    { label: "Reading List", icon: "bookOpen", onSelect: () => setPanel("reading") },
    { label: "History", icon: "clock", onSelect: () => setPanel("history") },
    { label: "Find on page", icon: "search", onSelect: () => setFinding("") },
    { label: "New private tab", icon: "eyeOff", onSelect: () => newTab(true) },
    { label: "Reopen closed tab", icon: "undo", disabled: !closedTabs.length, onSelect: () => reopen() },
    { label: "Make this your home page", icon: "home", disabled: !url.startsWith("http"), onSelect: () => (writeBrowserPrefs({ home: url }), toast("This is your home page now.")) },
    { label: "Site information", icon: "info", disabled: !site, onSelect: () => setPanel("site") },
    { label: "Clear cookies and site data", icon: "trash", onSelect: () => void api.browserClear().then(() => toast("Every site's cookies and data are cleared.")) },
    "divider",
    { label: "Add a catalogue", icon: "globePlus", onSelect: onOpenCatalogues },
    "divider",
    ...bookmarkItems,
  ];

  const button = (label: string, icon: Parameters<typeof Icon>[0]["name"], onClick: () => void, extra = "", more: React.ButtonHTMLAttributes<HTMLButtonElement> = {}) => (
    <button type="button" className={`toolbar-button${extra}`} aria-label={label} title={label} onClick={onClick} {...more}>
      <Icon name={icon} size={17} />
    </button>
  );

  return (
    <div className="browser">
      {!narrow && (
        <div className="browser-tabs" role="tablist" aria-label="Tabs">
          {tabs.tabs.map((t) => (
            <div key={t.id} className={`browser-tab${t.id === tabs.active ? " is-active" : ""}${t.private ? " is-private" : ""}`} {...drag(t.id)} onContextMenu={(e) => openContextMenu(e, `${titleOf(t.title, t.url, t.private)}: tab`, tabMenu(t.id))}>
              <button type="button" role="tab" aria-selected={t.id === tabs.active} className="browser-tab-name" title={t.url} onClick={() => switchTo(t.id)}>
                {loading[t.id] ? <span className="browser-tab-busy" aria-hidden /> : <Icon name={t.private ? "eyeOff" : "globe"} size={13} />}
                <span>{titleOf(t.title, t.url, t.private)}</span>
              </button>
              <button type="button" className="browser-tab-close" aria-label={`Close ${titleOf(t.title, t.url, t.private)}`} onClick={() => close(t.id)}>
                <Icon name="close" size={12} />
              </button>
            </div>
          ))}
          <button type="button" className="browser-tab-new" aria-label="New tab" title="New tab (right-click for a private one)" onClick={() => newTab()} onContextMenu={(e) => openContextMenu(e, "New tab", [{ label: "New private tab", icon: "eyeOff", onSelect: () => newTab(true) }])}>
            <Icon name="plus" size={15} />
          </button>
        </div>
      )}
      {busy && !onStart && <span className="browser-loading" role="progressbar" aria-label="Loading" />}
      {(prefs.hideBar ? !scrolledAway : rowOpen) && (
        <div className="browser-bar">
          {button("Back", "arrowLeft", () => act("back"), "", travelProps("back"))}
          {button("Forward", "arrowRight", () => act("forward"), "", travelProps("forward"))}
          {button(busy ? "Stop" : "Reload", busy ? "close" : "sync", () => act(busy ? "stop" : "reload"))}
          <button type="button" className={`toolbar-button${marked ? " is-on" : ""}`} aria-pressed={!!marked} aria-label={marked ? "Remove bookmark" : "Bookmark this page"} title={marked ? "Remove bookmark" : "Bookmark this page"} onClick={() => void toggleMark()}>
            <Icon name="bookmark" size={17} />
          </button>
          {narrow && (
            <button type="button" className={`toolbar-button browser-count${panel === "tabs" ? " is-on" : ""}`} aria-label={`Tabs: ${tabs.tabs.length} open`} title="Tabs" onClick={() => setPanel(panel === "tabs" ? null : "tabs")}>
              <span>{tabs.tabs.length}</span>
            </button>
          )}
          <span className="browser-bar-divider" aria-hidden />
          {button("Reader view", "bookOpen", () => void (article ? setArticle(null) : openReader()), article ? " is-on" : "")}
          {isFile && button("Add to library", "plus", () => void addThisFile(), " is-on")}
          <span className="browser-bar-space" />
          <button type="button" className="toolbar-button browser-downloads-button" aria-label={coming ? `Downloads, ${coming} coming down` : "Downloads"} title="Downloads" onClick={() => setPanel("downloads")}>
            <Icon name="download" size={17} />
            {(coming > 0 || asking.length > 0) && <span className="browser-badge">{coming || asking.length}</span>}
          </button>
          <Menu label="More" className="toolbar-button" trigger={<Icon name="more" size={17} />} items={moreItems} />
        </div>
      )}
      {finding !== null && (
        <form
          className="browser-find"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            if (finding) void api.browserFind(active.id, finding, false);
          }}
        >
          <Icon name="search" size={15} />
          <input autoFocus value={finding} onChange={(e) => setFinding(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setFinding(null)} placeholder="Find on page" aria-label="Find on page" />
          {button("Previous", "chevronUp", () => finding && void api.browserFind(active.id, finding, true))}
          {button("Next", "chevronDown", () => finding && void api.browserFind(active.id, finding, false))}
          {button("Close find", "close", () => setFinding(null))}
        </form>
      )}
      {undo && (
        <div className="browser-offer" role="status">
          <span>{undo.count === 1 ? "Tab closed." : `${undo.count} tabs closed.`}</span>
          <button type="button" className="btn btn-primary btn-small" onClick={() => reopen(undo.count)}>
            <Icon name="undo" size={14} /> Undo
          </button>
          <button type="button" className="icon-btn" aria-label="Dismiss" onClick={() => setUndo(null)}>
            <Icon name="close" size={14} />
          </button>
        </div>
      )}
      {asking.map((d) => (
        <div key={d.id} className="browser-offer" role="status">
          <span>
            Downloaded <b>{d.name}</b>. Add it to your library?
          </span>
          <button type="button" className="btn btn-primary btn-small" onClick={() => void answer(d, "add")}>
            Add to library
          </button>
          {!isIOS && (
            <button type="button" className="btn btn-quiet btn-small" onClick={() => void answer(d, "keep")}>
              Keep in Downloads
            </button>
          )}
          <button type="button" className="btn btn-quiet btn-small" onClick={() => void answer(d, "drop")}>
            No thanks
          </button>
        </div>
      ))}
      {isFile && !(prefs.hideBar ? !scrolledAway : rowOpen) && (
        <div className="browser-offer" role="status">
          <span>This page is a {formatLabel(url.match(BOOK_FILE)![1].toLowerCase())} file.</span>
          <button type="button" className="btn btn-primary btn-small" onClick={() => void addThisFile()}>
            <Icon name="download" size={14} /> Add to library
          </button>
        </div>
      )}
      <div className="browser-view" ref={area}>
        {onStart && !article && (
          <StartPage
            onGo={go}
            onNewTab={openInNewTab}
            onPanel={setPanel}
            onScrolled={startScrolled}
            onSearch={() => document.getElementById("global-search")?.focus()}
            closed={closedTabs}
            onReopen={(index) => reopen(1, index)}
            privately={!!active.private}
          />
        )}
        {failure && !article && (
          <div className="browser-failed" role="alert">
            <Icon name="cloudOff" size={44} />
            <h2>This page didn't open</h2>
            <p>{failure.reason}</p>
            {failure.url && <p className="muted browser-failed-url">{readableAddress(failure.url)}</p>}
            <div className="browser-failed-actions">
              <button type="button" className="btn btn-primary" onClick={tryAgain}>
                <Icon name="sync" size={15} /> Try again
              </button>
              <button type="button" className="btn btn-quiet" onClick={goHome}>
                <Icon name="home" size={15} /> Home
              </button>
            </div>
          </div>
        )}
        {problem && !onStart && (
          <div className="library-empty" role="alert">
            <h2>The browser couldn't open</h2>
            <p className="muted">{problem}</p>
          </div>
        )}
        {article && (
          <article className="browser-reader" lang={article.lang ?? undefined}>
            <div className="browser-reader-bar">
              <button type="button" className="btn btn-quiet btn-small" onClick={() => setArticle(null)}>
                <Icon name="arrowLeft" size={14} /> Back to the page
              </button>
              <button type="button" className="btn btn-primary btn-small" disabled={saving} onClick={() => void saveArticle()}>
                <Icon name="download" size={14} /> {saving ? "Saving…" : "Save to Reading List"}
              </button>
            </div>
            <header>
              <h1>{article.title}</h1>
              {articleByline(article) && <p className="muted">{articleByline(article)}</p>}
            </header>
            <div className="browser-reader-text" dangerouslySetInnerHTML={{ __html: cleanArticle(article.content) }} />
          </article>
        )}
        {panel === "tabs" && (
          <div className="browser-grid" role="dialog" aria-label="Tabs">
            <div className="browser-grid-head">
              <h2>
                {tabs.tabs.length} {tabs.tabs.length === 1 ? "tab" : "tabs"}
              </h2>
              {tabs.tabs.length > 1 && <span className="muted browser-grid-hint">Hold a tab to move it</span>}
              <button type="button" className="btn btn-quiet btn-small" onClick={() => newTab()}>
                <Icon name="plus" size={14} /> New tab
              </button>
              <button type="button" className="btn btn-quiet btn-small" aria-label="New private tab" onClick={() => newTab(true)}>
                <Icon name="eyeOff" size={14} /> Private
              </button>
              <button type="button" className="btn btn-primary btn-small" onClick={() => setPanel(null)}>
                Done
              </button>
            </div>
            <div className="browser-grid-tabs">
              {tabs.tabs.map((t) => (
                <div key={t.id} className={`browser-grid-tab${t.id === tabs.active ? " is-active" : ""}${t.private ? " is-private" : ""}`} {...drag(t.id)}>
                  <button type="button" className="browser-grid-open" onClick={() => switchTo(t.id)}>
                    <Icon name={t.private ? "eyeOff" : "globe"} size={22} />
                    <strong>{titleOf(t.title, t.url, t.private)}</strong>
                    <span className="muted">{t.private ? `Private${siteOf(t.url) ? ` · ${siteOf(t.url)}` : ""}` : siteOf(t.url)}</span>
                  </button>
                  <span className="browser-grid-more">
                    <Menu label={`More for ${titleOf(t.title, t.url, t.private)}`} trigger={<Icon name="moreVertical" size={16} />} items={tabMenu(t.id)} />
                  </span>
                  <button type="button" className="browser-tab-close" aria-label={`Close ${titleOf(t.title, t.url, t.private)}`} onClick={() => close(t.id)}>
                    <Icon name="close" size={14} />
                  </button>
                </div>
              ))}
            </div>
            {closedTabs.length > 0 && (
              <section className="browser-grid-closed" aria-labelledby="grid-closed">
                <h3 id="grid-closed">Recently closed</h3>
                <ClosedList closed={closedTabs} onReopen={(index) => reopen(1, index)} />
              </section>
            )}
          </div>
        )}
      </div>
      {panel === "bookmarks" && <BookmarksPanel onGo={(to) => (setPanel(null), go(to))} onClose={() => setPanel(null)} />}
      {panel === "reading" && <ReadingListPanel onOpenBook={onOpenBook} onClose={() => setPanel(null)} />}
      {panel === "site" && site && <SiteInfo url={url} actions={siteActions} />}
      {appLink && (
        <ConfirmDialog
          title="Open another app?"
          body={appLinkAsk(appLink)}
          confirm="Open"
          onCancel={() => setAppLink(null)}
          onConfirm={() => {
            const to = appLink;
            setAppLink(null);
            void api.browserOpenApp(to).catch((e: unknown) => toast(clean(e)));
          }}
        />
      )}
      {panel === "history" && <HistoryPanel onGo={(to) => (setPanel(null), go(to))} onClose={() => setPanel(null)} />}
      {panel === "downloads" && (
        <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && setPanel(null)}>
          <div className="dialog browser-downloads" role="dialog" aria-label="Downloads" onKeyDown={(e) => e.key === "Escape" && setPanel(null)}>
            <header className="catalogues-head">
              <h2>Downloads</h2>
              <button type="button" className="icon-btn" aria-label="Close" onClick={() => setPanel(null)}>
                <Icon name="close" size={18} />
              </button>
            </header>
            {fetched.length === 0 ? (
              <p className="muted">Files you download in Discover show here.</p>
            ) : (
              <ul className="browser-download-list">
                {fetched.map((d) => (
                  <li key={d.id}>
                    <Icon name="file" size={18} />
                    <span className="browser-download-name">
                      <b>{d.name}</b>
                      <span className="muted">
                        {downloadState(d)}
                        {d.at > 0 && d.state !== "coming" && ` · ${new Date(d.at).toLocaleDateString(undefined, { day: "numeric", month: "short" })}`}
                      </span>
                    </span>
                    {d.state === "coming" && (
                      <button
                        type="button"
                        className="btn btn-quiet btn-small"
                        onClick={() => {
                          void api.browserCancelDownload(d.id);
                          setFetched((list) => list.filter((x) => x.id !== d.id));
                        }}
                      >
                        Cancel
                      </button>
                    )}
                    {d.state === "failed" && d.url && (
                      <button type="button" className="btn btn-quiet btn-small" onClick={() => retry(d)}>
                        Retry
                      </button>
                    )}
                    {d.state === "added" && d.bookId && (
                      <>
                        <button type="button" className="btn btn-primary btn-small" onClick={() => void readNow(d)}>
                          Read now
                        </button>
                        <Menu
                          label={`More for ${d.name}`}
                          className="icon-btn"
                          trigger={<Icon name="moreVertical" size={16} />}
                          items={[{ label: "Send with Grimoire", icon: "upload", onSelect: () => void sendWithGrimoire(d) }]}
                        />
                      </>
                    )}
                    {d.asking && (
                      <>
                        <button type="button" className="btn btn-primary btn-small" onClick={() => void answer(d, "add")}>
                          Add
                        </button>
                        {!isIOS && (
                          <button type="button" className="btn btn-quiet btn-small" onClick={() => void answer(d, "keep")}>
                            Keep
                          </button>
                        )}
                      </>
                    )}
                    {d.state !== "coming" && (
                      <button type="button" className="icon-btn" aria-label={`Remove ${d.name} from the list`} onClick={() => (d.asking ? void answer(d, "drop") : setFetched((list) => list.filter((x) => x.id !== d.id)))}>
                        <Icon name="close" size={14} />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}


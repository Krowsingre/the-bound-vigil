import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { workspaceFrame, workspaceHost } from "../shell/workspaceFrame";
import { placeWorkspaceBrowser, workspaceOffset } from "./workspaceBrowser";
// Discover: a web browser inside TBV. Each tab's page shows in a view of its
// own laid over the space below the tab row (see src-tauri/src/browser.rs);
// this draws the tabs, the Downloads list and reader mode, and keeps the
// page's view in place. The top bar's search box is the address bar, with the
// page's buttons (back, forward, reload, home, bookmark, reader) beside it.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { api, isIOS, openExternal } from "../api";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { openContextMenu, openContextMenuAt } from "../components/ContextMenu";
import { Icon } from "../components/Icon";
import { Menu } from "../components/Menu";
import { useToast } from "../components/Toast";
import { askSendWithLocalSend } from "../localsend/SendWithLocalSend";
import { formatLabel } from "../lib/queryBooks";
import { useNarrow } from "../lib/useNarrow";
import { SplitDivider } from "./SplitDivider";
import { addressFor, desktopHosts, homeOf, isAddress, isStartPage, lowerFor, onBrowserPrefs, protectionOf, readableAddress, readBrowserPrefs, setSiteSettings, siteOf, siteSettings, START_PAGE, writeBrowserPrefs, } from "./browserPrefs";
import { closeOtherTabs, closeTab, closeTabs, duplicateTab, freshTabs, moveTab, newTabId, onClosedTabs, openTab, othersOf, pinTab, readClosedTabs, readTabs, rememberClosed, reopenTab, rightOf, takeClosed, updateTab, writeTabs, clearClosedTabs, restoreClosedTabs, } from "./browserTabs";
import { answerDownload, BOOK_FILE, downloadSource, downloadState, hasActiveTransfer, isActiveDownload, rememberDownloadSource, removeDownloads, setDownloads, useDownloads } from "./browserDownloads";
import { HAS_PIP, INSTALL_YOUTUBE_PIP, isYouTube, PAGE_REPORT, READ_SELECTION, REMOVE_FROM_PAGE } from "./pageTools";
import { requestAppHistory } from "../shell/navigationKeys";
import { addToHistory } from "./browserHistory";
import { HistoryPanel } from "./HistoryPanel";
import { onBrowserAsk } from "./browserAsk";
import { addToReadingList, bookIdOf } from "./readingList";
import { ClosedList } from "./ClosedList";
import { SiteInfo } from "./SiteInfo";
import { SessionsPanel, restoreSession } from "./SessionsPanel";
import { BookmarksPanel, ReadingListPanel } from "./StartPanels";
import { StartPage } from "./StartPage";
import { useTabDrag } from "./useTabDrag";
import { articleByline, articleEpub, articleFrom, cleanArticle, readerScript } from "./readerArticle";
/** The header's search box, on Discover, sends what's typed here. */
export const BROWSER_NEW = "tbv:browser-new";
export const BROWSER_GO = "tbv:browser-go";
/** Pages asked for from elsewhere in TBV (the reader's Search), opened as new tabs when Discover shows. */
const waiting = [];
const WAITING = "tbv:browser-waiting";
export function openInDiscover(url) {
    waiting.push(url);
    window.dispatchEvent(new Event(WAITING));
}
/** The page in front, told to the header so its search box can show the address. */
export const BROWSER_PAGE = "tbv:browser-page";
/** The top bar's buttons, on Discover, ask the browser here: "back", "forward", "reload", "stop", "home", "mark", "reader", "site" (the Site information sheet), or "travel:back|forward:x:y". */
const BROWSER_DO = "tbv:browser-do";
/** The address suggestions' "Switch to tab", with the tab's id. */
export const BROWSER_SWITCH = "tbv:browser-switch";
/** The page in front's state, told to the top bar's buttons. */
const BROWSER_STATE = "tbv:browser-state";
/** Book sites to start from, until you've bookmarked your own. */
export const SUGGESTED_SITES = [
    { title: "Project Gutenberg", url: "https://www.gutenberg.org/" },
    { title: "Internet Archive", url: "https://archive.org/details/texts" },
    { title: "Open Library", url: "https://openlibrary.org/" },
    { title: "Standard Ebooks", url: "https://standardebooks.org/" },
    { title: "Faded Page", url: "https://www.fadedpage.com/" },
    { title: "LibriVox (audiobooks)", url: "https://librivox.org/" },
];
const BAR_START = { busy: false, marked: false, bookmarks: [], reader: false, web: false, split: null };
let barNow = BAR_START;
/** TBV's pages Discover can sit beside. */
const SPLIT_ROUTES = [{ label: "Sanctum", route: "home" }, { label: "Archive", route: "library" }, { label: "Resonance", route: "audiobooks" },
    { label: "Scribe", route: "writing" }, { label: "Compendium", route: "collections" }, { label: "Preferences", route: "settings" }];
const ask = (what) => window.dispatchEvent(new CustomEvent(BROWSER_DO, { detail: what }));
/** Webpage Back/Forward when a control in TBV, rather than the native page, has focus. */
export const navigateBrowserHistory = (direction) => ask(direction);
/** Holding Back or Forward (or right-clicking it) lists the pages that way. */
function useTravel(way) {
    const timer = useRef(null);
    const swallowUntil = useRef(0);
    return {
        onContextMenu: (e) => {
            e.preventDefault();
            ask(`travel:${way}:${e.clientX}:${e.clientY}`);
        },
        onTouchStart: (e) => {
            const t = e.touches[0];
            if (!t)
                return;
            const [x, y] = [t.clientX, t.clientY];
            timer.current = window.setTimeout(() => {
                timer.current = null;
                swallowUntil.current = Date.now() + 800;
                ask(`travel:${way}:${x}:${y}`);
            }, 500);
        },
        onTouchEnd: () => {
            if (timer.current)
                window.clearTimeout(timer.current);
            timer.current = null;
        },
        onClickCapture: (e) => {
            // The press that opened the list doesn't also go back a page.
            if (Date.now() < swallowUntil.current) {
                swallowUntil.current = 0;
                e.preventDefault();
                e.stopPropagation();
            }
        },
    };
}
function BrowserBookmarks({ state, className }) {
    const sites = state.bookmarks.length ? state.bookmarks : SUGGESTED_SITES;
    const items = [
        { label: state.marked ? "Remove bookmark" : "Bookmark this page", icon: "bookmark", disabled: !state.web, onSelect: () => ask("mark") },
        { label: "Manage bookmarks", icon: "edit", onSelect: () => ask("bookmarks") },
        "divider",
        { heading: _jsx("strong", { children: state.bookmarks.length ? "Saved sites" : "Book sites to start with" }) },
        ...sites.map((site) => ({ label: site.title, icon: "globe", onSelect: () => ask("bookmark:" + site.url) })),
    ];
    return (_jsx(Menu, { label: state.marked ? "Bookmarks (page saved)" : "Bookmarks", className: className + (state.marked ? " browser-bookmark-saved" : ""), align: "start", trigger: _jsx(Icon, { name: "bookmark", size: 20 }), items: items }));
}
/**
 * The top bar's buttons on Discover, before the address: Back, Forward,
 * Reload, Home, Bookmark and Reader view. A phone has Home here and the rest
 * in the row under the bar.
 */
export function BrowserNav({ compact = false } = {}) {
    const narrow = useNarrow();
    const [state, setState] = useState(barNow);
    useEffect(() => {
        const heard = (e) => setState(e.detail);
        window.addEventListener(BROWSER_STATE, heard);
        return () => window.removeEventListener(BROWSER_STATE, heard);
    }, []);
    const back = useTravel("back");
    const forward = useTravel("forward");
    const button = (label, icon, what, more = {}) => (_jsx("button", { type: "button", className: "header-action", "aria-label": label, title: label, onClick: () => ask(what), ...more, children: _jsx(Icon, { name: icon, size: 20 }) }));
    if (narrow)
        return button("Home page", "home", "home");
    return (_jsxs("div", { className: "browser-nav", children: [button("Back", "arrowLeft", "back", back), button("Forward", "arrowRight", "forward", forward), button(state.busy ? "Stop" : "Reload", state.busy ? "close" : "sync", state.busy ? "stop" : "reload"), !compact && button("Home page", "home", "home"), !compact && _jsx(BrowserBookmarks, { state: state, className: "header-action" }), !compact && button("Sessions", "list", "sessions"), !compact && state.split && (state.split.on
                ? button("Close split screen", "splitScreen", "unsplit", { "aria-pressed": true, className: "header-action is-on" })
                : _jsx(Menu, { label: "Split screen", className: "header-action", trigger: _jsx(Icon, { name: "splitScreen", size: 20 }), items: state.split.choices.length ? state.split.choices.map((c) => (c.id === "divider" ? "divider" : { label: c.label, onSelect: () => ask(`split:${c.id}`) })) : [{ label: "Open another tab to split with", disabled: true, onSelect: () => undefined }] })), !compact && button("Reader view", "bookOpen", "reader", { disabled: !state.web && !state.reader, "aria-pressed": state.reader, className: `header-action${state.reader ? " is-on" : ""}` })] }));
}
/**
 * Inside the left of the address, where the magnifier sits on other pages: a
 * lock for a secure page, a warning for one that isn't, opening the Site
 * information sheet.
 */
export function BrowserSiteButton({ url }) {
    const web = /^https?:/i.test(url);
    if (!web)
        return _jsx(Icon, { name: url ? "compass" : "search", size: 18 });
    const secure = /^https:/i.test(url);
    return (_jsx("button", { type: "button", className: `search-action browser-site${secure ? "" : " is-unsafe"}`, onPointerDown: (e) => e.preventDefault(), "aria-label": secure ? "Secure connection: about this site" : "Not secure: about this site", title: "About this site", onClick: () => window.dispatchEvent(new CustomEvent(BROWSER_DO, { detail: "site" })), children: _jsx(Icon, { name: secure ? "lock" : "warning", size: 17 }) }));
}
/** What a link for another app will do, for asking first. */
export function appLinkAsk(url) {
    const [scheme, ...rest] = url.split(":");
    const raw = rest.join(":").replace(/^\/\//, "").split("?")[0];
    let what = raw;
    try {
        what = decodeURIComponent(raw);
    }
    catch {
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
const fileTitle = (url) => {
    try {
        const name = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "");
        return name.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ").trim() || "A book from the web";
    }
    catch {
        return "A book from the web";
    }
};
/** Whether Discover has opened since TBV started, for starting afresh after closing TBV. */
let openedThisRun = false;
/** Tabs whose page view has been made. The views stay open while Discover
 * is left (unless Preferences says to start afresh), so this outlives the
 * page: coming back shows them as they were instead of loading them again. */
const madeViews = new Set();
const releasingViews = new Set();
function releaseView(id) {
    if (releasingViews.has(id))
        return;
    releasingViews.add(id);
    const tryClose = async () => {
        const pip = await api.browserRead(id, HAS_PIP).catch(() => false);
        if (pip === true || hasActiveTransfer(id)) {
            window.setTimeout(() => void tryClose(), 1500);
            return;
        }
        madeViews.delete(id);
        rememberDownloadSource(id, undefined);
        try {
            await api.browserAct(id, "close");
        }
        catch {
            // The native view may have closed itself.
        }
        finally {
            releasingViews.delete(id);
        }
    };
    void tryClose();
}
/** The tabs Discover opens with, as chosen in Preferences › Discover. */
function startingTabs() {
    const prefs = readBrowserPrefs();
    const home = homeOf(prefs);
    const first = !openedThisRun;
    openedThisRun = true;
    if (!(prefs.comeBack === "leave" || (prefs.comeBack === "close" && first)))
        return readTabs(home);
    // Pages kept from before (when the choice was still to keep them) would
    // otherwise go on without a tab to close them by.
    if (!first)
        for (const t of readTabs(home).tabs) {
            releaseView(t.id);
        }
    return freshTabs(home);
}
const titleOf = (title, url, privately = false) => (isStartPage(url) ? (privately ? "Private tab" : "Start page") : title?.trim() || siteOf(url) || url);
/** Pauses every video and sound on a page, for leaving Discover. */
const PAUSE_ALL = `(function () {
  document.querySelectorAll("video, audio").forEach(function (m) {
    if (m !== document.pictureInPictureElement && m.webkitPresentationMode !== "picture-in-picture") {
      try { m.pause(); } catch (e) {}
    }
  });
  return JSON.stringify(null);
})()`;
/** Something on top (a menu, a dialog, the phone's menu of pages) would be hidden under the page, so the page steps aside. */
const covered = () => !!document.querySelector(".dialog-backdrop, [role=menu], [role=alertdialog], .sidebar-backdrop, .address-suggestions, dialog[open], .split-resizing");
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
const clean = (e) => String(e).replace(/^Error: /, "");
export function Browser({ onOpenCatalogues, onOpenBook, search, onSearchChange, allowSplit, companion, onSplitWith, }) {
    const narrow = useNarrow();
    const [tabs, setTabs] = useState(startingTabs);
    const [pair, setPair] = useState(null);
    const [ratio, setRatio] = useState(50);
    const companionRef = useRef(companion);
    companionRef.current = companion;
    const secondary = useRef(null);
    const activate = useRef(() => undefined);
    const [loading, setLoading] = useState({});
    const [marks, setMarks] = useState([]);
    const fetched = useDownloads();
    const [panel, setPanel] = useState(null);
    const [tabSearch, setTabSearch] = useState("");
    useEffect(() => { if (panel !== "tabs")
        setTabSearch(""); }, [panel]);
    /** Pages that couldn't open, by tab: TBV's own page says why. */
    const [failed, setFailed] = useState({});
    const failedRef = useRef(failed);
    failedRef.current = failed;
    /** Tabs just closed, for the Undo line. */
    const [closedTabs, setClosedTabs] = useState(readClosedTabs);
    /** A link for another app, waiting for an answer. */
    const [redirects, setRedirects] = useState([]);
    const [appLink, setAppLink] = useState(null);
    const [finding, setFinding] = useState(null);
    const [article, setArticle] = useState(null);
    const [saving, setSaving] = useState(false);
    const [prefs, setPrefs] = useState(readBrowserPrefs);
    const [problem, setProblem] = useState(null);
    const area = useRef(null);
    const made = useRef(madeViews);
    const preparing = useRef(new Map());
    const mounted = useRef(true);
    useEffect(() => {
        mounted.current = true;
        return () => void (mounted.current = false);
    }, []);
    const tabsRef = useRef(tabs);
    tabsRef.current = tabs;
    const refit = useRef(() => undefined);
    const heardAsk = useRef(() => undefined);
    /** A tab shortcut, pressed in TBV or (on Windows) while a page had the keyboard. */
    // The tabs open here go to the other devices (when Discover history syncs),
    // never private ones; theirs show under Every tab and in the tab grid.
    const [otherTabs, setOtherTabs] = useState([]);
    const sharedTabs = JSON.stringify(companion || workspaceFrame ? null
        : tabs.tabs.filter((t) => !t.private && /^https?:\/\//i.test(t.url)).map((t) => ({ url: t.url, title: t.title })));
    useEffect(() => {
        const list = JSON.parse(sharedTabs);
        if (!list)
            return;
        const wait = window.setTimeout(() => void api.setBrowserOpenTabs(list).catch(() => undefined), 2000);
        return () => window.clearTimeout(wait);
    }, [sharedTabs]);
    useEffect(() => {
        const look = () => void api.browserOtherTabs().then(setOtherTabs, () => undefined);
        look();
        const every = window.setInterval(look, 60_000);
        window.addEventListener("focus", look);
        return () => {
            window.clearInterval(every);
            window.removeEventListener("focus", look);
        };
    }, []);
    const shortcut = useRef(() => undefined);
    // A private tab in front: TBV's top bar takes the private look too (browse.css).
    const privateInFront = !companion && !!tabs.tabs.find((t) => t.id === tabs.active)?.private;
    useEffect(() => {
        const root = document.documentElement;
        if (privateInFront)
            root.dataset.discoverPrivate = "";
        else
            delete root.dataset.discoverPrivate;
        return () => void delete root.dataset.discoverPrivate;
    }, [privateInFront]);
    const toast = useToast();
    const active = tabs.tabs.find((t) => t.id === tabs.active) ?? tabs.tabs[0];
    const url = active?.url ?? "";
    const other = allowSplit && !companion && pair?.other !== active.id
        ? tabs.tabs.find((tab) => tab.id === pair?.other) : undefined;
    const otherRef = useRef(other);
    otherRef.current = other;
    useEffect(() => {
        if (pair && (pair.other === active.id || !tabs.tabs.some((tab) => tab.id === pair.other)))
            setPair(null);
    }, [pair, active.id, tabs.tabs]);
    const onStart = isStartPage(url);
    const failure = onStart ? null : failed[active.id] ?? null;
    /** Reader mode, the tab grid, the start page and the error page cover the page, so the page's view steps aside. */
    const aside = useRef(false);
    aside.current = !!article || panel === "tabs" || onStart || !!failure;
    useEffect(() => writeTabs(tabs), [tabs]);
    useEffect(() => onClosedTabs(() => setClosedTabs(readClosedTabs())), []);
    // A tab that's gone (the oldest, past the most kept) has its page closed too.
    useEffect(() => {
        for (const id of [...made.current]) {
            if (tabs.tabs.some((t) => t.id === id))
                continue;
            made.current.delete(id);
            void api.browserAct(id, "close");
        }
    }, [tabs.tabs]);
    useEffect(() => onBrowserPrefs(() => setPrefs(readBrowserPrefs())), []);
    /** The zoom each tab's page has now, so it's changed only when its site wants another. */
    const zoomed = useRef({});
    const fitZoom = useCallback((tab, at) => {
        if (!/^https?:/i.test(at) || !made.current.has(tab))
            return;
        const want = siteSettings(siteOf(at)).zoom ?? 1;
        if ((zoomed.current[tab] ?? 1) === want)
            return;
        zoomed.current[tab] = want;
        void api.browserZoom(tab, want).catch(() => undefined);
    }, []);
    // A site's zoom changed in its sheet, or was reset in Preferences.
    useEffect(() => {
        for (const t of tabsRef.current.tabs)
            fitZoom(t.id, t.url);
    }, [prefs.sites, fitZoom]);
    // iPhone and iPad: the sites shown in their computer version.
    const desktopList = desktopHosts(prefs).join("\n");
    useEffect(() => {
        if (isIOS)
            void api.browserDesktopSites(desktopList ? desktopList.split("\n") : []).catch(() => undefined);
    }, [desktopList]);
    // The top bar shows the address of the page in front.
    useEffect(() => {
        window.dispatchEvent(new CustomEvent(BROWSER_PAGE, { detail: isStartPage(url) ? "" : url }));
    }, [url]);
    useEffect(() => () => void window.dispatchEvent(new CustomEvent(BROWSER_PAGE, { detail: "" })), []);
    const frame = (element = area.current) => {
        const r = element?.getBoundingClientRect();
        const offset = workspaceOffset();
        return r && r.width > 0 && r.height > 0 ? { x: r.left + offset.x, y: r.top + offset.y, width: r.width, height: r.height } : null;
    };
    const prepareTab = useCallback((id, url, privately, at = frame()) => {
        if (!at || !/^https?:/i.test(url))
            return;
        const waiting = preparing.current.get(id);
        if (waiting)
            return waiting;
        if (made.current.has(id))
            return;
        const task = new Promise((resolve) => requestAnimationFrame(() => resolve()))
            .then(() => {
            if (mounted.current && tabsRef.current.tabs.some((tab) => tab.id === id)) {
                return api.browserShow(id, url, at, protectionOf(readBrowserPrefs()), privately, true);
            }
        })
            .then(() => {
            if (mounted.current && tabsRef.current.tabs.some((tab) => tab.id === id)) {
                made.current.add(id);
                fitZoom(id, url);
            }
            else
                void api.browserAct(id, "close").catch(() => undefined);
        })
            .finally(() => preparing.current.delete(id));
        preparing.current.set(id, task);
        return task;
    }, [fitZoom]);
    const reloadMarks = useCallback(() => api.bookmarks().then(setMarks, () => undefined), []);
    useEffect(() => void reloadMarks(), [reloadMarks]);
    const downloadTrigger = useRef(null);
    const downloadClose = useRef(null);
    useEffect(() => {
        if (panel !== "downloads")
            return;
        const previous = document.activeElement;
        downloadClose.current?.focus();
        return () => {
            if (previous instanceof HTMLElement && previous.isConnected)
                previous.focus();
            else
                downloadTrigger.current?.focus();
        };
    }, [panel]);
    const removeDownloadRows = async (ids, from) => {
        const dialog = from.closest(".browser-downloads");
        const previous = Array.from(dialog?.querySelectorAll("[data-remove-download]") ?? []);
        const index = previous.indexOf(from);
        await removeDownloads(ids, toast);
        requestAnimationFrame(() => {
            if (!dialog?.isConnected || (from.isConnected && !from.matches(":disabled")))
                return;
            if (document.activeElement !== document.body && document.activeElement !== from)
                return;
            const buttons = dialog.querySelectorAll("[data-remove-download]");
            (buttons[Math.min(Math.max(index, 0), buttons.length - 1)] ?? downloadClose.current)?.focus();
        });
    };
    const answer = (d, how) => answerDownload(d, how, toast);
    // What the tabs did.
    useEffect(() => {
        const heard = (ev) => {
            const owner = ev.kind === "newTab" ? ev.from : "tab" in ev ? ev.tab : null;
            if (!owner || !tabsRef.current.tabs.some((tab) => tab.id === owner))
                return;
            switch (ev.kind) {
                case "page": {
                    setLoading((l) => ({ ...l, [ev.tab]: ev.loading }));
                    // Loading again (Try again, or another page): the error page goes.
                    if (ev.loading)
                        setFailed((f) => (f[ev.tab] ? Object.fromEntries(Object.entries(f).filter(([t]) => t !== ev.tab)) : f));
                    fitZoom(ev.tab, ev.url);
                    // Chosen in Preferences › Discover: each page visited goes in History (not from a private tab).
                    const keep = readBrowserPrefs();
                    const privately = !!tabsRef.current.tabs.find((t) => t.id === ev.tab)?.private;
                    if (!ev.loading && !privately)
                        rememberDownloadSource(ev.tab, ev.url);
                    if (!ev.loading && isYouTube(ev.url))
                        void api.browserRead(ev.tab, INSTALL_YOUTUBE_PIP).catch(() => undefined);
                    if (!ev.loading && !privately && keep.historyOn && /^https?:/i.test(ev.url))
                        addToHistory({ kind: "page", url: ev.url, title: ev.title ?? null }, keep.historyKeep);
                    if (/^https?:/i.test(ev.url)) {
                        setTabs((s) => {
                            const before = s.tabs.find((t) => t.id === ev.tab);
                            // Gone home to the start page while this page was still coming: it stays there.
                            if (before && isStartPage(before.url))
                                return s;
                            const title = ev.title ?? (before?.url === ev.url ? before.title : null);
                            return updateTab(s, ev.tab, { url: ev.url, title });
                        });
                    }
                    break;
                }
                case "newTab": {
                    const id = ev.tab ?? newTabId();
                    // On iPhone a pop-up's view is made already, still joined to its page.
                    if (ev.tab)
                        made.current.add(id);
                    // Opened from a private tab, it's private too.
                    const privately = !!tabsRef.current.tabs.find((t) => t.id === ev.from)?.private;
                    if (!privately)
                        rememberDownloadSource(id, downloadSource(ev.from));
                    setTabs((s) => openTab(s, { id, url: /^https?:/i.test(ev.url) ? ev.url : homeOf(), title: null, private: privately || undefined }, !ev.foreground, ev.from));
                    if (!ev.tab && !ev.foreground)
                        void prepareTab(id, ev.url, privately)?.catch(() => undefined);
                    break;
                }
                case "downloadStart":
                    setLoading((loading) => ({ ...loading, [ev.tab]: false }));
                    break;
                case "failed":
                    setLoading((loading) => ({ ...loading, [ev.tab]: false }));
                    setFailed((f) => ({ ...f, [ev.tab]: { url: ev.url, reason: ev.reason } }));
                    if (/^https?:/i.test(ev.url))
                        setTabs((s) => updateTab(s, ev.tab, { url: ev.url }));
                    break;
                case "redirect":
                    setLoading((loading) => ({ ...loading, [ev.tab]: false }));
                    if (ev.ask)
                        setRedirects((pending) => [...pending.filter((item) => item.tab !== ev.tab), ev]);
                    else
                        toast("Redirect blocked from " + (siteOf(ev.from) ?? "this site") + ".");
                    break;
                case "popupBlocked": {
                    const from = siteOf(tabsRef.current.tabs.find((t) => t.id === ev.tab)?.url ?? "") ?? "this site";
                    // A site on the block lists stays shut; one opened without a click can still be opened by hand.
                    if (ev.listed)
                        toast(`Blocked a pop-up from ${from} to a site on the block lists.`);
                    else
                        toast(`Blocked a pop-up from ${from}.`, /^https?:/i.test(ev.url) ? { label: "Open it", run: () => openInNewTabRef.current(ev.url, false) } : undefined);
                    break;
                }
                case "external":
                    if (readBrowserPrefs().askApps)
                        setAppLink(ev.url);
                    else
                        void api.browserOpenApp(ev.url).catch((e) => toast(clean(e)));
                    break;
                case "menu":
                    if (!/^https?:/i.test(ev.url))
                        break;
                    if (ev.action === "newTab") {
                        const privately = !!tabsRef.current.tabs.find((t) => t.id === ev.tab)?.private;
                        const id = newTabId();
                        if (!privately)
                            rememberDownloadSource(id, downloadSource(ev.tab));
                        setTabs((s) => openTab(s, { id, url: ev.url, title: null, private: privately || undefined }, true, ev.tab));
                        void prepareTab(id, ev.url, privately)?.catch(() => undefined);
                    }
                    else {
                        void api.downloadWebBook(ev.url, fileTitle(ev.url), downloadSource(ev.tab, ev.url)).then(() => toast("It's being added to your library."), (e) => toast(clean(e)));
                    }
                    break;
                case "focus":
                    if (otherRef.current?.id === ev.tab && !covered())
                        activate.current(ev.tab);
                    break;
                case "key":
                    if (ev.key === "appBack" || ev.key === "appForward")
                        requestAppHistory(ev.key === "appBack" ? "back" : "forward");
                    else if (ev.key === "pageBack" || ev.key === "pageForward")
                        travelRef.current(ev.key === "pageBack" ? "back" : "forward", ev.tab);
                    else {
                        if (otherRef.current?.id === ev.tab && !covered())
                            activate.current(ev.tab);
                        shortcut.current(ev.key);
                    }
                    break;
                case "closed":
                    releaseView(ev.tab);
                    setTabs((s) => closeTab(s, ev.tab, homeOf()));
                    break;
            }
        };
        return api.onBrowserEvent(heard);
    }, [fitZoom, toast]);
    // Apply one visible set at a time. Late preparations never put a page over a dialog.
    useEffect(() => {
        let live = true;
        let frameRequest = 0;
        let running = false;
        let pending = false;
        let placed = "";
        const stopAsks = onBrowserAsk((ask) => heardAsk.current(ask));
        const visible = () => {
            if (covered() || workspaceOffset().resizing)
                return [];
            const state = tabsRef.current;
            const front = state.tabs.find((tab) => tab.id === state.active);
            const panes = [];
            const main = frame();
            if (front && main && !aside.current && /^https?:/i.test(front.url))
                panes.push({ tab: front.id, frame: main });
            const back = otherRef.current;
            const second = frame(secondary.current);
            if (back && second && back.id !== front?.id && !failedRef.current[back.id] && /^https?:/i.test(back.url)) {
                panes.push({ tab: back.id, frame: second });
            }
            return panes;
        };
        const fit = async () => {
            if (!live)
                return;
            if (running) {
                pending = true;
                return;
            }
            running = true;
            try {
                const panes = visible();
                const id = tabsRef.current.active;
                const key = JSON.stringify([id, panes]);
                if (key === placed)
                    return;
                const needed = panes.filter((pane) => !made.current.has(pane.tab));
                if (needed.length) {
                    await placeWorkspaceBrowser(panes.filter((pane) => made.current.has(pane.tab)), id);
                    await Promise.all(needed.map((pane) => {
                        const tab = tabsRef.current.tabs.find((item) => item.id === pane.tab);
                        return tab && prepareTab(tab.id, tab.url, !!tab.private, pane.frame);
                    }));
                }
                if (!live)
                    return;
                const current = visible().filter((pane) => made.current.has(pane.tab));
                const activeTab = tabsRef.current.active;
                placed = JSON.stringify([activeTab, current]);
                await placeWorkspaceBrowser(current, activeTab);
            }
            catch (error) {
                if (live)
                    setProblem(clean(error));
            }
            finally {
                running = false;
                if (!live)
                    void placeWorkspaceBrowser([], "").catch(() => undefined);
                else if (pending) {
                    pending = false;
                    schedule();
                }
            }
        };
        const schedule = () => {
            cancelAnimationFrame(frameRequest);
            frameRequest = requestAnimationFrame(() => void fit());
        };
        refit.current = schedule;
        const resized = new ResizeObserver(schedule);
        if (area.current)
            resized.observe(area.current);
        if (document.documentElement.classList.contains("tbv-workspace-frame") && window.frameElement)
            resized.observe(window.frameElement);
        const watching = new MutationObserver(schedule);
        watching.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["open", "class"] });
        workspaceHost.addEventListener("tbv:workspace-layout", schedule);
        window.addEventListener("resize", schedule);
        window.addEventListener("scroll", schedule, true);
        window.visualViewport?.addEventListener("resize", schedule);
        schedule();
        return () => {
            live = false;
            stopAsks();
            refit.current = () => undefined;
            cancelAnimationFrame(frameRequest);
            resized.disconnect();
            watching.disconnect();
            workspaceHost.removeEventListener("tbv:workspace-layout", schedule);
            window.removeEventListener("resize", schedule);
            window.removeEventListener("scroll", schedule, true);
            window.visualViewport?.removeEventListener("resize", schedule);
            void placeWorkspaceBrowser([], "").catch(() => undefined);
            if (readBrowserPrefs().comeBack === "leave") {
                for (const id of made.current)
                    releaseView(id);
            }
            else if (!readBrowserPrefs().keepPlaying) {
                for (const id of made.current)
                    void api.browserRead(id, PAUSE_ALL).catch(() => undefined);
            }
        };
    }, [prepareTab]);
    useEffect(() => refit.current(), [tabs.active, url, article, panel, !!failure, other, ratio, companion]);
    const act = (action) => {
        if (action === "back" || action === "forward")
            return travelRef.current(action, active.id);
        if (action === "stop")
            setLoading((loading) => ({ ...loading, [active.id]: false }));
        void api.browserAct(active.id, action).catch(() => undefined);
    };
    /** The pages behind or ahead, listed to jump to one. */
    const showTravel = (way, x, y) => {
        const tab = active.id;
        if (!made.current.has(tab))
            return;
        void api.browserTravelled(tab).then((pages) => {
            const list = pages[way].slice(0, 15);
            if (!list.length)
                return;
            openContextMenuAt(x, y, way === "back" ? "Pages behind" : "Pages ahead", list.map((p, i) => ({
                label: p.title.trim() || readableAddress(p.url),
                icon: "globe",
                hint: siteOf(p.url) ?? undefined,
                onSelect: () => void api.browserRead(tab, `(function () { history.go(${(way === "back" ? -1 : 1) * (p.step ?? i + 1)}); return JSON.stringify(null); })()`).catch(() => undefined),
            })));
        }, () => undefined);
    };
    const go = (text) => {
        const prefsNow = readBrowserPrefs();
        const to = addressFor(text, prefsNow.search);
        if (!to)
            return;
        // Words rather than an address: a search, kept in History if chosen.
        if (prefsNow.historyOn && prefsNow.historySearches && !isAddress(text) && !tabsRef.current.tabs.find((t) => t.id === tabsRef.current.active)?.private)
            addToHistory({ kind: "search", url: to, title: text.trim() }, prefsNow.historyKeep);
        setArticle(null);
        const from = tabsRef.current.tabs.find((t) => t.id === tabsRef.current.active);
        if (from && isStartPage(from.url)) {
            startBehind.current.add(from.id);
            aheadOfStart.current.delete(from.id);
        }
        setTabs((s) => updateTab(s, s.active, { url: to, title: null }));
        if (made.current.has(tabsRef.current.active))
            void api.browserAct(tabsRef.current.active, "go", to).catch((e) => toast(String(e)));
        else
            refit.current();
    };
    const goRef = useRef(go);
    goRef.current = go;
    /**
     * The start page counts as a page in a tab's history: Back from the first
     * website after it shows the start page again, and Forward from there goes
     * back to that website (as it was, not loaded again).
     */
    const startBehind = useRef(new Set());
    const aheadOfStart = useRef(new Map());
    const travelRef = useRef(() => undefined);
    travelRef.current = (way, id) => {
        const tab = tabsRef.current.tabs.find((t) => t.id === id);
        if (!tab)
            return;
        const native = () => void api.browserAct(id, way).catch(() => undefined);
        if (way === "forward") {
            const ahead = aheadOfStart.current.get(id);
            if (!isStartPage(tab.url) || !ahead)
                return native();
            aheadOfStart.current.delete(id);
            setTabs((s) => updateTab(s, id, { url: ahead.url, title: ahead.title }));
            return;
        }
        if (isStartPage(tab.url) || !startBehind.current.has(id) || !made.current.has(id))
            return native();
        void api.browserTravelled(id).then((pages) => {
            // Only a web view that lists its history can say this is the first page.
            if (pages.back.length || pages.known === false)
                return native();
            aheadOfStart.current.set(id, { url: tab.url, title: tab.title });
            void api.browserAct(id, "stop").catch(() => undefined);
            void api.browserRead(id, PAUSE_ALL).catch(() => undefined);
            if (id === tabsRef.current.active) {
                setArticle(null);
                setPanel(null);
            }
            setTabs((s) => updateTab(s, id, { url: START_PAGE, title: null }));
        }, native);
    };
    useEffect(() => {
        const fromHeader = (e) => goRef.current(e.detail);
        window.addEventListener(BROWSER_GO, fromHeader);
        return () => window.removeEventListener(BROWSER_GO, fromHeader);
    }, []);
    const newTab = (privately = false, beside) => {
        setArticle(null);
        setPanel(null);
        setTabs((s) => openTab(s, { id: newTabId(), url: "tbv:start", title: null, private: privately || undefined }, false, beside));
        onSearchChange("");
        const input = document.getElementById(companionRef.current ? "discover-split-search" : "global-search");
        if (input) {
            input.dataset.blankTab = "";
            input.focus();
            delete input.dataset.blankTab;
        }
    };
    /**
     * A page in a tab of its own, from the start page's ⋮ menus. Opened from a
     * private tab, it's private too (`fromOutside`: asked by another TBV page, never private).
     */
    const openInNewTab = (to, background = true, fromOutside = false) => {
        if (!background) {
            setArticle(null);
            setPanel(null);
        }
        const now = tabsRef.current;
        const privately = !fromOutside && !!now.tabs.find((t) => t.id === now.active)?.private;
        const id = newTabId();
        setTabs((s) => openTab(s, { id, url: to, title: null, private: privately || undefined }, background));
        if (background)
            void prepareTab(id, to, privately)?.catch(() => undefined);
    };
    const openInNewTabRef = useRef(openInNewTab);
    openInNewTabRef.current = openInNewTab;
    /** Home: the start page (with the page left as it was, quiet), or the home page website. */
    const goHome = () => {
        const prefsNow = readBrowserPrefs();
        if (!prefsNow.startPage)
            return go(prefsNow.home);
        setArticle(null);
        setPanel(null);
        const id = tabsRef.current.active;
        if (made.current.has(id)) {
            void api.browserAct(id, "stop").catch(() => undefined);
            void api.browserRead(id, PAUSE_ALL).catch(() => undefined);
        }
        setTabs((s) => updateTab(s, s.active, { url: START_PAGE, title: null }));
    };
    const openNewRef = useRef(openInNewTab);
    openNewRef.current = openInNewTab;
    useEffect(() => {
        const open = (e) => openNewRef.current(e.detail, false, true);
        window.addEventListener(BROWSER_NEW, open);
        return () => window.removeEventListener(BROWSER_NEW, open);
    }, []);
    useEffect(() => {
        const drain = () => {
            for (let url = waiting.shift(); url; url = waiting.shift())
                openNewRef.current(url, false, true);
        };
        drain();
        window.addEventListener(WAITING, drain);
        return () => window.removeEventListener(WAITING, drain);
    }, []);
    const switchTo = (id) => {
        const previous = tabsRef.current.active;
        if (id !== previous && otherRef.current?.id === id) {
            setPair((current) => current && { other: previous, activeLeft: !current.activeLeft });
        }
        setArticle(null);
        setPanel(null);
        onSearchChange("");
        tabsRef.current = { ...tabsRef.current, active: id };
        setTabs((s) => ({ ...s, active: id }));
    };
    activate.current = switchTo;
    const tabQuery = tabSearch.trim().toLowerCase();
    const matchingTabs = tabs.tabs.filter((tab) => !tabQuery || [titleOf(tab.title, tab.url, tab.private), siteOf(tab.url), tab.url]
        .some((value) => value?.toLowerCase().includes(tabQuery)));
    const splitWithTab = (id) => {
        if (id === tabsRef.current.active)
            return;
        setPair((current) => ({ other: id, activeLeft: current?.activeLeft ?? true }));
    };
    const drag = useTabDrag((id, onto) => setTabs((s) => moveTab(s, id, onto)));
    /** Closes tabs' pages; the tabs are remembered for Reopen closed tab. */
    const forget = (ids) => {
        rememberClosed(tabsRef.current, ids);
        for (const id of ids) {
            delete zoomed.current[id];
            if (hasActiveTransfer(id))
                releaseView(id);
            else {
                made.current.delete(id);
                rememberDownloadSource(id, undefined);
                void api.browserAct(id, "close");
            }
        }
        setFailed((f) => Object.fromEntries(Object.entries(f).filter(([t]) => !ids.includes(t))));
    };
    const close = (id) => {
        forget([id]);
        setTabs((s) => closeTab(s, id, homeOf()));
    };
    const closeOthers = (id) => {
        setArticle(null);
        forget(othersOf(tabsRef.current, id));
        setTabs((s) => closeOtherTabs(s, id));
    };
    const closeRight = (id) => {
        const ids = rightOf(tabsRef.current, id);
        forget(ids);
        setTabs((s) => closeTabs(s, ids, id));
    };
    const duplicate = (id) => {
        setArticle(null);
        setPanel(null);
        setTabs((s) => duplicateTab(s, id));
    };
    /** Opens closed tabs again, back where they were: the last `count`, or the one at `index` in the list. */
    /**
     * What this tab's page did lately, as TBV and the page itself saw it, copied
     * to paste into a message when a button or link doesn't work.
     */
    const copyPageReport = async (tab) => {
        const [native, page] = await Promise.all([
            api.browserReport(tab).catch(() => []),
            api.browserRead(tab, PAGE_REPORT).then((r) => (typeof r === "string" ? JSON.parse(r) : r)).catch(() => null),
        ]);
        const text = [
            `TBV ${navigator.userAgent}`,
            `Protection: ${readBrowserPrefs().protection}, redirects: ${readBrowserPrefs().redirects}`,
            "",
            "What TBV saw:",
            ...(native.length ? native : ["(nothing)"]),
            "",
            `What the page did${page ? ` (${page.address})` : ""}:`,
            ...(page?.lines.length ? page.lines : ["(nothing, or the page doesn't allow it)"]),
        ].join("\n");
        try {
            await navigator.clipboard.writeText(text);
            toast("Page report copied. Paste it into a message.");
        }
        catch {
            toast("Copying isn't available here.");
        }
    };
    /** Empties Recently closed, with an Undo. */
    const clearClosedWithUndo = () => {
        const was = readClosedTabs();
        clearClosedTabs(null);
        toast("Recently closed tabs cleared.", { label: "Undo", run: () => restoreClosedTabs(was) });
    };
    const reopen = (count = 1, index) => {
        const back = [];
        for (let i = 0; i < count; i++) {
            const taken = takeClosed(index ?? 0);
            if (taken)
                back.push(taken);
        }
        if (!back.length)
            return;
        setArticle(null);
        setPanel(null);
        setTabs((s) => back.sort((a, b) => a.at - b.at).reduce(reopenTab, s));
    };
    const tabMenu = (id) => {
        const tab = tabsRef.current.tabs.find((t) => t.id === id);
        const web = /^https?:/i.test(tab?.url ?? "");
        return [
            // Private tabs aren't kept, so they can't stay pinned through a restart.
            tab?.pinned
                ? { label: "Unpin tab", icon: "pin", onSelect: () => setTabs((s) => pinTab(s, id, false)) }
                : { label: "Pin tab", icon: "pin", disabled: !!tab?.private, onSelect: () => setTabs((s) => pinTab(s, id, true)) },
            { label: "Close tab", icon: "close", onSelect: () => close(id) },
            { label: "Duplicate tab", icon: "copy", disabled: !web, onSelect: () => duplicate(id) },
            "divider",
            { label: "Close tabs to the right", icon: "close", disabled: !rightOf(tabsRef.current, id).length, onSelect: () => closeRight(id) },
            { label: "Close other tabs", icon: "layers", disabled: !othersOf(tabsRef.current, id).length, onSelect: () => closeOthers(id) },
        ];
    };
    shortcut.current = (key) => {
        const list = tabsRef.current.tabs;
        const at = list.findIndex((t) => t.id === tabsRef.current.active);
        if (key === "focusAddress")
            document.getElementById(companionRef.current ? "discover-split-search" : "global-search")?.focus();
        else if (key === "refreshApp")
            void workspaceHost.tbvWorkspace?.refresh?.();
        else if (key === "newTab")
            newTab();
        else if (key === "newPrivateTab")
            newTab(true);
        else if (key === "closeTab")
            close(tabsRef.current.active);
        else if (key === "reopenTab")
            reopen();
        else if (key === "bookmarkPage") {
            if (!covered() && /^https?:/i.test(list[at]?.url ?? ""))
                setPanel("bookmark-page");
        }
        else if (list.length > 1 && (key === "nextTab" || key === "previousTab"))
            switchTo(list[(at + (key === "nextTab" ? 1 : list.length - 1)) % list.length].id);
    };
    // Ctrl+T, Ctrl+W, Ctrl+Tab, Ctrl+Shift+Tab, Ctrl+Shift+T and Ctrl+Alt+T, as in other browsers.
    useEffect(() => {
        const down = (e) => {
            if (document.querySelector(".dialog-backdrop, dialog[open], [role=alertdialog]"))
                return;
            const inCompanion = companionRef.current && e.target instanceof Element && e.target.closest(".discover-workspace-pane");
            if (companionRef.current && !inCompanion)
                return;
            if (inCompanion && e.altKey && !e.shiftKey && !e.ctrlKey && !e.metaKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
                e.preventDefault();
                travelRef.current(e.key === "ArrowLeft" ? "back" : "forward", tabsRef.current.active);
                return;
            }
            // Ctrl+Alt+T (Cmd+Option+T on a Mac): a new private tab. (e.code, since Option changes the letter on a Mac.)
            if ((e.ctrlKey || e.metaKey) && e.altKey && !e.shiftKey && e.code === "KeyT") {
                e.preventDefault();
                shortcut.current("newPrivateTab");
                return;
            }
            if (!(e.ctrlKey || e.metaKey) || e.altKey)
                return;
            const k = e.key.toLowerCase();
            const what = k === "t" ? (e.shiftKey ? "reopenTab" : "newTab") : k === "w" && !e.shiftKey ? "closeTab" : k === "d" && !e.shiftKey ? "bookmarkPage" : e.key === "Tab" ? (e.shiftKey ? "previousTab" : "nextTab") : null;
            if (!what)
                return;
            e.preventDefault();
            shortcut.current(what);
        };
        window.addEventListener("keydown", down);
        return () => window.removeEventListener("keydown", down);
    }, []);
    // Phone: a sideways swipe along the address box goes to the next tab, or the one before.
    const switchBy = useRef(() => undefined);
    switchBy.current = (by) => {
        const list = tabsRef.current.tabs;
        const at = list.findIndex((t) => t.id === tabsRef.current.active);
        const to = list[at + by];
        if (to)
            switchTo(to.id);
    };
    useEffect(() => {
        if (!narrow)
            return;
        const pill = document.getElementById("global-search")?.closest("form");
        if (!pill)
            return;
        pill.dataset.ownSwipe = "";
        let start = null;
        const down = (e) => {
            start = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
        };
        const up = (e) => {
            const from = start;
            start = null;
            const t = e.changedTouches[0];
            // While typing, a sideways drag moves along the words instead.
            if (!from || !t || document.activeElement?.id === "global-search")
                return;
            const dx = t.clientX - from.x;
            if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(t.clientY - from.y) * 1.5)
                return;
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
    const coming = fetched.filter(isActiveDownload).length;
    const asking = fetched.filter((d) => d.asking && d.media !== "other");
    const web = url.startsWith("http") && !failure;
    const splitRoutes = onSplitWith ? SPLIT_ROUTES : [];
    const splitTabs = allowSplit ? tabs.tabs.filter((tab) => tab.id !== tabs.active) : [];
    const splitKey = JSON.stringify([!!other, splitTabs.map((t) => [t.id, titleOf(t.title, t.url, t.private)]), splitRoutes.length]);
    const canSplit = (allowSplit || !!onSplitWith) && !companion;
    useEffect(() => {
        const split = canSplit ? {
            on: !!other,
            choices: [
                ...splitTabs.map((tab) => ({ id: `tab:${tab.id}`, label: `Beside ${titleOf(tab.title, tab.url, tab.private)}` })),
                ...(splitTabs.length && splitRoutes.length ? [{ id: "divider", label: "" }] : []),
                ...splitRoutes.map(({ label, route }) => ({ id: `route:${route}`, label: `Beside ${label}` })),
            ],
        } : null;
        barNow = { busy: busy && !onStart, marked: !!marked, bookmarks: marks, reader: !!article, web, split };
        window.dispatchEvent(new CustomEvent(BROWSER_STATE, { detail: barNow }));
    }, [busy, onStart, marked, marks, article, web, canSplit, splitKey]); // eslint-disable-line react-hooks/exhaustive-deps
    const fromTop = useRef(() => undefined);
    fromTop.current = (what) => {
        const travel = /^travel:(back|forward):(-?[\d.]+):(-?[\d.]+)$/.exec(what);
        if (travel)
            showTravel(travel[1], Number(travel[2]), Number(travel[3]));
        else if (what === "home")
            goHome();
        else if (what === "site")
            setPanel("site");
        else if (what === "mark")
            void toggleMark();
        else if (what === "sessions")
            setPanel("sessions");
        else if (what === "bookmarks")
            setPanel("bookmarks");
        else if (what.startsWith("bookmark:"))
            go(what.slice("bookmark:".length));
        else if (what === "reader")
            void (article ? setArticle(null) : openReader());
        else if (what === "back" || what === "forward" || what === "stop")
            act(what);
        else if (what === "unsplit")
            setPair(null);
        else if (what.startsWith("split:tab:"))
            splitWithTab(what.slice("split:tab:".length));
        else if (what.startsWith("split:route:") && onSplitWith) {
            setPair(null);
            onSplitWith(what.slice("split:route:".length));
        }
        else
            act("reload");
    };
    // Sanctum's Quick Links: a website, or one of the panels.
    // Sanctum's Quick links, heard once the page in front is showing (see the
    // effect that shows it): a website goes in a new tab or the one in front,
    // as chosen in Preferences › Discover.
    heardAsk.current = (ask) => {
        if ("panel" in ask)
            setPanel(ask.panel);
        else if ("start" in ask) {
            const start = tabsRef.current.tabs.find((tab) => isStartPage(tab.url) && !tab.private);
            if (start)
                switchTo(start.id);
            else
                openInNewTabRef.current(START_PAGE, false, true);
        }
        else if (!("url" in ask))
            fromTop.current("home");
        else if (readBrowserPrefs().linksOpen === "newTab" && !isStartPage(tabsRef.current.tabs.find((t) => t.id === tabsRef.current.active)?.url ?? ""))
            openInNewTabRef.current(ask.url, false, true);
        else
            goRef.current(ask.url);
    };
    const switchRef = useRef(() => undefined);
    switchRef.current = (id) => void (tabsRef.current.tabs.some((t) => t.id === id) && switchTo(id));
    useEffect(() => {
        const heard = (e) => fromTop.current(e.detail);
        const toTab = (e) => switchRef.current(e.detail);
        window.addEventListener(BROWSER_DO, heard);
        window.addEventListener(BROWSER_SWITCH, toTab);
        return () => {
            window.removeEventListener(BROWSER_DO, heard);
            window.removeEventListener(BROWSER_SWITCH, toTab);
            barNow = BAR_START;
            window.dispatchEvent(new CustomEvent(BROWSER_STATE, { detail: BAR_START }));
        };
    }, []);
    const share = (to, title) => {
        setPanel(null);
        void api.browserShare(to, title, null).catch((e) => toast(clean(e)));
    };
    const tryAgain = () => {
        if (!failure)
            return;
        const id = active.id;
        setFailed((f) => Object.fromEntries(Object.entries(f).filter(([t]) => t !== id)));
        void api.browserAct(id, "go", failure.url || url).catch((e) => toast(clean(e)));
    };
    /** Downloads › Retry: the same address again, in its tab if that's still open. */
    const retry = (d) => {
        if (!d.url || !/^https?:/i.test(d.url) || d.securityBlocked)
            return;
        if (d.direct) {
            void api.downloadWebBook(d.url, d.name, d.sourceUrl).catch((e) => toast(clean(e)));
            return;
        }
        const tab = d.tab && made.current.has(d.tab) ? d.tab : made.current.has(active.id) && !onStart ? active.id : null;
        if (tab)
            void api.browserAct(tab, "go", d.url).catch((e) => toast(clean(e)));
        else
            go(d.url);
    };
    /** The book a download became, once the library has it (it can take a moment to be added). */
    const bookOf = async (d) => {
        if (!d.bookId)
            return null;
        for (let tries = 0; tries < 30; tries++) {
            try {
                return await api.bookDetails(d.bookId);
            }
            catch {
                if (tries === 0)
                    toast("It's still being added. One moment…");
                await wait(1500);
            }
        }
        toast("It isn't in your library yet. Try again in a moment.");
        return null;
    };
    const readNow = async (d) => {
        const found = await bookOf(d);
        if (!found)
            return;
        setPanel(null);
        onOpenBook(found.book.id);
    };
    const sendWithGrimoire = async (d) => {
        const found = await bookOf(d);
        if (!found)
            return;
        setPanel(null);
        askSendWithLocalSend([found.book]);
    };
    const siteActions = {
        onProtection: (lower) => {
            if (!site)
                return;
            void api.browserProtect(protectionOf(lowerFor(site, lower))).then(() => act("reload"));
        },
        onZoom: (zoom) => site && setSiteSettings(site, { zoom }),
        onDesktop: (desktop) => {
            if (!site)
                return;
            const hosts = desktopHosts(setSiteSettings(site, { desktop }));
            // Told first, so the reload asks for the right version.
            void api.browserDesktopSites(hosts).then(() => act("reload"), () => undefined);
        },
        onClearData: () => {
            if (!site)
                return;
            void api.browserClearSite(site).then(() => {
                toast(`${site}'s cookies and data are cleared.`);
                act("reload");
            }, (e) => toast(clean(e)));
        },
        onCopy: () => void navigator.clipboard?.writeText(url).then(() => toast("Link copied.")),
        onShare: () => share(url, titleOf(active.title, url)),
        onClose: () => setPanel(null),
    };
    const toggleMark = async () => {
        if (!url.startsWith("http"))
            return;
        try {
            if (marked)
                await api.removeBookmark(marked.id);
            else
                await api.addBookmark(titleOf(active.title, url), url);
            await reloadMarks();
        }
        catch (e) {
            toast(String(e));
        }
    };
    const addThisFile = async () => {
        try {
            await api.downloadWebBook(url, fileTitle(url), downloadSource(active.id, url));
            toast("It's being added to your library.");
        }
        catch (e) {
            toast(String(e));
        }
    };
    const saveSelection = async () => {
        try {
            const clip = await api.browserRead(active.id, READ_SELECTION);
            if (typeof clip?.text !== "string" || !clip.text.trim())
                return toast("Select text on the page first.");
            if (typeof clip.url !== "string" || !/^https?:\/\//i.test(clip.url))
                return toast("This selection has no web address.");
            const address = new URL(clip.url).href.replace(/[<>]/g, (character) => encodeURIComponent(character));
            const quote = clip.text.split(/\r?\n/).map((line) => "> " + line.replace(/[\\`*_~\[\]<>]/g, "\\$&")).join("\n");
            const title = typeof clip.title === "string" && clip.title.trim() ? clip.title.trim() : titleOf(active.title, url);
            await api.savePersonalNote(null, title, `${quote}\n\nSource: <${address}>`);
            toast("Saved the selection to Scribe.");
        }
        catch (error) {
            toast(clean(error));
        }
    };
    /** ••• › Save to Reading List: the page's article, saved without opening reader view. */
    const saveToReadingList = async () => {
        try {
            const found = articleFrom(await api.browserRead(active.id, readerScript()));
            if (found)
                await saveArticle(found);
            else
                toast("This page doesn't have an article TBV can find.");
        }
        catch (e) {
            toast(String(e).replace(/^Error: /, ""));
        }
    };
    const openReader = async () => {
        try {
            const found = articleFrom(await api.browserRead(active.id, readerScript()));
            if (found)
                setArticle(found);
            else
                toast("This page doesn't have an article TBV can find.");
        }
        catch (e) {
            toast(String(e).replace(/^Error: /, ""));
        }
    };
    /** Saves the article as a small EPUB, into the library and the Reading List. */
    const saveArticle = async (from = article) => {
        if (!from)
            return;
        setSaving(true);
        try {
            const { bytes, fileName } = await articleEpub(from, (src) => api.browserFetchPicture(src));
            await api.saveWritingEpub(bytes, fileName, null, true);
            addToReadingList({ bookId: await bookIdOf(bytes), title: from.title, url: from.url });
            toast(`"${from.title}" is being added to your library and Reading List.`);
        }
        catch (e) {
            toast(String(e).replace(/^Error: /, ""));
        }
        finally {
            setSaving(false);
        }
    };
    const moreItems = [
        ...(companion && !narrow ? [
            { label: "Home page", icon: "home", onSelect: goHome },
            { label: marked ? "Remove bookmark" : "Bookmark this page", icon: "bookmark", disabled: !web, onSelect: () => void toggleMark() },
            { label: article ? "Exit Reader view" : "Reader view", icon: "bookOpen", disabled: !web && !article, onSelect: () => void (article ? setArticle(null) : openReader()) },
        ] : []),
        { label: "Share and open", icon: "share", disabled: !web, submenu: [
                { label: "Copy link", icon: "copy", onSelect: () => void navigator.clipboard?.writeText(url).then(() => toast("Link copied.")) },
                { label: "Share...", icon: "share", onSelect: () => share(url, titleOf(active.title, url)) },
                { label: "Open in your normal browser", icon: "link", onSelect: () => void openExternal(url) },
            ] },
        { label: "Bookmarks", icon: "bookmark", onSelect: () => setPanel("bookmarks") },
        { label: "Sessions", icon: "list", onSelect: () => setPanel("sessions") },
        { label: "Reading List", icon: "bookOpen", submenu: [
                { label: "Save this page", icon: "notes", disabled: !web || saving, onSelect: () => void saveToReadingList() },
                { label: "Open Reading List", icon: "bookOpen", onSelect: () => setPanel("reading") },
            ] },
        { label: "Save selection as Scribe note", icon: "notes", disabled: !web || !!article, onSelect: () => void saveSelection() },
        { label: "History", icon: "clock", onSelect: () => setPanel("history") },
        { label: "Find on page", icon: "search", onSelect: () => setFinding("") },
        // Also on a page's right-click menu (Windows), for one thing at a time.
        { label: "Remove things from this page", icon: "eyeOff", disabled: !web || !!article, onSelect: () => void api.browserRead(active.id, REMOVE_FROM_PAGE).then((on) => {
                if (!on)
                    toast("This page doesn't allow it.");
            }, () => toast("This page doesn't allow it.")) },
        { label: "Copy page report", icon: "copy", disabled: !web || !!article, onSelect: () => void copyPageReport(active.id) },
        { label: "New tab", icon: "plus", onSelect: () => newTab() },
        { label: "New private tab", icon: "eyeOff", onSelect: () => newTab(true) },
        { label: "Reopen closed tab", icon: "undo", disabled: !closedTabs.length, onSelect: () => reopen() },
        { label: "Make this your home page", icon: "home", disabled: !web, onSelect: () => (writeBrowserPrefs({ home: url }), toast("This is your home page now.")) },
        ...(narrow ? [{ label: "Site information", icon: "info", disabled: !site, onSelect: () => setPanel("site") }] : []),
        { label: "Clear all cookies and site data", icon: "trash", onSelect: () => void api.browserClear().then(() => toast("Every site's cookies and data are cleared.")) },
        ...(!narrow ? [] : ["divider", { label: "Add a catalogue", icon: "globePlus", onSelect: onOpenCatalogues }]),
    ];
    const splitItems = [
        ...tabs.tabs.filter((tab) => allowSplit && tab.id !== tabs.active).map((tab) => ({
            label: `Beside ${titleOf(tab.title, tab.url, tab.private)}`, onSelect: () => splitWithTab(tab.id),
        })),
        "divider",
        ...(onSplitWith ? SPLIT_ROUTES
            .map(({ label, route }) => ({ label: `Beside ${label}`, onSelect: () => { setPair(null); onSplitWith(route); } })) : []),
    ];
    const button = (label, icon, onClick, extra = "", more = {}) => (_jsx("button", { type: "button", className: `toolbar-button${extra}`, "aria-label": label, title: label, onClick: onClick, ...more, children: _jsx(Icon, { name: icon, size: 17 }) }));
    /** Pops out the video playing in this tab, or brings it back. */
    /** Closes every tab for a session's (or a fresh one at the home page). */
    const replaceAllTabs = (next) => {
        forget(tabsRef.current.tabs.map((tab) => tab.id));
        setPair(null);
        setArticle(null);
        onSearchChange("");
        tabsRef.current = next;
        setTabs(next);
        setPanel(null);
    };
    const popOut = async () => {
        if (!web)
            return toast("Open a page with a video first.");
        try {
            const done = await api.browserPip(active.id);
            if (done === "none")
                toast("No video is playing on this page. Start it, then try again.");
            else if (done === "refused")
                toast("This video can't be popped out. Try pointing at the video and using the button on it.");
        }
        catch (e) {
            toast(clean(e));
        }
    };
    const backTravel = useTravel("back");
    const forwardTravel = useTravel("forward");
    const downloadsButton = (_jsxs("button", { type: "button", ref: downloadTrigger, className: "toolbar-button browser-downloads-button", "aria-label": coming ? `Downloads, ${coming} in progress` : "Downloads", title: "Downloads", onClick: () => setPanel("downloads"), children: [_jsx(Icon, { name: "download", size: 17 }), (coming > 0 || asking.length > 0) && _jsx("span", { className: "browser-badge", children: coming || asking.length })] }));
    const tabList = [
        { heading: _jsx("strong", { children: tabs.tabs.length === 1 ? "1 tab" : `${tabs.tabs.length} tabs` }) },
        ...tabs.tabs.map((t) => ({
            id: t.id,
            label: titleOf(t.title, t.url, t.private),
            closeAction: { label: `Close ${titleOf(t.title, t.url, t.private)}`, run: () => close(t.id) },
            icon: (t.pinned ? "pin" : t.private ? "eyeOff" : "globe"),
            checked: t.id === tabs.active,
            hint: siteOf(t.url) ?? undefined,
            onSelect: () => switchTo(t.id),
        })),
        ...(closedTabs.length ? [
            { heading: "Recently closed" },
            ...closedTabs.map((tab, index) => ({ label: tab.title || tab.url, icon: "undo", onSelect: () => reopen(1, index) })),
            { label: "Clear recently closed", icon: "trash", onSelect: () => clearClosedWithUndo() },
        ] : []),
        ...otherTabs.flatMap((device) => [
            { heading: `On ${device.name}` },
            ...device.tabs.map((t) => ({ label: t.title?.trim() || siteOf(t.url) || t.url, icon: (device.kind === "phone" ? "phone" : "computer"),
                hint: siteOf(t.url) ?? undefined, onSelect: () => openInNewTab(t.url, false) })),
        ]),
    ];
    const tabRow = (t) => (_jsxs("div", { className: `browser-tab${t.id === tabs.active ? " is-active" : ""}${t.id === tabs.active && loading[t.id] ? " is-loading" : ""}${t.private ? " is-private" : ""}${t.pinned ? " is-pinned" : ""}`, ...drag(t.id), onContextMenu: (e) => openContextMenu(e, `${titleOf(t.title, t.url, t.private)}: tab`, tabMenu(t.id)), children: [_jsxs("button", { type: "button", role: "tab", "aria-selected": t.id === tabs.active, "aria-busy": !!loading[t.id], className: "browser-tab-name", title: t.pinned ? `${titleOf(t.title, t.url)} (pinned)` : t.url, onClick: () => switchTo(t.id), children: [loading[t.id] ? _jsx("span", { className: "browser-tab-busy", "aria-hidden": true }) : _jsx(Icon, { name: t.private ? "eyeOff" : isStartPage(t.url) ? "compass" : "globe", size: 14 }), !t.pinned && _jsx("span", { children: titleOf(t.title, t.url, t.private) })] }), !t.pinned && (_jsx("button", { type: "button", className: "browser-tab-close", "aria-label": `Close ${titleOf(t.title, t.url, t.private)}`, onClick: () => close(t.id), children: _jsx(Icon, { name: "close", size: 12 }) }))] }, t.id));
    const strip = useRef(null);
    useLayoutEffect(() => {
        const list = strip.current;
        if (!list)
            return;
        const reveal = () => {
            const selected = list.querySelector(".browser-tab.is-active");
            if (!selected)
                return;
            const pins = list.querySelector(".browser-pinned-tabs");
            const scroller = selected.parentElement === pins && pins ? pins : list;
            const bounds = scroller.getBoundingClientRect();
            const tab = selected.getBoundingClientRect();
            const left = bounds.left + (scroller === list ? pins?.offsetWidth ?? 0 : 0);
            if (tab.right > bounds.right)
                scroller.scrollLeft += tab.right - bounds.right;
            else if (tab.left < left)
                scroller.scrollLeft += tab.left - left;
        };
        const resize = new ResizeObserver(reveal);
        resize.observe(list);
        reveal();
        return () => resize.disconnect();
    }, [tabs, narrow]);
    return (_jsxs("div", { className: `browser${active.private ? " is-private-tab" : ""}`, children: [narrow && (allowSplit || onSplitWith) && !companion && _jsx("div", { className: "browser-split-tools", children: other ? _jsx("button", { type: "button", className: "toolbar-button", onClick: () => setPair(null), children: "Close tab split" }) :
                    _jsx(Menu, { label: "Split screen", className: "toolbar-button", trigger: _jsxs(_Fragment, { children: [_jsx(Icon, { name: "splitScreen", size: 16 }), " Split screen"] }), items: splitItems }) }), !narrow && (_jsxs("div", { className: "browser-strip", children: [_jsxs("div", { ref: strip, className: "browser-tabs", role: "tablist", "aria-label": "Tabs", children: [_jsx("div", { className: "browser-pinned-tabs", children: tabs.tabs.filter((tab) => tab.pinned).map(tabRow) }), tabs.tabs.filter((tab) => !tab.pinned).map(tabRow), _jsx("button", { type: "button", className: "browser-tab-new", "aria-label": "New tab", title: "New tab (Ctrl+T). Private tab: Ctrl+Alt+T, or right-click", onClick: () => newTab(), onContextMenu: (e) => openContextMenu(e, "New tab", [{ label: "New private tab", icon: "eyeOff", onSelect: () => newTab(true) }]), children: _jsx(Icon, { name: "plus", size: 15 }) })] }), _jsxs("div", { className: "browser-strip-tools", children: [_jsx(Menu, { label: "Every tab", closeOnScroll: false, className: "toolbar-button", trigger: _jsx(Icon, { name: "chevronDown", size: 16 }), items: tabList, searchLabel: "Search open tabs" }), _jsx("span", { className: "browser-bar-divider", "aria-hidden": true }), button("Add a catalogue", "globePlus", onOpenCatalogues), button("Picture in picture", "pictureInPicture", () => void popOut()), downloadsButton, _jsx(Menu, { label: "More", className: "toolbar-button", trigger: _jsx(Icon, { name: "more", size: 17 }), items: moreItems })] })] })), narrow && busy && !onStart && _jsx("span", { className: "browser-loading", role: "progressbar", "aria-label": "Loading" }), narrow && (_jsxs("div", { className: "browser-bar", children: [button("Back", "arrowLeft", () => act("back"), "", backTravel), button("Forward", "arrowRight", () => act("forward"), "", forwardTravel), button(busy ? "Stop" : "Reload", busy ? "close" : "sync", () => act(busy ? "stop" : "reload")), _jsx(BrowserBookmarks, { state: { busy, web, marked: !!marked, bookmarks: marks, reader: !!article, split: null }, className: "toolbar-button" }), button("Sessions", "list", () => setPanel("sessions")), _jsx("button", { type: "button", className: `toolbar-button browser-count${panel === "tabs" ? " is-on" : ""}`, "aria-label": `Tabs: ${tabs.tabs.length} open`, title: "Tabs", onClick: () => setPanel(panel === "tabs" ? null : "tabs"), children: _jsx("span", { children: tabs.tabs.length }) }), button("Reader view", "bookOpen", () => void (article ? setArticle(null) : openReader()), article ? " is-on" : ""), isFile && button("Add to library", "plus", () => void addThisFile(), " is-on"), downloadsButton, _jsx(Menu, { label: "More", className: "toolbar-button", trigger: _jsx(Icon, { name: "more", size: 17 }), items: moreItems })] })), finding !== null && (_jsxs("form", { className: "browser-find", role: "search", onSubmit: (e) => {
                    e.preventDefault();
                    if (finding)
                        void api.browserFind(active.id, finding, false);
                }, children: [_jsx(Icon, { name: "search", size: 15 }), _jsx("input", { autoFocus: true, value: finding, onChange: (e) => setFinding(e.target.value), onKeyDown: (e) => e.key === "Escape" && setFinding(null), placeholder: "Find on page", "aria-label": "Find on page" }), button("Previous", "chevronUp", () => finding && void api.browserFind(active.id, finding, true)), button("Next", "chevronDown", () => finding && void api.browserFind(active.id, finding, false)), button("Close find", "close", () => setFinding(null))] })), asking.map((d) => (_jsxs("div", { className: "browser-offer", role: "status", children: [_jsxs("span", { children: ["Downloaded ", _jsx("b", { title: d.name, children: d.name }), "."] }), d.media !== "other" && (_jsx("button", { type: "button", className: "btn btn-primary btn-small", onClick: () => void answer(d, "add"), children: d.media === "audio" ? "Add to Resonance" : "Add to Archive" })), _jsx("button", { type: "button", className: "btn btn-quiet btn-small", onClick: () => void answer(d, "keep"), children: "Save" }), _jsx("button", { type: "button", className: "btn btn-quiet btn-small", onClick: (e) => void removeDownloadRows([d.id], e.currentTarget), children: "Remove" })] }, d.id))), isFile && !narrow && !fetched.some((d) => d.url === url && (isActiveDownload(d) || d.asking)) && (_jsxs("div", { className: "browser-offer", role: "status", children: [_jsxs("span", { children: ["This page is a ", formatLabel(url.match(BOOK_FILE)[1].toLowerCase()), " file."] }), _jsxs("button", { type: "button", className: "btn btn-primary btn-small", onClick: () => void addThisFile(), children: [_jsx(Icon, { name: "download", size: 14 }), " Add to library"] })] })), _jsxs("div", { className: `browser-panes${other ? " is-split" : ""}`, style: other ? { gridTemplateColumns: `minmax(180px, ${ratio}fr) 12px minmax(180px, ${100 - ratio}fr)` } : undefined, children: [_jsxs("section", { className: "browser-pane", style: other ? { gridColumn: pair?.activeLeft ? 1 : 3 } : undefined, "aria-label": "Active browser pane", children: [other && _jsx("div", { className: "browser-pane-title", "aria-current": "true", children: titleOf(active.title, url, active.private) }), _jsxs("div", { className: "browser-view", ref: area, children: [onStart && !article && (_jsx(StartPage, { onGo: go, onNewTab: openInNewTab, onPanel: setPanel, search: search, onSearchChange: onSearchChange, onSearch: (text) => {
                                            go(text);
                                            onSearchChange("");
                                        }, closed: closedTabs, onReopen: (index) => reopen(1, index), privately: !!active.private })), failure && !article && (_jsxs("div", { className: "browser-failed", role: "alert", children: [_jsx(Icon, { name: "cloudOff", size: 44 }), _jsx("h2", { children: "This page didn't open" }), _jsx("p", { children: failure.reason }), failure.url && _jsx("p", { className: "muted browser-failed-url", children: readableAddress(failure.url) }), _jsxs("div", { className: "browser-failed-actions", children: [_jsxs("button", { type: "button", className: "btn btn-primary", onClick: tryAgain, children: [_jsx(Icon, { name: "sync", size: 15 }), " Try again"] }), _jsxs("button", { type: "button", className: "btn btn-quiet", onClick: goHome, children: [_jsx(Icon, { name: "home", size: 15 }), " Home"] })] })] })), problem && !onStart && (_jsxs("div", { className: "library-empty", role: "alert", children: [_jsx("h2", { children: "The browser couldn't open" }), _jsx("p", { className: "muted", children: problem })] })), article && (_jsxs("article", { className: "browser-reader", lang: article.lang ?? undefined, children: [_jsxs("div", { className: "browser-reader-bar", children: [_jsxs("button", { type: "button", className: "btn btn-quiet btn-small", onClick: () => setArticle(null), children: [_jsx(Icon, { name: "arrowLeft", size: 14 }), " Back to the page"] }), _jsxs("button", { type: "button", className: "btn btn-primary btn-small", disabled: saving, onClick: () => void saveArticle(), children: [_jsx(Icon, { name: "download", size: 14 }), " ", saving ? "Saving…" : "Save to Reading List"] })] }), _jsxs("header", { children: [_jsx("h1", { children: article.title }), articleByline(article) && _jsx("p", { className: "muted", children: articleByline(article) })] }), _jsx("div", { className: "browser-reader-text", dangerouslySetInnerHTML: { __html: cleanArticle(article.content) } })] })), panel === "tabs" && (_jsxs("div", { className: "browser-grid", role: "dialog", "aria-label": "Tabs", onKeyDown: (event) => { if (event.key === "Escape")
                                            setPanel(null); }, children: [_jsxs("div", { className: "browser-grid-head", children: [_jsxs("h2", { children: [tabs.tabs.length, " ", tabs.tabs.length === 1 ? "tab" : "tabs"] }), tabs.tabs.length > 1 && _jsx("span", { className: "muted browser-grid-hint", children: "Hold a tab to move it" }), _jsxs("button", { type: "button", className: "btn btn-quiet btn-small", onClick: () => newTab(), children: [_jsx(Icon, { name: "plus", size: 14 }), " New tab"] }), _jsxs("button", { type: "button", className: "btn btn-quiet btn-small", "aria-label": "New private tab", onClick: () => newTab(true), children: [_jsx(Icon, { name: "eyeOff", size: 14 }), " Private"] }), _jsx("button", { type: "button", className: "btn btn-primary btn-small", onClick: () => setPanel(null), children: "Done" })] }), _jsx("input", { className: "browser-tab-search", type: "search", "aria-label": "Search open tabs", placeholder: "Search open tabs", value: tabSearch, onChange: (event) => setTabSearch(event.target.value), onKeyDown: (event) => {
                                                    if (event.key === "Enter" && !event.nativeEvent.isComposing && matchingTabs[0]) {
                                                        event.preventDefault();
                                                        switchTo(matchingTabs[0].id);
                                                    }
                                                } }), matchingTabs.length === 0 && _jsx("p", { className: "muted", children: "No matching open tabs." }), _jsx("div", { className: "browser-grid-tabs", children: matchingTabs.map((t) => (_jsxs("div", { "data-item-menu": true, className: `browser-grid-tab${t.id === tabs.active ? " is-active" : ""}${t.id === tabs.active && loading[t.id] ? " is-loading" : ""}${t.private ? " is-private" : ""}`, ...drag(t.id), children: [_jsxs("button", { type: "button", className: "browser-grid-open", onClick: () => switchTo(t.id), children: [_jsx(Icon, { name: t.private ? "eyeOff" : "globe", size: 22 }), _jsx("strong", { children: titleOf(t.title, t.url, t.private) }), _jsx("span", { className: "muted", children: t.private ? `Private${siteOf(t.url) ? ` · ${siteOf(t.url)}` : ""}` : siteOf(t.url) })] }), _jsx("span", { className: "browser-grid-more", children: _jsx(Menu, { label: `More for ${titleOf(t.title, t.url, t.private)}`, trigger: _jsx(Icon, { name: "moreVertical", size: 16 }), items: tabMenu(t.id) }) }), _jsx("button", { type: "button", className: "browser-tab-close", "aria-label": `Close ${titleOf(t.title, t.url, t.private)}`, onClick: () => close(t.id), children: _jsx(Icon, { name: "close", size: 14 }) })] }, t.id))) }), !tabQuery && closedTabs.length > 0 && (_jsxs("section", { className: "browser-grid-closed", "aria-labelledby": "grid-closed", children: [_jsxs("header", { className: "browser-grid-closed-head", children: [_jsx("h3", { id: "grid-closed", children: "Recently closed" }), _jsxs("button", { type: "button", className: "start-more", onClick: () => clearClosedWithUndo(), children: ["Clear ", _jsx(Icon, { name: "chevronRight", size: 16 })] })] }), _jsx(ClosedList, { closed: closedTabs, onReopen: (index) => reopen(1, index) })] })), !tabQuery && otherTabs.map((device) => (_jsxs("section", { className: "browser-grid-closed", "aria-label": `Tabs open on ${device.name}`, children: [_jsxs("h3", { children: ["On ", device.name] }), _jsx("ul", { className: "browser-download-list", children: device.tabs.map((t, i) => (_jsx("li", { children: _jsxs("button", { type: "button", className: "browser-history-open", title: t.url, onClick: () => { setPanel(null); openInNewTab(t.url, false); }, children: [_jsx(Icon, { name: device.kind === "phone" ? "phone" : "computer", size: 16 }), _jsxs("span", { className: "browser-download-name", children: [_jsx("b", { children: t.title?.trim() || siteOf(t.url) || t.url }), _jsx("span", { className: "muted", children: siteOf(t.url) ?? t.url })] })] }) }, i))) })] }, device.deviceId)))] }))] })] }), other && _jsxs(_Fragment, { children: [_jsx(SplitDivider, { value: ratio, onChange: setRatio, label: "Resize Discover tabs", minimum: 186 }), _jsxs("section", { className: "browser-pane", style: { gridColumn: pair?.activeLeft ? 3 : 1 }, "aria-label": "Other browser pane", children: [_jsxs("button", { type: "button", className: "browser-pane-title", onClick: () => switchTo(other.id), children: ["Focus ", titleOf(other.title, other.url, other.private)] }), _jsxs("div", { className: "browser-view", ref: secondary, children: [isStartPage(other.url) && _jsx("button", { type: "button", className: "btn btn-quiet", onClick: () => switchTo(other.id), children: "Use this start page" }), failed[other.id] && _jsx("p", { className: "muted", children: failed[other.id].reason })] })] })] })] }), panel === "sessions" && _jsx(SessionsPanel, { current: tabs, onClose: () => setPanel(null), onLoad: (session) => replaceAllTabs(restoreSession(session)), onNew: () => replaceAllTabs(freshTabs(homeOf())) }), (panel === "bookmarks" || panel === "bookmark-page") && (_jsx(BookmarksPanel, { page: panel === "bookmark-page" ? marked ?? { id: "", title: titleOf(active.title, url), url } : undefined, onGo: (to) => (setPanel(null), go(to)), onClose: () => setPanel(null), onChanged: reloadMarks }, panel)), panel === "reading" && _jsx(ReadingListPanel, { onOpenBook: onOpenBook, onClose: () => setPanel(null) }), panel === "site" && site && _jsx(SiteInfo, { url: url, actions: siteActions }), panel === "history" && _jsx(HistoryPanel, { onGo: (to) => (setPanel(null), go(to)), onClose: () => setPanel(null) }), panel === "downloads" && (_jsx("div", { className: "dialog-backdrop browser-downloads-backdrop", onPointerDown: (e) => e.target === e.currentTarget && setPanel(null), children: _jsxs("div", { className: "dialog browser-downloads", role: "dialog", "aria-label": "Downloads", onKeyDown: (e) => e.key === "Escape" && setPanel(null), children: [_jsxs("header", { className: "catalogues-head", children: [_jsx("h2", { children: "Downloads" }), _jsx("button", { type: "button", className: "btn btn-quiet btn-small", disabled: !fetched.some((d) => !isActiveDownload(d)), onClick: (e) => void removeDownloadRows(fetched.map((d) => d.id), e.currentTarget), children: "Remove all" }), _jsx("button", { ref: downloadClose, type: "button", className: "icon-btn", "aria-label": "Close", onClick: () => setPanel(null), children: _jsx(Icon, { name: "close", size: 18 }) })] }), fetched.length === 0 ? (_jsx("p", { className: "muted", children: "Files you download in Discover show here." })) : (_jsx("ul", { className: "browser-download-list", children: fetched.map((d) => (_jsxs("li", { children: [_jsx(Icon, { name: "file", size: 18 }), _jsxs("span", { className: "browser-download-name", children: [_jsx("b", { title: d.name, children: d.name }), _jsxs("span", { className: "muted", children: [downloadState(d), d.error && ` · ${d.error}`, d.state === "failed" && d.url && !/^https?:/i.test(d.url) && !d.securityBlocked && " · Try the download again from the webpage", d.at > 0 && d.state !== "coming" && ` · ${new Date(d.at).toLocaleDateString(undefined, { day: "numeric", month: "short" })}`] })] }), d.sourceUrl && /^https?:\/\//i.test(d.sourceUrl) && (_jsx("button", { type: "button", className: "btn btn-quiet btn-small", onClick: () => openInNewTab(d.sourceUrl, false), children: "Open source page" })), d.state === "failed" && !d.securityBlocked && !d.direct && d.url && /^https?:\/\//i.test(d.url) && BOOK_FILE.test(d.url) && (_jsx("button", { type: "button", className: "btn btn-quiet btn-small", onClick: () => void api.downloadWebBook(d.url, d.name, d.sourceUrl).catch((error) => toast(clean(error))), children: "Download and add to library" })), d.state === "coming" && !d.direct && (_jsx("button", { type: "button", className: "btn btn-quiet btn-small", onClick: (event) => {
                                            const button = event.currentTarget;
                                            void api.browserCancelDownload(d.id).then(() => {
                                                setDownloads((list) => list.filter((x) => x.id !== d.id || x.state !== "coming"));
                                                if (document.activeElement === button || document.activeElement === document.body)
                                                    downloadClose.current?.focus({ preventScroll: true });
                                            }, (e) => toast(clean(e)));
                                        }, children: "Cancel" })), d.state === "failed" && d.url && /^https?:/i.test(d.url) && !d.securityBlocked && (_jsxs(_Fragment, { children: [_jsx("button", { type: "button", className: "btn btn-quiet btn-small", onClick: () => retry(d), children: "Retry" }), /^https?:/i.test(d.url) && _jsx(Menu, { label: "Download options for " + d.name, trigger: _jsx(Icon, { name: "more", size: 16 }), items: [
                                                    { label: "Copy download link", icon: "copy", onSelect: () => void navigator.clipboard.writeText(d.url).then(() => toast("Copied download link."), () => toast("Couldn't copy the download link.")) },
                                                    { label: "Open in your normal browser", icon: "link", onSelect: () => void openExternal(d.url) },
                                                ] })] })), d.state === "added" && d.bookId && (_jsxs(_Fragment, { children: [_jsx("button", { type: "button", className: "btn btn-primary btn-small", onClick: () => void readNow(d), children: "Read now" }), _jsx(Menu, { label: `More for ${d.name}`, className: "icon-btn", trigger: _jsx(Icon, { name: "moreVertical", size: 16 }), items: [{ label: "Send with Grimoire", icon: "upload", onSelect: () => void sendWithGrimoire(d) }] })] })), d.asking && (_jsxs(_Fragment, { children: [d.media !== "other" && (_jsx("button", { type: "button", className: "btn btn-primary btn-small", onClick: () => void answer(d, "add"), children: d.state === "importFailed" ? "Retry import" : d.media === "audio" ? "Add to Resonance" : "Add to Archive" })), _jsx("button", { type: "button", className: "btn btn-quiet btn-small", onClick: () => void answer(d, "keep"), children: "Save" })] })), !isActiveDownload(d) && (_jsx("button", { type: "button", className: "icon-btn", "data-remove-download": true, "aria-label": `Remove ${d.name} from the list`, title: "Remove from history", onClick: (e) => void removeDownloadRows([d.id], e.currentTarget), children: _jsx(Icon, { name: "close", size: 14 }) }))] }, d.id))) }))] }) })), redirects.length > 0 && (_jsx(ConfirmDialog, { title: "Allow this redirect?", body: (siteOf(redirects[0].from) ?? "This site") + " wants to send you to " + (siteOf(redirects[0].url) ?? "another page") + ".", confirm: "Allow once", onCancel: () => setRedirects((pending) => pending.slice(1)), onConfirm: () => {
                    const target = redirects[0];
                    setRedirects((pending) => pending.slice(1));
                    void api.browserAct(target.tab, "go", target.url).catch((failure) => toast(clean(failure)));
                } })), appLink && (_jsx(ConfirmDialog, { title: "Open another app?", body: appLinkAsk(appLink), confirm: "Open", onCancel: () => setAppLink(null), onConfirm: () => {
                    const to = appLink;
                    setAppLink(null);
                    void api.browserOpenApp(to).catch((e) => toast(clean(e)));
                } }))] }));
}

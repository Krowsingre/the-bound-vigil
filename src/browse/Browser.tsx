// Discover: a web browser inside TBV. Each tab's page shows in a view of its
// own laid over the space below the button row (see src-tauri/src/browser.rs);
// this draws the row, the tabs, the Downloads list and reader mode, and keeps
// the page's view in place. The top bar's search box is the address bar.

import { useCallback, useEffect, useRef, useState } from "react";
import { api, isIOS, openExternal } from "../api";
import type { Bookmark, BrowserEvent, BrowserFrame, ReaderArticle } from "../api/types";
import { Icon } from "../components/Icon";
import { Menu, type MenuEntry } from "../components/Menu";
import { useToast } from "../components/Toast";
import { formatLabel } from "../lib/queryBooks";
import { useNarrow } from "../lib/useNarrow";
import { addressFor, lowerFor, onBrowserPrefs, protectionOf, readBrowserPrefs, siteOf, writeBrowserPrefs } from "./browserPrefs";
import { closeTab, newTabId, openTab, readTabs, updateTab, writeTabs, type TabsState } from "./browserTabs";
import { articleByline, articleEpub, articleFrom, cleanArticle, readerScript } from "./readerArticle";

/** The header's search box, on Discover, sends what's typed here. */
export const BROWSER_GO = "tbv:browser-go";
/** The page in front, told to the header so its search box can show the address. */
export const BROWSER_PAGE = "tbv:browser-page";

/** The top bar's Home and Reload buttons, on Discover, ask the browser here. */
const BROWSER_DO = "tbv:browser-do";
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

/** Reload, inside the left of the address, where the magnifier sits on other pages; Stop while loading. */
export function BrowserReloadButton() {
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const heard = (e: Event) => setBusy((e as CustomEvent<boolean>).detail);
    window.addEventListener(BROWSER_BUSY, heard);
    return () => window.removeEventListener(BROWSER_BUSY, heard);
  }, []);
  return (
    <button
      type="button"
      className="search-action"
      aria-label={busy ? "Stop" : "Reload"}
      title={busy ? "Stop" : "Reload"}
      // Kept from taking the box's focus, which would put the address up for typing.
      onPointerDown={(e) => e.preventDefault()}
      onClick={() => window.dispatchEvent(new CustomEvent(BROWSER_DO, { detail: busy ? "stop" : "reload" }))}
    >
      <Icon name={busy ? "close" : "sync"} size={18} />
    </button>
  );
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

const titleOf = (title: string | null, url: string) => title?.trim() || siteOf(url) || url;

/** Pauses every video and sound on a page, for leaving Discover. */
const PAUSE_ALL = `(function () {
  document.querySelectorAll("video, audio").forEach(function (m) { try { m.pause(); } catch (e) {} });
  return JSON.stringify(null);
})()`;

/** Something on top (a menu, a dialog, the phone's menu of pages) would be hidden under the page, so the page steps aside. */
const covered = () => !!document.querySelector(".dialog-backdrop, [role=menu], [role=alertdialog], .sidebar-backdrop");

/** A file the browser is bringing down, or brought down. */
interface Fetched {
  id: string;
  name: string;
  state: "coming" | "done" | "failed" | "added" | "kept";
  path?: string;
  /** Still waiting for an answer: add it, keep it, or not. */
  asking?: boolean;
}

export function Browser({ onOpenCatalogues }: { onOpenCatalogues: () => void }) {
  const narrow = useNarrow();
  const [rowOpen] = useBrowserRow();
  const [tabs, setTabs] = useState<TabsState>(() => readTabs(readBrowserPrefs().home));
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [marks, setMarks] = useState<Bookmark[]>([]);
  const [fetched, setFetched] = useState<Fetched[]>([]);
  const [panel, setPanel] = useState<null | "downloads" | "tabs">(null);
  const [finding, setFinding] = useState<string | null>(null);
  const [article, setArticle] = useState<ReaderArticle | null>(null);
  const [saving, setSaving] = useState(false);
  const [prefs, setPrefs] = useState(readBrowserPrefs);
  const [problem, setProblem] = useState<string | null>(null);
  const area = useRef<HTMLDivElement>(null);
  /** Tabs whose page view has been made. */
  const made = useRef(new Set<string>());
  const shown = useRef(false);
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  /** Reader mode covers the page, so the page's view steps aside. */
  const aside = useRef(false);
  aside.current = !!article || panel === "tabs";
  const refit = useRef<() => void>(() => undefined);
  const toast = useToast();

  const active = tabs.tabs.find((t) => t.id === tabs.active) ?? tabs.tabs[0];
  const url = active?.url ?? "";

  useEffect(() => writeTabs(tabs), [tabs]);
  // A tab that's gone (the oldest, past the most kept) has its page closed too.
  useEffect(() => {
    for (const id of [...made.current]) {
      if (tabs.tabs.some((t) => t.id === id)) continue;
      made.current.delete(id);
      void api.browserAct(id, "close");
    }
  }, [tabs.tabs]);
  useEffect(() => onBrowserPrefs(() => setPrefs(readBrowserPrefs())), []);
  // The top bar shows the address of the page in front.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent(BROWSER_PAGE, { detail: url }));
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
    const fresh = !made.current.has(tab.id);
    await api.browserShow(tab.id, fresh ? tab.url : null, at, protectionOf(readBrowserPrefs()));
    made.current.add(tab.id);
  }, []);

  const reloadMarks = useCallback(() => api.bookmarks().then(setMarks, () => undefined), []);
  useEffect(() => void reloadMarks(), [reloadMarks]);

  const answer = useCallback(
    async (d: Fetched, how: "add" | "keep" | "drop") => {
      if (!d.path) return;
      try {
        if (how === "add") {
          await api.browserAddDownload(d.path);
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
      setFetched((list) => (how === "drop" ? list.filter((x) => x.id !== d.id) : list.map((x) => (x.id === d.id ? { ...x, asking: false, state: how === "add" ? "added" : "kept" } : x))));
    },
    [toast],
  );

  // What the tabs did.
  useEffect(() => {
    const heard = (ev: BrowserEvent) => {
      switch (ev.kind) {
        case "page":
          setLoading((l) => ({ ...l, [ev.tab]: ev.loading }));
          if (/^https?:/i.test(ev.url)) {
            setTabs((s) => {
              const before = s.tabs.find((t) => t.id === ev.tab);
              const title = ev.title ?? (before?.url === ev.url ? before.title : null);
              return updateTab(s, ev.tab, { url: ev.url, title });
            });
          }
          break;
        case "newTab": {
          const id = ev.tab ?? newTabId();
          // On iPhone a pop-up's view is made already, still joined to its page.
          if (ev.tab) made.current.add(id);
          setTabs((s) => openTab(s, { id, url: /^https?:/i.test(ev.url) ? ev.url : readBrowserPrefs().home, title: null }));
          break;
        }
        case "closed":
          made.current.delete(ev.tab);
          void api.browserAct(ev.tab, "close");
          setTabs((s) => closeTab(s, ev.tab, readBrowserPrefs().home));
          break;
        case "downloadStart":
          setFetched((list) => [{ id: ev.id, name: ev.name, state: "coming" as const }, ...list.filter((x) => x.id !== ev.id)].slice(0, 30));
          break;
        case "download": {
          const done: Fetched = { id: ev.id, name: ev.name, path: ev.path, state: ev.ok ? "done" : "failed", asking: ev.ok };
          // Chosen in Preferences › Browser: ebooks go straight in.
          const straightIn = ev.ok && BOOK_FILE.test(ev.name) && readBrowserPrefs().addWithoutAsking;
          setFetched((list) => [done, ...list.filter((x) => x.id !== ev.id)]);
          if (straightIn) void answer(done, "add");
          break;
        }
      }
    };
    return api.onBrowserEvent(heard);
  }, [answer]);

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
      // Chosen in Preferences › Browser: whatever was playing stops on leaving.
      if (!readBrowserPrefs().keepPlaying) for (const id of made.current) void api.browserRead(id, PAUSE_ALL).catch(() => undefined);
    };
  }, [showActive]);

  // Another tab came forward, or reader mode opened or closed.
  useEffect(() => refit.current(), [tabs.active, article, panel]);

  const act = (action: "back" | "forward" | "reload" | "stop") => void api.browserAct(active.id, action).catch(() => undefined);

  const go = (text: string) => {
    const to = addressFor(text, readBrowserPrefs().search);
    if (!to) return;
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

  const newTab = () => {
    setArticle(null);
    setPanel(null);
    setTabs((s) => openTab(s, { id: newTabId(), url: readBrowserPrefs().home, title: null }));
  };
  const switchTo = (id: string) => {
    setArticle(null);
    setPanel(null);
    setTabs((s) => ({ ...s, active: id }));
  };
  const close = (id: string) => {
    made.current.delete(id);
    void api.browserAct(id, "close");
    setTabs((s) => closeTab(s, id, readBrowserPrefs().home));
  };

  const marked = marks.find((m) => m.url === url) ?? null;
  const isFile = BOOK_FILE.test(url);
  const site = siteOf(url);
  const lowered = !!site && prefs.lowered.includes(site);
  const busy = !!loading[active.id];
  const coming = fetched.filter((d) => d.state === "coming").length;
  const asking = fetched.filter((d) => d.asking);
  useEffect(() => {
    window.dispatchEvent(new CustomEvent(BROWSER_BUSY, { detail: busy }));
  }, [busy]);
  const fromTop = useRef<(what: string) => void>(() => undefined);
  fromTop.current = (what) => (what === "home" ? go(readBrowserPrefs().home) : act(what === "stop" ? "stop" : "reload"));
  useEffect(() => {
    const heard = (e: Event) => fromTop.current((e as CustomEvent<string>).detail);
    window.addEventListener(BROWSER_DO, heard);
    return () => {
      window.removeEventListener(BROWSER_DO, heard);
      window.dispatchEvent(new CustomEvent(BROWSER_BUSY, { detail: false }));
    };
  }, []);


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

  const openReader = async () => {
    try {
      const found = articleFrom(await api.browserRead(active.id, readerScript()));
      if (found) setArticle(found);
      else toast("This page doesn't have an article TBV can find.");
    } catch (e) {
      toast(String(e).replace(/^Error: /, ""));
    }
  };

  const saveArticle = async () => {
    if (!article) return;
    setSaving(true);
    try {
      const { bytes, fileName } = await articleEpub(article, (src) => api.browserFetchPicture(src));
      await api.saveWritingEpub(bytes, fileName, null, true);
      toast(`"${article.title}" is being added to your library.`);
    } catch (e) {
      toast(String(e).replace(/^Error: /, ""));
    } finally {
      setSaving(false);
    }
  };

  const changeProtection = () => {
    if (!site) return;
    const next = lowerFor(site, !lowered);
    void api.browserProtect(protectionOf(next)).then(() => act("reload"));
    toast(lowered ? `Protection is back on for ${site}.` : `Protection is lowered for ${site}.`);
  };

  const sites = marks.length ? marks : SUGGESTED_SITES.map((s, i) => ({ id: `suggested-${i}`, ...s }));
  const bookmarkItems: MenuEntry[] = [
    { heading: <strong>{marks.length ? "Bookmarks" : "Book sites to start with"}</strong> },
    ...sites.map((m) => ({ label: m.title, icon: "globe" as const, onSelect: () => go(m.url) })),
  ];
  const moreItems: MenuEntry[] = [
    { label: "Copy link", icon: "copy", disabled: !url.startsWith("http"), onSelect: () => void navigator.clipboard?.writeText(url).then(() => toast("Link copied.")) },
    { label: "Open in your normal browser", icon: "link", disabled: !url.startsWith("http"), onSelect: () => void openExternal(url) },
    { label: "Find on page", icon: "search", onSelect: () => setFinding("") },
    { label: "Make this your home page", icon: "home", disabled: !url.startsWith("http"), onSelect: () => (writeBrowserPrefs({ home: url }), toast("This is your home page now.")) },
    {
      label: lowered ? "Restore protection for this site" : "Lower protection for this site",
      icon: "eyeOff",
      disabled: !site || prefs.protection === "off",
      onSelect: changeProtection,
    },
    { label: "Clear cookies and site data", icon: "trash", onSelect: () => void api.browserClear().then(() => toast("Every site's cookies and data are cleared.")) },
    "divider",
    { label: "Add a catalogue", icon: "globePlus", onSelect: onOpenCatalogues },
    "divider",
    ...bookmarkItems,
  ];

  const button = (label: string, icon: Parameters<typeof Icon>[0]["name"], onClick: () => void, extra = "") => (
    <button type="button" className={`toolbar-button${extra}`} aria-label={label} title={label} onClick={onClick}>
      <Icon name={icon} size={17} />
    </button>
  );

  return (
    <div className="browser">
      {!narrow && (
        <div className="browser-tabs" role="tablist" aria-label="Tabs">
          {tabs.tabs.map((t) => (
            <div key={t.id} className={`browser-tab${t.id === tabs.active ? " is-active" : ""}`}>
              <button type="button" role="tab" aria-selected={t.id === tabs.active} className="browser-tab-name" title={t.url} onClick={() => switchTo(t.id)}>
                {loading[t.id] ? <span className="browser-tab-busy" aria-hidden /> : <Icon name="globe" size={13} />}
                <span>{titleOf(t.title, t.url)}</span>
              </button>
              <button type="button" className="browser-tab-close" aria-label={`Close ${titleOf(t.title, t.url)}`} onClick={() => close(t.id)}>
                <Icon name="close" size={12} />
              </button>
            </div>
          ))}
          <button type="button" className="browser-tab-new" aria-label="New tab" title="New tab" onClick={newTab}>
            <Icon name="plus" size={15} />
          </button>
        </div>
      )}
      {rowOpen && (
        <div className="browser-bar">
          {button("Back", "arrowLeft", () => act("back"))}
          {button("Forward", "arrowRight", () => act("forward"))}
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
      {isFile && !rowOpen && (
        <div className="browser-offer" role="status">
          <span>This page is a {formatLabel(url.match(BOOK_FILE)![1].toLowerCase())} file.</span>
          <button type="button" className="btn btn-primary btn-small" onClick={() => void addThisFile()}>
            <Icon name="download" size={14} /> Add to library
          </button>
        </div>
      )}
      <div className="browser-view" ref={area}>
        {problem && (
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
                <Icon name="download" size={14} /> {saving ? "Saving…" : "Save to library"}
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
              <button type="button" className="btn btn-quiet btn-small" onClick={newTab}>
                <Icon name="plus" size={14} /> New tab
              </button>
              <button type="button" className="btn btn-primary btn-small" onClick={() => setPanel(null)}>
                Done
              </button>
            </div>
            <div className="browser-grid-tabs">
              {tabs.tabs.map((t) => (
                <div key={t.id} className={`browser-grid-tab${t.id === tabs.active ? " is-active" : ""}`}>
                  <button type="button" className="browser-grid-open" onClick={() => switchTo(t.id)}>
                    <Icon name="globe" size={22} />
                    <strong>{titleOf(t.title, t.url)}</strong>
                    <span className="muted">{siteOf(t.url)}</span>
                  </button>
                  <button type="button" className="browser-tab-close" aria-label={`Close ${titleOf(t.title, t.url)}`} onClick={() => close(t.id)}>
                    <Icon name="close" size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
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
                        {d.state === "coming" ? "Coming down…" : d.state === "failed" ? "Didn't finish" : d.state === "added" ? "Added to your library" : d.state === "kept" ? "Kept in Downloads" : "Downloaded"}
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

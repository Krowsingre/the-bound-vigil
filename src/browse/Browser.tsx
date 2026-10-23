// Browse › Browser: a web browser inside TBV. The page itself shows in a
// view of its own laid over the space below the toolbar (see
// src-tauri/src/browser.rs); this draws the toolbar and keeps that view in
// place. Ebook files the browser brings down are offered to the library.

import { useCallback, useEffect, useRef, useState } from "react";
import { api, isIOS } from "../api";
import type { Bookmark, BrowserDownload, BrowserFrame, BrowserPage } from "../api/types";
import { Icon } from "../components/Icon";
import { Menu, type MenuEntry } from "../components/Menu";
import { useToast } from "../components/Toast";
import { formatLabel } from "../lib/queryBooks";
import { addressFor, readBrowserPrefs, writeBrowserPrefs } from "./browserPrefs";

const LAST_KEY = "tbv.browser.last";
/** The header's search box, on Discover, sends what's typed here. */
export const BROWSER_GO = "tbv:browser-go";

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

const read = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Forgotten after this visit.
  }
};

/** A file name from an address, for its title in the library. */
const fileTitle = (url: string) => {
  try {
    const name = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "");
    return name.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ").trim() || "A book from the web";
  } catch {
    return "A book from the web";
  }
};

/** Something on top (a menu, a dialog, the phone's menu of pages) would be hidden under the page, so the page steps aside. */
const covered = () => !!document.querySelector(".dialog-backdrop, [role=menu], [role=alertdialog], .sidebar-backdrop");

export function Browser() {
  const [page, setPage] = useState<BrowserPage | null>(null);
  const [typed, setTyped] = useState("");
  const [editing, setEditing] = useState(false);
  const [marks, setMarks] = useState<Bookmark[]>([]);
  const [downloads, setDownloads] = useState<BrowserDownload[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const area = useRef<HTMLDivElement>(null);
  const shown = useRef(false);
  const toast = useToast();

  const frame = (): BrowserFrame | null => {
    const r = area.current?.getBoundingClientRect();
    return r && r.width > 0 && r.height > 0 ? { x: r.left, y: r.top, width: r.width, height: r.height } : null;
  };

  const reloadMarks = useCallback(() => api.bookmarks().then(setMarks, () => undefined), []);
  useEffect(() => void reloadMarks(), [reloadMarks]);

  // Where the page is, and what it brought down.
  useEffect(() => {
    const stopPage = api.onBrowserPage((p) => {
      setPage((before) => ({ ...p, title: p.title ?? (before?.url === p.url ? before.title : null) }));
      if (p.url.startsWith("http")) write(LAST_KEY, p.url);
    });
    const stopDownload = api.onBrowserDownload((d) => {
      // Chosen in Preferences › Browser: ebooks go straight in.
      if (d.ok && BOOK_FILE.test(d.name) && readBrowserPrefs().addWithoutAsking) {
        api.browserAddDownload(d.path).then(
          () => toast(`${d.name} is being added to your library.`),
          (e: unknown) => toast(String(e)),
        );
        return;
      }
      setDownloads((list) => [...list.filter((x) => x.path !== d.path), d]);
    });
    return () => {
      stopPage();
      stopDownload();
    };
  }, []);

  // The page shows over this tab's space, follows it as it moves, and
  // steps aside for menus and dialogs. It's hidden again on leaving.
  useEffect(() => {
    let live = true;
    let hidden = false;
    let placed = "";
    const fit = () => {
      if (!shown.current) return;
      const now = frame();
      const hide = covered() || !now;
      if (hide !== hidden) {
        hidden = hide;
        placed = hide ? "" : JSON.stringify(now);
        void (hide ? api.browserHide() : api.browserShow(null, now!));
      } else if (!hide && now && JSON.stringify(now) !== placed) {
        placed = JSON.stringify(now);
        void api.browserPlace(now);
      }
    };
    // Once laid out, so the space has its size.
    const starting = requestAnimationFrame(() => {
      const start = frame();
      if (!start) return;
      placed = JSON.stringify(start);
      api.browserShow(read(LAST_KEY) ?? readBrowserPrefs().home, start).then(
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
      cancelAnimationFrame(starting);
      resized.disconnect();
      watching.disconnect();
      window.removeEventListener("resize", fit);
      void api.browserHide();
    };
  }, []);

  const go = (text: string) => {
    const url = addressFor(text, readBrowserPrefs().search);
    if (!url) return;
    setEditing(false);
    void api.browserAct("go", url).catch((e: unknown) => toast(String(e)));
  };
  const goRef = useRef(go);
  goRef.current = go;
  useEffect(() => {
    const fromHeader = (e: Event) => goRef.current((e as CustomEvent<string>).detail);
    window.addEventListener(BROWSER_GO, fromHeader);
    return () => window.removeEventListener(BROWSER_GO, fromHeader);
  }, []);

  const url = page?.url ?? "";
  const marked = marks.find((m) => m.url === url) ?? null;
  const isFile = BOOK_FILE.test(url);

  const toggleMark = async () => {
    if (!url.startsWith("http")) return;
    try {
      if (marked) await api.removeBookmark(marked.id);
      else await api.addBookmark(page?.title?.trim() || url, url);
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

  const answer = async (d: BrowserDownload, how: "add" | "keep" | "drop") => {
    setDownloads((list) => list.filter((x) => x.path !== d.path));
    try {
      if (how === "add") {
        await api.browserAddDownload(d.path);
        toast(`${d.name} is being added to your library.`);
      } else if (how === "keep") {
        const where = await api.browserKeepDownload(d.path);
        toast(`Saved to ${where}`);
      } else await api.browserDiscardDownload(d.path);
    } catch (e) {
      toast(String(e));
    }
  };

  const sites = marks.length ? marks : SUGGESTED_SITES.map((s, i) => ({ id: `suggested-${i}`, ...s }));
  const bookmarkItems: MenuEntry[] = [
    { heading: <strong>{marks.length ? "Bookmarks" : "Book sites to start with"}</strong> },
    ...sites.map((m) => ({ label: m.title, icon: "globe" as const, onSelect: () => go(m.url) })),
    "divider",
    { label: "Make this page your home page", icon: "home", disabled: !url.startsWith("http"), onSelect: () => (writeBrowserPrefs({ home: url }), toast("This is your home page now.")) },
    { label: "Clear cookies and site data", icon: "trash", onSelect: () => void api.browserAct("clear").then(() => toast("Every site's cookies and data are cleared.")) },
  ];

  return (
    <div className="browser">
      <div className="browser-bar">
        <button type="button" className="toolbar-button" aria-label="Back" onClick={() => void api.browserAct("back")}>
          <Icon name="arrowLeft" size={17} />
        </button>
        <button type="button" className="toolbar-button" aria-label="Forward" onClick={() => void api.browserAct("forward")}>
          <Icon name="arrowRight" size={17} />
        </button>
        <button
          type="button"
          className="toolbar-button"
          aria-label={page?.loading ? "Stop" : "Reload"}
          onClick={() => void api.browserAct(page?.loading ? "stop" : "reload")}
        >
          <Icon name={page?.loading ? "close" : "sync"} size={16} />
        </button>
        <button type="button" className="toolbar-button" aria-label="Home page" onClick={() => go(readBrowserPrefs().home)}>
          <Icon name="home" size={16} />
        </button>
        <form
          className="browser-address"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            go(typed);
          }}
        >
          <input
            value={editing ? typed : url}
            onFocus={(e) => {
              setTyped(url);
              setEditing(true);
              requestAnimationFrame(() => e.target.select());
            }}
            onBlur={() => setEditing(false)}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="Search or type a web address"
            aria-label="Web address"
            inputMode="url"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
        </form>
        <button type="button" className={`toolbar-button${marked ? " is-on" : ""}`} aria-pressed={!!marked} aria-label={marked ? "Remove bookmark" : "Bookmark this page"} onClick={() => void toggleMark()}>
          <Icon name="bookmark" size={16} />
        </button>
        <Menu label="Bookmarks and more" className="toolbar-button" trigger={<Icon name="more" size={17} />} items={bookmarkItems} />
      </div>
      {isFile && (
        <div className="browser-offer" role="status">
          <span>This page is a {formatLabel(url.match(BOOK_FILE)![1].toLowerCase())} file.</span>
          <button type="button" className="btn btn-primary btn-small" onClick={() => void addThisFile()}>
            <Icon name="download" size={14} /> Add to library
          </button>
        </div>
      )}
      {downloads.map((d) => (
        <div key={d.path} className="browser-offer" role="status">
          {d.ok ? (
            <>
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
            </>
          ) : (
            <>
              <span>{d.name} didn't finish downloading.</span>
              <button type="button" className="btn btn-quiet btn-small" onClick={() => void answer(d, "drop")}>
                OK
              </button>
            </>
          )}
        </div>
      ))}
      <div className="browser-view" ref={area}>
        {problem && (
          <div className="library-empty" role="alert">
            <h2>The browser couldn't open</h2>
            <p className="muted">{problem}</p>
          </div>
        )}
      </div>
    </div>
  );
}

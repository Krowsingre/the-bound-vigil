import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, isApp } from "../api";
import type { Annotation, HighlightColor, Profile, ReaderBook, ReaderLocator, SyncStatus } from "../api/types";
import { Icon } from "../components/Icon";
import type { MenuEntry } from "../components/Menu";
import { useToast } from "../components/Toast";
import { onBeforeQuit } from "../lib/beforeQuit";
import { SyncMenu } from "../shell/SyncMenu";
import type { TocItem } from "../vendor/foliate-js/view.js";
import { isBookmark, isNote } from "./annotations";
import { contentsEntries, currentEntry, pageOf, pushJump, type Jump } from "./pages";
import { ReaderBottomBar, ReaderTopBar, ReturnPill, Popover } from "./ReaderBars";
import { LeftPanel, RightPanel, type AnnotationHandlers, type RightTab } from "./ReaderPanels";
import { NoteDialog, SelectionToolbar, TextSettings } from "./ReaderPopovers";
import { ReaderSearch } from "./ReaderSearch";
import { DEFAULT_SETTINGS, PAGE_COLORS, parseSettings, resolveTheme, SETTINGS_KEY, type ReaderSettings } from "./settings";
import { useReaderEngine, type TextSelection } from "./useReaderEngine";

export interface ReaderShellProps {
  sync: SyncStatus | null;
  profile: Profile | null;
  onImportBooks: () => void;
  onImportFolder: () => void;
  onOpenSyncSettings: () => void;
  onChooseAvatar: () => void;
  onClearAvatar: () => void;
}

const PANELS_KEY = "tbv.reader.panels";
const SAVE_DELAY_MS = 800;

function readPanels(): { left: boolean; right: boolean } {
  try {
    const saved = JSON.parse(localStorage.getItem(PANELS_KEY) ?? "null");
    if (saved && typeof saved.left === "boolean" && typeof saved.right === "boolean") return saved;
  } catch {
    /* fall through to the default */
  }
  return { left: true, right: true };
}

function usePrefersDark(): boolean {
  const query = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;
  const [dark, setDark] = useState(query?.matches ?? false);
  useEffect(() => {
    if (!query) return;
    const on = () => setDark(query.matches);
    query.addEventListener("change", on);
    return () => query.removeEventListener("change", on);
  }, [query]);
  return dark;
}

async function setWindowFullscreen(on: boolean) {
  if (isApp) {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().setFullscreen(on);
  } else if (on) await document.documentElement.requestFullscreen?.();
  else if (document.fullscreenElement) await document.exitFullscreen();
}

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

/** The reading screen. It replaces the sidebar and header while a book is open. */
export function Reader({
  bookId,
  openAt,
  shell,
  onClose,
}: {
  bookId: string;
  /** A place to go to once the book is open (a highlight from Notes). */
  openAt?: string;
  shell: ReaderShellProps;
  onClose: () => void;
}) {
  const toast = useToast();
  const [info, setInfo] = useState<ReaderBook | null>(null);
  const [file, setFile] = useState<Blob | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [settings, setSettings] = useState<ReaderSettings>(DEFAULT_SETTINGS);
  const [panels, setPanels] = useState(readPanels);
  const [rightTab, setRightTab] = useState<RightTab>("notes");
  const [focus, setFocus] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [jumps, setJumps] = useState<Jump[]>([]);
  const [selection, setSelection] = useState<TextSelection | null>(null);
  const [active, setActive] = useState<{ a: Annotation; rect: DOMRect } | null>(null);
  const [noteEdit, setNoteEdit] = useState<{ a?: Annotation; selection?: TextSelection } | null>(null);
  const [lastColor, setLastColor] = useState<HighlightColor>("rose");
  const host = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const prefersDark = usePrefersDark();

  // Load the book, its highlights and the reading settings, then the file.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [opened, list, saved] = await Promise.all([
          api.openBook(bookId),
          api.getAnnotations(bookId),
          api.getSetting(SETTINGS_KEY).catch(() => null),
        ]);
        if (cancelled) return;
        setInfo(opened);
        setAnnotations(list);
        setSettings(parseSettings(saved));
        const blob = await api.readBookFile(bookId);
        // The page engine tells formats apart partly by file name.
        if (!cancelled) setFile(new File([blob], `book.${opened.book.format}`, { type: blob.type }));
      } catch (e) {
        if (!cancelled) setLoadError(String(e instanceof Error ? e.message : e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bookId]);

  // Positions are saved shortly after the reader stops moving, and on leaving.
  const pending = useRef<ReaderLocator | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const flush = useCallback(() => {
    clearTimeout(timer.current);
    const locator = pending.current;
    pending.current = null;
    if (locator) return api.savePosition(bookId, locator).catch(() => undefined);
    return Promise.resolve();
  }, [bookId]);
  useEffect(() => {
    const unregister = onBeforeQuit(flush);
    return () => {
      unregister();
      void flush();
    };
  }, [flush]);

  const theme = resolveTheme(settings.theme, prefersDark);
  const colors = PAGE_COLORS[theme];

  const engine = useReaderEngine({
    host,
    file,
    startCfi: info?.book.resumeLocator?.cfi ?? null,
    settings,
    colors,
    annotations,
    events: {
      onRelocate: (r) => {
        const page = pageOf(r.location);
        pending.current = {
          cfi: r.cfi,
          totalProgression: r.fraction,
          pageIndex: page ? page.page - 1 : undefined,
          chapter: r.tocItem?.label?.trim() || undefined,
        };
        clearTimeout(timer.current);
        timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS);
      },
      onSelect: (s) => {
        setSelection(s);
        if (s) setActive(null);
      },
      onAnnotationClick: (cfi, rect) => {
        const a = annotations.find((x) => x.locator.cfi === cfi);
        if (a) {
          setSelection(null);
          setActive({ a, rect });
        }
      },
      onKey: (e) => onKeyRef.current(e, true),
    },
  });

  const r = engine.relocation;
  const position = pageOf(r?.location);
  const totalPages = position?.total ?? 0;
  const here = useCallback(
    (cfi: string): ReaderLocator => ({
      cfi,
      totalProgression: r?.fraction,
      pageIndex: position ? position.page - 1 : undefined,
      chapter: r?.tocItem?.label?.trim() || undefined,
    }),
    [r, position],
  );

  const entries = useMemo(
    () => contentsEntries(engine.toc as TocItem[], engine.sectionOf, engine.sectionStarts, totalPages),
    [engine.toc, engine.sectionOf, engine.sectionStarts, totalPages],
  );
  const current = currentEntry(entries, r?.tocItem?.href);

  // Jumps remember where you were, for "Return to previous location".
  const remember = useCallback(() => {
    if (r?.cfi) setJumps((j) => pushJump(j, { cfi: r.cfi, page: position?.page ?? null }));
  }, [r, position]);
  const jumpTo = useCallback(
    (target: string) => {
      remember();
      setSelection(null);
      setActive(null);
      void engine.goTo(target);
    },
    [remember, engine],
  );
  // Opening at a highlight still remembers where you were reading, so
  // "Return to previous location" takes you back there.
  const openedAt = useRef(false);
  useEffect(() => {
    if (!openAt || openedAt.current || !engine.ready || !r?.cfi) return;
    openedAt.current = true;
    jumpTo(openAt);
  }, [openAt, engine.ready, r, jumpTo]);

  const goBack = () => {
    const last = jumps.at(-1);
    if (!last) return;
    setJumps((j) => j.slice(0, -1));
    void engine.goTo(last.cfi);
  };

  const turn = useCallback(
    (forward: boolean) => {
      setSelection(null);
      setActive(null);
      void (forward ? engine.next() : engine.prev());
    },
    [engine],
  );

  const pagePanels = (change: Partial<typeof panels>) =>
    setPanels((p) => {
      const next = { ...p, ...change };
      try {
        localStorage.setItem(PANELS_KEY, JSON.stringify(next));
      } catch {
        /* not remembered */
      }
      return next;
    });

  const changeSettings = (change: Partial<ReaderSettings>) =>
    setSettings((s) => {
      const next = { ...s, ...change };
      void api.setSetting(SETTINGS_KEY, JSON.stringify(next)).catch(() => undefined);
      return next;
    });

  // Highlights, notes and bookmarks.
  const store = async (work: Promise<Annotation>) => {
    try {
      const saved = await work;
      setAnnotations((list) => [...list.filter((a) => a.id !== saved.id), saved]);
      return saved;
    } catch (e) {
      toast(`That wasn't saved: ${String(e)}`);
      return null;
    }
  };
  const highlight = async (s: TextSelection, color: HighlightColor, note?: string) => {
    setLastColor(color);
    setSelection(null);
    engine.deselect();
    await store(api.saveAnnotation({ bookId: info!.book.id, kind: "highlight", excerpt: s.text, color, note, locator: here(s.cfi) }));
  };
  const update = (a: Annotation, change: Partial<Pick<Annotation, "color" | "note">>) =>
    store(
      api.saveAnnotation({
        id: a.id,
        bookId: a.bookId,
        kind: a.kind,
        excerpt: a.excerpt,
        color: change.color !== undefined ? change.color : a.color,
        note: change.note !== undefined ? change.note : a.note,
        locator: a.locator,
      }),
    );
  const remove = async (a: Annotation) => {
    try {
      await api.deleteAnnotation(a.id);
      setAnnotations((list) => list.filter((x) => x.id !== a.id));
      setActive(null);
    } catch (e) {
      toast(`That wasn't deleted: ${String(e)}`);
    }
  };
  const copy = (text: string) =>
    void navigator.clipboard?.writeText(text).then(
      () => toast("Copied."),
      () => toast("Copying isn't available here."),
    );

  const handlers: AnnotationHandlers = {
    onGo: (a) => a.locator.cfi && jumpTo(a.locator.cfi),
    onEditNote: (a) => setNoteEdit({ a }),
    onRecolor: (a, color) => void update(a, { color }),
    onDelete: (a) => void remove(a),
    onCopy: (a) => copy(a.excerpt),
  };

  const bookmarkHere = annotations.find((a) => isBookmark(a) && position && a.locator.pageIndex === position.page - 1);
  const toggleBookmark = useCallback(() => {
    if (!info || !r?.cfi) return;
    if (bookmarkHere) {
      void remove(bookmarkHere);
      return;
    }
    const words = r.range ? pageWords(r.range) : "";
    void store(
      api.saveAnnotation({
        bookId: info.book.id,
        kind: "bookmark",
        excerpt: words.length > 90 ? `${words.slice(0, 90).trimEnd()}…` : words,
        locator: here(r.cfi),
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info, r, bookmarkHere, here]);

  const toggleFullscreen = useCallback(() => {
    const next = !fullscreen;
    setFullscreen(next);
    void setWindowFullscreen(next).catch(() => setFullscreen(!next));
  }, [fullscreen]);

  const leave = useCallback(() => {
    if (fullscreen) void setWindowFullscreen(false);
    void flush().then(onClose);
  }, [flush, onClose, fullscreen]);

  // Keyboard: the window's keys, plus keys pressed inside the book's pages.
  const onKeyRef = useRef<(e: KeyboardEvent, fromBook: boolean) => void>(() => {});
  onKeyRef.current = (e, fromBook) => {
    if (noteEdit) return;
    if (!fromBook && isTyping(e.target) && e.key !== "Escape") return;
    const ctrl = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (ctrl && (key === "k" || key === "f")) {
      if (focus) setFocus(false);
      setTimeout(() => searchInput.current?.focus(), 0);
    } else if (ctrl && key === "b") toggleBookmark();
    else if (e.key === "F11") toggleFullscreen();
    else if (e.key === "Escape") {
      if (selection || active) {
        setSelection(null);
        setActive(null);
        engine.deselect();
      } else if (fullscreen) toggleFullscreen();
      else if (focus) setFocus(false);
      else return;
    } else if (ctrl || e.altKey) return;
    else if (key === "f") setFocus((f) => !f);
    else if (e.key === "ArrowLeft") turn(false);
    else if (e.key === "ArrowRight") turn(true);
    else if (settings.flow === "paginated" && (e.key === "PageUp" || (e.key === " " && e.shiftKey))) turn(false);
    else if (settings.flow === "paginated" && (e.key === "PageDown" || e.key === " ")) turn(true);
    else return;
    e.preventDefault();
  };
  useEffect(() => {
    const on = (e: KeyboardEvent) => onKeyRef.current(e, false);
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  if (loadError) {
    return (
      <div className="reader reader-message">
        <ReaderTopBarFallback onHome={onClose} />
        <div className="reader-message-body">
          <Icon name="warning" size={28} />
          <h1>This book couldn't be opened</h1>
          <p>{loadError}</p>
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Back to Home
          </button>
        </div>
      </div>
    );
  }

  const menu: MenuEntry[] = [
    { label: "Focus mode", icon: "focus", hint: "F", onSelect: () => setFocus(true) },
    { label: panels.left ? "Hide contents panel" : "Show contents panel", icon: "panelLeft", onSelect: () => pagePanels({ left: !panels.left }) },
    {
      label: "Book info",
      icon: "info",
      onSelect: () => {
        setRightTab("info");
        pagePanels({ right: true });
      },
    },
    "divider",
    info?.book.status === "read"
      ? {
          label: "Mark as not finished",
          onSelect: () => void api.setBookStatus(info.book.id, "in_progress").then(() => toast("Marked as in progress.")),
        }
      : {
          label: "Mark as read",
          icon: "check",
          onSelect: () => info && void api.setBookStatus(info.book.id, "read").then(() => toast("Marked as read.")),
        },
    "divider",
    { label: "Close book", icon: "close", onSelect: leave },
  ];

  const showLeft = !focus && panels.left && !!info;
  const showRight = !focus && panels.right && !!info;
  const noteCount = annotations.filter((a) => !isBookmark(a)).length;

  return (
    <div
      className={`reader theme-${theme}${focus ? " is-focus" : ""}${showLeft ? " has-left" : ""}${showRight ? " has-right" : ""}`}
      style={{ ["--page-bg" as string]: colors.background, ["--page-text" as string]: colors.text, ["--page-muted" as string]: colors.muted }}
    >
      <ReaderTopBar
        title={info?.book.title ?? ""}
        authors={info?.book.authors ?? []}
        focus={focus}
        onHome={leave}
        search={<ReaderSearch ref={searchInput} run={engine.search} clear={engine.clearSearch} onGo={jumpTo} />}
        textSettings={
          <Popover label="Text settings" trigger={<span className="aa">Aa</span>} className="text-settings-popover">
            <TextSettings settings={settings} onChange={changeSettings} />
          </Popover>
        }
        bookmarked={!!bookmarkHere}
        onToggleBookmark={toggleBookmark}
        notesOpen={showRight}
        noteCount={noteCount}
        onToggleNotes={() => {
          setRightTab("notes");
          pagePanels({ right: !(panels.right && rightTab === "notes") });
        }}
        menu={menu}
        avatar={<SyncMenu {...shell} />}
        fullscreen={fullscreen}
        onToggleFullscreen={toggleFullscreen}
        onExitFocus={() => setFocus(false)}
      />
      <div className="reader-body">
        {showLeft && info && (
          <LeftPanel
            book={info.book}
            fraction={r?.fraction ?? info.book.totalProgression}
            position={position}
            previouslyOpenedAt={info.previouslyOpenedAt}
            entries={entries}
            currentId={current?.id ?? null}
            annotations={annotations}
            onGoHref={jumpTo}
            handlers={handlers}
          />
        )}
        <main className="reader-main">
          {jumps.length > 0 && !focus && <ReturnPill jump={jumps.at(-1)!} onReturn={goBack} onDismiss={() => setJumps([])} />}
          <div className="reader-host" ref={host} aria-busy={!engine.ready} />
          {!engine.ready && !engine.error && <p className="reader-loading">Opening the book…</p>}
          {engine.error && (
            <div className="reader-message-body">
              <Icon name="warning" size={28} />
              <h1>This book couldn't be shown</h1>
              <p>{engine.error}</p>
            </div>
          )}
          <ReaderBottomBar
            position={position}
            fraction={r?.fraction ?? 0}
            chapter={r?.tocItem?.label?.trim() ?? null}
            onSeek={(f) => {
              remember();
              void engine.goToFraction(f);
            }}
            onPrev={() => turn(false)}
            onNext={() => turn(true)}
            focus={focus}
          />
        </main>
        {showRight && info && (
          <RightPanel
            tab={rightTab}
            onTab={setRightTab}
            onClose={() => pagePanels({ right: false })}
            annotations={annotations}
            totalPages={totalPages}
            handlers={handlers}
            info={info}
          />
        )}
      </div>
      {selection && (
        <SelectionToolbar
          rect={selection.rect}
          onColor={(c) => void highlight(selection, c)}
          onNote={() => setNoteEdit({ selection })}
          onCopy={() => copy(selection.text)}
        />
      )}
      {active && (
        <SelectionToolbar
          rect={active.rect}
          activeColor={active.a.color}
          hasNote={isNote(active.a)}
          onColor={(c) => {
            void update(active.a, { color: c });
            setActive(null);
          }}
          onNote={() => {
            setNoteEdit({ a: active.a });
            setActive(null);
          }}
          onCopy={() => copy(active.a.excerpt)}
          onDelete={() => void remove(active.a)}
        />
      )}
      {noteEdit && (
        <NoteDialog
          excerpt={noteEdit.a?.excerpt ?? noteEdit.selection?.text ?? ""}
          initial={noteEdit.a?.note ?? ""}
          onCancel={() => setNoteEdit(null)}
          onSave={(note) => {
            if (noteEdit.a) void update(noteEdit.a, { note });
            else if (noteEdit.selection) void highlight(noteEdit.selection, lastColor, note);
            setNoteEdit(null);
          }}
        />
      )}
    </div>
  );
}

function ReaderTopBarFallback({ onHome }: { onHome: () => void }) {
  return (
    <header className="reader-top" data-tauri-drag-region>
      <button type="button" className="icon-btn" aria-label="Back to Home" title="Back to Home" onClick={onHome}>
        <Icon name="home" size={20} />
      </button>
      <span className="reader-top-spacer" data-tauri-drag-region />
    </header>
  );
}

/** The words a page starts with, skipping headings so a bookmark reads like the text. */
function pageWords(range: Range): string {
  const root = range.commonAncestorContainer;
  const doc = root.ownerDocument ?? (root as Document);
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let text = "";
  for (let n = walker.currentNode; n && text.length < 200; n = walker.nextNode()!) {
    if (n.nodeType !== Node.TEXT_NODE || !range.intersectsNode(n)) continue;
    if (n.parentElement?.closest("h1,h2,h3,h4,h5,h6,.part,.sub,header")) continue;
    let value = n.nodeValue ?? "";
    if (n === range.startContainer) value = value.slice(range.startOffset);
    text += ` ${value}`;
  }
  const words = text.replace(/\s+/g, " ").trim();
  return words || range.toString().replace(/\s+/g, " ").trim();
}

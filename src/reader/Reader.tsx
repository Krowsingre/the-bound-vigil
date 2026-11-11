import { offerFinishedDownloadRemoval } from "../library/FinishedDownloadPrompt";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, isApp, isIOS, isMac } from "../api";
import { isNarrow, useNarrow } from "../lib/useNarrow";
import type { Annotation, HighlightColor, Profile, ReadStatus, ReaderBook, ReaderLocator, SyncStatus, WordDefinition } from "../api/types";
import { Icon } from "../components/Icon";
import type { MenuEntry } from "../components/Menu";
import { useToast } from "../components/Toast";
import { onBeforeQuit } from "../lib/beforeQuit";
import { noteReading, recordReading } from "../lib/recordTime";
import { SyncMenu } from "../shell/SyncMenu";
import type { TocItem } from "../vendor/foliate-js/view.js";
import { isBookmark, isNote } from "./annotations";
import { formatLabel, isDocument } from "../lib/queryBooks";
import { drawPdfCover, readerSource, type ReaderSource } from "./formats";
import { contentsEntries, currentEntry, pageOf, pushJump, type Jump } from "./pages";
import { parseBibleTarget } from "../browse/bibleBooks";
import { openChapter } from "../browse/openChapter";
import { ReaderBottomBar, ReaderTopBar, ReturnPill, Popover } from "./ReaderBars";
import { LeftPanel, RightPanel, type AnnotationHandlers, type LeftTab, type RightTab } from "./ReaderPanels";
import { navigationDirection } from "../shell/navigationKeys";
import { DefineCard, ListenAlongPanel, NoteDialog, PageSettings, ReadAloudPlayer, SelectionToolbar, TextSettings, ZoomControls } from "./ReaderPopovers";
import { addressFor, readBrowserPrefs } from "../browse/browserPrefs";
import { ReaderSearch } from "./ReaderSearch";
import { canTranslateInReader, TranslatePanel } from "./TranslatePanel";
import { BOOK_OPENED, useAppDark } from "../settings/appSettings";
import { DEFAULT_SETTINGS, PAGE_COLORS, parseSettings, resolveTheme, SETTINGS_KEY, zoomStep, type ReaderSettings } from "./settings";
import { useKeyboardScroll } from "./useKeyboardScroll";
import { useReadAloud } from "./useReadAloud";
import { useReadAlong } from "./useReadAlong";
import { StructuredViewer } from "./StructuredViewer";
import type { StructuredContent } from "./structuredContent";
import { useReaderEngine, type TextSelection } from "./useReaderEngine";

export interface ReaderShellProps {
  sync: SyncStatus | null;
  profile: Profile | null;
  onImportBooks: () => void;
  onImportFolder: () => void;
  onOpenSyncSettings: () => void;
  onOpenProfile: () => void;
  onOpenPlan?: () => void;
  /** Leaves the book for a new Discover tab at this address (Search, and Translate where Apple's isn't there). */
  onOpenWeb?: (url: string) => void;
}

const PANELS_KEY = "tbv.reader.panels";

/** iPhone, iPad and Mac, which have Apple's own dictionary and translation. */
const isApple = isIOS || isMac;

/** Google Translate for the words, into the language TBV's device is set to. */
export function googleTranslate(words: string): string {
  const to = (typeof navigator !== "undefined" ? navigator.language : "en").split("-")[0] || "en";
  return `https://translate.google.com/?sl=auto&tl=${encodeURIComponent(to)}&text=${encodeURIComponent(words)}&op=translate`;
}
const SAVE_DELAY_MS = 800;

function readPanels(): { left: boolean; right: boolean } {
  // On a phone the panels cover the page, so it opens on the text alone.
  if (isNarrow()) return { left: false, right: false };
  try {
    const saved = JSON.parse(localStorage.getItem(PANELS_KEY) ?? "null");
    if (saved && typeof saved.left === "boolean" && typeof saved.right === "boolean") return saved;
  } catch {
    /* fall through to the default */
  }
  return { left: true, right: true };
}

async function setWindowFullscreen(on: boolean) {
  if (isApp) {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().setFullscreen(on);
  } else if (on) await document.documentElement.requestFullscreen?.();
  else if (document.fullscreenElement) await document.exitFullscreen();
}

const isTyping = (target: EventTarget | null) => {
  const element = target as HTMLElement | null;
  return !!(element?.isContentEditable || element?.matches?.("input, textarea, select"));
};

/** The reading screen. It replaces the sidebar and header while a book is open. */
export function Reader({
  bookId,
  fileId,
  openAt,
  compact = false,
  shell,
  onClose,
}: {
  bookId: string;
  /** One of the book's files, when copies in other formats are kept with it. */
  fileId?: string;
  /** A place to go to once the book is open (a highlight from Notes). */
  openAt?: string;
  compact?: boolean;
  shell: ReaderShellProps;
  onClose: () => void;
}) {
  const toast = useToast();
  const [info, setInfo] = useState<ReaderBook | null>(null);
  const [file, setFile] = useState<ReaderSource | null>(null);
  // The format of the file open now, when it isn't the book's own.
  const [fileFormat, setFileFormat] = useState<string | null>(null);
  const [openedFile, setOpenedFile] = useState<{ id: string; format: string } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [settings, setSettings] = useState<ReaderSettings>(DEFAULT_SETTINGS);
  const [widePanels, setWidePanels] = useState(readPanels);
  const [compactPanels, setCompactPanels] = useState({ left: false, right: false });
  const panels = compact ? compactPanels : widePanels;
  const setPanels = compact ? setCompactPanels : setWidePanels;
  const [rightTab, setRightTab] = useState<RightTab>("notes");
  const [leftTab, setLeftTab] = useState<LeftTab>("contents");
  const [contentsRequest, setContentsRequest] = useState(0);
  const [focus, setFocus] = useState(false);
  // Phones: the search box is hidden in the top bar and opened from the menu.
  const [phoneSearch, setPhoneSearch] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [jumps, setJumps] = useState<Jump[]>([]);
  const [selection, setSelection] = useState<TextSelection | null>(null);
  const [defining, setDefining] = useState<{ text: string; rect: DOMRect; definitions: WordDefinition[] } | null>(null);
  const closeDefining = useCallback(() => setDefining(null), []);
  /** Google Translate in a panel beside the book (Windows), for these words. */
  const [translating, setTranslating] = useState<string | null>(null);
  const closeTranslating = useCallback(() => setTranslating(null), []);
  const [active, setActive] = useState<{ a: Annotation; rect: DOMRect } | null>(null);
  const [noteEdit, setNoteEdit] = useState<{ a?: Annotation; selection?: TextSelection } | null>(null);
  const [lastColor, setLastColor] = useState<HighlightColor>("rose");
  const host = useRef<HTMLDivElement>(null);
  const [expandedContent, setExpandedContent] = useState<{ content: StructuredContent; cfi?: string; width: number; height: number } | null>(null);
  useEffect(() => setExpandedContent(null), [file]);
  const searchInput = useRef<HTMLInputElement>(null);
  const prefersDark = useAppDark();
  const narrowViewport = useNarrow();
  const narrow = compact || narrowViewport;

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
        window.dispatchEvent(new Event(BOOK_OPENED));
        setInfo(opened);
        setAnnotations(list);
        setSettings(parseSettings(saved));
        const { title, authors, coverPath } = opened.book;
        // With copies kept together: the file asked for, the one a mark
        // being opened was made in, or else the one last read.
        const lastIn = (openAt ? list.find((a) => a.locator.cfi === openAt)?.locator : opened.book.resumeLocator)?.format;
        const chosen =
          fileId || (lastIn && lastIn !== opened.book.format)
            ? (await api.bookFiles(bookId).catch(() => [])).find((f) => (fileId ? f.id === fileId : f.format === lastIn))
            : undefined;
        if (cancelled) return;
        const reading = chosen ?? { id: bookId, format: opened.book.format };
        setFileFormat(reading.format === opened.book.format ? null : reading.format);
        const blob = await api.readBookFile(reading.id);
        const format = reading.format;
        // The page engine tells formats apart partly by file name.
        // A CBR arrives already made into a zip.
        const opensAs = format === "cbr" ? "cbz" : format;
        const named = new File([blob], `book.${opensAs}`, { type: blob.type });
        const source = await readerSource(named, opensAs, reading.id, { title, author: authors.join(", "), language: opened.language });
        if (!cancelled) {
          setFile(source);
          setOpenedFile(reading);
        }
        // A PDF imported elsewhere, or whose cover couldn't be drawn then.
        if (format === "pdf" && !coverPath && reading.id === bookId) {
          void drawPdfCover(blob)
            .then(async (cover) => cover && api.fillCover(bookId, new Uint8Array(await cover.arrayBuffer())))
            .catch(() => undefined);
        }
      } catch (e) {
        if (!cancelled) setLoadError(String(e instanceof Error ? e.message : e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bookId, fileId]);

  // A place or mark is found by its CFI only in the format it was made in;
  // in another of the book's files it's found by how far through it was.
  const mainFormat = info?.book.format;
  const usable = useCallback(
    (at: ReaderLocator | null | undefined) => !!at?.cfi && (at.format ?? mainFormat) === (fileFormat ?? mainFormat),
    [mainFormat, fileFormat],
  );
  const drawn = useMemo(() => annotations.filter((a) => usable(a.locator)), [annotations, usable]);

  // Positions are saved shortly after the reader stops moving, and on leaving.
  const pending = useRef<ReaderLocator | null>(null);
  const reportPosition = useRef<() => void>(() => undefined);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const flush = useCallback(() => {
    clearTimeout(timer.current);
    const locator = pending.current;
    pending.current = null;
    if (locator) return api.savePosition(bookId, locator).catch(() => undefined);
    return Promise.resolve();
  }, [bookId]);
  useEffect(() => {
    const unregister = onBeforeQuit(() => {
      reportPosition.current();
      return flush();
    });
    return () => {
      unregister();
      void flush();
    };
  }, [flush]);

  const theme = resolveTheme(settings.theme, prefersDark);
  const colors = PAGE_COLORS[theme];

  // Set below; the page engine reports zooming before that's defined.
  const changeSettingsRef = useRef<(change: Partial<ReaderSettings>) => void>(() => {});
  // Time read counts while the book is open on screen and being read.
  useEffect(() => recordReading(), []);

  const engine = useReaderEngine({
    host,
    file,
    startCfi: usable(info?.book.resumeLocator) ? info!.book.resumeLocator!.cfi! : null,
    settings,
    colors,
    annotations: drawn,
    events: {
      onRelocate: (r) => {
        noteReading();
        const page = pageOf(r.location);
        pending.current = {
          cfi: r.cfi,
          totalProgression: r.fraction,
          pageIndex: page ? page.page - 1 : undefined,
          chapter: r.tocItem?.label?.trim() || undefined,
          format: fileFormat ?? undefined,
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
      onKey: (e) => onKeyRef.current(e),
      onKeyUp: (e) => keyScrollRef.current(e),
      onZoom: (pageZoom) => changeSettingsRef.current({ pageZoom }),
    },
  });

  const bookLang = info?.language ?? null;
  const readAloud = useReadAloud({
    getView: engine.getView,
    ready: engine.ready,
    lang: bookLang,
    voices: settings.voices,
    rate: settings.rate,
    dark: theme === "dark" || theme === "vesper",
  });
  const readAlong = useReadAlong({
    getView: engine.getView,
    ready: engine.ready,
    bookId,
    dark: theme === "dark" || theme === "vesper",
    manual: !!info && isDocument(info.book.format),
    format: info?.book.format,
    onStart: readAloud.stop,
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
      format: fileFormat ?? undefined,
    }),
    [r, position, fileFormat],
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
    // A chapter of the Bible, from Browse › Bible.
    const chapter = parseBibleTarget(openAt);
    if (chapter) {
      const view = engine.getView();
      remember();
      if (view)
        void openChapter(view, engine.toc as TocItem[], chapter.book, chapter.chapter).then(
          (found) => !found && toast(`${chapter.book.name} ${chapter.chapter} couldn't be found in this copy, so it opened where you were.`),
          () => undefined,
        );
      return;
    }
    const mark = annotations.find((a) => a.locator.cfi === openAt);
    if (mark && !usable(mark.locator)) handlers.onGo(mark);
    else jumpTo(openAt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openAt, engine.ready, r, jumpTo]);

  // A place from another of the book's files (an EPUB's in this PDF, say)
  // opens by how far through it was.
  const startedFar = useRef(false);
  useEffect(() => {
    const at = info?.book.resumeLocator;
    if (startedFar.current || !engine.ready || openAt || !at || usable(at) || !at.totalProgression) return;
    startedFar.current = true;
    void engine.goToFraction(at.totalProgression);
  }, [engine, info, openAt, usable]);

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
      if (narrow) return { left: change.right ? false : next.left, right: change.left ? false : next.right };
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
  changeSettingsRef.current = changeSettings;

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

  // Define, Search and Translate, for selected words or a highlight's words.
  const spotOf = (rect: DOMRect) => {
    // In the second pane of a split, the pane's own place in TBV's window is added.
    const pane = window.frameElement?.getBoundingClientRect();
    return { x: rect.left + (pane?.left ?? 0), y: rect.top + (pane?.top ?? 0), width: rect.width, height: rect.height };
  };
  const define = (text: string, rect: DOMRect) => {
    setSelection(null);
    setActive(null);
    api.lookUpWord(text, spotOf(rect)).then(
      (found) => !found.shown && setDefining({ text: text.trim(), rect, definitions: found.definitions }),
      (e: unknown) => toast(`The dictionary couldn't be opened: ${String(e)}`),
    );
  };
  const searchWeb = (text: string) => {
    const url = addressFor(text.trim().replace(/\s+/g, " "), readBrowserPrefs().search);
    if (!url || !shell.onOpenWeb) return;
    setDefining(null);
    shell.onOpenWeb(url);
  };
  const translate = (text: string, rect: DOMRect) => {
    setSelection(null);
    setActive(null);
    const words = text.trim().replace(/\s+/g, " ");
    const inDiscover = () => (canTranslateInReader() ? setTranslating(words) : shell.onOpenWeb?.(googleTranslate(words)));
    api.translateText(words, spotOf(rect)).then((shown) => !shown && inDiscover(), inDiscover);
  };
  const lookUps = (text: string, rect: DOMRect) => ({
    onDefine: () => define(text, rect),
    onSearch: shell.onOpenWeb ? () => searchWeb(text) : undefined,
    onTranslate: shell.onOpenWeb || isApple || canTranslateInReader() ? () => translate(text, rect) : undefined,
  });

  const handlers: AnnotationHandlers = {
    onGo: (a) => {
      if (usable(a.locator)) return jumpTo(a.locator.cfi!);
      // Marked in another of the book's files: found by how far through it is.
      if (a.locator.totalProgression != null) {
        remember();
        void engine.goToFraction(a.locator.totalProgression);
      }
    },
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
    reportPosition.current();
    void flush().then(onClose);
  }, [flush, onClose, fullscreen]);

  const [autoScrolling, setAutoScrolling] = useState(false);
  const scrolling = (engine.fixed ? settings.pageFlow : settings.flow) === "scrolled";
  const { scrollByPixels } = engine;
  reportPosition.current = () => engine.getView()?.renderer.reportPosition?.();
  useEffect(() => {
    if (!autoScrolling || !scrolling || !engine.ready || expandedContent || noteEdit) return;
    let frame = 0;
    let previous = performance.now();
    let remainder = 0;
    const tick = (now: number) => {
      if (!document.hidden) {
        remainder += Math.min(50, Math.max(0, now - previous)) * settings.autoScrollSpeed * 0.004;
        const pixels = Math.floor(remainder);
        if (pixels) scrollByPixels(pixels);
        remainder -= pixels;
      }
      previous = now;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [autoScrolling, scrolling, engine.ready, scrollByPixels, expandedContent, noteEdit, settings.autoScrollSpeed]);
  const keyboardScroll = useKeyboardScroll(scrollByPixels, settings.keyboardScrollSpeed, engine.ready && scrolling && !expandedContent && !noteEdit);
  const keyScrollRef = useRef(keyboardScroll.release);
  keyScrollRef.current = keyboardScroll.release;

  // Keyboard: the window's keys, plus keys pressed inside the book's pages.
  const onKeyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  onKeyRef.current = (e) => {
    if (noteEdit || expandedContent || e.defaultPrevented) return;
    const backKey = navigationDirection(e, true) === "back";
    if (isTyping(e.target) && e.key !== "Escape" && !backKey) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (ctrl && (e.code === "Space" || key === " ") && !e.altKey && !e.shiftKey) {
      if (!e.repeat && engine.ready) {
        if (!autoScrolling && !scrolling) changeSettings(engine.fixed ? { pageFlow: "scrolled" } : { flow: "scrolled" });
        setAutoScrolling(!autoScrolling);
        if (autoScrolling) {
          reportPosition.current();
          void flush();
        }
      }
    } else if (ctrl && engine.fixed && (key === "=" || key === "+" || key === "-" || key === "0")) {
      // Zoom for PDFs and comics, in place of the window's own zoom.
      changeSettings({ pageZoom: key === "0" ? "fit-page" : zoomStep(engine.scale, key === "-" ? -1 : 1) });
    } else if (ctrl && (key === "k" || key === "f")) {
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
    } else if (backKey) {
      // Back: to where a link jumped from, else out of the book.
      if (jumps.length) goBack();
      else leave();
    } else if (ctrl || e.altKey) return;
    else if (key === "f") setFocus((f) => !f);
    else if (key === "r") {
      if (readAloud.unavailable) toast(readAloud.unavailable);
      else readAloud.toggle();
    }
    else if (e.key === "ArrowLeft") turn(false);
    else if (e.key === "ArrowRight") turn(true);
    else if (!e.shiftKey && (engine.fixed || settings.flow === "scrolled") && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      const direction = e.key === "ArrowUp" ? -1 : 1;
      if (engine.fixed && !scrolling) engine.scrollStep(direction);
      else keyboardScroll.press(direction, e.repeat);
    }
    // In scroll mode these move the long page on by a screen.
    else if (e.key === "PageUp" || (e.key === " " && e.shiftKey)) turn(false);
    else if (e.key === "PageDown" || e.key === " ") turn(true);
    else return;
    e.preventDefault();
  };
  useEffect(() => {
    const on = (e: KeyboardEvent) => onKeyRef.current(e);
    window.addEventListener("keydown", on);
    const up = (e: KeyboardEvent) => keyScrollRef.current(e);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", on);
      window.removeEventListener("keyup", up);
    };
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
            Back to Sanctum
          </button>
        </div>
      </div>
    );
  }

  // Keeps the menu in step with the book's status after a change.
  const markStatus = (status: ReadStatus, done: string) =>
    info &&
    api.setBookStatus(info.book.id, status).then(
      () => {
        setInfo((i) => (i ? { ...i, book: { ...i.book, status } } : i));
        const finished = status !== info.book.status && (status === "read" || status === "dropped");
        const notify = () => toast(done, finished ? {
          label: "Undo",
          run: () => void api.setBookStatus(info.book.id, info.book.status).then(() => {
            setInfo((i) => (i ? { ...i, book: { ...i.book, status: info.book.status } } : i));
          }, (error: unknown) => toast(String(error))),
        } : undefined);
        if (!offerFinishedDownloadRemoval(info.book, status, onClose, notify)) notify();
      },
      (e: unknown) => toast(String(e)),
    );

  const menu: MenuEntry[] = [
    ...(narrow ? [{ label: "Search in this book", icon: "search" as const, onSelect: () => setPhoneSearch(true) }] : []),
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
      ? { label: "Mark as not finished", onSelect: () => void markStatus("in_progress", "Marked as in progress.") }
      : { label: "Mark as read", icon: "check", onSelect: () => void markStatus("read", "Marked as read.") },
    info?.book.status === "dropped"
      ? { label: "Not dropped after all", onSelect: () => void markStatus("in_progress", "Marked as in progress.") }
      : { label: "Mark as dropped", icon: "close", onSelect: () => void markStatus("dropped", "Marked as dropped.") },
    "divider",
    ...(openedFile && engine.ready ? [{
      label: `Save a copy (${formatLabel(openedFile.format)})`,
      icon: "download" as const,
      onSelect: () => void api.saveCopies([openedFile.id]).then(
        (done) => done && toast(`Saved a copy to ${done.folder}.`),
        (e: unknown) => toast(`Couldn't save a copy: ${String(e)}`),
      ),
    }] : []),
    { label: "Close book", icon: "close", onSelect: leave },
  ];

  const showLeft = !focus && panels.left && !!info;
  const showRight = !focus && panels.right && !!info;
  const noteCount = annotations.filter((a) => !isBookmark(a)).length;

  return (
    <div
      className={`reader theme-${theme}${compact ? " is-compact" : ""}${focus ? " is-focus" : ""}${showLeft ? " has-left" : ""}${showRight ? " has-right" : ""}`}
      style={{ ["--page-bg" as string]: colors.background, ["--page-text" as string]: colors.text, ["--page-muted" as string]: colors.muted }}
    >
      <ReaderTopBar
        title={info?.book.title ?? ""}
        authors={info?.book.authors ?? []}
        focus={focus}
        onHome={leave}
        search={<ReaderSearch ref={searchInput} run={engine.search} clear={engine.clearSearch} onGo={jumpTo} />}
        textSettings={
          engine.fixed ? (
            <Popover label="Page settings" trigger={<Icon name="sliders" size={20} />} className="text-settings-popover">
              <PageSettings settings={settings} scale={engine.scale} onChange={changeSettings} />
            </Popover>
          ) : (
            <Popover label="Text settings" trigger={<span className="aa">Aa</span>} className="text-settings-popover">
              <TextSettings settings={settings} onChange={changeSettings} />
            </Popover>
          )
        }
        readAloud={
          <>
          {readAlong.audiobookId && (
            <Popover
              label="Listen along"
              title={
                readAlong.manual
                  ? "Listen along: play the audiobook and turn the pages yourself"
                  : readAlong.following
                    ? "Following the audiobook"
                    : "Listen along: play the audiobook and follow it here"
              }
              trigger={<Icon name="headphones" size={20} />}
              className="read-aloud-popover"
              on={readAlong.following || (readAlong.manual && readAlong.playing)}
            >
              <ListenAlongPanel readAlong={readAlong} ebookId={bookId} />
            </Popover>
          )}
          <Popover
            label="Read aloud"
            title={readAloud.unavailable ?? (readAloud.status === "playing" ? "Read aloud: reading (R to pause)" : "Read aloud (R)")}
            trigger={<Icon name="readAloud" size={20} />}
            className="read-aloud-popover"
            on={readAloud.status !== "stopped"}
            muted={!!readAloud.unavailable}
          >
            <ReadAloudPlayer readAloud={readAloud} lang={bookLang} settings={settings} onChange={changeSettings} />
          </Popover>
          </>
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
            key={info.book.id}
            book={info.book}
            fraction={r?.fraction ?? info.book.totalProgression}
            position={position}
            previouslyOpenedAt={info.previouslyOpenedAt}
            entries={entries}
            currentId={current?.id ?? null}
            tab={leftTab}
            onTab={setLeftTab}
            revealRequest={contentsRequest}
            annotations={annotations}
            onGoHref={(href) => {
              void jumpTo(href);
              if (narrow) pagePanels({ left: false });
            }}
            handlers={handlers}
          />
        )}
        <main className="reader-main">
          {narrow && phoneSearch && !focus && (
            <div className="reader-phone-search">
              <ReaderSearch run={engine.search} clear={engine.clearSearch} onGo={jumpTo} autoFocus />
              <button type="button" className="icon-btn" aria-label="Close search" onClick={() => { engine.clearSearch(); setPhoneSearch(false); }}>
                <Icon name="close" size={18} />
              </button>
            </div>
          )}
          {jumps.length > 0 && !focus && <ReturnPill jump={jumps.at(-1)!} onReturn={goBack} onDismiss={() => setJumps([])} />}
          <div className="reader-host" ref={host} aria-busy={!engine.ready} />
          {engine.ready && !selection && !active && engine.structuredTargets.length > 0 &&
            <div className="structured-reader-tools" aria-label="Expandable content on this page">
              {engine.structuredTargets.map(({ id, content }) =>
                <button key={id} type="button" className="btn btn-quiet" title={content.label}
                  onClick={() => setExpandedContent({ content, cfi: r?.cfi, width: host.current?.clientWidth ?? 0, height: host.current?.clientHeight ?? 0 })}>Expand {content.label}</button>)}
            </div>}
          {expandedContent && <StructuredViewer content={expandedContent.content} onClose={() => {
            const { cfi, width, height } = expandedContent;
            setExpandedContent(null);
            if (cfi && host.current && (width !== host.current.clientWidth || height !== host.current.clientHeight)) {
              void engine.goTo(cfi);
            }
          }} />}
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
            onContents={() => {
              setFocus(false);
              setLeftTab("contents");
              setContentsRequest((n) => n + 1);
              pagePanels({ left: true, ...(narrow ? { right: false } : {}) });
            }}
            onSeek={(f) => {
              remember();
              void engine.goToFraction(f);
            }}
            onPrev={() => turn(false)}
            onNext={() => turn(true)}
            focus={focus}
            zoom={
              engine.fixed && engine.ready ? (
                <ZoomControls compact zoom={settings.pageZoom} scale={engine.scale} onChange={(pageZoom) => changeSettings({ pageZoom })} />
              ) : null
            }
          />
        </main>
        {narrow && (showLeft || showRight) && (
          <div className="reader-scrim" aria-hidden onClick={() => pagePanels({ left: false, right: false })} />
        )}
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
          {...lookUps(selection.text, selection.rect)}
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
          {...lookUps(active.a.excerpt, active.rect)}
        />
      )}
      {defining && (
        <DefineCard
          rect={defining.rect}
          text={defining.text}
          definitions={defining.definitions}
          onSearch={() => searchWeb(defining.text)}
          onClose={closeDefining}
        />
      )}
      {translating && <TranslatePanel words={translating} url={googleTranslate(translating)} onClose={closeTranslating} />}
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
      <button type="button" className="icon-btn" aria-label="Back to Sanctum" title="Back to Sanctum" onClick={onHome}>
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

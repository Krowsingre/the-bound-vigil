import { offerFinishedDownloadRemoval } from "../library/FinishedDownloadPrompt";
import { END_OF_BOOK, EndOfBook } from "./EndOfBook";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, isApp, isIOS, isIPhone, isMac } from "../api";
import { READER_NARROW, useNarrow } from "../lib/useNarrow";
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
import { TextSettings, DefineCard, NoteDialog, PageSettings, ReadingAppearance, SelectionToolbar, ZoomControls } from "./ReaderPopovers";
import { addressFor, readBrowserPrefs } from "../browse/browserPrefs";
import { ReaderSearch } from "./ReaderSearch";
import { canTranslateInReader, TranslatePanel } from "./TranslatePanel";
import { BOOK_OPENED, useAppDark } from "../settings/appSettings";
import { DEFAULT_SETTINGS, PAGE_COLORS, parseSettings, resolveTheme, SETTINGS_KEY, zoomStep, type ReaderSettings } from "./settings";
import { useKeyboardScroll } from "./useKeyboardScroll";
import { ListeningDock, ListeningSheet, MS_PER_PAGE, type ListenMode, type ListenTimer, type NarrationPlace } from "./ListeningSheet";
import { useReadAloud } from "./useReadAloud";
import { useReadAlong } from "./useReadAlong";
import { StructuredViewer } from "./StructuredViewer";
import { PictureViewer } from "./PictureViewer";
import type { StructuredContent } from "./structuredContent";
import { useReaderEngine, type ReadingDirection, type TextSelection } from "./useReaderEngine";
import { keyHint, useShortcuts } from "../lib/shortcuts";

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
  if (typeof matchMedia === "function" && matchMedia(READER_NARROW).matches) return { left: false, right: false };
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

/** How long a tap waits to be sure it isn't the first of three. */
// Long enough for a triple click to be told from one click.
const TAP_WAIT_MS = 420;
/** After seeking or jumping with the reader's own controls, the bars stay a moment. */
const QUIET_MS = 1500;

/** Each book's own Reading direction choice, kept on this device; missing means "what the book says". */
const DIRECTIONS_KEY = "reader.directions";
function readDirections(): Record<string, ReadingDirection> {
  try {
    const parsed = JSON.parse(localStorage.getItem(DIRECTIONS_KEY) ?? "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
function savedDirection(bookId: string): ReadingDirection | null {
  const d = readDirections()[bookId];
  return d === "ltr" || d === "rtl" ? d : null;
}
function saveDirection(bookId: string, dir: ReadingDirection | null) {
  try {
    const all = readDirections();
    if (dir) all[bookId] = dir;
    else delete all[bookId];
    localStorage.setItem(DIRECTIONS_KEY, JSON.stringify(all));
  } catch {
    // Storage unavailable: the choice lasts until the book closes.
  }
}

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
  // "Check this book's file": what each sync place shows of it.
  const [fileCheck, setFileCheck] = useState<string | null>(null);
  const [checkingFile, setCheckingFile] = useState(false);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [settings, setSettings] = useState<ReaderSettings>(DEFAULT_SETTINGS);
  const [widePanels, setWidePanels] = useState(readPanels);
  const [compactPanels, setCompactPanels] = useState({ left: false, right: false });
  const panels = compact ? compactPanels : widePanels;
  const setPanels = compact ? setCompactPanels : setWidePanels;
  const [rightTab, setRightTab] = useState<RightTab>("notes");
  const [leftTab, setLeftTab] = useState<LeftTab>("contents");
  const [contentsRequest, setContentsRequest] = useState(0);
  // Search in the book: a row under the top bar, opened from ••• (or Ctrl+F).
  const [phoneSearch, setPhoneSearch] = useState(false);
  // Aa: the Reading Appearance sheet.
  const [lookOpen, setLookOpen] = useState(false);
  const [listenOpen, setListenOpen] = useState(false);
  // Until one is picked, Immersion when the book has its audiobook.
  const [listenChoice, setListenChoice] = useState<ListenMode | null>(null);
  const [listenTimer, setListenTimer] = useState<ListenTimer>({ kind: "off" });
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
  const narrowViewport = useNarrow(READER_NARROW);
  const narrow = compact || narrowViewport;
  const keys = useShortcuts();
  // Phones (and a narrow pane): the bars lie over the page and slide away while reading.
  const overlay = narrow;
  // On a phone books open in focus, just the page, and a tap brings the bars
  // back. On a computer they open in the normal view; a click goes into focus.
  const [focus, setFocus] = useState(overlay);
  /** Moves made by the reader's own controls (seeking, jumping) don't hide the bars. */
  const quietUntil = useRef(0);
  const tapTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  /** What the tap and page-turn handlers need to know now, set each render. */
  const now = useRef({ busy: false, overlay, focus, panels: false });
  // Focus on a computer is one uninterrupted page: the book scrolls, fading
  // in at one edge and out at the other, whatever paging is chosen otherwise.
  const flowing = focus && !overlay;
  const viewSettings = useMemo<ReaderSettings>(
    () => (flowing ? { ...settings, flow: "scrolled", pageFlow: "scrolled" } : settings),
    [flowing, settings],
  );

  // Load the book, its highlights and the reading settings, then the file.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [opened, list, saved] = await Promise.all([
          // Nothing is recorded (or synced) until the book's file has opened.
          api.readerBook(bookId),
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
          // Now it counts as opened: when, and Unread becomes In progress.
          void api.openBook(bookId).then(
            (now) => !cancelled && setInfo((i) => (i ? { ...i, book: { ...i.book, status: now.book.status, lastOpenedAt: now.book.lastOpenedAt, wantToRead: now.book.wantToRead } } : i)),
            () => undefined,
          );
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
  /** Starts or stops auto-scroll (Ctrl+Space, or three taps on the page). */
  const toggleAutoScroll = useRef<() => void>(() => undefined);
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
    // Leaving TBV (another app, the Home Screen, a locked phone) saves the
    // place at once and sends it, rather than waiting for the next sync.
    const hidden = () => {
      if (document.visibilityState !== "hidden") return;
      reportPosition.current();
      void flush().then(() => api.syncSoon()).catch(() => undefined);
    };
    document.addEventListener("visibilitychange", hidden);
    return () => {
      unregister();
      document.removeEventListener("visibilitychange", hidden);
      void flush().then(() => api.syncSoon()).catch(() => undefined);
    };
  }, [flush]);

  const theme = resolveTheme(settings.theme, prefersDark);
  const colors = PAGE_COLORS[theme];

  // Set below; the page engine reports zooming before that's defined.
  const changeSettingsRef = useRef<(change: Partial<ReaderSettings>) => void>(() => {});
  // Time read counts while the book is open on screen and being read.
  useEffect(() => recordReading(), []);

  // This book's reading direction, when chosen; otherwise the book's own.
  const [direction, setDirectionChoice] = useState<ReadingDirection | null>(() => savedDirection(bookId));
  const [picture, setPicture] = useState<{ src: string; alt: string } | null>(null);
  const engine = useReaderEngine({
    direction,
    host,
    file,
    startCfi: usable(info?.book.resumeLocator) ? info!.book.resumeLocator!.cfi! : null,
    settings: viewSettings,
    colors,
    annotations: drawn,
    events: {
      onTripleTap: () => {
        clearTimeout(tapTimer.current);
        toggleAutoScroll.current();
      },
      // One tap or click goes in or out of focus (on a phone, hides or shows
      // the bars), waiting a moment in case it's three.
      onTap: () => {
        clearTimeout(tapTimer.current);
        tapTimer.current = setTimeout(() => {
          if (now.current.busy) return;
          setFocus((f) => !f);
        }, TAP_WAIT_MS);
      },
      // A picture in the text: shown closer, and focus mode stays as it was.
      onPicture: (p) => {
        clearTimeout(tapTimer.current);
        setPicture(p);
      },
      onRelocate: (r) => {
        noteReading();
        // Swiping to the next page, or scrolling, hides the bars.
        const n = now.current;
        if (n.overlay && !n.focus && !n.panels && !n.busy && performance.now() > quietUntil.current) setFocus(true);
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
    glide: settings.followVoice && !engine.fixed && viewSettings.flow === "scrolled",
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

  const listenMode: ListenMode = listenChoice ?? (readAlong.audiobookId ? "immersion" : "narration");
  // Reading aloud stops the audiobook, as starting the audiobook stops reading aloud.
  const narrate = useMemo(
    () => ({
      ...readAloud,
      play: () => {
        if (readAlong.playing) readAlong.playPause();
        readAloud.play();
      },
      toggle: () => {
        if (readAloud.status !== "playing" && readAlong.playing) readAlong.playPause();
        readAloud.toggle();
      },
    }),
    [readAloud, readAlong],
  );

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

  // Narration's estimated place: the chapter's pages, at about a page a minute.
  const narration = useMemo<NarrationPlace>(() => {
    const at = current ? entries.indexOf(current) : -1;
    const start = current?.page ?? 1;
    const next = entries.slice(at + 1).find((e) => e.page !== null && e.page > start);
    const end = Math.max(start + 1, next?.page ?? totalPages + 1);
    const page = Math.min(end - 1, Math.max(start, position?.page ?? start));
    return {
      chapters: entries.map((e) => ({ label: "\u00a0\u00a0".repeat(e.depth) + e.label, href: e.href, page: e.page })),
      current: Math.max(0, at),
      elapsedMs: (page - start) * MS_PER_PAGE,
      totalMs: (end - start) * MS_PER_PAGE,
      seek: (f) => {
        if (!totalPages) return;
        quietUntil.current = performance.now() + QUIET_MS;
        void engine.goToFraction(Math.min(1, (start - 1 + f * (end - start)) / totalPages));
      },
      goChapter: (href) => {
        quietUntil.current = performance.now() + QUIET_MS;
        void engine.goTo(href);
      },
    };
  }, [entries, current, position?.page, totalPages, engine]);

  // Jumps remember where you were, for "Return to previous location".
  const remember = useCallback(() => {
    if (r?.cfi) setJumps((j) => pushJump(j, { cfi: r.cfi, page: position?.page ?? null }));
  }, [r, position]);
  const jumpTo = useCallback(
    (target: string) => {
      quietUntil.current = performance.now() + QUIET_MS;
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
    quietUntil.current = performance.now() + QUIET_MS;
    void engine.goTo(last.cfi);
  };

  /** One page on or back in reading order (Page Down, Page Up, Space). */
  const turn = useCallback(
    (forward: boolean) => {
      setSelection(null);
      setActive(null);
      void (forward ? engine.next() : engine.prev());
    },
    [engine],
  );
  /** One page to the left or right on screen (arrow keys and buttons): back or on by the reading direction. */
  const turnSide = useCallback(
    (side: "left" | "right") => {
      setSelection(null);
      setActive(null);
      void (side === "left" ? engine.left() : engine.right());
    },
    [engine],
  );
  const directionControl = {
    value: engine.direction,
    own: engine.ownDirection,
    onChange: (d: ReadingDirection) => {
      const choice = d === engine.ownDirection ? null : d;
      saveDirection(bookId, choice);
      setDirectionChoice(choice);
    },
  };

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

  // A book marked read or dropped while open offers to remove its download
  // once you leave it, not while you're still reading.
  const [endDismissed, setEndDismissed] = useState(false);
  /** The end panel stays up after "Mark as read" to ask about the download. */
  const [endOpen, setEndOpen] = useState(false);
  const finishedOnLeave = useRef<{ book: ReaderBook["book"]; status: ReadStatus } | null>(null);
  const leave = useCallback(() => {
    if (fullscreen) void setWindowFullscreen(false);
    reportPosition.current();
    const finished = finishedOnLeave.current;
    void flush().then(() => {
      onClose();
      if (finished) offerFinishedDownloadRemoval(finished.book, finished.status);
    });
  }, [flush, onClose, fullscreen]);

  const [autoScrolling, setAutoScrolling] = useState(false);
  const scrolling = (engine.fixed ? viewSettings.pageFlow : viewSettings.flow) === "scrolled";
  // The edge fade: on computers in focus mode; on phones while the bars are away and the book scrolls
  // (turned pages would lose their first and last lines to it).
  const fading = settings.edgeFade && (flowing || (overlay && focus && scrolling));
  const { scrollByPixels } = engine;
  reportPosition.current = () => engine.getView()?.renderer.reportPosition?.();
  toggleAutoScroll.current = () => {
    if (!engine.ready) return;
    if (!autoScrolling && !scrolling) changeSettings(engine.fixed ? { pageFlow: "scrolled" } : { flow: "scrolled" });
    setAutoScrolling(!autoScrolling);
    if (autoScrolling) {
      reportPosition.current();
      void flush();
    }
  };
  // While a voice is being followed (a paired audiobook or Read aloud), the
  // voice moves the page; auto-scroll waits and carries on when it stops.
  const voiceLeads = (readAlong.following && readAlong.playing) || readAloud.status === "playing";
  useEffect(() => {
    if (!autoScrolling || !scrolling || !engine.ready || expandedContent || noteEdit || voiceLeads) return;
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
  }, [autoScrolling, scrolling, engine.ready, scrollByPixels, expandedContent, noteEdit, settings.autoScrollSpeed, voiceLeads]);
  const keyboardScroll = useKeyboardScroll(scrollByPixels, settings.keyboardScrollSpeed, engine.ready && scrolling && !expandedContent && !noteEdit);
  const keyScrollRef = useRef(keyboardScroll.release);
  keyScrollRef.current = keyboardScroll.release;

  // Keyboard: the window's keys, plus keys pressed inside the book's pages.
  const onKeyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  onKeyRef.current = (e) => {
    if (noteEdit || expandedContent || e.defaultPrevented) return;
    const backKey = navigationDirection(e, false) === "back";
    if (isTyping(e.target) && e.key !== "Escape" && !backKey) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (ctrl && (e.code === "Space" || key === " ") && !e.altKey && !e.shiftKey) {
      if (!e.repeat) toggleAutoScroll.current();
    } else if (ctrl && engine.fixed && (key === "=" || key === "+" || key === "-" || key === "0")) {
      // Zoom for PDFs and comics, in place of the window's own zoom.
      changeSettings({ pageZoom: key === "0" ? "fit-page" : zoomStep(engine.scale, key === "-" ? -1 : 1) });
    } else if (ctrl && (key === "k" || key === "f")) {
      setFocus(false);
      setPhoneSearch(true);
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
      else narrate.toggle();
    }
    else if (e.key === "ArrowLeft") turnSide("left");
    else if (e.key === "ArrowRight") turnSide("right");
    else if (!e.shiftKey && (engine.fixed || viewSettings.flow === "scrolled") && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
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
          {fileCheck ? (
            <>
              <pre className="reader-file-check">{fileCheck}</pre>
              <button
                type="button"
                className="btn"
                onClick={() => void navigator.clipboard?.writeText(fileCheck).then(() => toast("Copied"), () => toast("Couldn't copy"))}
              >
                Copy what was found
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn"
              disabled={checkingFile}
              onClick={() => {
                setCheckingFile(true);
                api.checkBookFile(bookId).then(setFileCheck, (e: unknown) => setFileCheck(String(e))).finally(() => setCheckingFile(false));
              }}
            >
              {checkingFile ? "Checking… (up to a minute)" : "Check this book's file"}
            </button>
          )}
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
            finishedOnLeave.current = null;
            setInfo((i) => (i ? { ...i, book: { ...i.book, status: info.book.status } } : i));
          }, (error: unknown) => toast(String(error))),
        } : undefined);
        const before = finishedOnLeave.current?.book ?? info.book;
        finishedOnLeave.current = status === "read" || status === "dropped" ? { book: before, status } : null;
        notify();
      },
      (e: unknown) => toast(String(e)),
    );

  const menu: MenuEntry[] = [
    { label: "Search this book", icon: "search", hint: narrow || !keys ? undefined : "Ctrl+F", onSelect: () => (setFocus(false), setPhoneSearch(true)) },
    {
      label: "Book info",
      icon: "info",
      onSelect: () => {
        setFocus(false);
        setRightTab("info");
        pagePanels({ right: true });
      },
    },
    info?.book.status === "read"
      ? { label: "Mark as not finished", icon: "circle", onSelect: () => void markStatus("in_progress", "Marked as in progress.") }
      : { label: "Mark as read", icon: "checkCircle", onSelect: () => void markStatus("read", "Marked as read.") },
    info?.book.status === "dropped"
      ? { label: "Not dropped after all", icon: "circle", onSelect: () => void markStatus("in_progress", "Marked as in progress.") }
      : { label: "Mark as dropped", icon: "close", onSelect: () => void markStatus("dropped", "Marked as dropped.") },
    ...(openedFile && engine.ready ? [{
      label: "Share (save a copy)",
      hint: formatLabel(openedFile.format),
      icon: "share" as const,
      onSelect: () => void api.saveCopies([openedFile.id]).then(
        (done) => done && toast(`Saved a copy to ${done.folder}.`),
        (e: unknown) => toast(`Couldn't save a copy: ${String(e)}`),
      ),
    }] : []),
    ...(narrow ? [] : [
      "divider" as const,
      { label: focus ? "Leave focus mode" : "Focus mode", icon: "focus" as const, hint: "F", onSelect: () => setFocus((f) => !f) },
      { label: fullscreen ? "Leave full screen" : "Full screen", icon: (fullscreen ? "exitFullscreen" : "fullscreen") as "fullscreen", hint: keyHint(keys, "F11"), onSelect: toggleFullscreen },
    ]),
  ];

  // About 97% on, the end-of-book panel: rate, mark read, remove the download.
  const nearEnd = (r?.fraction ?? 0) >= END_OF_BOOK;
  const showEnd = !!info && engine.ready && nearEnd && !endDismissed && (info.book.status !== "read" || endOpen);
  const markReadAtEnd = async () => {
    if (!info) return;
    await api.setBookStatus(info.book.id, "read").then(
      () => {
        setInfo((i) => (i ? { ...i, book: { ...i.book, status: "read" } } : i));
        setEndOpen(true);
        void api.syncSoon();
      },
      (e: unknown) => toast(String(e)),
    );
  };
  const removeAtEnd = () => {
    if (!info) return;
    const id = info.book.id;
    reportPosition.current();
    void flush().then(() => {
      onClose();
      void api.removeDownload(id).then(
        () => toast("Removed the download from this device."),
        (e: unknown) => toast(String(e)),
      );
    });
  };

  const showLeft = !focus && panels.left && !!info;
  const showRight = !focus && panels.right && !!info;
  const noteCount = annotations.filter((a) => !isBookmark(a)).length;
  now.current = { busy: !!(selection || active || noteEdit || lookOpen || listenOpen || expandedContent || phoneSearch), overlay, focus, panels: showLeft || showRight };
  const openContents = () => {
    setFocus(false);
    setLeftTab("contents");
    setContentsRequest((n) => n + 1);
    pagePanels({ left: true, ...(narrow ? { right: false } : {}) });
  };

  // Listening: a sheet from the bottom on phones, a drop-down under its button on computers.
  const listening = (docked: boolean) => (
        <ListeningSheet
          docked={docked}
          mode={listenMode}
          onMode={setListenChoice}
          onClose={() => setListenOpen(false)}
          readAloud={narrate}
          readAlong={readAlong}
          ebookId={bookId}
          narration={narration}
          settings={settings}
          onSettings={changeSettings}
          lang={bookLang}
          timer={listenTimer}
          onTimer={setListenTimer}
          canGlide={!engine.fixed && viewSettings.flow === "scrolled"}
        />
  );

  return (
    <div
      className={`reader theme-${theme}${overlay ? " is-overlay" : ""}${compact ? " is-compact" : ""}${focus ? " is-focus" : ""}${flowing ? " is-flowing" : ""}${fading ? " has-fade" : ""}${showLeft ? " has-left" : ""}${showRight ? " has-right" : ""}`}
      style={{ ["--fade" as string]: `${settings.fadeStrength}%`, ["--page-bg" as string]: colors.background, ["--page-text" as string]: colors.text, ["--page-muted" as string]: colors.muted }}
    >
      <ReaderTopBar
        title={info?.book.title ?? ""}
        focus={focus}
        overlay={overlay}
        onHome={leave}
        contentsOpen={showLeft && leftTab === "contents"}
        onToggleContents={() => (showLeft && leftTab === "contents" ? pagePanels({ left: false }) : openContents())}
        textSettings={
          engine.fixed ? (
            <Popover label="Page settings" trigger={<Icon name="sliders" size={20} />} className="text-settings-popover">
              <PageSettings settings={settings} scale={engine.scale} onChange={changeSettings} direction={directionControl} />
            </Popover>
          ) : overlay ? (
            <button type="button" className={`icon-btn${lookOpen ? " is-on" : ""}`} aria-label="Reading appearance" title="Reading appearance" aria-haspopup="dialog" aria-expanded={lookOpen} onClick={() => setLookOpen((o) => !o)}>
              <span className="aa">Aa</span>
            </button>
          ) : (
            // Computers keep the small drop-down from before the phone redesign.
            <Popover label="Text settings" trigger={<span className="aa">Aa</span>} className="text-settings-popover">
              <TextSettings settings={settings} onChange={changeSettings} direction={directionControl} />
            </Popover>
          )
        }
        readAloud={
          <div className="menu-root">
          <button
            type="button"
            className={`icon-btn${listenOpen || readAloud.status !== "stopped" || readAlong.playing ? " is-on" : ""}`}
            aria-label="Listening"
            title={readAlong.audiobookId ? "Listening: read aloud, or the audiobook (R reads aloud)" : "Listening: read aloud (R)"}
            aria-haspopup="dialog"
            aria-expanded={listenOpen}
            onClick={() => setListenOpen((o) => !o)}
          >
            <Icon name={readAlong.audiobookId ? "headphones" : "readAloud"} size={20} />
          </button>
          {listenOpen && !overlay && listening(true)}
          </div>
        }
        bookmarked={!!bookmarkHere}
        onToggleBookmark={toggleBookmark}
        notesOpen={showRight && rightTab === "notes"}
        noteCount={noteCount}
        onToggleNotes={() => {
          const open = panels.right && rightTab === "notes" && !focus;
          if (!open) setFocus(false);
          setRightTab("notes");
          pagePanels({ right: !open });
        }}
        menu={menu}
        avatar={narrow ? undefined : <SyncMenu {...shell} />}
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
          {phoneSearch && !(overlay && focus) && (
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
          <ListeningDock
            sheetOpen={listenOpen}
            onOpen={() => {
              // On a computer it drops down from the top bar, which focus mode hides.
              if (!overlay) setFocus(false);
              setListenOpen(true);
            }}
            title={info?.book.title ?? ""}
            readAloud={narrate}
            readAlong={readAlong}
            narration={narration}
            bookLeftMs={Math.max(0, totalPages - (position?.page ?? 1)) * MS_PER_PAGE}
            settings={settings}
            timer={listenTimer}
            onTimer={setListenTimer}
            raised={overlay && !focus}
          />
          <ReaderBottomBar
            position={position}
            fraction={r?.fraction ?? 0}
            chapter={r?.tocItem?.label?.trim() ?? null}
            onContents={openContents}
            onSeek={(f) => {
              quietUntil.current = performance.now() + QUIET_MS;
              remember();
              void engine.goToFraction(f);
            }}
            onLeft={() => ((quietUntil.current = performance.now() + QUIET_MS), turnSide("left"))}
            onRight={() => ((quietUntil.current = performance.now() + QUIET_MS), turnSide("right"))}
            rtl={engine.direction === "rtl"}
            focus={focus}
            overlay={overlay}
            arrows={!scrolling}
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
          docked={isIPhone}
          onColor={(c) => void highlight(selection, c)}
          onNote={() => setNoteEdit({ selection })}
          onCopy={() => copy(selection.text)}
          {...lookUps(selection.text, selection.rect)}
        />
      )}
      {active && (
        <SelectionToolbar
          rect={active.rect}
          docked={isIPhone}
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
      {showEnd && info && (
        <EndOfBook
          book={info.book}
          onRated={(rating) => setInfo((i) => (i ? { ...i, book: { ...i.book, rating } } : i))}
          onMarkRead={markReadAtEnd}
          onRemove={removeAtEnd}
          onDismiss={() => setEndDismissed(true)}
        />
      )}
{listenOpen && overlay && listening(false)}
      {lookOpen && !engine.fixed && <ReadingAppearance settings={settings} onChange={changeSettings} onClose={() => setLookOpen(false)} direction={directionControl} />}
      {picture && <PictureViewer picture={picture} onClose={() => setPicture(null)} />}
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
      <div className="reader-top-row" data-tauri-drag-region>
        <button type="button" className="icon-btn reader-home" aria-label="Back to Sanctum" title="Back to Sanctum" onClick={onHome}>
          <Icon name="home" size={22} filled />
        </button>
        <span className="reader-top-spacer" data-tauri-drag-region />
      </div>
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

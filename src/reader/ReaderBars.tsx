import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "../components/Icon";
import { Menu, type MenuEntry } from "../components/Menu";
import { percent } from "../lib/format";
import { WindowControls } from "../shell/WindowControls";
import { formatNumber, formatPage, pageAtFraction, type Jump, type PagePosition } from "./pages";
import { useShortcuts } from "../lib/shortcuts";

/**
 * The reader's own title bar, in place of the app header. Computers: home and
 * Book info (both side panels) on the left; Aa, listening, bookmark and ••• on
 * the right; the book's name under them. Phones: home, then ‹ (which unfolds
 * contents, Aa, listening, bookmark and notes) and •••; the book's name is in
 * the bottom row. On a phone it hides while reading (focus) and a tap on the
 * page brings it back.
 */
export function ReaderTopBar({
  title,
  focus,
  overlay,
  onHome,
  contentsOpen,
  onToggleContents,
  bookInfoOpen,
  onToggleBookInfo,
  textSettings,
  readAloud,
  bookmarked,
  onToggleBookmark,
  notesOpen,
  noteCount,
  onToggleNotes,
  menu,
  avatar,
}: {
  title: string;
  focus: boolean;
  /** Phones: the bar lies over the page and slides away in focus. */
  overlay: boolean;
  onHome: () => void;
  contentsOpen: boolean;
  onToggleContents: () => void;
  /** Computers: Book info opens both side panels together. */
  bookInfoOpen: boolean;
  onToggleBookInfo: () => void;
  textSettings: ReactNode;
  readAloud: ReactNode;
  bookmarked: boolean;
  onToggleBookmark: () => void;
  notesOpen: boolean;
  noteCount: number;
  onToggleNotes: () => void;
  menu: MenuEntry[];
  /** Computers: the sync circle. */
  avatar?: ReactNode;
}) {
  const hidden = overlay && focus;
  const keys = useShortcuts();
  const bookmarkLabel = `${bookmarked ? "Remove bookmark" : "Bookmark this page"}${keys ? " (Ctrl+B)" : ""}`;
  // Phones: the tools fold into a ‹ beside •••; a tap on anything else in
  // the bar (or the page, which goes back into focus) folds them again.
  const [unfolded, setUnfolded] = useState(false);
  useEffect(() => {
    if (hidden || !overlay) setUnfolded(false);
  }, [hidden, overlay]);
  const tools = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!unfolded) return;
    const fold = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (tools.current?.contains(target)) return;
      // What the tools opened (a sheet, a panel, a menu) leaves them unfolded.
      if (target?.closest?.(".look-backdrop, .reader-left, .reader-right, .reader-scrim, [role='dialog'], .menu, .popover")) return;
      setUnfolded(false);
    };
    document.addEventListener("pointerdown", fold, true);
    return () => document.removeEventListener("pointerdown", fold, true);
  }, [unfolded]);
  const contents = (
    <button
      type="button"
      className={`icon-btn${contentsOpen ? " is-on" : ""}`}
      aria-label="Contents"
      title="Contents"
      aria-pressed={contentsOpen}
      onClick={onToggleContents}
    >
      <Icon name="listBullet" size={20} />
    </button>
  );
  const bookmark = (
    <button
      type="button"
      className={`icon-btn${bookmarked ? " is-on" : ""}`}
      aria-label={bookmarkLabel}
      title={bookmarkLabel}
      aria-pressed={bookmarked}
      onClick={onToggleBookmark}
    >
      <Icon name="bookmark" size={20} filled={bookmarked} />
    </button>
  );
  const notes = (
    <button
      type="button"
      className={`icon-btn reader-notes-btn${notesOpen ? " is-on" : ""}`}
      aria-label="Highlights and notes"
      title="Highlights and notes"
      aria-pressed={notesOpen}
      onClick={onToggleNotes}
    >
      <Icon name="notePen" size={20} />
      {noteCount > 0 && <span className="dot" aria-hidden />}
    </button>
  );
  const more = <Menu label="More" trigger={<Icon name="more" size={20} />} items={menu} menuClassName="menu-narrow" />;
  if (overlay) {
    return (
      <header
        className={`reader-top${focus ? " reader-top-focus" : ""} is-overlay${hidden ? " is-hidden" : ""}`}
        data-tauri-drag-region
        aria-hidden={hidden || undefined}
        inert={hidden || undefined}
      >
        <div className="reader-top-row" data-tauri-drag-region>
          <button type="button" className="icon-btn reader-home" aria-label="Back to Sanctum" title="Back to Sanctum" onClick={onHome}>
            <Icon name="home" size={22} filled />
          </button>
          <span className="reader-top-spacer" data-tauri-drag-region />
          {unfolded ? (
            <div className="reader-top-tools" ref={tools}>
              {contents}
              {textSettings}
              {readAloud}
              {bookmark}
              {notes}
            </div>
          ) : (
            <button type="button" className="icon-btn" aria-label="Show tools" title="Show tools" aria-expanded={false} onClick={() => setUnfolded(true)}>
              <Icon name="chevronLeft" size={20} />
            </button>
          )}
          {more}
          <WindowControls />
        </div>
      </header>
    );
  }
  return (
    <header className={`reader-top${focus ? " reader-top-focus" : ""}`} data-tauri-drag-region>
      <div className="reader-top-row" data-tauri-drag-region>
        <button type="button" className="icon-btn reader-home" aria-label="Back to Sanctum" title="Back to Sanctum" onClick={onHome}>
          <Icon name="home" size={22} filled />
        </button>
        <button
          type="button"
          className={`icon-btn reader-notes-btn${bookInfoOpen ? " is-on" : ""}`}
          aria-label="Book info"
          title="Book info"
          aria-pressed={bookInfoOpen}
          onClick={onToggleBookInfo}
        >
          <Icon name="info" size={20} />
          {noteCount > 0 && <span className="dot" aria-hidden />}
        </button>
        <span className="reader-top-spacer" data-tauri-drag-region />
        {textSettings}
        {readAloud}
        {bookmark}
        {more}
        {avatar}
        <WindowControls />
      </div>
      <div className="reader-top-name" data-tauri-drag-region title={title}>{title}</div>
    </header>
  );
}

/** A thin line showing how far through the book, which can be dragged to go anywhere; the chapter, and "Page X of Y". */
export function ReaderBottomBar({
  position,
  fraction,
  chapter,
  title,
  onSeek,
  onLeft,
  onRight,
  rtl = false,
  focus,
  overlay,
  arrows,
  zoom,
  slider = true,
}: {
  position: PagePosition | null;
  fraction: number;
  chapter: string | null;
  /** Phones: the book's name, at the bottom left. */
  title: string;
  onSeek: (fraction: number) => void;
  /** The left and right arrows: in a right-to-left book the left one is the next page. */
  onLeft: () => void;
  onRight: () => void;
  /** Right-to-left books: the line fills from the right and the arrows swap names. */
  rtl?: boolean;
  focus: boolean;
  overlay: boolean;
  /** Page-turn arrows: only when pages turn, not when the book scrolls. */
  arrows: boolean;
  /** PDFs and comics: the zoom buttons. */
  zoom?: ReactNode;
  /** The line showing how far through: on phones and iPads, not on computers (embre, 20 November). */
  slider?: boolean;
}) {
  // While dragging, the label shows where you'd land; the book moves on release.
  const [dragging, setDragging] = useState<number | null>(null);
  const shown = dragging ?? fraction;
  const total = position?.total ?? 0;
  const shownPage = dragging !== null && total ? { page: pageAtFraction(dragging, total), total } : position;
  const commit = () => {
    if (dragging !== null) onSeek(dragging);
    setDragging(null);
  };
  const hidden = overlay && focus;
  const leftName = rtl ? "Next page" : "Previous page";
  const rightName = rtl ? "Previous page" : "Next page";
  return (
    <footer
      className={`reader-bottom${focus ? " reader-bottom-focus" : ""}${overlay ? " is-overlay" : ""}${hidden ? " is-hidden" : ""}${zoom ? " has-zoom" : ""}`}
      aria-hidden={hidden || undefined}
      inert={hidden || undefined}
    >
      {slider && <input
        type="range"
        className={`reader-slider${rtl ? " is-rtl" : ""}`}
        dir={rtl ? "rtl" : undefined}
        min={0}
        max={1}
        step={0.0005}
        value={shown}
        style={{ ["--fill" as string]: `${shown * 100}%` }}
        aria-label="Position in book"
        aria-valuetext={shownPage ? `${formatPage(shownPage)}, ${percent(shown)}` : percent(shown)}
        title={percent(shown)}
        onChange={(e) => setDragging(Number(e.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={() => setDragging(null)}
      />}
      <div className="reader-bottom-row">
        {arrows ? (
          <button type="button" className="icon-btn" aria-label={leftName} title={`${leftName} (←)`} onClick={onLeft}>
            <Icon name="chevronLeft" size={20} />
          </button>
        ) : <span className="reader-bottom-gap" />}
        {overlay ? (
          <>
            <SlidingName text={title} />
            {zoom}
            <ChapterOrPage chapter={chapter} page={shownPage ? formatPage(shownPage) : percent(shown)} />
          </>
        ) : (
          <>
            <div className="reader-bottom-where">
              {chapter && <span className="reader-bottom-chapter">{chapter}</span>}
              <span className="reader-bottom-page">{shownPage ? formatPage(shownPage) : percent(shown)}</span>
            </div>
            {zoom}
          </>
        )}
        {arrows ? (
          <button type="button" className="icon-btn" aria-label={rightName} title={`${rightName} (→)`} onClick={onRight}>
            <Icon name="chevronRight" size={20} />
          </button>
        ) : <span className="reader-bottom-gap" />}
      </div>
    </footer>
  );
}

const BOTTOM_SHOWS_KEY = "tbv.reader.bottomShows";

/** Phones: the chapter's name, or with a tap "Page X of Y" (remembered); the page when there's no chapter name. */
function ChapterOrPage({ chapter, page }: { chapter: string | null; page: string }) {
  const [showPage, setShowPage] = useState(() => {
    try {
      return localStorage.getItem(BOTTOM_SHOWS_KEY) === "page";
    } catch {
      return false;
    }
  });
  if (!chapter) return <span className="reader-bottom-end">{page}</span>;
  const swap = () =>
    setShowPage((now) => {
      try {
        localStorage.setItem(BOTTOM_SHOWS_KEY, now ? "chapter" : "page");
      } catch {
        /* not remembered */
      }
      return !now;
    });
  return (
    <button type="button" className="reader-bottom-end" aria-label={showPage ? `${page}. Show the chapter` : `${chapter}. Show the page`} onClick={swap}>
      {showPage ? page : chapter}
    </button>
  );
}

/** The book's name, cut short to fit; when it doesn't fit it slides along by itself now and then. */
function SlidingName({ text }: { text: string }) {
  const box = useRef<HTMLSpanElement>(null);
  const inner = useRef<HTMLSpanElement>(null);
  const [over, setOver] = useState(0);
  useEffect(() => {
    const outer = box.current;
    const words = inner.current;
    if (!outer || !words || typeof ResizeObserver === "undefined") return;
    const measure = () => setOver(Math.max(0, Math.ceil(words.scrollWidth - outer.clientWidth)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(outer);
    observer.observe(words);
    return () => observer.disconnect();
  }, [text]);
  return (
    <span ref={box} className={`reader-bottom-name${over > 0 ? " is-sliding" : ""}`} title={text}>
      <span
        ref={inner}
        className="reader-bottom-name-text"
        style={over > 0 ? { ["--slide" as string]: `-${over}px`, ["--slide-time" as string]: `${Math.max(8, 4 + over / 25)}s` } : undefined}
      >
        {text}
      </span>
    </span>
  );
}

/** "Return to previous location", shown after jumping somewhere. */
export function ReturnPill({ jump, onReturn, onDismiss }: { jump: Jump; onReturn: () => void; onDismiss: () => void }) {
  return (
    <div className="return-pill" role="status">
      <button type="button" className="return-pill-go" onClick={onReturn}>
        <Icon name="arrowLeft" size={16} />
        Return to previous location
        {jump.page !== null && <span className="return-pill-from">From page {formatNumber(jump.page)}</span>}
      </button>
      <button type="button" className="icon-btn icon-btn-s" aria-label="Dismiss" title="Dismiss" onClick={onDismiss}>
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}

/** A small panel anchored to a button, closed by clicking elsewhere or Escape. */
export function Popover({
  label,
  trigger,
  children,
  className = "",
  title = label,
  on = false,
  muted = false,
}: {
  label: string;
  trigger: ReactNode;
  children: ReactNode;
  className?: string;
  /** The button's tooltip, when it says more than the label. */
  title?: string;
  /** Shows the button as on while closed, e.g. while reading aloud. */
  on?: boolean;
  /** Greys the button out for something that can't be used; it still opens to say why. */
  muted?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  return (
    <div className="menu-root" ref={root}>
      <button
        type="button"
        className={`icon-btn${open || on ? " is-on" : ""}${muted ? " is-muted" : ""}`}
        aria-label={label}
        aria-description={title !== label ? title : undefined}
        title={title}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((o) => !o)}
      >
        {trigger}
      </button>
      {open && (
        <div className={`menu menu-end popover ${className}`} role="dialog" aria-label={label}>
          {children}
        </div>
      )}
    </div>
  );
}

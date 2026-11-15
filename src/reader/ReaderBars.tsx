import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "../components/Icon";
import { Menu, type MenuEntry } from "../components/Menu";
import { percent } from "../lib/format";
import { WindowControls } from "../shell/WindowControls";
import { formatNumber, formatPage, pageAtFraction, type Jump, type PagePosition } from "./pages";

/**
 * The reader's own title bar, in place of the app header: home and contents
 * on the left; Aa, listening, bookmark, notes and ••• on the right; the
 * book's name under them. On a phone it hides while reading (focus) and a
 * tap on the page brings it back.
 */
export function ReaderTopBar({
  title,
  focus,
  overlay,
  onHome,
  contentsOpen,
  onToggleContents,
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
  return (
    <header className={`reader-top${focus ? " reader-top-focus" : ""}${overlay ? " is-overlay" : ""}${hidden ? " is-hidden" : ""}`} data-tauri-drag-region aria-hidden={hidden || undefined} inert={hidden || undefined}>
      <div className="reader-top-row" data-tauri-drag-region>
        <button type="button" className="icon-btn reader-home" aria-label="Back to Sanctum" title="Back to Sanctum" onClick={onHome}>
          <Icon name="home" size={22} filled />
        </button>
        <span className="reader-top-rule" aria-hidden />
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
        <span className="reader-top-spacer" data-tauri-drag-region />
        {textSettings}
        {readAloud}
        <button
          type="button"
          className={`icon-btn${bookmarked ? " is-on" : ""}`}
          aria-label={bookmarked ? "Remove bookmark (Ctrl+B)" : "Bookmark this page (Ctrl+B)"}
          title={bookmarked ? "Remove bookmark (Ctrl+B)" : "Bookmark this page (Ctrl+B)"}
          aria-pressed={bookmarked}
          onClick={onToggleBookmark}
        >
          <Icon name="bookmark" size={20} filled={bookmarked} />
        </button>
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
        <Menu label="More" trigger={<Icon name="more" size={20} />} items={menu} menuClassName="menu-narrow" />
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
  onContents,
  onSeek,
  onPrev,
  onNext,
  focus,
  overlay,
  arrows,
  zoom,
}: {
  position: PagePosition | null;
  fraction: number;
  chapter: string | null;
  onContents: () => void;
  onSeek: (fraction: number) => void;
  onPrev: () => void;
  onNext: () => void;
  focus: boolean;
  overlay: boolean;
  /** Page-turn arrows: only when pages turn, not when the book scrolls. */
  arrows: boolean;
  /** PDFs and comics: the zoom buttons. */
  zoom?: ReactNode;
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
  return (
    <footer
      className={`reader-bottom${focus ? " reader-bottom-focus" : ""}${overlay ? " is-overlay" : ""}${hidden ? " is-hidden" : ""}${zoom ? " has-zoom" : ""}`}
      aria-hidden={hidden || undefined}
      inert={hidden || undefined}
    >
      <input
        type="range"
        className="reader-slider"
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
      />
      <div className="reader-bottom-row">
        {arrows ? (
          <button type="button" className="icon-btn" aria-label="Previous page" title="Previous page (←)" onClick={onPrev}>
            <Icon name="chevronLeft" size={20} />
          </button>
        ) : <span className="reader-bottom-gap" />}
        <button type="button" className="reader-bottom-where" title="Show contents" aria-label={chapter ? `Show contents: ${chapter}` : "Show contents"} onClick={onContents}>
          <span className="reader-bottom-chapter">{chapter || "Contents"}</span>
          <span className="reader-bottom-page">{shownPage ? formatPage(shownPage) : percent(shown)}</span>
        </button>
        {zoom}
        {arrows ? (
          <button type="button" className="icon-btn" aria-label="Next page" title="Next page (→)" onClick={onNext}>
            <Icon name="chevronRight" size={20} />
          </button>
        ) : <span className="reader-bottom-gap" />}
      </div>
    </footer>
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

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "../components/Icon";
import { Menu, type MenuEntry } from "../components/Menu";
import { authorLine, percent } from "../lib/format";
import { WindowControls } from "../shell/WindowControls";
import { formatNumber, formatPage, pageAtFraction, type Jump, type PagePosition } from "./pages";

/** The reader's own title bar, in place of the app header. */
export function ReaderTopBar({
  title,
  authors,
  focus,
  onHome,
  search,
  textSettings,
  readAloud,
  bookmarked,
  onToggleBookmark,
  notesOpen,
  noteCount,
  onToggleNotes,
  menu,
  avatar,
  fullscreen,
  onToggleFullscreen,
  onExitFocus,
}: {
  title: string;
  authors: string[];
  focus: boolean;
  onHome: () => void;
  search: ReactNode;
  textSettings: ReactNode;
  readAloud: ReactNode;
  bookmarked: boolean;
  onToggleBookmark: () => void;
  notesOpen: boolean;
  noteCount: number;
  onToggleNotes: () => void;
  menu: MenuEntry[];
  avatar: ReactNode;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  onExitFocus: () => void;
}) {
  return (
    <header className={`reader-top${focus ? " reader-top-focus" : ""}`} data-tauri-drag-region>
      <button type="button" className="icon-btn" aria-label="Back to Sanctum" title="Back to Sanctum" onClick={onHome}>
        <Icon name="home" size={20} />
      </button>
      {!focus && (
        <>
          <span className="reader-top-rule" aria-hidden />
          <span className="reader-top-app">The Bound Vigil</span>
        </>
      )}
      <span className="reader-top-rule" aria-hidden />
      <span className="reader-top-title" data-tauri-drag-region>
        <strong>{title}</strong>
        <span className="reader-top-rule" aria-hidden />
        <span className="reader-top-author">{authorLine(authors)}</span>
      </span>
      <span className="reader-top-spacer" data-tauri-drag-region />
      {focus ? (
        <>
          <button type="button" className="icon-btn" aria-label="Leave focus mode (Esc)" title="Leave focus mode (Esc)" onClick={onExitFocus}>
            <Icon name="focus" size={20} />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label={fullscreen ? "Leave full screen (F11)" : "Full screen (F11)"}
            title={fullscreen ? "Leave full screen (F11)" : "Full screen (F11)"}
            onClick={onToggleFullscreen}
          >
            <Icon name={fullscreen ? "exitFullscreen" : "fullscreen"} size={20} />
          </button>
        </>
      ) : (
        <>
          {search}
          <span className="reader-top-rule" aria-hidden />
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
            <Icon name="notes" size={20} />
            {noteCount > 0 && <span className="dot" aria-hidden />}
          </button>
          <Menu label="More" trigger={<Icon name="more" size={20} />} items={menu} menuClassName="menu-narrow" />
          {avatar}
          <WindowControls />
        </>
      )}
      {focus && <WindowControls />}
    </header>
  );
}

/** Page, a slider to go anywhere, percent read, chapter, and page turns. */
export function ReaderBottomBar({
  position,
  fraction,
  chapter,
  onSeek,
  onPrev,
  onNext,
  focus,
  zoom,
}: {
  position: PagePosition | null;
  fraction: number;
  chapter: string | null;
  onSeek: (fraction: number) => void;
  onPrev: () => void;
  onNext: () => void;
  focus: boolean;
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
  return (
    <footer className={`reader-bottom${focus ? " reader-bottom-focus" : ""}${zoom && !focus ? " has-zoom" : ""}`}>
      <span className="reader-bottom-page">{shownPage ? formatPage(shownPage) : " "}</span>
      <input
        type="range"
        className="reader-slider"
        min={0}
        max={1}
        step={0.0005}
        value={shown}
        style={{ ["--fill" as string]: `${shown * 100}%` }}
        aria-label="Position in book"
        aria-valuetext={shownPage ? formatPage(shownPage) : percent(shown)}
        onChange={(e) => setDragging(Number(e.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={() => setDragging(null)}
      />
      <span className="reader-bottom-percent">{percent(shown)}</span>
      <span className="reader-bottom-chapter" title={chapter ?? undefined}>
        {chapter ?? ""}
      </span>
      {!focus && zoom}
      {!focus && (
        <span className="reader-bottom-turns">
          <button type="button" className="icon-btn" aria-label="Previous page" title="Previous page (←)" onClick={onPrev}>
            <Icon name="chevronLeft" size={20} />
          </button>
          <button type="button" className="icon-btn" aria-label="Next page" title="Next page (→)" onClick={onNext}>
            <Icon name="chevronRight" size={20} />
          </button>
        </span>
      )}
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

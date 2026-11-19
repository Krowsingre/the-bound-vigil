import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useDownloadsChanging } from "../library/cloudDownloads";
import { api } from "../api";
import type { BookPreview } from "../api/types";
import { playAudiobook } from "../audio/player";
import { BookCover } from "../components/BookCover";
import { Icon } from "../components/Icon";
import { Menu } from "../components/Menu";
import { ProgressBar } from "../components/ProgressBar";
import { showBookDetails } from "../details/openDetails";
import { authorLine, percent, relativeTime } from "../lib/format";
import { formatLength } from "../lib/queryBooks";
import { bookContextMenu, bookMenu, type BookActions } from "./bookActions";

/** How long each side shows before the card turns to the other (embre, 19 November). */
export const TURN_MS = 8000;
/** How far a finger has to move sideways to count as a swipe. */
const SWIPE_PX = 50;

/** The audiobook listened to most recently, still in progress. */
function useListening(refresh: number): BookPreview | null {
  const [book, setBook] = useState<BookPreview | null>(null);
  useEffect(() => {
    let current = true;
    if (typeof api.getLibrary !== "function") return;
    Promise.resolve()
      .then(() => api.getLibrary({
        kind: "audiobooks",
        shelf: "in_progress",
        sort: "recently_opened",
        paired: null,
        search: null,
        formats: [],
        location: null,
        omitFacets: true,
        page: 0,
        pageSize: 1,
      }))
      .then(
        (page) => current && setBook(page?.books?.[0] ?? null),
        () => current && setBook(null),
      );
    return () => {
      current = false;
    };
  }, [refresh]);
  return book;
}

/** "8h 24m left", from where you are. */
function timeLeft(book: BookPreview): string | null {
  if (!book.durationMs) return null;
  const left = book.durationMs - (book.resumeLocator?.audioMs ?? 0);
  return left > 0 ? `${formatLength(left)} left` : null;
}

/**
 * Continue reading and Continue listening, taking turns in one card. It
 * turns by itself every few seconds, stops while the pointer rests on it
 * or keyboard focus is inside,
 * and stays put once someone has used the arrows, dots or a swipe. On touch
 * screens a sideways swipe turns it too. With only one side, it's that side alone.
 */
export function ResumeHero({
  book,
  actions,
  onOpenLibrary,
  refresh = 0,
}: {
  book: BookPreview | null;
  actions: BookActions;
  onOpenLibrary: () => void;
  refresh?: number;
}) {
  useDownloadsChanging();
  const listening = useListening(refresh);
  const slides: { kind: "read" | "listen"; book: BookPreview }[] = [];
  if (book) slides.push({ kind: "read", book });
  if (listening) slides.push({ kind: "listen", book: listening });

  const [at, setAt] = useState(0);
  const [resting, setResting] = useState(false);
  const [held, setHeld] = useState(false);
  const [focused, setFocused] = useState(false);
  const count = slides.length;
  const showing = count ? at % count : 0;

  useEffect(() => {
    if (count < 2 || resting || held || focused) return;
    const timer = window.setInterval(() => setAt((n) => (n + 1) % count), TURN_MS);
    return () => window.clearInterval(timer);
  }, [count, resting, held, focused]);

  const go = useCallback(
    (to: number) => {
      setHeld(true);
      setAt(((to % count) + count) % count);
    },
    [count],
  );

  // Swipes, on touch screens only (the computer has the arrows).
  const start = useRef<{ x: number; y: number } | null>(null);
  const down = (e: ReactPointerEvent) => {
    start.current = e.pointerType === "touch" ? { x: e.clientX, y: e.clientY } : null;
  };
  const up = (e: ReactPointerEvent) => {
    const from = start.current;
    start.current = null;
    if (!from || count < 2) return;
    const dx = e.clientX - from.x;
    if (Math.abs(dx) >= SWIPE_PX && Math.abs(dx) > Math.abs(e.clientY - from.y)) go(showing + (dx < 0 ? 1 : -1));
  };

  if (!count) {
    return (
      <section className="hero hero-empty" aria-labelledby="hero-title">
        <div className="hero-body">
          <p className="eyebrow">Continue reading</p>
          <h1 id="hero-title" className="hero-title">
            Begin reading
          </h1>
          <p className="hero-synopsis">Nothing is in progress yet. Choose a book from Recently added, or open your Archive to find one.</p>
          <div className="hero-actions">
            <button type="button" className="btn btn-primary" onClick={onOpenLibrary}>
              Open Archive <span aria-hidden>→</span>
            </button>
          </div>
        </div>
      </section>
    );
  }

  const turning = count > 1;
  return (
    <section
      className={`hero${turning ? " is-turning" : ""}`}
      aria-roledescription={turning ? "carousel" : undefined}
      aria-label={turning ? "Continue reading and listening" : undefined}
      aria-labelledby={turning ? undefined : `hero-title-${slides[0].kind}`}
      onPointerEnter={(e) => e.pointerType === "mouse" && setResting(true)}
      onPointerLeave={(e) => e.pointerType === "mouse" && setResting(false)}
      onPointerDown={down}
      onPointerUp={up}
      onPointerCancel={() => (start.current = null)}
      // Keyboard focus inside the card holds it still too.
      onFocus={() => setFocused(true)}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setFocused(false)}
    >
      <div className="hero-slides">
        {slides.map((slide, i) => (
          <Slide
            key={slide.kind}
            kind={slide.kind}
            book={slide.book}
            actions={actions}
            on={i === showing}
            label={turning ? `${i + 1} of ${count}` : undefined}
          />
        ))}
      </div>
      {turning && (
        <>
          <button type="button" className="hero-turn hero-turn-back" aria-label="Previous" onClick={() => go(showing - 1)}>
            <Icon name="chevronLeft" size={20} />
          </button>
          <button type="button" className="hero-turn hero-turn-next" aria-label="Next" onClick={() => go(showing + 1)}>
            <Icon name="chevronRight" size={20} />
          </button>
          <div className="hero-dots">
            {slides.map((slide, i) => (
              <button
                key={slide.kind}
                type="button"
                className={`hero-dot${i === showing ? " is-on" : ""}`}
                aria-label={slide.kind === "read" ? "Show Continue reading" : "Show Continue listening"}
                aria-current={i === showing ? "true" : undefined}
                onClick={() => go(i)}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function Slide({
  kind,
  book,
  actions,
  on,
  label,
}: {
  kind: "read" | "listen";
  book: BookPreview;
  actions: BookActions;
  on: boolean;
  label?: string;
}) {
  // The book's own cover, enlarged and softened, behind the card (embre's choice).
  const backdrop = book.coverPath ? api.coverUrl(book.coverPath) : "";
  const chapter = book.resumeLocator?.chapter?.trim();
  const left = kind === "listen" ? timeLeft(book) : null;
  // Where the other devices are, for anyone who points at the progress bar.
  const elsewhere = book.remotePositions.map((r) => `On ${r.deviceName} you're at ${percent(r.totalProgression)} (${relativeTime(r.at)})`).join("\n");
  const titleId = `hero-title-${kind}`;
  const reading = kind === "read";

  return (
    <div
      className={`hero-slide${on ? " is-on" : ""}${backdrop ? " has-backdrop" : ""}`}
      role={label ? "group" : undefined}
      aria-roledescription={label ? "slide" : undefined}
      aria-label={label}
      aria-hidden={on ? undefined : true}
      inert={on ? undefined : true}
      {...bookContextMenu(book, actions)}
    >
      {backdrop && (
        <div className="hero-backdrop" aria-hidden>
          <img className="private-picture" src={backdrop} alt="" draggable={false} />
        </div>
      )}
      <div className="hero-inner">
        {/* The cover opens Book details; the button carries on (embre, 19 November). */}
        <button type="button" className="hero-cover" onClick={() => showBookDetails(book.id)} aria-label={`Details of ${book.title}`}>
          <BookCover book={book} size="l" />
        </button>
        <div className="hero-body">
          <p className="eyebrow">{reading ? "Continue reading" : "Continue listening"}</p>
          {reading ? (
            <h1 id={titleId} className="hero-title">
              {book.title}
            </h1>
          ) : (
            <h2 id={titleId} className="hero-title">
              {book.title}
            </h2>
          )}
          <p className="hero-author">{authorLine(book.authors)}</p>
          <p className="hero-where">
            <span className="hero-percent">{percent(book.totalProgression)}</span>
            {[chapter, left].filter(Boolean).map((part) => (
              <span key={part}>
                <span aria-hidden> · </span>
                <span className="hero-chapter">{part}</span>
              </span>
            ))}
          </p>
          <div className="hero-progress" title={elsewhere || undefined}>
            <ProgressBar value={book.totalProgression} />
            <span className="hero-percent">{percent(book.totalProgression)}</span>
          </div>
          {elsewhere && <p className="visually-hidden">{elsewhere}</p>}
          <div className="hero-actions">
            {reading ? (
              <button type="button" className="btn btn-primary btn-large" onClick={() => actions.open(book)}>
                <Icon name="play" size={16} /> Continue reading
              </button>
            ) : (
              <button type="button" className="btn btn-primary btn-large" onClick={() => playAudiobook(book.id)}>
                <Icon name="play" size={16} /> Continue listening
              </button>
            )}
            <Menu label={`More for ${book.title}`} className="icon-btn icon-btn-round" trigger={<Icon name="more" />} items={bookMenu(book, actions)} align="start" />
          </div>
        </div>
      </div>
    </div>
  );
}

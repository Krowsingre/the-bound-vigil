import { useEffect, useState } from "react";
import { api } from "../api";
import type { MissingBook, SeriesMatch, SeriesReview } from "../api/types";
import { BookCover } from "../components/BookCover";
import { Icon } from "../components/Icon";
import { useToast } from "../components/Toast";
import { authorLine } from "../lib/format";

const number = (n: number | null) => (n === null ? null : `Book ${n}`);

export interface SeriesState {
  review: SeriesReview | null;
  busy: boolean;
  /** Looks the series up online for the books missing here. */
  find: () => void;
  run: (work: () => Promise<SeriesReview>, changed?: boolean) => Promise<void>;
}

/** A series' check for missing books, shared by its Find button and its panel. */
export function useSeriesReview(name: string | null, author: string, refreshKey: number, onChanged: () => void): SeriesState {
  const toast = useToast();
  const [review, setReview] = useState<SeriesReview | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setReview(null);
    if (!name) return;
    let current = true;
    api.seriesReview(name).then(
      (r) => current && setReview(r),
      () => current && setReview(null),
    );
    return () => {
      current = false;
    };
  }, [name, refreshKey]);

  const run = async (work: () => Promise<SeriesReview>, changed = false) => {
    setBusy(true);
    try {
      setReview(await work());
      if (changed) onChanged();
    } catch (e) {
      toast(String(e).replace(/^Error: /, ""));
    } finally {
      setBusy(false);
    }
  };
  return { review, busy, run, find: () => void (name && run(() => api.findSeriesBooks(name, author))) };
}

/** The series' Find missing books button. */
export function FindMissingButton({ state }: { state: SeriesState }) {
  if (!state.review) return null;
  return (
    <button type="button" className="btn btn-quiet" disabled={state.busy} onClick={state.find}>
      <Icon name="search" size={16} /> {state.busy ? "Looking…" : state.review.checkedAt ? "Check again" : "Find missing books"}
    </button>
  );
}

/**
 * Shown under a series: the books of it that aren't in the library (found
 * online, or added by hand), and books in the library that probably belong
 * to it, for Approve or Deny. Books already here aren't listed again.
 * Its Find button sits with the series' other buttons, unless `withFind`.
 */
export function SeriesPanel({
  name,
  author,
  refreshKey,
  onChanged,
  state: given,
  withFind = false,
}: {
  name: string;
  /** Narrows the online search. */
  author: string;
  refreshKey: number;
  /** Books' details changed, so the books shown need loading again. */
  onChanged: () => void;
  /** The check, when the page holds it (its Find button is elsewhere). */
  state?: SeriesState;
  withFind?: boolean;
}) {
  const own = useSeriesReview(given ? null : name, author, refreshKey, onChanged);
  const { review, busy, run } = given ?? own;
  const [showHidden, setShowHidden] = useState(false);
  const [adding, setAdding] = useState(false);

  if (!review) return null;
  // Nothing to show until it has looked, or found a book that may belong.
  if (!withFind && !review.checkedAt && review.missing.length === 0 && review.matches.length === 0) return null;
  const visible = review.missing.filter((m) => showHidden || !m.hidden);
  const hiddenCount = review.missing.filter((m) => m.hidden).length;
  const readCount = review.missing.filter((m) => m.read && !m.hidden).length;
  const approve = (matches: SeriesMatch[]) =>
    void run(
      () =>
        api.approveSeriesMatches(
          name,
          matches.map((m) => ({ bookId: m.book.id, position: m.position })),
        ),
      true,
    );
  const deny = (matches: SeriesMatch[]) =>
    void run(() =>
      api.denySeriesMatches(
        name,
        matches.map((m) => m.book.id),
      ),
    );

  return (
    <section className="series-panel" aria-label={`The ${name} series`}>
      <header className="series-head">
        <div>
          <strong>{name}</strong>
          <span className="muted">
            {review.checkedAt
              ? `You have ${review.owned} of the ${review.listed} books listed online${readCount ? ` · ${readCount} more read elsewhere` : ""}`
              : review.missing.length || review.matches.length
                ? "Books of this series that aren't in your library yet."
                : `${review.owned} ${review.owned === 1 ? "book" : "books"} here. Find out which ones you're missing.`}
          </span>
        </div>
        {withFind && <FindMissingButton state={given ?? own} />}
      </header>

      {review.matches.length > 0 && (
        <div className="series-matches">
          <div className="series-sub">
            <span>
              <strong>Might be in this series</strong>
              <span className="muted"> · their details don't say so yet</span>
            </span>
            <span className="series-sub-actions">
              <button type="button" className="btn btn-quiet btn-small" disabled={busy} onClick={() => deny(review.matches)}>
                Deny all
              </button>
              <button type="button" className="btn btn-primary btn-small" disabled={busy} onClick={() => approve(review.matches)}>
                Approve all
              </button>
            </span>
          </div>
          <ul>
            {review.matches.map((m) => (
              <li key={m.book.id} className="duplicate-book">
                <BookCover book={m.book} size="s" />
                <span className="duplicate-text">
                  <strong>{m.book.title}</strong>
                  <span className="muted">{authorLine(m.book.authors)}</span>
                  <span className="muted duplicate-facts">{[number(m.position), m.reason].filter(Boolean).join(" · ")}</span>
                </span>
                <button type="button" className="btn btn-quiet btn-small" disabled={busy} onClick={() => deny([m])}>
                  Deny
                </button>
                <button type="button" className="btn btn-primary btn-small" disabled={busy} onClick={() => approve([m])}>
                  Approve
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {review.checkedAt && review.missing.length === 0 && <p className="muted series-done">You have every book in the list.</p>}
      {(review.missing.length > 0 || review.checkedAt) && (
        <div className="series-missing">
          <div className="series-sub">
            <strong>Missing from your library</strong>
            <span className="series-sub-actions">
              {hiddenCount > 0 && (
                <button type="button" className="view-all" onClick={() => setShowHidden((s) => !s)}>
                  {showHidden ? "Leave hidden ones out" : `Show ${hiddenCount} hidden`}
                </button>
              )}
              <button type="button" className="view-all" onClick={() => setAdding((a) => !a)}>
                {adding ? "Cancel" : "Add a book the list is missing"}
              </button>
            </span>
          </div>
          {adding && (
            <AddMissing
              busy={busy}
              onAdd={(title, position) =>
                void run(() => api.addSeriesBook(name, title, position, author ? [author] : [])).then(() => setAdding(false))
              }
            />
          )}
          {visible.length > 0 && (
            <ul className="missing-row">
              {visible.map((m) => (
                <MissingCard
                  key={m.key}
                  book={m}
                  busy={busy}
                  onHide={(hidden) => void run(() => api.hideSeriesBook(name, m.key, hidden))}
                  onRead={(read) => void run(() => api.markSeriesBookRead(name, m.key, read))}
                  onRemove={m.source === "you" ? () => void run(() => api.removeSeriesBook(name, m.key)) : undefined}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

/** Adds a book no source lists: its title and number. */
function AddMissing({ busy, onAdd }: { busy: boolean; onAdd: (title: string, position: number | null) => void }) {
  const [title, setTitle] = useState("");
  const [position, setPosition] = useState("");
  const n = position.trim() ? Number(position.replace(",", ".")) : null;
  const ok = title.trim().length > 0 && (n === null || (Number.isFinite(n) && n >= 0));
  return (
    <form
      className="series-add"
      onSubmit={(e) => {
        e.preventDefault();
        if (ok) onAdd(title.trim(), n);
      }}
    >
      <input
        type="text"
        placeholder="Title"
        aria-label="Title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        autoFocus
      />
      <input
        type="text"
        inputMode="decimal"
        placeholder="Book number"
        aria-label="Book number"
        value={position}
        onChange={(e) => setPosition(e.target.value)}
      />
      <button type="submit" className="btn btn-primary btn-small" disabled={busy || !ok}>
        Add
      </button>
    </form>
  );
}

function MissingCard({
  book,
  busy,
  onHide,
  onRead,
  onRemove,
}: {
  book: MissingBook;
  busy: boolean;
  onHide: (hidden: boolean) => void;
  onRead: (read: boolean) => void;
  /** For books added by hand. */
  onRemove?: () => void;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <li className={`missing-card${book.hidden ? " is-hidden" : ""}${book.read ? " is-read" : ""}`}>
      <div className="cover cover-m missing-cover">
        <div className="cover-private" aria-hidden>
          <span className="cover-title">{book.title}</span>
        </div>
        {book.coverUrl && !failed ? (
          <img className="private-picture" src={book.coverUrl} alt="" draggable={false} onError={() => setFailed(true)} />
        ) : (
          <div className="cover-generated missing-blank">
            <span className="cover-title">{book.title}</span>
          </div>
        )}
        <span className="missing-badge">{book.read ? "Read" : "Missing"}</span>
      </div>
      <span className="missing-title" title={book.title}>
        {book.title}
      </span>
      <span className="missing-meta">
        <span className="muted">{number(book.position) ?? "No number"}</span>
        <span className="missing-actions">
          <button
            type="button"
            className={`icon-btn${book.read ? " is-on" : ""}`}
            disabled={busy}
            aria-pressed={book.read}
            title={book.read ? "Not read after all" : "Mark as read (read somewhere else)"}
            aria-label={book.read ? `${book.title} isn't read` : `Mark ${book.title} as read`}
            onClick={() => onRead(!book.read)}
          >
            <Icon name="check" size={14} />
          </button>
          {onRemove && (
            <button
              type="button"
              className="icon-btn"
              disabled={busy}
              title="Take it off the list"
              aria-label={`Take ${book.title} off the list`}
              onClick={onRemove}
            >
              <Icon name="trash" size={14} />
            </button>
          )}
          <button
            type="button"
            className="icon-btn"
            disabled={busy}
            title={book.hidden ? "Show it again" : "Hide it (a short story or another edition, say)"}
            aria-label={book.hidden ? `Show ${book.title} again` : `Hide ${book.title}`}
            onClick={() => onHide(!book.hidden)}
          >
            <Icon name={book.hidden ? "focus" : "eyeOff"} size={14} />
          </button>
        </span>
      </span>
    </li>
  );
}

import { useEffect, useState } from "react";
import { api } from "../api";
import type { MissingBook, SeriesMatch, SeriesReview } from "../api/types";
import { BookCover } from "../components/BookCover";
import { Icon } from "../components/Icon";
import { useToast } from "../components/Toast";
import { authorLine } from "../lib/format";
import { clearSeriesNews, seriesNews } from "./seriesCheck";
import { canWatch, isWatchingBook, unwatchBook, useWatch, watchBook } from "./watchList";

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
  // Shown at once, before the series' saved list has loaded: it never waits to appear.
  return (
    <button type="button" className="btn btn-quiet" disabled={state.busy} onClick={state.find}>
      <Icon name="search" size={16} /> {state.busy ? "Looking…" : state.review?.checkedAt ? "Check again" : "Find missing books"}
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
  const [showRemoved, setShowRemoved] = useState(false);
  const [adding, setAdding] = useState(false);
  // Books the series check found since this series was last looked at: marked New here, then taken off Sanctum's row.
  // Taken again whenever the panel shows another series, before that series' news is cleared.
  const snapshot = (of: string) => ({ series: of, keys: new Set(seriesNews().filter((n) => n.series === of).map((n) => n.key)) });
  const [taken, setTaken] = useState(() => snapshot(name));
  const current = taken.series === name ? taken : snapshot(name);
  if (current !== taken) setTaken(current);
  const fresh = current.keys;
  useEffect(() => {
    if (fresh.size) clearSeriesNews(name);
  }, [fresh, name]);

  if (!review) return null;
  // Nothing to show until it has looked, or found a book that may belong.
  if (!withFind && !review.checkedAt && review.missing.length === 0 && review.matches.length === 0) return null;
  // A book said not to be in the series shows only with Show removed, even when hidden too.
  const visible = review.missing.filter((m) => (m.removed ? showRemoved : showHidden || !m.hidden));
  const hiddenCount = review.missing.filter((m) => m.hidden && !m.removed).length;
  const removedCount = review.missing.filter((m) => m.removed).length;
  const readCount = review.missing.filter((m) => m.read && !m.hidden && !m.removed).length;
  const stillMissing = review.missing.filter((m) => !m.removed).length;
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

      <SeriesMatches matches={review.matches} busy={busy} onApprove={approve} onDeny={deny} />

      {review.checkedAt && stillMissing === 0 && <p className="muted series-done">You have every book in the list.</p>}
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
              {removedCount > 0 && (
                <button type="button" className="view-all" onClick={() => setShowRemoved((s) => !s)}>
                  {showRemoved ? "Leave removed ones out" : `Show ${removedCount} removed`}
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
                  isNew={fresh.has(m.key)}
                  busy={busy}
                  onHide={(hidden) => void run(() => api.hideSeriesBook(name, m.key, hidden))}
                  onRead={(read) => void run(() => api.markSeriesBookRead(name, m.key, read))}
                  onNotInSeries={m.source === "you" ? undefined : (removed) => void run(() => api.removeListedSeriesBook(name, m.key, removed))}
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
  isNew = false,
  busy,
  onHide,
  onRead,
  onRemove,
  onNotInSeries,
}: {
  book: MissingBook;
  /** Found by the last series check. */
  isNew?: boolean;
  busy: boolean;
  onHide: (hidden: boolean) => void;
  onRead: (read: boolean) => void;
  /** For books added by hand. */
  onRemove?: () => void;
  /** For books found online: says it isn't in the series at all, or puts it back. */
  onNotInSeries?: (removed: boolean) => void;
}) {
  const [failed, setFailed] = useState(false);
  useWatch(); // shown again when the watch list changes
  const watching = isWatchingBook(book.title);
  return (
    <li className={`missing-card${book.hidden || book.removed ? " is-hidden" : ""}${book.read ? " is-read" : ""}`}>
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
        <span className={`missing-badge${isNew && !book.read && !book.removed ? " is-new" : ""}`}>
          {book.removed ? "Not in series" : book.read ? "Read" : isNew ? "New" : "Missing"}
        </span>
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
          {canWatch() && !book.read && (
            <button
              type="button"
              className={`icon-btn${watching ? " is-on" : ""}`}
              aria-pressed={watching}
              title={watching ? "Stop watching it" : "Watch it: news when it's announced and when it's out"}
              aria-label={watching ? `Stop watching ${book.title}` : `Watch ${book.title}`}
              onClick={() => (watching ? unwatchBook(book.title) : watchBook(book.title, book.authors[0] ?? ""))}
            >
              <Icon name="bell" size={14} />
            </button>
          )}
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
          {onNotInSeries && (
            <button
              type="button"
              className={`icon-btn${book.removed ? " is-on" : ""}`}
              disabled={busy}
              aria-pressed={!!book.removed}
              title={book.removed ? "Put it back in the series" : "Not in this series (a wrong match online)"}
              aria-label={book.removed ? `Put ${book.title} back in the series` : `${book.title} is not in this series`}
              onClick={() => onNotInSeries(!book.removed)}
            >
              <Icon name="close" size={14} />
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

/**
 * Books in the library (Archive or Resonance) that are probably in the
 * series, though their details don't say so: Approve puts them in, Deny
 * stops them being offered. Shown under a series and on a book's page.
 */
export function SeriesMatches({
  matches,
  busy,
  onApprove,
  onDeny,
}: {
  matches: SeriesMatch[];
  busy: boolean;
  onApprove: (matches: SeriesMatch[]) => void;
  onDeny: (matches: SeriesMatch[]) => void;
}) {
  if (!matches.length) return null;
  return (
    <div className="series-matches">
      <div className="series-sub">
        <span>
          <strong>Might be in this series</strong>
          <span className="muted"> · their details don't say so yet</span>
        </span>
        <span className="series-sub-actions">
          <button type="button" className="btn btn-quiet btn-small" disabled={busy} onClick={() => onDeny(matches)}>
            Deny all
          </button>
          <button type="button" className="btn btn-primary btn-small" disabled={busy} onClick={() => onApprove(matches)}>
            Approve all
          </button>
        </span>
      </div>
      <ul>
        {matches.map((m) => (
          <li key={m.book.id} className="duplicate-book">
            <BookCover book={m.book} size="s" />
            <span className="duplicate-text">
              <strong>{m.book.title}</strong>
              <span className="muted">{authorLine(m.book.authors)}</span>
              <span className="muted duplicate-facts">{[number(m.position), m.reason].filter(Boolean).join(" · ")}</span>
            </span>
            <button type="button" className="btn btn-quiet btn-small" disabled={busy} onClick={() => onDeny([m])}>
              Deny
            </button>
            <button type="button" className="btn btn-primary btn-small" disabled={busy} onClick={() => onApprove([m])}>
              Approve
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

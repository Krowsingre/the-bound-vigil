import { useEffect, useState } from "react";
import { api } from "../api";
import type { MissingBook, SeriesMatch, SeriesReview } from "../api/types";
import { BookCover } from "../components/BookCover";
import { Icon } from "../components/Icon";
import { useToast } from "../components/Toast";
import { authorLine } from "../lib/format";

const number = (n: number | null) => (n === null ? null : `Book ${n}`);

/**
 * Shown above a series (Show series): finds its other books online, shows
 * the ones missing here, and offers books in the library that probably
 * belong to it for Approve or Deny.
 */
export function SeriesPanel({
  name,
  author,
  refreshKey,
  onChanged,
}: {
  name: string;
  /** Narrows the online search. */
  author: string;
  refreshKey: number;
  /** Books' details changed, so the books shown need loading again. */
  onChanged: () => void;
}) {
  const toast = useToast();
  const [review, setReview] = useState<SeriesReview | null>(null);
  const [busy, setBusy] = useState(false);
  const [showHidden, setShowHidden] = useState(false);

  useEffect(() => {
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

  if (!review) return null;
  const visible = review.missing.filter((m) => showHidden || !m.hidden);
  const hiddenCount = review.missing.filter((m) => m.hidden).length;
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
              ? `You have ${review.owned} of the ${review.listed} books listed online`
              : `${review.owned} ${review.owned === 1 ? "book" : "books"} here. Find out which ones you're missing.`}
          </span>
        </div>
        <button
          type="button"
          className="btn btn-quiet"
          disabled={busy}
          onClick={() => void run(() => api.findSeriesBooks(name, author))}
        >
          <Icon name="search" size={16} /> {busy ? "Looking…" : review.checkedAt ? "Check again" : "Find missing books"}
        </button>
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
      {review.missing.length > 0 && (
        <div className="series-missing">
          <div className="series-sub">
            <strong>Missing from your library</strong>
            {hiddenCount > 0 && (
              <button type="button" className="view-all" onClick={() => setShowHidden((s) => !s)}>
                {showHidden ? "Leave hidden ones out" : `Show ${hiddenCount} hidden`}
              </button>
            )}
          </div>
          <ul className="missing-row">
            {visible.map((m) => (
              <MissingCard
                key={m.key}
                book={m}
                busy={busy}
                onHide={(hidden) => void run(() => api.hideSeriesBook(name, m.key, hidden))}
              />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function MissingCard({ book, busy, onHide }: { book: MissingBook; busy: boolean; onHide: (hidden: boolean) => void }) {
  const [failed, setFailed] = useState(false);
  return (
    <li className={`missing-card${book.hidden ? " is-hidden" : ""}`}>
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
        <span className="missing-badge">Missing</span>
      </div>
      <span className="missing-title" title={book.title}>
        {book.title}
      </span>
      <span className="missing-meta">
        <span className="muted">{number(book.position) ?? "No number"}</span>
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
    </li>
  );
}

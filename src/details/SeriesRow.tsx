// A book's details: the other books of its series, in order. Books not in
// the library are greyed out, as on the series' own page. A book of the list
// that's in Archive or Resonance under another series (or none) shows in its
// place, marked In your library, and is offered under the strip to approve.

import { useEffect, useState } from "react";
import { api, isHome, isWeb } from "../api";
import type { MissingBook, OwnedBook, SeriesMatch, SeriesReview } from "../api/types";
import { placesIn, placesWords, placeWords } from "../lib/details";
import { BookCover } from "../components/BookCover";
import { Icon } from "../components/Icon";
import { useToast } from "../components/Toast";
import { SeriesMatches } from "../library/SeriesPanel";
import { showBookDetails } from "./openDetails";

type Item = { owned: OwnedBook } | { missing: MissingBook };

const position = (i: Item) => ("owned" in i ? i.owned.position : i.missing.position);

export function SeriesRow({
  name,
  author,
  bookId,
  refreshKey,
  titled = false,
}: {
  name: string;
  author: string;
  bookId: string;
  refreshKey: number;
  /** In several series: each row says which. */
  titled?: boolean;
}) {
  const toast = useToast();
  const [review, setReview] = useState<SeriesReview | null>(null);
  const [busy, setBusy] = useState(false);

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

  if (!review) return null;
  const items: Item[] = [
    ...review.ownedBooks.map((owned) => ({ owned })),
    ...review.missing.filter((m) => !m.hidden && !m.removed).map((missing) => ({ missing })),
  ].sort((a, b) => (position(a) ?? 1e9) - (position(b) ?? 1e9));
  const canLook = !isWeb && !isHome;
  // With nothing to show and no way to look, there's no section; once it can look, it's always offered.
  if (items.length <= 1 && !canLook) return null;

  const run = (work: () => Promise<SeriesReview>) => {
    setBusy(true);
    work()
      .then(setReview, (e: unknown) => toast(String(e).replace(/^Error: /, "")))
      .finally(() => setBusy(false));
  };
  const find = () => run(() => api.findSeriesBooks(name, author));
  const approve = (matches: SeriesMatch[]) =>
    run(() => api.approveSeriesMatches(name, matches.map((m) => ({ bookId: m.book.id, position: m.position }))));
  const deny = (matches: SeriesMatch[]) => run(() => api.denySeriesMatches(name, matches.map((m) => m.book.id)));
  // A listed book that's already in the library under other details.
  const inLibrary = (key: string) => review.matches.find((m) => m.forKey === key)?.book ?? null;

  return (
    <section className="details-section">
      <h2>
        {titled ? name : "In this series"}
        {review.checkedAt && (
          <span className="details-origin">
            You have {review.owned} of {review.listed}
          </span>
        )}
      </h2>
      <ul className="series-strip">
        {items.map((item) =>
          "owned" in item ? (
            <li key={item.owned.book.id} className={item.owned.book.id === bookId ? "is-current" : undefined}>
              <button
                type="button"
                className="series-strip-book"
                onClick={() => showBookDetails(item.owned.book.id)}
                disabled={item.owned.book.id === bookId}
              >
                <BookCover book={item.owned.book} size="s" />
                <span className="series-strip-title" title={item.owned.book.title}>
                  {item.owned.book.title}
                </span>
                <span className="muted">
                  {placesIn(item.owned.book, name).length > 1
                    ? placesWords(placesIn(item.owned.book, name))
                    : item.owned.place
                      ? placeWords(item.owned.place)
                      : item.owned.position !== null ? `Book ${item.owned.position}` : "No number"}
                </span>
              </button>
            </li>
          ) : (
            (() => {
              const here = inLibrary(item.missing.key);
              return here ? (
                <li key={`missing-${item.missing.key}`}>
                  <button type="button" className="series-strip-book" onClick={() => showBookDetails(here.id)}>
                    <BookCover book={here} size="s" />
                    <span className="series-strip-title" title={here.title}>
                      {here.title}
                    </span>
                    <span className="muted">
                      {item.missing.position !== null ? `Book ${item.missing.position}` : "No number"} · In your library
                    </span>
                  </button>
                </li>
              ) : (
                <li key={`missing-${item.missing.key}`} className="is-missing">
                  <MissingCover book={item.missing} />
                  <span className="series-strip-title" title={item.missing.title}>
                    {item.missing.title}
                  </span>
                  <span className="muted">
                    {item.missing.position !== null ? `Book ${item.missing.position}` : "No number"}
                    {item.missing.read ? " · Read" : ""}
                  </span>
                </li>
              );
            })()
          ),
        )}
      </ul>
      {review.checkedAt && items.length <= 1 && <p className="muted">No other books of this series were found online.</p>}
      <SeriesMatches matches={review.matches} busy={busy} onApprove={approve} onDeny={deny} />
      {canLook && (
        <button type="button" className="view-all" disabled={busy} onClick={find}>
          <Icon name="search" size={14} /> {busy ? "Looking…" : review.checkedAt ? "Check again" : "Find the rest of the series online"}
        </button>
      )}
    </section>
  );
}

function MissingCover({ book }: { book: MissingBook }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="cover cover-s missing-cover" title={`${book.title} (not in your library)`}>
      {book.coverUrl && !failed ? (
        <img className="private-picture" src={book.coverUrl} alt="" draggable={false} onError={() => setFailed(true)} />
      ) : (
        <div className="cover-generated missing-blank">
          <span className="cover-title">{book.title}</span>
        </div>
      )}
    </div>
  );
}

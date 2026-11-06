// "Kindle, not in library" (embre, 5 November 2026): the books bought on
// Kindle that aren't in the library yet. A book leaves the list by itself
// once it's added to the library, or by hand, which is remembered.

import { useEffect, useMemo, useState } from "react";
import { api, openExternal } from "../api";
import type { KindlePurchase, KindleReview, KindleSummary } from "../api/types";
import { KindleReviewDialog } from "../imports/KindleReview";
import { Icon } from "../components/Icon";
import { useToast } from "../components/Toast";
import { hashOf } from "../lib/format";
import { CoverStrip } from "./CollectionCards";
import { bookCount } from "./collectionInfo";

export const KINDLE_NAME = "Kindle, not in library";
const AT_ONCE = 120;

export function KindleCard({ summary, layout, onOpen }: { summary: KindleSummary; layout: "grid" | "list"; onOpen: () => void }) {
  return (
    <li className={`collection-card collection-card-${layout} kindle-card`} data-tone={hashOf(KINDLE_NAME) % 4}>
      <button type="button" className="collection-card-open" onClick={onOpen}>
        <span className="collection-card-head">
          <span className="collection-card-name">
            <Icon name="tag" size={16} />
            {KINDLE_NAME}
          </span>
          <span className="collection-card-meta">{bookCount(summary.missing)} · From Kindle</span>
        </span>
        {layout === "grid" ? (
          <CoverStrip covers={[]} count={summary.missing} missing={summary.covers} />
        ) : (
          <span className="collection-card-desc">Bought on Kindle, not yet in your library.</span>
        )}
      </button>
    </li>
  );
}

const dayOf = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : null);

export function KindleView({ onBack, onChanged }: { onBack: () => void; onChanged: () => void }) {
  const toast = useToast();
  const [removed, setRemoved] = useState(false);
  const [list, setList] = useState<KindlePurchase[] | null>(null);
  const [shown, setShown] = useState(AT_ONCE);
  const [filter, setFilter] = useState("");
  const [reload, setReload] = useState(0);
  const [waiting, setWaiting] = useState(0);
  const [review, setReview] = useState<KindleReview | null>(null);
  useEffect(() => {
    let live = true;
    setList(null);
    api.kindleMissing(removed).then(
      (l) => {
        if (!live) return;
        setList(l);
        void api.kindleSummary().then((k) => live && setWaiting(k.waiting), () => undefined);
      },
      (e: unknown) => live && (toast(`The Kindle list couldn't be loaded: ${String(e)}`), setList([])),
    );
    return () => void (live = false);
  }, [removed, reload, toast]);
  useEffect(() => setShown(AT_ONCE), [removed, filter]);
  const q = filter.trim().toLowerCase();
  const matching = useMemo(() => (list ?? []).filter((p) => !q || p.title.toLowerCase().includes(q) || p.author.toLowerCase().includes(q)), [list, q]);

  const change = (p: KindlePurchase) =>
    api.setKindleRemoved([p.asin], !removed).then(
      () => {
        setList((l) => l?.filter((x) => x.asin !== p.asin) ?? l);
        toast(removed ? `${p.title} is back on the list.` : `${p.title} is off the list. Show removed books to bring it back.`);
        onChanged();
      },
      (e: unknown) => toast(`That didn't work: ${String(e)}`),
    );

  return (
    <div className="collection-view kindle-view">
      <header className="collection-hero kindle-hero">
        <div className="collection-hero-text">
          <button type="button" className="back-link" onClick={onBack}>
            <Icon name="chevronLeft" size={14} /> Collections
          </button>
          <h1>
            <Icon name="tag" size={26} />
            {KINDLE_NAME}
          </h1>
          <p className="collection-hero-meta">{list ? `${bookCount(list.length)}${removed ? " taken off the list" : " · From Kindle"}` : "Looking…"}</p>
          <p className="collection-hero-description">
            Books you've bought on Kindle that aren't in your library yet. Each one leaves the list by itself once you add it. TBV can't download Kindle books, so
            this is a list of what's still to bring over.
          </p>
        </div>
      </header>
      <div className="collection-view-tools kindle-tools">
        <input
          type="search"
          className="kindle-filter"
          placeholder="Find a title or author"
          aria-label="Find a Kindle book"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <label className="kindle-show-removed">
          <input type="checkbox" checked={removed} onChange={(e) => setRemoved(e.target.checked)} /> Show removed books
        </label>
        {waiting > 0 && (
          <button
            type="button"
            className="btn btn-primary btn-small"
            onClick={() => void api.kindleReview().then(setReview, (e: unknown) => toast(`That didn't work: ${String(e)}`))}
          >
            Review {waiting.toLocaleString()} {waiting === 1 ? "match" : "matches"}
          </button>
        )}
        <button type="button" className="btn btn-quiet btn-small" onClick={() => setReload((n) => n + 1)}>
          <Icon name="sync" size={14} /> Check the library again
        </button>
      </div>
      {list === null ? (
        <div className="library-loading" aria-busy="true" />
      ) : matching.length === 0 ? (
        <div className="library-empty collections-empty">
          <h2>{q ? "Nothing matches" : removed ? "Nothing taken off the list" : "Every Kindle book is in your library"}</h2>
          <p className="muted">
            {q ? `No Kindle books match “${filter.trim()}”.` : removed ? "Books you take off the list wait here." : "When you have a newer list, choose it in Import books."}
          </p>
        </div>
      ) : (
        <>
          <ul className="missing-row kindle-row">
            {matching.slice(0, shown).map((p) => (
              <KindleBook key={p.asin} book={p} removed={removed} onChange={() => void change(p)} />
            ))}
          </ul>
          {matching.length > shown && (
            <button type="button" className="btn btn-quiet kindle-more" onClick={() => setShown((n) => n + AT_ONCE)}>
              Show more ({(matching.length - shown).toLocaleString()} left)
            </button>
          )}
        </>
      )}
      {review && (
        <KindleReviewDialog
          review={review}
          imported={null}
          onClose={(applied) => {
            setReview(null);
            if (applied) {
              setReload((n) => n + 1);
              onChanged();
            }
          }}
        />
      )}
    </div>
  );
}

function KindleBook({ book, removed, onChange }: { book: KindlePurchase; removed: boolean; onChange: () => void }) {
  const [failed, setFailed] = useState(false);
  const day = dayOf(book.acquiredAt);
  return (
    <li className={`missing-card${book.read ? " is-read" : ""}${removed ? " is-hidden" : ""}`}>
      <div className="cover cover-m missing-cover kindle-cover">
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
        {book.read && <span className="missing-badge">Read</span>}
      </div>
      <span className="missing-title" title={book.title}>
        {book.title}
      </span>
      <span className="kindle-author muted" title={book.author}>
        {book.author || "Unknown author"}
      </span>
      <span className="missing-meta">
        <span className="muted">{day ?? ""}</span>
        <span className="missing-actions">
          <button
            type="button"
            className="icon-btn"
            title="Open on Amazon"
            aria-label={`Open ${book.title} on Amazon`}
            onClick={() => void openExternal(book.link)}
          >
            <Icon name="link" size={14} />
          </button>
          <button
            type="button"
            className="icon-btn"
            title={removed ? "Put it back on the list" : "Take it off the list"}
            aria-label={removed ? `Put ${book.title} back on the list` : `Take ${book.title} off the list`}
            onClick={onChange}
          >
            <Icon name={removed ? "undo" : "close"} size={14} />
          </button>
        </span>
      </span>
    </li>
  );
}

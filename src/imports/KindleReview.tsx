// The review after choosing a list of Kindle books in Import books (a .json
// file): the books found in the library, the close ones to tick, and how
// many aren't in it. Nothing changes until Tag is pressed: then the books
// get the tag Kindle and, if wanted, the ones read on Kindle are marked Read.
// The rest wait in the Compendium as "Kindle, not in library".

import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { KindleImport, KindleMatch, KindleReview } from "../api/types";
import { Icon } from "../components/Icon";
import { useToast } from "../components/Toast";

const books = (n: number) => `${n.toLocaleString()} ${n === 1 ? "book" : "books"}`;
const byLine = (title: string, authors: string | string[]) => {
  const who = Array.isArray(authors) ? authors.join(", ") : authors;
  return who ? `${title} by ${who}` : title;
};

/** Tells the Compendium's Kindle card that the list changed. */
export const KINDLE_CHANGED = "tbv:kindle-changed";

/** Whether a chosen file is a list of Kindle books rather than a book. */
export const isKindleList = (path: string) => /\.json$/i.test(path);

export function KindleReviewDialog({ review, imported, onClose }: { review: KindleReview; imported: KindleImport | null; onClose: (applied: boolean) => void }) {
  const toast = useToast();
  const [yes, setYes] = useState<Set<string>>(new Set());
  const [markRead, setMarkRead] = useState(review.markRead);
  const [busy, setBusy] = useState(false);
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => first.current?.focus(), []);
  const tagging = new Set([...review.matched, ...review.probable.filter((p) => yes.has(p.asin))].filter((m) => !m.borrowed).map((m) => m.bookId)).size;
  const nothing = review.matched.length === 0 && review.probable.length === 0;

  const apply = async () => {
    setBusy(true);
    try {
      const done = await api.applyKindle([...yes], markRead);
      const parts = [
        done.tagged > 0 ? `Tagged ${books(done.tagged)} Kindle.` : "No new books to tag.",
        done.markedRead > 0 && `${books(done.markedRead)} marked Read.`,
        done.missing > 0 && `${books(done.missing)} are in Kindle, not in library.`,
      ].filter(Boolean);
      toast(parts.join(" "));
      window.dispatchEvent(new Event(KINDLE_CHANGED));
      onClose(true);
    } catch (e) {
      toast(`That didn't work: ${String(e)}`);
      setBusy(false);
    }
  };

  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose(false)}>
      <div className="dialog kindle-review" role="dialog" aria-label="Your Kindle books" onKeyDown={(e) => e.key === "Escape" && onClose(false)}>
        <h2>Your Kindle books</h2>
        {imported && (
          <p className="muted">
            {books(imported.total)} in the file
            {imported.newPurchases < imported.total && `, ${imported.newPurchases.toLocaleString()} of them new`}.
            {imported.borrowed > 0 && ` ${books(imported.borrowed)} were borrowed, not bought, so they won't be tagged or listed.`}
          </p>
        )}
        {nothing ? (
          <p>No books in your library are waiting to be matched. {review.missing > 0 && `${books(review.missing)} are in the Compendium as Kindle, not in library.`}</p>
        ) : (
          <>
            {review.matched.length > 0 && (
              <details className="kindle-group">
                <summary>
                  <Icon name="check" size={15} /> <strong>In your library</strong> {books(review.matched.length)}, same title and author
                </summary>
                <ul className="kindle-list">
                  {review.matched.map((m) => (
                    <li key={m.asin}>{byLine(m.bookTitle, m.bookAuthors)}</li>
                  ))}
                </ul>
              </details>
            )}
            {review.probable.length > 0 && (
              <div className="kindle-group">
                <div className="kindle-group-head">
                  <span>
                    <strong>Probably in your library</strong> {books(review.probable.length)}. Tick each one that's the same book.
                  </span>
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() => setYes(yes.size === review.probable.length ? new Set() : new Set(review.probable.map((p) => p.asin)))}
                  >
                    {yes.size === review.probable.length ? "Untick all" : "Tick all"}
                  </button>
                </div>
                <ul className="kindle-list kindle-probable">
                  {review.probable.map((p) => (
                    <ProbableRow
                      key={p.asin}
                      match={p}
                      checked={yes.has(p.asin)}
                      onChange={(on) => {
                        const next = new Set(yes);
                        if (on) next.add(p.asin);
                        else next.delete(p.asin);
                        setYes(next);
                      }}
                    />
                  ))}
                </ul>
              </div>
            )}
            <p className="kindle-group kindle-missing-line">
              <Icon name="collections" size={15} /> <strong>Not in your library</strong> {books(review.missing)}. They'll wait in the Compendium as Kindle, not
              in library, and leave it by themselves when you add them.
            </p>
            {review.readToMark > 0 && (
              <label className="kindle-mark-read">
                <input type="checkbox" checked={markRead} onChange={(e) => setMarkRead(e.target.checked)} />
                <span>
                  Mark the {books(review.readToMark)} you've read on Kindle as Read
                  <span className="muted"> Books you've already started or finished in TBV stay as they are.</span>
                </span>
              </label>
            )}
          </>
        )}
        <div className="dialog-actions">
          {nothing ? (
            <button ref={first} type="button" className="btn btn-primary" onClick={() => onClose(false)}>
              Done
            </button>
          ) : (
            <>
              <button type="button" className="btn btn-quiet" onClick={() => onClose(false)} disabled={busy}>
                Later
              </button>
              <button ref={first} type="button" className="btn btn-primary" onClick={() => void apply()} disabled={busy}>
                {busy ? "Tagging…" : `Tag ${books(tagging)} Kindle`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ProbableRow({ match, checked, onChange }: { match: KindleMatch; checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <li>
      <label>
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span>
          <span className="kindle-probable-kindle">
            <span className="kindle-label">Kindle</span> {byLine(match.title, match.author)}
          </span>
          <span className="kindle-probable-yours muted">
            <span className="kindle-label">Yours</span> {byLine(match.bookTitle, match.bookAuthors)}
          </span>
        </span>
      </label>
    </li>
  );
}

// Near the end of a book (about 97% on), a panel fades up from the bottom of
// the page: rate the book, mark it read, and then remove the download if you
// like, which closes the book.
import { useState } from "react";
import { api } from "../api";
import type { BookPreview } from "../api/types";
import { Icon } from "../components/Icon";
import { StarRating } from "../components/StarRating";

/** How far through a book the panel appears. */
export const END_OF_BOOK = 0.97;

export function EndOfBook({
  book,
  onRated,
  onMarkRead,
  onRemove,
  onDismiss,
}: {
  book: BookPreview;
  onRated: (rating: number | null) => void;
  /** Marks the book read; resolves once it is. */
  onMarkRead: () => Promise<void>;
  /** Closes the book and removes its download. */
  onRemove: () => void;
  onDismiss: () => void;
}) {
  const [step, setStep] = useState<"ask" | "remove">(book.status === "read" ? "remove" : "ask");
  const [busy, setBusy] = useState(false);
  // Only a download the cloud also has can be removed safely.
  const removable = book.availability === "local" && book.inCloud;
  const markRead = () => {
    if (busy) return;
    setBusy(true);
    void onMarkRead()
      .then(() => (removable ? setStep("remove") : onDismiss()))
      .finally(() => setBusy(false));
  };
  return (
    <div className="end-of-book" role="dialog" aria-label="The end of the book">
      <div className="end-of-book-card">
        <button type="button" className="icon-btn end-of-book-close" aria-label="Not now" onClick={onDismiss}>
          <Icon name="close" size={18} />
        </button>
        {step === "ask" ? (
          <>
            <p className="end-of-book-title">{book.title}</p>
            <div className="end-of-book-rating">
              <span>Rate this book</span>
              <StarRating
                value={book.rating}
                size={30}
                onChange={(rating) => void api.setRating(book.id, rating).then(() => onRated(rating), () => undefined)}
              />
            </div>
            <div className="end-of-book-actions">
              <button type="button" className="btn btn-primary" disabled={busy} onClick={markRead}>
                <Icon name="check" size={16} /> Mark as read
              </button>
              <button type="button" className="btn" onClick={onDismiss}>
                Not now
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="end-of-book-title">Remove the download?</p>
            <p className="muted">The book stays in your library and can be downloaded again.</p>
            <div className="end-of-book-actions">
              <button type="button" className="btn btn-primary" onClick={onRemove}>
                Remove and close
              </button>
              <button type="button" className="btn" onClick={onDismiss}>
                Keep it
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

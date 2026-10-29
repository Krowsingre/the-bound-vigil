// Pairing an audiobook with its ebook or document, from either side, so you
// can read along as it plays. Books with the same title come first.

import { useEffect, useState } from "react";
import { api } from "../api";
import type { BookPreview } from "../api/types";
import { BookCover } from "../components/BookCover";
import { useToast } from "../components/Toast";
import { isAudio, isDocument } from "../lib/queryBooks";
import { lookForPairs } from "../readAlong/lineUp";

const fold = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/^(the|a|an) /, "")
    .trim();

/** What's said when a document is paired: TBV can't follow one. */
export const DOCUMENT_PAIR_NOTE = "With a document, the audiobook plays alongside but TBV can't follow it: you turn the pages yourself.";

export function LinkEbook({
  audiobook,
  onClose,
}: {
  audiobook: BookPreview;
  /** The ebook linked, or undefined when nothing changed. */
  onClose: (ebook?: { id: string; name: string }) => void;
}) {
  return <PairDialog book={audiobook} onClose={(other) => onClose(other && { id: other.id, name: other.title })} />;
}

/**
 * Chooses the other half of a pair for `book`: ebooks and documents for an
 * audiobook, audiobooks for an ebook or document.
 */
export function PairDialog({ book, onClose }: { book: BookPreview; onClose: (other?: BookPreview) => void }) {
  const toast = useToast();
  const listening = isAudio(book.format);
  const [search, setSearch] = useState(book.title);
  const [books, setBooks] = useState<BookPreview[] | null>(null);

  useEffect(() => {
    let current = true;
    const query = {
      shelf: "all" as const,
      sort: "title" as const,
      search: search.trim() || null,
      formats: [],
      location: null,
      page: 0,
      pageSize: 40,
    };
    const wait = setTimeout(() => {
      const kinds = listening ? (["books", "documents"] as const) : (["audiobooks"] as const);
      Promise.all(kinds.map((kind) => api.getLibrary({ ...query, kind })))
        .then(
          (pages) => {
            if (!current) return;
            const title = fold(book.title);
            const found = pages.flatMap((p) => p.books).filter((b) => b.id !== book.id && isAudio(b.format) !== listening);
            setBooks(found.sort((a, b) => Number(fold(b.title) === title) - Number(fold(a.title) === title)));
          },
          () => current && setBooks([]),
        );
    }, 200);
    return () => {
      current = false;
      clearTimeout(wait);
    };
  }, [search, book.id, book.title, listening]);

  const link = (other: BookPreview) => {
    const [audio, text] = listening ? [book, other] : [other, book];
    return api.linkEbook(audio.id, text.id).then(
      () => {
        lookForPairs();
        toast(
          `“${audio.title}” is paired with “${text.title}”.` + (isDocument(text.format) ? ` ${DOCUMENT_PAIR_NOTE}` : ""),
        );
        onClose(other);
      },
      (e: unknown) => toast(`Couldn't pair them: ${String(e)}`),
    );
  };

  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="dialog link-ebook"
        role="dialog"
        aria-label={listening ? "Pair with an ebook or document" : "Pair with an audiobook"}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
      >
        <h2>{listening ? "Read along with an ebook or document" : "Listen along with an audiobook"}</h2>
        <p className="muted add-dialog-book">
          {listening
            ? `Choose the ebook or document of “${book.title}”. While it plays, an ebook follows along page by page.`
            : `Choose the audiobook of “${book.title}”. While it plays, ${isDocument(book.format) ? "you turn the pages yourself." : "the book follows along page by page."}`}
        </p>
        {(listening || isDocument(book.format)) && <p className="muted add-dialog-book">{DOCUMENT_PAIR_NOTE}</p>}
        <label className="field">
          <span>{listening ? "Search your books and documents" : "Search your audiobooks"}</span>
          <input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <div className="fetch-results">
          {books === null ? (
            <div className="library-loading" aria-label="Searching" />
          ) : books.length === 0 ? (
            <p className="muted">
              {listening ? "No books or documents match." : "No audiobooks match."} Import it first, or try fewer words.
            </p>
          ) : (
            books.map((b) => (
              <button key={b.id} type="button" className="fetch-result" onClick={() => void link(b)}>
                <BookCover book={b} size="s" />
                <span className="fetch-result-text">
                  <strong>{b.title}</strong>
                  <span className="muted">{[b.authors.join(", "), b.format.toUpperCase()].filter(Boolean).join(" · ")}</span>
                </span>
              </button>
            ))
          )}
        </div>
        <div className="dialog-actions">
          <button type="button" className="btn btn-quiet" onClick={() => onClose()}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

let pairListener: ((book: BookPreview) => void) | null = null;

/** Opens the pairing dialog for a book, from its menu anywhere. */
export function askPair(book: BookPreview) {
  pairListener?.(book);
}

/** Where `askPair` draws its dialog; one, in App. */
export function PairHost() {
  const [book, setBook] = useState<BookPreview | null>(null);
  useEffect(() => {
    pairListener = setBook;
    return () => {
      pairListener = null;
    };
  }, []);
  return book ? <PairDialog book={book} onClose={() => setBook(null)} /> : null;
}

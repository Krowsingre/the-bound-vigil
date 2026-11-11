import { useEffect, useState } from "react";
import { api } from "../api";
import type { BookPreview, NoteItem } from "../api/types";
import { BookCover } from "../components/BookCover";
import { Icon } from "../components/Icon";
import { authorLine } from "../lib/format";

/** Writing a note about a whole book. */
export function NewNoteDialog({
  book: initialBook = null,
  onSaved,
  onCancel,
}: {
  /** The book, when already known. */
  book?: Pick<BookPreview, "id" | "title" | "authors" | "coverPath"> | null;
  onSaved: (note: NoteItem) => void;
  onCancel: () => void;
}) {
  const [book, setBook] = useState(initialBook);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!text.trim()) return setError("Write something first.");
    if (!book) return setError("Pick the book this note is about.");
    setBusy(true);
    try {
      onSaved(await api.saveBookNote(book.id, null, text));
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && !busy && onCancel()}>
      <form
        className="dialog new-note-dialog"
        role="dialog"
        aria-label="New book note"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape" && !busy) onCancel();
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void save();
        }}
      >
        <h2>New note about a book</h2>
        {book ? (
          <div className="picked-book">
            <BookCover book={book} size="s" />
            <span>
              <strong>{book.title}</strong>
              <span className="muted">{authorLine(book.authors)}</span>
            </span>
            {!initialBook && (
              <button type="button" className="link-btn" onClick={() => setBook(null)}>
                Change
              </button>
            )}
          </div>
        ) : (
          <BookPicker onPick={setBook} />
        )}
        {book && (
          <label className="field">
            <span>Your thoughts on the whole book</span>
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={8} autoFocus placeholder="Write freely…" />
          </label>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="btn btn-quiet" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            Save note
          </button>
        </div>
      </form>
    </div>
  );
}

function BookPicker({ onPick }: { onPick: (book: BookPreview) => void }) {
  const [search, setSearch] = useState("");
  const [books, setBooks] = useState<BookPreview[] | null>(null);
  useEffect(() => {
    let current = true;
    const t = setTimeout(() => {
      api
        .getLibrary({ shelf: "all", sort: "recently_opened", search: search.trim() || null, formats: [], location: null, page: 0, pageSize: 50 })
        .then((p) => current && setBooks(p.books), () => current && setBooks([]));
    }, 150);
    return () => {
      current = false;
      clearTimeout(t);
    };
  }, [search]);
  return (
    <div className="book-picker">
      <label className="search">
        <Icon name="search" size={16} />
        <input autoFocus type="search" placeholder="Which book?" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Find the book" />
      </label>
      <ul className="add-books-list book-picker-list">
        {books === null ? (
          <li className="library-loading" aria-busy="true" />
        ) : books.length === 0 ? (
          <li className="muted">No books match.</li>
        ) : (
          books.map((b) => (
            <li key={b.id}>
              <button type="button" className="add-book" onClick={() => onPick(b)}>
                <BookCover book={b} size="s" />
                <span className="add-book-text">
                  <span className="add-book-title">{b.title}</span>
                  <span className="muted">{authorLine(b.authors)}</span>
                </span>
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

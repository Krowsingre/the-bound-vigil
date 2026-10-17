// Choosing the ebook an audiobook goes with, so you can read along as it plays.
// Books with the same title come first.

import { useEffect, useState } from "react";
import { api } from "../api";
import type { BookPreview } from "../api/types";
import { BookCover } from "../components/BookCover";
import { useToast } from "../components/Toast";

const fold = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/^(the|a|an) /, "")
    .trim();

export function LinkEbook({
  audiobook,
  onClose,
}: {
  audiobook: BookPreview;
  /** The ebook linked, or undefined when nothing changed. */
  onClose: (ebook?: { id: string; name: string }) => void;
}) {
  const toast = useToast();
  const [search, setSearch] = useState(audiobook.title);
  const [books, setBooks] = useState<BookPreview[] | null>(null);

  useEffect(() => {
    let current = true;
    const wait = setTimeout(() => {
      api
        .getLibrary({
          kind: "books",
          shelf: "all",
          sort: "title",
          search: search.trim() || null,
          formats: [],
          location: null,
          page: 0,
          pageSize: 40,
        })
        .then(
          (page) => {
            if (!current) return;
            const title = fold(audiobook.title);
            setBooks([...page.books].sort((a, b) => Number(fold(b.title) === title) - Number(fold(a.title) === title)));
          },
          () => current && setBooks([]),
        );
    }, 200);
    return () => {
      current = false;
      clearTimeout(wait);
    };
  }, [search, audiobook.title]);

  const link = (ebook: BookPreview) =>
    api.linkEbook(audiobook.id, ebook.id).then(
      () => {
        toast(`“${audiobook.title}” now reads along with “${ebook.title}”.`);
        onClose({ id: ebook.id, name: ebook.title });
      },
      (e: unknown) => toast(`Couldn't link them: ${String(e)}`),
    );

  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="dialog link-ebook"
        role="dialog"
        aria-label="Link an ebook"
        onKeyDown={(e) => e.key === "Escape" && onClose()}
      >
        <h2>Read along with an ebook</h2>
        <p className="muted add-dialog-book">
          Choose the ebook of “{audiobook.title}”. While it plays, the ebook can follow along, page by page.
        </p>
        <label className="field">
          <span>Search your books</span>
          <input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <div className="fetch-results">
          {books === null ? (
            <div className="library-loading" aria-label="Searching" />
          ) : books.length === 0 ? (
            <p className="muted">No ebooks match. Import the ebook first, or try fewer words.</p>
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

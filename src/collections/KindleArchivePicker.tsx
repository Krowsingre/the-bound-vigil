import { useEffect, useState } from "react";
import { api } from "../api";
import type { BookPreview, KindlePurchase, LibraryPage } from "../api/types";
import { Pagination } from "../library/Pagination";

export function KindleArchivePicker({ purchase, onClose }: {
  purchase: KindlePurchase;
  onClose: (matched: boolean) => void;
}) {
  const [search, setSearch] = useState("");
  const [series, setSeries] = useState("");
  const [page, setPage] = useState(0);
  const [results, setResults] = useState<LibraryPage | null>(null);
  const [picked, setPicked] = useState<BookPreview[]>([]);
  const [markRead, setMarkRead] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const ids = purchase.bookIds ?? [];
    if (!ids.length) return;
    let live = true;
    void api.getLibrary({ shelf: "all", kind: "books", ids, sort: "title", search: null, formats: [], location: null, page: 0, pageSize: 200 })
      .then((found) => { if (live) setPicked(found.books); }, () => undefined);
    return () => { live = false; };
  }, [purchase]);
  useEffect(() => {
    let live = true;
    setResults(null);
    setError("");
    const timer = window.setTimeout(() => {
      void api.getLibrary({
        shelf: "all", kind: "books", sort: series ? "series" : "title", search: search.trim() || null,
        formats: [], location: null, series: series ? [series] : [], page, pageSize: 24,
      }).then((found) => { if (live) setResults(found); }, (failure: unknown) => { if (live) setError(String(failure)); });
    }, 140);
    return () => { live = false; clearTimeout(timer); };
  }, [search, series, page]);
  const choose = (book: BookPreview) => setPicked((items) => items.some((item) => item.id === book.id)
    ? items.filter((item) => item.id !== book.id) : [...items, book]);
  const save = async () => {
    if (!picked.length || busy) return;
    setBusy(true);
    try {
      await api.matchKindleManually(purchase.asin, picked.map((book) => book.id), markRead);
      onClose(true);
    } catch (failure) {
      setError(String(failure));
      setBusy(false);
    }
  };
  return (
    <div className="dialog-backdrop" onPointerDown={(event) => { if (!busy && event.target === event.currentTarget) onClose(false); }}>
      <div className="dialog details-dialog" role="dialog" aria-label="Match a Kindle purchase" onKeyDown={(event) => { if (!busy && event.key === "Escape") onClose(false); }}>
        <h2>Match with your Archive</h2>
        <p>Choose one book or the members of “{purchase.title}”.</p>
        <input autoFocus type="search" aria-label="Search Archive" placeholder="Search by title, author or series" value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} />
        <div className="hero-actions">
          {purchase.author && <button type="button" className="btn btn-quiet btn-small" onClick={() => { setSearch(purchase.author); setSeries(""); setPage(0); }}>Books by {purchase.author}</button>}
          {series && <button type="button" className="btn btn-quiet btn-small" onClick={() => { setSeries(""); setPage(0); }}>Clear series filter</button>}
        </div>
        {picked.length > 0 && <p className="muted">Selected {picked.length} · {picked.map((book) => book.title).join(", ")}</p>}
        {results && (
          <>
            {results.books.length === 0 && <p>No Archive books match.</p>}
            <ul className="history-list">
              {results.books.map((book) => (
                <li key={book.id} className="history-row">
                  <label>
                    <input type="checkbox" checked={picked.some((item) => item.id === book.id)} onChange={() => choose(book)} />
                    {" "}{book.title} · {book.authors.join(", ")}
                  </label>
                  {book.series && !series && <button type="button" className="btn btn-quiet btn-small" onClick={() => { setSeries(book.series!); setSearch(""); setPage(0); }}>Show {book.series}</button>}
                </li>
              ))}
            </ul>
            <Pagination page={results.page} pageSize={results.pageSize} total={results.total} onPage={setPage} />
          </>
        )}
        {purchase.read && <label><input type="checkbox" checked={markRead} onChange={(event) => setMarkRead(event.target.checked)} /> Mark selected unread books Read</label>}
        {error && <p role="alert">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => onClose(false)}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={busy || !picked.length} onClick={() => void save()}>Confirm match</button>
        </div>
      </div>
    </div>
  );
}

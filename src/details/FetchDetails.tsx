// Finding a book's details online: search Google Books and Open Library,
// choose the match, then tick which details to keep. What's kept is saved as
// fetched details, under your own edits and over the book's own.

import { useCallback, useEffect, useRef, useState } from "react";
import { api, isApp } from "../api";
import type { BookDetails, BookPreview, DetailFieldName } from "../api/types";
import { Icon } from "../components/Icon";
import { useToast } from "../components/Toast";
import { DETAIL_FIELDS, detailLabel, effective, isList, listOf } from "../lib/details";
import { foundValues, openLibraryDescription, searchOnline, type Found } from "../lib/onlineDetails";

const SOURCE_NAME = { google: "Google Books", openlibrary: "Open Library" } as const;

function shown(field: DetailFieldName, value: string | null): string {
  if (!value) return "";
  return isList(field) ? listOf(value).join(", ") : value;
}

export function FetchDetails({ book, onClose }: { book: BookPreview; onClose: (changed: boolean) => void }) {
  const toast = useToast();
  const [details, setDetails] = useState<BookDetails | null>(null);
  const [query, setQuery] = useState({ title: book.title, author: book.authors[0] ?? "", isbn: "" });
  const [results, setResults] = useState<Found[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Found | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [keep, setKeep] = useState<Set<string>>(new Set());
  const [cover, setCover] = useState(false);
  const [saving, setSaving] = useState(false);
  const running = useRef<AbortController | null>(null);

  const search = useCallback((q: typeof query) => {
    running.current?.abort();
    const stop = new AbortController();
    running.current = stop;
    setSearching(true);
    setError(null);
    searchOnline(q, stop.signal).then(
      (found) => {
        if (stop.signal.aborted) return;
        setResults(found);
        setSearching(false);
      },
      (e: unknown) => {
        if (stop.signal.aborted) return;
        setError(e instanceof Error ? e.message : String(e));
        setResults([]);
        setSearching(false);
      },
    );
  }, []);

  // Search straight away with what the book already says.
  useEffect(() => {
    api.bookDetails(book.id).then(
      (d) => {
        setDetails(d);
        const isbn = d.fields.find((f) => f.field === "isbn");
        const q = { title: book.title, author: book.authors[0] ?? "", isbn: (isbn && effective(isbn)) ?? "" };
        setQuery(q);
        search(q);
      },
      () => search({ title: book.title, author: book.authors[0] ?? "", isbn: "" }),
    );
    return () => running.current?.abort();
  }, [book, search]);

  const choose = async (f: Found) => {
    setChosen(f);
    let found = f;
    // Open Library keeps descriptions on the work's own page.
    if (f.source === "openlibrary" && f.workKey && !f.synopsis) {
      const stop = new AbortController();
      running.current = stop;
      try {
        const synopsis = await openLibraryDescription(f.workKey, stop.signal);
        found = { ...f, synopsis };
      } catch {
        /* the rest is still worth keeping */
      }
    }
    const v = foundValues(found);
    setValues(v);
    // Ticked to start with: what the book is missing, or differs from what it shows.
    const fields = details?.fields ?? [];
    setKeep(
      new Set(
        Object.keys(v).filter((field) => {
          const current = fields.find((x) => x.field === field);
          const now = current ? effective(current) : null;
          return field !== "title" && (!now || now === "[]" || now !== v[field]) && !(current && current.edited !== null);
        }),
      ),
    );
    setCover(Boolean(found.coverUrl && !book.coverPath && isApp));
  };

  const save = async () => {
    if (!chosen) return;
    setSaving(true);
    const picked = Object.fromEntries(Object.entries(values).filter(([field]) => keep.has(field)));
    try {
      if (Object.keys(picked).length) await api.saveFetched(book.id, chosen.source, picked);
      if (cover && chosen.coverUrl) await api.fetchCover(book.id, chosen.coverUrl);
      toast(`Kept ${Object.keys(picked).length + (cover ? 1 : 0)} details from ${SOURCE_NAME[chosen.source]}.`);
      onClose(true);
    } catch (e) {
      setSaving(false);
      setError(`Couldn't save: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const toggle = (field: string) =>
    setKeep((k) => {
      const next = new Set(k);
      if (next.has(field)) next.delete(field);
      else next.add(field);
      return next;
    });

  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose(false)}>
      <div
        className="dialog fetch-dialog"
        role="dialog"
        aria-label="Find details online"
        onKeyDown={(e) => e.key === "Escape" && onClose(false)}
      >
        <h2>Find details online</h2>
        <p className="muted add-dialog-book">
          {book.title}. Searches Google Books and Open Library. Your book file isn't changed.
        </p>

        {!chosen ? (
          <>
            <form
              className="fetch-search"
              onSubmit={(e) => {
                e.preventDefault();
                search(query);
              }}
            >
              <label className="field">
                <span>Title</span>
                <input value={query.title} onChange={(e) => setQuery({ ...query, title: e.target.value })} />
              </label>
              <label className="field">
                <span>Author</span>
                <input value={query.author} onChange={(e) => setQuery({ ...query, author: e.target.value })} />
              </label>
              <label className="field">
                <span>ISBN</span>
                <input value={query.isbn} placeholder="Optional" onChange={(e) => setQuery({ ...query, isbn: e.target.value })} />
              </label>
              <button type="submit" className="btn btn-quiet" disabled={searching}>
                <Icon name="search" size={16} /> Search
              </button>
            </form>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <div className="fetch-results" aria-busy={searching}>
              {searching ? (
                <div className="library-loading" aria-label="Searching" />
              ) : results && results.length === 0 ? (
                !error && <p className="muted">Nothing found. Try fewer words, or just the ISBN.</p>
              ) : (
                results?.map((r) => (
                  <button key={r.id} type="button" className="fetch-result" onClick={() => void choose(r)}>
                    <span className="fetch-thumb">
                      {r.coverUrl ? <img src={r.coverUrl} alt="" loading="lazy" /> : <Icon name="image" size={18} />}
                    </span>
                    <span className="fetch-result-text">
                      <strong>{r.title}</strong>
                      <span className="muted">
                        {[r.authors.join(", "), r.published?.slice(0, 4), r.publisher].filter(Boolean).join(" · ")}
                      </span>
                      <span className="fetch-source">{SOURCE_NAME[r.source]}</span>
                    </span>
                  </button>
                ))
              )}
            </div>
            <div className="dialog-actions">
              <button type="button" className="btn btn-quiet" onClick={() => onClose(false)}>
                Cancel
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="fetch-chosen">
              From {SOURCE_NAME[chosen.source]}. Tick what to keep.
              {details?.fields.some((f) => f.edited !== null && values[f.field]) &&
                " Details you edited yourself keep showing your edit."}
            </p>
            <div className="fetch-compare" role="table" aria-label="Details found">
              <div className="fetch-row fetch-row-head" role="row">
                <span role="columnheader" />
                <span role="columnheader">Now</span>
                <span role="columnheader">Found</span>
              </div>
              {DETAIL_FIELDS.filter((f) => values[f.field]).map(({ field }) => {
                const current = details?.fields.find((x) => x.field === field);
                return (
                  <label key={field} className="fetch-row" role="row">
                    <span role="cell" className="fetch-field">
                      <input type="checkbox" checked={keep.has(field)} onChange={() => toggle(field)} />
                      {detailLabel(field)}
                    </span>
                    <span role="cell" className="fetch-now">
                      {shown(field, current ? effective(current) : null) || <em className="muted">Empty</em>}
                    </span>
                    <span role="cell" className="fetch-found">
                      {shown(field, values[field])}
                    </span>
                  </label>
                );
              })}
              {chosen.coverUrl && !book.coverPath && isApp && (
                <label className="fetch-row" role="row">
                  <span role="cell" className="fetch-field">
                    <input type="checkbox" checked={cover} onChange={(e) => setCover(e.target.checked)} />
                    Cover
                  </span>
                  <span role="cell" className="fetch-now">
                    <em className="muted">None</em>
                  </span>
                  <span role="cell" className="fetch-found">
                    <img className="fetch-cover" src={chosen.coverUrl} alt="" />
                  </span>
                </label>
              )}
            </div>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <div className="dialog-actions">
              <button type="button" className="btn btn-quiet" onClick={() => setChosen(null)}>
                Back to results
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={saving || (!keep.size && !cover)}
                onClick={() => void save()}
              >
                Keep ticked details
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

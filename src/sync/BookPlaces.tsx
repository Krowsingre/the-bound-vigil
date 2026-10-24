// Where your books are: every book, and whether its file is on this computer,
// in the main sync place and in the second. Each place is asked for its own
// list of files, so books another device put there count too.

import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import type { BookPlaces as Book, PlaceCheck, PlacesView } from "../api/types";
import { Icon } from "../components/Icon";
import { showBookDetails } from "../details/openDetails";
import { placeWords } from "../settings/SyncFolderPanel";

type Filter = "all" | "here" | "notHere" | "noMain" | "noAlso" | "nowhere";

const PAGE = 100;

export function placeName(check: PlaceCheck): string {
  const p = check.provider;
  return placeWords(p, true);
}

/** Not on this computer and in no place that could be checked. */
export function nowhere(b: Book): boolean {
  return !b.here && b.main !== true && b.also !== true;
}

export function matches(b: Book, filter: Filter, search: string): boolean {
  const ok =
    filter === "here"
      ? b.here
      : filter === "notHere"
        ? !b.here
        : filter === "noMain"
          ? b.main === false
          : filter === "noAlso"
            ? b.also === false
            : filter === "nowhere"
              ? nowhere(b)
              : true;
  if (!ok) return false;
  const q = search.trim().toLowerCase();
  return !q || b.title.toLowerCase().includes(q) || b.authors.some((a) => a.toLowerCase().includes(q));
}

function Mark({ value, place }: { value: boolean | null; place: string }) {
  if (value === null) return <span className="places-mark is-unknown" title={`${place} couldn't be checked`}>–</span>;
  return value ? (
    <span className="places-mark is-yes" title={`In ${place}`}>
      <Icon name="check" size={16} />
      <span className="visually-hidden">Yes</span>
    </span>
  ) : (
    <span className="places-mark is-no" title={`Not in ${place}`}>
      <span aria-hidden>·</span>
      <span className="visually-hidden">No</span>
    </span>
  );
}

export function BookPlacesPage({ onOpenSyncSettings }: { onOpenSyncSettings: () => void }) {
  const [view, setView] = useState<PlacesView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [shown, setShown] = useState(PAGE);

  const load = () => {
    setLoading(true);
    setError(null);
    api
      .bookPlaces()
      .then(setView)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);
  useEffect(() => setShown(PAGE), [filter, search]);

  const books = view?.books ?? [];
  const counts = useMemo(
    () => ({
      here: books.filter((b) => b.here).length,
      notHere: books.filter((b) => !b.here).length,
      noMain: books.filter((b) => b.main === false).length,
      noAlso: books.filter((b) => b.also === false).length,
      nowhere: books.filter(nowhere).length,
    }),
    [books],
  );
  const list = useMemo(() => books.filter((b) => matches(b, filter, search)), [books, filter, search]);

  const main = view?.main ?? null;
  const also = view?.also ?? null;
  const mainName = main ? placeName(main) : "";
  const alsoName = also ? placeName(also) : "";
  // A place that couldn't be answered might hold a book, so "nowhere" waits for every place.
  const allChecked = !main?.problem && !also?.problem;
  const filters: { id: Filter; label: string; count?: number }[] = [
    { id: "all", label: "All", count: books.length },
    { id: "here", label: "On this computer", count: counts.here },
    { id: "notHere", label: "Not on this computer", count: counts.notHere },
    ...(main && !main.problem ? [{ id: "noMain" as const, label: `Missing from ${mainName}`, count: counts.noMain }] : []),
    ...(also && !also.problem ? [{ id: "noAlso" as const, label: `Missing from ${alsoName}`, count: counts.noAlso }] : []),
    ...(counts.nowhere && allChecked ? [{ id: "nowhere" as const, label: "Nowhere", count: counts.nowhere }] : []),
  ];

  return (
    <div className="library imports-page places-page">
      <header className="library-head">
        <div>
          <h1 className="library-title">Where your books are</h1>
          <p className="eyebrow">This computer{main ? `, ${mainName}` : ""}{also ? ` and ${alsoName}` : ""}</p>
        </div>
        <div className="imports-actions">
          <button type="button" className="btn btn-quiet" onClick={onOpenSyncSettings}>
            <Icon name="settings" size={16} /> Sync settings
          </button>
          <button type="button" className="btn btn-primary" disabled={loading} onClick={load}>
            <Icon name="sync" size={16} /> {loading ? "Checking…" : "Check again"}
          </button>
        </div>
      </header>

      {error ? (
        <div className="imports-empty">
          <Icon name="warning" size={28} />
          <p>{error}</p>
        </div>
      ) : !view ? (
        <div className="imports-empty">
          <Icon name="cloud" size={28} />
          <p>Asking each place which books it holds. With a big library this takes a little while.</p>
        </div>
      ) : (
        <>
          {[main, also].map(
            (check, i) =>
              check?.problem && (
                <p key={i} className="form-error">
                  {placeName(check)}: {check.problem} Its column shows a dash until it can be checked.
                </p>
              ),
          )}
          {!main && !also && <p className="settings-row-hint">Sync is off, so books are only on this computer or nowhere.</p>}

          <div className="places-tools">
            <div className="segmented places-filters" role="radiogroup" aria-label="Which books to show">
              {filters.map((f) => (
                <button key={f.id} type="button" role="radio" aria-checked={filter === f.id} onClick={() => setFilter(f.id)}>
                  {f.label} <span className="places-count">{(f.count ?? 0).toLocaleString()}</span>
                </button>
              ))}
            </div>
            <input
              type="search"
              className="places-search"
              placeholder="Find a title or author"
              aria-label="Find a title or author"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {list.length === 0 ? (
            <p className="settings-row-hint places-none">No books here.</p>
          ) : (
            <table className="places-table">
              <thead>
                <tr>
                  <th scope="col">Book</th>
                  <th scope="col">This computer</th>
                  {main && <th scope="col">{mainName}</th>}
                  {also && <th scope="col">{alsoName}</th>}
                </tr>
              </thead>
              <tbody>
                {list.slice(0, shown).map((b) => (
                  <tr key={b.bookId} className={allChecked && nowhere(b) ? "is-bad" : undefined}>
                    <td>
                      <button type="button" className="places-book" onClick={() => showBookDetails(b.bookId)}>
                        <span className="import-name">{b.title}</span>
                        <span className="import-detail">
                          {[b.authors.join(", "), b.format.toUpperCase()].filter(Boolean).join(" · ")}
                        </span>
                      </button>
                    </td>
                    <td>
                      <Mark value={b.here} place="this computer" />
                    </td>
                    {main && (
                      <td>
                        <Mark value={b.main} place={mainName} />
                      </td>
                    )}
                    {also && (
                      <td>
                        <Mark value={b.also} place={alsoName} />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {list.length > shown && (
            <button type="button" className="btn btn-quiet places-more" onClick={() => setShown((n) => n + PAGE * 5)}>
              Show {Math.min(PAGE * 5, list.length - shown).toLocaleString()} more of {(list.length - shown).toLocaleString()}
            </button>
          )}
        </>
      )}
    </div>
  );
}

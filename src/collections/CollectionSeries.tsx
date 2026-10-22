// Finding the missing books of the series in a collection: one panel for a
// single series, or every series in it checked at once.

import { useState } from "react";
import { api, isHome, isWeb } from "../api";
import type { BookPreview, CollectionRef } from "../api/types";
import { Icon } from "../components/Icon";
import { useToast } from "../components/Toast";
import { SeriesPanel } from "../library/SeriesPanel";

/** Each series in `books` once, with an author to narrow the search. */
export function seriesIn(books: BookPreview[]): { name: string; author: string }[] {
  const found = new Map<string, { name: string; author: string }>();
  for (const book of books) {
    const name = book.series?.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (!found.has(key)) found.set(key, { name, author: book.authors[0] ?? "" });
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function CollectionSeries({
  collection,
  books,
  refreshKey,
  onChanged,
}: {
  collection: CollectionRef;
  books: BookPreview[];
  refreshKey: number;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [checking, setChecking] = useState<{ done: number; total: number } | null>(null);
  /** After checking them all: the series with something to show. */
  const [shown, setShown] = useState<string[] | null>(null);
  const [checked, setChecked] = useState(0);
  if (isWeb || isHome || collection.kind === "smart") return null;
  const series = seriesIn(books);
  if (series.length === 0) return null;
  if (series.length === 1 || collection.kind === "series") {
    const one = collection.kind === "series" ? { name: collection.name, author: series[0]?.author ?? "" } : series[0];
    return <SeriesPanel name={one.name} author={one.author} refreshKey={refreshKey} onChanged={onChanged} />;
  }

  const checkAll = async () => {
    setChecking({ done: 0, total: series.length });
    const left: string[] = [];
    let failed = 0;
    for (const [i, s] of series.entries()) {
      try {
        const review = await api.findSeriesBooks(s.name, s.author);
        if (review.matches.length || review.missing.some((m) => !m.hidden)) left.push(s.name);
      } catch {
        failed++;
      }
      setChecking({ done: i + 1, total: series.length });
    }
    setChecking(null);
    setShown(left);
    setChecked((n) => n + 1);
    if (failed) toast(`${failed} of the ${series.length} series couldn't be found online.`);
  };

  return (
    <section className="series-panel" aria-label="Series in this collection">
      <header className="series-head">
        <div>
          <strong>{series.length} series</strong>
          <span className="muted">
            {checking
              ? `Checking ${checking.done + 1 > checking.total ? checking.total : checking.done + 1} of ${checking.total}…`
              : shown
                ? shown.length
                  ? `${shown.length} of them ${shown.length === 1 ? "has" : "have"} books you're missing, or books to check.`
                  : "You have every book listed online for all of them."
                : "Find the books you're missing from every series in this collection."}
          </span>
        </div>
        <button type="button" className="btn btn-quiet" disabled={!!checking} onClick={() => void checkAll()}>
          <Icon name="search" size={16} /> {checking ? "Looking…" : shown ? "Check again" : `Find missing books in all ${series.length}`}
        </button>
      </header>
      {shown?.map((name) => (
        <SeriesPanel
          key={name}
          name={name}
          author={series.find((s) => s.name === name)?.author ?? ""}
          refreshKey={refreshKey + checked}
          onChanged={onChanged}
        />
      ))}
    </section>
  );
}

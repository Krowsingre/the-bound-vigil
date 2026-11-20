import type { BookPreview, SeriesSummary } from "../api/types";
import { BookCover } from "../components/BookCover";
import { holdForMenu } from "../components/ContextMenu";
import type { MenuEntry } from "../components/Menu";
import { useToast } from "../components/Toast";
import { bookContextMenu, clickBook, type BookActions } from "../home/bookActions";
import { setSeriesFavourite, setTopFive, seriesTopKey, isTopFive, useFavourites } from "../library/favourites";
import { authorLine } from "../lib/format";
import { SeriesCard } from "./CollectionCards";

/**
 * The top of the Favourites compendium: the Top five (up to five favourite
 * books or series, embre 18 November) and the favourite series as stacks.
 * The favourite books follow below, as before.
 */
export function FavouriteRows({
  books,
  series,
  refreshKey,
  actions,
  onOpenSeries,
}: {
  /** The favourite books. */
  books: BookPreview[];
  /** Every series, for their covers and counts. */
  series: SeriesSummary[];
  refreshKey: number;
  actions: BookActions;
  onOpenSeries?: (name: string) => void;
}) {
  const toast = useToast();
  const favourites = useFavourites(refreshKey);
  const summaryOf = (name: string): SeriesSummary =>
    series.find((s) => s.name.trim().toLowerCase() === name.trim().toLowerCase()) ?? { name, count: 0, authors: [], covers: [] };
  const top = favourites.top
    .map((t) => {
      if (t.key.startsWith("book:")) {
        const book = books.find((b) => b.id === t.key.slice(5));
        return book ? { key: t.key, book } : null;
      }
      const name = favourites.series.find((s) => seriesTopKey(s) === t.key) ?? t.label;
      return { key: t.key, series: summaryOf(name) };
    })
    .filter((t) => t !== null);
  const fail = (error: unknown) => toast(String(error).replace(/^Error: /, ""));
  const seriesMenu = (name: string): MenuEntry[] => [
    ...(onOpenSeries ? [{ label: "Open series", onSelect: () => onOpenSeries(name) }] : []),
    isTopFive(seriesTopKey(name), favourites.top)
      ? { label: "Take out of Top five", icon: "star", onSelect: () => void setTopFive(seriesTopKey(name), name, false).catch(fail) }
      : { label: "Add to Top five", icon: "star", onSelect: () => void setTopFive(seriesTopKey(name), name, true).catch(fail) },
    { label: "Remove series from favourites", icon: "heart", onSelect: () => void setSeriesFavourite(name, false).catch(fail) },
  ];
  if (!top.length && !favourites.series.length) return null;

  return (
    <div className="favourite-rows">
      <section aria-label="Top five" className="favourite-row">
        <h2 className="favourite-row-title">Top five</h2>
        {top.length ? (
          <ol className="top-five-row">
            {top.map((t, i) => (
              <li key={t.key} className="top-five-card" {...("book" in t && t.book ? bookContextMenu(t.book, actions) : holdForMenu(`More for ${t.series!.name}`, () => seriesMenu(t.series!.name)))}>
                <span className="top-five-rank" aria-label={`Number ${i + 1}`}>
                  {i + 1}
                </span>
                {"book" in t && t.book ? (
                  <button type="button" className="top-five-open" onClick={() => clickBook(t.book, actions)}>
                    <BookCover book={t.book} size="m" />
                    <span className="top-five-title">{t.book.title}</span>
                    <span className="top-five-meta">{authorLine(t.book.authors, t.book.audioType)}</span>
                  </button>
                ) : (
                  <button type="button" className="top-five-open" onClick={() => onOpenSeries?.(t.series!.name)}>
                    <span className="top-five-stack">
                      {t.series!.covers[0] ? <BookCover book={t.series!.covers[0]} size="m" /> : <span className="cover cover-m cover-generated"><span className="cover-title">{t.series!.name}</span></span>}
                    </span>
                    <span className="top-five-title">{t.series!.name}</span>
                    <span className="top-five-meta">Series · {t.series!.count === 1 ? "1 book" : `${t.series!.count} books`}</span>
                  </button>
                )}
              </li>
            ))}
          </ol>
        ) : (
          <p className="muted">Mark up to five favourites as your Top five, from a book's or a series' … menu.</p>
        )}
      </section>
      {favourites.series.length > 0 && (
        <section aria-label="Favourite series" className="favourite-row">
          <h2 className="favourite-row-title">Favourite series</h2>
          <ul className="collection-cards collection-cards-grid">
            {favourites.series.map((name) => (
              <SeriesCard
                key={name}
                series={summaryOf(name)}
                layout="grid"
                selected={false}
                onSelect={() => onOpenSeries?.(name)}
                onOpen={() => onOpenSeries?.(name)}
                hold={holdForMenu(`More for ${name}`, () => seriesMenu(name))}
              />
            ))}
          </ul>
        </section>
      )}
      {books.length > 0 && <h2 className="favourite-row-title">Favourite books</h2>}
    </div>
  );
}

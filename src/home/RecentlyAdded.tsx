import { useEffect, useState } from "react";
import { api } from "../api";
import type { BookPreview } from "../api/types";
import { BookCover } from "../components/BookCover";
import { Icon } from "../components/Icon";
import { Menu } from "../components/Menu";
import { seriesCover } from "../lib/queryBooks";
import { authorLine } from "../lib/format";
import { bookContextMenu, bookMenu, clickBook, type BookActions } from "./bookActions";
import { EmptyNote, Section } from "./Section";

/** The newest books, as covers. On a computer each has a ••• menu beside its title. */
export function RecentlyAdded({ books, actions, onViewAll, onOpenSeries, menus = false }: { books: BookPreview[]; actions: BookActions; onViewAll: () => void; onOpenSeries: (name: string) => void; menus?: boolean }) {
  let coverChoices: Record<string, string> = {};
  try { coverChoices = JSON.parse(localStorage.getItem("tbv.stackCovers.books") ?? "{}") ?? {}; } catch { /* Use automatic covers. */ }
  const stacks = new Map<string, BookPreview[]>();
  for (const book of books) {
    const key = book.series?.trim().toLowerCase();
    if (!key) continue;
    const members = stacks.get(key) ?? [];
    members.push(book);
    stacks.set(key, members);
  }
  const seriesKey = JSON.stringify([...stacks.values()].filter((members) => members.length > 1).map(([book]) => book.series!.trim()));
  const [totals, setTotals] = useState<Record<string, { owned: number; published?: number }>>({});
  useEffect(() => {
    const series: string[] = JSON.parse(seriesKey);
    if (!series.length) return;
    let current = true;
    void api.getLibrary({ kind: "books", shelf: "all", sort: "title", search: null, formats: [], location: null, series, groupSeries: true, omitFacets: true, page: 0, pageSize: series.length })
      .then((page) => {
        if (!current) return;
        setTotals(Object.fromEntries(page.books.flatMap((book) => {
          const owned = page.seriesCounts?.[book.id];
          return book.series && owned !== undefined ? [[book.series.trim().toLowerCase(), { owned, published: page.seriesPublished?.[book.id] }]] : [];
        })));
      }, () => { if (current) setTotals({}); });
    return () => { current = false; };
  }, [seriesKey, books]);
  return (
    <Section title="Recently added" onViewAll={books.length ? onViewAll : undefined} className="recent">
      {books.length === 0 ? (
        <EmptyNote>Books you import will appear here.</EmptyNote>
      ) : (
        <ul className="shelf">
          {books.map((book) => {
            const name = book.series?.trim();
            const members = name ? stacks.get(name.toLowerCase()) : undefined;
            if (name && members && members.length > 1) {
              if (members[0] !== book) return null;
              const cover = seriesCover(members, coverChoices[name.toLowerCase()]) ?? book;
              const total = totals[name.toLowerCase()];
              return <li key={book.id} className="series-stack">
                <button type="button" className="shelf-book" aria-label={`Open series ${name}`} onClick={() => onOpenSeries(name)}>
                  <BookCover book={cover} seriesCount={total?.owned} seriesPublished={total?.published} />
                  <span className="book-title">{name}</span>
                </button>
              </li>;
            }
            return (
            <li key={book.id} className={menus ? "has-menu" : undefined} {...bookContextMenu(book, actions)}>
              <button type="button" className="shelf-book" onClick={() => clickBook(book, actions)} title={`${book.title}, ${authorLine(book.authors)}`}>
                <BookCover book={book} />
                <span className="book-title">{book.title}</span>
                <span className="book-author">{authorLine(book.authors)}</span>
              </button>
              {menus && <Menu label={`More for ${book.title}`} className="icon-btn book-more" trigger={<Icon name="more" size={14} />} items={bookMenu(book, actions)} />}
            </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

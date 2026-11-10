import type { BookPreview } from "../api/types";
import { BookCover } from "../components/BookCover";
import { Icon } from "../components/Icon";
import { Menu } from "../components/Menu";
import { authorLine } from "../lib/format";
import { bookContextMenu, bookMenu, clickBook, type BookActions } from "./bookActions";
import { EmptyNote, Section } from "./Section";

/** The newest books, as covers. On a computer each has a ••• menu beside its title. */
export function RecentlyAdded({ books, actions, onViewAll, onOpenSeries, menus = false }: { books: BookPreview[]; actions: BookActions; onViewAll: () => void; onOpenSeries: (name: string) => void; menus?: boolean }) {
  const stacks = new Map<string, BookPreview[]>();
  for (const book of books) {
    const key = book.series?.trim().toLowerCase();
    if (!key) continue;
    const members = stacks.get(key) ?? [];
    members.push(book);
    stacks.set(key, members);
  }
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
              const finished = (b: BookPreview) => Number(b.status === "read" || b.status === "dropped");
              const cover = [...members].sort((a, b) => finished(a) - finished(b) ||
                (a.seriesIndex ?? Infinity) - (b.seriesIndex ?? Infinity) || a.title.localeCompare(b.title))[0];
              return <li key={book.id} className="series-stack">
                <button type="button" className="shelf-book" aria-label={`Open series ${name}`} onClick={() => onOpenSeries(name)}>
                  <BookCover book={cover} seriesCount={members.length} />
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

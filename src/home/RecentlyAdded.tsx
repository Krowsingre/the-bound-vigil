import type { BookPreview } from "../api/types";
import { BookCover } from "../components/BookCover";
import { Icon } from "../components/Icon";
import { Menu } from "../components/Menu";
import { authorLine } from "../lib/format";
import { bookContextMenu, bookMenu, clickBook, type BookActions } from "./bookActions";
import { EmptyNote, Section } from "./Section";

/** The newest books, as covers. On a computer each has a ••• menu beside its title. */
export function RecentlyAdded({ books, actions, onViewAll, menus = false }: { books: BookPreview[]; actions: BookActions; onViewAll: () => void; menus?: boolean }) {
  return (
    <Section title="Recently added" onViewAll={books.length ? onViewAll : undefined} className="recent">
      {books.length === 0 ? (
        <EmptyNote>Books you import will appear here.</EmptyNote>
      ) : (
        <ul className="shelf">
          {books.map((book) => (
            <li key={book.id} className={menus ? "has-menu" : undefined} {...bookContextMenu(book, actions)}>
              <button type="button" className="shelf-book" onClick={() => clickBook(book, actions)} title={`${book.title}, ${authorLine(book.authors)}`}>
                <BookCover book={book} />
                <span className="book-title">{book.title}</span>
                <span className="book-author">{authorLine(book.authors)}</span>
              </button>
              {menus && <Menu label={`More for ${book.title}`} className="icon-btn book-more" trigger={<Icon name="more" size={14} />} items={bookMenu(book, actions)} />}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

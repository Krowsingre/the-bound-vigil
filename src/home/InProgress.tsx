import type { BookPreview } from "../api/types";
import { BookCover } from "../components/BookCover";
import { Icon } from "../components/Icon";
import { Menu } from "../components/Menu";
import { ProgressBar } from "../components/ProgressBar";
import { authorLine, percent } from "../lib/format";
import { bookContextMenu, bookMenu, clickBook, type BookActions } from "./bookActions";
import { EmptyNote, Section } from "./Section";

/** Books under way, with their title, author and how far along: covers on a
 * phone, and on a computer a list with a ••• menu for each. */
export function InProgress({ books, actions, onViewAll, list = false }: { books: BookPreview[]; actions: BookActions; onViewAll: () => void; list?: boolean }) {
  return (
    <Section title="In progress" onViewAll={books.length ? onViewAll : undefined} className="in-progress">
      {books.length === 0 ? (
        <EmptyNote>Books you're reading will be listed here with how far along you are.</EmptyNote>
      ) : list ? (
        <ul className="progress-list">
          {books.map((book) => (
            <li key={book.id} className="progress-row" {...bookContextMenu(book, actions)}>
              <button type="button" className="progress-open" onClick={() => clickBook(book, actions)} title={`${book.title}, ${authorLine(book.authors)}`}>
                <BookCover book={book} size="s" />
                <span className="progress-text">
                  <span className="book-title">{book.title}</span>
                  <span className="book-author">{authorLine(book.authors)}</span>
                  <span className="progress-line">
                    <ProgressBar value={book.totalProgression} />
                    <span className="num">{percent(book.totalProgression)}</span>
                  </span>
                </span>
              </button>
              <Menu label={`More for ${book.title}`} className="icon-btn icon-btn-round book-more" trigger={<Icon name="more" size={16} />} items={bookMenu(book, actions)} />
            </li>
          ))}
        </ul>
      ) : (
        <ul className="shelf">
          {books.map((book) => (
            <li key={book.id} {...bookContextMenu(book, actions)}>
              <button type="button" className="shelf-book" onClick={() => clickBook(book, actions)} title={`${book.title}, ${authorLine(book.authors)}`}>
                <BookCover book={book} />
                <span className="book-title">{book.title}</span>
                <span className="book-author">{authorLine(book.authors)}</span>
                <span className="progress-line">
                  <ProgressBar value={book.totalProgression} />
                  <span className="num">{percent(book.totalProgression)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

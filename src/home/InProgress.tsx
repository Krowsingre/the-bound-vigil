import type { BookPreview } from "../api/types";
import { BookCover } from "../components/BookCover";
import { ProgressBar } from "../components/ProgressBar";
import { authorLine, percent } from "../lib/format";
import { bookContextMenu, clickBook, type BookActions } from "./bookActions";
import { EmptyNote, Section } from "./Section";

/** Books under way, as covers with their title, author and how far along. */
export function InProgress({ books, actions, onViewAll }: { books: BookPreview[]; actions: BookActions; onViewAll: () => void }) {
  return (
    <Section title="In progress" onViewAll={books.length ? onViewAll : undefined} className="in-progress">
      {books.length === 0 ? (
        <EmptyNote>Books you're reading will be listed here with how far along you are.</EmptyNote>
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

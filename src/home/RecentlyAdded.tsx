import type { BookPreview } from "../api/types";
import { BookCover } from "../components/BookCover";
import { authorLine } from "../lib/format";
import { bookContextMenu, type BookActions } from "./bookActions";
import { EmptyNote, Section } from "./Section";

export function RecentlyAdded({ books, actions, onViewAll }: { books: BookPreview[]; actions: BookActions; onViewAll: () => void }) {
  return (
    <Section title="Recently added" onViewAll={books.length ? onViewAll : undefined} className="recent">
      {books.length === 0 ? (
        <EmptyNote>Books you import will appear here.</EmptyNote>
      ) : (
        <ul className="shelf">
          {books.map((book) => (
            <li key={book.id} {...bookContextMenu(book, actions)}>
              <button type="button" className="shelf-book" onClick={() => actions.open(book)} title={`${book.title}, ${authorLine(book.authors)}`}>
                <BookCover book={book} />
                <span className="book-title">{book.title}</span>
                <span className="book-author">{authorLine(book.authors)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

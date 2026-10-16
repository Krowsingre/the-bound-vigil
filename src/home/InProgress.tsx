import type { BookPreview } from "../api/types";
import { BookCover } from "../components/BookCover";
import { Icon } from "../components/Icon";
import { Menu } from "../components/Menu";
import { ProgressBar } from "../components/ProgressBar";
import { authorLine, percent } from "../lib/format";
import { bookMenu, type BookActions } from "./bookActions";
import { EmptyNote, Section } from "./Section";

export function InProgress({ books, actions, onViewAll }: { books: BookPreview[]; actions: BookActions; onViewAll: () => void }) {
  return (
    <Section title="In progress" onViewAll={books.length ? onViewAll : undefined} className="in-progress">
      {books.length === 0 ? (
        <EmptyNote>Books you're reading will be listed here with how far along you are.</EmptyNote>
      ) : (
        <ul className="progress-list">
          {books.map((book) => (
            <li key={book.id} className="progress-row">
              <button type="button" className="progress-open" onClick={() => actions.open(book)}>
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
              <Menu label={`More for ${book.title}`} trigger={<Icon name="more" />} items={bookMenu(book, actions)} />
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

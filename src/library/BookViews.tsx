import type { BookPreview } from "../api/types";
import { BookCover } from "../components/BookCover";
import { Icon } from "../components/Icon";
import { Menu } from "../components/Menu";
import { ProgressBar } from "../components/ProgressBar";
import { Stars } from "../components/StarRating";
import { authorLine, percent } from "../lib/format";
import { formatLabel } from "../lib/queryBooks";
import { bookContextMenu, bookMenu, type BookActions } from "../home/bookActions";

/** While choosing books for a change to many at once, a click picks a book instead of opening it. */
export interface Selection {
  has: (bookId: string) => boolean;
  toggle: (book: BookPreview) => void;
}

type Props = { books: BookPreview[]; actions: BookActions; selection?: Selection | null };

const press = (book: BookPreview, actions: BookActions, selection?: Selection | null) =>
  selection ? selection.toggle(book) : actions.open(book);

/** The tick on a chosen book, and the props that say it's chosen. */
function picked(book: BookPreview, selection?: Selection | null) {
  if (!selection) return { mark: null, props: {} };
  const on = selection.has(book.id);
  return {
    mark: (
      <span className={`select-mark${on ? " is-on" : ""}`} aria-hidden>
        {on && <Icon name="check" size={14} />}
      </span>
    ),
    props: { "aria-pressed": on },
  };
}

const STATUS = { unread: "Unread", in_progress: "In progress", read: "Read" } as const;

function seriesLine(book: BookPreview) {
  if (!book.series) return null;
  return book.seriesIndex != null ? `${book.series} #${book.seriesIndex}` : book.series;
}

function Marks({ book }: { book: BookPreview }) {
  return (
    <>
      {book.favorite && (
        <span className="mark" title="Favourite">
          <Icon name="heart" size={13} label="Favourite" />
        </span>
      )}
      {book.wantToRead && (
        <span className="mark" title="Up next">
          <Icon name="bookmark" size={13} label="Up next" />
        </span>
      )}
    </>
  );
}

function MoreMenu({ book, actions }: { book: BookPreview; actions: BookActions }) {
  return <Menu label={`More for ${book.title}`} trigger={<Icon name="more" />} items={bookMenu(book, actions)} />;
}

function Progress({ book }: { book: BookPreview }) {
  if (book.status !== "in_progress") return null;
  return (
    <span className="progress-line">
      <ProgressBar value={book.totalProgression} />
      <span className="num">{percent(book.totalProgression)}</span>
    </span>
  );
}

export function BookGrid({ books, actions, selection }: Props) {
  return (
    <ul className={`book-grid${selection ? " is-selecting" : ""}`}>
      {books.map((book) => {
        const { mark, props } = picked(book, selection);
        return (
          <li
            key={book.id}
            className={`grid-card${selection?.has(book.id) ? " is-selected" : ""}`}
            {...bookContextMenu(book, actions)}
          >
            <button
              type="button"
              className="grid-open"
              onClick={() => press(book, actions, selection)}
              title={`${book.title}, ${authorLine(book.authors)}`}
              {...props}
            >
              <BookCover book={book} />
              {mark}
            </button>
            <div className="grid-caption">
              <div className="grid-text">
                <span className="book-title">{book.title}</span>
                <span className="book-author">
                  {authorLine(book.authors)}
                  <Marks book={book} />
                </span>
              </div>
              <MoreMenu book={book} actions={actions} />
            </div>
            <Progress book={book} />
          </li>
        );
      })}
    </ul>
  );
}

export function BookList({ books, actions, selection }: Props) {
  return (
    <ul className="book-list">
      {books.map((book) => {
        const { mark, props } = picked(book, selection);
        return (
          <li
            key={book.id}
            className={`list-row${selection?.has(book.id) ? " is-selected" : ""}`}
            {...bookContextMenu(book, actions)}
          >
            <button type="button" className="list-open" onClick={() => press(book, actions, selection)} {...props}>
              {mark}
              <BookCover book={book} size="s" />
              <span className="list-text">
                <span className="book-title">{book.title}</span>
                <span className="book-author">
                  {authorLine(book.authors)}
                  <Marks book={book} />
                </span>
                {seriesLine(book) && <span className="book-author">{seriesLine(book)}</span>}
                {book.tags.length > 0 && <span className="book-tags">{book.tags.join(" · ")}</span>}
                <Stars value={book.rating} size={13} />
              </span>
            </button>
            <span className="list-status">
              {book.status === "in_progress" ? <Progress book={book} /> : <span className="muted">{STATUS[book.status]}</span>}
            </span>
            <span className="list-format muted">{formatLabel(book.format)}</span>
            <span className="list-added muted">{new Date(book.addedAt).toLocaleDateString()}</span>
            <MoreMenu book={book} actions={actions} />
          </li>
        );
      })}
    </ul>
  );
}

export function BookTable({ books, actions, selection }: Props) {
  return (
    <table className="book-table">
      <thead>
        <tr>
          <th scope="col">Title</th>
          <th scope="col">Author</th>
          <th scope="col">Series</th>
          <th scope="col">Status</th>
          <th scope="col">Rating</th>
          <th scope="col">Format</th>
          <th scope="col">Added</th>
          <th scope="col">
            <span className="visually-hidden">Actions</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {books.map((book) => {
          const { mark, props } = picked(book, selection);
          return (
            <tr key={book.id} className={selection?.has(book.id) ? "is-selected" : undefined} {...bookContextMenu(book, actions)}>
              <td>
                <button type="button" className="table-title" onClick={() => press(book, actions, selection)} {...props}>
                  {mark}
                  {book.title}
                </button>
                <Marks book={book} />
                {book.availability !== "local" && (
                  <span className="mark" title={book.availability === "cloud" ? "In the cloud" : "File missing"}>
                    <Icon name={book.availability === "cloud" ? "cloud" : "warning"} size={13} />
                  </span>
                )}
              </td>
              <td>{authorLine(book.authors)}</td>
              <td className="muted">{seriesLine(book) ?? ""}</td>
              <td className="num">{book.status === "in_progress" ? percent(book.totalProgression) : STATUS[book.status]}</td>
              <td>
                <Stars value={book.rating} size={12} />
              </td>
              <td className="muted">{formatLabel(book.format)}</td>
              <td className="muted num">{new Date(book.addedAt).toLocaleDateString()}</td>
              <td>
                <MoreMenu book={book} actions={actions} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

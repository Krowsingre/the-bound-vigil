import type { BookPreview } from "../api/types";
import { BookCover } from "../components/BookCover";
import { Icon } from "../components/Icon";
import { Menu } from "../components/Menu";
import { ProgressBar } from "../components/ProgressBar";
import { Stars } from "../components/StarRating";
import { authorLine, percent } from "../lib/format";
import { bookContextMenu, bookMenu, type BookActions } from "../home/bookActions";

type Props = { books: BookPreview[]; actions: BookActions };

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

export function BookGrid({ books, actions }: Props) {
  return (
    <ul className="book-grid">
      {books.map((book) => (
        <li key={book.id} className="grid-card" {...bookContextMenu(book, actions)}>
          <button type="button" className="grid-open" onClick={() => actions.open(book)} title={`${book.title}, ${authorLine(book.authors)}`}>
            <BookCover book={book} />
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
      ))}
    </ul>
  );
}

export function BookList({ books, actions }: Props) {
  return (
    <ul className="book-list">
      {books.map((book) => (
        <li key={book.id} className="list-row" {...bookContextMenu(book, actions)}>
          <button type="button" className="list-open" onClick={() => actions.open(book)}>
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
          <span className="list-format muted">{book.format.toUpperCase()}</span>
          <span className="list-added muted">{new Date(book.addedAt).toLocaleDateString()}</span>
          <MoreMenu book={book} actions={actions} />
        </li>
      ))}
    </ul>
  );
}

export function BookTable({ books, actions }: Props) {
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
        {books.map((book) => (
          <tr key={book.id} {...bookContextMenu(book, actions)}>
            <td>
              <button type="button" className="table-title" onClick={() => actions.open(book)}>
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
            <td className="muted">{book.format.toUpperCase()}</td>
            <td className="muted num">{new Date(book.addedAt).toLocaleDateString()}</td>
            <td>
              <MoreMenu book={book} actions={actions} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

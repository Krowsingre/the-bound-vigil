// Sanctum's "From authors you watch": books newly announced or just out, by
// authors and for books on the watch list (watchList.ts). Nothing here is in
// the library; each opens its page in Discover.

import { useState } from "react";
import { CLOTH } from "../components/BookCover";
import { authorLine, hashOf } from "../lib/format";
import { clearWatchNews, useWatch, whenLine, type WatchNews } from "../library/watchList";
import { Section } from "./Section";

function NewsCover({ book }: { book: WatchNews }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="cover cover-m missing-cover">
      {book.coverUrl && !failed ? (
        <img className="private-picture" src={book.coverUrl} alt="" draggable={false} onError={() => setFailed(true)} />
      ) : (
        <div className="cover-generated" style={{ background: CLOTH[hashOf(book.key) % CLOTH.length] }}>
          <span className="cover-title">{book.title}</span>
          <span className="cover-author">{authorLine(book.authors)}</span>
        </div>
      )}
      <span className={`missing-badge${book.kind === "released" ? " is-new" : ""}`}>{book.kind === "released" ? "Out now" : "Coming"}</span>
    </div>
  );
}

export function WatchNewsRow({ onOpenLink }: { onOpenLink?: (url: string) => void }) {
  const { news } = useWatch();
  if (!news.length) return null;
  const shown = [...news].sort((a, b) => b.foundAt.localeCompare(a.foundAt)).slice(0, 12);
  return (
    <Section
      title="From authors you watch"
      className="series-news"
      action={
        <button type="button" className="view-all" onClick={() => clearWatchNews()}>
          Clear
        </button>
      }
    >
      <ul className="shelf">
        {shown.map((book) => (
          <li key={book.key}>
            <button
              type="button"
              className="shelf-book"
              title={`${book.title}, not in your library`}
              disabled={!book.link || !onOpenLink}
              onClick={() => book.link && onOpenLink?.(book.link)}
            >
              <NewsCover book={book} />
              <span className="book-title">{book.title}</span>
              <span className="book-author">{whenLine(book)}</span>
            </button>
          </li>
        ))}
      </ul>
    </Section>
  );
}

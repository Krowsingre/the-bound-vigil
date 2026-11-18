// Sanctum's "New in your series": books the series check found that weren't
// on their series' list before (seriesCheck.ts). Nothing here is in the
// library; each opens its series, where it can be found or hidden.

import { useState } from "react";
import { CLOTH } from "../components/BookCover";
import { authorLine, hashOf } from "../lib/format";
import { clearSeriesNews, useSeriesNews, type SeriesNews } from "../library/seriesCheck";
import { Section } from "./Section";

function NewsCover({ book }: { book: SeriesNews }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="cover cover-m missing-cover">
      {book.coverUrl && !failed ? (
        <img className="private-picture" src={book.coverUrl} alt="" draggable={false} onError={() => setFailed(true)} />
      ) : (
        <div className="cover-generated" style={{ background: CLOTH[hashOf(book.series + book.key) % CLOTH.length] }}>
          <span className="cover-title">{book.title}</span>
          <span className="cover-author">{authorLine(book.authors)}</span>
        </div>
      )}
    </div>
  );
}

export function SeriesNewsRow({ onOpenSeries }: { onOpenSeries?: (name: string) => void }) {
  const { news } = useSeriesNews();
  if (!news.length) return null;
  const shown = [...news].sort((a, b) => b.foundAt.localeCompare(a.foundAt)).slice(0, 12);
  return (
    <Section
      title="New in your series"
      className="series-news"
      action={
        <button type="button" className="view-all" onClick={() => clearSeriesNews()}>
          Clear
        </button>
      }
    >
      <ul className="shelf">
        {shown.map((book) => (
          <li key={`${book.series}-${book.key}`}>
            <button type="button" className="shelf-book" title={`${book.title}, not in your library`} onClick={() => onOpenSeries?.(book.series)}>
              <NewsCover book={book} />
              <span className="book-title">{book.title}</span>
              <span className="book-author">
                {book.series}
                {book.position !== null ? `, Book ${book.position}` : ""}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Section>
  );
}

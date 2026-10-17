import type { BookPreview } from "../api/types";
import { BookCover } from "../components/BookCover";
import { Icon } from "../components/Icon";
import { Menu } from "../components/Menu";
import { ProgressBar } from "../components/ProgressBar";
import { authorLine, percent, relativeTime } from "../lib/format";
import { bookContextMenu, bookMenu, type BookActions } from "./bookActions";

const AVAILABILITY = { local: "On this device", cloud: "In the cloud", missing: "File missing" } as const;

export function ResumeHero({
  book,
  actions,
  onOpenLibrary,
}: {
  book: BookPreview | null;
  actions: BookActions;
  onOpenLibrary: () => void;
}) {
  if (!book) {
    return (
      <section className="hero hero-empty" aria-labelledby="hero-title">
        <div className="hero-body">
          <p className="eyebrow">Resume reading</p>
          <h1 id="hero-title" className="hero-title">
            Begin reading
          </h1>
          <p className="hero-synopsis">
            Nothing is in progress yet. Choose a book from Recently Added, or open your Library to find one.
          </p>
          <div className="hero-actions">
            <button type="button" className="btn btn-primary" onClick={onOpenLibrary}>
              Open Library <span aria-hidden>→</span>
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="hero" aria-labelledby="hero-title" {...bookContextMenu(book, actions)}>
      <div className="hero-inner">
        <button type="button" className="hero-cover" onClick={() => actions.open(book)} aria-label={`Open ${book.title}`}>
          <BookCover book={book} size="l" />
        </button>
        <div className="hero-body">
          <p className="eyebrow">Resume reading</p>
          <h1 id="hero-title" className="hero-title">
            {book.title}
          </h1>
          <p className="hero-author">{authorLine(book.authors)}</p>
          {book.synopsis && <p className="hero-synopsis">{book.synopsis}</p>}

          <div className="hero-progress">
            <ProgressBar value={book.totalProgression} />
            <span className="hero-percent">{percent(book.totalProgression)}</span>
          </div>

          <dl className="hero-meta">
            <div>
              <dt>Format</dt>
              <dd>{book.format.toUpperCase()}</dd>
            </div>
            {book.lastOpenedAt && (
              <div>
                <dt>Last opened</dt>
                <dd>{relativeTime(book.lastOpenedAt)}</dd>
              </div>
            )}
            <div>
              <dt>File</dt>
              <dd className={book.availability === "missing" ? "is-warn" : undefined}>{AVAILABILITY[book.availability]}</dd>
            </div>
          </dl>

          {book.remotePositions.map((r) => (
            <p key={r.deviceName} className="hero-remote">
              On {r.deviceName} you're at {percent(r.totalProgression)} ({relativeTime(r.at)})
            </p>
          ))}

          <div className="hero-actions">
            <button type="button" className="btn btn-primary btn-large" onClick={() => actions.open(book)}>
              <Icon name="play" size={16} /> Continue reading
            </button>
            <Menu label={`More for ${book.title}`} className="icon-btn icon-btn-round" trigger={<Icon name="more" />} items={bookMenu(book, actions)} align="start" />
          </div>
        </div>
      </div>
    </section>
  );
}

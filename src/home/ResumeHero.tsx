import type { BookPreview } from "../api/types";
import { BookCover } from "../components/BookCover";
import { Icon } from "../components/Icon";
import { Menu } from "../components/Menu";
import { ProgressBar } from "../components/ProgressBar";
import { authorLine, percent, relativeTime } from "../lib/format";
import { bookContextMenu, bookMenu, type BookActions } from "./bookActions";

/** The book to carry on with: its cover beside the title, how far along, and Continue reading. */
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
          <p className="eyebrow">Continue reading</p>
          <h1 id="hero-title" className="hero-title">
            Begin reading
          </h1>
          <p className="hero-synopsis">Nothing is in progress yet. Choose a book from Recently added, or open your Archive to find one.</p>
          <div className="hero-actions">
            <button type="button" className="btn btn-primary" onClick={onOpenLibrary}>
              Open Archive <span aria-hidden>→</span>
            </button>
          </div>
        </div>
      </section>
    );
  }

  // Where the other devices are, for anyone who points at the progress bar.
  const elsewhere = book.remotePositions.map((r) => `On ${r.deviceName} you're at ${percent(r.totalProgression)} (${relativeTime(r.at)})`).join("\n");

  return (
    <section className="hero" aria-labelledby="hero-title" {...bookContextMenu(book, actions)}>
      <div className="hero-inner">
        <button type="button" className="hero-cover" onClick={() => actions.open(book)} aria-label={`Open ${book.title}`}>
          <BookCover book={book} size="l" />
        </button>
        <div className="hero-body">
          <p className="eyebrow">Continue reading</p>
          <h1 id="hero-title" className="hero-title">
            {book.title}
          </h1>
          <p className="hero-author">{authorLine(book.authors)}</p>
          <div className="hero-progress" title={elsewhere || undefined}>
            <ProgressBar value={book.totalProgression} />
            <span className="hero-percent">{percent(book.totalProgression)}</span>
          </div>
          {elsewhere && <p className="visually-hidden">{elsewhere}</p>}
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

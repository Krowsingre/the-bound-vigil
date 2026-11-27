import { Fragment } from "react";
import { useDownloadsChanging } from "./cloudDownloads";
import type { BookPreview } from "../api/types";
import { BookCover } from "../components/BookCover";
import { Icon } from "../components/Icon";
import { Menu } from "../components/Menu";
import { holdForMenu } from "../components/ContextMenu";
import { ProgressBar } from "../components/ProgressBar";
import { Stars } from "../components/StarRating";
import { authorLine, percent } from "../lib/format";
import { groupPlaces, placeLine, placesIn, placesMark, placesOf, placesWords } from "../lib/details";
import { formatLabel } from "../lib/queryBooks";
import { bookContextMenu, bookMenu, clickBook, type BookActions } from "../home/bookActions";

/** While choosing books for a change to many at once, a click picks a book instead of opening it. */
export interface Selection {
  has: (bookId: string) => boolean;
  /** `range` holds the books shown, when Shift was held: every book from the
   *  last one picked to this one is chosen. */
  toggle: (book: BookPreview, range?: BookPreview[]) => void;
  /** Series shown as one stack are chosen whole: all their books at once. */
  hasSeries?: (name: string) => boolean;
  /** `book` is the one showing the stack; `range` as for `toggle`. */
  toggleSeries?: (name: string, book?: BookPreview, range?: BookPreview[]) => void;
}

/** A series stack while choosing: its tick, and whether a click chooses it. */
function pickedSeries(name: string, selection?: Selection | null, book?: BookPreview, books?: BookPreview[]) {
  if (!selection?.toggleSeries) return null;
  const on = !!selection.hasSeries?.(name);
  return {
    on,
    mark: (
      <span className={`select-mark${on ? " is-on" : ""}`} aria-hidden>
        {on && <Icon name="check" size={14} />}
      </span>
    ),
    toggle: (shift = false) => selection.toggleSeries!(name, book, shift ? books : undefined),
  };
}

type Props = {
  books: BookPreview[];
  actions: BookActions;
  selection?: Selection | null;
  seriesCounts?: Record<string, number>;
  seriesPublished?: Record<string, number>;
  /** Each stack's main author. */
  seriesAuthors?: Record<string, string>;
  showStatus?: boolean;
  seriesCovers?: Record<string, BookPreview>;
  seriesMenu?: (name: string) => import("../components/Menu").MenuEntry[];
  onOpenSeries?: (name: string) => void;
  /** Showing one series: each book's place in it. */
  inSeries?: string;
  /** The Pinned stack: pinned books and series, opened like a series, ahead of everything but the lead. */
  pinnedCard?: PinnedCard;
  /** The last thing read or listened to, shown first and marked, as well as in its own place (embre, 20 November). */
  lead?: LeadCard;
  /** On a computer, an opened stack fans its books out right after it (embre, 27 November):
   *  what to show under a stack, or nothing while it's folded. */
  fan?: (name: string) => React.ReactNode;
};

export type PinnedCard = { count: number; cover: BookPreview; onOpen: () => void };
export type LeadCard = { book: BookPreview; label: string };

/** The list in order: the lead, the Pinned stack, then everything else. */
const ordered = (rows: React.ReactNode[], pinned: React.ReactNode, lead: React.ReactNode) => [
  ...(lead ? [lead] : []),
  ...(pinned ? [pinned] : []),
  ...rows,
];

const leadLabel = (lead?: string) => (lead ? <span className="lead-label">{lead}</span> : null);

const pinnedWords = (count: number) => `${count} pinned`;

function PinnedGridCard({ card }: { card: PinnedCard }) {
  return (
    <li key="pinned-stack" className="grid-card series-stack pinned-stack">
      <button type="button" className="grid-open" aria-label={`Open Pinned, ${pinnedWords(card.count)}`} onClick={card.onOpen}>
        <BookCover key={card.cover.id} book={card.cover} seriesCount={card.count} />
        <span className="pinned-stack-mark" aria-hidden><Icon name="pin" size={14} /></span>
      </button>
      <div className="grid-caption">
        <div className="grid-text">
          <span className="book-title">Pinned</span>
          <span className="book-author">{pinnedWords(card.count)}</span>
        </div>
      </div>
    </li>
  );
}

function PinnedListRow({ card }: { card: PinnedCard }) {
  return (
    <li key="pinned-stack" className="list-row series-list-row pinned-stack">
      <button type="button" className="list-open" aria-label={`Open Pinned, ${pinnedWords(card.count)}`} onClick={card.onOpen}>
        <BookCover key={card.cover.id} book={card.cover} size="s" seriesCount={card.count} />
        <span className="list-text">
          <span className="book-title"><Icon name="pin" size={14} /> Pinned</span>
          <span className="book-author">{pinnedWords(card.count)}</span>
        </span>
      </button>
    </li>
  );
}

function PinnedTableRow({ card }: { card: PinnedCard }) {
  return (
    <tr key="pinned-stack" className="series-table-row pinned-stack">
      <td colSpan={8}>
        <button type="button" className="table-title series-table-open" aria-label={`Open Pinned, ${pinnedWords(card.count)}`} onClick={card.onOpen}>
          <BookCover book={card.cover} size="s" seriesCount={card.count} />
          <Icon name="pin" size={14} /> Pinned
          <span className="muted series-table-author">{pinnedWords(card.count)}</span>
        </button>
      </td>
    </tr>
  );
}

const press = (book: BookPreview, actions: BookActions, selection: Selection | null | undefined, books: BookPreview[], shift: boolean) =>
  selection ? selection.toggle(book, shift ? books : undefined) : clickBook(book, actions);

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

const STATUS = { unread: "Unread", in_progress: "In progress", read: "Read", dropped: "Dropped" } as const;

/** "Series #3", "Series #1–3" or "Series, side story": its main series, or
 *  in a series' own view (`inSeries`), its place there. */
function seriesLine(book: BookPreview, inSeries?: string) {
  const here = inSeries ? placesIn(book, inSeries) : [];
  // In the series' own view its name goes without saying.
  if (here.length) return here.some((p) => p.number != null || p.after != null) ? placesWords(here) : null;
  const main = groupPlaces(placesOf(book))[0];
  if (!main) return null;
  return main.places.length > 1 ? `${main.name} ${placesMark(main.places)}` : placeLine(main.places[0]);
}

function Marks({ book }: { book: BookPreview }) {
  return (
    <>
      {book.pinnedAt && (
        <span className="mark" title="Pinned">
          <Icon name="pin" size={13} label="Pinned" />
        </span>
      )}
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
  useDownloadsChanging();
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

/** Right-click (or press and hold) on a stack opens its menu, as on a book. */
const stackMenu = (name: string, seriesMenu?: Props["seriesMenu"]) => (seriesMenu ? holdForMenu(`More for ${name}`, () => seriesMenu(name)) : {});

export function BookGrid({ books, actions, selection, seriesCounts, seriesPublished, seriesAuthors, seriesCovers, onOpenSeries, seriesMenu, showStatus, inSeries, pinnedCard, lead, fan }: Props) {
  const row = (book: BookPreview, leading?: string) => {
        const count = leading ? undefined : seriesCounts?.[book.id];
        if (count && book.series && onOpenSeries) {
          const name = book.series.trim();
          const cover = seriesCovers?.[book.id] ?? book;
          const pick = pickedSeries(name, selection, book, books);
          const fanned = pick ? null : fan?.(name);
          return (
            <Fragment key={book.id}>
            <li className={`grid-card series-stack${pick?.on ? " is-selected" : ""}${fanned ? " is-fanned" : ""}`} {...stackMenu(name, seriesMenu)}>
              <button
                type="button"
                className="grid-open"
                aria-label={pick ? `Choose series ${name}` : "Open series " + name}
                aria-pressed={pick ? pick.on : undefined}
                aria-expanded={fan && !pick ? !!fanned : undefined}
                onClick={(e) => (pick ? pick.toggle(e.shiftKey) : onOpenSeries(name))}
              >
                <BookCover key={cover.id} book={cover} seriesCount={count} seriesPublished={seriesPublished?.[book.id]} />
                {pick?.mark}
              </button>
              <div className="grid-caption">
                <div className="grid-text">
                  <span className="book-title">{name}</span>
                  {seriesAuthors?.[book.id] && <span className="book-author">{seriesAuthors[book.id]}</span>}
                </div>
                {seriesMenu && <Menu label={"More for " + name} trigger={<Icon name="more" />} items={seriesMenu(name)} />}
              </div>
            </li>
            {fanned && <li className="series-fan">{fanned}</li>}
            </Fragment>
          );
        }
        const { mark, props } = picked(book, selection);
        return (
          <li
            key={leading ? `lead:${book.id}` : book.id}
            className={`grid-card${leading ? " is-lead" : ""}${selection?.has(book.id) ? " is-selected" : ""}`}
            {...bookContextMenu(book, actions)}
          >
            <button
              type="button"
              className="grid-open"
              onClick={(e) => press(book, actions, selection, books, e.shiftKey)}
              title={`${book.title}, ${authorLine(book.authors, book.audioType)}`}
              {...props}
            >
              <BookCover book={book} />
              {mark}
            </button>
            <div className="grid-caption">
              <div className="grid-text">
                {leadLabel(leading)}
                <span className="book-title">{book.title}</span>
                <span className="book-author">
                  {authorLine(book.authors, book.audioType)}
                  <Marks book={book} />
                </span>
                {showStatus && <span className="book-author">{[seriesLine(book, inSeries), STATUS[book.status]].filter(Boolean).join(" · ")}</span>}
              </div>
              <MoreMenu book={book} actions={actions} />
            </div>
            <Progress book={book} />
          </li>
        );
  };
  return (
    <ul className={`book-grid${selection ? " is-selecting" : ""}`}>
      {ordered(books.map((book) => row(book)), pinnedCard && <PinnedGridCard key="pinned-stack" card={pinnedCard} />, lead && row(lead.book, lead.label))}
    </ul>
  );
}

export function BookList({ books, actions, selection, seriesCounts, seriesPublished, seriesAuthors, seriesCovers, onOpenSeries, seriesMenu, inSeries, pinnedCard, lead, fan }: Props) {
  const row = (book: BookPreview, leading?: string) => {
        const count = leading ? undefined : seriesCounts?.[book.id];
        const name = book.series?.trim();
        if (count && name && onOpenSeries) {
          const cover = seriesCovers?.[book.id] ?? book;
          const pick = pickedSeries(name, selection, book, books);
          const fanned = pick ? null : fan?.(name);
          return <Fragment key={book.id}><li className={`list-row series-list-row${pick?.on ? " is-selected" : ""}${fanned ? " is-fanned" : ""}`} {...stackMenu(name, seriesMenu)}>
            <button type="button" className="list-open" aria-label={pick ? `Choose series ${name}` : `Open series ${name}`}
              aria-pressed={pick ? pick.on : undefined} aria-expanded={fan && !pick ? !!fanned : undefined} onClick={(e) => (pick ? pick.toggle(e.shiftKey) : onOpenSeries(name))}>
              {pick?.mark}
              <BookCover key={cover.id} book={cover} size="s" seriesCount={count} seriesPublished={seriesPublished?.[book.id]} />
              <span className="list-text">
                <span className="book-title">{name}</span>
                {seriesAuthors?.[book.id] && <span className="book-author">{seriesAuthors[book.id]}</span>}
              </span>
            </button>
            {seriesMenu && <Menu label={`More for ${name}`} trigger={<Icon name="more" />} items={seriesMenu(name)} />}
          </li>
          {fanned && <li className="series-fan">{fanned}</li>}
          </Fragment>;
        }
        const { mark, props } = picked(book, selection);
        return (
          <li
            key={leading ? `lead:${book.id}` : book.id}
            className={`list-row${leading ? " is-lead" : ""}${selection?.has(book.id) ? " is-selected" : ""}`}
            {...bookContextMenu(book, actions)}
          >
            <button type="button" className="list-open" onClick={(e) => press(book, actions, selection, books, e.shiftKey)} {...props}>
              {mark}
              <BookCover book={book} size="s" />
              <span className="list-text">
                {leadLabel(leading)}
                <span className="book-title">{book.title}</span>
                <span className="book-author">
                  {authorLine(book.authors, book.audioType)}
                  <Marks book={book} />
                </span>
                {seriesLine(book, inSeries) && <span className="book-author">{seriesLine(book, inSeries)}</span>}
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
  };
  return (
    <ul className="book-list">
      {ordered(books.map((book) => row(book)), pinnedCard && <PinnedListRow key="pinned-stack" card={pinnedCard} />, lead && row(lead.book, lead.label))}
    </ul>
  );
}

export function BookTable({ books, actions, selection, seriesCounts, seriesPublished, seriesAuthors, seriesCovers, onOpenSeries, seriesMenu, inSeries, pinnedCard, lead, fan }: Props) {
  const row = (book: BookPreview, leading?: string) => {
          const count = leading ? undefined : seriesCounts?.[book.id];
          const name = book.series?.trim();
          const pick = count && name ? pickedSeries(name, selection, book, books) : null;
          const fanned = count && name && !pick ? fan?.(name) : null;
          if (count && name && onOpenSeries) return <Fragment key={book.id}><tr className={`series-table-row${pick?.on ? " is-selected" : ""}${fanned ? " is-fanned" : ""}`} {...stackMenu(name, seriesMenu)}>
            <td colSpan={7}>
              <button type="button" aria-label={pick ? `Choose series ${name}` : `Open series ${name}`} aria-pressed={pick ? pick.on : undefined}
                aria-expanded={fan && !pick ? !!fanned : undefined}
                className="table-title series-table-open" onClick={(e) => (pick ? pick.toggle(e.shiftKey) : onOpenSeries(name))}>
                {pick?.mark}
                <BookCover book={seriesCovers?.[book.id] ?? book} size="s" seriesCount={count} seriesPublished={seriesPublished?.[book.id]} />
                {name}
                {seriesAuthors?.[book.id] && <span className="muted series-table-author">{seriesAuthors[book.id]}</span>}
              </button>
            </td>
            <td>{seriesMenu && <Menu label={`More for ${name}`} trigger={<Icon name="more" />} items={seriesMenu(name)} />}</td>
          </tr>
          {fanned && <tr className="series-fan-row"><td colSpan={8}><div className="series-fan">{fanned}</div></td></tr>}
          </Fragment>;
          const { mark, props } = picked(book, selection);
          return (
            <tr key={leading ? `lead:${book.id}` : book.id} className={[leading ? "is-lead" : "", selection?.has(book.id) ? "is-selected" : ""].filter(Boolean).join(" ") || undefined} {...bookContextMenu(book, actions)}>
              <td>
                {leadLabel(leading)}
                <button type="button" className="table-title" onClick={(e) => press(book, actions, selection, books, e.shiftKey)} {...props}>
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
              <td>{authorLine(book.authors, book.audioType)}</td>
              <td className="muted">{seriesLine(book, inSeries) ?? ""}</td>
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
  };
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
        {ordered(books.map((book) => row(book)), pinnedCard && <PinnedTableRow key="pinned-stack" card={pinnedCard} />, lead && row(lead.book, lead.label))}
      </tbody>
    </table>
  );
}

/**
 * The list on a phone, portrait iPad or upright Duo (embre, 20 November): just the name (cut short
 * when there's no room), how far along once started, and the ••• menu. A series is just its name.
 */
export function PhoneList({ books, actions, selection, seriesCounts, onOpenSeries, seriesMenu, pinnedCard, lead }: Props) {
  const row = (book: BookPreview, leading?: string) => {
    const count = leading ? undefined : seriesCounts?.[book.id];
    const name = book.series?.trim();
    if (count && name && onOpenSeries) {
      const pick = pickedSeries(name, selection, book, books);
      return (
        <li key={book.id} className={`phone-row is-series${pick?.on ? " is-selected" : ""}`} {...stackMenu(name, seriesMenu)}>
          <button type="button" className="phone-open" aria-label={pick ? `Choose series ${name}` : `Open series ${name}`}
            aria-pressed={pick ? pick.on : undefined} onClick={(e) => (pick ? pick.toggle(e.shiftKey) : onOpenSeries(name))}>
            {pick?.mark}
            <span className="book-title">{name}</span>
          </button>
          {seriesMenu && <Menu label={`More for ${name}`} trigger={<Icon name="more" />} items={seriesMenu(name)} />}
        </li>
      );
    }
    const { mark, props } = picked(book, selection);
    return (
      <li key={leading ? `lead:${book.id}` : book.id} className={`phone-row${leading ? " is-lead" : ""}${selection?.has(book.id) ? " is-selected" : ""}`}
        {...bookContextMenu(book, actions)}>
        <button type="button" className="phone-open" title={book.title} onClick={(e) => press(book, actions, selection, books, e.shiftKey)} {...props}>
          {mark}
          {leadLabel(leading)}
          <span className="book-title">{book.title}</span>
        </button>
        {book.status === "in_progress" && <span className="phone-percent num">{percent(book.totalProgression)}</span>}
        <MoreMenu book={book} actions={actions} />
      </li>
    );
  };
  const pinned = pinnedCard && (
    <li key="pinned-stack" className="phone-row is-series pinned-stack">
      <button type="button" className="phone-open" aria-label={`Open Pinned, ${pinnedWords(pinnedCard.count)}`} onClick={pinnedCard.onOpen}>
        <Icon name="pin" size={14} />
        <span className="book-title">Pinned</span>
      </button>
    </li>
  );
  return <ul className={`phone-list${selection ? " is-selecting" : ""}`}>{ordered(books.map((book) => row(book)), pinned, lead && row(lead.book, lead.label))}</ul>;
}

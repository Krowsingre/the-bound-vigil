import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import type { BookPreview, CollectionDetail, CollectionRef, SeriesSummary } from "../api/types";
import { BookCover } from "../components/BookCover";
import { Icon } from "../components/Icon";
import { Menu, type MenuEntry } from "../components/Menu";
import { ProgressBar } from "../components/ProgressBar";
import { useToast } from "../components/Toast";
import { bookContextMenu, makeBookActions } from "../home/bookActions";
import { BookGrid, BookList } from "../library/BookViews";
import { authorLine, percent } from "../lib/format";
import { Badge } from "./badges";
import { CollectionSeries } from "./CollectionSeries";
import { CollectionPicture } from "./CollectionCards";
import { bookCount, KIND_LABEL, SMART_INFO } from "./collectionInfo";
import { describeRules } from "./rules";

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

/** One collection, full page: its picture, its books, and adding or ordering them. */
export function CollectionView({
  collection,
  series,
  refreshKey,
  menuFor,
  onBack,
  onOpenBook,
  onChanged,
}: {
  collection: CollectionRef;
  series: SeriesSummary[];
  refreshKey: number;
  menuFor: (detail: CollectionDetail) => MenuEntry[];
  onBack: () => void;
  onOpenBook: (bookId: string) => void;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<CollectionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [layout, setLayout] = useState<"grid" | "list">("grid");
  const [adding, setAdding] = useState(false);
  const toast = useToast();
  const key = JSON.stringify(collection);

  useEffect(() => {
    let current = true;
    api.getCollection(collection).then(
      (d) => current && setDetail(d),
      (e: unknown) => current && setError(String(e)),
    );
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, refreshKey, reload]);

  const c = detail?.collection ?? null;
  // Books are added to `own` by hand; a collection with rules fills itself.
  const own = c && c.kind !== "shelf" && !c.rules ? c : null;
  const changed = () => {
    setReload((n) => n + 1);
    onChanged();
  };
  const actions = useMemo(
    () => ({
      ...makeBookActions(api, toast, changed, onOpenBook),
      ...(own && {
        removeFromCollection: {
          name: own.name,
          remove: (book: BookPreview) =>
            api.removeFromCollection(own.id, book.id).then(
              () => {
                toast(`Removed “${book.title}” from ${own.name}. The book stays in your library.`);
                changed();
              },
              (e: unknown) => toast(String(e)),
            ),
        },
      }),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [toast, onOpenBook, own?.id, own?.name],
  );

  if (error)
    return (
      <div className="collection-view">
        <BackLink onBack={onBack} />
        <div className="library-empty" role="alert">
          <h2>This collection couldn't be opened</h2>
          <p className="muted">{error}</p>
        </div>
      </div>
    );
  if (!detail) return <div className="collection-view library-loading" aria-busy="true" />;

  const name =
    collection.kind === "smart" ? SMART_INFO[collection.smart].name : collection.kind === "series" ? collection.name : (c?.name ?? "");
  const badge = collection.kind === "smart" ? SMART_INFO[collection.smart].badge : collection.kind === "series" ? "scroll" : c?.badge;
  const description =
    collection.kind === "smart"
      ? SMART_INFO[collection.smart].description
      : collection.kind === "series"
        ? `By ${authorLine(series.find((s) => s.name === collection.name)?.authors ?? []) || "unknown authors"}, in reading order.`
        : c?.description;
  const kindLabel =
    collection.kind === "smart"
      ? "Smart collection"
      : collection.kind === "series"
        ? "Series"
        : c?.rules
          ? "Filled by rules"
          : c && KIND_LABEL[c.kind];
  const covers = detail.books.slice(0, 3).map(({ id, title, authors, coverPath }) => ({ id, title, authors, coverPath }));
  const menu = menuFor(detail);
  const move = (book: BookPreview, to: number) =>
    own && api.moveInCollection(own.id, book.id, to).then(() => setReload((n) => n + 1), (e: unknown) => toast(String(e)));

  return (
    <div className="collection-view">
      <header className="collection-hero">
        <CollectionPicture
          collection={{ id: c?.id ?? name, picture: c?.picture ?? null, picturePath: c?.picturePath ?? null, covers }}
          className="hero-picture"
        />
        <div className="collection-hero-text">
          <BackLink onBack={onBack} />
          <h1>
            <Badge name={badge} size={28} />
            {name}
          </h1>
          <p className="collection-hero-meta">
            {bookCount(detail.books.length)}
            {kindLabel && <> · {kindLabel}</>}
          </p>
          {description && <p className="collection-hero-description">{description}</p>}
        </div>
        <div className="collection-hero-actions">
          {own && (
            <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
              <span aria-hidden>+</span> Add books
            </button>
          )}
          {menu.length > 0 && <Menu label={`More for ${name}`} trigger={<Icon name="more" />} items={menu} className="icon-btn hero-more" />}
        </div>
      </header>

      <div className="collection-view-tools">
        <p className="muted">
          {own?.kind === "reading_list"
            ? "A reading list, top to bottom. Use the arrows to change the order."
            : collection.kind === "series"
              ? "In series order."
              : c?.kind === "shelf"
                ? "Books join this shelf from their own … menu."
                : c?.rules
                  ? `Books where ${lowerFirst(describeRules(c.rules))}. It keeps up as your books change.`
                  : null}
        </p>
        {own?.kind !== "reading_list" && detail.books.length > 0 && (
          <div className="layout-switch" role="radiogroup" aria-label="Layout">
            {(
              [
                ["grid", "Covers", "grid"],
                ["list", "List", "list"],
              ] as const
            ).map(([value, label, icon]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={layout === value}
                aria-label={label}
                title={label}
                className={layout === value ? "is-active" : undefined}
                onClick={() => setLayout(value)}
              >
                <Icon name={icon} size={16} />
              </button>
            ))}
          </div>
        )}
      </div>

      <CollectionSeries collection={collection} books={detail.books} refreshKey={refreshKey + reload} onChanged={changed} />

      {detail.books.length === 0 ? (
        <div className="library-empty">
          <h2>No books here yet</h2>
          <p className="muted">
            {own
              ? "Add books with the button above, or from any book's … menu."
              : c?.rules
                ? "No books match its rules yet. They appear here by themselves when one does."
                : "Books appear here by themselves as you read."}
          </p>
        </div>
      ) : own?.kind === "reading_list" ? (
        <ol className="reading-list">
          {detail.books.map((b, i) => (
            <li key={b.id} className="reading-row" {...bookContextMenu(b, actions)}>
              <span className="reading-number">{i + 1}</span>
              <button type="button" className="reading-open" onClick={() => actions.open(b)}>
                <BookCover book={b} size="s" />
                <span className="reading-text">
                  <span className="reading-title">{b.title}</span>
                  <span className="reading-author">{authorLine(b.authors)}</span>
                </span>
              </button>
              <span className="reading-status">
                {b.status === "read" ? (
                  <span className="muted">Read</span>
                ) : b.status === "in_progress" ? (
                  <span className="progress-line">
                    <ProgressBar value={b.totalProgression} />
                    <span className="num">{percent(b.totalProgression)}</span>
                  </span>
                ) : (
                  <span className="muted">Not started</span>
                )}
              </span>
              <span className="reading-move">
                <button type="button" className="icon-btn icon-btn-s" aria-label={`Move ${b.title} up`} disabled={i === 0} onClick={() => move(b, i - 1)}>
                  <Icon name="chevronUp" size={16} />
                </button>
                <button
                  type="button"
                  className="icon-btn icon-btn-s"
                  aria-label={`Move ${b.title} down`}
                  disabled={i === detail.books.length - 1}
                  onClick={() => move(b, i + 1)}
                >
                  <Icon name="chevronDown" size={16} />
                </button>
              </span>
              <button
                type="button"
                className="icon-btn icon-btn-s"
                aria-label={`Remove ${b.title} from ${own.name}`}
                title="Remove from this list"
                onClick={() => actions.removeFromCollection?.remove(b)}
              >
                <Icon name="close" size={16} />
              </button>
            </li>
          ))}
        </ol>
      ) : layout === "grid" ? (
        <BookGrid books={detail.books} actions={actions} />
      ) : (
        <BookList books={detail.books} actions={actions} />
      )}

      {adding && own && (
        <AddBooksDialog
          collectionName={own.name}
          already={new Set(detail.books.map((b) => b.id))}
          onCancel={() => setAdding(false)}
          onAdd={(ids) =>
            api.addToCollection(own.id, ids).then(
              () => {
                setAdding(false);
                toast(`Added ${bookCount(ids.length)} to ${own.name}.`);
                changed();
              },
              (e: unknown) => toast(String(e)),
            )
          }
        />
      )}
    </div>
  );
}

function BackLink({ onBack }: { onBack: () => void }) {
  return (
    <button type="button" className="back-link" onClick={onBack}>
      <Icon name="chevronLeft" size={14} /> Collections
    </button>
  );
}

/** Picking books from the library to add to a collection. */
function AddBooksDialog({
  collectionName,
  already,
  onAdd,
  onCancel,
}: {
  collectionName: string;
  already: Set<string>;
  onAdd: (bookIds: string[]) => void;
  onCancel: () => void;
}) {
  const [search, setSearch] = useState("");
  const [books, setBooks] = useState<BookPreview[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  useEffect(() => {
    let current = true;
    const t = setTimeout(() => {
      api
        .getLibrary({ shelf: "all", sort: "title", search: search.trim() || null, formats: [], location: null, page: 0, pageSize: 200 })
        .then((page) => current && setBooks(page.books), () => current && setBooks([]));
    }, 150);
    return () => {
      current = false;
      clearTimeout(t);
    };
  }, [search]);

  const toggle = (id: string) =>
    setPicked((p) => {
      const next = new Set(p);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="dialog add-books-dialog" role="dialog" aria-label={`Add books to ${collectionName}`} onKeyDown={(e) => e.key === "Escape" && onCancel()}>
        <h2>Add books to {collectionName}</h2>
        <label className="search add-books-search">
          <Icon name="search" size={16} />
          <input autoFocus type="search" placeholder="Search your library…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search your library" />
        </label>
        <ul className="add-books-list">
          {books === null ? (
            <li className="library-loading" aria-busy="true" />
          ) : books.length === 0 ? (
            <li className="muted">No books match.</li>
          ) : (
            books.map((b) => {
              const inIt = already.has(b.id);
              return (
                <li key={b.id}>
                  <label className={`add-book${inIt ? " is-in" : ""}`}>
                    <input type="checkbox" checked={inIt || picked.has(b.id)} disabled={inIt} onChange={() => toggle(b.id)} />
                    <BookCover book={b} size="s" />
                    <span className="add-book-text">
                      <span className="add-book-title">{b.title}</span>
                      <span className="muted">{inIt ? "Already in this collection" : authorLine(b.authors)}</span>
                    </span>
                  </label>
                </li>
              );
            })
          )}
        </ul>
        <div className="dialog-actions">
          <button type="button" className="btn btn-quiet" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={picked.size === 0} onClick={() => onAdd([...picked])}>
            {picked.size ? `Add ${bookCount(picked.size)}` : "Add books"}
          </button>
        </div>
      </div>
    </div>
  );
}

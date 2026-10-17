import { useEffect, useState } from "react";
import { api } from "../api";
import type { CollectionDetail, CollectionRef, SeriesSummary } from "../api/types";
import { BookCover } from "../components/BookCover";
import { Icon } from "../components/Icon";
import { Menu, type MenuEntry } from "../components/Menu";
import { authorLine, percent } from "../lib/format";
import { Badge } from "./badges";
import { CollectionPicture } from "./CollectionCards";
import { bookCount, KIND_LABEL, SMART_INFO } from "./collectionInfo";

const PANEL_BOOKS = 5;

/** The selected collection, at the side of the Collections page. */
export function CollectionPanel({
  selected,
  series,
  refreshKey,
  menuFor,
  onOpen,
  onOpenBook,
}: {
  selected: CollectionRef;
  series: SeriesSummary[];
  refreshKey: number;
  menuFor: (detail: CollectionDetail) => MenuEntry[];
  onOpen: () => void;
  onOpenBook: (bookId: string) => void;
}) {
  const [detail, setDetail] = useState<CollectionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = JSON.stringify(selected);

  useEffect(() => {
    let current = true;
    setError(null);
    api.getCollection(selected).then(
      (d) => current && setDetail(d),
      (e: unknown) => current && setError(String(e)),
    );
    return () => {
      current = false;
    };
    // `key` stands for `selected`, which is a fresh object on each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, refreshKey]);

  if (error) return <aside className="collection-panel muted">{error}</aside>;
  if (!detail) return <aside className="collection-panel" aria-busy="true" />;

  const c = detail.collection;
  const name =
    selected.kind === "smart" ? SMART_INFO[selected.smart].name : selected.kind === "series" ? selected.name : (c?.name ?? "");
  const badge = selected.kind === "smart" ? SMART_INFO[selected.smart].badge : selected.kind === "series" ? "scroll" : c?.badge;
  const description =
    selected.kind === "smart"
      ? SMART_INFO[selected.smart].description
      : selected.kind === "series"
        ? `A series by ${authorLine(series.find((s) => s.name === selected.name)?.authors ?? []) || "unknown authors"}, in reading order.`
        : c?.description;
  const kindLabel = selected.kind === "smart" ? "Smart collection" : selected.kind === "series" ? "Series" : c && KIND_LABEL[c.kind];
  const covers = detail.books.slice(0, 3).map(({ id, title, authors, coverPath }) => ({ id, title, authors, coverPath }));
  const menu = menuFor(detail);

  return (
    <aside className="collection-panel" aria-label={`${name}, selected`}>
      <CollectionPicture
        collection={{ id: c?.id ?? name, picture: c?.picture ?? null, picturePath: c?.picturePath ?? null, covers }}
        className="panel-picture"
      />
      <div className="panel-title">
        <Badge name={badge} size={22} />
        <h2>{name}</h2>
        {menu.length > 0 && <Menu label={`More for ${name}`} trigger={<Icon name="more" />} items={menu} />}
      </div>
      <p className="panel-meta">
        {bookCount(detail.books.length)}
        {kindLabel && <> · {kindLabel}</>}
      </p>
      {description && <p className="panel-description">{description}</p>}

      <h3 className="panel-heading">Books in this collection</h3>
      {detail.books.length === 0 ? (
        <p className="muted panel-empty">
          {selected.kind === "collection" && c?.kind !== "shelf"
            ? "No books yet. Add them from any book's … menu, or from the collection itself."
            : "No books here right now."}
        </p>
      ) : (
        <ul className="panel-books">
          {detail.books.slice(0, PANEL_BOOKS).map((b) => (
            <li key={b.id}>
              <button type="button" className="panel-book" onClick={() => onOpenBook(b.id)} title={`Open ${b.title}`}>
                <BookCover book={b} size="s" />
                <span className="panel-book-text">
                  <span className="panel-book-title">{b.title}</span>
                  <span className="panel-book-author">{authorLine(b.authors)}</span>
                  {b.status === "in_progress" && <span className="panel-book-progress">{percent(b.totalProgression)}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {detail.books.length > PANEL_BOOKS && (
        <p className="muted panel-more">and {bookCount(detail.books.length - PANEL_BOOKS)} more</p>
      )}
      <button type="button" className="btn btn-quiet btn-wide panel-view" onClick={onOpen}>
        View collection <Icon name="arrowRight" size={16} />
      </button>
    </aside>
  );
}

import type { CollectionSummary, CoverRef, SeriesSummary, SmartSummary } from "../api/types";
import { BookCover } from "../components/BookCover";
import { Icon } from "../components/Icon";
import { Menu, type MenuEntry } from "../components/Menu";
import { hashOf } from "../lib/format";
import { Badge } from "./badges";
import type { ReorderProps } from "./useReorder";
import { bookCount, KIND_LABEL, pictureUrl, SMART_INFO } from "./collectionInfo";

/** A collection's picture, or a quiet tone when it has none. */
export function CollectionPicture({
  collection,
  className = "",
}: {
  collection: Pick<CollectionSummary, "id" | "picture" | "picturePath" | "covers">;
  className?: string;
}) {
  const src = pictureUrl(collection);
  return (
    <span className={`collection-picture ${className}`} data-tone={hashOf(collection.id) % 4}>
      {src ? (
        <img src={src} alt="" draggable={false} />
      ) : (
        <span className="collection-picture-covers">
          {collection.covers.slice(0, 3).map((c) => (
            <BookCover key={c.id} book={c} size="m" />
          ))}
        </span>
      )}
    </span>
  );
}

export function CoverStrip({ covers, count }: { covers: CoverRef[]; count: number }) {
  return (
    <span className="cover-strip">
      {covers.map((c) => (
        <BookCover key={c.id} book={c} size="m" />
      ))}
      {Array.from({ length: Math.max(0, 3 - covers.length) }, (_, i) => (
        <span key={i} className="cover-strip-empty" aria-hidden>
          {i === 0 && count === 0 ? "Empty" : ""}
        </span>
      ))}
    </span>
  );
}

/** The large picture cards in the pinned row. */
export function PinnedCard({
  collection,
  selected,
  menu,
  onSelect,
  onOpen,
}: {
  collection: CollectionSummary;
  selected: boolean;
  menu: MenuEntry[];
  onSelect: () => void;
  onOpen: () => void;
}) {
  return (
    <li className={`pinned-card${selected ? " is-selected" : ""}`}>
      <button type="button" className="pinned-open" onClick={onSelect} onDoubleClick={onOpen} aria-pressed={selected}>
        <CollectionPicture collection={collection} />
        <span className="pinned-text">
          <span className="pinned-name">
            <Badge name={collection.badge} size={16} />
            {collection.name}
          </span>
          <span className="pinned-count">{bookCount(collection.count)}</span>
        </span>
      </button>
      <Menu label={`More for ${collection.name}`} trigger={<Icon name="more" />} items={menu} />
    </li>
  );
}

export function SmartCard({
  smart,
  selected,
  reorder,
  onSelect,
  onOpen,
}: {
  smart: SmartSummary;
  selected: boolean;
  reorder?: ReorderProps;
  onSelect: () => void;
  onOpen: () => void;
}) {
  const info = SMART_INFO[smart.kind];
  return (
    <li {...reorder}>
      <button
        type="button"
        className={`smart-card${selected ? " is-selected" : ""}`}
        onClick={onSelect}
        onDoubleClick={onOpen}
        aria-pressed={selected}
        title={info.description}
      >
        <Badge name={info.badge} size={20} />
        <span className="smart-text">
          <span className="smart-name">{info.name}</span>
          <span className="smart-count">{bookCount(smart.count)}</span>
        </span>
      </button>
    </li>
  );
}

export function CollectionCard({
  collection,
  layout,
  selected,
  menu,
  reorder,
  onSelect,
  onOpen,
}: {
  collection: CollectionSummary;
  layout: "grid" | "list";
  selected: boolean;
  reorder?: ReorderProps;
  menu: MenuEntry[];
  onSelect: () => void;
  onOpen: () => void;
}) {
  return (
    <li {...reorder} className={`collection-card collection-card-${layout}${selected ? " is-selected" : ""}`} data-tone={hashOf(collection.id) % 4}>
      <button type="button" className="collection-card-open" onClick={onSelect} onDoubleClick={onOpen} aria-pressed={selected}>
        <span className="collection-card-head">
          <span className="collection-card-name">
            <Badge name={collection.badge} size={16} />
            {collection.name}
          </span>
          <span className="collection-card-meta">
            {bookCount(collection.count)}
            {collection.kind === "reading_list" && <> · {KIND_LABEL.reading_list}</>}
          </span>
        </span>
        {layout === "grid" ? (
          pictureUrl(collection) ? (
            <CollectionPicture collection={collection} className="collection-card-picture" />
          ) : (
            <CoverStrip covers={collection.covers} count={collection.count} />
          )
        ) : (
          <span className="collection-card-desc">{collection.description}</span>
        )}
      </button>
      <Menu label={`More for ${collection.name}`} trigger={<Icon name="more" />} items={menu} />
    </li>
  );
}

export function SeriesCard({
  series,
  layout,
  selected,
  onSelect,
  onOpen,
}: {
  series: SeriesSummary;
  layout: "grid" | "list";
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
}) {
  return (
    <li className={`collection-card collection-card-${layout}${selected ? " is-selected" : ""}`} data-tone={hashOf(series.name) % 4}>
      <button type="button" className="collection-card-open" onClick={onSelect} onDoubleClick={onOpen} aria-pressed={selected}>
        <span className="collection-card-head">
          <span className="collection-card-name">
            <Badge name="scroll" size={16} />
            {series.name}
          </span>
          <span className="collection-card-meta">
            {bookCount(series.count)} · Series
          </span>
        </span>
        {layout === "grid" ? (
          <CoverStrip covers={series.covers} count={series.count} />
        ) : (
          <span className="collection-card-desc">{series.authors.join(", ")}</span>
        )}
      </button>
    </li>
  );
}

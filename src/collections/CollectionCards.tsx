import { useState } from "react";
import type { CollectionSummary, CoverRef, MissingCover, SeriesSummary, SmartSummary } from "../api/types";
import { BookCover } from "../components/BookCover";
import { Icon } from "../components/Icon";
import { Menu, type MenuEntry } from "../components/Menu";
import { Stars } from "../components/StarRating";
import { hashOf } from "../lib/format";
import { Badge } from "./badges";
import type { ReorderProps } from "./useReorder";
import { bookCount, KIND_LABEL, pictureUrl, SMART_INFO } from "./collectionInfo";
import type { GalleryShape } from "./gallery";

/** A collection's picture, or a quiet tone when it has none. */
export function CollectionPicture({
  collection,
  className = "",
  shape = "wide",
}: {
  collection: Pick<CollectionSummary, "id" | "picture" | "picturePath" | "covers">;
  className?: string;
  /** Which shape of gallery picture fits the space: banners take the wide one. */
  shape?: GalleryShape;
}) {
  const src = pictureUrl(collection, shape);
  return (
    <span className={`collection-picture ${className}`} data-tone={hashOf(collection.id) % 4}>
      {src ? (
        <img className={collection.picture?.startsWith("gallery:") ? undefined : "private-picture"} src={src} alt="" draggable={false} />
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

export function CoverStrip({ covers, count, missing = [] }: { covers: CoverRef[]; count: number; missing?: MissingCover[] }) {
  const lacking = missing.slice(0, Math.max(0, 3 - covers.length));
  return (
    <span className="cover-strip">
      {covers.map((c) => (
        <BookCover key={c.id} book={c} size="m" />
      ))}
      {lacking.map((m, i) => (
        <MissingStripCover key={`missing-${i}`} book={m} />
      ))}
      {Array.from({ length: Math.max(0, 3 - covers.length - lacking.length) }, (_, i) => (
        <span key={i} className="cover-strip-empty" aria-hidden>
          {i === 0 && count === 0 ? "Empty" : ""}
        </span>
      ))}
    </span>
  );
}

/** A book of the series the library lacks, greyed out as on the series' own page. */
function MissingStripCover({ book }: { book: MissingCover }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="cover cover-m missing-cover" title={`${book.title} (missing)`}>
      {book.coverUrl && !failed ? (
        <img className="private-picture" src={book.coverUrl} alt="" draggable={false} onError={() => setFailed(true)} />
      ) : (
        <span className="cover-generated missing-blank">
          <span className="cover-title">{book.title}</span>
        </span>
      )}
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
        <CollectionPicture collection={collection} shape="square" />
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
            {collection.rating !== null && <Stars value={collection.rating} size={11} label={`Average rating ${collection.rating.toFixed(1)} of 5`} />}
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
          <CoverStrip covers={series.covers} count={series.count} missing={series.missing} />
        ) : (
          <span className="collection-card-desc">{series.authors.join(", ")}</span>
        )}
      </button>
    </li>
  );
}

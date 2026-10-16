import { api } from "../api";
import type { CollectionPreview } from "../api/types";
import { hashOf } from "../lib/format";

export function CollectionsTab({
  collections,
  onOpenCollection,
}: {
  collections: CollectionPreview[] | null;
  onOpenCollection: (id: string) => void;
}) {
  if (collections === null) return <div className="library-loading" aria-busy="true" />;
  if (collections.length === 0)
    return (
      <div className="library-empty">
        <h2>No collections yet</h2>
        <p className="muted">
          Collections group books your way, like a reading list for winter. Make them on the Collections page, or from any book's … menu.
        </p>
      </div>
    );
  return (
    <ul className="tiles collection-grid">
      {collections.map((c) => (
        <li key={c.id}>
          <button type="button" className="tile" onClick={() => onOpenCollection(c.id)}>
            <span className={`tile-art tile-art-${Math.min(c.coverPaths.length, 4)}`} data-tone={hashOf(c.id) % 4}>
              {c.coverPaths.map((p) => (
                <img key={p} src={api.coverUrl(p)} alt="" draggable={false} />
              ))}
            </span>
            <span className="book-title">{c.name}</span>
            <span className="book-author">
              {c.count} {c.count === 1 ? "book" : "books"}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

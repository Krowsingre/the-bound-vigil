import { api } from "../api";
import type { CollectionPreview } from "../api/types";
import { hashOf } from "../lib/format";

export function CollectionsTab({ collections }: { collections: CollectionPreview[] | null }) {
  if (collections === null) return <div className="library-loading" aria-busy="true" />;
  if (collections.length === 0)
    return (
      <div className="library-empty">
        <h2>No collections yet</h2>
        <p className="muted">
          Collections group books your way, like “To read” or “Favourites”. Creating them arrives with the Collections page.
        </p>
      </div>
    );
  return (
    <ul className="tiles collection-grid">
      {collections.map((c) => (
        <li key={c.id}>
          <div className="tile">
            <span className={`tile-art tile-art-${Math.min(c.coverPaths.length, 4)}`} data-tone={hashOf(c.id) % 4}>
              {c.coverPaths.map((p) => (
                <img key={p} src={api.coverUrl(p)} alt="" draggable={false} />
              ))}
            </span>
            <span className="book-title">{c.name}</span>
            <span className="book-author">
              {c.count} {c.count === 1 ? "book" : "books"}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

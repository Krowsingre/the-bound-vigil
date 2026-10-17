import { api } from "../api";
import type { CollectionPreview } from "../api/types";
import { hashOf } from "../lib/format";
import { EmptyNote, Section } from "./Section";

export function CollectionsPreview({
  collections,
  onViewAll,
  onOpenCollection,
}: {
  collections: CollectionPreview[];
  onViewAll: () => void;
  onOpenCollection: (id: string) => void;
}) {
  return (
    <Section title="Collections" onViewAll={onViewAll} className="collections">
      {collections.length === 0 ? (
        <EmptyNote>Collections group books your way, like “To read” or “Favourites”. Make them on the Collections page, or from any book's … menu.</EmptyNote>
      ) : (
        <ul className="tiles">
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
      )}
    </Section>
  );
}

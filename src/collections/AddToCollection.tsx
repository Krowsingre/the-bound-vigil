import { useEffect, useState } from "react";
import { api } from "../api";
import type { BookPreview, CollectionSummary } from "../api/types";
import { useToast } from "../components/Toast";
import { Badge } from "./badges";
import { CollectionEditor } from "./CollectionEditor";
import { bookCount } from "./collectionInfo";

// Any book's "…" menu can ask for this dialog; the one host in App shows it.
let listener: ((book: BookPreview) => void) | null = null;

export function askAddToCollection(book: BookPreview) {
  listener?.(book);
}

/** Shows "Add to collection" whenever a book menu asks for it. */
export function AddToCollectionHost({ onChanged }: { onChanged: () => void }) {
  const [book, setBook] = useState<BookPreview | null>(null);
  useEffect(() => {
    listener = setBook;
    return () => {
      listener = null;
    };
  }, []);
  if (!book) return null;
  return (
    <AddToCollectionDialog
      key={book.id}
      book={book}
      onClose={(changed) => {
        setBook(null);
        if (changed) onChanged();
      }}
    />
  );
}

function AddToCollectionDialog({ book, onClose }: { book: BookPreview; onClose: (changed: boolean) => void }) {
  const [collections, setCollections] = useState<CollectionSummary[] | null>(null);
  const [member, setMember] = useState<Set<string>>(new Set());
  const [changed, setChanged] = useState(false);
  const [creating, setCreating] = useState(false);
  const toast = useToast();

  useEffect(() => {
    Promise.all([api.getCollectionsOverview(), api.collectionsForBook(book.id)]).then(
      ([overview, ids]) => {
        setCollections(overview.collections);
        setMember(new Set(ids));
      },
      (e: unknown) => {
        toast(`Your collections couldn't be loaded: ${String(e)}`);
        onClose(false);
      },
    );
    // Loaded once, when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = async (c: CollectionSummary) => {
    const inIt = member.has(c.id);
    try {
      if (inIt) await api.removeFromCollection(c.id, book.id);
      else await api.addToCollection(c.id, [book.id]);
      setMember((m) => {
        const next = new Set(m);
        if (inIt) next.delete(c.id);
        else next.add(c.id);
        return next;
      });
      setChanged(true);
    } catch (e) {
      toast(String(e));
    }
  };

  if (creating)
    return (
      <CollectionEditor
        books={[book]}
        addBookIds={[book.id]}
        onCancel={() => setCreating(false)}
        onSaved={(saved) => {
          toast(`Added “${book.title}” to ${saved.name}.`);
          onClose(true);
        }}
      />
    );

  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose(changed)}>
      <div className="dialog add-dialog" role="dialog" aria-label="Add to collection" onKeyDown={(e) => e.key === "Escape" && onClose(changed)}>
        <h2>Add to collection</h2>
        <p className="muted add-dialog-book">{book.title}</p>
        {collections === null ? (
          <div className="library-loading" aria-busy="true" />
        ) : collections.length === 0 ? (
          <p className="muted">You don't have any collections yet.</p>
        ) : (
          <ul className="add-list">
            {collections.map((c) => (
              <li key={c.id}>
                <label className="check-row">
                  <input type="checkbox" checked={member.has(c.id)} onChange={() => void toggle(c)} />
                  <Badge name={c.badge} size={16} />
                  <span className="add-name">{c.name}</span>
                  <span className="muted add-count">{bookCount(c.count)}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
        <div className="dialog-actions">
          <button type="button" className="btn btn-quiet" onClick={() => setCreating(true)}>
            New collection…
          </button>
          <button type="button" className="btn btn-primary" onClick={() => onClose(changed)}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

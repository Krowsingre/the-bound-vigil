import { useEffect, useState } from "react";
import { api } from "../api";
import type { BookPreview, CollectionSummary } from "../api/types";
import { useToast } from "../components/Toast";
import { Badge } from "./badges";
import { CollectionEditor } from "./CollectionEditor";
import { bookCount } from "./collectionInfo";

// Any book's "…" menu, or a choice of books, can ask for this dialog; the
// one host in App shows it.
let listener: ((books: BookPreview[]) => void) | null = null;

export function askAddToCollection(books: BookPreview | BookPreview[]) {
  listener?.(Array.isArray(books) ? books : [books]);
}

/** How many of the books each collection was checked for at once. */
const AT_ONCE = 20;

/** Shows "Add to collection" whenever a book menu asks for it. */
export function AddToCollectionHost({ onChanged }: { onChanged: () => void }) {
  const [books, setBooks] = useState<BookPreview[] | null>(null);
  useEffect(() => {
    listener = setBooks;
    return () => {
      listener = null;
    };
  }, []);
  if (!books?.length) return null;
  return (
    <AddToCollectionDialog
      key={books.map((b) => b.id).join()}
      books={books}
      onClose={(changed) => {
        setBooks(null);
        if (changed) onChanged();
      }}
    />
  );
}

/** For each collection, which of `books` are in it. */
async function membership(books: BookPreview[]): Promise<Map<string, Set<string>>> {
  const found = new Map<string, Set<string>>();
  for (let i = 0; i < books.length; i += AT_ONCE) {
    const part = books.slice(i, i + AT_ONCE);
    const lists = await Promise.all(part.map((b) => api.collectionsForBook(b.id)));
    lists.forEach((ids, j) => ids.forEach((id) => found.set(id, (found.get(id) ?? new Set()).add(part[j].id))));
  }
  return found;
}

function AddToCollectionDialog({ books, onClose }: { books: BookPreview[]; onClose: (changed: boolean) => void }) {
  const [collections, setCollections] = useState<CollectionSummary[] | null>(null);
  const [member, setMember] = useState<Map<string, Set<string>>>(new Map());
  const [changed, setChanged] = useState(false);
  const [creating, setCreating] = useState(false);
  const [working, setWorking] = useState<string | null>(null);
  const toast = useToast();
  const one = books.length === 1;
  const named = one ? `“${books[0].title}”` : `${books.length.toLocaleString()} books`;

  useEffect(() => {
    Promise.all([api.getCollectionsOverview(), membership(books)]).then(
      ([overview, found]) => {
        // A collection with rules fills itself, so it isn't offered here.
        setCollections(overview.collections.filter((c) => !c.rules));
        setMember(found);
      },
      (e: unknown) => {
        toast(`Your collections couldn't be loaded: ${String(e)}`);
        onClose(false);
      },
    );
    // Loaded once, when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Puts all the books in the collection, or takes them all out. */
  const change = async (c: CollectionSummary, add: boolean) => {
    const inIt = member.get(c.id) ?? new Set<string>();
    setWorking(c.id);
    try {
      if (add) await api.addToCollection(c.id, books.filter((b) => !inIt.has(b.id)).map((b) => b.id));
      else for (const b of books.filter((b) => inIt.has(b.id))) await api.removeFromCollection(c.id, b.id);
      setMember((m) => new Map(m).set(c.id, add ? new Set(books.map((b) => b.id)) : new Set()));
      setChanged(true);
      if (!one) toast(add ? `Added ${named} to ${c.name}.` : `Took ${named} out of ${c.name}.`);
    } catch (e) {
      toast(String(e));
    } finally {
      setWorking(null);
    }
  };

  if (creating)
    return (
      <CollectionEditor
        books={books.slice(0, 4)}
        addBookIds={books.map((b) => b.id)}
        onCancel={() => setCreating(false)}
        onSaved={(saved) => {
          toast(`Added ${named} to ${saved.name}.`);
          onClose(true);
        }}
      />
    );

  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose(changed)}>
      <div className="dialog add-dialog" role="dialog" aria-label="Add to collection" onKeyDown={(e) => e.key === "Escape" && onClose(changed)}>
        <h2>{one ? "Add to collection" : "Add to or take out of a collection"}</h2>
        <p className="muted add-dialog-book">{one ? books[0].title : `${named} chosen`}</p>
        {collections === null ? (
          <div className="library-loading" aria-busy="true" />
        ) : collections.length === 0 ? (
          <p className="muted">You don't have any collections yet.</p>
        ) : (
          <ul className="add-list">
            {collections.map((c) => {
              const has = member.get(c.id)?.size ?? 0;
              const all = has === books.length;
              return (
              <li key={c.id}>
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={all}
                    // Some of the chosen books are in it: neither ticked nor clear.
                    ref={(box) => {
                      if (box) box.indeterminate = has > 0 && !all;
                    }}
                    disabled={working !== null}
                    title={!one && has > 0 && !all ? `${has.toLocaleString()} of them are in it. Tick to add the rest.` : undefined}
                    onChange={() => void change(c, !all)}
                  />
                  <Badge name={c.badge} size={16} />
                  <span className="add-name">{c.name}</span>
                  <span className="muted add-count">
                    {!one && has > 0 && !all ? `${has.toLocaleString()} of these · ` : ""}
                    {bookCount(c.count)}
                  </span>
                </label>
              </li>
              );
            })}
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

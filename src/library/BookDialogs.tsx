// The dialogs any book's menu can ask for: editing its tags, and deleting it.
// The one host in App shows them, the way "Add to collection" works.

import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { BookPreview, TagCount } from "../api/types";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Icon } from "../components/Icon";
import { useToast } from "../components/Toast";
import { cleanTag } from "../lib/queryBooks";

type Ask = { kind: "tags"; book: BookPreview } | { kind: "delete"; book: BookPreview };

let listener: ((ask: Ask) => void) | null = null;

export function askEditTags(book: BookPreview) {
  listener?.({ kind: "tags", book });
}

export function askDeleteBook(book: BookPreview) {
  listener?.({ kind: "delete", book });
}

export function BookDialogsHost({ onChanged }: { onChanged: () => void }) {
  const [ask, setAsk] = useState<Ask | null>(null);
  const toast = useToast();
  useEffect(() => {
    listener = setAsk;
    return () => {
      listener = null;
    };
  }, []);
  if (!ask) return null;
  const close = (changed: boolean) => {
    setAsk(null);
    if (changed) onChanged();
  };
  if (ask.kind === "tags") return <TagEditor key={ask.book.id} book={ask.book} onClose={close} />;
  const { book } = ask;
  return (
    <ConfirmDialog
      title={`Delete “${book.title}”?`}
      body={
        "This takes the book out of your library on every device, with its highlights and notes. " +
        "Book files you imported from a folder of your own stay where they are."
      }
      confirm="Delete book"
      danger
      onCancel={() => close(false)}
      onConfirm={() =>
        void api.deleteBook(book.id).then(
          () => {
            toast(`Deleted “${book.title}”.`);
            close(true);
          },
          (e: unknown) => {
            toast(`Couldn't delete “${book.title}”: ${String(e)}`);
            close(false);
          },
        )
      }
    />
  );
}

function TagEditor({ book, onClose }: { book: BookPreview; onClose: (changed: boolean) => void }) {
  const toast = useToast();
  const [tags, setTags] = useState<string[]>(book.tags);
  const [all, setAll] = useState<TagCount[]>([]);
  const [typed, setTyped] = useState("");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void api.allTags().then(setAll, () => undefined);
    input.current?.focus();
  }, []);

  const has = (t: string) => tags.some((x) => x.toLowerCase() === t.toLowerCase());
  const add = (t: string) => {
    const clean = cleanTag(t);
    if (!clean || has(clean) || tags.length >= 50) return;
    // An existing tag keeps the spelling it already has.
    const kept = all.find((x) => x.name.toLowerCase() === clean.toLowerCase())?.name ?? clean;
    setTags([...tags, kept]);
    setTyped("");
  };
  const remove = (t: string) => setTags(tags.filter((x) => x !== t));
  const q = typed.trim().toLowerCase();
  const suggestions = all.filter((t) => !has(t.name) && (!q || t.name.toLowerCase().includes(q))).slice(0, 12);

  const save = () => {
    const final = typed.trim() && !has(typed.trim()) ? [...tags, typed.trim()] : tags;
    api.setBookTags(book.id, final).then(
      () => onClose(true),
      (e: unknown) => toast(`Couldn't save the tags: ${String(e)}`),
    );
  };

  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose(false)}>
      <div className="dialog tag-dialog" role="dialog" aria-label="Tags" onKeyDown={(e) => e.key === "Escape" && onClose(false)}>
        <h2>Tags</h2>
        <p className="muted add-dialog-book">{book.title}</p>
        <div className="tag-field" onClick={() => input.current?.focus()}>
          {tags.map((t) => (
            <span key={t} className="tag-chip">
              {t}
              <button type="button" aria-label={`Remove ${t}`} onClick={() => remove(t)}>
                <Icon name="close" size={12} />
              </button>
            </span>
          ))}
          <input
            ref={input}
            value={typed}
            maxLength={40}
            placeholder={tags.length ? "Add another" : "Type a tag and press Enter"}
            aria-label="New tag"
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                if (typed.trim()) add(typed);
                else if (e.key === "Enter") save();
              } else if (e.key === "Backspace" && !typed && tags.length) {
                setTags(tags.slice(0, -1));
              }
            }}
          />
        </div>
        {suggestions.length > 0 && (
          <div className="tag-suggestions">
            <span className="muted">Your tags</span>
            {suggestions.map((t) => (
              <button key={t.name} type="button" className="tag-chip tag-chip-add" onClick={() => add(t.name)}>
                <Icon name="plus" size={12} /> {t.name}
              </button>
            ))}
          </div>
        )}
        <div className="dialog-actions">
          <button type="button" className="btn btn-quiet" onClick={() => onClose(false)}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={save}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

/** Adds one tag to many books, keeping the tags they already have. */
export function AddTagToMany({ books, onClose }: { books: BookPreview[]; onClose: (changed: boolean) => void }) {
  const toast = useToast();
  const [typed, setTyped] = useState("");
  const [all, setAll] = useState<TagCount[]>([]);
  const [saving, setSaving] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    void api.allTags().then(setAll, () => undefined);
    input.current?.focus();
  }, []);

  const save = async (text: string) => {
    const clean = cleanTag(text);
    if (!clean) return;
    const tag = all.find((t) => t.name.toLowerCase() === clean.toLowerCase())?.name ?? clean;
    setSaving(true);
    let done = 0;
    for (const book of books) {
      if (book.tags.some((t) => t.toLowerCase() === tag.toLowerCase())) continue;
      try {
        await api.setBookTags(book.id, [...book.tags, tag]);
        done += 1;
      } catch (e) {
        toast(`Couldn't tag “${book.title}”: ${String(e)}`);
      }
    }
    toast(done ? `Tagged ${done} ${done === 1 ? "book" : "books"} “${tag}”.` : `Those books were already tagged “${tag}”.`);
    onClose(done > 0);
  };
  const q = typed.trim().toLowerCase();
  const suggestions = all.filter((t) => !q || t.name.toLowerCase().includes(q)).slice(0, 12);

  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose(false)}>
      <div className="dialog tag-dialog" role="dialog" aria-label="Add a tag" onKeyDown={(e) => e.key === "Escape" && onClose(false)}>
        <h2>Add a tag</h2>
        <p className="muted add-dialog-book">
          To {books.length} {books.length === 1 ? "book" : "books"}. Tags they already have stay.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save(typed);
          }}
        >
          <div className="tag-field">
            <input
              ref={input}
              value={typed}
              maxLength={40}
              placeholder="Type a tag"
              aria-label="Tag"
              onChange={(e) => setTyped(e.target.value)}
            />
          </div>
        </form>
        {suggestions.length > 0 && (
          <div className="tag-suggestions">
            <span className="muted">Your tags</span>
            {suggestions.map((t) => (
              <button key={t.name} type="button" className="tag-chip tag-chip-add" disabled={saving} onClick={() => void save(t.name)}>
                <Icon name="plus" size={12} /> {t.name}
              </button>
            ))}
          </div>
        )}
        <div className="dialog-actions">
          <button type="button" className="btn btn-quiet" onClick={() => onClose(false)}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={saving || !typed.trim()} onClick={() => void save(typed)}>
            Add tag
          </button>
        </div>
      </div>
    </div>
  );
}

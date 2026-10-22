// The dialogs any book's menu can ask for: editing its tags, and deleting it.
// The one host in App shows them, the way "Add to collection" works.

import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { BookPreview, TagCount } from "../api/types";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Icon } from "../components/Icon";
import { useToast } from "../components/Toast";
import { cleanTag } from "../lib/queryBooks";
import { AddOrReplace, joined, type ListMode } from "../components/AddOrReplace";

type Ask = { kind: "tags"; book: BookPreview } | { kind: "delete"; book: BookPreview } | { kind: "remove"; book: BookPreview };

let listener: ((ask: Ask) => void) | null = null;

export function askEditTags(book: BookPreview) {
  listener?.({ kind: "tags", book });
}

export function askDeleteBook(book: BookPreview) {
  listener?.({ kind: "delete", book });
}

export function askRemoveBook(book: BookPreview) {
  listener?.({ kind: "remove", book });
}

/** What the warnings say, for one book or many. */
export const removeWarning = (many = false) =>
  many
    ? "This takes them out of your library on every device. Their highlights, notes, tags and collections are kept, along with their files in the cloud, so importing the same books again brings it all back."
    : "This takes it out of your library on every device. Its highlights, notes, tags and collections are kept, along with its file in the cloud, so importing the same book again brings it all back.";
export const deleteWarning = (many = false) =>
  `This deletes ${many ? "them" : "it"} for good on every device: ${many ? "their" : "its"} highlights and notes go too, and ${many ? "their files and covers are" : "its file and cover are"} erased from your cloud storage at the next sync. This can't be undone. Book files you imported from a folder of your own stay where they are.`;

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
  if (ask.kind === "tags") return <TagsDialog key={ask.book.id} books={[ask.book]} onClose={close} />;
  const { book } = ask;
  const removing = ask.kind === "remove";
  return (
    <ConfirmDialog
      title={removing ? `Remove “${book.title}” from your library?` : `Delete “${book.title}” for good?`}
      body={removing ? removeWarning() : deleteWarning()}
      confirm={removing ? "Remove from library" : "Delete for good"}
      danger
      onCancel={() => close(false)}
      onConfirm={() =>
        void (removing ? api.removeFromLibrary(book.id) : api.deleteBook(book.id)).then(
          () => {
            toast(removing ? `Removed “${book.title}” from your library.` : `Deleted “${book.title}”.`);
            close(true);
          },
          (e: unknown) => {
            toast(`Couldn't ${removing ? "remove" : "delete"} “${book.title}”: ${String(e)}`);
            close(false);
          },
        )
      }
    />
  );
}

/**
 * Tags for one book or many. "Add to them" puts the tags here beside the ones
 * each book has; "Replace them" makes these its only tags. With one book,
 * Replace starts from the tags it has, so any can be taken off.
 */
export function TagsDialog({ books, onClose }: { books: BookPreview[]; onClose: (changed: boolean) => void }) {
  const toast = useToast();
  const many = books.length > 1;
  const [mode, setMode] = useState<ListMode>(many ? "add" : "replace");
  const [tags, setTags] = useState<string[]>(many ? [] : books[0].tags);
  const [all, setAll] = useState<TagCount[]>([]);
  const [typed, setTyped] = useState("");
  const [saving, setSaving] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void api.allTags().then(setAll, () => undefined);
    input.current?.focus();
  }, []);

  const choose = (m: ListMode) => {
    if (m === mode) return;
    setMode(m);
    // One book: Replace shows its tags to change, Add starts empty.
    if (!many) setTags(m === "replace" ? joined(books[0].tags, tags) : tags.filter((t) => !books[0].tags.includes(t)));
  };
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

  const save = async () => {
    const clean = cleanTag(typed);
    const final = clean && !has(clean) ? [...tags, all.find((x) => x.name.toLowerCase() === clean.toLowerCase())?.name ?? clean] : tags;
    if (mode === "add" && !final.length) return onClose(false);
    setSaving(true);
    let changed = 0;
    for (const book of books) {
      const next = mode === "add" ? joined(book.tags, final) : final;
      if (next.length === book.tags.length && next.every((t, i) => t === book.tags[i])) continue;
      try {
        await api.setBookTags(book.id, next);
        changed += 1;
      } catch (e) {
        toast(`Couldn't change the tags of “${book.title}”: ${String(e)}`);
      }
    }
    if (many) toast(changed ? `Changed the tags of ${changed} ${changed === 1 ? "book" : "books"}.` : "Those books already had those tags.");
    onClose(changed > 0);
  };

  const note = many
    ? mode === "add"
      ? `${books.length} books. These join the tags each one has.`
      : `${books.length} books. Each one's tags become just these; leave it empty to take every tag off.`
    : mode === "add"
      ? books[0].tags.length
        ? `${books[0].title}. These join the tags it has: ${books[0].tags.join(", ")}.`
        : `${books[0].title}. It has no tags yet.`
      : books[0].title;

  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose(false)}>
      <div className="dialog tag-dialog" role="dialog" aria-label="Tags" onKeyDown={(e) => e.key === "Escape" && onClose(false)}>
        <h2>{many ? `Tags for ${books.length} books` : "Tags"}</h2>
        <AddOrReplace mode={mode} onChange={choose} label="Add to their tags or replace them" />
        <p className="muted add-dialog-book">{note}</p>
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
                else if (e.key === "Enter") void save();
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
          <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void save()}>
            {mode === "add" ? "Add tags" : "Replace tags"}
          </button>
        </div>
      </div>
    </div>
  );
}

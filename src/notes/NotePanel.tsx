import { useEffect, useRef, useState } from "react";
import type { NoteItem } from "../api/types";
import { Icon } from "../components/Icon";
import { Menu, type MenuEntry } from "../components/Menu";
import { authorLine, relativeTime } from "../lib/format";
import { highlightHex } from "../reader/settings";
import { personalTitle, placeLine } from "./noteInfo";
import { KindChip, NoteArt } from "./NoteViews";

/** The selected note in full, with your words editable in place. */
export function NotePanel({
  note,
  related,
  menu,
  onSave,
  onOpenInReader,
  onSelect,
  onViewAllForBook,
}: {
  note: NoteItem;
  /** Other notes from the same book. */
  related: NoteItem[];
  menu: MenuEntry[];
  onSave: (note: NoteItem, words: string, title: string | null) => Promise<void>;
  onOpenInReader: (note: NoteItem) => void;
  onSelect: (note: NoteItem) => void;
  onViewAllForBook: (bookId: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [words, setWords] = useState(note.note ?? "");
  const [title, setTitle] = useState(note.title ?? "");
  const [busy, setBusy] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setEditing(false);
    setWords(note.note ?? "");
    setTitle(note.title ?? "");
  }, [note.id, note.note, note.title]);

  useEffect(() => {
    if (editing) area.current?.focus();
  }, [editing]);

  const save = async () => {
    setBusy(true);
    try {
      await onSave(note, words, note.kind === "personal" ? title : null);
      setEditing(false);
    } finally {
      setBusy(false);
    }
  };

  const personal = note.kind === "personal";
  const place = placeLine(note);
  const wordsLabel = personal ? "Note" : note.kind === "book_note" ? "About this book" : "My notes";

  return (
    <aside className="note-panel" aria-label="Selected note">
      <div className="note-panel-head">
        <NoteArt note={note} size="m" />
        <div className="note-panel-book">
          <h2>{note.book ? note.book.title : personalTitle(note)}</h2>
          {note.book && <p className="muted">{authorLine(note.book.authors)}</p>}
          <KindChip note={note} />
          <p className="note-panel-place">
            {[place, relativeTime(note.createdAt)].filter(Boolean).join(" · ")}
          </p>
        </div>
        {menu.length > 0 && <Menu label="More for this note" trigger={<Icon name="more" />} items={menu} />}
      </div>

      {note.excerpt && (
        <blockquote className="note-panel-quote" style={{ ["--hl" as string]: highlightHex(note.color) }}>
          “{note.excerpt}”
        </blockquote>
      )}

      <section className="note-panel-words">
        <div className="note-panel-label">
          <h3>{wordsLabel}</h3>
          {!editing && (
            <button type="button" className="link-btn" onClick={() => setEditing(true)}>
              <Icon name="edit" size={14} /> {note.note ? "Edit" : "Add your thoughts"}
            </button>
          )}
        </div>
        {editing ? (
          <form
            className="note-edit"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setEditing(false);
                setWords(note.note ?? "");
                setTitle(note.title ?? "");
              }
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void save();
            }}
          >
            {personal && <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (optional)" maxLength={120} />}
            <textarea ref={area} value={words} onChange={(e) => setWords(e.target.value)} rows={7} placeholder="Your thoughts…" />
            <div className="dialog-actions">
              <button type="button" className="btn btn-quiet" onClick={() => setEditing(false)} disabled={busy}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={busy}>
                Save
              </button>
            </div>
          </form>
        ) : note.note ? (
          <div className="note-panel-text">
            {note.note.split(/\n{2,}/).map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
        ) : (
          <p className="muted note-panel-empty">Nothing written yet.</p>
        )}
      </section>

      {note.book && (
        <button type="button" className="btn btn-primary note-open" onClick={() => onOpenInReader(note)}>
          {note.locator?.cfi ? "Open in Reader" : "Open the book"} <Icon name="arrowRight" size={16} />
        </button>
      )}

      {note.book && related.length > 0 && (
        <section className="note-related">
          <div className="note-panel-label">
            <h3>Related notes</h3>
            <button type="button" className="link-btn" onClick={() => onViewAllForBook(note.book!.id)}>
              View all <Icon name="arrowRight" size={14} />
            </button>
          </div>
          <ul>
            {related.slice(0, 3).map((r) => (
              <li key={r.id}>
                <button type="button" className="note-related-item" onClick={() => onSelect(r)}>
                  <span className="note-related-head">
                    <KindChip note={r} />
                    <span className="muted">{placeLine(r)}</span>
                  </span>
                  <span className="note-related-words">{r.kind === "highlight" ? `“${r.excerpt}”` : r.note}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  );
}

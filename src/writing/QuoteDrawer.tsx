// The Notes drawer beside a chapter. "This book" holds the notes that belong
// to the book being written (research and plans, kept out of the finished
// book), with a quick way to write one. "Everything" is all your highlights
// and notes, searchable. Choosing one puts it in where you're writing, as a
// quote with its book.

import { useEffect, useState } from "react";
import { api } from "../api";
import type { NoteItem } from "../api/types";
import { Icon } from "../components/Icon";
import { useToast } from "../components/Toast";
import { noteHeadline, personalTitle } from "../notes/noteInfo";
import { sourceLine } from "./fromNotes";

type Showing = "book" | "all";

export function QuoteDrawer({
  refreshKey,
  projectId,
  onInsert,
  onClose,
}: {
  refreshKey: number;
  /** The book being written, whose own notes "This book" lists. */
  projectId: string;
  onInsert: (note: NoteItem) => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const [showing, setShowing] = useState<Showing>("book");
  const [search, setSearch] = useState("");
  const [notes, setNotes] = useState<NoteItem[] | null>(null);
  const [writing, setWriting] = useState<{ title: string; body: string } | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let current = true;
    setNotes(null);
    const wait = setTimeout(() => {
      api
        .getNotes({
          tab: showing === "book" ? "personal" : "all",
          sort: "recent",
          search: search.trim() || null,
          bookId: null,
          colors: [],
          projectId: showing === "book" ? projectId : null,
        })
        .then(
          (p) => current && setNotes(p.notes),
          () => current && setNotes([]),
        );
    }, 200);
    return () => {
      current = false;
      clearTimeout(wait);
    };
  }, [search, refreshKey, showing, projectId, reload]);

  const save = async () => {
    if (!writing) return;
    try {
      const note = await api.savePersonalNote(null, writing.title.trim() || null, writing.body);
      await api.setNoteProject(note.id, projectId);
      setWriting(null);
      setReload((n) => n + 1);
    } catch (e) {
      toast(`Couldn't save the note: ${String(e)}`);
    }
  };

  const untie = async (n: NoteItem) => {
    try {
      await api.setNoteProject(n.id, null);
      setReload((r) => r + 1);
      toast("It's a note of its own again, in Scribe › Personal notes.");
    } catch (e) {
      toast(String(e));
    }
  };

  return (
    <aside className="quote-drawer" aria-label="Notes">
      <div className="quote-drawer-head">
        <strong>Notes</strong>
        <button type="button" className="toolbar-button" aria-label="Close the notes" onClick={onClose}>
          <Icon name="close" size={16} />
        </button>
      </div>
      <div className="segmented quote-drawer-switch" role="radiogroup" aria-label="Which notes">
        {(
          [
            ["book", "This book"],
            ["all", "Everything"],
          ] as const
        ).map(([value, label]) => (
          <button key={value} type="button" role="radio" aria-checked={showing === value} className={showing === value ? "is-active" : undefined} onClick={() => setShowing(value)}>
            {label}
          </button>
        ))}
      </div>
      <input
        className="quote-drawer-search"
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={showing === "book" ? "Search this book's notes" : "Search notes and highlights"}
        aria-label={showing === "book" ? "Search this book's notes" : "Search notes and highlights"}
      />
      {showing === "book" &&
        (writing ? (
          <div className="quote-drawer-new">
            <input value={writing.title} onChange={(e) => setWriting({ ...writing, title: e.target.value })} placeholder="Title (optional)" aria-label="Title" />
            <textarea value={writing.body} onChange={(e) => setWriting({ ...writing, body: e.target.value })} placeholder="Research, plans, ideas…" aria-label="Note" rows={4} autoFocus />
            <div className="quote-drawer-new-actions">
              <button type="button" className="btn btn-quiet" onClick={() => setWriting(null)}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" disabled={!writing.title.trim() && !writing.body.trim()} onClick={() => void save()}>
                Save
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="btn btn-quiet quote-drawer-add" onClick={() => setWriting({ title: "", body: "" })}>
            <Icon name="plus" size={15} /> Write a note for this book
          </button>
        ))}
      <p className="muted quote-drawer-hint">
        {showing === "book" ? "Kept with this book, never in it. Choose one to put it in where you're writing." : "Choose one to put it in where you're writing."}
      </p>
      {notes === null ? (
        <div className="library-loading" aria-busy="true" aria-label="Loading the notes" />
      ) : notes.length === 0 ? (
        <p className="muted">
          {search.trim()
            ? "No notes match."
            : showing === "book"
              ? "No notes for this book yet. Write one above, or give a note to this book from its menu in Scribe › Personal notes."
              : "Highlights and notes from your reading show up here."}
        </p>
      ) : (
        <ul className="quote-drawer-list">
          {notes.map((n) => {
            const { quote, text } = noteHeadline(n);
            return (
              <li key={n.id}>
                <button type="button" onClick={() => onInsert(n)}>
                  {quote && <span className="quote-drawer-quote">“{quote}”</span>}
                  {text && <span className="quote-drawer-text">{text}</span>}
                  <span className="muted quote-drawer-source">{sourceLine(n) ?? personalTitle(n)}</span>
                </button>
                {showing === "book" && (
                  <button type="button" className="toolbar-button quote-drawer-untie" aria-label="Take it off this book" title="Take it off this book" onClick={() => void untie(n)}>
                    <Icon name="close" size={14} />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}

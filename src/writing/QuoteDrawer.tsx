// The Notes drawer beside a chapter: your highlights and notes, searchable.
// Choosing one puts it in where you're writing, as a quote with its book.

import { useEffect, useState } from "react";
import { api } from "../api";
import type { NoteItem } from "../api/types";
import { Icon } from "../components/Icon";
import { noteHeadline, personalTitle } from "../notes/noteInfo";
import { sourceLine } from "./fromNotes";

export function QuoteDrawer({ refreshKey, onInsert, onClose }: { refreshKey: number; onInsert: (note: NoteItem) => void; onClose: () => void }) {
  const [search, setSearch] = useState("");
  const [notes, setNotes] = useState<NoteItem[] | null>(null);

  useEffect(() => {
    let current = true;
    const wait = setTimeout(() => {
      api.getNotes({ tab: "all", sort: "recent", search: search.trim() || null, bookId: null, colors: [] }).then(
        (p) => current && setNotes(p.notes),
        () => current && setNotes([]),
      );
    }, 200);
    return () => {
      current = false;
      clearTimeout(wait);
    };
  }, [search, refreshKey]);

  return (
    <aside className="quote-drawer" aria-label="Your notes">
      <div className="quote-drawer-head">
        <strong>Your notes</strong>
        <button type="button" className="toolbar-button" aria-label="Close your notes" onClick={onClose}>
          <Icon name="close" size={16} />
        </button>
      </div>
      <input className="quote-drawer-search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search notes and highlights" aria-label="Search notes and highlights" />
      <p className="muted quote-drawer-hint">Choose one to put it in where you're writing.</p>
      {notes === null ? (
        <div className="library-loading" aria-busy="true" aria-label="Loading your notes" />
      ) : notes.length === 0 ? (
        <p className="muted">{search.trim() ? "No notes match." : "Highlights and notes from your reading show up here."}</p>
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
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}

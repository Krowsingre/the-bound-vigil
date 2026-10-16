import type { NoteItem } from "../api/types";
import { BookCover } from "../components/BookCover";
import { Icon } from "../components/Icon";
import { Menu, type MenuEntry } from "../components/Menu";
import { authorLine, relativeTime } from "../lib/format";
import { highlightHex } from "../reader/settings";
import { KIND_LABEL, noteHeadline, personalTitle, placeLine } from "./noteInfo";

export type NotesLayout = "cards" | "list" | "compact";

type Props = {
  notes: NoteItem[];
  selectedId: string | null;
  menuFor: (n: NoteItem) => MenuEntry[];
  onSelect: (n: NoteItem) => void;
  onOpen: (n: NoteItem) => void;
};

export function KindChip({ note }: { note: NoteItem }) {
  return <span className={`kind-chip kind-${note.kind}`}>{KIND_LABEL[note.kind]}</span>;
}

/** A book's cover, or a plain page for a personal note. */
export function NoteArt({ note, size }: { note: NoteItem; size: "s" | "m" }) {
  if (note.book) return <BookCover book={note.book} size={size} />;
  return (
    <span className={`cover cover-${size} note-art-personal`} aria-hidden>
      <Icon name="notes" size={size === "s" ? 16 : 26} />
    </span>
  );
}

function NoteTitle({ note }: { note: NoteItem }) {
  return <>{note.book ? note.book.title : personalTitle(note)}</>;
}

function Words({ note, lines }: { note: NoteItem; lines: number }) {
  const { quote, text } = noteHeadline(note);
  return (
    <span className="note-words" style={{ ["--lines" as string]: lines }}>
      {quote && (
        <span className="note-quote" style={note.color ? { ["--hl" as string]: highlightHex(note.color) } : undefined}>
          “{quote}”
        </span>
      )}
      {text && <span className="note-body">{text}</span>}
    </span>
  );
}

function More({ note, items }: { note: NoteItem; items: MenuEntry[] }) {
  return <Menu label={`More for this ${KIND_LABEL[note.kind].toLowerCase()}`} trigger={<Icon name="more" />} items={items} />;
}

export function NoteList({ notes, selectedId, menuFor, onSelect, onOpen }: Props) {
  return (
    <ul className="note-rows">
      {notes.map((n) => (
        <li key={n.id} className={`note-row${n.id === selectedId ? " is-selected" : ""}`}>
          <button type="button" className="note-row-open" onClick={() => onSelect(n)} onDoubleClick={() => onOpen(n)} aria-pressed={n.id === selectedId}>
            <NoteArt note={n} size="s" />
            <span className="note-row-text">
              <span className="note-row-head">
                <span className="note-row-title">
                  <NoteTitle note={n} />
                </span>
                <span className="note-row-place">{placeLine(n)}</span>
              </span>
              <span className="note-row-sub">
                {n.book && <span className="note-row-author">{authorLine(n.book.authors)}</span>}
                <span className="note-row-when">{relativeTime(n.createdAt)}</span>
              </span>
              <KindChip note={n} />
              <Words note={n} lines={2} />
            </span>
          </button>
          <More note={n} items={menuFor(n)} />
        </li>
      ))}
    </ul>
  );
}

export function NoteCards({ notes, selectedId, menuFor, onSelect, onOpen }: Props) {
  return (
    <ul className="note-cards">
      {notes.map((n) => (
        <li key={n.id} className={`note-card${n.id === selectedId ? " is-selected" : ""}`}>
          <button type="button" className="note-card-open" onClick={() => onSelect(n)} onDoubleClick={() => onOpen(n)} aria-pressed={n.id === selectedId}>
            <span className="note-card-head">
              <KindChip note={n} />
              <span className="note-row-when">{relativeTime(n.createdAt)}</span>
            </span>
            <Words note={n} lines={5} />
            <span className="note-card-foot">
              <NoteArt note={n} size="s" />
              <span className="note-card-book">
                <span className="note-row-title">
                  <NoteTitle note={n} />
                </span>
                <span className="note-row-place">{placeLine(n) || (n.book ? authorLine(n.book.authors) : "")}</span>
              </span>
            </span>
          </button>
          <More note={n} items={menuFor(n)} />
        </li>
      ))}
    </ul>
  );
}

export function NoteTable({ notes, selectedId, menuFor, onSelect, onOpen }: Props) {
  return (
    <table className="book-table note-table">
      <thead>
        <tr>
          <th>Note</th>
          <th>Type</th>
          <th>Book</th>
          <th>Where</th>
          <th>Added</th>
          <th aria-label="Actions" />
        </tr>
      </thead>
      <tbody>
        {notes.map((n) => {
          const { quote, text } = noteHeadline(n);
          return (
            <tr
              key={n.id}
              className={n.id === selectedId ? "is-selected" : undefined}
              onClick={() => onSelect(n)}
              onDoubleClick={() => onOpen(n)}
              aria-selected={n.id === selectedId}
            >
              <td className="note-table-words">
                {n.color && <span className="note-dot" style={{ background: highlightHex(n.color) }} aria-hidden />}
                {n.kind === "personal" ? personalTitle(n) : (text ?? `“${quote}”`)}
              </td>
              <td>
                <KindChip note={n} />
              </td>
              <td className="muted">{n.book?.title ?? "—"}</td>
              <td className="muted">{placeLine(n) || "—"}</td>
              <td className="muted">{relativeTime(n.createdAt)}</td>
              <td onClick={(e) => e.stopPropagation()}>
                <More note={n} items={menuFor(n)} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

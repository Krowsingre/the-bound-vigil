import type { NoteItem } from "../api/types";
import { BookCover } from "../components/BookCover";
import { Icon, type IconName } from "../components/Icon";
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
  /** While choosing several: the ones chosen. A click then chooses instead of opening. */
  chosen?: Set<string> | null;
};

const KIND_ICON: Record<NoteItem["kind"], IconName> = {
  highlight: "highlight",
  annotation: "notePen",
  book_note: "bookOpen",
  personal: "noteLines",
};

/** The thin strip down a card's side: a highlight's own colour, or the kind's. */
function stripOf(n: NoteItem): string {
  if (n.color) return highlightHex(n.color);
  return n.kind === "book_note" ? "#6f9a6a" : n.kind === "personal" ? "#d26a5c" : "var(--accent)";
}

/** "Oct 28, 2026". */
export function noteDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** What a card is called: the book it's from, or a personal note's title. */
export function cardTitle(n: NoteItem): string {
  return n.book ? n.book.title : personalTitle(n);
}

export function Tags({ tags, most = 2 }: { tags: string[] | undefined; most?: number }) {
  if (!tags?.length) return null;
  return (
    <span className="note-tags">
      {tags.slice(0, most).map((t) => (
        <span key={t} className="note-tag">
          {t}
        </span>
      ))}
      {tags.length > most && <span className="note-tag">+{tags.length - most}</span>}
    </span>
  );
}

function Chosen({ on }: { on: boolean }) {
  return (
    <span className={`note-choose${on ? " is-on" : ""}`} aria-hidden>
      {on && <Icon name="check" size={13} />}
    </span>
  );
}

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
  return <Menu label={`More for this ${KIND_LABEL[note.kind].toLowerCase()}`} trigger={<Icon name="moreVertical" />} items={items} />;
}

export function NoteList({ notes, selectedId, menuFor, onSelect, onOpen, chosen }: Props) {
  return (
    <ul className="note-rows">
      {notes.map((n) => (
        <li key={n.id} className={`note-row${n.id === selectedId ? " is-selected" : ""}${chosen?.has(n.id) ? " is-chosen" : ""}`} style={{ ["--strip" as string]: stripOf(n) }}>
          {chosen && <Chosen on={chosen.has(n.id)} />}
          <button type="button" className="note-row-open" onClick={() => onSelect(n)} onDoubleClick={() => !chosen && onOpen(n)} aria-pressed={chosen ? chosen.has(n.id) : n.id === selectedId}>
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
              <Tags tags={n.tags} most={4} />
            </span>
          </button>
          {n.pinnedAt && <Icon name="pin" size={15} className="note-row-pin" />}
          {!chosen && <More note={n} items={menuFor(n)} />}
        </li>
      ))}
    </ul>
  );
}

export function NoteCards({ notes, selectedId, menuFor, onSelect, onOpen, chosen }: Props) {
  return (
    <ul className="note-cards">
      {notes.map((n) => {
        const on = !!chosen?.has(n.id);
        return (
          <li
            key={n.id}
            className={`note-card${n.id === selectedId ? " is-selected" : ""}${on ? " is-chosen" : ""}`}
            style={{ ["--strip" as string]: stripOf(n) }}
          >
            <button
              type="button"
              className="note-card-open"
              onClick={() => onSelect(n)}
              onDoubleClick={() => !chosen && onOpen(n)}
              aria-pressed={chosen ? on : n.id === selectedId}
            >
              <span className="note-card-icon" aria-hidden>
                <Icon name={KIND_ICON[n.kind]} size={22} />
              </span>
              <span className="note-card-main">
                <span className="note-card-title">{cardTitle(n)}</span>
                <Words note={n} lines={3} />
                <Tags tags={n.tags} />
                <span className="note-card-date">{noteDate(n.updatedAt)}</span>
              </span>
              {n.book && (
                <span className="note-card-thumb">
                  <BookCover book={n.book} size="s" />
                </span>
              )}
            </button>
            <span className="note-card-corner">
              {chosen ? (
                <Chosen on={on} />
              ) : (
                <>
                  {n.pinnedAt && <Icon name="pin" size={15} className="note-card-pin" />}
                  <More note={n} items={menuFor(n)} />
                </>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function NoteTable({ notes, selectedId, menuFor, onSelect, onOpen, chosen }: Props) {
  return (
    <table className="book-table note-table">
      <thead>
        <tr>
          <th>Note</th>
          <th>Type</th>
          <th>Book</th>
          <th>Tags</th>
          <th>Changed</th>
          <th aria-label="Actions" />
        </tr>
      </thead>
      <tbody>
        {notes.map((n) => {
          const { quote, text } = noteHeadline(n);
          return (
            <tr
              key={n.id}
              className={chosen?.has(n.id) || n.id === selectedId ? "is-selected" : undefined}
              onClick={() => onSelect(n)}
              onDoubleClick={() => !chosen && onOpen(n)}
              aria-selected={chosen ? chosen.has(n.id) : n.id === selectedId}
            >
              <td className="note-table-words">
                {chosen && <Chosen on={chosen.has(n.id)} />}
                {n.pinnedAt && <Icon name="pin" size={13} className="note-row-pin" />}
                {n.color && <span className="note-dot" style={{ background: highlightHex(n.color) }} aria-hidden />}
                {n.kind === "personal" ? personalTitle(n) : (text ?? `“${quote}”`)}
              </td>
              <td>
                <KindChip note={n} />
              </td>
              <td className="muted">{n.book?.title ?? "—"}</td>
              <td className="muted">{n.tags?.length ? n.tags.join(", ") : "—"}</td>
              <td className="muted">{noteDate(n.updatedAt)}</td>
              <td onClick={(e) => e.stopPropagation()}>{!chosen && <More note={n} items={menuFor(n)} />}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

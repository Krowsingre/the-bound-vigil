import type { AnnotationPreview } from "../api/types";
import { relativeTime } from "../lib/format";
import { EmptyNote, Section } from "./Section";

export function NotesPreview({ notes, onViewAll }: { notes: AnnotationPreview[]; onViewAll: () => void }) {
  return (
    <Section title="Recent notes & highlights" onViewAll={onViewAll} className="notes">
      {notes.length === 0 ? (
        <EmptyNote>Highlights and notes you make while reading will gather here.</EmptyNote>
      ) : (
        <ul className="note-list">
          {notes.map((n) => (
            <li key={n.id} className="note-item">
              <button type="button" onClick={onViewAll} title={n.excerpt}>
                <span className="note-excerpt">“{n.excerpt}”</span>
                {n.note && <span className="note-text">{n.note}</span>}
                <span className="note-meta">
                  <span>{n.bookTitle}</span>
                  <span>{relativeTime(n.updatedAt)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

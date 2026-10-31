import { useState } from "react";
import type { NoteItem } from "../api/types";
import { Icon } from "../components/Icon";
import { cleanTags } from "./noteQuery";
import { cardTitle } from "./NoteViews";

/** A note's tags as removable chips, a box for more, and the tags other notes have. */
export function TagEditor({ tags, known, onChange }: { tags: string[]; known: string[]; onChange: (tags: string[]) => void }) {
  const [typed, setTyped] = useState("");
  const add = (words: string) => {
    const next = cleanTags([...tags, ...words.split(",")]);
    if (next.length !== tags.length) onChange(next);
    setTyped("");
  };
  const offered = known.filter((k) => !tags.some((t) => t.toLowerCase() === k.toLowerCase())).slice(0, 12);
  return (
    <div className="tag-editor">
      <div className="tag-editor-chips">
        {tags.map((t) => (
          <span key={t} className="note-tag is-removable">
            {t}
            <button type="button" aria-label={`Take off ${t}`} onClick={() => onChange(tags.filter((x) => x !== t))}>
              <Icon name="close" size={11} />
            </button>
          </span>
        ))}
        <input
          value={typed}
          onChange={(e) => (e.target.value.endsWith(",") ? add(e.target.value) : setTyped(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === "Enter" && typed.trim()) {
              e.preventDefault();
              add(typed);
            } else if (e.key === "Backspace" && !typed && tags.length) onChange(tags.slice(0, -1));
          }}
          onBlur={() => typed.trim() && add(typed)}
          placeholder={tags.length ? "Add another" : "Add a tag"}
          aria-label="Add a tag"
          maxLength={40}
        />
      </div>
      {offered.length > 0 && (
        <div className="tag-editor-known">
          {offered.map((k) => (
            <button key={k} type="button" className="note-tag is-offered" onClick={() => add(k)}>
              + {k}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Changing one note's tags. */
export function TagsDialog({ note, known, onSave, onCancel }: { note: NoteItem; known: string[]; onSave: (tags: string[]) => void; onCancel: () => void }) {
  const [tags, setTags] = useState(note.tags ?? []);
  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="dialog tags-dialog" role="dialog" aria-label="Tags" onKeyDown={(e) => e.key === "Escape" && onCancel()}>
        <h2>Tags</h2>
        <p className="muted dialog-lede">For {cardTitle(note)}. Press Enter or type a comma after each tag.</p>
        <TagEditor tags={tags} known={known} onChange={setTags} />
        <div className="dialog-actions">
          <button type="button" className="btn btn-quiet" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={() => onSave(tags)}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

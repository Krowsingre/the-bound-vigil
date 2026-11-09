import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { NoteItem } from "../api/types";
import { FormattedText } from "../writing/FormattedText";
import { personalTitle } from "./noteInfo";
import { TagEditor } from "./TagsDialog";

export function PersonalNoteEditor({ initial, refreshKey, onSaved, onClose }: {
  initial?: NoteItem;
  refreshKey: number;
  onSaved: (note: NoteItem) => void;
  onClose: () => void;
}) {
  const [note, setNote] = useState(initial);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [text, setText] = useState(initial?.note ?? "");
  const [tags, setTags] = useState(initial?.tags ?? []);
  const [expanded, setExpanded] = useState(false);
  const [otherNotes, setOtherNotes] = useState<NoteItem[]>([]);
  const [known, setKnown] = useState<string[]>([]);
  const [listError, setListError] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [discard, setDiscard] = useState<{ next?: NoteItem; close: boolean } | null>(null);
  const saving = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const dirty = title !== (note?.title ?? "") || text !== (note?.note ?? "") ||
    JSON.stringify(tags) !== JSON.stringify(note?.tags ?? []);

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    const opener = document.activeElement;
    el.showModal();
    titleInput.current?.focus();
    return () => {
      el.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);
  useEffect(() => {
    let current = true;
    void api.getNotes({ tab: "personal", sort: "recent", search: null, bookId: null, colors: [] }).then(
      (page) => {
        if (!current) return;
        setOtherNotes(page.notes);
        setKnown(page.tags);
        setListError(false);
      },
      () => { if (current) setListError(true); },
    );
    return () => { current = false; };
  }, [refreshKey]);

  const load = (next?: NoteItem) => {
    setNote(next);
    setTitle(next?.title ?? "");
    setText(next?.note ?? "");
    setTags(next?.tags ?? []);
    setError("");
    titleInput.current?.focus();
  };
  const leave = (close: boolean, next?: NoteItem) => {
    if (saving.current) return;
    if (dirty) setDiscard({ close, next });
    else if (close) onClose();
    else load(next);
  };
  const save = async () => {
    if (saving.current || discard) return;
    if (!title.trim() && !text.trim()) return setError("Write something first.");
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      onSaved(await api.savePersonalNote(note?.id ?? null, title.trim() || null, text, tags));
    } catch (failure) {
      setError(String(failure));
      setBusy(false);
      saving.current = false;
    }
  };

  return (
    <dialog ref={dialog} className={`dialog personal-note-editor${expanded ? " is-expanded" : ""}`}
      aria-labelledby="personal-note-heading"
      onCancel={(event) => { event.preventDefault(); if (discard) setDiscard(null); else leave(true); }}>
      <form onSubmit={(event) => { event.preventDefault(); void save(); }}
        onKeyDown={(event) => {
          if (event.defaultPrevented || event.nativeEvent.isComposing || event.key !== "Enter" || !(event.ctrlKey || event.metaKey)) return;
          event.preventDefault();
          void save();
        }}>
        <header className="personal-note-head">
          <h2 id="personal-note-heading">{note ? "Edit personal note" : "New personal note"}</h2>
          <button type="button" className="btn btn-quiet" aria-pressed={expanded} disabled={busy || !!discard} onClick={() => setExpanded(!expanded)}>
            {expanded ? "Compact view" : "Expand editor"}
          </button>
        </header>
        <div className="personal-note-layout" inert={busy || !!discard}>
          <aside className="personal-note-sidebar">
            <label className="field">
              <span>Title</span>
              <input ref={titleInput} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Optional" maxLength={120} />
            </label>
            <fieldset className="personal-note-tags">
              <legend>Tags</legend>
              <TagEditor key={note?.id ?? "new"} tags={tags} known={known} onChange={setTags} />
            </fieldset>
            {expanded && <nav className="personal-note-list" aria-label="Other personal notes">
              <button type="button" className="btn btn-quiet btn-small" disabled={busy} onClick={() => leave(false)}>New personal note</button>
              {otherNotes.filter((item) => item.id !== note?.id).map((item) => (
                <button key={item.id} type="button" className="link-btn" disabled={busy} onClick={() => leave(false, item)}>
                  {personalTitle(item)}
                </button>
              ))}
              {listError && <p className="muted">Other notes couldn’t be loaded.</p>}
            </nav>}
          </aside>
          <section className="personal-note-writing" aria-label="Note text">
            <FormattedText key={note?.id ?? "new"} value={text} onChange={setText} rows={10} placeholder="Write freely…" label="Note text" />
          </section>
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        {discard ? <div className="dialog-actions" role="group" aria-label="Unsaved changes">
          <span>Discard unsaved changes?</span>
          <button type="button" className="btn btn-quiet" autoFocus onClick={() => setDiscard(null)}>Keep editing</button>
          <button type="button" className="btn btn-danger" onClick={() => {
            setDiscard(null);
            if (discard.close) onClose();
            else load(discard.next);
          }}>Discard changes</button>
        </div> : <div className="dialog-actions">
          <button type="button" className="btn btn-quiet" onClick={() => leave(true)} disabled={busy}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>Save note</button>
        </div>}
      </form>
    </dialog>
  );
}

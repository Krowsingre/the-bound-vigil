// "Add to a book I'm writing": a note becomes a new chapter, or goes on the
// end of one. The note itself stays where it was.

import { useEffect, useState } from "react";
import { api } from "../api";
import type { NoteItem, WritingChapter, WritingProject } from "../api/types";
import { useToast } from "../components/Toast";
import { chapterTitle, quoteHtml } from "./fromNotes";

const NEW_CHAPTER = "";

export function NoteToBookDialog({ note, onClose, onGoToBooks }: { note: NoteItem; onClose: () => void; onGoToBooks: () => void }) {
  const [projects, setProjects] = useState<WritingProject[] | null>(null);
  const [projectId, setProjectId] = useState("");
  const [chapters, setChapters] = useState<WritingChapter[]>([]);
  const [chapterId, setChapterId] = useState(NEW_CHAPTER);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  useEffect(() => {
    api.writingProjects().then(
      (list) => {
        setProjects(list);
        setProjectId((id) => id || list[0]?.id || "");
      },
      (e: unknown) => setError(String(e)),
    );
  }, []);

  useEffect(() => {
    setChapterId(NEW_CHAPTER);
    if (!projectId) return setChapters([]);
    let current = true;
    api.writingProject(projectId).then(
      (v) => current && setChapters(v.chapters),
      () => current && setChapters([]),
    );
    return () => {
      current = false;
    };
  }, [projectId]);

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      const html = quoteHtml(note);
      const onto = chapters.find((c) => c.id === chapterId);
      if (onto) await api.saveWritingChapter(onto.id, onto.title, onto.body + html);
      else {
        const title = chapterTitle(note);
        const last = [...chapters].reverse().find((c) => c.role === "chapter") ?? chapters[chapters.length - 1] ?? null;
        const added = await api.addWritingChapter(projectId, title, last?.id ?? null);
        await api.saveWritingChapter(added.id, title, html);
      }
      const book = projects?.find((p) => p.id === projectId);
      toast(onto ? `Added to the end of ${onto.title || "that chapter"}.` : `Added to ${book?.title ?? "your book"} as a new chapter.`);
      onClose();
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <form
        className="dialog writing-dialog"
        role="dialog"
        aria-label="Add to a book I'm writing"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
        onKeyDown={(e) => e.key === "Escape" && !busy && onClose()}
      >
        <h2>Add to a book I'm writing</h2>
        {projects && projects.length === 0 ? (
          <p className="muted">You aren't writing a book yet. Start one under Writing › Books, then come back to add this note to it.</p>
        ) : (
          <>
            <label className="field">
              <span>Book</span>
              <select value={projectId} onChange={(e) => setProjectId(e.target.value)} disabled={!projects}>
                {(projects ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Where it goes</span>
              <select value={chapterId} onChange={(e) => setChapterId(e.target.value)}>
                <option value={NEW_CHAPTER}>A new chapter at the end</option>
                {chapters.map((c) => (
                  <option key={c.id} value={c.id}>
                    The end of {c.title || "an untitled chapter"}
                  </option>
                ))}
              </select>
            </label>
            <p className="muted">
              {note.excerpt.trim() ? "The highlighted words go in as a quote with the book's title and author underneath. " : ""}
              The note stays in your notes too.
            </p>
          </>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="btn btn-quiet" onClick={onClose} disabled={busy}>
            {projects?.length === 0 ? "Close" : "Cancel"}
          </button>
          {projects?.length === 0 ? (
            <button type="button" className="btn btn-primary" onClick={onGoToBooks}>
              Go to my books
            </button>
          ) : (
            <button type="submit" className="btn btn-primary" disabled={busy || !projectId}>
              Add it
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

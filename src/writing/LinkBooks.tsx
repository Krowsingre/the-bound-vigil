// Linking two books that were started separately: as editions of one book
// (a first and second edition, a revised version, a translation…), or the
// other book kept as a locked draft of this one. The other book itself is
// never changed when it becomes a draft; it stays in Scribe until deleted.

import { useMemo, useState } from "react";
import { api } from "../api";
import type { WritingProject } from "../api/types";
import { editionName, editionOrFirst, type EditionInfo } from "./bookEditions";
import { exportProblems, readExport } from "./epub";
import { makeEpub } from "./WritingDialogs";

export type LinkAs = "edition" | "draft";

/** The edition settings each book should end with, so `other` (and any editions it already had) join `book`'s editions. */
export function linkEditions(
  book: { id: string; export: string | null; createdAt: string },
  other: { id: string; export: string | null; createdAt: string },
  all: { id: string; export: string | null; createdAt: string }[],
  place: "before" | "after",
): Map<string, EditionInfo> {
  const ours = editionOrFirst(readExport(book.export), book.createdAt.slice(0, 4));
  const theirs = editionOrFirst(readExport(other.export), other.createdAt.slice(0, 4));
  const group = (b: { export: string | null }) => readExport(b.export).edition?.group;
  const members = (g: string, self: typeof book, own: EditionInfo) => {
    const list = all.filter((b) => b.id !== self.id && group(b) === g).map((b) => ({ id: b.id, edition: readExport(b.export).edition! }));
    return [...list, { id: self.id, edition: own }].sort((a, b) => a.edition.number - b.edition.number);
  };
  const ourSide = members(ours.group, book, ours);
  // Already linked: nothing moves.
  if (ours.group === theirs.group) return new Map(ourSide.map((m) => [m.id, m.edition]));
  const theirSide = members(theirs.group, other, theirs).filter((m) => !ourSide.some((o) => o.id === m.id));
  const order = place === "after" ? [...ourSide, ...theirSide] : [...theirSide, ...ourSide];
  const out = new Map<string, EditionInfo>();
  order.forEach((m, i) => {
    const number = i + 1;
    // A name the writer typed stays; the usual "Second edition" follows the new number.
    const named = m.edition.name.trim() && m.edition.name !== editionName(m.edition.number);
    out.set(m.id, { ...m.edition, group: ours.group, number, name: named ? m.edition.name : editionName(number) });
  });
  return out;
}

export function LinkBookDialog({
  project,
  books,
  onDone,
  onCancel,
}: {
  project: WritingProject;
  /** Every book in Scribe. */
  books: WritingProject[];
  onDone: (message: string) => void;
  onCancel: () => void;
}) {
  const choices = useMemo(() => books.filter((b) => b.id !== project.id).sort((a, b) => a.title.localeCompare(b.title)), [books, project.id]);
  const [otherId, setOtherId] = useState(choices[0]?.id ?? "");
  const [as, setAs] = useState<LinkAs>("edition");
  const [place, setPlace] = useState<"before" | "after">("after");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const other = choices.find((b) => b.id === otherId) ?? null;
  const linked = !!other && readExport(other.export).edition?.group != null && readExport(other.export).edition?.group === readExport(project.export).edition?.group;

  const link = async () => {
    if (!other) return;
    setBusy(true);
    setError(null);
    try {
      if (as === "edition") {
        const plan = linkEditions(project, other, books, place);
        for (const [id, edition] of plan) {
          const b = id === project.id ? project : books.find((x) => x.id === id);
          if (!b) continue;
          const settings = readExport(b.export);
          if (JSON.stringify(settings.edition) === JSON.stringify(edition)) continue;
          await api.setWritingExport(id, JSON.stringify({ ...settings, edition }));
        }
        onDone(`${other.title} is now ${(plan.get(other.id)?.name ?? "an edition").toLowerCase()} of this book.`);
      } else {
        const view = await api.writingProject(other.id);
        const problems = exportProblems(view.chapters);
        if (problems.length) throw new Error(`${other.title} has nothing written in it yet.`);
        const next = (await api.writingDrafts(project.id)).reduce((n, d) => Math.max(n, d.number), 0) + 1;
        const draft = await api.saveWritingDraft(project.id, await makeEpub({ ...project, title: `${project.title} (Draft ${next})` }, view.chapters, readExport(view.project.export)));
        onDone(`${other.title} is kept as Draft ${draft.number} of this book. It's still in Scribe too; delete it there if you don't need it.`);
      }
    } catch (e) {
      setError(String(e).replace(/^Error: /, ""));
      setBusy(false);
    }
  };

  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && !busy && onCancel()}>
      <form
        className="dialog writing-dialog link-books"
        role="dialog"
        aria-label="Link another book"
        onSubmit={(e) => {
          e.preventDefault();
          void link();
        }}
        onKeyDown={(e) => e.key === "Escape" && !busy && onCancel()}
      >
        <h2>Link another book</h2>
        <p className="muted dialog-lede">For two books you started separately that are really one book: an earlier edition, a revised version, or a draft.</p>
        {choices.length === 0 ? (
          <p className="muted">There are no other books in Scribe to link.</p>
        ) : (
          <>
            <label className="field">
              <span>The other book</span>
              <select value={otherId} onChange={(e) => setOtherId(e.target.value)}>
                {choices.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.title}
                    {b.author ? ` · ${b.author}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <fieldset className="import-into" aria-label="Link it as">
              <label className="check-row">
                <input type="radio" name="link-as" checked={as === "edition"} onChange={() => setAs("edition")} />
                <span>
                  <strong>Another edition or version</strong>
                  <span className="muted"> · both stay books you can write in, linked under Editions, each with its own ISBNs.</span>
                </span>
              </label>
              {as === "edition" && (
                <div className="segmented link-books-place" role="radiogroup" aria-label="Which comes first">
                  <button type="button" role="radio" aria-checked={place === "before"} className={place === "before" ? "is-active" : ""} onClick={() => setPlace("before")}>
                    It came before this one
                  </button>
                  <button type="button" role="radio" aria-checked={place === "after"} className={place === "after" ? "is-active" : ""} onClick={() => setPlace("after")}>
                    It came after this one
                  </button>
                </div>
              )}
              <label className="check-row">
                <input type="radio" name="link-as" checked={as === "draft"} onChange={() => setAs("draft")} />
                <span>
                  <strong>A draft of this book</strong>
                  <span className="muted"> · kept locked under Drafts, to read, highlight and make notes in.</span>
                </span>
              </label>
            </fieldset>
            {linked && as === "edition" && <p className="muted writing-export-note">These two are already editions of the same book.</p>}
          </>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="btn btn-quiet" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || !other || (linked && as === "edition")}>
            {busy ? "Linking…" : "Link"}
          </button>
        </div>
      </form>
    </div>
  );
}

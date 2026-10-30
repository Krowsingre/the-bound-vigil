// A box set: several books you've written in Scribe joined into one new
// book. Each becomes a part of it, keeping its own front and back matter
// (copyright, dedication, acknowledgements…) and its chapters, numbered from
// 1 again in each. The books themselves are left as they are.

import { useEffect, useState } from "react";
import { api } from "../api";
import type { WritingChapter, WritingProject } from "../api/types";
import { Icon } from "../components/Icon";
import { bookOrder, madeSectionHtml, readExport, type ExportSettings } from "./epub";
import { DEFAULT_COPYRIGHT, isMade, readPage, startingTitle, writePage, type PageKind } from "./pages";

/** Pages the box set makes once for all its books, so each book's own are left out. */
const LEFT_OUT: PageKind[] = ["half_title", "title_page", "contents", "contents_manual", "sources"];

/** The sections of one book as they go into the box set: its own pages, made pages written out as they stand. */
export function boxSetSections(
  project: WritingProject,
  chapters: WritingChapter[],
  settings: ExportSettings,
  keep: { front: boolean; back: boolean },
): { title: string; body: string; role: WritingChapter["role"]; page: string }[] {
  const out: { title: string; body: string; role: WritingChapter["role"]; page: string }[] = [];
  for (const c of bookOrder(chapters)) {
    const page = readPage(c.page, c.role);
    if (LEFT_OUT.includes(page.kind)) continue;
    // A part inside the book becomes a page of its own, headed with its name.
    const role = c.role === "part" ? "chapter" : c.role;
    if ((role === "front" && !keep.front) || (role === "back" && !keep.back)) continue;
    // Made pages (the copyright page) keep this book's details: written out as they are now.
    const made = isMade(page);
    const body = made ? madeSectionHtml({ project, chapters, settings }, c.id) : c.body;
    const kept = c.role === "part" ? { ...readPage("{}", "chapter"), kind: "custom" as const, showTitle: true } : made ? { ...page, byHand: true } : page;
    out.push({ title: c.title, body, role, page: writePage(kept) });
  }
  return out;
}

/** The box set's own settings: the first book's look, with every book's sources and store links. */
export function boxSetSettings(each: ExportSettings[]): ExportSettings {
  const first = each[0] ?? readExport("{}");
  const sources = each.flatMap((s) => s.sources).filter((s, i, all) => all.findIndex((x) => x.id === s.id) === i);
  const storeBooks = each.flatMap((s) => s.storeBooks).filter((b, i, all) => all.findIndex((x) => x.title.trim().toLowerCase() === b.title.trim().toLowerCase()) === i);
  return { ...first, sources, storeBooks, numbering: "restart", copyright: { ...DEFAULT_COPYRIGHT, holder: first.copyright.holder, publisher: first.copyright.publisher } };
}

export function BoxSetDialog({ onCreated, onCancel }: { onCreated: (id: string) => void; onCancel: () => void }) {
  const [projects, setProjects] = useState<WritingProject[] | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [keepFront, setKeepFront] = useState(true);
  const [keepBack, setKeepBack] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.writingProjects().then(
      (list) => setProjects(list.filter((p) => p.chapters > 0)),
      (e: unknown) => setError(String(e)),
    );
  }, []);

  const picked = chosen.map((id) => projects?.find((p) => p.id === id)).filter((p): p is WritingProject => !!p);
  // A title and author to start from, while they haven't been typed.
  const series = picked.length && picked.every((p) => p.series && p.series === picked[0].series) ? picked[0].series : null;
  const authors = [...new Set(picked.map((p) => p.author?.trim()).filter(Boolean))];
  const suggestedTitle = series ? `${series}: Books ${picked.map((p) => p.seriesIndex).filter((n) => n != null).join(", ") || `1 to ${picked.length}`}` : picked.length ? "Box set" : "";

  const toggle = (id: string) => setChosen((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));
  const move = (id: string, by: -1 | 1) =>
    setChosen((list) => {
      const i = list.indexOf(id);
      const j = i + by;
      if (i < 0 || j < 0 || j >= list.length) return list;
      const next = [...list];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const make = async () => {
    if (picked.length < 2) return setError("Choose at least two books.");
    setError(null);
    try {
      setBusy("Reading the books…");
      const books = await Promise.all(picked.map((p) => api.writingProject(p.id)));
      const settings = books.map((b) => readExport(b.project.export));
      setBusy("Making the box set…");
      const made = await api.createWritingProject(title.trim() || suggestedTitle || "Box set", (author.trim() || authors[0]) ?? null);
      const id = made.project.id;
      await api.setWritingExport(id, JSON.stringify(boxSetSettings(settings)));
      if (series) await api.updateWritingDetails(id, { title: made.project.title, author: made.project.author, series, seriesIndex: null, language: books[0].project.language, description: null }).catch(() => undefined);
      // The box set's own opening pages, then each book as a part.
      for (const kind of ["title_page", "copyright", "contents"] as const)
        await api.addWritingSection(id, { title: startingTitle(kind, made.project), role: "front", page: JSON.stringify({ kind }) });
      for (const [i, book] of books.entries()) {
        setBusy(`Adding ${book.project.title} (${i + 1} of ${books.length})…`);
        const part = await api.addWritingSection(id, { title: book.project.title, role: "part" });
        for (const s of boxSetSections(book.project, book.chapters, settings[i], { front: keepFront, back: keepBack }))
          await api.addWritingSection(id, { ...s, part: part.id });
      }
      // The empty first chapter every new book starts with.
      for (const c of made.chapters) await api.deleteWritingChapter(c.id).catch(() => undefined);
      onCreated(id);
    } catch (e) {
      setError(String(e).replace(/^Error: /, ""));
      setBusy(null);
    }
  };

  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && !busy && onCancel()}>
      <form
        className="dialog writing-dialog box-set"
        role="dialog"
        aria-label="Make a box set"
        onSubmit={(e) => {
          e.preventDefault();
          void make();
        }}
        onKeyDown={(e) => e.key === "Escape" && !busy && onCancel()}
      >
        <h2>Make a box set</h2>
        <p className="muted dialog-lede">Choose the books, in order. Each one becomes a part of a new book, with its own chapters, numbered from 1 again. The books themselves stay as they are.</p>
        {!projects ? (
          <p className="muted">{error ? "" : "Finding your books…"}</p>
        ) : projects.length < 2 ? (
          <p className="muted">A box set needs at least two books written in Scribe.</p>
        ) : (
          <ol className="box-set-books">
            {[...picked, ...projects.filter((p) => !chosen.includes(p.id))].map((p) => {
              const at = chosen.indexOf(p.id);
              return (
                <li key={p.id} className={at >= 0 ? "is-chosen" : undefined}>
                  <label className="check-row">
                    <input type="checkbox" checked={at >= 0} onChange={() => toggle(p.id)} />
                    <span className="box-set-book">
                      {at >= 0 && <b className="box-set-number">{at + 1}</b>}
                      <span>
                        <span className="box-set-title">{p.title}</span>
                        <span className="muted">
                          {[p.author, p.series ? `${p.series}${p.seriesIndex != null ? ` ${p.seriesIndex}` : ""}` : null, `${p.words.toLocaleString()} words`].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                    </span>
                  </label>
                  {at >= 0 && (
                    <span className="box-set-move">
                      <button type="button" className="btn btn-quiet btn-icon btn-small" aria-label="Earlier" disabled={at === 0} onClick={() => move(p.id, -1)}>
                        <Icon name="chevronUp" size={14} />
                      </button>
                      <button type="button" className="btn btn-quiet btn-icon btn-small" aria-label="Later" disabled={at === chosen.length - 1} onClick={() => move(p.id, 1)}>
                        <Icon name="chevronDown" size={14} />
                      </button>
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        )}
        <div className="writing-export-styles">
          <label className="field">
            <span>Title</span>
            <input value={title} placeholder={suggestedTitle || "Box set"} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
          </label>
          <label className="field">
            <span>Author</span>
            <input value={author} placeholder={authors.join(", ") || "Your name"} onChange={(e) => setAuthor(e.target.value)} maxLength={200} />
          </label>
        </div>
        <label className="check-row">
          <input type="checkbox" checked={keepFront} onChange={(e) => setKeepFront(e.target.checked)} />
          <span>Keep each book's front matter (copyright, dedication, foreword…)</span>
        </label>
        <label className="check-row">
          <input type="checkbox" checked={keepBack} onChange={(e) => setKeepBack(e.target.checked)} />
          <span>Keep each book's back matter (acknowledgements, about the author…)</span>
        </label>
        <p className="muted writing-export-note">The box set gets one title page, copyright page and contents of its own. Each book's sources are listed together at the back.</p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="btn btn-quiet" onClick={onCancel} disabled={!!busy}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={!!busy || picked.length < 2}>
            {busy ?? (picked.length >= 2 ? `Make the box set of ${picked.length}` : "Make the box set")}
          </button>
        </div>
      </form>
    </div>
  );
}

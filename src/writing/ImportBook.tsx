// Bringing a book written elsewhere into Scribe: choose the file, check how
// it's been cut into chapters, then it's made into a Scribe book.

import { useRef, useState } from "react";
import { api } from "../api";
import { pictureAddress } from "./extensions";
import { bestSplit, IMPORT_ACCEPT, readDocument, splitChapters, type ImportedChapter, type ImportedDocument, type SplitAt } from "./importDoc";

const SPLITS: { value: SplitAt; label: string }[] = [
  { value: "headings", label: "At its headings" },
  { value: "lines", label: "At lines like \"Chapter 1\"" },
  { value: "none", label: "Don't split: one chapter" },
];

/** Large pictures are made the size Scribe keeps, as when one is added by hand. */
async function shrinkPictures(html: string): Promise<string> {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  for (const img of doc.querySelectorAll("img")) {
    const src = img.getAttribute("src") ?? "";
    if (src.length < 400_000) continue;
    try {
      const blob = await (await fetch(src)).blob();
      img.setAttribute("src", await pictureAddress(new File([blob], "picture", { type: blob.type })));
    } catch {
      // Kept as it came.
    }
  }
  return doc.body.innerHTML;
}

export function ImportBookDialog({ onCreated, onCancel }: { onCreated: (id: string) => void; onCancel: () => void }) {
  const picking = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [doc, setDoc] = useState<ImportedDocument | null>(null);
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [split, setSplit] = useState<SplitAt>("headings");
  const [chapters, setChapters] = useState<ImportedChapter[]>([]);
  const [keep, setKeep] = useState<boolean[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cut = (d: ImportedDocument, at: SplitAt, bookTitle: string) => {
    const list = splitChapters(d.html, at, bookTitle);
    setChapters(list);
    // A short opening before the first chapter is usually a title page Scribe makes for you.
    setKeep(list.map((c, i) => !(i === 0 && list.length > 1 && c.title === "Opening" && c.words < 80)));
  };

  const open = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setBusy("Reading the file…");
    try {
      const d = await readDocument(file);
      const at = bestSplit(d.html);
      setFileName(file.name);
      setDoc(d);
      setTitle(d.title);
      setAuthor(d.author ?? "");
      setSplit(at);
      cut(d, at, d.title);
    } catch (e) {
      setError(String(e).replace(/^Error: /, ""));
    } finally {
      setBusy(null);
    }
  };

  const make = async () => {
    const chosen = chapters.filter((_, i) => keep[i]);
    if (!chosen.length) return setError("Keep at least one chapter.");
    setError(null);
    try {
      setBusy("Making the book…");
      const view = await api.createWritingProject(title.trim() || doc?.title || "Untitled", author.trim() || null);
      if (doc?.description) await api.updateWritingDetails(view.project.id, { title: view.project.title, author: view.project.author, series: null, seriesIndex: null, language: null, description: doc.description }).catch(() => undefined);
      let previous = view.chapters[0];
      for (let i = 0; i < chosen.length; i++) {
        setBusy(`Adding chapter ${i + 1} of ${chosen.length}…`);
        const c = chosen[i];
        const target = i === 0 ? previous : await api.addWritingChapter(view.project.id, c.title, previous.id);
        previous = await api.saveWritingChapter(target.id, c.title, await shrinkPictures(c.body));
      }
      onCreated(view.project.id);
    } catch (e) {
      setError(String(e).replace(/^Error: /, ""));
      setBusy(null);
    }
  };

  const kept = chapters.filter((_, i) => keep[i]);
  const words = kept.reduce((n, c) => n + c.words, 0);

  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && !busy && onCancel()}>
      <form
        className="dialog writing-dialog import-book"
        role="dialog"
        aria-label="Import a book"
        onSubmit={(e) => {
          e.preventDefault();
          void make();
        }}
        onKeyDown={(e) => e.key === "Escape" && !busy && onCancel()}
      >
        <h2>Import a book</h2>
        <p className="muted dialog-lede">Bring in a book you've written elsewhere: Word, OpenDocument, RTF, plain text, Markdown, HTML or EPUB. For Google Docs, download it as Word first. The file itself is left as it is.</p>
        <div className="import-book-file">
          <button type="button" className="btn btn-quiet" disabled={!!busy} onClick={() => picking.current?.click()}>
            {fileName ? "Choose another file" : "Choose a file"}
          </button>
          {fileName && <span className="muted">{fileName}</span>}
          <input
            ref={picking}
            type="file"
            accept={IMPORT_ACCEPT}
            hidden
            onChange={(e) => {
              void open(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </div>

        {doc && (
          <>
            <div className="writing-export-styles import-book-details">
              <label className="field">
                <span>Title</span>
                <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
              </label>
              <label className="field">
                <span>Author</span>
                <input value={author} onChange={(e) => setAuthor(e.target.value)} maxLength={200} />
              </label>
              <label className="field">
                <span>Split into chapters</span>
                <select
                  value={split}
                  onChange={(e) => {
                    const at = e.target.value as SplitAt;
                    setSplit(at);
                    cut(doc, at, title || doc.title);
                  }}
                >
                  {SPLITS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="muted writing-export-note">
              {kept.length} {kept.length === 1 ? "chapter" : "chapters"}, {words.toLocaleString()} words. Untick anything you don't want, such as a title page or contents, which Scribe makes for you.
            </p>
            <ol className="import-book-chapters">
              {chapters.map((c, i) => (
                <li key={i}>
                  <label className="check-row">
                    <input type="checkbox" checked={keep[i] ?? true} onChange={(e) => setKeep((k) => k.map((v, j) => (j === i ? e.target.checked : v)))} />
                    <span className="import-book-chapter-title">{c.title}</span>
                    <span className="muted">{c.words.toLocaleString()} {c.words === 1 ? "word" : "words"}</span>
                  </label>
                </li>
              ))}
            </ol>
          </>
        )}

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="btn btn-quiet" onClick={onCancel} disabled={!!busy}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={!!busy || !doc}>
            {busy ?? "Import"}
          </button>
        </div>
      </form>
    </div>
  );
}

// Bringing a manuscript written elsewhere into Scribe, in stages:
// 1. choose the file, which is only looked at (nothing is made yet);
// 2. confirm you own it or may publish it, a box that is never ticked for
//    you and that no import skips;
// 3. check how it was rebuilt: its sections in Front, Body and Back, what
//    each one is, and anything to check;
// 4. the book is made, with a signed record of the confirmation and the
//    original file kept beside it. The report goes into the book's notes.

import { useRef, useState } from "react";
import { api } from "../api";
import { Icon } from "../components/Icon";
import { formatBytes } from "../settings/controls";
import { ACK_CONFIRMATION, ACK_PARAGRAPHS, ACK_TITLE, POLICY_VERSION, sha256Hex, WORDING } from "./acknowledgment";
import { AuthorLabel } from "./AuthorInfo";
import { readExport } from "./epub";
import { pictureAddress } from "./extensions";
import { bestSplit, readDocumentBytes, type ImportedDocument, type SplitAt } from "./importDoc";
import { buildManuscript, inspect, MANUSCRIPT_ACCEPT, type Inspection, type Manuscript, type ManuscriptSection } from "./manuscript";
import { ADD_MENUS, KINDS, writePage, readPage, type Area, type PageKind } from "./pages";

const SPLITS: { value: SplitAt; label: string }[] = [
  { value: "headings", label: "At its headings" },
  { value: "lines", label: "At lines like \"Chapter 1\"" },
  { value: "none", label: "Don't split: one section" },
];

const AREAS: { area: Area; label: string }[] = [
  { area: "front", label: "Front matter" },
  { area: "chapter", label: "Body" },
  { area: "back", label: "Back matter" },
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

type Picked = { name: string; bytes: Uint8Array; inspection: Inspection; sha256: string };

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The report, as a note kept with the book. */
function reportNote(m: Manuscript, fileName: string): string {
  const lines = m.issues.map((i) => {
    const where = i.section === null ? "" : `${m.sections[i.section]?.title || "A poem"}: `;
    return `<li>${escapeHtml(where + i.message)}</li>`;
  });
  return `<p>Imported from ${escapeHtml(fileName)}. Check these against the original before publishing:</p><ul>${lines.join("")}</ul>`;
}

export function ImportBookDialog({ onCreated, onCancel }: { onCreated: (id: string) => void; onCancel: () => void }) {
  const picking = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<"choose" | "confirm" | "review">("choose");
  const [picked, setPicked] = useState<Picked | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [doc, setDoc] = useState<ImportedDocument | null>(null);
  const [manuscript, setManuscript] = useState<Manuscript | null>(null);
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [split, setSplit] = useState<SplitAt>("headings");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const open = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setAgreed(false);
    setBusy("Looking at the file…");
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const inspection = inspect(file.name, bytes);
      setPicked({ name: file.name, bytes, inspection, sha256: inspection.supported ? await sha256Hex(bytes) : "" });
      setStage(inspection.supported ? "confirm" : "choose");
    } catch (e) {
      setError(String(e).replace(/^Error: /, ""));
    } finally {
      setBusy(null);
    }
  };

  /** Only once they've agreed is the manuscript read and rebuilt. */
  const rebuild = async () => {
    if (!picked || !agreed) return;
    setError(null);
    setBusy("Rebuilding the book…");
    try {
      const d = await readDocumentBytes(picked.name, picked.bytes);
      const at = bestSplit(d.html);
      setDoc(d);
      setSplit(at);
      setManuscript(buildManuscript(d, at));
      setTitle(d.title);
      setAuthor(d.author ?? "");
      setStage("review");
    } catch (e) {
      setError(String(e).replace(/^Error: /, ""));
    } finally {
      setBusy(null);
    }
  };

  const change = (i: number, edit: Partial<ManuscriptSection>) =>
    setManuscript((m) => (m ? { ...m, sections: m.sections.map((s, j) => (j === i ? { ...s, ...edit, sure: true } : s)), issues: m.issues.filter((x) => !(x.section === i && x.kind === "classification" && edit.area)) } : m));

  const make = async () => {
    if (!picked || !manuscript || !agreed) return;
    const chosen = manuscript.sections.filter((s) => s.include);
    if (!chosen.length) return setError("Keep at least one section.");
    setError(null);
    let made: string | null = null;
    try {
      setBusy("Making the book…");
      const view = await api.createWritingProject(title.trim() || manuscript.title || "Untitled", author.trim() || null);
      made = view.project.id;
      // The confirmation is signed first: no book is made from an import without it.
      setBusy("Signing the record…");
      await api.recordWritingImport(made, {
        policyVersion: POLICY_VERSION,
        wording: WORDING,
        sourceName: picked.name,
        sourceSha256: picked.sha256,
        sourceBytes: picked.bytes.length,
        sourceFormat: picked.inspection.format,
        method: "checkbox",
      });
      setBusy("Keeping the original…");
      await api.keepWritingSource(made, picked.name, picked.bytes);
      if (manuscript.description || manuscript.language)
        await api.updateWritingDetails(made, { title: view.project.title, author: view.project.author, series: null, seriesIndex: null, language: manuscript.language, description: manuscript.description }).catch(() => undefined);
      if (manuscript.isbn) {
        const settings = readExport(view.project.export);
        await api.setWritingExport(made, JSON.stringify({ ...settings, copyright: { ...settings.copyright, isbn: manuscript.isbn } })).catch(() => undefined);
      }
      let previous: string | null = null;
      for (let i = 0; i < chosen.length; i++) {
        setBusy(`Adding section ${i + 1} of ${chosen.length}…`);
        const s = chosen[i];
        const page = { ...readPage(JSON.stringify({ kind: s.kind }), s.area === "chapter" ? "chapter" : s.area), byHand: !!s.byHand };
        const added = await api.addWritingSection(made, { title: s.title, body: await shrinkPictures(s.body), role: s.area, page: writePage(page), after: previous });
        previous = added.id;
      }
      // The empty chapter every new book starts with.
      for (const c of view.chapters) await api.deleteWritingChapter(c.id).catch(() => undefined);
      if (manuscript.issues.length) {
        const note = await api.savePersonalNote(null, `Import report: ${picked.name}`, reportNote(manuscript, picked.name)).catch(() => null);
        if (note) await api.setNoteProject(note.id, made).catch(() => undefined);
      }
      onCreated(made);
    } catch (e) {
      // Nothing half-made is left behind.
      if (made) await api.deleteWritingProject(made).catch(() => undefined);
      setError(String(e).replace(/^Error: /, ""));
      setBusy(null);
    }
  };

  const sections = manuscript?.sections ?? [];
  const kept = sections.filter((s) => s.include);
  const words = kept.reduce((n, s) => n + s.words, 0);
  const wholeBook = manuscript?.issues.filter((i) => i.section === null) ?? [];

  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && !busy && onCancel()}>
      <form
        className="dialog writing-dialog import-book"
        role="dialog"
        aria-label="Import a manuscript"
        onSubmit={(e) => {
          e.preventDefault();
          if (stage === "confirm") void rebuild();
          else if (stage === "review") void make();
        }}
        onKeyDown={(e) => e.key === "Escape" && !busy && onCancel()}
      >
        <h2>Import a manuscript</h2>

        {stage === "choose" && (
          <>
            <p className="muted dialog-lede">
              Rebuild a book you've written elsewhere as a Scribe book you can edit: Word, OpenDocument, RTF, plain text, Markdown, HTML, EPUB or PDF, or a Kindle Create project made from a PDF (zip its folder first). For Google Docs, download it as Word first. Your file is
              never changed.
            </p>
            <div className="import-book-file">
              <button type="button" className="btn btn-quiet" disabled={!!busy} onClick={() => picking.current?.click()}>
                {picked ? "Choose another file" : "Choose a file"}
              </button>
              {picked && <span className="muted">{picked.name}</span>}
            </div>
            {picked && !picked.inspection.supported && (
              <div className="import-unsupported" role="alert">
                <Icon name="info" size={16} />
                <div>
                  <strong>{picked.inspection.label}: not rebuilt</strong>
                  <p>{picked.inspection.reason}</p>
                </div>
              </div>
            )}
          </>
        )}
        <input
          ref={picking}
          type="file"
          accept={MANUSCRIPT_ACCEPT}
          hidden
          onChange={(e) => {
            void open(e.target.files?.[0]);
            e.target.value = "";
          }}
        />

        {stage === "confirm" && picked && (
          <>
            <p className="import-book-picked">
              <Icon name="file" size={16} /> <strong>{picked.name}</strong> <span className="muted">· {picked.inspection.label} · {formatBytes(picked.bytes.length)}</span>
            </p>
            <section className="import-ack" aria-labelledby="import-ack-title">
              <h3 id="import-ack-title">{ACK_TITLE}</h3>
              {ACK_PARAGRAPHS.map((p) => (
                <p key={p}>{p}</p>
              ))}
              <label className="check-row import-ack-confirm">
                <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
                <span>{ACK_CONFIRMATION}</span>
              </label>
            </section>
            <p className="muted writing-export-note">
              TBV keeps a signed record of this with the book: when you agreed, on which device, and a fingerprint of the file. It isn't a check of who wrote the book, and it never leaves your devices and
              sync.
            </p>
          </>
        )}

        {stage === "review" && manuscript && doc && (
          <>
            <div className="writing-export-styles import-book-details">
              <label className="field">
                <span>Title</span>
                <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
              </label>
              <label className="field">
                <AuthorLabel />
                <input value={author} onChange={(e) => setAuthor(e.target.value)} maxLength={200} placeholder="Your name, or a pen name" />
              </label>
              <label className="field">
                <span>Split into sections</span>
                <select
                  value={split}
                  onChange={(e) => {
                    const at = e.target.value as SplitAt;
                    setSplit(at);
                    setManuscript(buildManuscript(doc, at));
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
              {kept.length} {kept.length === 1 ? "section" : "sections"}, {words.toLocaleString()} words. Check where each one goes and what it is; untick anything you don't want, such as a contents page,
              which Scribe makes for you.
            </p>
            {manuscript.issues.length > 0 && (
              <div className="import-report" role="status">
                <strong>
                  <Icon name="info" size={15} /> {manuscript.issues.length} {manuscript.issues.length === 1 ? "thing" : "things"} to check
                </strong>
                {wholeBook.length > 0 && (
                  <ul>
                    {wholeBook.map((i, n) => (
                      <li key={n}>{i.message}</li>
                    ))}
                  </ul>
                )}
                <p className="muted">The list is also kept in the book's notes, so you can work through it after the import.</p>
              </div>
            )}
            <div className="import-areas">
              {AREAS.map(({ area, label }) => {
                const here = sections.map((s, i) => ({ s, i })).filter(({ s }) => s.area === area);
                return (
                  <section key={area} className="import-area" aria-label={label}>
                    <h3>
                      {label} <span className="muted">{here.length}</span>
                    </h3>
                    {here.length === 0 ? (
                      <p className="muted import-area-empty">Nothing here.</p>
                    ) : (
                      <ol className="import-book-chapters">
                        {here.map(({ s, i }) => {
                          const flags = manuscript.issues.filter((x) => x.section === i);
                          return (
                            <li key={i} className={flags.length ? "is-flagged" : undefined}>
                              <div className="check-row">
                                <input type="checkbox" aria-label={`Bring in ${s.title || "this section"}`} checked={s.include} onChange={(e) => change(i, { include: e.target.checked })} />
                                <span className="import-book-chapter-title">{s.title || <em className="muted">Untitled poem</em>}</span>
                                <select
                                  className="import-kind"
                                  aria-label={`What ${s.title || "this section"} is`}
                                  value={`${s.area}:${s.kind}`}
                                  onChange={(e) => {
                                    const [a, k] = e.target.value.split(":") as [Area, PageKind];
                                    change(i, { area: a, kind: k });
                                  }}
                                >
                                  {AREAS.map((g) => (
                                    <optgroup key={g.area} label={g.label}>
                                      {ADD_MENUS[g.area]
                                        .filter((k) => k !== "contents" && k !== "sources")
                                        .map((k) => (
                                          <option key={k} value={`${g.area}:${k}`}>
                                            {KINDS[k].label}
                                          </option>
                                        ))}
                                    </optgroup>
                                  ))}
                                </select>
                                <span className="muted import-words">{s.words.toLocaleString()}</span>
                              </div>
                              {flags.map((f, n) => (
                                <p key={n} className="import-flag">
                                  <Icon name="info" size={13} /> {f.message}
                                </p>
                              ))}
                            </li>
                          );
                        })}
                      </ol>
                    )}
                  </section>
                );
              })}
            </div>
          </>
        )}

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          {stage !== "choose" && (
            <button
              type="button"
              className="btn btn-quiet"
              disabled={!!busy}
              onClick={() => {
                setError(null);
                setStage(stage === "review" ? "confirm" : "choose");
              }}
            >
              Back
            </button>
          )}
          <button type="button" className="btn btn-quiet" onClick={onCancel} disabled={!!busy}>
            Cancel
          </button>
          {stage === "choose" && (
            <button type="button" className="btn btn-primary" disabled={!!busy || !picked?.inspection.supported} onClick={() => setStage("confirm")}>
              {busy ?? "Continue"}
            </button>
          )}
          {stage === "confirm" && (
            <button type="submit" className="btn btn-primary" disabled={!!busy || !agreed}>
              {busy ?? "Agree and continue"}
            </button>
          )}
          {stage === "review" && (
            <button type="submit" className="btn btn-primary" disabled={!!busy || !kept.length}>
              {busy ?? "Make the book"}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

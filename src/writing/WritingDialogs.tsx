import { useState } from "react";
import { api, isWeb } from "../api";
import type { WritingChapter, WritingDetails, WritingProject } from "../api/types";
import { useToast } from "../components/Toast";
import { buildEpub, epubFileName, exportProblems, readExport, type ExportSettings } from "./epub";
import { imageMime, loadFont } from "./fonts";
import { CoverMaker } from "./CoverMaker";

/** Starting a new book. */
export function NewBookDialog({ onCreated, onCancel }: { onCreated: (id: string) => void; onCancel: () => void }) {
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const create = async () => {
    if (!title.trim()) return setError("Give the book a title. You can change it later.");
    setBusy(true);
    try {
      onCreated((await api.createWritingProject(title, author.trim() || null)).project.id);
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };
  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && !busy && onCancel()}>
      <form
        className="dialog writing-dialog"
        role="dialog"
        aria-label="New book"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
        onKeyDown={(e) => e.key === "Escape" && !busy && onCancel()}
      >
        <h2>New book</h2>
        <label className="field">
          <span>Title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} autoFocus />
        </label>
        <label className="field">
          <span>Author</span>
          <input value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="Your name, or a pen name" />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="btn btn-quiet" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            Start writing
          </button>
        </div>
      </form>
    </div>
  );
}

/** A book's details, as an EPUB will carry them, and its cover. */
export function DetailsDialog({
  project,
  onSaved,
  onCancel,
}: {
  project: WritingProject;
  onSaved: (project: WritingProject) => void;
  /** Closed without saving the words; the cover may still have changed. */
  onCancel: (project: WritingProject) => void;
}) {
  const [details, setDetails] = useState<WritingDetails>({
    title: project.title,
    author: project.author,
    series: project.series,
    seriesIndex: project.seriesIndex,
    language: project.language,
    description: project.description,
  });
  const [cover, setCover] = useState(project);
  const [making, setMaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (change: Partial<WritingDetails>) => setDetails((d) => ({ ...d, ...change }));
  const save = async () => {
    if (!details.title.trim()) return setError("The book needs a title.");
    setBusy(true);
    try {
      onSaved(await api.updateWritingDetails(project.id, details));
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };
  const pickCover = async () => {
    const path = await api.pickWritingCover();
    if (!path) return;
    try {
      setCover(await api.setWritingCover(project.id, path));
    } catch (e) {
      setError(String(e));
    }
  };
  const removeCover = async () => {
    try {
      setCover(await api.setWritingCover(project.id, null));
    } catch (e) {
      setError(String(e));
    }
  };
  const coverSrc = cover.coverPath ? (isWeb ? cover.coverPath : api.coverUrl(cover.coverPath)) : null;
  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && !busy && onCancel(cover)}>
      <form
        className="dialog writing-dialog writing-details"
        role="dialog"
        aria-label="Book details"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        onKeyDown={(e) => e.key === "Escape" && !busy && onCancel(cover)}
      >
        <h2>Book details</h2>
        <p className="muted dialog-lede">These go into the EPUB, so e-readers and stores show them.</p>
        <div className="writing-details-grid">
          <div className="writing-details-cover">
            {coverSrc ? <img src={coverSrc} alt="" /> : <div className="writing-cover-blank">{details.title || "Cover"}</div>}
            {!isWeb && (
              <button type="button" className="btn btn-quiet btn-small" onClick={() => void pickCover()}>
                {cover.cover ? "Change cover" : "Choose a cover"}
              </button>
            )}
            {!isWeb && (
              <button type="button" className="btn btn-quiet btn-small" onClick={() => setMaking(true)}>
                Make a cover
              </button>
            )}
            {cover.cover && (
              <button type="button" className="link-btn" onClick={() => void removeCover()}>
                Remove cover
              </button>
            )}
          </div>
          <div className="writing-details-fields">
            <label className="field">
              <span>Title</span>
              <input value={details.title} onChange={(e) => set({ title: e.target.value })} maxLength={200} autoFocus />
            </label>
            <label className="field">
              <span>Author</span>
              <input value={details.author ?? ""} onChange={(e) => set({ author: e.target.value })} />
            </label>
            <div className="writing-details-row">
              <label className="field">
                <span>Series</span>
                <input value={details.series ?? ""} onChange={(e) => set({ series: e.target.value })} placeholder="None" />
              </label>
              <label className="field writing-number">
                <span>Number</span>
                <input
                  type="number"
                  min={0}
                  step="any"
                  value={details.seriesIndex ?? ""}
                  onChange={(e) => set({ seriesIndex: e.target.value === "" ? null : Number(e.target.value) })}
                />
              </label>
              <label className="field writing-number">
                <span>Language</span>
                <input value={details.language ?? ""} onChange={(e) => set({ language: e.target.value })} placeholder="en" maxLength={20} />
              </label>
            </div>
            <label className="field">
              <span>Description</span>
              <textarea rows={4} value={details.description ?? ""} onChange={(e) => set({ description: e.target.value })} placeholder="The words on the back of the book" />
            </label>
          </div>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="btn btn-quiet" onClick={() => onCancel(cover)} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            Save
          </button>
        </div>
      </form>
      {making && (
        <CoverMaker
          project={{ ...cover, title: details.title || cover.title, author: details.author ?? cover.author }}
          onCancel={() => setMaking(false)}
          onMade={(p) => {
            setCover(p);
            setMaking(false);
          }}
        />
      )}
    </div>
  );
}

const FONTS: { value: ExportSettings["font"]; label: string }[] = [
  { value: "none", label: "None, the reader chooses" },
  { value: "lora", label: "Lora" },
  { value: "echolume", label: "Echolume" },
];
const BREAKS: { value: ExportSettings["sceneBreak"]; label: string }[] = [
  { value: "asterisks", label: "* * *" },
  { value: "ornament", label: "❦" },
  { value: "line", label: "A short line" },
  { value: "space", label: "A blank space" },
];
const DEPTHS: { value: ExportSettings["tocDepth"]; label: string }[] = [
  { value: 1, label: "Chapters" },
  { value: 2, label: "Chapters and headings" },
  { value: 3, label: "Chapters, headings and smaller headings" },
];

/** Making the EPUB: how it looks, and where it goes. */
export function ExportDialog({
  project,
  chapters,
  onFlush,
  onClose,
}: {
  project: WritingProject;
  chapters: WritingChapter[];
  /** Saves the chapter being written, so the EPUB has its latest words. */
  onFlush: () => Promise<WritingChapter[]>;
  onClose: () => void;
}) {
  const [settings, setSettings] = useState(() => readExport(project.export));
  const [addToLibrary, setAddToLibrary] = useState(!isWeb);
  const [saveCopy, setSaveCopy] = useState(isWeb);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const set = (change: Partial<ExportSettings>) => setSettings((s) => ({ ...s, ...change }));
  const problems = exportProblems(chapters);

  const make = async () => {
    if (!addToLibrary && !saveCopy) return setError("Choose where the EPUB goes.");
    setBusy(true);
    setError(null);
    try {
      const latest = await onFlush();
      const fileName = epubFileName(project.title);
      const path = saveCopy && !isWeb ? await api.pickEpubSavePath(fileName) : null;
      if (saveCopy && !isWeb && !path && !addToLibrary) {
        setBusy(false);
        return;
      }
      const coverBytes = project.cover ? await api.writingCover(project.id) : new Uint8Array();
      const mime = coverBytes.length ? imageMime(coverBytes) : null;
      const bytes = buildEpub({
        project,
        chapters: latest,
        settings,
        cover: mime ? { bytes: coverBytes, mime } : null,
        font: await loadFont(settings.font),
      });
      await api.setWritingExport(project.id, JSON.stringify(settings));
      await api.saveWritingEpub(bytes, fileName, path, addToLibrary);
      toast(
        addToLibrary
          ? path
            ? "Saved, and being added to your library."
            : "Being added to your library."
          : isWeb
            ? "The EPUB has been downloaded."
            : "The EPUB has been saved.",
      );
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
        aria-label="Export as EPUB"
        onSubmit={(e) => {
          e.preventDefault();
          void make();
        }}
        onKeyDown={(e) => e.key === "Escape" && !busy && onClose()}
      >
        <h2>Export as EPUB</h2>
        <p className="muted dialog-lede">A standard EPUB 3 that e-readers and stores accept. The table of contents is made from your chapter titles and headings.</p>
        <label className="field">
          <span>Font</span>
          <select autoFocus value={settings.font} onChange={(e) => set({ font: e.target.value as ExportSettings["font"] })}>
            {FONTS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Scene breaks</span>
          <select value={settings.sceneBreak} onChange={(e) => set({ sceneBreak: e.target.value as ExportSettings["sceneBreak"] })}>
            {BREAKS.map((b) => (
              <option key={b.value} value={b.value}>
                {b.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Table of contents</span>
          <select value={settings.tocDepth} onChange={(e) => set({ tocDepth: Number(e.target.value) as ExportSettings["tocDepth"] })}>
            {DEPTHS.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
        <div className="writing-export-styles">
          <label className="field">
            <span>Paragraphs</span>
            <select value={settings.paragraphs} onChange={(e) => set({ paragraphs: e.target.value as ExportSettings["paragraphs"] })}>
              <option value="indent">Indented, as in print</option>
              <option value="space">A blank line between</option>
            </select>
          </label>
          <label className="field">
            <span>Lines</span>
            <select value={settings.align} onChange={(e) => set({ align: e.target.value as ExportSettings["align"] })}>
              <option value="justify">Even on both sides</option>
              <option value="left">Ragged on the right</option>
            </select>
          </label>
          <label className="field">
            <span>Chapter titles</span>
            <select value={settings.titles} onChange={(e) => set({ titles: e.target.value as ExportSettings["titles"] })}>
              <option value="center">Centred</option>
              <option value="left">On the left</option>
            </select>
          </label>
        </div>
        <label className="check-row">
          <input type="checkbox" checked={settings.newPage} onChange={(e) => set({ newPage: e.target.checked })} />
          <span>Start each chapter on a new page</span>
        </label>
        <label className="check-row">
          <input type="checkbox" checked={settings.dropCap} onChange={(e) => set({ dropCap: e.target.checked })} />
          <span>A large first letter at the start of each chapter</span>
        </label>
        <div className="writing-export-where">
          <strong>Where it goes</strong>
          {!isWeb && (
            <label className="check-row">
              <input type="checkbox" checked={addToLibrary} onChange={(e) => setAddToLibrary(e.target.checked)} />
              <span>Add it to my library, where it can be read or sent to a Kindle</span>
            </label>
          )}
          <label className="check-row">
            <input type="checkbox" checked={saveCopy} onChange={(e) => setSaveCopy(e.target.checked)} />
            <span>{isWeb ? "Download the EPUB" : "Save a copy on this computer"}</span>
          </label>
        </div>
        {(error || problems.length > 0) && (
          <p className="form-error" role="alert">
            {error ?? problems[0]}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="btn btn-quiet" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || problems.length > 0}>
            {busy ? "Making the EPUB…" : "Export"}
          </button>
        </div>
      </form>
    </div>
  );
}

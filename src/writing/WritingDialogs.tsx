import { useEffect, useState } from "react";
import { api, isApp, isWeb, isWindows } from "../api";
import type { WritingChapter, WritingDetails, WritingDraft, WritingProject } from "../api/types";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Icon } from "../components/Icon";
import { Menu } from "../components/Menu";
import { usePublisher } from "../license/Publisher";
import { useToast } from "../components/Toast";
import { bookOrder, buildEpub, epubFileName, exportProblems, readExport, type EpubInput, type ExportSettings } from "./epub";
import { imageMime, loadBookFonts } from "./fonts";
import { makeCiter } from "./sources";
import { CoverMaker } from "./CoverMaker";
import { pagesKey } from "./PaperbackCover";
import { BOOK_STYLES } from "./bookStyles";
import { buildDocx } from "./docx";
import { printHtml, TRIMS } from "./printBook";
import { bookFileName, buildTxt } from "./txt";
import { startingTitle, TEMPLATES, templateSections, type Template } from "./pages";

/** Everything an export is made from: the book, its cover, its sources and the fonts chosen. */
export async function bookInput(project: WritingProject, chapters: WritingChapter[], settings: ExportSettings): Promise<EpubInput> {
  const coverBytes = project.cover ? await api.writingCover(project.id) : new Uint8Array();
  const mime = coverBytes.length ? imageMime(coverBytes) : null;
  const citer = await makeCiter(settings.citationStyle, settings.sources, bookOrder(chapters));
  return { project, chapters, settings, cover: mime ? { bytes: coverBytes, mime } : null, citer, ...(await loadBookFonts(settings, chapters)) };
}

/** The book made into an EPUB, with its cover and the font chosen. */
export async function makeEpub(project: WritingProject, chapters: WritingChapter[], settings: ExportSettings): Promise<Uint8Array> {
  return buildEpub(await bookInput(project, chapters, settings));
}

const OPENS_WITH: { value: WritingProject["coverPage"]; label: string }[] = [
  { value: null, label: "The cover, then a title page" },
  { value: "cover", label: "The cover only" },
  { value: "title", label: "A title page only" },
  { value: "none", label: "Straight into the book" },
];

/** Starting a new book. */
export function NewBookDialog({
  onCreated,
  onCancel,
  startWith = "blank",
}: {
  onCreated: (id: string) => void;
  onCancel: () => void;
  /** The template chosen on Scribe's Books page. */
  startWith?: Template;
}) {
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [template, setTemplate] = useState<Template>(startWith);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const create = async () => {
    if (!title.trim()) return setError("Give the book a title. You can change it later.");
    setBusy(true);
    try {
      const made = await api.createWritingProject(title, author.trim() || null);
      // Every book starts with a first chapter; a template adds the pages around it.
      const first = made.chapters[0];
      for (const s of templateSections(template)) {
        const added = await api.addWritingSection(made.project.id, {
          title: s.title ?? startingTitle(s.kind, made.project),
          role: s.role,
          page: s.role === "part" ? "{}" : JSON.stringify({ kind: s.kind }),
        });
        if (s.role === "part" && first) await api.setWritingChapterPart(first.id, added.id);
      }
      // Remembered for the book's card ("Novel · 12 chapters").
      await api.setWritingExport(made.project.id, JSON.stringify({ ...readExport(made.project.export), kind: template }));
      onCreated(made.project.id);
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
        <fieldset className="writing-templates">
          <legend>Start with</legend>
          <div className="writing-template-grid">
            {TEMPLATES.map((t) => (
              <label key={t.value} className={`writing-template${template === t.value ? " is-on" : ""}`}>
                <input type="radio" name="writing-template" checked={template === t.value} onChange={() => setTemplate(t.value)} />
                <strong>{t.label}</strong>
                <span>{t.hint}</span>
              </label>
            ))}
          </div>
        </fieldset>
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
  focus = "title",
}: {
  project: WritingProject;
  /** Where to start: the title, the author (Change Author) or the cover (Change Cover). */
  focus?: "title" | "author" | "cover";
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
  const [opensWith, setOpensWith] = useState(project.coverPage);
  const [making, setMaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (change: Partial<WritingDetails>) => setDetails((d) => ({ ...d, ...change }));
  const save = async () => {
    if (!details.title.trim()) return setError("The book needs a title.");
    setBusy(true);
    try {
      const saved = await api.updateWritingDetails(project.id, details);
      onSaved(opensWith !== project.coverPage ? await api.setWritingCoverPage(project.id, opensWith) : saved);
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
              <button type="button" className="btn btn-quiet btn-small" onClick={() => void pickCover()} autoFocus={focus === "cover"}>
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
              <input value={details.title} onChange={(e) => set({ title: e.target.value })} maxLength={200} autoFocus={focus === "title"} />
            </label>
            <label className="field">
              <span>Author</span>
              <input value={details.author ?? ""} onChange={(e) => set({ author: e.target.value })} autoFocus={focus === "author"} />
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
            <label className="field">
              <span>The book opens with</span>
              <select value={opensWith ?? ""} onChange={(e) => setOpensWith((e.target.value || null) as WritingProject["coverPage"])}>
                {OPENS_WITH.map((o) => (
                  <option key={o.value ?? ""} value={o.value ?? ""}>
                    {o.label}
                  </option>
                ))}
              </select>
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

export type ExportFormat = "epub" | "pdf" | "docx" | "txt" | "manuscript";

const FORMATS: { value: ExportFormat; label: string; lede: string }[] = [
  { value: "epub", label: "EPUB", lede: "A standard EPUB 3 that e-readers and stores accept. Changes show in the preview straight away." },
  { value: "pdf", label: "Print PDF", lede: "Pages ready for a paperback: a trim size KDP and IngramSpark accept, mirrored margins, running heads and page numbers." },
  { value: "docx", label: "Word", lede: "A Word file with Word's own heading styles, real footnotes, pictures and page breaks, for editors and beta readers." },
  { value: "txt", label: "Text", lede: "Plain text: the words alone, with titles in capitals and each chapter's notes after it." },
  { value: "manuscript", label: "Manuscript", lede: "A standard manuscript for agents, publishers and magazines, as a Word file." },
];

/** The book's look for print: Lora when the e-reader would have chosen, since a printed page has to carry its own font. */
const forPrint = (settings: ExportSettings): ExportSettings => (settings.font === "none" ? { ...settings, font: "lora" } : settings);

/** Making the book into a file: how it looks, and where it goes. */
export function ExportDialog({
  project,
  chapters,
  onFlush,
  onSettings,
  onClose,
}: {
  project: WritingProject;
  chapters: WritingChapter[];
  /** Saves the chapter being written, so the export has its latest words. */
  onFlush: () => Promise<WritingChapter[]>;
  /** Keeps the settings as they're changed, so the preview shows them. */
  onSettings: (settings: ExportSettings) => void;
  onClose: () => void;
}) {
  const [settings, setSettings] = useState(() => readExport(project.export));
  const [format, setFormat] = useState<ExportFormat>(() => {
    try {
      const saved = localStorage.getItem("tbv.writing.exportFormat");
      return FORMATS.some((f) => f.value === saved) ? (saved as ExportFormat) : "epub";
    } catch {
      return "epub";
    }
  });
  const [addToLibrary, setAddToLibrary] = useState(!isWeb);
  const [saveCopy, setSaveCopy] = useState(isWeb);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const publisher = usePublisher();
  const set = (change: Partial<ExportSettings>) => {
    // Changing a setting a style chose keeps the style's looks, with that one setting changed.
    const next = { ...settings, ...change };
    setSettings(next);
    onSettings(next);
  };
  const setPrint = (change: Partial<ExportSettings["print"]>) => set({ print: { ...settings.print, ...change } });
  const setManuscript = (change: Partial<ExportSettings["manuscript"]>) => set({ manuscript: { ...settings.manuscript, ...change } });
  const pick = (f: ExportFormat) => {
    setFormat(f);
    setError(null);
    try {
      localStorage.setItem("tbv.writing.exportFormat", f);
    } catch {
      // Remembered for this time only.
    }
  };
  const problems = exportProblems(chapters);
  const hasParts = chapters.some((c) => c.role === "part");
  const lede = FORMATS.find((f) => f.value === format)!.lede;

  const input = (latest: WritingChapter[], s: ExportSettings) => bookInput(project, latest, s);

  const make = async () => {
    if (format === "epub" && !addToLibrary && !saveCopy) return setError("Choose where the EPUB goes.");
    // A style or a print PDF chosen while trying TBV needs Publisher to export once the trial is over.
    if (!publisher.allowed && (format === "pdf" || (format !== "txt" && format !== "manuscript" && settings.bookStyle)))
      return publisher.check(format === "pdf" ? "Print-ready PDF" : "Book styles", () => undefined);
    setError(null);
    try {
      if (format === "epub") {
        setBusy("Making the EPUB…");
        const latest = await onFlush();
        const fileName = epubFileName(project.title);
        const path = saveCopy && !isWeb ? await api.pickEpubSavePath(fileName) : null;
        if (saveCopy && !isWeb && !path && !addToLibrary) return setBusy(null);
        const bytes = await makeEpub(project, latest, settings);
        await api.setWritingExport(project.id, JSON.stringify(settings));
        await api.saveWritingEpub(bytes, fileName, path, addToLibrary);
        toast(addToLibrary ? (path ? "Saved, and being added to your library." : "Being added to your library.") : isWeb ? "The EPUB has been downloaded." : "The EPUB has been saved.");
        return onClose();
      }
      if (format === "pdf") {
        // Windows saves the PDF itself; elsewhere the print dialog has "Save as PDF".
        const path = isWindows ? await api.pickExportPath(bookFileName(project.title, "pdf"), "pdf") : null;
        if (isWindows && !path) return;
        setBusy("Laying out the pages…");
        const latest = await onFlush();
        await api.setWritingExport(project.id, JSON.stringify(settings));
        const pages = await api.printBook(printHtml(await input(latest, forPrint(settings)), settings.print), path);
        try {
          localStorage.setItem(pagesKey(project.id), String(pages));
        } catch {
          // The cover maker guesses from the words instead.
        }
        toast(path ? `The PDF has been saved: ${pages} pages.` : `${pages} pages, ready to print or save as a PDF.`);
        return onClose();
      }
      const extension = format === "txt" ? "txt" : "docx";
      const fileName = bookFileName(format === "manuscript" ? `${project.title} (manuscript)` : project.title, extension);
      const path = isWeb ? null : await api.pickExportPath(fileName, extension);
      if (!isWeb && !path) return;
      setBusy(format === "txt" ? "Making the text file…" : "Making the Word file…");
      const latest = await onFlush();
      await api.setWritingExport(project.id, JSON.stringify(settings));
      const book = await input(latest, settings);
      const bytes = format === "txt" ? new TextEncoder().encode(buildTxt(book)) : await buildDocx(book, format === "manuscript" ? settings.manuscript : null);
      await api.saveExportFile(bytes, fileName, path);
      toast(isWeb ? `${fileName} has been downloaded.` : `${fileName} has been saved.`);
      onClose();
    } catch (e) {
      setError(String(e).replace(/^Error: /, ""));
    } finally {
      setBusy(null);
    }
  };

  const select = <T extends string | number>(label: string, value: T, options: { value: T; label: string }[], onChange: (v: T) => void, autoFocus = false) => (
    <label className="field">
      <span>{label}</span>
      <select
        autoFocus={autoFocus}
        value={String(value)}
        onChange={(e) => onChange(options.find((o) => String(o.value) === e.target.value)!.value)}
      >
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
  const check = (label: string, checked: boolean, onChange: (v: boolean) => void) => (
    <label className="check-row">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
  const styled = format === "epub" || format === "pdf" || format === "docx";

  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <form
        className="dialog writing-dialog writing-export"
        role="dialog"
        aria-label="Export"
        onSubmit={(e) => {
          e.preventDefault();
          void make();
        }}
        onKeyDown={(e) => e.key === "Escape" && !busy && onClose()}
      >
        <h2>Export</h2>
        <div className="segmented writing-export-formats" role="radiogroup" aria-label="Format">
          {FORMATS.map((f) => (
            <button key={f.value} type="button" role="radio" aria-checked={format === f.value} onClick={() => (f.value === "pdf" ? publisher.check("Print-ready PDF", () => pick(f.value)) : pick(f.value))}>
              {f.label}
            </button>
          ))}
        </div>
        <p className="muted dialog-lede">{lede}</p>

        {styled && (
          <p className="muted writing-export-style">
            Book style: <b>{BOOK_STYLES.find((s) => s.id === settings.bookStyle)?.label ?? "Your own"}</b>. Choose and compare styles in Preview, before exporting.
          </p>
        )}

        {styled && (
          <details className="writing-export-more" open={!settings.bookStyle}>
            <summary>Fonts, headings and paragraphs</summary>
            {select("Font", settings.font, FONTS, (font) => set({ font }), true)}
            {select("Scene breaks", settings.sceneBreak, BREAKS, (sceneBreak) => set({ sceneBreak }))}
            {format === "epub" && select("Table of contents", settings.tocDepth, DEPTHS, (tocDepth) => set({ tocDepth }))}
            <div className="writing-export-styles">
              {select("Paragraphs", settings.paragraphs, [{ value: "indent", label: "Indented" }, { value: "space", label: "Spaced" }], (paragraphs) => set({ paragraphs }))}
              {select("Lines", settings.align, [{ value: "justify", label: "Justified" }, { value: "left", label: "Ragged right" }], (align) => set({ align }))}
              {select("Chapter titles", settings.titles, [{ value: "center", label: "Centred" }, { value: "left", label: "On the left" }], (titles) => set({ titles }))}
            </div>
            {check("Start each chapter on a new page", settings.newPage, (newPage) => set({ newPage }))}
            <div className="writing-export-styles">
              {select(
                "Chapter headings",
                settings.chapterHeading,
                [
                  { value: "title", label: "The title only" },
                  { value: "number", label: "Chapter 1, then the title" },
                  { value: "words", label: "Chapter One, then the title" },
                  { value: "numeral", label: "1, then the title" },
                ],
                (chapterHeading) => set({ chapterHeading }),
              )}
              {hasParts &&
                select(
                  "Chapter numbers",
                  settings.numbering,
                  [
                    { value: "restart", label: "Start again in each section" },
                    { value: "continuous", label: "Run on through the book" },
                  ],
                  (numbering) => set({ numbering }),
                )}
            </div>
            {check("A large first letter at the start of each chapter", settings.dropCap, (dropCap) => set({ dropCap }))}
            {check("The first line of each chapter in small capitals", settings.smallCaps, (smallCaps) => set({ smallCaps }))}
          </details>
        )}

        {format === "pdf" && (
          <fieldset className="writing-export-group">
            <legend>Pages</legend>
            {select("Trim size", settings.print.trim, TRIMS.map((t) => ({ value: t.value, label: t.label })), (trim) => setPrint({ trim }))}
            {check("Mirrored margins, wider on the inside (grows with the page count)", settings.print.mirrored, (mirrored) => setPrint({ mirrored }))}
            {check("Start chapters on a right-hand page", settings.print.chaptersRight, (chaptersRight) => setPrint({ chaptersRight }))}
            {check("Running heads: the book's title on the left, the chapter's on the right", settings.print.runningHeads, (runningHeads) => setPrint({ runningHeads }))}
            {check("Page numbers", settings.print.pageNumbers, (pageNumbers) => setPrint({ pageNumbers }))}
            {check("Bleed: an extra eighth of an inch for pictures that run to the edge", settings.print.bleed, (bleed) => setPrint({ bleed }))}
            <p className="muted writing-export-note">
              {isWindows
                ? "The PDF is saved where you choose, at the trim size, with its fonts inside it."
                : isApp
                  ? "The pages open in a window with the print dialog. Choose Save as PDF there."
                  : "The pages open in a new tab with the print dialog. Choose Save as PDF there, with margins set to None."}
            </p>
          </fieldset>
        )}

        {format === "manuscript" && (
          <fieldset className="writing-export-group">
            <legend>Manuscript</legend>
            <div className="writing-export-styles">
              {select(
                "Layout",
                settings.manuscript.layout,
                [
                  { value: "shunn", label: "Prose (Shunn standard)" },
                  { value: "poetry", label: "Poetry (standard poetry)" },
                ],
                (layout) => setManuscript({ layout }),
                true,
              )}
              {select(
                "Font",
                settings.manuscript.font,
                [
                  { value: "times", label: "Times New Roman, 12 pt" },
                  { value: "courier", label: "Courier New, 12 pt" },
                ],
                (font) => setManuscript({ font }),
              )}
            </div>
            <p className="muted writing-export-note">Your details go at the top of the first page. Your surname, the title and the page number head every page after it.</p>
            <label className="field">
              <span>Your name (legal name, if you write under a pen name)</span>
              <input value={settings.manuscript.name} placeholder={project.author ?? ""} onChange={(e) => setManuscript({ name: e.target.value })} />
            </label>
            <label className="field">
              <span>Address</span>
              <textarea rows={2} value={settings.manuscript.address} onChange={(e) => setManuscript({ address: e.target.value })} />
            </label>
            <div className="writing-export-styles">
              <label className="field">
                <span>Phone</span>
                <input value={settings.manuscript.phone} onChange={(e) => setManuscript({ phone: e.target.value })} />
              </label>
              <label className="field">
                <span>Email</span>
                <input type="email" value={settings.manuscript.email} onChange={(e) => setManuscript({ email: e.target.value })} />
              </label>
            </div>
          </fieldset>
        )}

        {format === "epub" && (
          <div className="writing-export-where">
            <strong>Where it goes</strong>
            {!isWeb && check("Add it to my library, where it can be read or sent to a Kindle", addToLibrary, setAddToLibrary)}
            {check(isWeb ? "Download the EPUB" : "Save a copy on this computer", saveCopy, setSaveCopy)}
          </div>
        )}
        {(error || problems.length > 0) && (
          <p className="form-error" role="alert">
            {error ?? problems[0]}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="btn btn-quiet" onClick={onClose} disabled={!!busy}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={!!busy || problems.length > 0}>
            {busy ?? (format === "pdf" && !isWindows ? "Lay out and print" : "Export")}
          </button>
        </div>
      </form>
    </div>
  );
}

const dateOf = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });

/**
 * A book's drafts. A new draft keeps the book as it stands, locked, and you
 * carry on writing; earlier drafts open in the reader for highlights and
 * notes, and stay in Scribe (never the Archive).
 */
export function DraftsDialog({
  project,
  onFlush,
  onOpen,
  onClose,
}: {
  project: WritingProject;
  /** Saves the chapter being written and gives the latest chapters. */
  onFlush: () => Promise<WritingChapter[]>;
  onOpen: (bookId: string) => void;
  onClose: () => void;
}) {
  const [drafts, setDrafts] = useState<WritingDraft[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<WritingDraft | null>(null);
  const toast = useToast();
  useEffect(() => {
    let current = true;
    api.writingDrafts(project.id).then(
      (list) => current && setDrafts(list),
      (e: unknown) => current && setError(String(e)),
    );
    return () => {
      current = false;
    };
  }, [project.id]);
  const next = (drafts ?? []).reduce((n, d) => Math.max(n, d.number), 0) + 1;

  const keep = async () => {
    setBusy(true);
    setError(null);
    try {
      const latest = await onFlush();
      const problems = exportProblems(latest);
      if (problems.length) throw new Error(problems[0]);
      const draft = await api.saveWritingDraft(project.id, await makeEpub({ ...project, title: `${project.title} (Draft ${next})` }, latest, readExport(project.export)));
      setDrafts((list) => [...(list ?? []), draft]);
      toast(`Kept as Draft ${draft.number}. You're writing Draft ${draft.number + 1} now.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  };

  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="dialog writing-dialog writing-drafts" role="dialog" aria-label="Drafts" onKeyDown={(e) => e.key === "Escape" && !busy && onClose()}>
        <h2>Drafts</h2>
        <p className="muted dialog-lede">
          A new draft keeps the book as it is now, locked, and you carry on writing. Open an earlier draft to read it, highlight it and make notes,
          just like a book in your Archive.
        </p>
        <div className="writing-draft-now">
          <div>
            <strong>Draft {next}</strong>
            <span className="muted"> · the one you're writing</span>
          </div>
          <button type="button" className="btn btn-primary" disabled={busy || drafts === null} onClick={() => void keep()}>
            <Icon name="plus" size={15} /> {busy ? "Keeping…" : "New draft"}
          </button>
        </div>
        {drafts === null && !error ? (
          <div className="library-loading" aria-busy="true" aria-label="Loading drafts" />
        ) : drafts && drafts.length > 0 ? (
          <ul className="writing-draft-list">
            {[...drafts].reverse().map((d) => (
              <li key={d.id}>
                <button type="button" className="writing-draft" onClick={() => onOpen(d.bookId)}>
                  <Icon name="lock" size={15} />
                  <span className="writing-draft-name">Draft {d.number}</span>
                  <span className="muted">
                    {dateOf(d.createdAt)} · {d.words.toLocaleString()} {d.words === 1 ? "word" : "words"}
                  </span>
                </button>
                <Menu
                  label={`More for Draft ${d.number}`}
                  className="icon-btn icon-btn-s"
                  align="end"
                  trigger={<Icon name="more" size={16} />}
                  items={[
                    { label: "Open", icon: "bookOpen", onSelect: () => onOpen(d.bookId) },
                    "divider",
                    { label: "Delete draft…", icon: "trash", danger: true, onSelect: () => setDeleting(d) },
                  ]}
                />
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted writing-drafts-empty">No earlier drafts yet.</p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="btn btn-quiet" onClick={onClose} disabled={busy}>
            Done
          </button>
        </div>
      </div>
      {deleting && (
        <ConfirmDialog
          title={`Delete Draft ${deleting.number}?`}
          body="Its highlights and notes go too, on all your devices. The book you're writing isn't changed."
          confirm="Delete draft"
          danger
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            const gone = deleting;
            setDeleting(null);
            void api.deleteWritingDraft(gone.id).then(
              () => setDrafts((list) => (list ?? []).filter((d) => d.id !== gone.id)),
              (e) => toast(String(e)),
            );
          }}
        />
      )}
    </div>
  );
}

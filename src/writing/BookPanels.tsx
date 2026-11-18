// The Style and Layout tabs beside the page (a computer or tablet). Style is
// the book styles; Layout is the whole book's look (title position, font,
// paragraphs, chapter headings and numbers), with the title position of the
// page or pages chosen in Contents set apart from the book's (embre, 18 November).

import type { WritingChapter } from "../api/types";
import { usePublisher } from "../license/Publisher";
import { BOOK_STYLES, chooseStyle } from "./bookStyles";
import type { ExportSettings } from "./epub";
import { readPage, type TitlePosition } from "./pages";

/** The book styles, to pick from: Plain is the book's own settings. */
export function BookStylePicker({ settings, onSettings, className = "" }: { settings: ExportSettings; onSettings: (next: ExportSettings) => void; className?: string }) {
  const publisher = usePublisher();
  return (
    <div className={`book-styles ${className}`} role="radiogroup" aria-label="Book style">
      <button type="button" role="radio" aria-checked={!settings.bookStyle} className="book-style" onClick={() => onSettings(chooseStyle(settings, null))}>
        <b>Plain</b>
        <span>Your own Layout settings</span>
      </button>
      {BOOK_STYLES.map((s) => (
        <button key={s.id} type="button" role="radio" aria-checked={settings.bookStyle === s.id} className={`book-style book-style-${s.id}`} onClick={() => publisher.check("Book styles", () => onSettings(chooseStyle(settings, s.id)))}>
          <b>{s.label}</b>
          <span>{s.about}</span>
        </button>
      ))}
    </div>
  );
}

export function StylePanel({ settings, onSettings }: { settings: ExportSettings; onSettings: (next: ExportSettings) => void }) {
  return (
    <div className="book-panel">
      <p className="muted book-panel-note">A book style sets the font, chapter headings, first letters and scene breaks together. The page shows it as you write, and Layout can change any part of it.</p>
      <BookStylePicker settings={settings} onSettings={onSettings} className="book-panel-styles" />
    </div>
  );
}

const POSITIONS: { value: TitlePosition; label: string }[] = [
  { value: "left", label: "Left" },
  { value: "center", label: "Centre" },
  { value: "right", label: "Right" },
];

function Choice<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (value: T) => void }) {
  return (
    <label className="format-row">
      <span>{label}</span>
      <select value={String(value)} onChange={(e) => onChange(options.find((o) => String(o.value) === e.target.value)!.value)}>
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Positions({ label, value, onChange, book }: { label: string; value: TitlePosition | null; onChange: (value: TitlePosition | null) => void; book?: TitlePosition }) {
  return (
    <div className="format-row">
      <span>{label}</span>
      <div className="segmented book-panel-positions" role="radiogroup" aria-label={label}>
        {book && (
          <button type="button" role="radio" aria-checked={value === null} className={value === null ? "is-active" : ""} onClick={() => onChange(null)} title={`As the book: ${POSITIONS.find((p) => p.value === book)?.label}`}>
            Book
          </button>
        )}
        {POSITIONS.map((p) => (
          <button key={p.value} type="button" role="radio" aria-checked={value === p.value} className={value === p.value ? "is-active" : ""} onClick={() => onChange(p.value)}>
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function LayoutPanel({
  settings,
  onSettings,
  hasParts,
  pages,
  onTitles,
}: {
  settings: ExportSettings;
  onSettings: (next: ExportSettings) => void;
  hasParts: boolean;
  /** The page open, or the pages chosen in Contents with Shift. */
  pages: WritingChapter[];
  onTitles: (pages: WritingChapter[], titles: TitlePosition | null) => void;
}) {
  const set = (change: Partial<ExportSettings>) => onSettings({ ...settings, ...change });
  const own = pages.map((c) => readPage(c.page, c.role).titles);
  const shared = own.every((t) => t === own[0]) ? (own[0] ?? null) : undefined;
  return (
    <div className="book-panel">
      <section className="format-section">
        <h3>Chapter titles</h3>
        <Positions label="Title Position" value={settings.titles} onChange={(titles) => titles && set({ titles })} />
        <Choice
          label="Headings"
          value={settings.chapterHeading}
          options={[
            { value: "title", label: "The title only" },
            { value: "number", label: "Chapter 1, then the title" },
            { value: "words", label: "Chapter One, then the title" },
            { value: "numeral", label: "1, then the title" },
          ]}
          onChange={(chapterHeading) => set({ chapterHeading })}
        />
        <Choice
          label="Numbering"
          value={settings.numbering}
          options={[
            { value: "continuous", label: "Run on through the book" },
            { value: "restart", label: "Start again in each section" },
          ]}
          onChange={(numbering) => set({ numbering })}
        />
        {!hasParts && <p className="format-note muted">Starting again only matters once the body has sections, such as Part One.</p>}
        <Choice
          label="Contents Lists"
          value={settings.tocDepth}
          options={[
            { value: 1, label: "Chapters" },
            { value: 2, label: "Chapters and headings" },
            { value: 3, label: "Chapters, headings and subheadings" },
          ]}
          onChange={(tocDepth) => set({ tocDepth })}
        />
        <label className="check-row">
          <input type="checkbox" checked={settings.newPage} onChange={(e) => set({ newPage: e.target.checked })} />
          <span>Start each chapter on a new page</span>
        </label>
      </section>

      {pages.length > 0 && (
        <section className="format-section">
          <h3>{pages.length > 1 ? `The ${pages.length} pages chosen` : "This page"}</h3>
          <Positions label="Title Position" value={shared ?? null} book={settings.titles} onChange={(titles) => onTitles(pages, titles)} />
          {shared === undefined && <p className="format-note muted">The pages chosen don't all match yet.</p>}
          <p className="format-note muted">Hold Shift and click a page in Contents to choose every page from the open one to there.</p>
        </section>
      )}

      <section className="format-section">
        <h3>Text</h3>
        <Choice
          label="Font"
          value={settings.font}
          options={[
            { value: "none", label: "Reader's choice" },
            { value: "lora", label: "Lora" },
            { value: "crimson", label: "Crimson Pro" },
            { value: "echolume", label: "Echolume" },
          ]}
          onChange={(font) => set({ font })}
        />
        <Choice label="Paragraphs" value={settings.paragraphs} options={[{ value: "indent", label: "Indented" }, { value: "space", label: "Spaced" }]} onChange={(paragraphs) => set({ paragraphs })} />
        <Choice label="Lines" value={settings.align} options={[{ value: "justify", label: "Justified" }, { value: "left", label: "Ragged right" }]} onChange={(align) => set({ align })} />
        <Choice
          label="Scene Breaks"
          value={settings.sceneBreak}
          options={[
            { value: "asterisks", label: "* * *" },
            { value: "ornament", label: "❦" },
            { value: "line", label: "A short line" },
            { value: "space", label: "A blank space" },
          ]}
          onChange={(sceneBreak) => set({ sceneBreak })}
        />
        <label className="check-row">
          <input type="checkbox" checked={settings.dropCap} onChange={(e) => set({ dropCap: e.target.checked })} />
          <span>A large first letter at the start of each chapter</span>
        </label>
        <label className="check-row">
          <input type="checkbox" checked={settings.smallCaps} onChange={(e) => set({ smallCaps: e.target.checked })} />
          <span>The first line of each chapter in small capitals</span>
        </label>
      </section>
    </div>
  );
}

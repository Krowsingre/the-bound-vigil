// Everything that goes into the exported book, in place of the editor: the cover,
// the title page, every section in order and the pages Scribe makes, as the
// EPUB has them. It follows your writing as it's saved.

import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { WritingChapter, WritingProject } from "../api/types";
import { Icon } from "../components/Icon";
import { usePublisher } from "../license/Publisher";
import { BOOK_STYLES, chooseStyle } from "./bookStyles";
import { bookOrder, copyrightHtml, inlineXhtml, madeSectionHtml, previewHtml, type ExportSettings } from "./epub";
import { imageMime, loadBookFonts } from "./fonts";
import { EditionFields } from "./EditionFields";
import { editionName, firstEdition, type EditionInfo } from "./bookEditions";
import { IsbnGuide } from "./IsbnGuide";
import { citationFormats, citedIds, emptySource, makeCiter, type CitationStyle, type Citer, type Source } from "./sources";
import { SourceForm } from "./SourcesDialog";
import { DEFAULT_RIGHTS, KINDS, readPage, type CopyrightDetails } from "./pages";

const WIDTHS = [
  { value: "phone", label: "Phone", px: 380 },
  { value: "ereader", label: "E-reader", px: 560 },
  { value: "full", label: "Wide", px: 0 },
] as const;

export function BookPreview({
  project,
  chapters,
  settings,
  showing,
  picked,
  onShowList,
  onSettings,
  onClose,
}: {
  project: WritingProject;
  chapters: WritingChapter[];
  settings: ExportSettings;
  /** The section to show, when one is picked in the list. */
  showing: string | null;
  /** Goes up each time a page is picked in the list. */
  picked?: number;
  /** Brings back the list of pages, when it's hidden. */
  onShowList?: () => void;
  /** Saves a book style picked here, so the export uses it. */
  onSettings: (next: ExportSettings) => void;
  onClose: () => void;
}) {
  const publisher = usePublisher();
  const [url, setUrl] = useState<string | null>(null);
  const [width, setWidth] = useState<(typeof WIDTHS)[number]["value"]>("ereader");
  const [cover, setCover] = useState<{ bytes: Uint8Array; mime: string } | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const scroll = useRef(0);

  useEffect(() => {
    let current = true;
    if (!project.cover) return setCover(null);
    api.writingCover(project.id).then(
      (bytes) => {
        const mime = bytes.length ? imageMime(bytes) : null;
        if (current) setCover(mime ? { bytes, mime } : null);
      },
      () => current && setCover(null),
    );
    return () => {
      current = false;
    };
  }, [project.id, project.cover, project.coverPath]);

  // Made again a moment after the words or settings change, keeping the place it was scrolled to.
  useEffect(() => {
    let made: string | null = null;
    let current = true;
    const timer = window.setTimeout(async () => {
      const [fonts, citer] = await Promise.all([
        loadBookFonts(settings, chapters).catch(() => ({ font: null, passageFonts: [] })),
        makeCiter(settings.citationStyle, settings.sources, bookOrder(chapters), settings.customSourceFormat).catch(() => null),
      ]);
      if (!current) return;
      made = URL.createObjectURL(new Blob([previewHtml({ project, chapters, settings, cover, citer, ...fonts })], { type: "text/html" }));
      scroll.current = frame.current?.contentWindow?.scrollY ?? scroll.current;
      setUrl(made);
    }, 350);
    return () => {
      current = false;
      window.clearTimeout(timer);
      if (made) {
        const old = made;
        // Let go once the next one has replaced it.
        window.setTimeout(() => URL.revokeObjectURL(old), 2000);
      }
    };
  }, [project, chapters, settings, cover]);

  const goTo = (id: string | null, smooth: boolean) => {
    const n = id ? bookOrder(chapters).findIndex((c) => c.id === id) + 1 : 0;
    const target = n ? frame.current?.contentDocument?.getElementById(`c${n}`) : null;
    target?.closest("article")?.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
  };
  useEffect(() => goTo(showing, true), [showing, picked]); // eslint-disable-line react-hooks/exhaustive-deps

  const px = WIDTHS.find((w) => w.value === width)?.px ?? 0;
  return (
    <aside className="book-preview" aria-label="Preview of the book">
      <div className="book-preview-head">
        {onShowList && (
          <button type="button" className="writing-list-toggle" aria-label="Show the list" title="Show the list" onClick={onShowList}>
            <Icon name="panelLeft" size={17} />
          </button>
        )}
        <strong>Preview</strong>
        <div className="segmented book-preview-widths" role="radiogroup" aria-label="Preview width">
          {WIDTHS.map((w) => (
            <button key={w.value} type="button" role="radio" aria-checked={width === w.value} className={width === w.value ? "is-active" : ""} onClick={() => setWidth(w.value)}>
              {w.label}
            </button>
          ))}
        </div>
        <button type="button" className="btn btn-quiet btn-small" onClick={onClose}>
          <Icon name="edit" size={16} /> Back to writing
        </button>
      </div>
      {/* Book styles are chosen here, where they can be seen, before the book is ever exported. */}
      <div className="book-styles book-preview-styles" role="radiogroup" aria-label="Book style">
        <button type="button" role="radio" aria-checked={!settings.bookStyle} className="book-style" onClick={() => onSettings(chooseStyle(settings, null))}>
          <b>Your own</b>
          <span>Your export settings</span>
        </button>
        {BOOK_STYLES.map((s) => (
          <button key={s.id} type="button" role="radio" aria-checked={settings.bookStyle === s.id} className={`book-style book-style-${s.id}`} onClick={() => publisher.check("Book styles", () => onSettings(chooseStyle(settings, s.id)))}>
            <b>{s.label}</b>
            <span>{s.about}</span>
          </button>
        ))}
      </div>
      <div className="book-preview-stage">
        {url ? (
          <iframe
            ref={frame}
            title="The book as it will be exported"
            src={url}
            sandbox="allow-same-origin"
            style={px ? { width: px } : undefined}
            onLoad={() => frame.current?.contentWindow?.scrollTo(0, scroll.current)}
          />
        ) : (
          <div className="library-loading" aria-busy="true" aria-label="Making the preview" />
        )}
      </div>
    </aside>
  );
}

const field = (label: string, value: string, onChange: (v: string) => void, placeholder = "", multiline = false) => (
  <label className="field" key={label}>
    <span>{label}</span>
    {multiline ? <textarea rows={3} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} /> : <input value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />}
  </label>
);

/**
 * A page Scribe makes (half title, title page, copyright, contents): what it
 * will say, the details it's made from, and a way to write it yourself.
 */
function BibliographyEntries({ citer, chapters, sources, onEdit }: {
  citer: Citer | null;
  chapters: WritingChapter[];
  sources: Source[];
  onEdit: (source: Source) => void;
}) {
  const cited = new Set(citedIds(chapters));
  const entries = citer?.bibliography() ?? [];
  if (!entries.length) return <p className="muted">Sources you cite or add here will appear in the bibliography.</p>;
  return (
    <ul className="writing-bibliography">
      {entries.map(({ sourceId, html }) => {
        const source = sources.find((entry) => entry.id === sourceId);
        if (!source) return null;
        const additional = source.includeInBibliography && !cited.has(source.id);
        const text = inlineXhtml(html.replace(/^<div[^>]*>|<\/div>$/g, "")).replace(/ href="[^"]*"/g, "");
        return (
          <li key={source.id} className={additional ? "is-additional" : undefined}>
            <div>
              <span dangerouslySetInnerHTML={{ __html: text }} />
              {additional && <small>Added here · uncited</small>}
            </div>
            <button type="button" className="icon-btn" aria-label={`Edit ${source.title}`} onClick={() => onEdit(source)}>
              <Icon name="edit" size={16} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function MadePage({
  chapter,
  project,
  chapters,
  settings,
  onTitle,
  onCopyright,
  onEdition,
  onWriteMyself,
  onOpenDetails,
  onOpenSources,
  onSourcesChange,
  onFormatChange,
  canUndoSources,
  canRedoSources,
  onUndoSources,
  onRedoSources,
}: {
  chapter: WritingChapter;
  project: WritingProject;
  chapters: WritingChapter[];
  settings: ExportSettings;
  onTitle: (title: string) => void;
  onCopyright: (details: CopyrightDetails) => void;
  /** The book's edition and its ISBNs, kept with the export settings. */
  onEdition: (edition: EditionInfo) => void;
  onWriteMyself: (html: string) => void;
  onOpenDetails: () => void;
  onOpenSources: () => void;
  onSourcesChange: (sources: Source[]) => void;
  onFormatChange: (style: CitationStyle, customFormat: string) => void;
  canUndoSources: boolean;
  canRedoSources: boolean;
  onUndoSources: () => void;
  onRedoSources: () => void;
}) {
  const page = readPage(chapter.page, chapter.role);
  const [title, setTitle] = useState(chapter.title);
  const [copyright, setCopyright] = useState(settings.copyright);
  const [citer, setCiter] = useState<Citer | null>(null);
  const [editingSource, setEditingSource] = useState<Source | null>(null);
  const [customFormat, setCustomFormat] = useState(settings.customSourceFormat);
  useEffect(() => setCustomFormat(settings.customSourceFormat), [settings.customSourceFormat]);
  useEffect(() => {
    if (page.kind !== "sources") return;
    let current = true;
    void makeCiter(settings.citationStyle, settings.sources, bookOrder(chapters), settings.customSourceFormat).then((c) => current && setCiter(c), () => current && setCiter(null));
    return () => {
      current = false;
    };
  }, [page.kind, settings.citationStyle, settings.customSourceFormat, settings.sources, chapters]);
  useEffect(() => setTitle(chapter.title), [chapter.id, chapter.title]);
  useEffect(() => setCopyright(settings.copyright), [settings.copyright]);
  // Until the writer sets one, a first edition, named as their old Edition box had it.
  const [edition, setEdition] = useState<EditionInfo | null>(settings.edition);
  useEffect(() => setEdition(settings.edition), [settings.edition]);
  const shownEdition = edition ?? { ...firstEdition(""), group: "", name: settings.copyright.edition.trim() || editionName(1) };
  const changeEdition = (next: EditionInfo) => {
    const kept = next.group ? next : { ...next, group: crypto.randomUUID() };
    setEdition(kept);
    onEdition(kept);
  };
  const html =
    page.kind === "sources" ? "" : page.kind === "copyright" ? copyrightHtml(project, copyright, new Date(), edition) : madeSectionHtml({ project, chapters, settings, citer }, chapter.id);
  // Links between pages only work in the book itself.
  const shown = html.replace(/ href="[^"]*"/g, "");
  const change = (c: Partial<CopyrightDetails>) => {
    const next = { ...copyright, ...c };
    setCopyright(next);
    onCopyright(next);
  };
  const about = {
    half_title: "Just the book's title, on a page of its own before the title page.",
    title_page: "Made from the book's title, author and series. Change them in Book details.",
    copyright: "Made from the details below and the book's author. Leave a box empty to leave it out.",
    contents: "Lists the sections shown in the contents, and stays up to date as you add, rename and move them.",
    sources: "Cited sources appear here automatically. You can edit their details or add sources directly to the bibliography.",
  }[page.kind as "half_title" | "title_page" | "copyright" | "contents" | "sources"];
  return (
    <div className="writing-sheet made-page">
      <p className="made-page-kind">{KINDS[page.kind].label}</p>
      {page.showTitle && (
        <input
          className="writing-chapter-title made-page-title"
          aria-label="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title !== chapter.title && onTitle(title)}
        />
      )}
      <p className="muted">{about}</p>
      {page.kind === "copyright" && (
        <div className="made-page-fields">
          <div className="writing-details-row">
            {field("Year", copyright.year, (year) => change({ year }), String(new Date().getFullYear()))}
            {field("Copyright holder", copyright.holder, (holder) => change({ holder }), project.author ?? "The author")}
          </div>
          <EditionFields edition={shownEdition} onChange={changeEdition} />
          {/* An ISBN typed before editions came in, with no format: shown until it's moved to its format above. */}
          {copyright.isbn.trim() && !Object.values(shownEdition.isbns).some((i) => i?.trim()) && field("ISBN (format not given)", copyright.isbn, (isbn) => change({ isbn }), "None")}
          {field("Publisher", copyright.publisher, (publisher) => change({ publisher }), "None")}
          {field("Rights", copyright.rights, (rights) => change({ rights }), DEFAULT_RIGHTS, true)}
          {field("Notice", copyright.notice, (notice) => change({ notice }), "e.g. This is a work of fiction. Names and places are the author's invention.", true)}
          <label className="check-row">
            <input type="checkbox" checked={copyright.credit !== false} onChange={(e) => change({ credit: e.target.checked })} />
            <span>Add "Made with The Bound Vigil" at the foot of the page</span>
          </label>
          <IsbnGuide />
        </div>
      )}
      {page.kind === "sources" ? (
        <div className="made-page-preview made-sources" aria-label="Bibliography entries" onKeyDown={(event) => {
          if (editingSource || !(event.ctrlKey || event.metaKey) || event.altKey || (event.target as HTMLElement).closest("input, textarea, select, [contenteditable=true]")) return;
          const key = event.key.toLowerCase();
          if (key !== "z" && key !== "y") return;
          event.preventDefault();
          if (key === "y" || event.shiftKey) onRedoSources();
          else onUndoSources();
        }}>
          {editingSource ? (
            <SourceForm
              key={editingSource.id}
              source={editingSource}
              onCancel={() => setEditingSource(null)}
              onSave={(source) => {
                const existing = settings.sources.some((entry) => entry.id === source.id);
                onSourcesChange(existing ? settings.sources.map((entry) => entry.id === source.id ? source : entry) : [...settings.sources, source]);
                setEditingSource(null);
              }}
            />
          ) : (
            <>
              <div className="settings-actions">
                <label className="field">
                  <span>Format</span>
                  <select value={settings.citationStyle} onChange={(event) => onFormatChange(event.target.value as CitationStyle, settings.customSourceFormat)}>
                    {citationFormats(settings.citationStyle).map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
                <button type="button" className="btn btn-quiet" disabled={!canUndoSources} onClick={onUndoSources}><Icon name="undo" size={16} /> Undo</button>
                <button type="button" className="btn btn-quiet" disabled={!canRedoSources} onClick={onRedoSources}><Icon name="redo" size={16} /> Redo</button>
              </div>
              {settings.citationStyle === "custom" && (
                <div className="settings-actions">
                  <label className="field">
                    <span>Custom entry format</span>
                    <input value={customFormat} maxLength={500} placeholder="{author}. {title}. {date}" onChange={(event) => setCustomFormat(event.target.value)} />
                    <small>Fields: {"{author}, {title}, {publication}, {publisher}, {date}, {url}, {doi}"}. Leave blank for the default numbered layout.</small>
                  </label>
                  <button type="button" className="btn btn-quiet" disabled={customFormat === settings.customSourceFormat} onClick={() => onFormatChange("custom", customFormat)}>Apply format</button>
                </div>
              )}
              <BibliographyEntries citer={citer} chapters={chapters} sources={settings.sources} onEdit={setEditingSource} />
              <button type="button" className="btn btn-quiet" onClick={() => setEditingSource({ ...emptySource(crypto.randomUUID()), includeInBibliography: true })}>
                <Icon name="plus" size={16} /> Add a source
              </button>
            </>
          )}
        </div>
      ) : (
        <div className={`made-page-preview made-${page.kind}`} aria-label="What the page will say" dangerouslySetInnerHTML={{ __html: shown }} />
      )}
      <div className="settings-actions">
        {page.kind === "title_page" || page.kind === "half_title" ? (
          <button type="button" className="btn btn-quiet" onClick={onOpenDetails}>
            <Icon name="info" size={16} /> Book details
          </button>
        ) : null}
        {page.kind === "sources" && (
          <button type="button" className="btn btn-quiet" onClick={onOpenSources}>
            <Icon name="bookClosed" size={16} /> Sources and citation style
          </button>
        )}
        {page.kind !== "sources" && (
          <button type="button" className="btn btn-quiet" onClick={() => onWriteMyself(html)}>
            <Icon name="edit" size={16} /> Write it myself
          </button>
        )}
      </div>
    </div>
  );
}

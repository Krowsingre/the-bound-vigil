// Everything that goes into the exported book, in place of the editor: the cover,
// the title page, every section in order and the pages Scribe makes, as the
// EPUB has them. It follows your writing as it's saved.

import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { WritingChapter, WritingProject } from "../api/types";
import { Icon } from "../components/Icon";
import { bookOrder, copyrightHtml, madeSectionHtml, previewHtml, type ExportSettings } from "./epub";
import { imageMime, loadBookFonts } from "./fonts";
import { makeCiter, type Citer } from "./sources";
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
  onClose: () => void;
}) {
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
        makeCiter(settings.citationStyle, settings.sources, bookOrder(chapters)).catch(() => null),
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
export function MadePage({
  chapter,
  project,
  chapters,
  settings,
  onTitle,
  onCopyright,
  onWriteMyself,
  onOpenDetails,
  onOpenSources,
}: {
  chapter: WritingChapter;
  project: WritingProject;
  chapters: WritingChapter[];
  settings: ExportSettings;
  onTitle: (title: string) => void;
  onCopyright: (details: CopyrightDetails) => void;
  onWriteMyself: (html: string) => void;
  onOpenDetails: () => void;
  onOpenSources: () => void;
}) {
  const page = readPage(chapter.page, chapter.role);
  const [title, setTitle] = useState(chapter.title);
  const [copyright, setCopyright] = useState(settings.copyright);
  const [citer, setCiter] = useState<Citer | null>(null);
  useEffect(() => {
    if (page.kind !== "sources") return;
    let current = true;
    void makeCiter(settings.citationStyle, settings.sources, bookOrder(chapters)).then((c) => current && setCiter(c), () => current && setCiter(null));
    return () => {
      current = false;
    };
  }, [page.kind, settings.citationStyle, settings.sources, chapters]);
  useEffect(() => setTitle(chapter.title), [chapter.id, chapter.title]);
  useEffect(() => setCopyright(settings.copyright), [settings.copyright]);
  const html =
    page.kind === "copyright" ? copyrightHtml(project, copyright) : madeSectionHtml({ project, chapters, settings, citer }, chapter.id);
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
    sources: "Lists every source you cite, in the book's citation style, and stays up to date as you cite more. Choose the style in Sources.",
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
          <div className="writing-details-row">
            {field("ISBN", copyright.isbn, (isbn) => change({ isbn }), "None")}
            {field("Edition", copyright.edition, (edition) => change({ edition }), "e.g. First edition, 2026")}
          </div>
          {field("Publisher", copyright.publisher, (publisher) => change({ publisher }), "None")}
          {field("Rights", copyright.rights, (rights) => change({ rights }), DEFAULT_RIGHTS, true)}
          {field("Notice", copyright.notice, (notice) => change({ notice }), "e.g. This is a work of fiction. Names and places are the author's invention.", true)}
        </div>
      )}
      <div className={`made-page-preview made-${page.kind}`} aria-label="What the page will say" dangerouslySetInnerHTML={{ __html: shown }} />
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
        <button type="button" className="btn btn-quiet" onClick={() => onWriteMyself(html)}>
          <Icon name="edit" size={16} /> Write it myself
        </button>
      </div>
    </div>
  );
}

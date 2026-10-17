import { useEffect, useMemo, useState } from "react";
import type { Annotation, BookPreview, HighlightColor, ReaderBook } from "../api/types";
import { api } from "../api";
import { BookCover } from "../components/BookCover";
import { Icon } from "../components/Icon";
import { Menu, type MenuEntry } from "../components/Menu";
import { ProgressBar } from "../components/ProgressBar";
import { StarRating } from "../components/StarRating";
import { authorLine, percent, relativeTime } from "../lib/format";
import {
  annotationPage,
  counts,
  filterAnnotations,
  isBookmark,
  isHighlight,
  isNote,
  type AnnotationFilter,
  type AnnotationSort,
} from "./annotations";
import { formatNumber, formatPage, type ContentsEntry, type PagePosition } from "./pages";
import { HIGHLIGHT_COLORS, highlightHex } from "./settings";

export interface AnnotationHandlers {
  onGo: (a: Annotation) => void;
  onEditNote: (a: Annotation) => void;
  onRecolor: (a: Annotation, color: HighlightColor) => void;
  onDelete: (a: Annotation) => void;
  onCopy: (a: Annotation) => void;
}

function annotationMenu(a: Annotation, h: AnnotationHandlers): MenuEntry[] {
  const entries: MenuEntry[] = [{ label: "Go to", icon: "arrowRight", onSelect: () => h.onGo(a) }];
  if (!isBookmark(a)) {
    entries.push(
      { label: a.note ? "Edit note" : "Add a note", icon: "edit", onSelect: () => h.onEditNote(a) },
      "divider",
      ...HIGHLIGHT_COLORS.map((c) => ({
        label: c.label,
        checked: (a.color ?? "rose") === c.value,
        onSelect: () => h.onRecolor(a, c.value),
      })),
      "divider",
      { label: "Copy text", icon: "copy", onSelect: () => h.onCopy(a) },
    );
  }
  entries.push({ label: "Delete", icon: "trash", danger: true, onSelect: () => h.onDelete(a) });
  return entries;
}

function Where({ a, totalPages }: { a: Annotation; totalPages: number }) {
  const page = annotationPage(a, totalPages);
  return (
    <p className="ann-where">
      {page !== null && <span>Page {formatNumber(page)}</span>}
      {a.locator.chapter && <span>{a.locator.chapter}</span>}
    </p>
  );
}

/** One highlight, note or bookmark in a list. */
export function AnnotationItem({
  a,
  totalPages,
  handlers,
  compact = false,
}: {
  a: Annotation;
  totalPages: number;
  handlers: AnnotationHandlers;
  compact?: boolean;
}) {
  const bookmark = isBookmark(a);
  return (
    <li className={`ann${compact ? " ann-compact" : ""}`} style={{ ["--ann-color" as string]: bookmark ? "var(--text-muted)" : highlightHex(a.color) }}>
      <div className="ann-row">
        <button type="button" className="ann-open" onClick={() => handlers.onGo(a)}>
          {bookmark ? (
            <span className="ann-bookmark">
              <Icon name="bookmark" size={14} filled /> {a.excerpt || "Bookmark"}
            </span>
          ) : (
            <q className="ann-quote">{a.excerpt}</q>
          )}
        </button>
        {!compact && (
          <Menu label="Highlight options" trigger={<Icon name="more" size={16} />} items={annotationMenu(a, handlers)} className="icon-btn icon-btn-s" />
        )}
      </div>
      <Where a={a} totalPages={totalPages} />
      {a.note && (
        <div className="ann-note">
          <p className="ann-note-head">
            <Icon name="note" size={14} /> My note <span>{relativeTime(a.updatedAt)}</span>
          </p>
          <p className="ann-note-body">{a.note}</p>
          {!compact && (
            <button type="button" className="btn btn-quiet btn-s" onClick={() => handlers.onEditNote(a)}>
              Edit note
            </button>
          )}
        </div>
      )}
    </li>
  );
}

function EmptyList({ children }: { children: React.ReactNode }) {
  return <p className="panel-empty">{children}</p>;
}

type LeftTab = "contents" | "highlights" | "notes";

/** Book, progress and contents, on the left. */
export function LeftPanel({
  book,
  fraction,
  position,
  previouslyOpenedAt,
  entries,
  currentId,
  annotations,
  onGoHref,
  handlers,
}: {
  book: BookPreview;
  fraction: number | null;
  position: PagePosition | null;
  previouslyOpenedAt: string | null;
  entries: ContentsEntry[];
  currentId: string | null;
  annotations: Annotation[];
  onGoHref: (href: string) => void;
  handlers: AnnotationHandlers;
}) {
  const [tab, setTab] = useState<LeftTab>("contents");
  const current = entries.find((e) => e.id === currentId);
  const [open, setOpen] = useState<Set<string>>(() => new Set(current?.parents ?? []));
  // Follow the reader: keep the current chapter's part unfolded.
  useEffect(() => {
    if (current) setOpen((o) => (current.parents.every((p) => o.has(p)) ? o : new Set([...o, ...current.parents])));
  }, [current]);

  const visible = entries.filter((e) => e.parents.every((p) => open.has(p)));
  const toggle = (id: string) =>
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const highlights = annotations.filter(isHighlight);
  const notes = annotations.filter(isNote);
  const total = position?.total ?? 0;

  return (
    <aside className="reader-left" aria-label="Book and contents">
      <div className="reader-book">
        <BookCover book={book} size="s" />
        <div className="reader-book-text">
          <h2>{book.title}</h2>
          <p className="reader-book-author">{authorLine(book.authors)}</p>
          <ProgressBar value={fraction ?? 0} />
          <p className="reader-book-meta">{percent(fraction)} complete</p>
          <p className="reader-book-meta">
            <Icon name="clock" size={15} />
            {previouslyOpenedAt ? `Last opened ${relativeTime(previouslyOpenedAt)}` : "First time reading"}
          </p>
          {position && (
            <p className="reader-book-meta">
              <Icon name="bookmark" size={15} />
              {formatPage(position)}
            </p>
          )}
        </div>
      </div>
      <div className="tabs reader-tabs" role="tablist">
        {(
          [
            ["contents", "Contents"],
            ["highlights", "Highlights"],
            ["notes", "Notes"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            className={`tab${tab === value ? " is-active" : ""}`}
            onClick={() => setTab(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="reader-left-body">
        {tab === "contents" &&
          (visible.length ? (
            <ul className="toc">
              {visible.map((e) => (
                <li key={e.id} className={e.id === currentId ? "toc-current" : undefined} style={{ ["--depth" as string]: e.depth }}>
                  {e.hasChildren ? (
                    <button
                      type="button"
                      className="toc-toggle"
                      aria-label={open.has(e.id) ? `Fold ${e.label}` : `Unfold ${e.label}`}
                      aria-expanded={open.has(e.id)}
                      onClick={() => toggle(e.id)}
                    >
                      <Icon name={open.has(e.id) ? "chevronDown" : "chevronRight"} size={16} />
                    </button>
                  ) : (
                    <span className="toc-toggle" />
                  )}
                  <button type="button" className="toc-link" aria-current={e.id === currentId ? "location" : undefined} onClick={() => onGoHref(e.href)}>
                    <span className="toc-label">{e.label}</span>
                    {e.page !== null && <span className="toc-page">{formatNumber(e.page)}</span>}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyList>This book has no table of contents.</EmptyList>
          ))}
        {tab === "highlights" &&
          (highlights.length ? (
            <ul className="ann-list">
              {highlights.map((a) => (
                <AnnotationItem key={a.id} a={a} totalPages={total} handlers={handlers} compact />
              ))}
            </ul>
          ) : (
            <EmptyList>Select words in the book to highlight them.</EmptyList>
          ))}
        {tab === "notes" &&
          (notes.length ? (
            <ul className="ann-list">
              {notes.map((a) => (
                <AnnotationItem key={a.id} a={a} totalPages={total} handlers={handlers} compact />
              ))}
            </ul>
          ) : (
            <EmptyList>Select words in the book, then choose Add a note.</EmptyList>
          ))}
      </div>
    </aside>
  );
}

const FILTERS: { value: AnnotationFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "highlights", label: "Highlights" },
  { value: "notes", label: "Notes" },
  { value: "bookmarks", label: "Bookmarks" },
];

export type RightTab = "notes" | "info";

/** Highlights & Notes, and Book info, on the right. */
export function RightPanel({
  tab,
  onTab,
  onClose,
  annotations,
  totalPages,
  handlers,
  info,
}: {
  tab: RightTab;
  onTab: (tab: RightTab) => void;
  onClose: () => void;
  annotations: Annotation[];
  totalPages: number;
  handlers: AnnotationHandlers;
  info: ReaderBook;
}) {
  const [filter, setFilter] = useState<AnnotationFilter>("all");
  const [sort, setSort] = useState<AnnotationSort>("position");
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const n = counts(annotations);
  const list = useMemo(() => filterAnnotations(annotations, filter, sort, query), [annotations, filter, sort, query]);

  return (
    <aside className="reader-right" aria-label="Highlights, notes and book info">
      <div className="reader-right-head">
        <div className="tabs" role="tablist">
          <button type="button" role="tab" className={`tab${tab === "notes" ? " is-active" : ""}`} aria-selected={tab === "notes"} onClick={() => onTab("notes")}>
            Highlights &amp; Notes
          </button>
          <button type="button" role="tab" className={`tab${tab === "info" ? " is-active" : ""}`} aria-selected={tab === "info"} onClick={() => onTab("info")}>
            Book Info
          </button>
        </div>
        <button type="button" className="icon-btn icon-btn-s" aria-label="Close panel" title="Close panel" onClick={onClose}>
          <Icon name="close" size={16} />
        </button>
      </div>
      {tab === "notes" ? (
        <>
          <div className="segmented" role="radiogroup" aria-label="Show">
            {FILTERS.map((f) => (
              <button key={f.value} type="button" role="radio" aria-checked={filter === f.value} onClick={() => setFilter(f.value)}>
                {f.label} ({n[f.value]})
              </button>
            ))}
          </div>
          <div className="reader-right-tools">
            <Menu
              label="Sort"
              align="start"
              className="link-btn"
              trigger={
                <>
                  Sort: {sort === "position" ? "Position in book" : "Recently added"} <Icon name="chevronDown" size={14} />
                </>
              }
              items={[
                { label: "Position in book", checked: sort === "position", onSelect: () => setSort("position") },
                { label: "Recently added", checked: sort === "recent", onSelect: () => setSort("recent") },
              ]}
            />
            <button
              type="button"
              className="icon-btn icon-btn-s"
              aria-label="Search highlights and notes"
              aria-pressed={searching}
              onClick={() => {
                setSearching((s) => !s);
                setQuery("");
              }}
            >
              <Icon name="search" size={16} />
            </button>
          </div>
          {searching && (
            <input
              className="input reader-right-search"
              type="search"
              placeholder="Search highlights and notes…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
          )}
          {list.length ? (
            <ul className="ann-list reader-right-list">
              {list.map((a) => (
                <AnnotationItem key={a.id} a={a} totalPages={totalPages} handlers={handlers} />
              ))}
            </ul>
          ) : (
            <EmptyList>
              {annotations.length === 0
                ? "Nothing here yet. Select words in the book to highlight them or add a note. The bookmark button at the top marks the page you're on."
                : "Nothing matches."}
            </EmptyList>
          )}
        </>
      ) : (
        <BookInfo info={info} totalPages={totalPages} />
      )}
    </aside>
  );
}

function BookInfo({ info, totalPages }: { info: ReaderBook; totalPages: number }) {
  const b = info.book;
  const [rating, setRating] = useState(b.rating);
  useEffect(() => setRating(b.rating), [b.id, b.rating]);
  const rate = (next: number | null) => {
    const before = rating;
    setRating(next);
    api.setRating(b.id, next).catch(() => setRating(before));
  };
  const rows: [string, string | null][] = [
    ["Title", b.title],
    ["Author", b.authors.length ? b.authors.join(", ") : null],
    ["Series", b.series ? `${b.series}${b.seriesIndex != null ? `, book ${b.seriesIndex}` : ""}` : null],
    ["Publisher", info.publisher],
    ["Language", info.language],
    ["Format", b.format.toUpperCase()],
    ["Pages", totalPages > 0 ? formatNumber(totalPages) : null],
    ["File size", info.fileSize > 0 ? `${(info.fileSize / 1_048_576).toFixed(1)} MB` : null],
    ["Added", new Date(b.addedAt).toLocaleDateString()],
    ["Finished", b.finishedAt ? new Date(b.finishedAt).toLocaleDateString() : null],
  ];
  return (
    <div className="book-info">
      <div className="book-info-rating">
        <span>Your rating</span>
        <StarRating value={rating} onChange={rate} />
      </div>
      <dl>
        {rows
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
      </dl>
      {b.synopsis && (
        <>
          <h3>Description</h3>
          <p className="book-info-synopsis">{b.synopsis}</p>
        </>
      )}
      <p className="book-info-note">
        Pages are counted the same way on every device and at every text size, so a page number always means the same place.
      </p>
    </div>
  );
}

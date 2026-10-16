import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import type { HighlightColor, NoteItem, NotesPage, NotesQuery, NotesSort, NotesTab } from "../api/types";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Icon } from "../components/Icon";
import { Menu, type MenuEntry } from "../components/Menu";
import { useToast } from "../components/Toast";
import { HIGHLIGHT_COLORS } from "../reader/settings";
import { NewNoteDialog } from "./NewNoteDialog";
import { KIND_LABEL } from "./noteInfo";
import { NotePanel } from "./NotePanel";
import { NoteCards, NoteList, NoteTable, type NotesLayout } from "./NoteViews";

const TABS: { tab: NotesTab; label: string; count: keyof NotesPage["counts"] }[] = [
  { tab: "all", label: "All notes", count: "all" },
  { tab: "highlights", label: "Highlights", count: "highlights" },
  { tab: "annotations", label: "Annotations", count: "annotations" },
  { tab: "book_notes", label: "Book notes", count: "bookNotes" },
  { tab: "personal", label: "Personal notes", count: "personal" },
];

const SORTS: { sort: NotesSort; label: string }[] = [
  { sort: "recent", label: "Recently added" },
  { sort: "updated", label: "Recently changed" },
  { sort: "book", label: "Book, in reading order" },
];

const LAYOUTS: { layout: NotesLayout; label: string; icon: "grid" | "list" | "rows" }[] = [
  { layout: "cards", label: "Cards", icon: "grid" },
  { layout: "list", label: "List", icon: "list" },
  { layout: "compact", label: "Compact list", icon: "rows" },
];

const PREFS_KEY = "tbv.notes.view";

function readPrefs(): { sort: NotesSort; layout: NotesLayout } {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}");
    return {
      sort: SORTS.some((s) => s.sort === p.sort) ? p.sort : "recent",
      layout: LAYOUTS.some((l) => l.layout === p.layout) ? p.layout : "list",
    };
  } catch {
    return { sort: "recent", layout: "list" };
  }
}

type Writing = { kind: "personal" | "book_note" } | null;

export function Notes({
  search,
  refreshKey,
  onClearSearch,
  onOpenBook,
}: {
  /** The header's search box, which searches notes on this page. */
  search: string;
  refreshKey: number;
  onClearSearch: () => void;
  onOpenBook: (bookId: string, cfi?: string) => void;
}) {
  const [tab, setTab] = useState<NotesTab>("all");
  const [prefs, setPrefs] = useState(readPrefs);
  const [bookId, setBookId] = useState<string | null>(null);
  const [colors, setColors] = useState<HighlightColor[]>([]);
  const [page, setPage] = useState<NotesPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [writing, setWriting] = useState<Writing>(null);
  const [deleting, setDeleting] = useState<NoteItem | null>(null);
  const [related, setRelated] = useState<NoteItem[]>([]);
  const toast = useToast();

  const query: NotesQuery = useMemo(
    () => ({ tab, sort: prefs.sort, search: search.trim() || null, bookId: bookId as NotesQuery["bookId"], colors }),
    [tab, prefs.sort, search, bookId, colors],
  );

  useEffect(() => {
    let current = true;
    api.getNotes(query).then(
      (p) => {
        if (!current) return;
        setPage(p);
        setError(null);
      },
      (e: unknown) => current && setError(String(e)),
    );
    return () => {
      current = false;
    };
  }, [query, refreshKey, reload]);

  const notes = page?.notes ?? [];
  const selected = notes.find((n) => n.id === selectedId) ?? notes[0] ?? null;

  // Related notes: the rest of the selected note's book, whatever tab is showing.
  const selectedBook = selected?.book?.id ?? null;
  useEffect(() => {
    if (!selectedBook) return setRelated([]);
    let current = true;
    api
      .getNotes({ tab: "all", sort: "book", search: null, bookId: selectedBook as NotesQuery["bookId"], colors: [] })
      .then((p) => current && setRelated(p.notes), () => current && setRelated([]));
    return () => {
      current = false;
    };
  }, [selectedBook, refreshKey, reload]);

  const changePrefs = (change: Partial<typeof prefs>) =>
    setPrefs((p) => {
      const next = { ...p, ...change };
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(next));
      } catch {
        /* just not remembered */
      }
      return next;
    });

  const changed = () => setReload((n) => n + 1);

  const openInReader = useCallback(
    (n: NoteItem) => n.book && onOpenBook(n.book.id, n.locator?.cfi ?? undefined),
    [onOpenBook],
  );

  const saveWords = async (n: NoteItem, words: string, title: string | null) => {
    try {
      if (n.kind === "personal") await api.savePersonalNote(n.id, title, words);
      else if (n.kind === "book_note") await api.saveBookNote(n.book!.id, n.id, words);
      else await api.setAnnotationNote(n.id, words);
      changed();
    } catch (e) {
      toast(`That note couldn't be saved: ${String(e)}`);
      throw e;
    }
  };

  const copy = (n: NoteItem) => {
    const text = [n.excerpt && `“${n.excerpt}”`, n.title, n.note, n.book && `— ${n.book.title}`].filter(Boolean).join("\n\n");
    void navigator.clipboard?.writeText(text).then(
      () => toast("Copied."),
      () => toast("Copying isn't available here."),
    );
  };

  const menuFor = (n: NoteItem): MenuEntry[] => [
    ...(n.book
      ? [{ label: n.locator?.cfi ? "Open in Reader" : "Open the book", icon: "arrowRight" as const, onSelect: () => openInReader(n) }]
      : []),
    { label: "Copy", icon: "copy", onSelect: () => copy(n) },
    ...(n.kind === "highlight" || n.kind === "annotation"
      ? ([
          "divider",
          { heading: <strong>Colour</strong> },
          ...HIGHLIGHT_COLORS.map((c) => ({
            label: c.label,
            checked: n.color === c.value,
            onSelect: () => void colorNote(n, c.value),
          })),
        ] as MenuEntry[])
      : []),
    ...(n.book && n.book.id !== bookId
      ? [{ label: `All notes from ${n.book.title}`, onSelect: () => setBookId(n.book!.id) }]
      : []),
    "divider",
    { label: `Delete ${KIND_LABEL[n.kind].toLowerCase()}…`, icon: "trash", danger: true, onSelect: () => setDeleting(n) },
  ];

  const colorNote = async (n: NoteItem, color: HighlightColor) => {
    try {
      const all = await api.getAnnotations(n.book!.id);
      const a = all.find((x) => x.id === n.id);
      if (!a) return;
      await api.saveAnnotation({ id: a.id, bookId: a.bookId, kind: a.kind, excerpt: a.excerpt, note: a.note, color, locator: a.locator });
      changed();
    } catch (e) {
      toast(String(e));
    }
  };

  const filterCount = (bookId ? 1 : 0) + colors.length;
  const toggleColor = (c: HighlightColor) => setColors((cs) => (cs.includes(c) ? cs.filter((x) => x !== c) : [...cs, c]));
  const filterBook = page?.books.find((b) => b.id === bookId);
  const filterItems: MenuEntry[] = [
    { heading: <strong>Highlight colour</strong> },
    ...HIGHLIGHT_COLORS.map((c) => ({ label: c.label, checked: colors.includes(c.value), onSelect: () => toggleColor(c.value) })),
    "divider",
    { heading: <strong>Book</strong> },
    { label: "Every book", checked: !bookId, onSelect: () => setBookId(null) },
    ...(page?.books ?? []).map((b) => ({ label: b.title, checked: bookId === b.id, onSelect: () => setBookId(b.id) })),
    ...(filterCount
      ? (["divider", { label: "Clear filters", onSelect: () => (setBookId(null), setColors([])) }] as MenuEntry[])
      : []),
  ];

  const Layout = { cards: NoteCards, list: NoteList, compact: NoteTable }[prefs.layout];
  const anyNotes = (page?.counts.all ?? 0) > 0;
  const filtered = !!search.trim() || filterCount > 0;

  let body: React.ReactNode;
  if (error)
    body = (
      <div className="library-empty" role="alert">
        <h2>Your notes couldn't be loaded</h2>
        <p className="muted">{error}</p>
        <button type="button" className="btn btn-primary" onClick={changed}>
          Try again
        </button>
      </div>
    );
  else if (!page) body = <div className="library-loading" aria-busy="true" aria-label="Loading your notes" />;
  else if (!anyNotes)
    body = (
      <div className="library-empty">
        <h2>No notes yet</h2>
        <p className="muted">
          Highlight words while you read and they gather here. You can also write about a whole book, or keep notes of your own.
        </p>
        <div className="hero-actions">
          <button type="button" className="btn btn-primary" onClick={() => setWriting({ kind: "personal" })}>
            Write a personal note
          </button>
          <button type="button" className="btn btn-quiet" onClick={() => setWriting({ kind: "book_note" })}>
            Write about a book
          </button>
        </div>
      </div>
    );
  else if (notes.length === 0)
    body = (
      <div className="library-empty">
        <h2>Nothing matches</h2>
        <p className="muted">
          {search.trim() ? `No notes here match “${search.trim()}”.` : "No notes of this kind yet."}
          {filterCount > 0 && " Filters are also narrowing the list."}
        </p>
        <div className="hero-actions">
          {search.trim() && (
            <button type="button" className="btn btn-quiet" onClick={onClearSearch}>
              Clear search
            </button>
          )}
          {filterCount > 0 && (
            <button type="button" className="btn btn-quiet" onClick={() => (setBookId(null), setColors([]))}>
              Clear filters
            </button>
          )}
        </div>
      </div>
    );
  else
    body = (
      <div className="notes-layout">
        <div className="notes-list">
          <Layout notes={notes} selectedId={selected?.id ?? null} menuFor={menuFor} onSelect={(n) => setSelectedId(n.id)} onOpen={openInReader} />
        </div>
        {selected && (
          <NotePanel
            note={selected}
            related={related.filter((r) => r.id !== selected.id)}
            menu={menuFor(selected)}
            onSave={saveWords}
            onOpenInReader={openInReader}
            onSelect={(n) => {
              // A related note hidden by the current filters brings them all down.
              if (!notes.some((x) => x.id === n.id)) {
                setTab("all");
                setColors([]);
                onClearSearch();
              }
              setSelectedId(n.id);
            }}
            onViewAllForBook={(id) => {
              setTab("all");
              setBookId(id);
            }}
          />
        )}
      </div>
    );

  return (
    <div className="library notes-page">
      <header className="library-head">
        <div>
          <h1 className="library-title">Notes</h1>
          <p className="eyebrow">Highlights, annotations and reflections from your reading</p>
        </div>
        <Menu
          label="New note"
          className="btn btn-primary"
          trigger={
            <>
              <span aria-hidden>+</span> New note
            </>
          }
          items={[
            { label: "Personal note", icon: "notes", onSelect: () => setWriting({ kind: "personal" }) },
            { label: "Note about a book…", icon: "library", onSelect: () => setWriting({ kind: "book_note" }) },
          ]}
        />
      </header>

      <div className="library-toolbar">
        <div className="tabs" role="tablist" aria-label="Kinds of note">
          {TABS.map((t) => (
            <button
              key={t.tab}
              type="button"
              role="tab"
              aria-selected={tab === t.tab}
              className={`tab${tab === t.tab ? " is-active" : ""}`}
              onClick={() => setTab(t.tab)}
            >
              {t.label} {page && <span className="tab-count">{page.counts[t.count]}</span>}
            </button>
          ))}
        </div>
        <div className="toolbar-controls">
          <Menu
            label="Sort notes"
            className="toolbar-button"
            trigger={
              <>
                Sort: {SORTS.find((s) => s.sort === prefs.sort)?.label} <Icon name="chevronDown" size={14} />
              </>
            }
            items={SORTS.map((s) => ({ label: s.label, checked: prefs.sort === s.sort, onSelect: () => changePrefs({ sort: s.sort }) }))}
          />
          <Menu
            label="Filter notes"
            className="toolbar-button"
            trigger={
              <>
                <Icon name="filter" size={15} /> Filter{filterCount > 0 && <span className="tab-count">{filterCount}</span>}{" "}
                <Icon name="chevronDown" size={14} />
              </>
            }
            items={filterItems}
          />
          <div className="layout-switch" role="radiogroup" aria-label="Layout">
            {LAYOUTS.map((l) => (
              <button
                key={l.layout}
                type="button"
                role="radio"
                aria-checked={prefs.layout === l.layout}
                aria-label={l.label}
                title={l.label}
                className={prefs.layout === l.layout ? "is-active" : undefined}
                onClick={() => changePrefs({ layout: l.layout })}
              >
                <Icon name={l.icon} size={16} />
              </button>
            ))}
          </div>
        </div>
      </div>

      {(filtered || filterBook) && page && (
        <p className="search-note">
          {[
            search.trim() && `Showing notes matching “${search.trim()}”`,
            filterBook && `from ${filterBook.title}`,
            colors.length > 0 && `in ${colors.join(", ")}`,
          ]
            .filter(Boolean)
            .join(" ")}
          <button
            type="button"
            className="view-all"
            onClick={() => {
              onClearSearch();
              setBookId(null);
              setColors([]);
            }}
          >
            Clear
          </button>
        </p>
      )}

      <div className="library-body">{body}</div>

      {writing && (
        <NewNoteDialog
          kind={writing.kind}
          onCancel={() => setWriting(null)}
          onSaved={(n) => {
            setWriting(null);
            setTab("all");
            setSelectedId(n.id);
            changed();
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title={`Delete this ${KIND_LABEL[deleting.kind].toLowerCase()}?`}
          body={
            deleting.kind === "highlight" || deleting.kind === "annotation"
              ? "The highlight and anything you wrote on it go from every device. The book itself isn't changed."
              : "The note goes from every device."
          }
          confirm="Delete"
          danger
          onCancel={() => setDeleting(null)}
          onConfirm={() =>
            void api.deleteNote(deleting.id, deleting.kind).then(
              () => {
                setDeleting(null);
                if (selectedId === deleting.id) setSelectedId(null);
                changed();
              },
              (e: unknown) => toast(String(e)),
            )
          }
        />
      )}
    </div>
  );
}

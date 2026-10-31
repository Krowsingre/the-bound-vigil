// Scribe's notes: everything you've noted (All), your own notes (Notes), and
// what you noted from books, highlights included (Book notes). A row of
// filters, the notes pinned above the rest, then the rest. Opening a note
// slides it in at the side, where it can be read and changed.

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import type { HighlightColor, NoteItem, NoteKind, NotesPage, NotesQuery, NotesSort, WritingProject } from "../api/types";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Icon } from "../components/Icon";
import { Menu, type MenuEntry } from "../components/Menu";
import { useToast } from "../components/Toast";
import { HIGHLIGHT_COLORS } from "../reader/settings";
import { NoteToBookDialog } from "../writing/NoteToBookDialog";
import { NewNoteDialog } from "./NewNoteDialog";
import { KIND_LABEL } from "./noteInfo";
import { NotePanel } from "./NotePanel";
import { NoteCards, NoteList, NoteTable, type NotesLayout } from "./NoteViews";
import { TagsDialog } from "./TagsDialog";

/** The tabs of Scribe that show notes. */
export type NotesKindTab = "all" | "personal" | "book_notes";

/** What the notes are called under each tab, above the list. */
export const NOTES_HEADING: Record<NotesKindTab, string> = { all: "All notes", personal: "Notes", book_notes: "Reading notes" };

const SORTS: { sort: NotesSort; label: string }[] = [
  { sort: "recent", label: "Date added" },
  { sort: "updated", label: "Date modified" },
  { sort: "book", label: "Book, in reading order" },
];

const LAYOUTS: { layout: NotesLayout; label: string; icon: "grid" | "list" | "rows" }[] = [
  { layout: "cards", label: "Cards", icon: "grid" },
  { layout: "list", label: "List", icon: "list" },
  { layout: "compact", label: "Compact list", icon: "rows" },
];

/** The kinds each tab can narrow to. */
const TYPES: Record<NotesKindTab, NoteKind[]> = {
  all: ["personal", "book_note", "highlight", "annotation"],
  book_notes: ["book_note", "highlight", "annotation"],
  personal: [],
};
const TYPE_LABEL: Record<NoteKind, string> = {
  personal: "Notes",
  book_note: "Book notes",
  highlight: "Highlights",
  annotation: "Highlights with notes",
};

type When = "any" | "week" | "month" | "year";
const WHEN: { when: When; label: string }[] = [
  { when: "any", label: "Any date" },
  { when: "week", label: "Last 7 days" },
  { when: "month", label: "Last 30 days" },
  { when: "year", label: "This year" },
];

function sinceOf(when: When): string | null {
  const day = 86_400_000;
  if (when === "week") return new Date(Date.now() - 7 * day).toISOString();
  if (when === "month") return new Date(Date.now() - 30 * day).toISOString();
  if (when === "year") return new Date(new Date().getFullYear(), 0, 1).toISOString();
  return null;
}

/** Pinned notes shown before "Show all". */
const PINNED_SHOWN = 3;

/** 0.62 starts everyone on cards, as in embre's concept; the sort chosen before is kept. */
const PREFS_KEY = "tbv.notes.view.062";
const OLD_PREFS_KEY = "tbv.notes.view";

function readPrefs(): { sort: NotesSort; layout: NotesLayout } {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "null") ?? { sort: JSON.parse(localStorage.getItem(OLD_PREFS_KEY) ?? "{}").sort };
    return {
      sort: SORTS.some((s) => s.sort === p.sort) ? p.sort : "recent",
      layout: LAYOUTS.some((l) => l.layout === p.layout) ? p.layout : "cards",
    };
  } catch {
    return { sort: "recent", layout: "cards" };
  }
}

export type NewNoteKind = "personal" | "book_note";
type Writing = { kind: NewNoteKind } | null;

/** A filter's dropdown: its words, and a chevron. */
function FilterButton({ label, on, items }: { label: string; on: boolean; items: MenuEntry[] }) {
  return (
    <Menu
      label={label}
      className={`notes-filter${on ? " is-on" : ""}`}
      trigger={
        <>
          <span>{label}</span>
          <Icon name="chevronDown" size={13} />
        </>
      }
      items={items}
    />
  );
}

export function Notes({
  search,
  refreshKey,
  onClearSearch,
  onOpenBook,
  ask = null,
  onGoToBooks,
  kindTab,
}: {
  /** The header's search box, which searches notes on this page. */
  search: string;
  refreshKey: number;
  onClearSearch: () => void;
  onOpenBook: (bookId: string, cfi?: string) => void;
  /** Scribe's New button asking for a note; a new `n` asks again. */
  ask?: { kind: NewNoteKind; n: number } | null;
  /** Where "Add to a book I'm writing" sends you when there's no book yet. Left out, notes aren't offered to books. */
  onGoToBooks?: () => void;
  /** Which of Scribe's tabs is showing. */
  kindTab: NotesKindTab;
}) {
  const [prefs, setPrefs] = useState(readPrefs);
  const [type, setType] = useState<NoteKind | null>(null);
  const [bookId, setBookId] = useState<string | null>(null);
  const [colors, setColors] = useState<HighlightColor[]>([]);
  const [tag, setTag] = useState<string | null>(null);
  const [when, setWhen] = useState<When>("any");
  const [page, setPage] = useState<NotesPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Set<string> | null>(null);
  const [allPinned, setAllPinned] = useState(false);
  const [writing, setWriting] = useState<Writing>(null);
  const [deleting, setDeleting] = useState<NoteItem[] | null>(null);
  const [tagging, setTagging] = useState<NoteItem | null>(null);
  const [related, setRelated] = useState<NoteItem[]>([]);
  const [toBook, setToBook] = useState<NoteItem | null>(null);
  const toast = useToast();

  useEffect(() => {
    if (ask) setWriting({ kind: ask.kind });
  }, [ask]);

  // Another tab: its own kinds, and nothing open or chosen.
  useEffect(() => {
    setType(null);
    setSelectedId(null);
    setChosen(null);
  }, [kindTab]);

  const query: NotesQuery = useMemo(
    () => ({
      tab: kindTab,
      sort: prefs.sort,
      search: search.trim() || null,
      bookId: bookId as NotesQuery["bookId"],
      colors,
      tag,
      since: sinceOf(when),
    }),
    [kindTab, prefs.sort, search, bookId, colors, tag, when],
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

  const notes = useMemo(() => (page?.notes ?? []).filter((n) => !type || n.kind === type), [page, type]);
  const pinned = useMemo(
    () => notes.filter((n) => n.pinnedAt).sort((a, b) => (b.pinnedAt ?? "").localeCompare(a.pinnedAt ?? "")),
    [notes],
  );
  const rest = useMemo(() => notes.filter((n) => !n.pinnedAt), [notes]);
  const selected = selectedId ? (notes.find((n) => n.id === selectedId) ?? null) : null;

  // Related notes: the rest of the open note's book, whatever tab is showing.
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

  const textOf = (n: NoteItem) => [n.excerpt && `“${n.excerpt}”`, n.title, n.note, n.book && `— ${n.book.title}`].filter(Boolean).join("\n\n");
  const copy = (list: NoteItem[]) => {
    void navigator.clipboard?.writeText(list.map(textOf).join("\n\n———\n\n")).then(
      () => toast(list.length === 1 ? "Copied." : `${list.length} notes copied.`),
      () => toast("Copying isn't available here."),
    );
  };

  const pin = async (list: NoteItem[], on: boolean) => {
    try {
      for (const n of list) if (!!n.pinnedAt !== on) await api.setNotePinned(n.id, on);
      changed();
    } catch (e) {
      toast(String(e));
    }
  };

  // The books being written in Scribe, which a note can belong to.
  const [projects, setProjects] = useState<WritingProject[]>([]);
  useEffect(() => {
    if (!onGoToBooks) return;
    let current = true;
    api.writingProjects().then(
      (list) => current && setProjects(list),
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [onGoToBooks, refreshKey]);

  const belongTo = async (n: NoteItem, projectId: string | null) => {
    try {
      const done = await api.setNoteProject(n.id, projectId);
      toast(projectId ? `It's with ${done.project?.title ?? "that book"} now, in its Notes beside the pages.` : "It's a note of its own again.");
      changed();
    } catch (e) {
      toast(String(e));
    }
  };

  const saveTags = async (n: NoteItem, tags: string[]) => {
    try {
      await api.setNoteTags(n.id, tags);
      changed();
    } catch (e) {
      toast(String(e));
    }
  };

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

  const menuFor = (n: NoteItem): MenuEntry[] => [
    ...(n.book
      ? [{ label: n.locator?.cfi ? "Open in Reader" : "Open the book", icon: "arrowRight" as const, onSelect: () => openInReader(n) }]
      : []),
    { label: n.pinnedAt ? "Unpin" : "Pin", icon: "pin", onSelect: () => void pin([n], !n.pinnedAt) },
    { label: "Tags…", icon: "tag", onSelect: () => setTagging(n) },
    { label: "Copy", icon: "copy", onSelect: () => copy([n]) },
    ...(onGoToBooks ? [{ label: "Add to a book I'm writing…", icon: "pen" as const, onSelect: () => setToBook(n) }] : []),
    ...(n.kind === "personal" && projects.length
      ? ([
          "divider",
          { heading: <strong>Belongs to</strong> },
          { label: "No book: a note of its own", checked: !n.project, onSelect: () => void belongTo(n, null) },
          ...projects.map((p) => ({ label: p.title || "Untitled book", checked: n.project?.id === p.id, onSelect: () => void belongTo(n, p.id) })),
        ] as MenuEntry[])
      : []),
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
    { label: `Delete ${KIND_LABEL[n.kind].toLowerCase()}…`, icon: "trash", danger: true, onSelect: () => setDeleting([n]) },
  ];

  // Choosing several, or opening one.
  const onCard = (n: NoteItem) => {
    if (!chosen) return setSelectedId((id) => (id === n.id ? null : n.id));
    setChosen((c) => {
      const next = new Set(c);
      if (next.has(n.id)) next.delete(n.id);
      else next.add(n.id);
      return next;
    });
  };
  const chosenNotes = notes.filter((n) => chosen?.has(n.id));

  const types = TYPES[kindTab];
  const filterBook = page?.books.find((b) => b.id === bookId);
  const highlightsShown = kindTab !== "personal" && (!type || type === "highlight" || type === "annotation");
  const typeItems: MenuEntry[] = [
    { label: kindTab === "book_notes" ? "Everything from books" : "All types", checked: !type, onSelect: () => setType(null) },
    ...types.map((k) => ({ label: TYPE_LABEL[k], checked: type === k, onSelect: () => setType(k) })),
    ...(highlightsShown
      ? ([
          "divider",
          { heading: <strong>Highlight colour</strong> },
          ...HIGHLIGHT_COLORS.map((c) => ({
            label: c.label,
            checked: colors.includes(c.value),
            onSelect: () => setColors((cs) => (cs.includes(c.value) ? cs.filter((x) => x !== c.value) : [...cs, c.value])),
          })),
        ] as MenuEntry[])
      : []),
  ];
  const bookItems: MenuEntry[] = [
    { label: "All books", checked: !bookId, onSelect: () => setBookId(null) },
    ...(page?.books ?? []).map((b) => ({ label: b.title, checked: bookId === b.id, onSelect: () => setBookId(b.id) })),
  ];
  const tagItems: MenuEntry[] = [
    { label: "All tags", checked: !tag, onSelect: () => setTag(null) },
    ...(page?.tags.length
      ? page.tags.map((t) => ({ label: t, checked: tag === t, onSelect: () => setTag(t) }))
      : [{ label: "No tags yet. Add them from a note's menu.", disabled: true, onSelect: () => undefined }]),
  ];

  const filterCount = (bookId ? 1 : 0) + colors.length + (type ? 1 : 0) + (tag ? 1 : 0) + (when !== "any" ? 1 : 0);
  const clearFilters = () => {
    setBookId(null);
    setColors([]);
    setType(null);
    setTag(null);
    setWhen("any");
  };

  const Layout = { cards: NoteCards, list: NoteList, compact: NoteTable }[prefs.layout];
  const shownPinned = allPinned ? pinned : pinned.slice(0, PINNED_SHOWN);
  const views = { selectedId: selected?.id ?? null, menuFor, onSelect: onCard, onOpen: openInReader, chosen };

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
  else if (notes.length === 0 && !search.trim() && filterCount === 0)
    // Nothing of this kind yet: the page keeps its shape, with a way to start in the tab's own words.
    body = (
      <section className="notes-section notes-start" aria-labelledby="notes-all">
        <div className="notes-section-head">
          <h2 id="notes-all">{NOTES_HEADING[kindTab]}</h2>
        </div>
        <div className="notes-empty-card">
          <Icon name={kindTab === "personal" ? "notes" : kindTab === "book_notes" ? "bookOpen" : "edit"} size={28} />
          <h3>{kindTab === "personal" ? "No notes yet" : kindTab === "book_notes" ? "No reading notes yet" : "Nothing written yet"}</h3>
          <p className="muted">
            {kindTab === "personal"
              ? "Notes of your own, about anything, live here."
              : kindTab === "book_notes"
                ? "Highlights you make while reading gather here, with anything you write about a book."
                : "Your notes, highlights and thoughts about books gather here."}
          </p>
          <div className="hero-actions">
            {kindTab !== "book_notes" && (
              <button type="button" className="btn btn-primary" onClick={() => setWriting({ kind: "personal" })}>
                Write a note
              </button>
            )}
            {kindTab !== "personal" && (
              <button type="button" className={`btn ${kindTab === "book_notes" ? "btn-primary" : "btn-quiet"}`} onClick={() => setWriting({ kind: "book_note" })}>
                Write about a book
              </button>
            )}
          </div>
        </div>
      </section>
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
            <button type="button" className="btn btn-quiet" onClick={clearFilters}>
              Clear filters
            </button>
          )}
        </div>
      </div>
    );
  else
    body = (
      <div className={`notes-layout${selected ? " has-panel" : ""}`}>
        <div className="notes-list">
          {pinned.length > 0 && (
            <section className="notes-section notes-pinned" aria-labelledby="notes-pinned">
              <div className="notes-section-head">
                <h2 id="notes-pinned">
                  <Icon name="pin" size={17} /> Pinned
                </h2>
                {pinned.length > PINNED_SHOWN && (
                  <button type="button" className="link-btn notes-show-all" aria-expanded={allPinned} onClick={() => setAllPinned((a) => !a)}>
                    {allPinned ? "Show fewer" : `Show all (${pinned.length})`} <Icon name={allPinned ? "chevronUp" : "chevronDown"} size={13} />
                  </button>
                )}
              </div>
              <Layout notes={shownPinned} {...views} />
            </section>
          )}
          {pinned.length > 0 && rest.length > 0 && <div className="rule-diamond" aria-hidden />}
          {rest.length > 0 && (
            <section className="notes-section" aria-labelledby="notes-all">
              <div className="notes-section-head">
                <h2 id="notes-all">{NOTES_HEADING[kindTab]}</h2>
                <div className="notes-section-tools">
                  <Menu
                    label={`Sort: ${SORTS.find((s) => s.sort === prefs.sort)?.label}`}
                    className="notes-filter notes-sort"
                    trigger={
                      <>
                        <span className="muted">Sort:</span> <span>{SORTS.find((s) => s.sort === prefs.sort)?.label}</span>
                        <Icon name="chevronDown" size={13} />
                      </>
                    }
                    items={SORTS.map((s) => ({ label: s.label, checked: prefs.sort === s.sort, onSelect: () => changePrefs({ sort: s.sort }) }))}
                  />
                  <button
                    type="button"
                    className={`notes-filter notes-select${chosen ? " is-on" : ""}`}
                    aria-pressed={!!chosen}
                    onClick={() => {
                      setChosen((c) => (c ? null : new Set()));
                      setSelectedId(null);
                    }}
                  >
                    <Icon name="checkCircle" size={15} /> {chosen ? "Done" : "Select"}
                  </button>
                </div>
              </div>
              <Layout notes={rest} {...views} />
            </section>
          )}
        </div>
        {selected && !chosen && (
          <NotePanel
            key={selected.id}
            note={selected}
            related={related.filter((r) => r.id !== selected.id)}
            menu={menuFor(selected)}
            tags={page?.tags ?? []}
            onSave={saveWords}
            onTags={saveTags}
            onClose={() => setSelectedId(null)}
            onOpenInReader={openInReader}
            onSelect={(n) => {
              // A related note hidden by the current filters brings them all down.
              if (!notes.some((x) => x.id === n.id)) {
                clearFilters();
                onClearSearch();
              }
              setSelectedId(n.id);
            }}
            onViewAllForBook={(id) => {
              clearFilters();
              setBookId(id);
            }}
          />
        )}
      </div>
    );

  return (
    <div className="notes-page">
      {page && !error && (
        <div className="notes-toolbar" role="toolbar" aria-label="Filter notes">
          <div className="notes-filters">
            {types.length > 0 && (
              <FilterButton label={type ? TYPE_LABEL[type] : kindTab === "book_notes" ? "Everything" : "All types"} on={!!type || colors.length > 0} items={typeItems} />
            )}
            {kindTab !== "personal" && <FilterButton label={filterBook?.title ?? "All books"} on={!!bookId} items={bookItems} />}
            <FilterButton label={tag ?? "All tags"} on={!!tag} items={tagItems} />
            <FilterButton
              label={WHEN.find((w) => w.when === when)!.label}
              on={when !== "any"}
              items={WHEN.map((w) => ({ label: w.label, checked: when === w.when, onSelect: () => setWhen(w.when) }))}
            />
            {filterCount > 0 && (
              <button type="button" className="link-btn notes-clear" onClick={clearFilters}>
                Clear
              </button>
            )}
          </div>
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
      )}

      {chosen && (
        <div className="notes-chosen-bar" role="toolbar" aria-label="Chosen notes">
          <span>
            {chosen.size} {chosen.size === 1 ? "note" : "notes"} chosen
          </span>
          <button type="button" className="link-btn" onClick={() => setChosen(new Set(notes.map((n) => n.id)))}>
            Choose all
          </button>
          <span className="notes-chosen-actions">
            <button type="button" className="btn btn-quiet btn-small" disabled={!chosen.size} onClick={() => void pin(chosenNotes, !chosenNotes.every((n) => n.pinnedAt))}>
              <Icon name="pin" size={14} /> {chosenNotes.length > 0 && chosenNotes.every((n) => n.pinnedAt) ? "Unpin" : "Pin"}
            </button>
            <button type="button" className="btn btn-quiet btn-small" disabled={!chosen.size} onClick={() => copy(chosenNotes)}>
              <Icon name="copy" size={14} /> Copy
            </button>
            <button type="button" className="btn btn-quiet btn-small is-danger" disabled={!chosen.size} onClick={() => setDeleting(chosenNotes)}>
              <Icon name="trash" size={14} /> Delete
            </button>
            <button type="button" className="btn btn-primary btn-small" onClick={() => setChosen(null)}>
              Done
            </button>
          </span>
        </div>
      )}

      {search.trim() && page && (
        <p className="search-note">
          Showing notes matching “{search.trim()}”
          <button type="button" className="view-all" onClick={onClearSearch}>
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
            setSelectedId(n.id);
            changed();
          }}
        />
      )}
      {tagging && (
        <TagsDialog
          note={tagging}
          known={page?.tags ?? []}
          onCancel={() => setTagging(null)}
          onSave={(tags) => {
            const n = tagging;
            setTagging(null);
            void saveTags(n, tags);
          }}
        />
      )}
      {toBook && onGoToBooks && (
        <NoteToBookDialog
          note={toBook}
          onClose={() => setToBook(null)}
          onGoToBooks={() => {
            setToBook(null);
            onGoToBooks();
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title={deleting.length === 1 ? `Delete this ${KIND_LABEL[deleting[0].kind].toLowerCase()}?` : `Delete ${deleting.length} notes?`}
          body={
            deleting.some((n) => n.kind === "highlight" || n.kind === "annotation")
              ? "Highlights and anything written on them go from every device. The books themselves aren't changed."
              : deleting.length === 1
                ? "The note goes from every device."
                : "The notes go from every device."
          }
          confirm="Delete"
          danger
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            const gone = deleting;
            void (async () => {
              try {
                for (const n of gone) await api.deleteNote(n.id, n.kind);
              } catch (e) {
                toast(String(e));
              }
              setDeleting(null);
              if (gone.some((n) => n.id === selectedId)) setSelectedId(null);
              setChosen((c) => (c ? new Set([...c].filter((id) => !gone.some((n) => n.id === id))) : c));
              changed();
            })();
          }}
        />
      )}
    </div>
  );
}

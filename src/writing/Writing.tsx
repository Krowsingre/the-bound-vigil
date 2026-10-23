// Scribe (the Writing page): books you write in TBV (open one to write its
// chapters, change its details and export an EPUB), and your notes from reading.

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { api, isWeb } from "../api";
import type { WritingChapter, WritingProject, WritingProjectView } from "../api/types";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Icon } from "../components/Icon";
import { Menu, type MenuEntry } from "../components/Menu";
import { useToast } from "../components/Toast";
import { Notes, type NewNoteKind } from "../notes/Notes";
import { ChapterEditor, type SaveState } from "./ChapterEditor";
import { quoteHtml } from "./fromNotes";
import { QuoteDrawer } from "./QuoteDrawer";
import { DetailsDialog, ExportDialog, NewBookDialog } from "./WritingDialogs";

/** Front matter first, then chapters, then back matter: the order the EPUB uses. */
const ROLE_ORDER = { front: 0, chapter: 1, back: 2 } as const;
const inBookOrder = (list: WritingChapter[]) => [...list].sort((a, b) => ROLE_ORDER[a.role ?? "chapter"] - ROLE_ORDER[b.role ?? "chapter"]);

const words = (n: number) => `${n.toLocaleString()} ${n === 1 ? "word" : "words"}`;

function Cover({ project }: { project: WritingProject }) {
  const src = project.coverPath ? (isWeb ? project.coverPath : api.coverUrl(project.coverPath)) : null;
  return src ? (
    <img className="writing-cover" src={src} alt="" />
  ) : (
    <div className="writing-cover writing-cover-blank" aria-hidden>
      <span className="writing-cover-title">{project.title}</span>
      {project.author && <span className="writing-cover-author">{project.author}</span>}
    </div>
  );
}

/** Two sheets of paper, one tilted behind the other: Scribe with nothing in it. */
function PaperArt() {
  return (
    <svg className="scribe-empty-art" viewBox="0 0 104 104" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <g opacity="0.45">
        <rect x="16" y="24" width="50" height="66" rx="4" transform="rotate(-10 41 57)" fill="var(--surface)" />
      </g>
      <rect x="36" y="12" width="52" height="70" rx="4" fill="var(--surface)" opacity="0.9" />
      <path d="M46 28h32M46 38h32M46 48h32M46 58h18" opacity="0.6" />
    </svg>
  );
}

/** Scribe's chips: everything, your own notes, notes about books, or the books you write. */
type Chip = "all" | "notes" | "book_notes" | "books";
const CHIPS: { chip: Chip; label: string }[] = [
  { chip: "all", label: "All" },
  { chip: "notes", label: "Notes" },
  { chip: "book_notes", label: "Book notes" },
  { chip: "books", label: "Books" },
];
const NOTES_TAB = { all: "all", notes: "personal", book_notes: "book_notes" } as const;

/** Scribe: the books you write and everything you've noted while reading or on your own, in one list. */
export function Writing({
  refreshKey,
  search,
  onClearSearch,
  onOpenBook,
  booksShown = true,
}: {
  refreshKey: number;
  /** The header's search box, which searches notes. */
  search: string;
  onClearSearch: () => void;
  onOpenBook: (bookId: string, cfi?: string) => void;
  /** False where your own books aren't kept (the phone web app): only notes show. */
  booksShown?: boolean;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [ask, setAsk] = useState<{ kind: NewNoteKind; n: number } | null>(null);
  const [reload, setReload] = useState(0);
  const [chip, setChip] = useState<Chip>("all");
  const showing: Chip = booksShown || chip !== "books" ? chip : "all";
  const projects = useProjects(booksShown, refreshKey, reload);

  if (openId && booksShown)
    return (
      <ProjectView
        id={openId}
        refreshKey={refreshKey}
        onBack={() => setOpenId(null)}
        onDeleted={() => {
          setOpenId(null);
          setReload((n) => n + 1);
        }}
      />
    );

  const newNote = (kind: NewNoteKind) => {
    if (showing === "books") setChip("all");
    setAsk((a) => ({ kind, n: (a?.n ?? 0) + 1 }));
  };
  const newBook = () => {
    setChip("books");
    setCreating(true);
  };
  const newItems: MenuEntry[] = [
    { label: "Note", icon: "noteLines", description: "Write freely", onSelect: () => newNote("personal") },
    { label: "Book note", icon: "notePen", description: "Write about a book in your library", onSelect: () => newNote("book_note") },
    ...(booksShown ? [{ label: "Book", icon: "bookOpen" as const, description: "Create a manuscript for EPUB export", onSelect: newBook }] : []),
  ];
  const books = projects.state === "ready" ? projects.list : [];

  const chips = (
    <div className="scribe-chips" role="tablist" aria-label="What to show">
      {CHIPS.filter((c) => booksShown || c.chip !== "books").map((c) => (
        <button
          key={c.chip}
          type="button"
          role="tab"
          aria-selected={showing === c.chip}
          className={`chip${showing === c.chip ? " is-active" : ""}`}
          onClick={() => setChip(c.chip)}
        >
          {c.label}
        </button>
      ))}
    </div>
  );

  return (
    <div className={`library writing-home scribe writing-${showing}`}>
      <header className="library-head scribe-head">
        <h1 className="library-title">{booksShown ? "Scribe" : "Notes"}</h1>
        {/* New starts a note to write freely; the arrow has the other kinds. */}
        <div className="split-button">
          <button type="button" className="btn btn-primary split-main" onClick={() => newNote("personal")}>
            <Icon name="plus" size={15} /> New
          </button>
          <Menu
            label="Other kinds of new"
            className="btn btn-primary split-arrow"
            align="end"
            trigger={<Icon name="chevronDown" size={14} />}
            items={newItems}
          />
        </div>
      </header>
      {showing === "books" ? (
        <>
          <div className="library-toolbar scribe-toolbar">{chips}</div>
          <BookShelf projects={projects} onOpen={setOpenId} onCreate={newBook} onRetry={() => setReload((n) => n + 1)} />
        </>
      ) : (
        <Notes
          embedded
          kindTab={NOTES_TAB[showing]}
          chips={chips}
          ask={ask}
          search={search}
          refreshKey={refreshKey}
          onClearSearch={onClearSearch}
          onOpenBook={onOpenBook}
          onGoToBooks={booksShown ? () => setChip("books") : undefined}
          above={
            showing === "all" && books.length > 0 ? (
              <section className="scribe-books" aria-label="Books you're writing">
                <h2 className="section-title">Books you're writing</h2>
                <BookShelf projects={projects} onOpen={setOpenId} onCreate={newBook} onRetry={() => setReload((n) => n + 1)} />
              </section>
            ) : null
          }
          emptyAll={
            showing === "all" && books.length === 0 ? (
              <div className="library-empty scribe-empty">
                <PaperArt />
                <h2>No writing yet</h2>
                <p className="muted">
                  {booksShown ? "Create a note, a book note, or start a new book to begin writing." : "Create a note or a book note to begin writing."}
                </p>
              </div>
            ) : undefined
          }
        />
      )}
      {creating && (
        <NewBookDialog
          onCancel={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            setReload((n) => n + 1);
            setOpenId(id);
          }}
        />
      )}
    </div>
  );
}

type Projects = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; list: WritingProject[] };

/** The books you're writing, loaded again when something changes. */
function useProjects(shown: boolean, refreshKey: number, reload: number): Projects {
  const [projects, setProjects] = useState<Projects>({ state: "loading" });
  useEffect(() => {
    if (!shown) return setProjects({ state: "ready", list: [] });
    let current = true;
    api.writingProjects().then(
      (list) => current && setProjects({ state: "ready", list }),
      (e: unknown) => current && setProjects({ state: "error", message: String(e) }),
    );
    return () => {
      current = false;
    };
  }, [shown, refreshKey, reload]);
  return projects;
}

function BookShelf({ projects, onOpen, onCreate, onRetry }: { projects: Projects; onOpen: (id: string) => void; onCreate: () => void; onRetry: () => void }) {
  return projects.state === "error" ? (
    <div className="library-empty" role="alert">
      <h2>Your writing couldn't be loaded</h2>
      <p className="muted">{projects.message}</p>
      <button type="button" className="btn btn-primary" onClick={onRetry}>
        Try again
      </button>
    </div>
  ) : projects.state === "loading" ? (
    <div className="library-loading" aria-busy="true" aria-label="Loading your writing" />
  ) : projects.list.length === 0 ? (
    <div className="library-empty">
      <h2>Write a book</h2>
      <p className="muted">
        Write chapter by chapter, add the book's details and a cover, then export an EPUB for your library, a Kindle or a store. Your notes and
        highlights are a tap away while you write, and any note can become a chapter.
      </p>
      <div className="hero-actions">
        <button type="button" className="btn btn-primary" onClick={onCreate}>
          Start a book
        </button>
      </div>
    </div>
  ) : (
    <ul className="writing-shelf">
      {projects.list.map((p) => (
        <li key={p.id}>
          <button type="button" className="writing-book" onClick={() => onOpen(p.id)}>
            <Cover project={p} />
            <span className="writing-book-title">{p.title}</span>
            <span className="muted writing-book-meta">
              {p.chapters} {p.chapters === 1 ? "chapter" : "chapters"} · {words(p.words)}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function ProjectView({ id, refreshKey, onBack, onDeleted }: { id: string; refreshKey: number; onBack: () => void; onDeleted: () => void }) {
  const [view, setView] = useState<WritingProjectView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chapterId, setChapterId] = useState<string | null>(null);
  const [save, setSave] = useState<{ state: SaveState; words: number }>({ state: "saved", words: 0 });
  const [dialog, setDialog] = useState<"details" | "export" | "delete" | null>(null);
  const [deletingChapter, setDeletingChapter] = useState<WritingChapter | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(true);
  const toast = useToast();
  // Waiting saves, so the EPUB and other chapters see the latest words.
  const saving = useRef<Promise<void>>(Promise.resolve());
  const flushEditor = useRef<(() => Promise<void>) | null>(null);
  const insertInEditor = useRef<((html: string) => void) | null>(null);
  const [quotes, setQuotes] = useState(false);

  const load = useCallback(async () => {
    try {
      const v = await api.writingProject(id);
      setView(v);
      setError(null);
      return v;
    } catch (e) {
      setError(String(e));
      return null;
    }
  }, [id]);

  // Another device's changes come in with sync; the chapter being written keeps its own words.
  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const chapters = inBookOrder(view?.chapters ?? []);
  const chapter = chapters.find((c) => c.id === chapterId) ?? chapters[0] ?? null;

  const saveChapter = (cid: string) => async (title: string, body: string) => {
    const done = saving.current.then(async () => {
      const saved = await api.saveWritingChapter(cid, title, body);
      setView((v) =>
        v && {
          ...v,
          chapters: v.chapters.map((c) => (c.id === cid ? saved : c)),
          project: { ...v.project, words: v.project.words - (v.chapters.find((c) => c.id === cid)?.words ?? 0) + saved.words },
        },
      );
    });
    saving.current = done.catch(() => undefined);
    return done;
  };

  const addChapter = async () => {
    await saving.current;
    try {
      const added = await api.addWritingChapter(id, `Chapter ${chapters.length + 1}`, chapter?.id ?? null);
      await load();
      setChapterId(added.id);
    } catch (e) {
      toast(String(e));
    }
  };

  // Front matter, chapters and back matter each keep their own order: a move
  // stays within its group, and "Where it goes in the book" moves between them.
  const roleOf = (cid: string) => chapters.find((c) => c.id === cid)?.role;
  const move = async (from: string, to: string) => {
    if (from === to || roleOf(from) !== roleOf(to)) return;
    const order = chapters.map((c) => c.id).filter((c) => c !== from);
    order.splice(order.indexOf(to) + (chapters.findIndex((c) => c.id === from) < chapters.findIndex((c) => c.id === to) ? 1 : 0), 0, from);
    setView((v) => v && { ...v, chapters: order.map((o) => v.chapters.find((c) => c.id === o)!) });
    try {
      await api.orderWritingChapters(id, order);
    } catch (e) {
      toast(String(e));
      void load();
    }
  };

  const nudge = (c: WritingChapter, by: -1 | 1) => {
    const i = chapters.findIndex((x) => x.id === c.id);
    const other = chapters[i + by];
    if (other?.role === c.role) void move(c.id, other.id);
  };

  const setRole = async (c: WritingChapter, role: WritingChapter["role"]) => {
    try {
      const saved = await api.setWritingChapterRole(c.id, role);
      setView((v) => v && { ...v, chapters: v.chapters.map((x) => (x.id === c.id ? { ...x, role: saved.role } : x)) });
    } catch (e) {
      toast(String(e));
    }
  };

  const chapterMenu = (c: WritingChapter, i: number): MenuEntry[] => [
    { label: "Move up", icon: "chevronUp", disabled: chapters[i - 1]?.role !== c.role, onSelect: () => nudge(c, -1) },
    { label: "Move down", icon: "chevronDown", disabled: chapters[i + 1]?.role !== c.role, onSelect: () => nudge(c, 1) },
    "divider",
    { heading: <span className="menu-tip">Where it goes in the book</span> },
    { label: "Front matter", hint: "Dedication, foreword", checked: c.role === "front", onSelect: () => void setRole(c, "front") },
    { label: "Chapter", checked: (c.role ?? "chapter") === "chapter", onSelect: () => void setRole(c, "chapter") },
    { label: "Back matter", hint: "Acknowledgements, about the author", checked: c.role === "back", onSelect: () => void setRole(c, "back") },
    "divider",
    { label: "Delete chapter…", icon: "trash", danger: true, disabled: chapters.length === 1, onSelect: () => setDeletingChapter(c) },
  ];

  if (error && !view)
    return (
      <div className="library-empty" role="alert">
        <h2>This book couldn't be opened</h2>
        <p className="muted">{error}</p>
        <button type="button" className="btn btn-quiet" onClick={onBack}>
          Back to your books
        </button>
      </div>
    );
  if (!view) return <div className="library-loading" aria-busy="true" aria-label="Opening the book" />;
  const project = view.project;
  const saveLabel = { saved: "Saved", saving: "Saving…", unsaved: "Saving soon", failed: "Not saved yet. Trying again with your next change." }[save.state];

  return (
    <div className={`writing-project${listOpen ? "" : " is-list-closed"}${quotes ? " has-quotes" : ""}`}>
      <header className="writing-head">
        <button type="button" className="btn btn-quiet btn-small" onClick={() => void saving.current.then(onBack)}>
          <Icon name="arrowLeft" size={16} /> Your books
        </button>
        <div className="writing-head-title">
          <h1>{project.title}</h1>
          <span className="muted">
            {project.author ? `${project.author} · ` : ""}
            {words(project.words)}
          </span>
        </div>
        <div className="writing-head-actions">
          <button type="button" className={`btn btn-quiet${quotes ? " is-on" : ""}`} aria-pressed={quotes} onClick={() => setQuotes((q) => !q)}>
            <Icon name="notes" size={16} /> Notes
          </button>
          <button type="button" className="btn btn-quiet" onClick={() => setDialog("details")}>
            <Icon name="info" size={16} /> Book details
          </button>
          <button type="button" className="btn btn-primary" onClick={() => setDialog("export")}>
            <Icon name="upload" size={16} /> Export EPUB
          </button>
          <Menu
            label="More"
            className="btn btn-quiet btn-icon"
            trigger={<Icon name="more" size={18} />}
            items={[{ label: "Delete this book…", icon: "trash", danger: true, onSelect: () => setDialog("delete") }]}
          />
        </div>
      </header>

      <div className="writing-body">
        <aside className="writing-chapters" aria-label="Chapters">
          <div className="writing-chapters-head">
            <strong>Chapters</strong>
            <button type="button" className="btn btn-quiet btn-small" onClick={() => void addChapter()}>
              <Icon name="plus" size={15} /> Add
            </button>
            <button type="button" className="writing-list-toggle" aria-label="Hide chapters" title="Hide chapters" onClick={() => setListOpen(false)}>
              <Icon name="panelLeft" size={17} />
            </button>
          </div>
          <ol className="writing-chapter-list">
            {chapters.map((c, i) => (
              <Fragment key={c.id}>
                {c.role !== chapters[i - 1]?.role && (c.role !== "chapter" || i > 0) && (
                  <li className="writing-chapter-group" aria-hidden>
                    {{ front: "Front matter", chapter: "Chapters", back: "Back matter" }[c.role ?? "chapter"]}
                  </li>
                )}
              <li
                draggable
                className={`${c.id === chapter?.id ? "is-current" : ""}${dragging === c.id ? " is-dragging" : ""}`}
                onDragStart={(e) => {
                  setDragging(c.id);
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", c.id);
                }}
                onDragEnd={() => setDragging(null)}
                onDragOver={(e) => dragging && roleOf(dragging) === c.role && e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragging) void move(dragging, c.id);
                  setDragging(null);
                }}
              >
                <button type="button" className="writing-chapter" onClick={() => void saving.current.then(() => setChapterId(c.id))}>
                  <span className="writing-chapter-number num">{c.role === "chapter" ? chapters.slice(0, i + 1).filter((x) => x.role === "chapter").length : "·"}</span>
                  <span className="writing-chapter-name">{c.title || "Untitled chapter"}</span>
                  <span className="muted num writing-chapter-words">{c.words.toLocaleString()}</span>
                </button>
                <Menu label={`More for ${c.title || "this chapter"}`} className="writing-chapter-more" trigger={<Icon name="more" size={16} />} items={chapterMenu(c, i)} />
              </li>
              </Fragment>
            ))}
          </ol>
          <p className="muted writing-hint">Drag chapters to put them in order. Use a chapter's ••• menu to make it front or back matter.</p>
        </aside>
        <section className="writing-main">
          {!listOpen && (
            <button type="button" className="writing-list-toggle is-floating" aria-label="Show chapters" title="Show chapters" onClick={() => setListOpen(true)}>
              <Icon name="panelLeft" size={17} />
            </button>
          )}
          {chapter && (
            <ChapterEditor
              key={chapter.id}
              chapter={chapter}
              onSave={saveChapter(chapter.id)}
              onSaveState={(state, w) => setSave({ state, words: w })}
              flushRef={flushEditor}
              insertRef={insertInEditor}
            />
          )}
          <footer className="writing-status muted" aria-live="polite">
            <span>{words(save.words)} in this chapter</span>
            <span className={save.state === "failed" ? "is-problem" : undefined}>{saveLabel}</span>
          </footer>
        </section>
        {quotes && <QuoteDrawer refreshKey={refreshKey} onInsert={(n) => insertInEditor.current?.(quoteHtml(n))} onClose={() => setQuotes(false)} />}
      </div>

      {dialog === "details" && (
        <DetailsDialog
          project={project}
          onCancel={(p) => {
            setView((v) => v && { ...v, project: { ...v.project, cover: p.cover, coverPath: p.coverPath } });
            setDialog(null);
          }}
          onSaved={(p) => {
            setView((v) => v && { ...v, project: p });
            setDialog(null);
          }}
        />
      )}
      {dialog === "export" && (
        <ExportDialog
          project={project}
          chapters={chapters}
          onFlush={async () => {
            // Words typed a moment ago haven't been handed over to save yet.
            await flushEditor.current?.();
            await saving.current;
            return (await load())?.chapters ?? chapters;
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "delete" && (
        <ConfirmDialog
          title={`Delete ${project.title}?`}
          body="Every chapter goes, on all your devices. Copies you've already exported stay as they are."
          confirm="Delete book"
          danger
          onCancel={() => setDialog(null)}
          onConfirm={() => {
            void api.deleteWritingProject(id).then(onDeleted, (e) => toast(String(e)));
          }}
        />
      )}
      {deletingChapter && (
        <ConfirmDialog
          title={`Delete ${deletingChapter.title || "this chapter"}?`}
          body={`Its ${words(deletingChapter.words)} go too, on all your devices.`}
          confirm="Delete chapter"
          danger
          onCancel={() => setDeletingChapter(null)}
          onConfirm={() => {
            const gone = deletingChapter;
            setDeletingChapter(null);
            void saving.current
              .then(() => api.deleteWritingChapter(gone.id))
              .then(() => {
                if (chapter?.id === gone.id) setChapterId(chapters.find((c) => c.id !== gone.id)?.id ?? null);
                return load();
              })
              .catch((e) => toast(String(e)));
          }}
        />
      )}
    </div>
  );
}

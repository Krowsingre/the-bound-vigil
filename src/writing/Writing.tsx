// The Writing page: books you write in TBV (open one to write its chapters,
// change its details and export an EPUB), and your notes from reading.

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

export type WritingTab = "books" | "notes";

/** Writing: the books you write (Books) and everything you've noted while reading or on your own (Notes). */
export function Writing({
  tab,
  onTab,
  refreshKey,
  search,
  onClearSearch,
  onOpenBook,
  booksShown = true,
}: {
  tab: WritingTab;
  onTab: (tab: WritingTab) => void;
  refreshKey: number;
  /** The header's search box, which searches notes. */
  search: string;
  onClearSearch: () => void;
  onOpenBook: (bookId: string, cfi?: string) => void;
  /** False where your own books aren't kept (the phone web app): only Notes shows. */
  booksShown?: boolean;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [ask, setAsk] = useState<{ kind: NewNoteKind; n: number } | null>(null);
  const [reload, setReload] = useState(0);
  const showing: WritingTab = booksShown ? tab : "notes";

  if (openId && showing === "books")
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
    onTab("notes");
    setAsk((a) => ({ kind, n: (a?.n ?? 0) + 1 }));
  };
  const newItems: MenuEntry[] = [
    ...(booksShown ? [{ label: "Book to write", icon: "pen" as const, onSelect: () => (onTab("books"), setCreating(true)) }] : []),
    { label: "Personal note", icon: "notes", onSelect: () => newNote("personal") },
    { label: "Note about a book…", icon: "library", onSelect: () => newNote("book_note") },
  ];

  return (
    <div className={`library writing-home writing-${showing}`}>
      <header className="library-head">
        <div>
          <h1 className="library-title">{booksShown ? "Writing" : "Notes"}</h1>
          <p className="eyebrow">
            {showing === "books" ? "Books you're writing, ready to export as EPUB" : "Highlights, annotations and reflections from your reading"}
          </p>
        </div>
        <Menu
          label="New"
          className="btn btn-primary"
          trigger={
            <>
              <span aria-hidden>+</span> New
            </>
          }
          items={newItems}
        />
      </header>
      {booksShown && (
        <div className="page-tabs tabs" role="tablist" aria-label="Writing">
          {(
            [
              ["books", "Books"],
              ["notes", "Notes"],
            ] as const
          ).map(([t, label]) => (
            <button key={t} type="button" role="tab" aria-selected={showing === t} className={`tab${showing === t ? " is-active" : ""}`} onClick={() => onTab(t)}>
              {label}
            </button>
          ))}
        </div>
      )}
      {showing === "books" ? (
        <BookShelf refreshKey={refreshKey} reload={reload} onOpen={setOpenId} onCreate={() => setCreating(true)} />
      ) : (
        <Notes
          embedded
          ask={ask}
          search={search}
          refreshKey={refreshKey}
          onClearSearch={onClearSearch}
          onOpenBook={onOpenBook}
          onGoToBooks={booksShown ? () => onTab("books") : undefined}
        />
      )}
      {creating && (
        <NewBookDialog
          onCancel={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            setOpenId(id);
          }}
        />
      )}
    </div>
  );
}

function BookShelf({ refreshKey, reload: outside, onOpen, onCreate }: { refreshKey: number; reload: number; onOpen: (id: string) => void; onCreate: () => void }) {
  const [projects, setProjects] = useState<WritingProject[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let current = true;
    api.writingProjects().then(
      (p) => current && (setProjects(p), setError(null)),
      (e: unknown) => current && setError(String(e)),
    );
    return () => {
      current = false;
    };
  }, [refreshKey, reload, outside]);

  return error ? (
    <div className="library-empty" role="alert">
      <h2>Your writing couldn't be loaded</h2>
      <p className="muted">{error}</p>
      <button type="button" className="btn btn-primary" onClick={() => setReload((n) => n + 1)}>
        Try again
      </button>
    </div>
  ) : !projects ? (
    <div className="library-loading" aria-busy="true" aria-label="Loading your writing" />
  ) : projects.length === 0 ? (
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
      {projects.map((p) => (
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

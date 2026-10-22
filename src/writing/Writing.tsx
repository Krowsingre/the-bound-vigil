// The Writing page: books you write in TBV. The shelf of books first; open
// one to write its chapters, change its details, and export it as an EPUB.

import { useCallback, useEffect, useRef, useState } from "react";
import { api, isWeb } from "../api";
import type { WritingChapter, WritingProject, WritingProjectView } from "../api/types";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Icon } from "../components/Icon";
import { Menu, type MenuEntry } from "../components/Menu";
import { useToast } from "../components/Toast";
import { ChapterEditor, type SaveState } from "./ChapterEditor";
import { DetailsDialog, ExportDialog, NewBookDialog } from "./WritingDialogs";

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

export function Writing({ refreshKey }: { refreshKey: number }) {
  const [projects, setProjects] = useState<WritingProject[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
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
  }, [refreshKey, reload, openId]);

  if (openId)
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

  return (
    <div className="library writing-page-list">
      <header className="library-head">
        <div>
          <h1 className="library-title">Writing</h1>
          <p className="eyebrow">Books you're writing, ready to export as EPUB</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
          <span aria-hidden>+</span> New book
        </button>
      </header>
      {error ? (
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
            Write chapter by chapter, add the book's details and a cover, then export an EPUB for your library, a Kindle or a store. Your writing syncs
            with your notes, so you can carry on on your phone.
          </p>
          <div className="hero-actions">
            <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
              Start a book
            </button>
          </div>
        </div>
      ) : (
        <ul className="writing-shelf">
          {projects.map((p) => (
            <li key={p.id}>
              <button type="button" className="writing-book" onClick={() => setOpenId(p.id)}>
                <Cover project={p} />
                <span className="writing-book-title">{p.title}</span>
                <span className="muted writing-book-meta">
                  {p.chapters} {p.chapters === 1 ? "chapter" : "chapters"} · {words(p.words)}
                </span>
              </button>
            </li>
          ))}
        </ul>
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

  const chapters = view?.chapters ?? [];
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

  const move = async (from: string, to: string) => {
    if (from === to) return;
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
    if (other) void move(c.id, other.id);
  };

  const chapterMenu = (c: WritingChapter, i: number): MenuEntry[] => [
    { label: "Move up", icon: "chevronUp", disabled: i === 0, onSelect: () => nudge(c, -1) },
    { label: "Move down", icon: "chevronDown", disabled: i === chapters.length - 1, onSelect: () => nudge(c, 1) },
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
    <div className={`writing-project${listOpen ? "" : " is-list-closed"}`}>
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
              <li
                key={c.id}
                draggable
                className={`${c.id === chapter?.id ? "is-current" : ""}${dragging === c.id ? " is-dragging" : ""}`}
                onDragStart={(e) => {
                  setDragging(c.id);
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", c.id);
                }}
                onDragEnd={() => setDragging(null)}
                onDragOver={(e) => dragging && e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragging) void move(dragging, c.id);
                  setDragging(null);
                }}
              >
                <button type="button" className="writing-chapter" onClick={() => void saving.current.then(() => setChapterId(c.id))}>
                  <span className="writing-chapter-number num">{i + 1}</span>
                  <span className="writing-chapter-name">{c.title || "Untitled chapter"}</span>
                  <span className="muted num writing-chapter-words">{c.words.toLocaleString()}</span>
                </button>
                <Menu label={`More for ${c.title || "this chapter"}`} className="writing-chapter-more" trigger={<Icon name="more" size={16} />} items={chapterMenu(c, i)} />
              </li>
            ))}
          </ol>
          <p className="muted writing-hint">Drag chapters to put them in order.</p>
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
            />
          )}
          <footer className="writing-status muted" aria-live="polite">
            <span>{words(save.words)} in this chapter</span>
            <span className={save.state === "failed" ? "is-problem" : undefined}>{saveLabel}</span>
          </footer>
        </section>
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

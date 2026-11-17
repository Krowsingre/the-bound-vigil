// Scribe (the Writing page): books you write in TBV (open one to write its
// chapters, change its details and export an EPUB), and your notes from reading.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNarrow } from "../lib/useNarrow";
import { api, isWeb } from "../api";
import type { WritingChapter, WritingDraft, WritingProject, WritingProjectView } from "../api/types";
import { editionName, editionsOf } from "./bookEditions";
import { LinkBookDialog } from "./LinkBooks";
import { isSample } from "./sampleBook";
import { EXPORT_CHANGED } from "./CanvaLink";
import { startNewEdition } from "./newEdition";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Icon } from "../components/Icon";
import { Menu, type MenuEntry, type MenuItem } from "../components/Menu";
import { useToast } from "../components/Toast";
import { Notes, type NewNoteKind } from "../notes/Notes";
import type { ScribeAsk } from "../widgets";
import { ChapterEditor, type SaveState } from "./ChapterEditor";
import { quoteHtml } from "./fromNotes";
import { QuoteDrawer } from "./QuoteDrawer";
import { BookPreview, MadePage } from "./BookPreview";
import { bookOrder, escapeXml, madeSectionHtml, readExport, type ExportSettings } from "./epub";
import { ScribeBooks, type Projects } from "./ScribeBooks";
import { ADD_MENUS, firstLine, isMade, isNumbered, isPoem, KINDS, numberInWords, readPage, romanOf, startingTitle, writePage, type PageKind, type PageSettings, type Template } from "./pages";
import { DetailsDialog, DraftsDialog, ExportDialog, NewBookDialog } from "./WritingDialogs";
import { PaperbackCover } from "./PaperbackCover";
import { PoemSound } from "./PoemSound";
import { PreflightDialog } from "./Preflight";
import { CopyCheckDialog } from "./CopyCheck";
import { ImportBookDialog } from "./ImportBook";
import { SourcesDialog } from "./SourcesDialog";
import { StoreEditionsDialog } from "./StoreEditions";
import { BoxSetDialog } from "./BoxSet";
import { PreviewsDialog } from "./Previews";
import { usePublisher } from "../license/Publisher";
import { addSampleBook, addSampleOnce, SAMPLE_AUTHOR, SAMPLE_TITLE } from "./sampleBook";

type BibliographySettings = Pick<ExportSettings, "sources" | "citationStyle" | "customSourceFormat">;

const words = (n: number) => `${n.toLocaleString()} ${n === 1 ? "word" : "words"}`;

/** Scribe's tabs: your own notes, what you noted from books, or the books you write (embre, 31 October: no All tab). */
export type WritingSection = "notes" | "book_notes" | "books";
type Chip = WritingSection;
/** What the tab of notes from books is called. */
export const BOOK_NOTES_LABEL = "Reading notes";
const CHIPS: { chip: Chip; label: string }[] = [
  { chip: "notes", label: "Personal notes" },
  { chip: "book_notes", label: BOOK_NOTES_LABEL },
  { chip: "books", label: "Write a book" },
];
const NOTES_TAB = { notes: "personal", book_notes: "book_notes" } as const;

/** Scribe: the books you write and everything you've noted while reading or on your own. */
export function Writing({
  refreshKey,
  search,
  onClearSearch,
  onOpenBook,
  booksShown = true,
  chip, setChip, openId, setOpenId,
  widgetAsk = null,
}: {
  refreshKey: number;
  chip: WritingSection;
  setChip: (section: WritingSection) => void;
  openId: string | null;
  setOpenId: (id: string | null) => void;
  /** The header's search box, which searches notes, and your books on the Books tab. */
  search: string;
  onClearSearch: () => void;
  onOpenBook: (bookId: string, cfi?: string) => void;
  /** An iPhone widget asking for a new note, or to show one. */
  widgetAsk?: ScribeAsk | null;
  /** False where your own books aren't kept (the phone web app): only notes show. */
  booksShown?: boolean;
}) {
  const [creating, setCreating] = useState<Template | null>(null);
  const [importing, setImporting] = useState(false);
  const [boxing, setBoxing] = useState(false);
  const publisher = usePublisher();
  const [ask, setAsk] = useState<{ kind: NewNoteKind; n: number } | null>(null);
  const [reload, setReload] = useState(0);
  // A widget's New note, or one of its notes.
  const [showNote, setShowNote] = useState<{ id: string; n: number } | null>(null);
  useEffect(() => {
    if (!widgetAsk) return;
    if (widgetAsk.open === "new") setAsk((a) => ({ kind: "personal", n: (a?.n ?? 0) + 1 }));
    else if (widgetAsk.id) setShowNote({ id: widgetAsk.id, n: widgetAsk.n });
  }, [widgetAsk]);
  const showing: Chip = booksShown || chip !== "books" ? chip : "notes";
  const projects = useProjects(booksShown, refreshKey, reload);
  const toast = useToast();
  // The sample book, the first time Scribe has no books on this device.
  useEffect(() => {
    if (projects.state === "ready" && booksShown && !isWeb)
      void addSampleOnce(projects.list).then((added) => added && setReload((n) => n + 1));
  }, [projects, booksShown]);

  if (openId && booksShown)
    return (
      <ProjectView
        key={openId}
        id={openId}
        books={projects.state === "ready" ? projects.list : []}
        onOpenEdition={(other) => {
          setReload((n) => n + 1);
          setOpenId(other);
        }}
        onBooksChanged={() => setReload((n) => n + 1)}
        refreshKey={refreshKey}
        onOpenBook={onOpenBook}
        onBack={() => {
          setOpenId(null);
          setReload((n) => n + 1);
        }}
        onDeleted={() => {
          setOpenId(null);
          setReload((n) => n + 1);
        }}
      />
    );

  const newNote = (kind: NewNoteKind) => {
    if (showing === "books") setChip(kind === "personal" ? "notes" : "book_notes");
    setAsk((a) => ({ kind, n: (a?.n ?? 0) + 1 }));
  };
  const newBook = (template: Template = "blank") => {
    setChip("books");
    setCreating(template);
  };
  const newItems: MenuEntry[] = [
    { label: "Note", icon: "noteLines", description: "Write freely", onSelect: () => newNote("personal") },
    { label: "Book note", icon: "notePen", description: "Write about a book in your library", onSelect: () => newNote("book_note") },
    ...(booksShown
      ? [
          { label: "Book", icon: "bookOpen" as const, description: "Create a manuscript for EPUB export", onSelect: () => newBook() },
          {
            label: "Import a manuscript",
            icon: "importFile" as const,
            description: "From Word, OpenDocument, RTF, text, Markdown or EPUB",
            onSelect: () => {
              setChip("books");
              setImporting(true);
            },
          },
          {
            label: "Sample book",
            icon: "bookClosed" as const,
            description: `${SAMPLE_TITLE} by ${SAMPLE_AUTHOR}, to try Scribe on`,
            onSelect: () => {
              setChip("books");
              toast(`Adding ${SAMPLE_TITLE}…`);
              void addSampleBook().then(
                () => {
                  setReload((n) => n + 1);
                  toast(`${SAMPLE_TITLE} is in your books`);
                },
                (e: unknown) => toast(String(e).replace(/^Error: /, "")),
              );
            },
          },
          {
            label: "Box set",
            icon: "layers" as const,
            description: "Several of your books joined into one",
            onSelect: () =>
              publisher.check("Box sets", () => {
                setChip("books");
                setBoxing(true);
              }),
          },
        ]
      : []),
  ];

  return (
    <div className={`library writing-home scribe writing-${showing}`}>
      {/* One header for every tab: the heading, New, and the tabs under them. */}
      <header className="scribe-top">
        <div className="library-head scribe-head">
          <h1 className="library-title">Scribe</h1>
          {/* New starts what the tab holds (a note, a reading note, a book); the arrow has the other kinds. */}
          <div className="split-button">
            <button
              type="button"
              className="btn btn-primary split-main"
              onClick={() => (showing === "books" ? newBook() : newNote(showing === "book_notes" ? "book_note" : "personal"))}
            >
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
        </div>
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
      </header>
      {showing === "books" ? (
        <ScribeBooks
          projects={projects}
          search={search}
          onOpen={setOpenId}
          onStart={newBook}
          onChanged={() => setReload((n) => n + 1)}
          onRetry={() => setReload((n) => n + 1)}
          onOpenBook={onOpenBook}
        />
      ) : (
        <Notes
          kindTab={NOTES_TAB[showing]}
          ask={ask}
          show={showNote}
          search={search}
          refreshKey={refreshKey}
          onClearSearch={onClearSearch}
          onOpenBook={onOpenBook}
          onGoToBooks={booksShown ? () => setChip("books") : undefined}
        />
      )}
      {importing && (
        <ImportBookDialog
          onCancel={() => setImporting(false)}
          onCreated={(id) => {
            setImporting(false);
            setReload((n) => n + 1);
            setOpenId(id);
          }}
        />
      )}
      {boxing && (
        <BoxSetDialog
          onCancel={() => setBoxing(false)}
          onCreated={(id) => {
            setBoxing(false);
            setReload((n) => n + 1);
            setOpenId(id);
          }}
        />
      )}
      {creating && (
        <NewBookDialog
          startWith={creating}
          onCancel={() => setCreating(null)}
          onCreated={(id) => {
            setCreating(null);
            setReload((n) => n + 1);
            setOpenId(id);
          }}
        />
      )}
    </div>
  );
}

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

type Area = "front" | "chapter" | "back";
const SHORTCUT_NEW = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘⇧N" : "Ctrl+Shift+N";
const AREA_NAMES: Record<Area, string> = { front: "Front matter", chapter: "Body", back: "Back matter" };

/** Where a dragged section is dropped: on another section, or on an area's heading (its end). */
/** Where a drop lands beside a row: above it, below it, or (on a section) into it. */
type DropWhere = "above" | "below" | "into";
type DropTarget = { section: WritingChapter; where?: DropWhere } | { area: Area };

function ProjectView({
  id,
  books,
  onOpenEdition,
  onBooksChanged,
  refreshKey,
  onOpenBook,
  onBack,
  onDeleted,
}: {
  id: string;
  /** Every book in Scribe, for this one's other editions. */
  books: WritingProject[];
  onOpenEdition: (id: string) => void;
  /** Another book's details changed here (editions linked), so the list should be read again. */
  onBooksChanged: () => void;
  refreshKey: number;
  onOpenBook: (bookId: string) => void;
  onBack: () => void;
  onDeleted: () => void;
}) {
  const [view, setView] = useState<WritingProjectView | null>(null);
  const [sourceHistory, setSourceHistory] = useState<{ undo: BibliographySettings[]; redo: BibliographySettings[] }>({ undo: [], redo: [] });
  const [error, setError] = useState<string | null>(null);
  const [chapterId, setChapterId] = useState<string | null>(null);
  const [save, setSave] = useState<{ state: SaveState; words: number }>({ state: "saved", words: 0 });
  const [restoreDraft, setRestoreDraft] = useState<WritingDraft>();
  const [dialog, setDialog] = useState<"details" | "export" | "drafts" | "delete" | "sources" | "cover" | "preflight" | "copies" | "editions" | "previews" | "importDraft" | "link" | null>(null);
  const publisher = usePublisher();
  const [deletingChapter, setDeletingChapter] = useState<WritingChapter | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  // The row a dragged page or section would land on, marked with a line.
  const [dropOn, setDropOn] = useState<string | null>(null);
  const [dropWhere, setDropWhere] = useState<DropWhere>("above");
  // Body sections folded shut in the contents, remembered for each book on this device.
  const foldKey = `tbv.scribe.folded.${id}`;
  const [folded, setFolded] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(foldKey) ?? "[]") as string[]);
    } catch {
      return new Set();
    }
  });
  const toggleFold = (sectionId: string) =>
    setFolded((before) => {
      const next = new Set(before);
      if (!next.delete(sectionId)) next.add(sectionId);
      try {
        localStorage.setItem(foldKey, JSON.stringify([...next]));
      } catch {
        /* remembered for now only */
      }
      return next;
    });
  const [listOpen, setListOpen] = useState(true);
  // On a phone the contents and the page share the screen badly, so one shows at a time:
  // picking a page opens it, and the Contents button goes back.
  const narrow = useNarrow();
  const toast = useToast();
  // Waiting saves, so the EPUB and other chapters see the latest words.
  const saving = useRef<Promise<void>>(Promise.resolve());
  const flushEditor = useRef<(() => Promise<void>) | null>(null);
  const insertInEditor = useRef<((html: string) => void) | null>(null);
  // Beside the chapter, quotes from your notes; or, in its place, the whole book as it will be exported.
  const [side, setSide] = useState<"quotes" | "preview" | null>(null);
  // Counts picks in the list, so picking the page already open still takes the preview to it.
  const [picked, setPicked] = useState(0);

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

  // Settings changed by a dialog on its own (a Canva design kept with the book).
  useEffect(() => {
    const changed = (e: Event) => {
      const { projectId, json } = (e as CustomEvent<{ projectId: string; json: string }>).detail;
      if (projectId === id) setView((v) => v && { ...v, project: { ...v.project, export: json } });
    };
    window.addEventListener(EXPORT_CHANGED, changed);
    return () => window.removeEventListener(EXPORT_CHANGED, changed);
  }, [id]);

  const settings = useMemo(() => readExport(view?.project.export), [view?.project.export]);
  const chapters = useMemo(() => bookOrder(view?.chapters ?? [], settings.freeOrder), [view?.chapters, settings.freeOrder]);
  const partIds = new Set(chapters.filter((c) => c.role === "part").map((c) => c.id));
  /** The part (body section) a section is in, or null for the book's own. */
  const partOf = (c: WritingChapter) => (c.role !== "part" && c.part && partIds.has(c.part) ? c.part : null);
  const chapter = chapters.find((c) => c.id === chapterId) ?? chapters[0] ?? null;
  const parts = chapters.filter((c) => c.role === "part");
  const sections = chapters.filter((c) => c.role !== "part");

  /** Book-wide settings (numbering, the copyright page's details…), kept with the export settings. */
  // The book's other editions, and starting the next one.
  const others = settings.edition ? editionsOf(settings.edition.group, books.filter((b) => b.id !== id), (b) => readExport(b.export).edition) : [];
  const editionItems: MenuEntry[] = [
    ...(others.length
      ? [
          { heading: <span className="menu-tip">Editions</span> },
          ...[...others, { id, edition: settings.edition! }]
            .sort((a, b) => a.edition.number - b.edition.number)
            .map((b) => ({
              label: `${b.edition.name}${b.edition.year ? `, ${b.edition.year}` : ""}`,
              checked: b.id === id,
              onSelect: () => b.id !== id && void saving.current.then(() => onOpenEdition(b.id)),
            })),
        ]
      : []),
    ...(isWeb
      ? []
      : [
          {
            label: "Start a new edition…",
            icon: "layers" as const,
            onSelect: () =>
              void saving.current
                .then(() => flushEditor.current?.())
                .then(() => startNewEdition(view!.project))
                .then(
                  (made) => {
                    toast(`Made the ${readExport(made.project.export).edition?.name.toLowerCase() ?? "new edition"}, with every page of this one. You're in it now.`);
                    onOpenEdition(made.project.id);
                  },
                  (e: unknown) => toast(`Couldn't start a new edition: ${String(e).replace(/^Error: /, "")}`),
                ),
          },
          ...(view && !isSample(view.project) && books.some((b) => b.id !== id && !isSample(b))
            ? [{ label: "Link another book…", icon: "link" as const, onSelect: () => void saving.current.then(() => setDialog("link")) }]
            : []),
          ...(others.length
            ? [
                {
                  label: "Unlink from its other editions",
                  onSelect: () => {
                    const e = settings.edition!;
                    const named = e.name.trim() && e.name !== editionName(e.number);
                    saveSettings({ ...settings, edition: { ...e, group: crypto.randomUUID(), number: 1, name: named ? e.name : editionName(1) } });
                    onBooksChanged();
                    toast("Unlinked. It's a book of its own again.");
                  },
                },
              ]
            : []),
        ]),
  ];
  const saveSettings = (next: ExportSettings) => {
    const json = JSON.stringify(next);
    setView((v) => v && { ...v, project: { ...v.project, export: json } });
    saving.current = saving.current.then(() => api.setWritingExport(id, json)).then(() => undefined, (e) => toast(String(e)));
  };

  const sourceSnapshot = (): BibliographySettings => ({
    sources: settings.sources, citationStyle: settings.citationStyle, customSourceFormat: settings.customSourceFormat,
  });
  const changeSources = (change: Partial<BibliographySettings>) => {
    const previous = sourceSnapshot();
    const next = { ...previous, ...change };
    if (JSON.stringify(next) === JSON.stringify(previous)) return;
    setSourceHistory((history) => ({ undo: [...history.undo, previous].slice(-100), redo: [] }));
    saveSettings({ ...settings, ...next });
  };
  const restoreSources = (direction: "undo" | "redo") => {
    const snapshot = sourceHistory[direction].at(-1);
    if (!snapshot) return;
    const opposite = direction === "undo" ? "redo" : "undo";
    const previous = sourceSnapshot();
    setSourceHistory((history) => ({
      ...history,
      [direction]: history[direction].slice(0, -1),
      [opposite]: [...history[opposite], previous],
    }));
    saveSettings({ ...settings, ...snapshot });
  };

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

  /** Adds a page of this kind at the end of its area (or of a body section), or just after `after`, and opens it. */
  const addPage = async (kind: PageKind, role: WritingChapter["role"], part: string | null = null, after?: string) => {
    await flushEditor.current?.();
    await saving.current;
    try {
      const siblings = chapters.filter((c) => c.role === role && partOf(c) === part);
      // A new chapter has no title of its own yet, so it takes its number wherever it goes.
      const title = role === "part" ? `Part ${numberInWords(parts.length + 1)}` : kind === "chapter" ? "" : startingTitle(kind, view!.project);
      // A contents page written by hand starts as a list of what's in the book.
      const body =
        kind === "contents_manual"
          ? sections
              .filter((c) => readPage(c.page, c.role).inContents)
              .map((c) => `<p>${escapeXml(c.title || "Untitled")}</p>`)
              .join("")
          : "";
      const added = await api.addWritingSection(id, {
        title,
        body,
        role,
        part,
        page: role === "part" ? "{}" : JSON.stringify({ kind }),
        after: after ?? siblings[siblings.length - 1]?.id ?? (part && role !== "part" ? part : null),
      });
      await load();
      setChapterId(added.id);
      if (narrow) setListOpen(false);
    } catch (e) {
      toast(String(e));
    }
  };

  /** A copy of a page, words and settings, just after it. */
  const duplicatePage = async (c: WritingChapter) => {
    try {
      await flushEditor.current?.();
      await saving.current;
      const fresh = (await load())?.chapters.find((x) => x.id === c.id) ?? c;
      const added = await api.addWritingSection(id, {
        title: fresh.title ? `${fresh.title} (copy)` : "",
        body: fresh.body,
        role: fresh.role,
        part: partOf(fresh),
        page: fresh.page,
        after: fresh.id,
      });
      await load();
      setChapterId(added.id);
    } catch (e) {
      toast(String(e));
    }
  };

  /** Ctrl+Shift+N: a new, empty page of the same kind as this one, in the same place, just after it. */
  const addLikeThis = (c: WritingChapter) => {
    if (c.role === "part") return void addPage("chapter", "chapter", c.id, c.id);
    void addPage(readPage(c.page, c.role).kind, c.role, partOf(c), c.id);
  };
  const likeThis = useRef<() => void>(() => undefined);
  likeThis.current = () => chapter && addLikeThis(chapter);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === "n") {
        e.preventDefault();
        likeThis.current();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  const setPage = async (c: WritingChapter, change: Partial<PageSettings>) => {
    try {
      const saved = await api.setWritingChapterPage(c.id, writePage({ ...readPage(c.page, c.role), ...change }));
      setView((v) => v && { ...v, chapters: v.chapters.map((x) => (x.id === c.id ? { ...x, page: saved.page } : x)) });
    } catch (e) {
      toast(String(e));
    }
  };

  const changeFrontPageType = async (c: WritingChapter, kind: PageKind) => {
    const before = readPage(c.page, c.role);
    if (before.kind === kind || !view) return;
    try {
      await saving.current;
      if (isMade(before)) {
        const body = madeSectionHtml({ project: view.project, chapters, settings }, c.id);
        await api.saveWritingChapter(c.id, c.title, body);
      }
      await setPage(c, { kind, byHand: kind !== "sources" && !!KINDS[kind].made });
      if (isMade(before)) await load();
    } catch (error) {
      toast(String(error));
    }
  };

  /** A ready-made page becomes one you write, starting from what Scribe made. */
  const writeMyself = async (c: WritingChapter, html: string) => {
    await saving.current;
    try {
      await api.saveWritingChapter(c.id, c.title, html);
      await api.setWritingChapterPage(c.id, writePage({ ...readPage(c.page, c.role), byHand: true }));
      await load();
    } catch (e) {
      toast(String(e));
    }
  };

  /** A section with everything in it, or a page on its own: what moves together. */
  const blockOf = (c: WritingChapter) => (c.role === "part" ? [c, ...chapters.filter((x) => partOf(x) === c.id)] : [c]);
  /** The body's own chapters, its sections and their pages. */
  const inBody = (c: WritingChapter) => c.role === "part" || !!partOf(c) || c.role === "chapter";

  /**
   * Moves a page or a whole body section by dragging (or the ••• menu). A page
   * dropped on another page takes its place, area and section; on a section's
   * own row it goes first inside it; on an area's heading, to that area's end.
   * A section moves with all its pages to wherever in the body it's dropped.
   */
  const moveTo = async (fromId: string, target: DropTarget) => {
    const from = chapters.find((c) => c.id === fromId);
    if (!from) return;
    const onto = "section" in target ? target.section : null;
    const where: DropWhere = ("section" in target && target.where) || (onto?.role === "part" ? "into" : onto && chapters.indexOf(from) < chapters.indexOf(onto) ? "below" : "above");
    const block = blockOf(from);
    const moving = new Set(block.map((c) => c.id));
    if (onto && moving.has(onto.id)) return;
    const rest = chapters.filter((c) => !moving.has(c.id));
    const firstBody = rest.findIndex(inBody);
    const lastBody = rest.length - 1 - [...rest].reverse().findIndex(inBody);
    const anyBody = firstBody >= 0;
    const ownBack = rest.findIndex((c) => c.role === "back" && !partOf(c));
    const bodyStart = firstBody >= 0 ? firstBody : ownBack >= 0 ? ownBack : rest.length;
    const bodyEnd = anyBody ? lastBody + 1 : bodyStart;
    const down = (other: WritingChapter) => chapters.indexOf(from) < chapters.indexOf(other);
    let role: WritingChapter["role"] = from.role;
    let part: string | null = partOf(from);
    let at: number;
    if (from.role === "part") {
      if (!onto) at = (target as { area: Area }).area === "front" ? bodyStart : bodyEnd;
      else if (!inBody(onto)) at = onto.role === "front" ? bodyStart : bodyEnd;
      else {
        // Onto a page inside another section: beside that whole section.
        const holder = onto.role === "part" ? onto : (chapters.find((c) => c.id === partOf(onto)) ?? onto);
        const theirs = blockOf(holder);
        const after = holder === onto ? where !== "above" : down(holder);
        at = after ? rest.indexOf(theirs[theirs.length - 1]) + 1 : rest.indexOf(theirs[0]);
      }
    } else if (!onto) {
      const area = (target as { area: Area }).area;
      [role, part] = [area, null];
      at = area === "front" ? bodyStart : area === "chapter" ? bodyEnd : rest.length;
    } else if (onto.role === "part" && where === "into") {
      [role, part] = ["chapter", onto.id];
      at = rest.indexOf(onto) + 1;
    } else if (onto.role === "part") {
      // Just above or below the whole section: a chapter of the body on its own.
      const theirs = blockOf(onto);
      [role, part] = ["chapter", null];
      at = where === "above" ? rest.indexOf(onto) : rest.indexOf(theirs[theirs.length - 1]) + 1;
    } else {
      [role, part] = [onto.role, partOf(onto)];
      at = rest.indexOf(onto) + (where === "below" ? 1 : 0);
    }
    const order = [...rest.slice(0, at), ...block, ...rest.slice(at)].map((c) => c.id);
    if (order.join() === chapters.map((c) => c.id).join() && role === from.role && part === partOf(from)) return;
    // From the first move on, the body keeps the order it's given (sections among chapters too).
    if (!settings.freeOrder) saveSettings({ ...settings, freeOrder: true });
    setView((v) => v && { ...v, chapters: order.map((o) => ({ ...v.chapters.find((c) => c.id === o)!, ...(o === from.id ? { role, part } : {}) })) });
    try {
      await saving.current;
      if (role !== from.role) await api.setWritingChapterRole(from.id, role);
      if (part !== partOf(from)) await api.setWritingChapterPart(from.id, part);
      await api.orderWritingChapters(id, order);
    } catch (e) {
      toast(String(e));
    }
    void load();
  };

  /** Pages of the same kind and place, for Move up and Move down; a section steps past the body's chapters and sections. */
  const groupOf = (c: WritingChapter) => (c.role === "part" || (c.role === "chapter" && !partOf(c)) ? "body" : `${partOf(c) ?? ""}:${c.role}`);
  const neighbour = (c: WritingChapter, by: -1 | 1) => {
    const same = chapters.filter((x) => groupOf(x) === groupOf(c));
    return same[same.findIndex((x) => x.id === c.id) + by];
  };
  const nudge = (c: WritingChapter, by: -1 | 1) => {
    const other = neighbour(c, by);
    if (!other) return;
    // A body page moved past a section lands beside it, not inside it.
    if (c.role !== "part" && other.role === "part") void moveBeside(c, other, by);
    else void moveTo(c.id, { section: other, where: by < 0 ? "above" : "below" });
  };
  /** Moves a body page just past a whole section, keeping it out of the section. */
  const moveBeside = async (c: WritingChapter, section: WritingChapter, by: -1 | 1) => {
    const rest = chapters.filter((x) => x.id !== c.id);
    const theirs = blockOf(section);
    const at = by > 0 ? rest.indexOf(theirs[theirs.length - 1]) + 1 : rest.indexOf(theirs[0]);
    const order = [...rest.slice(0, at), c, ...rest.slice(at)].map((x) => x.id);
    if (!settings.freeOrder) saveSettings({ ...settings, freeOrder: true });
    setView((v) => v && { ...v, chapters: order.map((o) => v.chapters.find((x) => x.id === o)!) });
    try {
      await saving.current;
      await api.orderWritingChapters(id, order);
    } catch (e) {
      toast(String(e));
    }
    void load();
  };

  // Chapter numbers as the book will have them.
  const numbers = new Map<string, number>();
  {
    let n = 0;
    for (const c of chapters) {
      if (c.role === "part" && settings.numbering === "restart") n = 0;
      if (isNumbered(c)) numbers.set(c.id, ++n);
    }
  }

  const kindItems = (area: Area, part: string | null = null): MenuEntry[] =>
    ADD_MENUS[area].map((kind) => ({
      label: KINDS[kind].label,
      description: KINDS[kind].hint,
      onSelect: () => void addPage(kind, area, part),
    }));
  const addMenus: Record<Area, MenuEntry[]> = {
    front: kindItems("front"),
    chapter: [
      ...kindItems("chapter"),
      "divider",
      { label: "Section", icon: "layers", description: "A group of chapters, such as Part One", onSelect: () => void addPage("custom", "part") },
    ],
    back: kindItems("back"),
  };

  const chapterMenu = (c: WritingChapter): MenuEntry[] => {
    if (c.role === "part")
      return [
        { label: "Move up", icon: "chevronUp", disabled: !neighbour(c, -1), onSelect: () => nudge(c, -1) },
        { label: "Move down", icon: "chevronDown", disabled: !neighbour(c, 1), onSelect: () => nudge(c, 1) },
        "divider",
        { heading: <span className="menu-tip">Add to this section</span> },
        ...kindItems("chapter", c.id),
        "divider",
        { label: "Delete section…", icon: "trash", danger: true, onSelect: () => setDeletingChapter(c) },
      ];
    const page = readPage(c.page, c.role);
    const made = KINDS[page.kind].made;
    return [
      { label: "Move up", icon: "chevronUp", disabled: !neighbour(c, -1), onSelect: () => nudge(c, -1) },
      { label: "Move down", icon: "chevronDown", disabled: !neighbour(c, 1), onSelect: () => nudge(c, 1) },
      { label: "Duplicate page", icon: "copy", onSelect: () => void duplicatePage(c) },
      { label: "New page like this one", icon: "plus", hint: SHORTCUT_NEW, onSelect: () => addLikeThis(c) },
      "divider",
      { heading: <span className="menu-tip">This page</span> },
      ...(c.role === "front" ? ([{
        label: "Change page type",
        submenu: ADD_MENUS.front.map((kind) => ({
          label: KINDS[kind].label,
          checked: page.kind === kind,
          onSelect: () => void changeFrontPageType(c, kind),
        })),
      }] as MenuEntry[]) : []),
      { label: "Show in the contents", checked: page.inContents, onSelect: () => void setPage(c, { inContents: !page.inContents }) },
      { label: "Show its title", checked: page.showTitle, onSelect: () => void setPage(c, { showTitle: !page.showTitle }) },
      {
        label: "Start on a new page",
        hint: page.newPage === null ? (isPoem(page) ? "Poems always do, unless you say" : "As the book's export settings say") : undefined,
        checked: page.newPage ?? (isPoem(page) || settings.newPage),
        onSelect: () => void setPage(c, { newPage: !(page.newPage ?? (isPoem(page) || settings.newPage)) }),
      },
      ...(isPoem(page) ? ([{ label: "Centre the lines", checked: page.centred, onSelect: () => void setPage(c, { centred: !page.centred }) }] as MenuEntry[]) : []),
      ...(made && page.byHand ? ([{ label: "Let Scribe make it again", icon: "sync", onSelect: () => void setPage(c, { byHand: false }) }] as MenuEntry[]) : []),
      "divider",
      { heading: <span className="menu-tip">Where it goes</span> },
      // The body's sections sit under Body, in the book's order.
      ...(["front", "chapter", "back"] as Area[]).flatMap((area): MenuItem[] => [
        { label: AREA_NAMES[area], checked: c.role === area && !partOf(c), onSelect: () => void moveTo(c.id, { area }) },
        ...(area === "chapter"
          ? parts.map((p, n) => ({ label: p.title || `Section ${n + 1}`, indent: true, checked: partOf(c) === p.id, onSelect: () => void moveTo(c.id, { section: p }) }))
          : []),
      ]),
      "divider",
      { label: "Delete page…", icon: "trash", danger: true, disabled: sections.length === 1, onSelect: () => setDeletingChapter(c) },
    ];
  };

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
  const current = chapter ? readPage(chapter.page, chapter.role) : null;

  const row = (c: WritingChapter) => {
    const page = readPage(c.page, c.role);
    const inPart = !!partOf(c);
    const number =
      c.role === "part" ? romanOf(parts.findIndex((p) => p.id === c.id) + 1) : numbers.has(c.id) ? numbers.get(c.id) : KINDS[page.kind].made && !page.byHand ? "◇" : "·";
    const words = c.role === "part" ? chapters.filter((x) => partOf(x) === c.id).reduce((n, x) => n + x.words, 0) : c.words;
    const dragged = dragging ? chapters.find((x) => x.id === dragging) : undefined;
    // Anything can be dropped anywhere but into itself (a section into its own pages).
    const canDrop = !!dragged && !blockOf(dragged).some((x) => x.id === c.id);
    const isFolded = c.role === "part" && folded.has(c.id);
    const inside = c.role === "part" ? chapters.filter((x) => partOf(x) === c.id).length : 0;
    return (
      <li
        key={c.id}
        draggable
        className={`${c.id === chapter?.id ? "is-current" : ""}${dragging === c.id ? " is-dragging" : ""}${inPart ? " is-in-part" : ""}${c.role === "part" ? " is-part" : ""}${dropOn === c.id ? ` is-drop-${dropWhere}` : ""}`}
        onDragStart={(e) => {
          setDragging(c.id);
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", c.id);
        }}
        onDragEnd={() => (setDragging(null), setDropOn(null))}
        onDragOver={(e) => {
          if (!canDrop) return;
          e.preventDefault();
          // The top of a row drops above it, the bottom below; the middle of a section drops into it.
          const box = e.currentTarget.getBoundingClientRect();
          const y = (e.clientY - box.top) / Math.max(1, box.height);
          const where: DropWhere = c.role === "part" && dragged?.role !== "part" ? (y < 0.3 ? "above" : y > 0.7 && isFolded ? "below" : "into") : y < 0.5 ? "above" : "below";
          if (dropOn !== c.id) setDropOn(c.id);
          if (dropWhere !== where) setDropWhere(where);
        }}
        onDragLeave={() => dropOn === c.id && setDropOn(null)}
        onDrop={(e) => {
          e.preventDefault();
          if (dragging && canDrop) void moveTo(dragging, { section: c, where: dropWhere });
          setDragging(null);
          setDropOn(null);
        }}
      >
        {c.role === "part" && (
          <button type="button" className="writing-fold" aria-expanded={!isFolded} aria-label={isFolded ? `Show what's in ${c.title || "this section"}` : `Fold ${c.title || "this section"}`}
            title={isFolded ? `Show its ${inside} ${inside === 1 ? "page" : "pages"}` : "Fold"} onClick={() => toggleFold(c.id)}>
            <Icon name={isFolded ? "chevronRight" : "chevronDown"} size={14} />
          </button>
        )}
        <button type="button" className="writing-chapter" onClick={() => void saving.current.then(() => (setChapterId(c.id), setPicked((n) => n + 1), narrow && setListOpen(false)))}>
          <span className="writing-chapter-number num">{number}</span>
          <span className={`writing-chapter-name${c.title ? "" : " muted"}`}>
            {c.title || (c.role === "part" ? "Untitled section" : numbers.has(c.id) ? `Chapter ${numbers.get(c.id)}` : (isPoem(page) && firstLine(c.body)) || KINDS[page.kind].label)}
          </span>
          <span className="muted num writing-chapter-words">{words.toLocaleString()}</span>
        </button>
        <Menu label={`More for ${c.title || "this page"}`} className="writing-chapter-more" trigger={<Icon name="more" size={16} />} items={chapterMenu(c)} />
      </li>
    );
  };
  const areaHead = (area: Area) => (
    <li
      className={`writing-area${dropOn === `area:${area}` ? " is-drop-target" : ""}`}
      onDragOver={(e) => {
        if (!dragging) return;
        e.preventDefault();
        if (dropOn !== `area:${area}`) setDropOn(`area:${area}`);
      }}
      onDragLeave={() => dropOn === `area:${area}` && setDropOn(null)}
      onDrop={(e) => {
        e.preventDefault();
        if (dragging) void moveTo(dragging, { area });
        setDragging(null);
        setDropOn(null);
      }}
    >
      <span>{AREA_NAMES[area]}</span>
      {area === "chapter" && parts.length > 0 && (
        <Menu
          label="Chapter numbers"
          className="writing-area-add"
          align="end"
          trigger={<Icon name="listNumber" size={14} />}
          items={[
            { heading: <span className="menu-tip">Chapter numbers</span> },
            { label: "Start again in each section", checked: settings.numbering === "restart", onSelect: () => saveSettings({ ...settings, numbering: "restart" }) },
            { label: "Run on through the book", checked: settings.numbering === "continuous", onSelect: () => saveSettings({ ...settings, numbering: "continuous" }) },
          ]}
        />
      )}
      <Menu label={`Add to ${AREA_NAMES[area].toLowerCase()}`} className="writing-area-add" align="end" trigger={<Icon name="plus" size={15} />} items={addMenus[area]} />
    </li>
  );
  const front = chapters.filter((c) => c.role === "front" && !partOf(c));
  const back = chapters.filter((c) => c.role === "back" && !partOf(c));
  const body = chapters.filter((c) => !front.includes(c) && !back.includes(c));

  return (
    <div className={`writing-project${listOpen ? "" : " is-list-closed"}${side ? ` has-${side}` : ""}`}>
      <header className="writing-head">
        <button type="button" className="btn btn-quiet btn-small" onClick={() => void saving.current.then(onBack)}>
          <Icon name="arrowLeft" size={16} /> Your books
        </button>
        <div className="writing-head-title">
          <h1>{project.title}</h1>
          <span className="muted">
            {project.author ? `${project.author} · ` : ""}
            {settings.edition ? `${settings.edition.name} · ` : ""}
            {words(project.words)}
          </span>
        </div>
        <div className="writing-head-actions">
          <button type="button" className={`btn btn-quiet${side === "preview" ? " is-on" : ""}`} aria-pressed={side === "preview"} onClick={() => void flushEditor.current?.().finally(() => (setSide((s) => (s === "preview" ? null : "preview")), narrow && setListOpen(false)))}>
            <Icon name="bookOpen" size={16} /> Preview
          </button>
          <button type="button" className={`btn btn-quiet${side === "quotes" ? " is-on" : ""}`} aria-pressed={side === "quotes"} onClick={() => setSide((s) => (s === "quotes" ? null : "quotes"))}>
            <Icon name="notes" size={16} /> Notes
          </button>
          <button type="button" className="btn btn-quiet" onClick={() => setDialog("details")}>
            <Icon name="info" size={16} /> Book details
          </button>
          {!isWeb && (
            <button type="button" className="btn btn-quiet" onClick={() => setDialog("drafts")}>
              <Icon name="drafts" size={16} /> Drafts
            </button>
          )}
          <button type="button" className="btn btn-primary" onClick={() => setDialog("export")}>
            <Icon name="upload" size={16} /> Export
          </button>
          <Menu
            label="More"
            className="btn btn-quiet btn-icon"
            trigger={<Icon name="more" size={18} />}
            items={[
              { label: "Sources and citation style…", icon: "bookClosed", onSelect: () => setDialog("sources") },
              "divider",
              ...editionItems,
              "divider",
              { label: "Previews on each device…", icon: "phone", onSelect: () => publisher.check("Side-by-side previews", () => void Promise.resolve(flushEditor.current?.()).finally(() => setDialog("previews"))) },
              { label: "Store editions…", icon: "layers", onSelect: () => publisher.check("Store editions", () => setDialog("editions")) },
              { label: "Paperback cover…", icon: "image", onSelect: () => publisher.check("The paperback cover maker", () => setDialog("cover")) },
              { label: "Check before uploading…", icon: "checkCircle", onSelect: () => publisher.check("Checking before uploading", () => setDialog("preflight")) },
              { label: "Plagiarism Check…", icon: "checkCircle", onSelect: () => setDialog("copies") },
              "divider",
              { label: "Delete Book…", icon: "trash", danger: true, onSelect: () => setDialog("delete") },
            ]}
          />
        </div>
      </header>

      <div className="writing-body">
        <aside className="writing-chapters" aria-label="The book's pages">
          <div className="writing-chapters-head">
            <strong>Contents</strong>
            <button type="button" className="writing-list-toggle" aria-label="Hide the list" title="Hide the list" onClick={() => setListOpen(false)}>
              <Icon name="panelLeft" size={17} />
            </button>
          </div>
          <ol className="writing-chapter-list">
            {areaHead("front")}
            {front.map(row)}
            {areaHead("chapter")}
            {body.filter((c) => !(partOf(c) && folded.has(partOf(c)!))).map(row)}
            {areaHead("back")}
            {back.map(row)}
          </ol>
          <p className="muted writing-hint">Drag pages and sections to put them in order. Each area's + adds a page. Ctrl+Shift+N adds a page like the one you're on.</p>
        </aside>
        {side === "preview" ? (
          <BookPreview
            project={project}
            chapters={chapters}
            settings={settings}
            showing={chapter?.id ?? null}
            picked={picked}
            onShowList={listOpen ? undefined : () => setListOpen(true)}
            onSettings={saveSettings}
            onClose={() => setSide(null)}
          />
        ) : (
          <section className="writing-main">
            {!listOpen && (
              <button type="button" className="writing-list-toggle is-floating" aria-label={narrow ? "Contents" : "Show the list"} title={narrow ? "Contents" : "Show the list"} onClick={() => setListOpen(true)}>
                <Icon name={narrow ? "chevronLeft" : "panelLeft"} size={17} />
                {narrow && <span>Contents</span>}
              </button>
            )}
            {chapter && current && isMade(current) ? (
              <MadePage
                key={chapter.id}
                chapter={chapter}
                project={project}
                chapters={chapters}
                settings={settings}
                onTitle={(title) => void saveChapter(chapter.id)(title, chapter.body).catch((e) => toast(String(e)))}
                onCopyright={(copyright) => saveSettings({ ...settings, copyright })}
                onEdition={(edition) => saveSettings({ ...settings, edition })}
                onWriteMyself={(html) => void writeMyself(chapter, html)}
                onOpenDetails={() => setDialog("details")}
                onOpenSources={() => setDialog("sources")}
                onSourcesChange={(sources) => changeSources({ sources })}
                onFormatChange={(citationStyle, customSourceFormat) => changeSources({ citationStyle, customSourceFormat })}
                canUndoSources={sourceHistory.undo.length > 0}
                canRedoSources={sourceHistory.redo.length > 0}
                onUndoSources={() => restoreSources("undo")}
                onRedoSources={() => restoreSources("redo")}
              />
            ) : (
              chapter && (
                <>
                {current && <PoemSound key={`sound-${chapter.id}`} sound={current.sound} onChange={(sound) => setPage(chapter, { sound })} />}
                <ChapterEditor
                  key={chapter.id}
                  chapter={chapter}
                  onSave={saveChapter(chapter.id)}
                  onSaveState={(state, w) => setSave({ state, words: w })}
                  flushRef={flushEditor}
                  insertRef={insertInEditor}
                  poem={current && isPoem(current) ? (current.centred ? "centred" : "left") : null}
                  book={{
                    font: settings.font === "lora" ? "Lora, serif" : settings.font === "echolume" ? "Echolume, serif" : null,
                    lineHeight: "1.5",
                    align: current && isPoem(current) ? (current.centred ? "center" : "left") : settings.align,
                  }}
                  sources={settings.sources}
                  citationChapters={chapters}
                  citationStyle={settings.citationStyle}
                  onSources={(sources, citationStyle) => changeSources({ sources, citationStyle })}
                />
                </>
              )
            )}
            <footer className="writing-status muted" aria-live="polite">
              <span>{words(save.words)} on this page</span>
              <span className={save.state === "failed" ? "is-problem" : undefined}>{saveLabel}</span>
            </footer>
          </section>
        )}
        {side === "quotes" && <QuoteDrawer refreshKey={refreshKey} projectId={project.id} onInsert={(n) => insertInEditor.current?.(quoteHtml(n))} onClose={() => setSide(null)} />}
      </div>

      {dialog === "sources" && (
        <SourcesDialog
          sources={settings.sources}
          style={settings.citationStyle}
          onChange={(sources, citationStyle) => changeSources({ sources, citationStyle })}
          onClose={() => setDialog(null)}
        />
      )}
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
          onSettings={saveSettings}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "previews" && <PreviewsDialog project={project} chapters={chapters} settings={settings} showing={chapter?.id ?? null} onClose={() => setDialog(null)} />}
      {dialog === "editions" && (
        <StoreEditionsDialog
          project={project}
          chapters={chapters}
          settings={settings}
          onSettings={saveSettings}
          onFlush={async () => {
            await flushEditor.current?.();
            await saving.current;
            return (await load())?.chapters ?? chapters;
          }}
          onChanged={() => void load()}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "cover" && <PaperbackCover project={project} trim={settings.print.trim} onClose={() => setDialog(null)} />}
      {(dialog === "preflight" || dialog === "copies") &&
        (() => {
          const flush = async () => {
            await flushEditor.current?.();
            await saving.current;
            return (await load())?.chapters ?? chapters;
          };
          return dialog === "preflight" ? <PreflightDialog project={project} onFlush={flush} onClose={() => setDialog(null)} /> : <CopyCheckDialog project={project} onFlush={flush} onClose={() => setDialog(null)} />;
        })()}
      {dialog === "drafts" && (
        <DraftsDialog
          project={project}
          onFlush={async () => {
            await flushEditor.current?.();
            await saving.current;
            return (await load())?.chapters ?? chapters;
          }}
          onOpen={(bookId) => void saving.current.then(() => onOpenBook(bookId))}
          onRestore={(draft) => {
            void (async () => {
              try {
                await flushEditor.current?.();
                await saving.current;
                setRestoreDraft(draft);
                setDialog("importDraft");
              } catch (error) { toast(String(error)); }
            })();
          }}
          onImport={async () => {
            // Saved first, so "Write from it" keeps today's last words in the draft it makes.
            await flushEditor.current?.();
            await saving.current;
            setRestoreDraft(undefined);
            setDialog("importDraft");
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "link" && (
        <LinkBookDialog
          project={project}
          books={books}
          onCancel={() => setDialog(null)}
          onDone={(message) => {
            setDialog(null);
            void load();
            onBooksChanged();
            toast(message);
          }}
        />
      )}
      {dialog === "importDraft" && (
        <ImportBookDialog
          into={project}
          restoreDraft={restoreDraft}
          onCancel={() => setDialog("drafts")}
          onCreated={() => setDialog("drafts")}
          onIntoDone={(how) => {
            void load();
            if (how === "current") {
              setDialog(null);
              toast(restoreDraft ? "The draft is now editable in Scribe." : "The new version is in. What was there before is kept as a draft.");
            } else {
              setDialog("drafts");
              toast("Kept as a new draft.");
            }
          }}
        />
      )}
      {dialog === "delete" && (
        <ConfirmDialog
          title={`Delete ${project.title}?`}
          body="Every chapter goes, on all your devices. Copies you've already exported stay as they are."
          confirm="Delete Book"
          danger
          onCancel={() => setDialog(null)}
          onConfirm={() => {
            void api.deleteWritingProject(id).then(onDeleted, (e) => toast(String(e)));
          }}
        />
      )}
      {deletingChapter && (
        <ConfirmDialog
          title={`Delete ${deletingChapter.title || (deletingChapter.role === "part" ? "this section" : "this page")}?`}
          body={
            deletingChapter.role === "part"
              ? "Its own page goes, on all your devices. The chapters in it stay, in the body."
              : `Its ${words(deletingChapter.words)} go too, on all your devices.`
          }
          confirm={deletingChapter.role === "part" ? "Delete section" : "Delete page"}
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

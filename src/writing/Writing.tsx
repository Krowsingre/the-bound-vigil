// Scribe (the Writing page): books you write in TBV (open one to write its
// chapters, change its details and export an EPUB), and your notes from reading.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, isWeb } from "../api";
import type { WritingChapter, WritingProjectView } from "../api/types";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Icon } from "../components/Icon";
import { Menu, type MenuEntry } from "../components/Menu";
import { useToast } from "../components/Toast";
import { Notes, type NewNoteKind } from "../notes/Notes";
import { ChapterEditor, type SaveState } from "./ChapterEditor";
import { quoteHtml } from "./fromNotes";
import { QuoteDrawer } from "./QuoteDrawer";
import { BookPreview, MadePage } from "./BookPreview";
import { bookOrder, escapeXml, readExport, type ExportSettings } from "./epub";
import { ScribeBooks, type Projects } from "./ScribeBooks";
import { ADD_MENUS, firstLine, isMade, isNumbered, isPoem, KINDS, numberInWords, readPage, romanOf, startingTitle, writePage, type PageKind, type PageSettings, type Template } from "./pages";
import { DetailsDialog, DraftsDialog, ExportDialog, NewBookDialog } from "./WritingDialogs";
import { PaperbackCover } from "./PaperbackCover";
import { PreflightDialog } from "./Preflight";
import { CopyCheckDialog } from "./CopyCheck";
import { ImportBookDialog } from "./ImportBook";
import { SourcesDialog } from "./SourcesDialog";
import { StoreEditionsDialog } from "./StoreEditions";
import { BoxSetDialog } from "./BoxSet";
import { PreviewsDialog } from "./Previews";
import { usePublisher } from "../license/Publisher";

const words = (n: number) => `${n.toLocaleString()} ${n === 1 ? "word" : "words"}`;

/** Scribe's tabs: your own notes, what you noted from books, or the books you write (embre, 31 October: no All tab). */
type Chip = "notes" | "book_notes" | "books";
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
}: {
  refreshKey: number;
  /** The header's search box, which searches notes, and your books on the Books tab. */
  search: string;
  onClearSearch: () => void;
  onOpenBook: (bookId: string, cfi?: string) => void;
  /** False where your own books aren't kept (the phone web app): only notes show. */
  booksShown?: boolean;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState<Template | null>(null);
  const [importing, setImporting] = useState(false);
  const [boxing, setBoxing] = useState(false);
  const publisher = usePublisher();
  const [ask, setAsk] = useState<{ kind: NewNoteKind; n: number } | null>(null);
  const [reload, setReload] = useState(0);
  const [chip, setChip] = useState<Chip>("notes");
  const showing: Chip = booksShown || chip !== "books" ? chip : "notes";
  const projects = useProjects(booksShown, refreshKey, reload);

  if (openId && booksShown)
    return (
      <ProjectView
        id={openId}
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
        />
      ) : (
        <Notes
          kindTab={NOTES_TAB[showing]}
          ask={ask}
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
const AREA_NAMES: Record<Area, string> = { front: "Front matter", chapter: "Body", back: "Back matter" };

/** Where a dragged section is dropped: on another section, or on an area's heading (its end). */
type DropTarget = { section: WritingChapter } | { area: Area };

function ProjectView({
  id,
  refreshKey,
  onOpenBook,
  onBack,
  onDeleted,
}: {
  id: string;
  refreshKey: number;
  onOpenBook: (bookId: string) => void;
  onBack: () => void;
  onDeleted: () => void;
}) {
  const [view, setView] = useState<WritingProjectView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chapterId, setChapterId] = useState<string | null>(null);
  const [save, setSave] = useState<{ state: SaveState; words: number }>({ state: "saved", words: 0 });
  const [dialog, setDialog] = useState<"details" | "export" | "drafts" | "delete" | "sources" | "cover" | "preflight" | "copies" | "editions" | "previews" | null>(null);
  const publisher = usePublisher();
  const [deletingChapter, setDeletingChapter] = useState<WritingChapter | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(true);
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

  const chapters = useMemo(() => bookOrder(view?.chapters ?? []), [view?.chapters]);
  const settings = useMemo(() => readExport(view?.project.export), [view?.project.export]);
  const partIds = new Set(chapters.filter((c) => c.role === "part").map((c) => c.id));
  /** The part (body section) a section is in, or null for the book's own. */
  const partOf = (c: WritingChapter) => (c.role !== "part" && c.part && partIds.has(c.part) ? c.part : null);
  const chapter = chapters.find((c) => c.id === chapterId) ?? chapters[0] ?? null;
  const parts = chapters.filter((c) => c.role === "part");
  const sections = chapters.filter((c) => c.role !== "part");

  /** Book-wide settings (numbering, the copyright page's details…), kept with the export settings. */
  const saveSettings = (next: ExportSettings) => {
    const json = JSON.stringify(next);
    setView((v) => v && { ...v, project: { ...v.project, export: json } });
    void api.setWritingExport(id, json).catch((e) => toast(String(e)));
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

  /** Adds a page of this kind at the end of its area (or of a body section), and opens it. */
  const addPage = async (kind: PageKind, role: WritingChapter["role"], part: string | null = null) => {
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
        after: siblings[siblings.length - 1]?.id ?? (part && role !== "part" ? part : null),
      });
      await load();
      setChapterId(added.id);
    } catch (e) {
      toast(String(e));
    }
  };

  const setPage = async (c: WritingChapter, change: Partial<PageSettings>) => {
    try {
      const saved = await api.setWritingChapterPage(c.id, writePage({ ...readPage(c.page, c.role), ...change }));
      setView((v) => v && { ...v, chapters: v.chapters.map((x) => (x.id === c.id ? { ...x, page: saved.page } : x)) });
    } catch (e) {
      toast(String(e));
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

  /**
   * Moves a section by dragging (or the ••• menu): onto another section it
   * takes that one's place, area and body section; onto a body section's
   * own row it goes first inside it; onto an area's heading, to that area's end.
   * Body sections move only among each other.
   */
  const moveTo = async (fromId: string, target: DropTarget) => {
    const from = chapters.find((c) => c.id === fromId);
    if (!from) return;
    const onto = "section" in target ? target.section : null;
    if (onto?.id === from.id) return;
    if (from.role === "part" && (!onto || onto.role !== "part")) return;
    let role: WritingChapter["role"] = from.role;
    let part: string | null = partOf(from);
    if (from.role !== "part") {
      if (!onto) [role, part] = [(target as { area: Area }).area, null];
      else if (onto.role === "part") [role, part] = ["chapter", onto.id];
      else [role, part] = [onto.role, partOf(onto)];
    }
    const order = chapters.map((c) => c.id).filter((c) => c !== from.id);
    if (!onto) order.push(from.id);
    else if (onto.role === "part" && from.role !== "part") order.splice(order.indexOf(onto.id) + 1, 0, from.id);
    else {
      const down = chapters.findIndex((c) => c.id === from.id) < chapters.findIndex((c) => c.id === onto.id);
      order.splice(order.indexOf(onto.id) + (down ? 1 : 0), 0, from.id);
    }
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

  /** Sections of the same kind and place, for Move up and Move down. */
  const groupOf = (c: WritingChapter) => (c.role === "part" ? "part" : `${partOf(c) ?? ""}:${c.role}`);
  const neighbour = (c: WritingChapter, by: -1 | 1) => {
    const same = chapters.filter((x) => groupOf(x) === groupOf(c));
    return same[same.findIndex((x) => x.id === c.id) + by];
  };
  const nudge = (c: WritingChapter, by: -1 | 1) => {
    const other = neighbour(c, by);
    if (other) void moveTo(c.id, { section: other });
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
      "divider",
      { heading: <span className="menu-tip">This page</span> },
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
      ...(["front", "chapter", "back"] as Area[]).map((area) => ({
        label: AREA_NAMES[area],
        checked: c.role === area && !partOf(c),
        onSelect: () => void moveTo(c.id, { area }),
      })),
      ...parts.map((p, n) => ({ label: p.title || `Section ${n + 1}`, checked: partOf(c) === p.id, onSelect: () => void moveTo(c.id, { section: p }) })),
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
    const canDrop = dragging && dragging !== c.id && (chapters.find((x) => x.id === dragging)?.role !== "part" || c.role === "part");
    return (
      <li
        key={c.id}
        draggable
        className={`${c.id === chapter?.id ? "is-current" : ""}${dragging === c.id ? " is-dragging" : ""}${inPart ? " is-in-part" : ""}${c.role === "part" ? " is-part" : ""}`}
        onDragStart={(e) => {
          setDragging(c.id);
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", c.id);
        }}
        onDragEnd={() => setDragging(null)}
        onDragOver={(e) => canDrop && e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (dragging) void moveTo(dragging, { section: c });
          setDragging(null);
        }}
      >
        <button type="button" className="writing-chapter" onClick={() => void saving.current.then(() => (setChapterId(c.id), setPicked((n) => n + 1)))}>
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
      className="writing-area"
      onDragOver={(e) => dragging && chapters.find((x) => x.id === dragging)?.role !== "part" && e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (dragging) void moveTo(dragging, { area });
        setDragging(null);
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
            {words(project.words)}
          </span>
        </div>
        <div className="writing-head-actions">
          <button type="button" className={`btn btn-quiet${side === "preview" ? " is-on" : ""}`} aria-pressed={side === "preview"} onClick={() => void flushEditor.current?.().finally(() => setSide((s) => (s === "preview" ? null : "preview")))}>
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
            {body.map(row)}
            {areaHead("back")}
            {back.map(row)}
          </ol>
          <p className="muted writing-hint">Drag pages to put them in order, or into another area or section. Each area's + adds a page.</p>
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
              <button type="button" className="writing-list-toggle is-floating" aria-label="Show the list" title="Show the list" onClick={() => setListOpen(true)}>
                <Icon name="panelLeft" size={17} />
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
                onWriteMyself={(html) => void writeMyself(chapter, html)}
                onOpenDetails={() => setDialog("details")}
              onOpenSources={() => setDialog("sources")}
              />
            ) : (
              chapter && (
                <ChapterEditor
                  key={chapter.id}
                  chapter={chapter}
                  onSave={saveChapter(chapter.id)}
                  onSaveState={(state, w) => setSave({ state, words: w })}
                  flushRef={flushEditor}
                  insertRef={insertInEditor}
                  poem={current && isPoem(current) ? (current.centred ? "centred" : "left") : null}
                  sources={settings.sources}
                  citationStyle={settings.citationStyle}
                  onSources={(sources, citationStyle) => saveSettings({ ...settings, sources, citationStyle })}
                />
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
          onChange={(sources, citationStyle) => saveSettings({ ...settings, sources, citationStyle })}
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
          onClose={() => setDialog(null)}
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

import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
// Scribe (the Writing page): books you write in TBV (open one to write its
// chapters, change its details and export an EPUB), and your notes from reading.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNarrow } from "../lib/useNarrow";
import { api, isWeb } from "../api";
import { editionName, editionsOf } from "./bookEditions";
import { LinkBookDialog } from "./LinkBooks";
import { isSample } from "./sampleBook";
import { EXPORT_CHANGED } from "./CanvaLink";
import { startNewEdition } from "./newEdition";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Icon } from "../components/Icon";
import { Menu } from "../components/Menu";
import { useToast } from "../components/Toast";
import { Notes } from "../notes/Notes";
import { ChapterEditor } from "./ChapterEditor";
import { quoteHtml } from "./fromNotes";
import { QuoteDrawer } from "./QuoteDrawer";
import { BookPreview, MadePage } from "./BookPreview";
import { bookOrder, escapeXml, madeSectionHtml, readExport } from "./epub";
import { ScribeBooks } from "./ScribeBooks";
import { ADD_MENUS, firstLine, isMade, isNumbered, isPoem, KINDS, numberInWords, readPage, romanOf, startingTitle, writePage } from "./pages";
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
const words = (n) => `${n.toLocaleString()} ${n === 1 ? "word" : "words"}`;
/** What the tab of notes from books is called. */
export const BOOK_NOTES_LABEL = "Reading notes";
const CHIPS = [
    { chip: "notes", label: "Personal notes" },
    { chip: "book_notes", label: BOOK_NOTES_LABEL },
    { chip: "books", label: "Write a book" },
];
const NOTES_TAB = { notes: "personal", book_notes: "book_notes" };
/** Scribe: the books you write and everything you've noted while reading or on your own. */
export function Writing({ refreshKey, search, onClearSearch, onOpenBook, booksShown = true, chip, setChip, openId, setOpenId, }) {
    const [creating, setCreating] = useState(null);
    const [importing, setImporting] = useState(false);
    const [boxing, setBoxing] = useState(false);
    const publisher = usePublisher();
    const [ask, setAsk] = useState(null);
    const [reload, setReload] = useState(0);
    const showing = booksShown || chip !== "books" ? chip : "notes";
    const projects = useProjects(booksShown, refreshKey, reload);
    const toast = useToast();
    // The sample book, the first time Scribe has no books on this device.
    useEffect(() => {
        if (projects.state === "ready" && booksShown && !isWeb)
            void addSampleOnce(projects.list).then((added) => added && setReload((n) => n + 1));
    }, [projects, booksShown]);
    if (openId && booksShown)
        return (_jsx(ProjectView, { id: openId, books: projects.state === "ready" ? projects.list : [], onOpenEdition: (other) => {
                setReload((n) => n + 1);
                setOpenId(other);
            }, onBooksChanged: () => setReload((n) => n + 1), refreshKey: refreshKey, onOpenBook: onOpenBook, onBack: () => {
                setOpenId(null);
                setReload((n) => n + 1);
            }, onDeleted: () => {
                setOpenId(null);
                setReload((n) => n + 1);
            } }, openId));
    const newNote = (kind) => {
        if (showing === "books")
            setChip(kind === "personal" ? "notes" : "book_notes");
        setAsk((a) => ({ kind, n: (a?.n ?? 0) + 1 }));
    };
    const newBook = (template = "blank") => {
        setChip("books");
        setCreating(template);
    };
    const newItems = [
        { label: "Note", icon: "noteLines", description: "Write freely", onSelect: () => newNote("personal") },
        { label: "Book note", icon: "notePen", description: "Write about a book in your library", onSelect: () => newNote("book_note") },
        ...(booksShown
            ? [
                { label: "Book", icon: "bookOpen", description: "Create a manuscript for EPUB export", onSelect: () => newBook() },
                {
                    label: "Import a manuscript",
                    icon: "importFile",
                    description: "From Word, OpenDocument, RTF, text, Markdown or EPUB",
                    onSelect: () => {
                        setChip("books");
                        setImporting(true);
                    },
                },
                {
                    label: "Sample book",
                    icon: "bookClosed",
                    description: `${SAMPLE_TITLE} by ${SAMPLE_AUTHOR}, to try Scribe on`,
                    onSelect: () => {
                        setChip("books");
                        toast(`Adding ${SAMPLE_TITLE}…`);
                        void addSampleBook().then(() => {
                            setReload((n) => n + 1);
                            toast(`${SAMPLE_TITLE} is in your books`);
                        }, (e) => toast(String(e).replace(/^Error: /, "")));
                    },
                },
                {
                    label: "Box set",
                    icon: "layers",
                    description: "Several of your books joined into one",
                    onSelect: () => publisher.check("Box sets", () => {
                        setChip("books");
                        setBoxing(true);
                    }),
                },
            ]
            : []),
    ];
    return (_jsxs("div", { className: `library writing-home scribe writing-${showing}`, children: [_jsxs("header", { className: "scribe-top", children: [_jsxs("div", { className: "library-head scribe-head", children: [_jsx("h1", { className: "library-title", children: "Scribe" }), _jsxs("div", { className: "split-button", children: [_jsxs("button", { type: "button", className: "btn btn-primary split-main", onClick: () => (showing === "books" ? newBook() : newNote(showing === "book_notes" ? "book_note" : "personal")), children: [_jsx(Icon, { name: "plus", size: 15 }), " New"] }), _jsx(Menu, { label: "Other kinds of new", className: "btn btn-primary split-arrow", align: "end", trigger: _jsx(Icon, { name: "chevronDown", size: 14 }), items: newItems })] })] }), _jsx("div", { className: "scribe-chips", role: "tablist", "aria-label": "What to show", children: CHIPS.filter((c) => booksShown || c.chip !== "books").map((c) => (_jsx("button", { type: "button", role: "tab", "aria-selected": showing === c.chip, className: `chip${showing === c.chip ? " is-active" : ""}`, onClick: () => setChip(c.chip), children: c.label }, c.chip))) })] }), showing === "books" ? (_jsx(ScribeBooks, { projects: projects, search: search, onOpen: setOpenId, onStart: newBook, onChanged: () => setReload((n) => n + 1), onRetry: () => setReload((n) => n + 1), onOpenBook: onOpenBook })) : (_jsx(Notes, { kindTab: NOTES_TAB[showing], ask: ask, search: search, refreshKey: refreshKey, onClearSearch: onClearSearch, onOpenBook: onOpenBook, onGoToBooks: booksShown ? () => setChip("books") : undefined })), importing && (_jsx(ImportBookDialog, { onCancel: () => setImporting(false), onCreated: (id) => {
                    setImporting(false);
                    setReload((n) => n + 1);
                    setOpenId(id);
                } })), boxing && (_jsx(BoxSetDialog, { onCancel: () => setBoxing(false), onCreated: (id) => {
                    setBoxing(false);
                    setReload((n) => n + 1);
                    setOpenId(id);
                } })), creating && (_jsx(NewBookDialog, { startWith: creating, onCancel: () => setCreating(null), onCreated: (id) => {
                    setCreating(null);
                    setReload((n) => n + 1);
                    setOpenId(id);
                } }))] }));
}
/** The books you're writing, loaded again when something changes. */
function useProjects(shown, refreshKey, reload) {
    const [projects, setProjects] = useState({ state: "loading" });
    useEffect(() => {
        if (!shown)
            return setProjects({ state: "ready", list: [] });
        let current = true;
        api.writingProjects().then((list) => current && setProjects({ state: "ready", list }), (e) => current && setProjects({ state: "error", message: String(e) }));
        return () => {
            current = false;
        };
    }, [shown, refreshKey, reload]);
    return projects;
}
const AREA_NAMES = { front: "Front matter", chapter: "Body", back: "Back matter" };
function ProjectView({ id, books, onOpenEdition, onBooksChanged, refreshKey, onOpenBook, onBack, onDeleted, }) {
    const [view, setView] = useState(null);
    const [sourceHistory, setSourceHistory] = useState({ undo: [], redo: [] });
    const [error, setError] = useState(null);
    const [chapterId, setChapterId] = useState(null);
    const [save, setSave] = useState({ state: "saved", words: 0 });
    const [restoreDraft, setRestoreDraft] = useState();
    const [dialog, setDialog] = useState(null);
    const publisher = usePublisher();
    const [deletingChapter, setDeletingChapter] = useState(null);
    const [dragging, setDragging] = useState(null);
    const [listOpen, setListOpen] = useState(true);
    // On a phone the contents and the page share the screen badly, so one shows at a time:
    // picking a page opens it, and the Contents button goes back.
    const narrow = useNarrow();
    const toast = useToast();
    // Waiting saves, so the EPUB and other chapters see the latest words.
    const saving = useRef(Promise.resolve());
    const flushEditor = useRef(null);
    const insertInEditor = useRef(null);
    // Beside the chapter, quotes from your notes; or, in its place, the whole book as it will be exported.
    const [side, setSide] = useState(null);
    // Counts picks in the list, so picking the page already open still takes the preview to it.
    const [picked, setPicked] = useState(0);
    const load = useCallback(async () => {
        try {
            const v = await api.writingProject(id);
            setView(v);
            setError(null);
            return v;
        }
        catch (e) {
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
        const changed = (e) => {
            const { projectId, json } = e.detail;
            if (projectId === id)
                setView((v) => v && { ...v, project: { ...v.project, export: json } });
        };
        window.addEventListener(EXPORT_CHANGED, changed);
        return () => window.removeEventListener(EXPORT_CHANGED, changed);
    }, [id]);
    const chapters = useMemo(() => bookOrder(view?.chapters ?? []), [view?.chapters]);
    const settings = useMemo(() => readExport(view?.project.export), [view?.project.export]);
    const partIds = new Set(chapters.filter((c) => c.role === "part").map((c) => c.id));
    /** The part (body section) a section is in, or null for the book's own. */
    const partOf = (c) => (c.role !== "part" && c.part && partIds.has(c.part) ? c.part : null);
    const chapter = chapters.find((c) => c.id === chapterId) ?? chapters[0] ?? null;
    const parts = chapters.filter((c) => c.role === "part");
    const sections = chapters.filter((c) => c.role !== "part");
    /** Book-wide settings (numbering, the copyright page's details…), kept with the export settings. */
    // The book's other editions, and starting the next one.
    const others = settings.edition ? editionsOf(settings.edition.group, books.filter((b) => b.id !== id), (b) => readExport(b.export).edition) : [];
    const editionItems = [
        ...(others.length
            ? [
                { heading: _jsx("span", { className: "menu-tip", children: "Editions" }) },
                ...[...others, { id, edition: settings.edition }]
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
                    icon: "layers",
                    onSelect: () => void saving.current
                        .then(() => flushEditor.current?.())
                        .then(() => startNewEdition(view.project))
                        .then((made) => {
                        toast(`Made the ${readExport(made.project.export).edition?.name.toLowerCase() ?? "new edition"}, with every page of this one. You're in it now.`);
                        onOpenEdition(made.project.id);
                    }, (e) => toast(`Couldn't start a new edition: ${String(e).replace(/^Error: /, "")}`)),
                },
                ...(view && !isSample(view.project) && books.some((b) => b.id !== id && !isSample(b))
                    ? [{ label: "Link another book…", icon: "link", onSelect: () => void saving.current.then(() => setDialog("link")) }]
                    : []),
                ...(others.length
                    ? [
                        {
                            label: "Unlink from its other editions",
                            onSelect: () => {
                                const e = settings.edition;
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
    const saveSettings = (next) => {
        const json = JSON.stringify(next);
        setView((v) => v && { ...v, project: { ...v.project, export: json } });
        saving.current = saving.current.then(() => api.setWritingExport(id, json)).then(() => undefined, (e) => toast(String(e)));
    };
    const sourceSnapshot = () => ({
        sources: settings.sources, citationStyle: settings.citationStyle, customSourceFormat: settings.customSourceFormat,
    });
    const changeSources = (change) => {
        const previous = sourceSnapshot();
        const next = { ...previous, ...change };
        if (JSON.stringify(next) === JSON.stringify(previous))
            return;
        setSourceHistory((history) => ({ undo: [...history.undo, previous].slice(-100), redo: [] }));
        saveSettings({ ...settings, ...next });
    };
    const restoreSources = (direction) => {
        const snapshot = sourceHistory[direction].at(-1);
        if (!snapshot)
            return;
        const opposite = direction === "undo" ? "redo" : "undo";
        const previous = sourceSnapshot();
        setSourceHistory((history) => ({
            ...history,
            [direction]: history[direction].slice(0, -1),
            [opposite]: [...history[opposite], previous],
        }));
        saveSettings({ ...settings, ...snapshot });
    };
    const saveChapter = (cid) => async (title, body) => {
        const done = saving.current.then(async () => {
            const saved = await api.saveWritingChapter(cid, title, body);
            setView((v) => v && {
                ...v,
                chapters: v.chapters.map((c) => (c.id === cid ? saved : c)),
                project: { ...v.project, words: v.project.words - (v.chapters.find((c) => c.id === cid)?.words ?? 0) + saved.words },
            });
        });
        saving.current = done.catch(() => undefined);
        return done;
    };
    /** Adds a page of this kind at the end of its area (or of a body section), and opens it. */
    const addPage = async (kind, role, part = null) => {
        await saving.current;
        try {
            const siblings = chapters.filter((c) => c.role === role && partOf(c) === part);
            // A new chapter has no title of its own yet, so it takes its number wherever it goes.
            const title = role === "part" ? `Part ${numberInWords(parts.length + 1)}` : kind === "chapter" ? "" : startingTitle(kind, view.project);
            // A contents page written by hand starts as a list of what's in the book.
            const body = kind === "contents_manual"
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
            if (narrow)
                setListOpen(false);
        }
        catch (e) {
            toast(String(e));
        }
    };
    const setPage = async (c, change) => {
        try {
            const saved = await api.setWritingChapterPage(c.id, writePage({ ...readPage(c.page, c.role), ...change }));
            setView((v) => v && { ...v, chapters: v.chapters.map((x) => (x.id === c.id ? { ...x, page: saved.page } : x)) });
        }
        catch (e) {
            toast(String(e));
        }
    };
    const changeFrontPageType = async (c, kind) => {
        const before = readPage(c.page, c.role);
        if (before.kind === kind || !view)
            return;
        try {
            await saving.current;
            if (isMade(before)) {
                const body = madeSectionHtml({ project: view.project, chapters, settings }, c.id);
                await api.saveWritingChapter(c.id, c.title, body);
            }
            await setPage(c, { kind, byHand: kind !== "sources" && !!KINDS[kind].made });
            if (isMade(before))
                await load();
        }
        catch (error) {
            toast(String(error));
        }
    };
    /** A ready-made page becomes one you write, starting from what Scribe made. */
    const writeMyself = async (c, html) => {
        await saving.current;
        try {
            await api.saveWritingChapter(c.id, c.title, html);
            await api.setWritingChapterPage(c.id, writePage({ ...readPage(c.page, c.role), byHand: true }));
            await load();
        }
        catch (e) {
            toast(String(e));
        }
    };
    /**
     * Moves a section by dragging (or the ••• menu): onto another section it
     * takes that one's place, area and body section; onto a body section's
     * own row it goes first inside it; onto an area's heading, to that area's end.
     * Body sections move only among each other.
     */
    const moveTo = async (fromId, target) => {
        const from = chapters.find((c) => c.id === fromId);
        if (!from)
            return;
        const onto = "section" in target ? target.section : null;
        if (onto?.id === from.id)
            return;
        if (from.role === "part" && (!onto || onto.role !== "part"))
            return;
        let role = from.role;
        let part = partOf(from);
        if (from.role !== "part") {
            if (!onto)
                [role, part] = [target.area, null];
            else if (onto.role === "part")
                [role, part] = ["chapter", onto.id];
            else
                [role, part] = [onto.role, partOf(onto)];
        }
        const order = chapters.map((c) => c.id).filter((c) => c !== from.id);
        if (!onto)
            order.push(from.id);
        else if (onto.role === "part" && from.role !== "part")
            order.splice(order.indexOf(onto.id) + 1, 0, from.id);
        else {
            const down = chapters.findIndex((c) => c.id === from.id) < chapters.findIndex((c) => c.id === onto.id);
            order.splice(order.indexOf(onto.id) + (down ? 1 : 0), 0, from.id);
        }
        setView((v) => v && { ...v, chapters: order.map((o) => ({ ...v.chapters.find((c) => c.id === o), ...(o === from.id ? { role, part } : {}) })) });
        try {
            await saving.current;
            if (role !== from.role)
                await api.setWritingChapterRole(from.id, role);
            if (part !== partOf(from))
                await api.setWritingChapterPart(from.id, part);
            await api.orderWritingChapters(id, order);
        }
        catch (e) {
            toast(String(e));
        }
        void load();
    };
    /** Sections of the same kind and place, for Move up and Move down. */
    const groupOf = (c) => (c.role === "part" ? "part" : `${partOf(c) ?? ""}:${c.role}`);
    const neighbour = (c, by) => {
        const same = chapters.filter((x) => groupOf(x) === groupOf(c));
        return same[same.findIndex((x) => x.id === c.id) + by];
    };
    const nudge = (c, by) => {
        const other = neighbour(c, by);
        if (other)
            void moveTo(c.id, { section: other });
    };
    // Chapter numbers as the book will have them.
    const numbers = new Map();
    {
        let n = 0;
        for (const c of chapters) {
            if (c.role === "part" && settings.numbering === "restart")
                n = 0;
            if (isNumbered(c))
                numbers.set(c.id, ++n);
        }
    }
    const kindItems = (area, part = null) => ADD_MENUS[area].map((kind) => ({
        label: KINDS[kind].label,
        description: KINDS[kind].hint,
        onSelect: () => void addPage(kind, area, part),
    }));
    const addMenus = {
        front: kindItems("front"),
        chapter: [
            ...kindItems("chapter"),
            "divider",
            { label: "Section", icon: "layers", description: "A group of chapters, such as Part One", onSelect: () => void addPage("custom", "part") },
        ],
        back: kindItems("back"),
    };
    const chapterMenu = (c) => {
        if (c.role === "part")
            return [
                { label: "Move up", icon: "chevronUp", disabled: !neighbour(c, -1), onSelect: () => nudge(c, -1) },
                { label: "Move down", icon: "chevronDown", disabled: !neighbour(c, 1), onSelect: () => nudge(c, 1) },
                "divider",
                { heading: _jsx("span", { className: "menu-tip", children: "Add to this section" }) },
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
            { heading: _jsx("span", { className: "menu-tip", children: "This page" }) },
            ...(c.role === "front" ? [{
                    label: "Change page type",
                    submenu: ADD_MENUS.front.map((kind) => ({
                        label: KINDS[kind].label,
                        checked: page.kind === kind,
                        onSelect: () => void changeFrontPageType(c, kind),
                    })),
                }] : []),
            { label: "Show in the contents", checked: page.inContents, onSelect: () => void setPage(c, { inContents: !page.inContents }) },
            { label: "Show its title", checked: page.showTitle, onSelect: () => void setPage(c, { showTitle: !page.showTitle }) },
            {
                label: "Start on a new page",
                hint: page.newPage === null ? (isPoem(page) ? "Poems always do, unless you say" : "As the book's export settings say") : undefined,
                checked: page.newPage ?? (isPoem(page) || settings.newPage),
                onSelect: () => void setPage(c, { newPage: !(page.newPage ?? (isPoem(page) || settings.newPage)) }),
            },
            ...(isPoem(page) ? [{ label: "Centre the lines", checked: page.centred, onSelect: () => void setPage(c, { centred: !page.centred }) }] : []),
            ...(made && page.byHand ? [{ label: "Let Scribe make it again", icon: "sync", onSelect: () => void setPage(c, { byHand: false }) }] : []),
            "divider",
            { heading: _jsx("span", { className: "menu-tip", children: "Where it goes" }) },
            ...["front", "chapter", "back"].map((area) => ({
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
        return (_jsxs("div", { className: "library-empty", role: "alert", children: [_jsx("h2", { children: "This book couldn't be opened" }), _jsx("p", { className: "muted", children: error }), _jsx("button", { type: "button", className: "btn btn-quiet", onClick: onBack, children: "Back to your books" })] }));
    if (!view)
        return _jsx("div", { className: "library-loading", "aria-busy": "true", "aria-label": "Opening the book" });
    const project = view.project;
    const saveLabel = { saved: "Saved", saving: "Saving…", unsaved: "Saving soon", failed: "Not saved yet. Trying again with your next change." }[save.state];
    const current = chapter ? readPage(chapter.page, chapter.role) : null;
    const row = (c) => {
        const page = readPage(c.page, c.role);
        const inPart = !!partOf(c);
        const number = c.role === "part" ? romanOf(parts.findIndex((p) => p.id === c.id) + 1) : numbers.has(c.id) ? numbers.get(c.id) : KINDS[page.kind].made && !page.byHand ? "◇" : "·";
        const words = c.role === "part" ? chapters.filter((x) => partOf(x) === c.id).reduce((n, x) => n + x.words, 0) : c.words;
        const canDrop = dragging && dragging !== c.id && (chapters.find((x) => x.id === dragging)?.role !== "part" || c.role === "part");
        return (_jsxs("li", { draggable: true, className: `${c.id === chapter?.id ? "is-current" : ""}${dragging === c.id ? " is-dragging" : ""}${inPart ? " is-in-part" : ""}${c.role === "part" ? " is-part" : ""}`, onDragStart: (e) => {
                setDragging(c.id);
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", c.id);
            }, onDragEnd: () => setDragging(null), onDragOver: (e) => canDrop && e.preventDefault(), onDrop: (e) => {
                e.preventDefault();
                if (dragging)
                    void moveTo(dragging, { section: c });
                setDragging(null);
            }, children: [_jsxs("button", { type: "button", className: "writing-chapter", onClick: () => void saving.current.then(() => (setChapterId(c.id), setPicked((n) => n + 1), narrow && setListOpen(false))), children: [_jsx("span", { className: "writing-chapter-number num", children: number }), _jsx("span", { className: `writing-chapter-name${c.title ? "" : " muted"}`, children: c.title || (c.role === "part" ? "Untitled section" : numbers.has(c.id) ? `Chapter ${numbers.get(c.id)}` : (isPoem(page) && firstLine(c.body)) || KINDS[page.kind].label) }), _jsx("span", { className: "muted num writing-chapter-words", children: words.toLocaleString() })] }), _jsx(Menu, { label: `More for ${c.title || "this page"}`, className: "writing-chapter-more", trigger: _jsx(Icon, { name: "more", size: 16 }), items: chapterMenu(c) })] }, c.id));
    };
    const areaHead = (area) => (_jsxs("li", { className: "writing-area", onDragOver: (e) => dragging && chapters.find((x) => x.id === dragging)?.role !== "part" && e.preventDefault(), onDrop: (e) => {
            e.preventDefault();
            if (dragging)
                void moveTo(dragging, { area });
            setDragging(null);
        }, children: [_jsx("span", { children: AREA_NAMES[area] }), area === "chapter" && parts.length > 0 && (_jsx(Menu, { label: "Chapter numbers", className: "writing-area-add", align: "end", trigger: _jsx(Icon, { name: "listNumber", size: 14 }), items: [
                    { heading: _jsx("span", { className: "menu-tip", children: "Chapter numbers" }) },
                    { label: "Start again in each section", checked: settings.numbering === "restart", onSelect: () => saveSettings({ ...settings, numbering: "restart" }) },
                    { label: "Run on through the book", checked: settings.numbering === "continuous", onSelect: () => saveSettings({ ...settings, numbering: "continuous" }) },
                ] })), _jsx(Menu, { label: `Add to ${AREA_NAMES[area].toLowerCase()}`, className: "writing-area-add", align: "end", trigger: _jsx(Icon, { name: "plus", size: 15 }), items: addMenus[area] })] }));
    const front = chapters.filter((c) => c.role === "front" && !partOf(c));
    const back = chapters.filter((c) => c.role === "back" && !partOf(c));
    const body = chapters.filter((c) => !front.includes(c) && !back.includes(c));
    return (_jsxs("div", { className: `writing-project${listOpen ? "" : " is-list-closed"}${side ? ` has-${side}` : ""}`, children: [_jsxs("header", { className: "writing-head", children: [_jsxs("button", { type: "button", className: "btn btn-quiet btn-small", onClick: () => void saving.current.then(onBack), children: [_jsx(Icon, { name: "arrowLeft", size: 16 }), " Your books"] }), _jsxs("div", { className: "writing-head-title", children: [_jsx("h1", { children: project.title }), _jsxs("span", { className: "muted", children: [project.author ? `${project.author} · ` : "", settings.edition ? `${settings.edition.name} · ` : "", words(project.words)] })] }), _jsxs("div", { className: "writing-head-actions", children: [_jsxs("button", { type: "button", className: `btn btn-quiet${side === "preview" ? " is-on" : ""}`, "aria-pressed": side === "preview", onClick: () => void flushEditor.current?.().finally(() => (setSide((s) => (s === "preview" ? null : "preview")), narrow && setListOpen(false))), children: [_jsx(Icon, { name: "bookOpen", size: 16 }), " Preview"] }), _jsxs("button", { type: "button", className: `btn btn-quiet${side === "quotes" ? " is-on" : ""}`, "aria-pressed": side === "quotes", onClick: () => setSide((s) => (s === "quotes" ? null : "quotes")), children: [_jsx(Icon, { name: "notes", size: 16 }), " Notes"] }), _jsxs("button", { type: "button", className: "btn btn-quiet", onClick: () => setDialog("details"), children: [_jsx(Icon, { name: "info", size: 16 }), " Book details"] }), !isWeb && (_jsxs("button", { type: "button", className: "btn btn-quiet", onClick: () => setDialog("drafts"), children: [_jsx(Icon, { name: "drafts", size: 16 }), " Drafts"] })), _jsxs("button", { type: "button", className: "btn btn-primary", onClick: () => setDialog("export"), children: [_jsx(Icon, { name: "upload", size: 16 }), " Export"] }), _jsx(Menu, { label: "More", className: "btn btn-quiet btn-icon", trigger: _jsx(Icon, { name: "more", size: 18 }), items: [
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
                                ] })] })] }), _jsxs("div", { className: "writing-body", children: [_jsxs("aside", { className: "writing-chapters", "aria-label": "The book's pages", children: [_jsxs("div", { className: "writing-chapters-head", children: [_jsx("strong", { children: "Contents" }), _jsx("button", { type: "button", className: "writing-list-toggle", "aria-label": "Hide the list", title: "Hide the list", onClick: () => setListOpen(false), children: _jsx(Icon, { name: "panelLeft", size: 17 }) })] }), _jsxs("ol", { className: "writing-chapter-list", children: [areaHead("front"), front.map(row), areaHead("chapter"), body.map(row), areaHead("back"), back.map(row)] }), _jsx("p", { className: "muted writing-hint", children: "Drag pages to put them in order, or into another area or section. Each area's + adds a page." })] }), side === "preview" ? (_jsx(BookPreview, { project: project, chapters: chapters, settings: settings, showing: chapter?.id ?? null, picked: picked, onShowList: listOpen ? undefined : () => setListOpen(true), onSettings: saveSettings, onClose: () => setSide(null) })) : (_jsxs("section", { className: "writing-main", children: [!listOpen && (_jsxs("button", { type: "button", className: "writing-list-toggle is-floating", "aria-label": narrow ? "Contents" : "Show the list", title: narrow ? "Contents" : "Show the list", onClick: () => setListOpen(true), children: [_jsx(Icon, { name: narrow ? "chevronLeft" : "panelLeft", size: 17 }), narrow && _jsx("span", { children: "Contents" })] })), chapter && current && isMade(current) ? (_jsx(MadePage, { chapter: chapter, project: project, chapters: chapters, settings: settings, onTitle: (title) => void saveChapter(chapter.id)(title, chapter.body).catch((e) => toast(String(e))), onCopyright: (copyright) => saveSettings({ ...settings, copyright }), onEdition: (edition) => saveSettings({ ...settings, edition }), onWriteMyself: (html) => void writeMyself(chapter, html), onOpenDetails: () => setDialog("details"), onOpenSources: () => setDialog("sources"), onSourcesChange: (sources) => changeSources({ sources }), onFormatChange: (citationStyle, customSourceFormat) => changeSources({ citationStyle, customSourceFormat }), canUndoSources: sourceHistory.undo.length > 0, canRedoSources: sourceHistory.redo.length > 0, onUndoSources: () => restoreSources("undo"), onRedoSources: () => restoreSources("redo") }, chapter.id)) : (chapter && (_jsxs(_Fragment, { children: [current && isPoem(current) && _jsx(PoemSound, { sound: current.sound, onChange: (sound) => setPage(chapter, { sound }) }, `sound-${chapter.id}`), _jsx(ChapterEditor, { chapter: chapter, onSave: saveChapter(chapter.id), onSaveState: (state, w) => setSave({ state, words: w }), flushRef: flushEditor, insertRef: insertInEditor, poem: current && isPoem(current) ? (current.centred ? "centred" : "left") : null, sources: settings.sources, citationChapters: chapters, citationStyle: settings.citationStyle, onSources: (sources, citationStyle) => changeSources({ sources, citationStyle }) }, chapter.id)] }))), _jsxs("footer", { className: "writing-status muted", "aria-live": "polite", children: [_jsxs("span", { children: [words(save.words), " on this page"] }), _jsx("span", { className: save.state === "failed" ? "is-problem" : undefined, children: saveLabel })] })] })), side === "quotes" && _jsx(QuoteDrawer, { refreshKey: refreshKey, projectId: project.id, onInsert: (n) => insertInEditor.current?.(quoteHtml(n)), onClose: () => setSide(null) })] }), dialog === "sources" && (_jsx(SourcesDialog, { sources: settings.sources, style: settings.citationStyle, onChange: (sources, citationStyle) => changeSources({ sources, citationStyle }), onClose: () => setDialog(null) })), dialog === "details" && (_jsx(DetailsDialog, { project: project, onCancel: (p) => {
                    setView((v) => v && { ...v, project: { ...v.project, cover: p.cover, coverPath: p.coverPath } });
                    setDialog(null);
                }, onSaved: (p) => {
                    setView((v) => v && { ...v, project: p });
                    setDialog(null);
                } })), dialog === "export" && (_jsx(ExportDialog, { project: project, chapters: chapters, onFlush: async () => {
                    // Words typed a moment ago haven't been handed over to save yet.
                    await flushEditor.current?.();
                    await saving.current;
                    return (await load())?.chapters ?? chapters;
                }, onSettings: saveSettings, onClose: () => setDialog(null) })), dialog === "previews" && _jsx(PreviewsDialog, { project: project, chapters: chapters, settings: settings, showing: chapter?.id ?? null, onClose: () => setDialog(null) }), dialog === "editions" && (_jsx(StoreEditionsDialog, { project: project, chapters: chapters, settings: settings, onSettings: saveSettings, onFlush: async () => {
                    await flushEditor.current?.();
                    await saving.current;
                    return (await load())?.chapters ?? chapters;
                }, onChanged: () => void load(), onClose: () => setDialog(null) })), dialog === "cover" && _jsx(PaperbackCover, { project: project, trim: settings.print.trim, onClose: () => setDialog(null) }), (dialog === "preflight" || dialog === "copies") &&
                (() => {
                    const flush = async () => {
                        await flushEditor.current?.();
                        await saving.current;
                        return (await load())?.chapters ?? chapters;
                    };
                    return dialog === "preflight" ? _jsx(PreflightDialog, { project: project, onFlush: flush, onClose: () => setDialog(null) }) : _jsx(CopyCheckDialog, { project: project, onFlush: flush, onClose: () => setDialog(null) });
                })(), dialog === "drafts" && (_jsx(DraftsDialog, { project: project, onFlush: async () => {
                    await flushEditor.current?.();
                    await saving.current;
                    return (await load())?.chapters ?? chapters;
                }, onOpen: (bookId) => void saving.current.then(() => onOpenBook(bookId)), onRestore: (draft) => {
                    void (async () => {
                        try {
                            await flushEditor.current?.();
                            await saving.current;
                            setRestoreDraft(draft);
                            setDialog("importDraft");
                        }
                        catch (error) {
                            toast(String(error));
                        }
                    })();
                }, onImport: async () => {
                    // Saved first, so "Write from it" keeps today's last words in the draft it makes.
                    await flushEditor.current?.();
                    await saving.current;
                    setRestoreDraft(undefined);
                    setDialog("importDraft");
                }, onClose: () => setDialog(null) })), dialog === "link" && (_jsx(LinkBookDialog, { project: project, books: books, onCancel: () => setDialog(null), onDone: (message) => {
                    setDialog(null);
                    void load();
                    onBooksChanged();
                    toast(message);
                } })), dialog === "importDraft" && (_jsx(ImportBookDialog, { into: project, restoreDraft: restoreDraft, onCancel: () => setDialog("drafts"), onCreated: () => setDialog("drafts"), onIntoDone: (how) => {
                    void load();
                    if (how === "current") {
                        setDialog(null);
                        toast(restoreDraft ? "The draft is now editable in Scribe." : "The new version is in. What was there before is kept as a draft.");
                    }
                    else {
                        setDialog("drafts");
                        toast("Kept as a new draft.");
                    }
                } })), dialog === "delete" && (_jsx(ConfirmDialog, { title: `Delete ${project.title}?`, body: "Every chapter goes, on all your devices. Copies you've already exported stay as they are.", confirm: "Delete Book", danger: true, onCancel: () => setDialog(null), onConfirm: () => {
                    void api.deleteWritingProject(id).then(onDeleted, (e) => toast(String(e)));
                } })), deletingChapter && (_jsx(ConfirmDialog, { title: `Delete ${deletingChapter.title || (deletingChapter.role === "part" ? "this section" : "this page")}?`, body: deletingChapter.role === "part"
                    ? "Its own page goes, on all your devices. The chapters in it stay, in the body."
                    : `Its ${words(deletingChapter.words)} go too, on all your devices.`, confirm: deletingChapter.role === "part" ? "Delete section" : "Delete page", danger: true, onCancel: () => setDeletingChapter(null), onConfirm: () => {
                    const gone = deletingChapter;
                    setDeletingChapter(null);
                    void saving.current
                        .then(() => api.deleteWritingChapter(gone.id))
                        .then(() => {
                        if (chapter?.id === gone.id)
                            setChapterId(chapters.find((c) => c.id !== gone.id)?.id ?? null);
                        return load();
                    })
                        .catch((e) => toast(String(e)));
                } }))] }));
}

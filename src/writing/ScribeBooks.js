import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
// Scribe's Books tab: a banner to start a book, the four ways to start one,
// and the books you're writing, as cards or a list. Each book has a menu
// (its ••• button, a right-click, or holding it on a phone) with the same
// windows the open book uses.
import { useMemo, useState } from "react";
import { api, isWeb } from "../api";
import { GALLERY, galleryUrl } from "../collections/gallery";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { holdForMenu, openContextMenu } from "../components/ContextMenu";
import { Icon } from "../components/Icon";
import { Menu } from "../components/Menu";
import { useToast } from "../components/Toast";
import { relativeTime } from "../lib/format";
import { CopyCheckDialog } from "./CopyCheck";
import { readExport } from "./epub";
import { TEMPLATES } from "./pages";
import { saveAsTbv } from "./saveTbv";
import { startNewEdition } from "./newEdition";
import { isSample } from "./sampleBook";
import { LinkBookDialog } from "./LinkBooks";
import { latestOf, LinkedBookView, shelve } from "./LinkedBooks";
import { useNarrow } from "../lib/useNarrow";
import { DetailsDialog } from "./WritingDialogs";
const TEMPLATE_ICON = { blank: "file", novel: "bookOpen", collection: "layers", nonfiction: "bookClosed" };
const KIND_NAME = { blank: null, novel: "Novel", collection: "Short Story Collection", nonfiction: "Non-fiction" };
const SORTS = [
    { sort: "edited", label: "Last edited" },
    { sort: "title", label: "Title" },
    { sort: "newest", label: "Newest" },
];
const VIEW_KEY = "tbv.scribe.books";
/** The banner's painting: "" for a different one each time, or a gallery name. */
export const BANNER_KEY = "tbv.scribe.banner";
function readView() {
    try {
        const v = JSON.parse(localStorage.getItem(VIEW_KEY) ?? "{}");
        return { sort: SORTS.some((s) => s.sort === v.sort) ? v.sort : "edited", view: v.view === "list" ? "list" : "grid" };
    }
    catch {
        return { sort: "edited", view: "grid" };
    }
}
function readBanner() {
    try {
        return localStorage.getItem(BANNER_KEY) ?? "";
    }
    catch {
        return "";
    }
}
const words = (n) => `${n.toLocaleString()} ${n === 1 ? "word" : "words"}`;
/** "Novel · 12 chapters · 34,210 words". */
function metaLine(p) {
    const { kind, edition } = readExport(p.export);
    return [edition?.name, kind && KIND_NAME[kind], `${p.chapters} ${p.chapters === 1 ? "chapter" : "chapters"}`, words(p.words)].filter(Boolean).join(" · ");
}
/** "3 editions · Novel". */
function linkedLine(s) {
    const kind = readExport(latestOf(s).export).kind;
    return [`${s.editions.length} editions`, kind && KIND_NAME[kind]].filter(Boolean).join(" · ");
}
function coverOf(p) {
    const path = p.coverSmallPath ?? p.coverPath;
    return path ? (isWeb ? path : api.coverUrl(path)) : null;
}
/** The thin rule with a small diamond in the middle, between sections. */
export function DiamondRule() {
    return _jsx("div", { className: "rule-diamond", "aria-hidden": true });
}
/** The wide banner: a painting, the words, and Create a Book. */
function Banner({ onCreate }) {
    const [choice, setChoice] = useState(readBanner);
    // A different painting each visit, unless one was chosen.
    const [random] = useState(() => GALLERY[Math.floor(Math.random() * GALLERY.length)]?.name ?? "");
    const [choosing, setChoosing] = useState(false);
    const picture = galleryUrl(choice || random, "wide");
    const choose = (name) => {
        setChoice(name);
        try {
            localStorage.setItem(BANNER_KEY, name);
        }
        catch {
            /* just for this visit */
        }
    };
    return (_jsxs("section", { className: "scribe-banner", "aria-labelledby": "scribe-banner-title", children: [picture && _jsx("div", { className: "scribe-banner-art", style: { backgroundImage: `url(${picture})` }, "aria-hidden": true }), _jsxs("div", { className: "scribe-banner-text", children: [_jsx("span", { className: "scribe-banner-rule", "aria-hidden": true }), _jsx("h2", { id: "scribe-banner-title", children: "Your next book begins here" }), _jsx("p", { children: "Write, organize, and shape your manuscript in one place. Begin with a blank page or a prepared structure, then refine its appearance, preview the finished work, and export when it's ready." }), _jsxs("button", { type: "button", className: "btn btn-primary scribe-banner-go", onClick: onCreate, children: ["Create a Book ", _jsx(Icon, { name: "arrowRight", size: 16 })] })] }), _jsx("button", { type: "button", className: "scribe-banner-change", title: "Change the picture", "aria-label": "Change the picture", onClick: () => setChoosing(true), children: _jsx(Icon, { name: "image", size: 16 }) }), choosing && (_jsx("div", { className: "dialog-backdrop", onPointerDown: (e) => e.target === e.currentTarget && setChoosing(false), children: _jsxs("div", { className: "dialog scribe-banner-dialog", role: "dialog", "aria-label": "Banner picture", onKeyDown: (e) => e.key === "Escape" && setChoosing(false), children: [_jsx("h2", { children: "Banner picture" }), _jsxs("div", { className: "discover-backgrounds", role: "radiogroup", "aria-label": "Banner picture", children: [_jsxs("button", { type: "button", role: "radio", "aria-checked": choice === "", className: "picture-choice discover-background-none", onClick: () => choose(""), children: [_jsx(Icon, { name: "shuffle", size: 22 }), _jsx("span", { className: "picture-choice-label", children: "A different one each time" })] }), GALLERY.map((g) => {
                                    const url = galleryUrl(g.name, "wide");
                                    return (_jsx("button", { type: "button", role: "radio", "aria-checked": choice === g.name, className: "picture-choice", style: url ? { backgroundImage: `url(${url})` } : undefined, onClick: () => choose(g.name), children: _jsx("span", { className: "picture-choice-label", children: g.label }) }, g.name));
                                })] }), _jsx("div", { className: "dialog-actions", children: _jsx("button", { type: "button", className: "btn btn-primary", onClick: () => setChoosing(false), children: "Done" }) })] }) }))] }));
}
/** The four ways to start a book. */
function StartCards({ onStart }) {
    return (_jsxs("section", { className: "scribe-start", "aria-labelledby": "scribe-start", children: [_jsx("h2", { id: "scribe-start", className: "scribe-section-title", children: "Start a new book" }), _jsx("ul", { className: "scribe-templates", children: TEMPLATES.map((t) => (_jsx("li", { children: _jsxs("button", { type: "button", className: "scribe-template", onClick: () => onStart(t.value), children: [_jsx(Icon, { name: TEMPLATE_ICON[t.value], size: 30, className: "scribe-template-icon" }), _jsxs("span", { className: "scribe-template-text", children: [_jsx("strong", { children: t.label }), _jsx("span", { children: t.about })] }), _jsx(Icon, { name: "chevronRight", size: 16, className: "scribe-template-go" })] }) }, t.value))) })] }));
}
export function ScribeBooks({ projects, search, onOpen, onStart, onChanged, onRetry, onOpenBook, }) {
    const toast = useToast();
    const narrow = useNarrow();
    const [prefs, setPrefs] = useState(readView);
    const [dialog, setDialog] = useState(null);
    // The linked book whose editions and drafts are showing, by its edition group.
    const [openGroup, setOpenGroup] = useState(null);
    // Bumped after a change from a book's menu (like linking a draft), so the open linked book lists its drafts again.
    const [changes, setChanges] = useState(0);
    const change = (next) => setPrefs((p) => {
        const v = { ...p, ...next };
        try {
            localStorage.setItem(VIEW_KEY, JSON.stringify(v));
        }
        catch {
            /* just for this visit */
        }
        return v;
    });
    const list = projects.state === "ready" ? projects.list : [];
    // Editions of one book share a card; it's found when any of them matches, and sorts by the one that sorts first.
    const shelves = useMemo(() => {
        const sorted = [...list];
        if (prefs.sort === "title")
            sorted.sort((a, b) => a.title.localeCompare(b.title));
        else if (prefs.sort === "newest")
            sorted.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        else
            sorted.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        const q = search.trim().toLowerCase();
        const matches = (p) => [p.title, p.author ?? "", p.series ?? ""].some((t) => t.toLowerCase().includes(q));
        return shelve(sorted).filter((s) => !q || (s.kind === "book" ? matches(s.book) : s.editions.some((e) => matches(e.book))));
    }, [list, search, prefs.sort]);
    const openShelf = shelves.find((s) => s.kind === "linked" && s.group === openGroup) ?? null;
    const menuFor = (p) => [
        { label: "Open Book", icon: "bookOpen", onSelect: () => onOpen(p.id) },
        { label: "Change Cover", icon: "image", onSelect: () => setDialog({ kind: "details", project: p, focus: "cover" }) },
        { label: "Change Author", icon: "edit", onSelect: () => setDialog({ kind: "details", project: p, focus: "author" }) },
        { label: "Plagiarism Check", icon: "checkCircle", onSelect: () => setDialog({ kind: "copies", project: p }) },
        {
            label: "Save as .tbv File",
            icon: "download",
            onSelect: () => void saveAsTbv(p.id).then((saved) => saved && toast(`Saved “${p.title}” as a Scribe book file. Open it in Scribe with Import a manuscript.`), (e) => toast(`Couldn't save the book file: ${String(e).replace(/^Error: /, "")}`)),
        },
        ...(isWeb
            ? []
            : [
                {
                    label: "Duplicate Book",
                    icon: "copy",
                    onSelect: () => void api.duplicateWritingProject(p.id).then((copy) => {
                        onChanged();
                        toast(`Made “${copy.project.title}”. Where the original came from stays in its Book details.`);
                    }, (e) => toast(`Couldn't duplicate the book: ${String(e).replace(/^Error: /, "")}`)),
                },
                // The sample book is Milton's, not the writer's, so it's never linked to theirs.
                ...(isSample(p) || !list.some((b) => b.id !== p.id && !isSample(b))
                    ? []
                    : [{ label: "Link to Another Book…", icon: "link", onSelect: () => setDialog({ kind: "link", project: p }) }]),
                {
                    label: "Start a New Edition",
                    icon: "layers",
                    onSelect: () => void startNewEdition(p).then((made) => {
                        onChanged();
                        toast(`Made the ${readExport(made.project.export).edition?.name.toLowerCase() ?? "new edition"} of “${made.project.title}”, with every page of the last one. Add its ISBNs on the copyright page if you have them.`);
                    }, (e) => toast(`Couldn't start a new edition: ${String(e).replace(/^Error: /, "")}`)),
                },
            ]),
        "divider",
        { label: "Delete Book", icon: "trash", danger: true, onSelect: () => setDialog({ kind: "delete", project: p }) },
    ];
    // A linked book's menu leads with its editions and drafts; the rest is for its latest edition.
    const cardMenu = (p, linked) => linked
        ? [
            { label: "Editions and Drafts", icon: "layers", onSelect: () => setOpenGroup(linked.group) },
            { label: "Open Latest Edition", icon: "bookOpen", onSelect: () => onOpen(p.id) },
            ...menuFor(p).filter((m) => typeof m !== "object" || !("label" in m) || m.label !== "Open Book"),
        ]
        : menuFor(p);
    const cardProps = (p, linked = null) => ({
        ...holdForMenu(`${p.title}: book`, () => cardMenu(p, linked)),
        onContextMenu: (e) => openContextMenu(e, `${p.title}: book`, cardMenu(p, linked)),
    });
    const more = (p, linked = null) => (_jsx(Menu, { label: `More for ${p.title}`, className: "icon-btn scribe-book-more", trigger: _jsx(Icon, { name: "more", size: 18 }), items: cardMenu(p, linked) }));
    let books;
    if (projects.state === "error")
        books = (_jsxs("div", { className: "library-empty", role: "alert", children: [_jsx("h2", { children: "Your writing couldn't be loaded" }), _jsx("p", { className: "muted", children: projects.message }), _jsx("button", { type: "button", className: "btn btn-primary", onClick: onRetry, children: "Try again" })] }));
    else if (projects.state === "loading")
        books = _jsx("div", { className: "library-loading", "aria-busy": "true", "aria-label": "Loading your writing" });
    else if (openShelf)
        books = (_jsx(LinkedBookView, { shelf: openShelf, cover: coverOf, menuFor: menuFor, onOpen: onOpen, onOpenDraft: onOpenBook, onBack: () => setOpenGroup(null), refresh: changes }));
    else if (shelves.length === 0)
        books = (_jsxs("p", { className: "muted scribe-books-none", children: ["No book you're writing matches \u201C", search.trim(), "\u201D."] }));
    else if (prefs.view === "list")
        books = (_jsx("ul", { className: "scribe-book-rows", children: shelves.map((s) => {
                const p = s.kind === "book" ? s.book : latestOf(s);
                const linked = s.kind === "linked" ? s : null;
                const cover = coverOf(p);
                return (_jsxs("li", { className: `scribe-book-row${linked ? " is-linked" : ""}`, ...cardProps(p, linked), children: [_jsxs("button", { type: "button", className: "scribe-book-open", onClick: () => (linked ? setOpenGroup(linked.group) : onOpen(p.id)), children: [_jsx("span", { className: "scribe-book-thumb", children: cover ? _jsx("img", { src: cover, alt: "" }) : _jsx("span", { className: "scribe-book-blank", children: p.title }) }), _jsxs("span", { className: "scribe-book-text", children: [_jsx("strong", { children: p.title }), _jsx("span", { className: "muted", children: p.author || "No author yet" })] }), _jsx("span", { className: "muted scribe-book-meta", children: linked ? linkedLine(linked) : metaLine(p) }), _jsxs("span", { className: "muted scribe-book-when", children: ["Edited ", relativeTime(p.updatedAt)] })] }), more(p, linked)] }, linked ? linked.group : p.id));
            }) }));
    else
        books = (_jsx("ul", { className: "scribe-book-cards", children: shelves.map((s) => {
                const p = s.kind === "book" ? s.book : latestOf(s);
                const linked = s.kind === "linked" ? s : null;
                const cover = coverOf(p);
                return (_jsxs("li", { className: `scribe-book-card${linked ? " is-linked" : ""}`, ...cardProps(p, linked), children: [_jsxs("button", { type: "button", className: "scribe-book-open", onClick: () => (linked ? setOpenGroup(linked.group) : onOpen(p.id)), children: [_jsx("span", { className: "scribe-book-art", children: cover ? _jsx("img", { src: cover, alt: "", draggable: false }) : _jsx("span", { className: "scribe-book-blank", children: p.title }) }), _jsxs("span", { className: "scribe-book-text", children: [_jsx("strong", { children: p.title }), _jsx("span", { className: "muted", children: p.author || "No author yet" }), _jsx("span", { className: "muted scribe-book-meta", children: linked ? linkedLine(linked) : metaLine(p) })] })] }), more(p, linked)] }, linked ? linked.group : p.id));
            }) }));
    // The writer's own books: the sample doesn't count. Until there's one, the
    // banner invites them to begin; after, their books come first. On a phone the
    // start cards are left out, since New and the banner's button do the same.
    const own = list.some((p) => !isSample(p));
    const yours = (_jsxs("section", { className: "scribe-yours", "aria-labelledby": "scribe-yours", children: [_jsxs("div", { className: "scribe-yours-head", children: [_jsx("h2", { id: "scribe-yours", className: "scribe-section-title", children: "Your books" }), !openShelf && _jsxs("div", { className: "scribe-yours-tools", children: [_jsx(Menu, { label: `Sort: ${SORTS.find((s) => s.sort === prefs.sort)?.label}`, className: "notes-filter notes-sort", trigger: _jsxs(_Fragment, { children: [_jsx("span", { className: "muted", children: "Sort:" }), " ", _jsx("span", { children: SORTS.find((s) => s.sort === prefs.sort)?.label }), _jsx(Icon, { name: "chevronDown", size: 13 })] }), items: SORTS.map((s) => ({ label: s.label, checked: prefs.sort === s.sort, onSelect: () => change({ sort: s.sort }) })) }), _jsx("div", { className: "layout-switch", role: "radiogroup", "aria-label": "Layout", children: [
                                    ["grid", "Cards", "grid"],
                                    ["list", "List", "list"],
                                ].map(([view, label, icon]) => (_jsx("button", { type: "button", role: "radio", "aria-checked": prefs.view === view, "aria-label": label, title: label, className: prefs.view === view ? "is-active" : undefined, onClick: () => change({ view }), children: _jsx(Icon, { name: icon, size: 16 }) }, view))) })] })] }), books] }));
    return (_jsxs("div", { className: "scribe-books-page", children: [projects.state === "ready" && !own && _jsx(Banner, { onCreate: () => onStart("blank") }), own && list.length > 0 && yours, !narrow && (_jsxs(_Fragment, { children: [own && _jsx(DiamondRule, {}), _jsx(StartCards, { onStart: onStart })] })), !own && list.length > 0 && (_jsxs(_Fragment, { children: [!narrow && _jsx(DiamondRule, {}), yours] })), dialog?.kind === "details" && (_jsx(DetailsDialog, { project: dialog.project, focus: dialog.focus, onSaved: () => {
                    setDialog(null);
                    onChanged();
                }, onCancel: () => {
                    setDialog(null);
                    onChanged();
                } })), dialog?.kind === "link" && (_jsx(LinkBookDialog, { project: dialog.project, books: list, onCancel: () => setDialog(null), onDone: (message) => {
                    setDialog(null);
                    setChanges((n) => n + 1);
                    onChanged();
                    toast(message);
                } })), dialog?.kind === "copies" && (_jsx(CopyCheckDialog, { project: dialog.project, onFlush: () => api.writingProject(dialog.project.id).then((v) => v.chapters), onClose: () => setDialog(null) })), dialog?.kind === "delete" && (_jsx(ConfirmDialog, { title: `Delete ${dialog.project.title}?`, body: "Every chapter goes, on all your devices. Copies you've already exported stay as they are.", confirm: "Delete Book", danger: true, onCancel: () => setDialog(null), onConfirm: () => {
                    const id = dialog.project.id;
                    setDialog(null);
                    void api.deleteWritingProject(id).then(onChanged, (e) => toast(String(e)));
                } }))] }));
}

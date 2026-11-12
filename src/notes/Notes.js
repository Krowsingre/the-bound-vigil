import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { useRememberedDisclosure } from "../components/RememberedDetails";
// Scribe's notes: everything you've noted (All), your own notes (Notes), and
// what you noted from books, highlights included (Book notes). A row of
// filters, the notes pinned above the rest, then the rest. Opening a note
// slides it in at the side, where it can be read and changed.
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Icon } from "../components/Icon";
import { Menu } from "../components/Menu";
import { useToast } from "../components/Toast";
import { HIGHLIGHT_COLORS } from "../reader/settings";
import { NoteToBookDialog } from "../writing/NoteToBookDialog";
import { NewNoteDialog } from "./NewNoteDialog";
import { PersonalNoteEditor } from "./PersonalNoteEditor";
import { KIND_LABEL } from "./noteInfo";
import { NotePanel } from "./NotePanel";
import { NoteCards, NoteList, NoteTable } from "./NoteViews";
import { TagsDialog } from "./TagsDialog";
/** What the notes are called under each tab, above the list. */
export const NOTES_HEADING = { all: "All notes", personal: "Personal notes", book_notes: "Reading notes" };
const SORTS = [
    { sort: "recent", label: "Date added" },
    { sort: "updated", label: "Date modified" },
    { sort: "book", label: "Book, in reading order" },
];
const LAYOUTS = [
    { layout: "cards", label: "Cards", icon: "grid" },
    { layout: "list", label: "List", icon: "list" },
    { layout: "compact", label: "Compact list", icon: "rows" },
];
/** The kinds each tab can narrow to. */
const TYPES = {
    all: ["personal", "book_note", "highlight", "annotation"],
    book_notes: ["book_note", "highlight", "annotation"],
    personal: [],
};
const TYPE_LABEL = {
    personal: "Notes",
    book_note: "Book notes",
    highlight: "Highlights",
    annotation: "Highlights with notes",
};
const WHEN = [
    { when: "any", label: "Any date" },
    { when: "week", label: "Last 7 days" },
    { when: "month", label: "Last 30 days" },
    { when: "year", label: "This year" },
];
function sinceOf(when) {
    const day = 86_400_000;
    if (when === "week")
        return new Date(Date.now() - 7 * day).toISOString();
    if (when === "month")
        return new Date(Date.now() - 30 * day).toISOString();
    if (when === "year")
        return new Date(new Date().getFullYear(), 0, 1).toISOString();
    return null;
}
/** Pinned notes shown before "Show all". */
const PINNED_SHOWN = 3;
/** 0.62 starts everyone on cards, as in embre's concept; the sort chosen before is kept. */
const PREFS_KEY = "tbv.notes.view.062";
const OLD_PREFS_KEY = "tbv.notes.view";
function readPrefs() {
    try {
        const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "null") ?? { sort: JSON.parse(localStorage.getItem(OLD_PREFS_KEY) ?? "{}").sort };
        return {
            sort: SORTS.some((s) => s.sort === p.sort) ? p.sort : "recent",
            layout: LAYOUTS.some((l) => l.layout === p.layout) ? p.layout : "cards",
        };
    }
    catch {
        return { sort: "recent", layout: "cards" };
    }
}
/** A filter's dropdown: its words, and a chevron. */
function FilterButton({ label, on, items }) {
    return (_jsx(Menu, { label: label, className: `notes-filter${on ? " is-on" : ""}`, trigger: _jsxs(_Fragment, { children: [_jsx("span", { children: label }), _jsx(Icon, { name: "chevronDown", size: 13 })] }), items: items }));
}
export function Notes({ search, refreshKey, onClearSearch, onOpenBook, ask = null, onGoToBooks, kindTab, }) {
    const [prefs, setPrefs] = useState(readPrefs);
    const [type, setType] = useState(null);
    const [bookId, setBookId] = useState(null);
    const [colors, setColors] = useState([]);
    const [tag, setTag] = useState(null);
    const [when, setWhen] = useState("any");
    const [page, setPage] = useState(null);
    const [error, setError] = useState(null);
    const [reload, setReload] = useState(0);
    const [selectedId, setSelectedId] = useState(null);
    const [chosen, setChosen] = useState(null);
    const [allPinned, setAllPinned] = useRememberedDisclosure("notes.allPinned");
    const [writing, setWriting] = useState(null);
    const [deleting, setDeleting] = useState(null);
    const [tagging, setTagging] = useState(null);
    const [related, setRelated] = useState([]);
    const [toBook, setToBook] = useState(null);
    const toast = useToast();
    useEffect(() => {
        if (ask)
            setWriting({ kind: ask.kind });
    }, [ask]);
    // Another tab: its own kinds, and nothing open or chosen.
    useEffect(() => {
        setType(null);
        setSelectedId(null);
        setChosen(null);
    }, [kindTab]);
    const query = useMemo(() => ({
        tab: kindTab,
        sort: prefs.sort,
        search: search.trim() || null,
        bookId: bookId,
        colors,
        tag,
        since: sinceOf(when),
    }), [kindTab, prefs.sort, search, bookId, colors, tag, when]);
    useEffect(() => {
        let current = true;
        api.getNotes(query).then((p) => {
            if (!current)
                return;
            setPage(p);
            setError(null);
        }, (e) => current && setError(String(e)));
        return () => {
            current = false;
        };
    }, [query, refreshKey, reload]);
    const notes = useMemo(() => (page?.notes ?? []).filter((n) => !type || n.kind === type), [page, type]);
    const pinned = useMemo(() => notes.filter((n) => n.pinnedAt).sort((a, b) => (b.pinnedAt ?? "").localeCompare(a.pinnedAt ?? "")), [notes]);
    const rest = useMemo(() => notes.filter((n) => !n.pinnedAt), [notes]);
    const selected = selectedId ? (notes.find((n) => n.id === selectedId) ?? null) : null;
    // Related notes: the rest of the open note's book, whatever tab is showing.
    const selectedBook = selected?.book?.id ?? null;
    useEffect(() => {
        if (!selectedBook)
            return setRelated([]);
        let current = true;
        api
            .getNotes({ tab: "all", sort: "book", search: null, bookId: selectedBook, colors: [] })
            .then((p) => current && setRelated(p.notes), () => current && setRelated([]));
        return () => {
            current = false;
        };
    }, [selectedBook, refreshKey, reload]);
    const changePrefs = (change) => setPrefs((p) => {
        const next = { ...p, ...change };
        try {
            localStorage.setItem(PREFS_KEY, JSON.stringify(next));
        }
        catch {
            /* just not remembered */
        }
        return next;
    });
    const changed = () => setReload((n) => n + 1);
    const openInReader = useCallback((n) => n.book && onOpenBook(n.book.id, n.locator?.cfi ?? undefined), [onOpenBook]);
    const saveWords = async (n, words, title) => {
        try {
            if (n.kind === "personal")
                await api.savePersonalNote(n.id, title, words);
            else if (n.kind === "book_note")
                await api.saveBookNote(n.book.id, n.id, words);
            else
                await api.setAnnotationNote(n.id, words);
            changed();
        }
        catch (e) {
            toast(`That note couldn't be saved: ${String(e)}`);
            throw e;
        }
    };
    const textOf = (n) => [n.excerpt && `“${n.excerpt}”`, n.title, n.note, n.book && `— ${n.book.title}`].filter(Boolean).join("\n\n");
    const copy = (list) => {
        void navigator.clipboard?.writeText(list.map(textOf).join("\n\n———\n\n")).then(() => toast(list.length === 1 ? "Copied." : `${list.length} notes copied.`), () => toast("Copying isn't available here."));
    };
    const pin = async (list, on) => {
        try {
            for (const n of list)
                if (!!n.pinnedAt !== on)
                    await api.setNotePinned(n.id, on);
            changed();
        }
        catch (e) {
            toast(String(e));
        }
    };
    // The books being written in Scribe, which a note can belong to.
    const [projects, setProjects] = useState([]);
    useEffect(() => {
        if (!onGoToBooks)
            return;
        let current = true;
        api.writingProjects().then((list) => current && setProjects(list), () => undefined);
        return () => {
            current = false;
        };
    }, [onGoToBooks, refreshKey]);
    const belongTo = async (n, projectId) => {
        try {
            const done = await api.setNoteProject(n.id, projectId);
            toast(projectId ? `It's with ${done.project?.title ?? "that book"} now, in its Notes beside the pages.` : "It's a note of its own again.");
            changed();
        }
        catch (e) {
            toast(String(e));
        }
    };
    const saveTags = async (n, tags) => {
        try {
            await api.setNoteTags(n.id, tags);
            changed();
        }
        catch (e) {
            toast(String(e));
        }
    };
    const colorNote = async (n, color) => {
        try {
            const all = await api.getAnnotations(n.book.id);
            const a = all.find((x) => x.id === n.id);
            if (!a)
                return;
            await api.saveAnnotation({ id: a.id, bookId: a.bookId, kind: a.kind, excerpt: a.excerpt, note: a.note, color, locator: a.locator });
            changed();
        }
        catch (e) {
            toast(String(e));
        }
    };
    const menuFor = (n) => [
        ...(n.book
            ? [{ label: n.locator?.cfi ? "Open in Reader" : "Open the book", icon: "arrowRight", onSelect: () => openInReader(n) }]
            : []),
        { label: n.pinnedAt ? "Unpin" : "Pin", icon: "pin", onSelect: () => void pin([n], !n.pinnedAt) },
        ...(n.kind === "personal"
            ? [{ label: "Edit note…", icon: "edit", onSelect: () => setWriting({ kind: "personal", note: n }) }]
            : [{ label: "Tags…", icon: "tag", onSelect: () => setTagging(n) }]),
        { label: "Copy", icon: "copy", onSelect: () => copy([n]) },
        ...(onGoToBooks ? [{ label: "Add to a book I'm writing…", icon: "pen", onSelect: () => setToBook(n) }] : []),
        ...(n.kind === "personal" && projects.length
            ? [
                "divider",
                { heading: _jsx("strong", { children: "Belongs to" }) },
                { label: "No book: a note of its own", checked: !n.project, onSelect: () => void belongTo(n, null) },
                ...projects.map((p) => ({ label: p.title || "Untitled book", checked: n.project?.id === p.id, onSelect: () => void belongTo(n, p.id) })),
            ]
            : []),
        ...(n.kind === "highlight" || n.kind === "annotation"
            ? [
                "divider",
                { heading: _jsx("strong", { children: "Colour" }) },
                ...HIGHLIGHT_COLORS.map((c) => ({
                    label: c.label,
                    checked: n.color === c.value,
                    onSelect: () => void colorNote(n, c.value),
                })),
            ]
            : []),
        ...(n.book && n.book.id !== bookId
            ? [{ label: `All notes from ${n.book.title}`, onSelect: () => setBookId(n.book.id) }]
            : []),
        "divider",
        { label: `Delete ${KIND_LABEL[n.kind].toLowerCase()}…`, icon: "trash", danger: true, onSelect: () => setDeleting([n]) },
    ];
    // Choosing several, or opening one.
    const onCard = (n) => {
        if (!chosen) {
            if (n.kind === "personal") {
                setSelectedId(null);
                setWriting({ kind: "personal", note: n });
            }
            else
                setSelectedId((id) => (id === n.id ? null : n.id));
            return;
        }
        setChosen((c) => {
            const next = new Set(c);
            if (next.has(n.id))
                next.delete(n.id);
            else
                next.add(n.id);
            return next;
        });
    };
    const chosenNotes = notes.filter((n) => chosen?.has(n.id));
    const types = TYPES[kindTab];
    const filterBook = page?.books.find((b) => b.id === bookId);
    const highlightsShown = kindTab !== "personal" && (!type || type === "highlight" || type === "annotation");
    const typeItems = [
        { label: kindTab === "book_notes" ? "Everything from books" : "All types", checked: !type, onSelect: () => setType(null) },
        ...types.map((k) => ({ label: TYPE_LABEL[k], checked: type === k, onSelect: () => setType(k) })),
        ...(highlightsShown
            ? [
                "divider",
                { heading: _jsx("strong", { children: "Highlight colour" }) },
                ...HIGHLIGHT_COLORS.map((c) => ({
                    label: c.label,
                    checked: colors.includes(c.value),
                    onSelect: () => setColors((cs) => (cs.includes(c.value) ? cs.filter((x) => x !== c.value) : [...cs, c.value])),
                })),
            ]
            : []),
    ];
    const bookItems = [
        { label: "All books", checked: !bookId, onSelect: () => setBookId(null) },
        ...(page?.books ?? []).map((b) => ({ label: b.title, checked: bookId === b.id, onSelect: () => setBookId(b.id) })),
    ];
    const tagItems = [
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
    let body;
    if (error)
        body = (_jsxs("div", { className: "library-empty", role: "alert", children: [_jsx("h2", { children: "Your notes couldn't be loaded" }), _jsx("p", { className: "muted", children: error }), _jsx("button", { type: "button", className: "btn btn-primary", onClick: changed, children: "Try again" })] }));
    else if (!page)
        body = _jsx("div", { className: "library-loading", "aria-busy": "true", "aria-label": "Loading your notes" });
    else if (notes.length === 0 && !search.trim() && filterCount === 0)
        // Nothing of this kind yet: the page keeps its shape, with a way to start in the tab's own words.
        body = (_jsxs("section", { className: "notes-section notes-start", "aria-labelledby": "notes-all", children: [_jsx("div", { className: "notes-section-head", children: _jsx("h2", { id: "notes-all", children: NOTES_HEADING[kindTab] }) }), _jsxs("div", { className: "notes-empty-card", children: [_jsx(Icon, { name: kindTab === "personal" ? "notes" : kindTab === "book_notes" ? "bookOpen" : "edit", size: 28 }), _jsx("h3", { children: kindTab === "personal" ? "No notes yet" : kindTab === "book_notes" ? "No reading notes yet" : "Nothing written yet" }), _jsx("p", { className: "muted", children: kindTab === "personal"
                                ? "Notes of your own, about anything, live here."
                                : kindTab === "book_notes"
                                    ? "Highlights you make while reading gather here, with anything you write about a book."
                                    : "Your notes, highlights and thoughts about books gather here." }), _jsxs("div", { className: "hero-actions", children: [kindTab !== "book_notes" && (_jsx("button", { type: "button", className: "btn btn-primary", onClick: () => setWriting({ kind: "personal" }), children: "Write a note" })), kindTab !== "personal" && (_jsx("button", { type: "button", className: `btn ${kindTab === "book_notes" ? "btn-primary" : "btn-quiet"}`, onClick: () => setWriting({ kind: "book_note" }), children: "Write about a book" }))] })] })] }));
    else if (notes.length === 0)
        body = (_jsxs("div", { className: "library-empty", children: [_jsx("h2", { children: "Nothing matches" }), _jsxs("p", { className: "muted", children: [search.trim() ? `No notes here match “${search.trim()}”.` : "No notes of this kind yet.", filterCount > 0 && " Filters are also narrowing the list."] }), _jsxs("div", { className: "hero-actions", children: [search.trim() && (_jsx("button", { type: "button", className: "btn btn-quiet", onClick: onClearSearch, children: "Clear search" })), filterCount > 0 && (_jsx("button", { type: "button", className: "btn btn-quiet", onClick: clearFilters, children: "Clear filters" }))] })] }));
    else
        body = (_jsxs("div", { className: `notes-layout${selected ? " has-panel" : ""}`, children: [_jsxs("div", { className: "notes-list", children: [pinned.length > 0 && (_jsxs("section", { className: "notes-section notes-pinned", "aria-labelledby": "notes-pinned", children: [_jsxs("div", { className: "notes-section-head", children: [_jsxs("h2", { id: "notes-pinned", children: [_jsx(Icon, { name: "pin", size: 17 }), " Pinned"] }), pinned.length > PINNED_SHOWN && (_jsxs("button", { type: "button", className: "link-btn notes-show-all", "aria-expanded": allPinned, onClick: () => setAllPinned(!allPinned), children: [allPinned ? "Show fewer" : `Show all (${pinned.length})`, " ", _jsx(Icon, { name: allPinned ? "chevronUp" : "chevronDown", size: 13 })] }))] }), _jsx(Layout, { notes: shownPinned, ...views })] })), pinned.length > 0 && rest.length > 0 && _jsx("div", { className: "rule-diamond", "aria-hidden": true }), rest.length > 0 && (_jsxs("section", { className: "notes-section", "aria-labelledby": "notes-all", children: [_jsxs("div", { className: "notes-section-head", children: [_jsx("h2", { id: "notes-all", children: NOTES_HEADING[kindTab] }), _jsxs("div", { className: "notes-section-tools", children: [_jsx(Menu, { label: `Sort: ${SORTS.find((s) => s.sort === prefs.sort)?.label}`, className: "notes-filter notes-sort", trigger: _jsxs(_Fragment, { children: [_jsx("span", { className: "muted", children: "Sort:" }), " ", _jsx("span", { children: SORTS.find((s) => s.sort === prefs.sort)?.label }), _jsx(Icon, { name: "chevronDown", size: 13 })] }), items: SORTS.map((s) => ({ label: s.label, checked: prefs.sort === s.sort, onSelect: () => changePrefs({ sort: s.sort }) })) }), _jsxs("button", { type: "button", className: `notes-filter notes-select${chosen ? " is-on" : ""}`, "aria-pressed": !!chosen, onClick: () => {
                                                        setChosen((c) => (c ? null : new Set()));
                                                        setSelectedId(null);
                                                    }, children: [_jsx(Icon, { name: "checkCircle", size: 15 }), " ", chosen ? "Done" : "Select"] })] })] }), _jsx(Layout, { notes: rest, ...views })] }))] }), selected && !chosen && (_jsx(NotePanel, { note: selected, related: related.filter((r) => r.id !== selected.id), menu: menuFor(selected), tags: page?.tags ?? [], onSave: saveWords, onTags: saveTags, onClose: () => setSelectedId(null), onOpenInReader: openInReader, onSelect: (n) => {
                        // A related note hidden by the current filters brings them all down.
                        if (!notes.some((x) => x.id === n.id)) {
                            clearFilters();
                            onClearSearch();
                        }
                        setSelectedId(n.id);
                    }, onViewAllForBook: (id) => {
                        clearFilters();
                        setBookId(id);
                    } }, selected.id))] }));
    return (_jsxs("div", { className: "notes-page", children: [page && !error && (_jsxs("div", { className: "notes-toolbar", role: "toolbar", "aria-label": "Filter notes", children: [_jsxs("div", { className: "notes-filters", children: [types.length > 0 && (_jsx(FilterButton, { label: type ? TYPE_LABEL[type] : kindTab === "book_notes" ? "Everything" : "All types", on: !!type || colors.length > 0, items: typeItems })), kindTab !== "personal" && _jsx(FilterButton, { label: filterBook?.title ?? "All books", on: !!bookId, items: bookItems }), _jsx(FilterButton, { label: tag ?? "All tags", on: !!tag, items: tagItems }), _jsx(FilterButton, { label: WHEN.find((w) => w.when === when).label, on: when !== "any", items: WHEN.map((w) => ({ label: w.label, checked: when === w.when, onSelect: () => setWhen(w.when) })) }), filterCount > 0 && (_jsx("button", { type: "button", className: "link-btn notes-clear", onClick: clearFilters, children: "Clear" }))] }), _jsx("div", { className: "layout-switch", role: "radiogroup", "aria-label": "Layout", children: LAYOUTS.map((l) => (_jsx("button", { type: "button", role: "radio", "aria-checked": prefs.layout === l.layout, "aria-label": l.label, title: l.label, className: prefs.layout === l.layout ? "is-active" : undefined, onClick: () => changePrefs({ layout: l.layout }), children: _jsx(Icon, { name: l.icon, size: 16 }) }, l.layout))) })] })), chosen && (_jsxs("div", { className: "notes-chosen-bar", role: "toolbar", "aria-label": "Chosen notes", children: [_jsxs("span", { children: [chosen.size, " ", chosen.size === 1 ? "note" : "notes", " chosen"] }), _jsx("button", { type: "button", className: "link-btn", onClick: () => setChosen(new Set(notes.map((n) => n.id))), children: "Choose all" }), _jsxs("span", { className: "notes-chosen-actions", children: [_jsxs("button", { type: "button", className: "btn btn-quiet btn-small", disabled: !chosen.size, onClick: () => void pin(chosenNotes, !chosenNotes.every((n) => n.pinnedAt)), children: [_jsx(Icon, { name: "pin", size: 14 }), " ", chosenNotes.length > 0 && chosenNotes.every((n) => n.pinnedAt) ? "Unpin" : "Pin"] }), _jsxs("button", { type: "button", className: "btn btn-quiet btn-small", disabled: !chosen.size, onClick: () => copy(chosenNotes), children: [_jsx(Icon, { name: "copy", size: 14 }), " Copy"] }), _jsxs("button", { type: "button", className: "btn btn-quiet btn-small is-danger", disabled: !chosen.size, onClick: () => setDeleting(chosenNotes), children: [_jsx(Icon, { name: "trash", size: 14 }), " Delete"] }), _jsx("button", { type: "button", className: "btn btn-primary btn-small", onClick: () => setChosen(null), children: "Done" })] })] })), search.trim() && page && (_jsxs("p", { className: "search-note", children: ["Showing notes matching \u201C", search.trim(), "\u201D", _jsx("button", { type: "button", className: "view-all", onClick: onClearSearch, children: "Clear" })] })), _jsx("div", { className: "library-body", children: body }), writing?.kind === "personal" && (_jsx(PersonalNoteEditor, { initial: writing.note, refreshKey: refreshKey, onClose: () => setWriting(null), onSaved: () => { setWriting(null); changed(); } })), writing?.kind === "book_note" && (_jsx(NewNoteDialog, { onCancel: () => setWriting(null), onSaved: (n) => {
                    setWriting(null);
                    setSelectedId(n.id);
                    changed();
                } })), tagging && (_jsx(TagsDialog, { note: tagging, known: page?.tags ?? [], onCancel: () => setTagging(null), onSave: (tags) => {
                    const n = tagging;
                    setTagging(null);
                    void saveTags(n, tags);
                } })), toBook && onGoToBooks && (_jsx(NoteToBookDialog, { note: toBook, onClose: () => setToBook(null), onGoToBooks: () => {
                    setToBook(null);
                    onGoToBooks();
                } })), deleting && (_jsx(ConfirmDialog, { title: deleting.length === 1 ? `Delete this ${KIND_LABEL[deleting[0].kind].toLowerCase()}?` : `Delete ${deleting.length} notes?`, body: deleting.some((n) => n.kind === "highlight" || n.kind === "annotation")
                    ? "Highlights and anything written on them go from every device. The books themselves aren't changed."
                    : deleting.length === 1
                        ? "The note goes from every device."
                        : "The notes go from every device.", confirm: "Delete", danger: true, onCancel: () => setDeleting(null), onConfirm: () => {
                    const gone = deleting;
                    void (async () => {
                        try {
                            for (const n of gone)
                                await api.deleteNote(n.id, n.kind);
                        }
                        catch (e) {
                            toast(String(e));
                        }
                        setDeleting(null);
                        if (gone.some((n) => n.id === selectedId))
                            setSelectedId(null);
                        setChosen((c) => (c ? new Set([...c].filter((id) => !gone.some((n) => n.id === id))) : c));
                        changed();
                    })();
                } }))] }));
}

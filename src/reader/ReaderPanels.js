import { jsxs as _jsxs, jsx as _jsx, Fragment as _Fragment } from "react/jsx-runtime";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAppSettings } from "../settings/appSettings";
import { api } from "../api";
import { BookCover } from "../components/BookCover";
import { Icon } from "../components/Icon";
import { Menu } from "../components/Menu";
import { ProgressBar } from "../components/ProgressBar";
import { StarRating } from "../components/StarRating";
import { authorLine, percent, relativeTime } from "../lib/format";
import { annotationPage, counts, filterAnnotations, isBookmark, isHighlight, isNote, } from "./annotations";
import { formatNumber, formatPage } from "./pages";
import { HIGHLIGHT_COLORS, highlightHex } from "./settings";
function annotationMenu(a, h) {
    const entries = [{ label: "Go to", icon: "arrowRight", onSelect: () => h.onGo(a) }];
    if (!isBookmark(a)) {
        entries.push({ label: a.note ? "Edit note" : "Add a note", icon: "edit", onSelect: () => h.onEditNote(a) }, "divider", ...HIGHLIGHT_COLORS.map((c) => ({
            label: c.label,
            checked: (a.color ?? "rose") === c.value,
            onSelect: () => h.onRecolor(a, c.value),
        })), "divider", { label: "Copy text", icon: "copy", onSelect: () => h.onCopy(a) });
    }
    entries.push({ label: "Delete", icon: "trash", danger: true, onSelect: () => h.onDelete(a) });
    return entries;
}
function Where({ a, totalPages }) {
    const page = annotationPage(a, totalPages);
    return (_jsxs("p", { className: "ann-where", children: [page !== null && _jsxs("span", { children: ["Page ", formatNumber(page)] }), a.locator.chapter && _jsx("span", { children: a.locator.chapter }), a.locator.format && _jsxs("span", { children: ["Marked in the ", a.locator.format.toUpperCase()] })] }));
}
/** One highlight, note or bookmark in a list. */
export function AnnotationItem({ a, totalPages, handlers, compact = false, }) {
    const bookmark = isBookmark(a);
    return (_jsxs("li", { className: `ann${compact ? " ann-compact" : ""}`, style: { ["--ann-color"]: bookmark ? "var(--text-muted)" : highlightHex(a.color) }, children: [_jsxs("div", { className: "ann-row", children: [_jsx("button", { type: "button", className: "ann-open", onClick: () => handlers.onGo(a), children: bookmark ? (_jsxs("span", { className: "ann-bookmark", children: [_jsx(Icon, { name: "bookmark", size: 14, filled: true }), " ", a.excerpt || "Bookmark"] })) : (_jsx("q", { className: "ann-quote", children: a.excerpt })) }), !compact && (_jsx(Menu, { label: "Highlight options", trigger: _jsx(Icon, { name: "more", size: 16 }), items: annotationMenu(a, handlers), className: "icon-btn icon-btn-s" }))] }), _jsx(Where, { a: a, totalPages: totalPages }), a.note && (_jsxs("div", { className: "ann-note", children: [_jsxs("p", { className: "ann-note-head", children: [_jsx(Icon, { name: "note", size: 14 }), " My note ", _jsx("span", { children: relativeTime(a.updatedAt) })] }), _jsx("p", { className: "ann-note-body", children: a.note }), !compact && (_jsx("button", { type: "button", className: "btn btn-quiet btn-s", onClick: () => handlers.onEditNote(a), children: "Edit note" }))] }))] }));
}
function EmptyList({ children }) {
    return _jsx("p", { className: "panel-empty", children: children });
}
/** Book, progress and contents, on the left. */
export function LeftPanel({ book, fraction, position, previouslyOpenedAt, entries, currentId, tab, onTab, revealRequest, annotations, onGoHref, handlers, }) {
    const current = entries.find((e) => e.id === currentId);
    const disclosureKey = `tbv.contents.expanded.${book.id}`;
    const [remembered, setRemembered] = useState(() => {
        try {
            const saved = JSON.parse(localStorage.getItem(disclosureKey) ?? "[]");
            return new Set(Array.isArray(saved) ? saved.filter((id) => typeof id === "string") : []);
        }
        catch {
            return new Set();
        }
    });
    const [open, setOpen] = useState(() => new Set([...remembered, ...(current?.parents ?? [])]));
    const body = useRef(null);
    const activeRow = useRef(null);
    const pendingReveal = useRef(false);
    const parentsKey = JSON.stringify(current?.parents ?? []);
    const reveal = useCallback(() => {
        const container = body.current;
        const row = activeRow.current;
        if (!container || !row)
            return false;
        // Move only this list. scrollIntoView can also move the book/window.
        const bounds = container.getBoundingClientRect();
        const item = row.getBoundingClientRect();
        const top = bounds.top + container.clientTop;
        const bottom = top + container.clientHeight;
        if (item.top < top)
            container.scrollTop += item.top - top;
        else if (item.bottom > bottom)
            container.scrollTop += item.bottom - bottom;
        return true;
    }, []);
    // Opening Contents or entering another chapter follows the reader. Ordinary
    // progress updates and manually browsing the list don't pull it back.
    useLayoutEffect(() => {
        if (tab !== "contents")
            return;
        pendingReveal.current = true;
        const parents = current?.parents ?? [];
        setOpen((o) => parents.every((p) => o.has(p)) ? o : new Set([...o, ...parents]));
    }, [currentId, parentsKey, tab, revealRequest]);
    useLayoutEffect(() => {
        if (tab === "contents" && pendingReveal.current && reveal())
            pendingReveal.current = false;
    }, [currentId, parentsKey, tab, revealRequest, open, reveal]);
    useEffect(() => {
        if (!body.current || typeof ResizeObserver === "undefined")
            return;
        const observer = new ResizeObserver(() => reveal());
        observer.observe(body.current);
        return () => observer.disconnect();
    }, [reveal]);
    const visible = entries.filter((e) => e.parents.every((p) => open.has(p)));
    const toggle = (id) => {
        const next = new Set(open);
        const saved = new Set(remembered);
        if (next.delete(id))
            saved.delete(id);
        else {
            next.add(id);
            saved.add(id);
        }
        setOpen(next);
        setRemembered(saved);
        try {
            localStorage.setItem(disclosureKey, JSON.stringify([...saved]));
        }
        catch { /* Keep the current view. */ }
    };
    const highlights = annotations.filter(isHighlight);
    const notes = annotations.filter(isNote);
    const total = position?.total ?? 0;
    return (_jsxs("aside", { className: "reader-left", "aria-label": "Book and contents", children: [_jsxs("div", { className: "reader-book", children: [_jsx(ExpandableCover, { book: book }), _jsxs("div", { className: "reader-book-text", children: [_jsx("h2", { children: book.title }), _jsx("p", { className: "reader-book-author", children: authorLine(book.authors) }), _jsx(ProgressBar, { value: fraction ?? 0 }), _jsxs("p", { className: "reader-book-meta", children: [percent(fraction), " complete"] }), _jsxs("p", { className: "reader-book-meta", children: [_jsx(Icon, { name: "clock", size: 15 }), previouslyOpenedAt ? `Last opened ${relativeTime(previouslyOpenedAt)}` : "First time reading"] }), position && (_jsxs("p", { className: "reader-book-meta", children: [_jsx(Icon, { name: "bookmark", size: 15 }), formatPage(position)] }))] })] }), _jsx("div", { className: "tabs reader-tabs", role: "tablist", children: [
                    ["contents", "Contents"],
                    ["highlights", "Highlights"],
                    ["notes", "Notes"],
                ].map(([value, label]) => (_jsx("button", { type: "button", role: "tab", "aria-selected": tab === value, className: `tab${tab === value ? " is-active" : ""}`, onClick: () => onTab(value), children: label }, value))) }), _jsxs("div", { className: "reader-left-body", ref: body, children: [tab === "contents" &&
                        (visible.length ? (_jsx("ul", { className: "toc", children: visible.map((e) => (_jsxs("li", { ref: e.id === currentId ? activeRow : undefined, className: e.id === currentId ? "toc-current" : undefined, style: { ["--depth"]: e.depth }, children: [e.hasChildren ? (_jsx("button", { type: "button", className: "toc-toggle", "aria-label": open.has(e.id) ? `Fold ${e.label}` : `Unfold ${e.label}`, "aria-expanded": open.has(e.id), onClick: () => toggle(e.id), children: _jsx(Icon, { name: open.has(e.id) ? "chevronDown" : "chevronRight", size: 16 }) })) : (_jsx("span", { className: "toc-toggle" })), _jsxs("button", { type: "button", className: "toc-link", "aria-current": e.id === currentId ? "location" : undefined, onClick: () => onGoHref(e.href), children: [_jsx("span", { className: "toc-label", children: e.label }), e.page !== null && _jsx("span", { className: "toc-page", children: formatNumber(e.page) })] })] }, e.id))) })) : (_jsx(EmptyList, { children: "This book has no table of contents." }))), tab === "highlights" &&
                        (highlights.length ? (_jsx("ul", { className: "ann-list", children: highlights.map((a) => (_jsx(AnnotationItem, { a: a, totalPages: total, handlers: handlers, compact: true }, a.id))) })) : (_jsx(EmptyList, { children: "Select words in the book to highlight them." }))), tab === "notes" &&
                        (notes.length ? (_jsx("ul", { className: "ann-list", children: notes.map((a) => (_jsx(AnnotationItem, { a: a, totalPages: total, handlers: handlers, compact: true }, a.id))) })) : (_jsx(EmptyList, { children: "Select words in the book, then choose Add a note." })))] })] }));
}
const FILTERS = [
    { value: "all", label: "All" },
    { value: "highlights", label: "Highlights" },
    { value: "notes", label: "Notes" },
    { value: "bookmarks", label: "Bookmarks" },
];
/** Highlights & Notes, and Book info, on the right. */
export function RightPanel({ tab, onTab, onClose, annotations, totalPages, handlers, info, }) {
    const [filter, setFilter] = useState("all");
    const [sort, setSort] = useState("position");
    const [searching, setSearching] = useState(false);
    const [query, setQuery] = useState("");
    const n = counts(annotations);
    const list = useMemo(() => filterAnnotations(annotations, filter, sort, query), [annotations, filter, sort, query]);
    return (_jsxs("aside", { className: "reader-right", "aria-label": "Highlights, notes and book info", children: [_jsxs("div", { className: "reader-right-head", children: [_jsxs("div", { className: "tabs", role: "tablist", children: [_jsx("button", { type: "button", role: "tab", className: `tab${tab === "notes" ? " is-active" : ""}`, "aria-selected": tab === "notes", onClick: () => onTab("notes"), children: "Highlights & Notes" }), _jsx("button", { type: "button", role: "tab", className: `tab${tab === "info" ? " is-active" : ""}`, "aria-selected": tab === "info", onClick: () => onTab("info"), children: "Book Info" })] }), _jsx("button", { type: "button", className: "icon-btn icon-btn-s", "aria-label": "Close panel", title: "Close panel", onClick: onClose, children: _jsx(Icon, { name: "close", size: 16 }) })] }), tab === "notes" ? (_jsxs(_Fragment, { children: [_jsx("div", { className: "segmented", role: "radiogroup", "aria-label": "Show", children: FILTERS.map((f) => (_jsxs("button", { type: "button", role: "radio", "aria-checked": filter === f.value, onClick: () => setFilter(f.value), children: [f.label, " (", n[f.value], ")"] }, f.value))) }), _jsxs("div", { className: "reader-right-tools", children: [_jsx(Menu, { label: "Sort", align: "start", className: "link-btn", trigger: _jsxs(_Fragment, { children: ["Sort: ", sort === "position" ? "Position in book" : "Recently added", " ", _jsx(Icon, { name: "chevronDown", size: 14 })] }), items: [
                                    { label: "Position in book", checked: sort === "position", onSelect: () => setSort("position") },
                                    { label: "Recently added", checked: sort === "recent", onSelect: () => setSort("recent") },
                                ] }), _jsx("button", { type: "button", className: "icon-btn icon-btn-s", "aria-label": "Search highlights and notes", "aria-pressed": searching, onClick: () => {
                                    setSearching((s) => !s);
                                    setQuery("");
                                }, children: _jsx(Icon, { name: "search", size: 16 }) })] }), searching && (_jsx("input", { className: "input reader-right-search", type: "search", placeholder: "Search highlights and notes\u2026", value: query, onChange: (e) => setQuery(e.target.value), autoFocus: true })), list.length ? (_jsx("ul", { className: "ann-list reader-right-list", children: list.map((a) => (_jsx(AnnotationItem, { a: a, totalPages: totalPages, handlers: handlers }, a.id))) })) : (_jsx(EmptyList, { children: annotations.length === 0
                            ? "Nothing here yet. Select words in the book to highlight them or add a note. The bookmark button at the top marks the page you're on."
                            : "Nothing matches." }))] })) : (_jsx(BookInfo, { info: info, totalPages: totalPages }))] }));
}
function BookInfo({ info, totalPages }) {
    const b = info.book;
    const [rating, setRating] = useState(b.rating);
    useEffect(() => setRating(b.rating), [b.id, b.rating]);
    const rate = (next) => {
        const before = rating;
        setRating(next);
        api.setRating(b.id, next).catch(() => setRating(before));
    };
    const rows = [
        ["Title", b.title],
        ["Author", b.authors.length ? b.authors.join(", ") : null],
        ["Series", b.series ? `${b.series}${b.seriesIndex != null ? `, book ${b.seriesIndex}` : ""}` : null],
        ["Publisher", info.publisher],
        ["Language", info.language],
        ["Format", b.format.toUpperCase()],
        ["Pages", totalPages > 0 ? formatNumber(totalPages) : null],
        ["File size", info.fileSize > 0 ? `${(info.fileSize / 1_048_576).toFixed(1)} MB` : null],
        ["Added", new Date(b.addedAt).toLocaleDateString()],
        ["Finished", b.finishedAt ? new Date(b.finishedAt).toLocaleDateString() : null],
    ];
    return (_jsxs("div", { className: "book-info", children: [_jsxs("div", { className: "book-info-rating", children: [_jsx("span", { children: "Your rating" }), _jsx(StarRating, { value: rating, onChange: rate })] }), _jsx("dl", { children: rows
                    .filter(([, v]) => v)
                    .map(([k, v]) => (_jsxs("div", { children: [_jsx("dt", { children: k }), _jsx("dd", { children: v })] }, k))) }), b.synopsis && (_jsxs(_Fragment, { children: [_jsx("h3", { children: "Description" }), _jsx("p", { className: "book-info-synopsis", children: b.synopsis })] })), _jsx("p", { className: "book-info-note", children: "Pages are counted the same way on every device and at every text size, so a page number always means the same place." })] }));
}
/** The book's cover; clicking it shows it large, as on the book's page (not while covers are hidden for privacy). */
function ExpandableCover({ book }) {
    const { privacy } = useAppSettings().settings;
    const [expanded, setExpanded] = useState(null);
    useEffect(() => setExpanded(null), [book.id, privacy.on]);
    return (_jsxs(_Fragment, { children: [_jsx(BookCover, { book: book, size: "s", onExpand: privacy.on ? undefined : setExpanded }), expanded && !privacy.on && (_jsx("div", { className: "dialog-backdrop book-cover-preview", role: "dialog", "aria-modal": "true", "aria-label": "Cover for " + book.title, onPointerDown: (event) => { if (event.target === event.currentTarget)
                    setExpanded(null); }, onKeyDown: (event) => { if (event.key === "Escape")
                    setExpanded(null); }, children: _jsx("button", { type: "button", autoFocus: true, "aria-label": "Close cover preview", onClick: () => setExpanded(null), children: _jsx("img", { src: expanded, alt: book.title }) }) }))] }));
}

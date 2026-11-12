import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { BookCover } from "../components/BookCover";
import { Icon } from "../components/Icon";
import { Menu } from "../components/Menu";
import { ProgressBar } from "../components/ProgressBar";
import { useToast } from "../components/Toast";
import { bookContextMenu, clickBook, makeBookActions } from "../home/bookActions";
import { BookGrid, BookList } from "../library/BookViews";
import { downloadable, useBatchDownloads } from "../library/BatchDownloads";
import { PageSwitch } from "../library/Library";
import { authorLine, percent } from "../lib/format";
import { Badge } from "./badges";
import { CollectionSeries } from "./CollectionSeries";
import { CollectionPicture } from "./CollectionCards";
import { bookCount, KIND_LABEL, SMART_INFO } from "./collectionInfo";
import { describeRules } from "./rules";
const lowerFirst = (text) => text.charAt(0).toLowerCase() + text.slice(1);
/** One collection, full page: its picture, its books, and adding or ordering them. */
export function CollectionView({ collection, series, refreshKey, menuFor, onBack, onOpenBook, onChanged, }) {
    const [detail, setDetail] = useState(null);
    const [error, setError] = useState(null);
    const [reload, setReload] = useState(0);
    const [layout, setLayout] = useState("grid");
    const [adding, setAdding] = useState(false);
    /** The Read compendium separates finished and dropped books. */
    const [ended, setEnded] = useState("read");
    const toast = useToast();
    const key = JSON.stringify(collection);
    useEffect(() => {
        let current = true;
        api.getCollection(collection).then((d) => current && setDetail(d), (e) => current && setError(String(e)));
        return () => {
            current = false;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key, refreshKey, reload]);
    const c = detail?.collection ?? null;
    // Books are added to `own` by hand; a collection with rules fills itself.
    const own = c && c.kind !== "shelf" && !c.rules ? c : null;
    const changed = () => {
        setReload((n) => n + 1);
        onChanged();
    };
    const downloads = useBatchDownloads(changed);
    const actions = useMemo(() => ({
        ...makeBookActions(api, toast, changed, onOpenBook),
        ...(own && {
            removeFromCollection: {
                name: own.name,
                remove: (book) => api.removeFromCollection(own.id, book.id).then(() => {
                    toast(`Removed “${book.title}” from ${own.name}. The book stays in your library.`);
                    changed();
                }, (e) => toast(String(e))),
            },
        }),
    }), 
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [toast, onOpenBook, own?.id, own?.name]);
    if (error)
        return (_jsxs("div", { className: "collection-view", children: [_jsx(BackLink, { onBack: onBack }), _jsxs("div", { className: "library-empty", role: "alert", children: [_jsx("h2", { children: "This collection couldn't be opened" }), _jsx("p", { className: "muted", children: error })] })] }));
    if (!detail)
        return _jsx("div", { className: "collection-view library-loading", "aria-busy": "true" });
    const name = collection.kind === "smart" ? SMART_INFO[collection.smart].name : collection.kind === "series" ? collection.name : (c?.name ?? "");
    const badge = collection.kind === "smart" ? SMART_INFO[collection.smart].badge : collection.kind === "series" ? "scroll" : c?.badge;
    const description = collection.kind === "smart"
        ? SMART_INFO[collection.smart].description
        : collection.kind === "series"
            ? `By ${authorLine(series.find((s) => s.name === collection.name)?.authors ?? []) || "unknown authors"}, in reading order.`
            : c?.description;
    const kindLabel = collection.kind === "smart"
        ? "Smart collection"
        : collection.kind === "series"
            ? "Series"
            : c?.rules
                ? "Filled by rules"
                : c && KIND_LABEL[c.kind];
    const readSwitch = collection.kind === "smart" && collection.smart === "read";
    const books = readSwitch ? detail.books.filter((b) => b.status === ended) : detail.books;
    const covers = detail.books.slice(0, 3).map(({ id, title, authors, coverPath }) => ({ id, title, authors, coverPath }));
    const menu = [
        { label: "Download", icon: "download", disabled: !!downloads.progress || !detail.books.some(downloadable), onSelect: () => void downloads.download(async () => detail.books) },
        ...menuFor(detail),
    ];
    const move = (book, to) => own && api.moveInCollection(own.id, book.id, to).then(() => setReload((n) => n + 1), (e) => toast(String(e)));
    return (_jsxs("div", { className: "collection-view", children: [_jsxs("header", { className: "collection-hero", children: [_jsx(CollectionPicture, { collection: { id: c?.id ?? name, picture: c?.picture ?? null, picturePath: c?.picturePath ?? null, covers }, className: "hero-picture" }), _jsxs("div", { className: "collection-hero-text", children: [_jsx(BackLink, { onBack: onBack }), _jsxs("h1", { children: [_jsx(Badge, { name: badge, size: 28 }), name] }), _jsxs("p", { className: "collection-hero-meta", children: [bookCount(detail.books.length), kindLabel && _jsxs(_Fragment, { children: [" \u00B7 ", kindLabel] })] }), description && _jsx("p", { className: "collection-hero-description", children: description })] }), _jsxs("div", { className: "collection-hero-actions", "data-item-menu": true, children: [own && (_jsxs("button", { type: "button", className: "btn btn-primary", onClick: () => setAdding(true), children: [_jsx("span", { "aria-hidden": true, children: "+" }), " Add books"] })), menu.length > 0 && _jsx(Menu, { label: `More for ${name}`, trigger: _jsx(Icon, { name: "more" }), items: menu, className: "icon-btn hero-more" })] })] }), downloads.feedback, _jsxs("div", { className: "collection-view-tools", children: [_jsx("p", { className: "muted", children: own?.kind === "reading_list"
                            ? "A reading list, top to bottom. Use the arrows to change the order."
                            : collection.kind === "series"
                                ? "In series order."
                                : c?.kind === "shelf"
                                    ? "Books join this shelf from their own … menu."
                                    : c?.rules
                                        ? `Books where ${lowerFirst(describeRules(c.rules))}. It keeps up as your books change.`
                                        : null }), readSwitch && (_jsx(PageSwitch, { label: "Which books", value: ended, options: [
                            { value: "read", label: "Read" },
                            { value: "dropped", label: "Dropped" },
                        ], onChange: setEnded })), own?.kind !== "reading_list" && detail.books.length > 0 && (_jsx("div", { className: "layout-switch", role: "radiogroup", "aria-label": "Layout", children: [
                            ["grid", "Covers", "grid"],
                            ["list", "List", "list"],
                        ].map(([value, label, icon]) => (_jsx("button", { type: "button", role: "radio", "aria-checked": layout === value, "aria-label": label, title: label, className: layout === value ? "is-active" : undefined, onClick: () => setLayout(value), children: _jsx(Icon, { name: icon, size: 16 }) }, value))) }))] }), _jsx(CollectionSeries, { collection: collection, books: detail.books, refreshKey: refreshKey + reload, onChanged: changed }), books.length === 0 && detail.books.length > 0 ? (_jsx("div", { className: "library-empty", children: _jsx("h2", { children: ended === "dropped" ? "No dropped books" : "No finished books yet" }) })) : detail.books.length === 0 ? (_jsxs("div", { className: "library-empty", children: [_jsx("h2", { children: "No books here yet" }), _jsx("p", { className: "muted", children: own
                            ? "Add books with the button above, or from any book's … menu."
                            : c?.rules
                                ? "No books match its rules yet. They appear here by themselves when one does."
                                : "Books appear here by themselves as you read." })] })) : own?.kind === "reading_list" ? (_jsx("ol", { className: "reading-list", children: detail.books.map((b, i) => (_jsxs("li", { className: "reading-row", ...bookContextMenu(b, actions), children: [_jsx("span", { className: "reading-number", children: i + 1 }), _jsxs("button", { type: "button", className: "reading-open", onClick: () => clickBook(b, actions), children: [_jsx(BookCover, { book: b, size: "s" }), _jsxs("span", { className: "reading-text", children: [_jsx("span", { className: "reading-title", children: b.title }), _jsx("span", { className: "reading-author", children: authorLine(b.authors) })] })] }), _jsx("span", { className: "reading-status", children: b.status === "read" || b.status === "dropped" ? (_jsx("span", { className: "muted", children: b.status === "read" ? "Read" : "Dropped" })) : b.status === "in_progress" ? (_jsxs("span", { className: "progress-line", children: [_jsx(ProgressBar, { value: b.totalProgression }), _jsx("span", { className: "num", children: percent(b.totalProgression) })] })) : (_jsx("span", { className: "muted", children: "Not started" })) }), _jsxs("span", { className: "reading-move", children: [_jsx("button", { type: "button", className: "icon-btn icon-btn-s", "aria-label": `Move ${b.title} up`, disabled: i === 0, onClick: () => move(b, i - 1), children: _jsx(Icon, { name: "chevronUp", size: 16 }) }), _jsx("button", { type: "button", className: "icon-btn icon-btn-s", "aria-label": `Move ${b.title} down`, disabled: i === detail.books.length - 1, onClick: () => move(b, i + 1), children: _jsx(Icon, { name: "chevronDown", size: 16 }) })] }), _jsx("button", { type: "button", className: "icon-btn icon-btn-s", "aria-label": `Remove ${b.title} from ${own.name}`, title: "Remove from this list", onClick: () => actions.removeFromCollection?.remove(b), children: _jsx(Icon, { name: "close", size: 16 }) })] }, b.id))) })) : layout === "grid" ? (_jsx(BookGrid, { books: books, actions: actions })) : (_jsx(BookList, { books: books, actions: actions })), adding && own && (_jsx(AddBooksDialog, { collectionName: own.name, already: new Set(detail.books.map((b) => b.id)), onCancel: () => setAdding(false), onAdd: (ids) => api.addToCollection(own.id, ids).then(() => {
                    setAdding(false);
                    toast(`Added ${bookCount(ids.length)} to ${own.name}.`);
                    changed();
                }, (e) => toast(String(e))) }))] }));
}
function BackLink({ onBack }) {
    return (_jsxs("button", { type: "button", className: "back-link", onClick: onBack, children: [_jsx(Icon, { name: "chevronLeft", size: 14 }), " Collections"] }));
}
/** Picking books from the library to add to a collection. */
function AddBooksDialog({ collectionName, already, onAdd, onCancel, }) {
    const [search, setSearch] = useState("");
    const [books, setBooks] = useState(null);
    const [picked, setPicked] = useState(new Set());
    useEffect(() => {
        let current = true;
        const t = setTimeout(() => {
            api
                .getLibrary({ shelf: "all", sort: "title", search: search.trim() || null, formats: [], location: null, page: 0, pageSize: 200 })
                .then((page) => current && setBooks(page.books), () => current && setBooks([]));
        }, 150);
        return () => {
            current = false;
            clearTimeout(t);
        };
    }, [search]);
    const toggle = (id) => setPicked((p) => {
        const next = new Set(p);
        if (next.has(id))
            next.delete(id);
        else
            next.add(id);
        return next;
    });
    return (_jsx("div", { className: "dialog-backdrop", onPointerDown: (e) => e.target === e.currentTarget && onCancel(), children: _jsxs("div", { className: "dialog add-books-dialog", role: "dialog", "aria-label": `Add books to ${collectionName}`, onKeyDown: (e) => e.key === "Escape" && onCancel(), children: [_jsxs("h2", { children: ["Add books to ", collectionName] }), _jsxs("label", { className: "search add-books-search", children: [_jsx(Icon, { name: "search", size: 16 }), _jsx("input", { autoFocus: true, type: "search", placeholder: "Search your library\u2026", value: search, onChange: (e) => setSearch(e.target.value), "aria-label": "Search your library" })] }), _jsx("ul", { className: "add-books-list", children: books === null ? (_jsx("li", { className: "library-loading", "aria-busy": "true" })) : books.length === 0 ? (_jsx("li", { className: "muted", children: "No books match." })) : (books.map((b) => {
                        const inIt = already.has(b.id);
                        return (_jsx("li", { children: _jsxs("label", { className: `add-book${inIt ? " is-in" : ""}`, children: [_jsx("input", { type: "checkbox", checked: inIt || picked.has(b.id), disabled: inIt, onChange: () => toggle(b.id) }), _jsx(BookCover, { book: b, size: "s" }), _jsxs("span", { className: "add-book-text", children: [_jsx("span", { className: "add-book-title", children: b.title }), _jsx("span", { className: "muted", children: inIt ? "Already in this collection" : authorLine(b.authors) })] })] }) }, b.id));
                    })) }), _jsxs("div", { className: "dialog-actions", children: [_jsx("button", { type: "button", className: "btn btn-quiet", onClick: onCancel, children: "Cancel" }), _jsx("button", { type: "button", className: "btn btn-primary", disabled: picked.size === 0, onClick: () => onAdd([...picked]), children: picked.size ? `Add ${bookCount(picked.size)}` : "Add books" })] })] }) }));
}

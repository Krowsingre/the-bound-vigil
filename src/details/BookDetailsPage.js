import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// The Book details page: everything about one book, with its details in their
// layers (your edits, fetched online, the book's own) and ways to change them.
import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { askAddToCollection } from "../collections/AddToCollection";
import { useAppSettings } from "../settings/appSettings";
import { BookCover } from "../components/BookCover";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Icon } from "../components/Icon";
import { Menu } from "../components/Menu";
import { ProgressBar } from "../components/ProgressBar";
import { StarRating } from "../components/StarRating";
import { useToast } from "../components/Toast";
import { bookMenu, makeBookActions } from "../home/bookActions";
import { askEditTags } from "../library/BookDialogs";
import { effective, listOf } from "../lib/details";
import { formatLength, formatLabel, isAudio, isDocument } from "../lib/queryBooks";
import { formatBytes } from "../settings/controls";
import { askEditDetails, askFetchDetails } from "./openDetails";
import { FormatsRow } from "./FormatsRow";
import { LocationsRow } from "./LocationsRow";
import { PairRow } from "./PairRow";
import { SeriesRow } from "./SeriesRow";
const SOURCE = { google: "Google Books", openlibrary: "Open Library", audible: "Audible", hardcover: "Hardcover", file: "the book file" };
/** Where a detail's value comes from, when it isn't the book's own. */
function origin(f) {
    if (!f)
        return null;
    if (f.edited !== null)
        return "Your edit";
    if (f.fetched !== null && f.fetchedFrom)
        return `From ${SOURCE[f.fetchedFrom]}`;
    return null;
}
export function BookDetailsPage({ bookId, refreshKey, onBack, onOpenBook, onOpenCollection, onOpenLibrary, }) {
    const [load, setLoad] = useState({ state: "loading" });
    const [reload, setReload] = useState(0);
    const [expandedCover, setExpandedCover] = useState(null);
    const { privacy } = useAppSettings().settings;
    useEffect(() => { setExpandedCover(null); }, [bookId, privacy.on]);
    const [resetting, setResetting] = useState(false);
    const toast = useToast();
    const refresh = () => setReload((n) => n + 1);
    const actions = useMemo(() => makeBookActions(api, toast, () => setReload((n) => n + 1), onOpenBook), [toast, onOpenBook]);
    const [files, setFiles] = useState([]);
    useEffect(() => {
        let current = true;
        api.bookDetails(bookId).then((data) => current && setLoad({ state: "ready", data }), (e) => current && setLoad({ state: "error", message: String(e) }));
        return () => {
            current = false;
        };
    }, [bookId, refreshKey, reload]);
    useEffect(() => {
        let current = true;
        api.bookFiles(bookId).then((list) => current && setFiles(list), () => current && setFiles([]));
        return () => {
            current = false;
        };
    }, [bookId, refreshKey, reload]);
    useEffect(() => {
        document.querySelector(".content")?.scrollTo({ top: 0 });
    }, [bookId]);
    const back = (_jsxs("button", { type: "button", className: "details-back view-all", onClick: onBack, children: [_jsx(Icon, { name: "arrowLeft", size: 16 }), " Back"] }));
    if (load.state === "loading")
        return _jsx("div", { className: "library-loading", "aria-busy": "true", "aria-label": "Loading the book" });
    if (load.state === "error")
        return (_jsxs("div", { className: "book-details", children: [back, _jsxs("div", { className: "library-empty", role: "alert", children: [_jsx("h2", { children: "This book couldn't be shown" }), _jsx("p", { className: "muted", children: load.message })] })] }));
    const { book, fields, fileSize, collections, annotations } = load.data;
    const field = (name) => fields.find((f) => f.field === name);
    const value = (name) => {
        const f = field(name);
        return f ? effective(f) : null;
    };
    const genres = listOf(value("genres"));
    const synopsis = value("synopsis");
    const changed = fields.some((f) => f.edited !== null || (f.fetched !== null && f.fetchedFrom !== "file"));
    const started = book.status === "in_progress" && book.totalProgression;
    const facts = [
        ["Publisher", value("publisher"), "publisher"],
        ["Published", value("published"), "published"],
        ["Language", value("language"), "language"],
        ["ISBN", value("isbn"), "isbn"],
        ...(isAudio(book.format)
            ? [
                ["Narrators", listOf(value("narrators")).join(", ") || null, "narrators"],
                ["Length", formatLength(book.durationMs), null],
            ]
            : []),
        // Several files are listed under Formats instead.
        ["Format", files.length > 1 ? null : formatLabel(book.format), null],
        ["File size", fileSize && files.length <= 1 ? formatBytes(fileSize) : null, null],
        ["Added", new Date(book.addedAt).toLocaleDateString(), null],
        ["Finished", book.finishedAt ? new Date(book.finishedAt).toLocaleDateString() : null, null],
    ];
    // Said this way when no device or place has noted the book yet.
    const where = book.fileUnavailable
        ? "Its file isn't in the cloud yet"
        : book.availability === "cloud"
            ? "In the cloud only"
            : book.availability === "missing"
                ? "File missing"
                : book.inCloud
                    ? "On this device and in the cloud"
                    : "On this device";
    return (_jsxs("div", { className: "book-details", children: [back, _jsxs("div", { className: "details-layout", children: [_jsxs("aside", { className: "details-side", "data-item-menu": true, children: [_jsx(BookCover, { book: book, size: "l", onExpand: privacy.on ? undefined : setExpandedCover }), expandedCover && !privacy.on && (_jsx("div", { className: "dialog-backdrop book-cover-preview", role: "dialog", "aria-modal": "true", "aria-label": "Cover for " + book.title, onPointerDown: (event) => { if (event.target === event.currentTarget)
                                    setExpandedCover(null); }, onKeyDown: (event) => { if (event.key === "Escape")
                                    setExpandedCover(null); }, children: _jsx("button", { type: "button", autoFocus: true, "aria-label": "Close cover preview", onClick: () => setExpandedCover(null), children: _jsx("img", { src: expandedCover, alt: book.title }) }) })), _jsxs("button", { type: "button", className: "btn btn-primary btn-wide", onClick: () => actions.open(book), children: [_jsx(Icon, { name: "play", size: 16 }), " ", isAudio(book.format)
                                        ? started
                                            ? "Continue listening"
                                            : book.status === "read"
                                                ? "Listen again"
                                                : "Listen"
                                        : started
                                            ? "Continue reading"
                                            : book.status === "read"
                                                ? "Read again"
                                                : "Read"] }), started ? (_jsx(ProgressBar, { value: book.totalProgression, label: `${Math.round((book.totalProgression ?? 0) * 100)}% read` })) : null, _jsxs("div", { className: "details-side-actions", children: [_jsxs("button", { type: "button", className: "btn btn-quiet", onClick: () => askEditDetails([book]), children: [_jsx(Icon, { name: "edit", size: 16 }), " Edit details"] }), _jsxs("button", { type: "button", className: "btn btn-quiet", onClick: () => askFetchDetails(book), children: [_jsx(Icon, { name: "search", size: 16 }), " Find details online"] }), changed && (_jsxs("button", { type: "button", className: "btn btn-quiet", onClick: () => setResetting(true), children: [_jsx(Icon, { name: "restore", size: 16 }), " Show the book's own details"] }))] })] }), _jsxs("div", { className: "details-main", children: [_jsxs("header", { className: "details-head", children: [_jsxs("div", { children: [_jsx("h1", { className: "details-title", title: origin(field("title")) ?? undefined, children: book.title }), _jsx("p", { className: "details-authors", children: book.authors.join(", ") || "Unknown author" }), book.series && (_jsxs("p", { className: "muted", children: [book.series, book.seriesIndex !== null && `, book ${book.seriesIndex}`] }))] }), _jsx(Menu, { label: `More for ${book.title}`, className: "icon-btn", trigger: _jsx(Icon, { name: "more", size: 18 }), items: bookMenu(book, actions).filter((e) => typeof e === "string" || !("label" in e) || e.label !== "Book details") })] }), _jsxs("div", { className: "details-rating", children: [_jsx(StarRating, { value: book.rating, size: 22, onChange: (r) => actions.setRating(book, r) }), _jsxs("span", { className: "muted", children: [book.status === "read" ? "Read" : book.status === "dropped" ? "Dropped" : book.status === "in_progress" ? "Reading" : "Not started", book.favorite && " · Favourite", book.wantToRead && " · Up next"] })] }), genres.length > 0 && (_jsxs("div", { className: "details-chips", "aria-label": "Genres", children: [genres.map((g) => (_jsx("button", { type: "button", className: "tag-chip tag-chip-add", title: `Show ${g} books`, onClick: () => onOpenLibrary(g, isDocument(book.format)), children: g }, g))), origin(field("genres")) && _jsx("span", { className: "details-origin", children: origin(field("genres")) })] })), _jsxs("section", { className: "details-section", children: [_jsxs("h2", { children: ["Description", origin(field("synopsis")) && _jsx("span", { className: "details-origin", children: origin(field("synopsis")) })] }), synopsis ? (_jsx("div", { className: "details-synopsis", children: synopsis.split(/\n{2,}/).map((p, i) => (_jsx("p", { children: p }, i))) })) : (_jsxs("p", { className: "muted", children: ["No description yet.", " ", _jsx("button", { type: "button", className: "view-all", onClick: () => askFetchDetails(book), children: "Find one online" })] }))] }), _jsxs("section", { className: "details-section", children: [_jsx("h2", { children: "Details" }), _jsxs("dl", { className: "details-facts", children: [facts
                                                .filter(([, v]) => v)
                                                .map(([label, v, name]) => (_jsxs("div", { children: [_jsx("dt", { children: label }), _jsxs("dd", { children: [v, name && origin(field(name)) && _jsx("span", { className: "details-origin", children: origin(field(name)) })] })] }, label))), _jsx(LocationsRow, { bookId: book.id, refreshKey: refreshKey + reload, fallback: where }), files.length > 1 && _jsx(FormatsRow, { bookId: book.id, files: files, onOpen: (fileId) => onOpenBook(book.id, undefined, fileId), onChanged: refresh }), _jsx(PairRow, { book: book, refreshKey: refreshKey + reload })] })] }), book.series && _jsx(SeriesRow, { name: book.series, author: book.authors[0] ?? "", bookId: book.id, refreshKey: refreshKey + reload }), _jsxs("section", { className: "details-section", children: [_jsx("h2", { children: "Tags and collections" }), _jsxs("div", { className: "details-chips", children: [book.tags.map((t) => (_jsxs("span", { className: "tag-chip", children: [_jsx(Icon, { name: "tag", size: 12 }), " ", t] }, t))), _jsx("button", { type: "button", className: "view-all", onClick: () => askEditTags(book), children: book.tags.length ? "Edit tags" : "Add tags" })] }), _jsxs("div", { className: "details-chips", children: [collections.map((c) => (_jsxs("button", { type: "button", className: "tag-chip tag-chip-add", onClick: () => onOpenCollection(c.id), children: [_jsx(Icon, { name: "collections", size: 12 }), " ", c.name] }, c.id))), _jsx("button", { type: "button", className: "view-all", onClick: () => askAddToCollection(book), children: "Add to a collection" })] }), _jsx("p", { className: "muted", children: annotations
                                            ? `${annotations} ${annotations === 1 ? "highlight or note" : "highlights and notes"}`
                                            : "No highlights or notes yet." })] })] })] }), resetting && (_jsx(ConfirmDialog, { title: "Show the book's own details?", body: "This takes away your edits and the details found online for this book, on every device, and brings back the cover it came with. The book file was never changed, so its own details come back as they were.", confirm: "Show the book's own", onCancel: () => setResetting(false), onConfirm: () => {
                    setResetting(false);
                    api.resetDetails(book.id, true).then(() => {
                        toast(`“${book.title}” shows its own details again.`);
                        refresh();
                    }, (e) => toast(`Couldn't reset the details: ${String(e)}`));
                } }))] }));
}

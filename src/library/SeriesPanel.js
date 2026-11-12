import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { api } from "../api";
import { BookCover } from "../components/BookCover";
import { Icon } from "../components/Icon";
import { useToast } from "../components/Toast";
import { authorLine } from "../lib/format";
const number = (n) => (n === null ? null : `Book ${n}`);
/** A series' check for missing books, shared by its Find button and its panel. */
export function useSeriesReview(name, author, refreshKey, onChanged) {
    const toast = useToast();
    const [review, setReview] = useState(null);
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        setReview(null);
        if (!name)
            return;
        let current = true;
        api.seriesReview(name).then((r) => current && setReview(r), () => current && setReview(null));
        return () => {
            current = false;
        };
    }, [name, refreshKey]);
    const run = async (work, changed = false) => {
        setBusy(true);
        try {
            setReview(await work());
            if (changed)
                onChanged();
        }
        catch (e) {
            toast(String(e).replace(/^Error: /, ""));
        }
        finally {
            setBusy(false);
        }
    };
    return { review, busy, run, find: () => void (name && run(() => api.findSeriesBooks(name, author))) };
}
/** The series' Find missing books button. */
export function FindMissingButton({ state }) {
    if (!state.review)
        return null;
    return (_jsxs("button", { type: "button", className: "btn btn-quiet", disabled: state.busy, onClick: state.find, children: [_jsx(Icon, { name: "search", size: 16 }), " ", state.busy ? "Looking…" : state.review.checkedAt ? "Check again" : "Find missing books"] }));
}
/**
 * Shown under a series: the books of it that aren't in the library (found
 * online, or added by hand), and books in the library that probably belong
 * to it, for Approve or Deny. Books already here aren't listed again.
 * Its Find button sits with the series' other buttons, unless `withFind`.
 */
export function SeriesPanel({ name, author, refreshKey, onChanged, state: given, withFind = false, }) {
    const own = useSeriesReview(given ? null : name, author, refreshKey, onChanged);
    const { review, busy, run } = given ?? own;
    const [showHidden, setShowHidden] = useState(false);
    const [adding, setAdding] = useState(false);
    if (!review)
        return null;
    // Nothing to show until it has looked, or found a book that may belong.
    if (!withFind && !review.checkedAt && review.missing.length === 0 && review.matches.length === 0)
        return null;
    const visible = review.missing.filter((m) => showHidden || !m.hidden);
    const hiddenCount = review.missing.filter((m) => m.hidden).length;
    const readCount = review.missing.filter((m) => m.read && !m.hidden).length;
    const approve = (matches) => void run(() => api.approveSeriesMatches(name, matches.map((m) => ({ bookId: m.book.id, position: m.position }))), true);
    const deny = (matches) => void run(() => api.denySeriesMatches(name, matches.map((m) => m.book.id)));
    return (_jsxs("section", { className: "series-panel", "aria-label": `The ${name} series`, children: [_jsxs("header", { className: "series-head", children: [_jsxs("div", { children: [_jsx("strong", { children: name }), _jsx("span", { className: "muted", children: review.checkedAt
                                    ? `You have ${review.owned} of the ${review.listed} books listed online${readCount ? ` · ${readCount} more read elsewhere` : ""}`
                                    : review.missing.length || review.matches.length
                                        ? "Books of this series that aren't in your library yet."
                                        : `${review.owned} ${review.owned === 1 ? "book" : "books"} here. Find out which ones you're missing.` })] }), withFind && _jsx(FindMissingButton, { state: given ?? own })] }), review.matches.length > 0 && (_jsxs("div", { className: "series-matches", children: [_jsxs("div", { className: "series-sub", children: [_jsxs("span", { children: [_jsx("strong", { children: "Might be in this series" }), _jsx("span", { className: "muted", children: " \u00B7 their details don't say so yet" })] }), _jsxs("span", { className: "series-sub-actions", children: [_jsx("button", { type: "button", className: "btn btn-quiet btn-small", disabled: busy, onClick: () => deny(review.matches), children: "Deny all" }), _jsx("button", { type: "button", className: "btn btn-primary btn-small", disabled: busy, onClick: () => approve(review.matches), children: "Approve all" })] })] }), _jsx("ul", { children: review.matches.map((m) => (_jsxs("li", { className: "duplicate-book", children: [_jsx(BookCover, { book: m.book, size: "s" }), _jsxs("span", { className: "duplicate-text", children: [_jsx("strong", { children: m.book.title }), _jsx("span", { className: "muted", children: authorLine(m.book.authors) }), _jsx("span", { className: "muted duplicate-facts", children: [number(m.position), m.reason].filter(Boolean).join(" · ") })] }), _jsx("button", { type: "button", className: "btn btn-quiet btn-small", disabled: busy, onClick: () => deny([m]), children: "Deny" }), _jsx("button", { type: "button", className: "btn btn-primary btn-small", disabled: busy, onClick: () => approve([m]), children: "Approve" })] }, m.book.id))) })] })), review.checkedAt && review.missing.length === 0 && _jsx("p", { className: "muted series-done", children: "You have every book in the list." }), (review.missing.length > 0 || review.checkedAt) && (_jsxs("div", { className: "series-missing", children: [_jsxs("div", { className: "series-sub", children: [_jsx("strong", { children: "Missing from your library" }), _jsxs("span", { className: "series-sub-actions", children: [hiddenCount > 0 && (_jsx("button", { type: "button", className: "view-all", onClick: () => setShowHidden((s) => !s), children: showHidden ? "Leave hidden ones out" : `Show ${hiddenCount} hidden` })), _jsx("button", { type: "button", className: "view-all", onClick: () => setAdding((a) => !a), children: adding ? "Cancel" : "Add a book the list is missing" })] })] }), adding && (_jsx(AddMissing, { busy: busy, onAdd: (title, position) => void run(() => api.addSeriesBook(name, title, position, author ? [author] : [])).then(() => setAdding(false)) })), visible.length > 0 && (_jsx("ul", { className: "missing-row", children: visible.map((m) => (_jsx(MissingCard, { book: m, busy: busy, onHide: (hidden) => void run(() => api.hideSeriesBook(name, m.key, hidden)), onRead: (read) => void run(() => api.markSeriesBookRead(name, m.key, read)), onRemove: m.source === "you" ? () => void run(() => api.removeSeriesBook(name, m.key)) : undefined }, m.key))) }))] }))] }));
}
/** Adds a book no source lists: its title and number. */
function AddMissing({ busy, onAdd }) {
    const [title, setTitle] = useState("");
    const [position, setPosition] = useState("");
    const n = position.trim() ? Number(position.replace(",", ".")) : null;
    const ok = title.trim().length > 0 && (n === null || (Number.isFinite(n) && n >= 0));
    return (_jsxs("form", { className: "series-add", onSubmit: (e) => {
            e.preventDefault();
            if (ok)
                onAdd(title.trim(), n);
        }, children: [_jsx("input", { type: "text", placeholder: "Title", "aria-label": "Title", value: title, onChange: (e) => setTitle(e.target.value), autoFocus: true }), _jsx("input", { type: "text", inputMode: "decimal", placeholder: "Book number", "aria-label": "Book number", value: position, onChange: (e) => setPosition(e.target.value) }), _jsx("button", { type: "submit", className: "btn btn-primary btn-small", disabled: busy || !ok, children: "Add" })] }));
}
function MissingCard({ book, busy, onHide, onRead, onRemove, }) {
    const [failed, setFailed] = useState(false);
    return (_jsxs("li", { className: `missing-card${book.hidden ? " is-hidden" : ""}${book.read ? " is-read" : ""}`, children: [_jsxs("div", { className: "cover cover-m missing-cover", children: [_jsx("div", { className: "cover-private", "aria-hidden": true, children: _jsx("span", { className: "cover-title", children: book.title }) }), book.coverUrl && !failed ? (_jsx("img", { className: "private-picture", src: book.coverUrl, alt: "", draggable: false, onError: () => setFailed(true) })) : (_jsx("div", { className: "cover-generated missing-blank", children: _jsx("span", { className: "cover-title", children: book.title }) })), _jsx("span", { className: "missing-badge", children: book.read ? "Read" : "Missing" })] }), _jsx("span", { className: "missing-title", title: book.title, children: book.title }), _jsxs("span", { className: "missing-meta", children: [_jsx("span", { className: "muted", children: number(book.position) ?? "No number" }), _jsxs("span", { className: "missing-actions", children: [_jsx("button", { type: "button", className: `icon-btn${book.read ? " is-on" : ""}`, disabled: busy, "aria-pressed": book.read, title: book.read ? "Not read after all" : "Mark as read (read somewhere else)", "aria-label": book.read ? `${book.title} isn't read` : `Mark ${book.title} as read`, onClick: () => onRead(!book.read), children: _jsx(Icon, { name: "check", size: 14 }) }), onRemove && (_jsx("button", { type: "button", className: "icon-btn", disabled: busy, title: "Take it off the list", "aria-label": `Take ${book.title} off the list`, onClick: onRemove, children: _jsx(Icon, { name: "trash", size: 14 }) })), _jsx("button", { type: "button", className: "icon-btn", disabled: busy, title: book.hidden ? "Show it again" : "Hide it (a short story or another edition, say)", "aria-label": book.hidden ? `Show ${book.title} again` : `Hide ${book.title}`, onClick: () => onHide(!book.hidden), children: _jsx(Icon, { name: book.hidden ? "focus" : "eyeOff", size: 14 }) })] })] })] }));
}

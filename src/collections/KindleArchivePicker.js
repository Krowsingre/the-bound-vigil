import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { api } from "../api";
import { Pagination } from "../library/Pagination";
const fold = (value) => " " + value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim() + " ";
export function KindleArchivePicker({ purchase, onClose }) {
    const [search, setSearch] = useState("");
    const [series, setSeries] = useState("");
    const [suggested, setSuggested] = useState([]);
    useEffect(() => {
        let live = true;
        const title = fold(purchase.title);
        const author = fold(purchase.author);
        const box = /\b(box\s*set|collection|omnibus|books|volumes|trilogy)\b/i.test(purchase.title);
        void api.getCollectionsOverview().then((overview) => {
            if (!live)
                return;
            const matches = overview.series.filter((item) => {
                const name = fold(item.name);
                return name.trim().length >= 3 && title.includes(name);
            });
            const related = box && author.trim() ? overview.series.filter((item) => item.authors.some((name) => fold(name) === author)) : [];
            setSuggested([...new Map([...matches, ...related].map((item) => [item.name, item])).values()].slice(0, 4));
        }, () => undefined);
        return () => { live = false; };
    }, [purchase]);
    const [page, setPage] = useState(0);
    const [results, setResults] = useState(null);
    const [picked, setPicked] = useState([]);
    const [markRead, setMarkRead] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    useEffect(() => {
        const ids = purchase.bookIds ?? [];
        if (!ids.length)
            return;
        let live = true;
        void api.getLibrary({ shelf: "all", kind: "books", ids, sort: "title", search: null, formats: [], location: null, page: 0, pageSize: 200 })
            .then((found) => { if (live)
            setPicked(found.books); }, () => undefined);
        return () => { live = false; };
    }, [purchase]);
    useEffect(() => {
        let live = true;
        setResults(null);
        setError("");
        const timer = window.setTimeout(() => {
            void api.getLibrary({
                shelf: "all", kind: "books", sort: series ? "series" : "title", search: search.trim() || null,
                formats: [], location: null, series: series ? [series] : [], page, pageSize: 24,
            }).then((found) => { if (live)
                setResults(found); }, (failure) => { if (live)
                setError(String(failure)); });
        }, 140);
        return () => { live = false; clearTimeout(timer); };
    }, [search, series, page]);
    const showSeries = (name) => { setSeries(name); setSearch(""); setPage(0); };
    const choose = (book) => setPicked((items) => items.some((item) => item.id === book.id)
        ? items.filter((item) => item.id !== book.id) : [...items, book]);
    const save = async () => {
        if (!picked.length || busy)
            return;
        setBusy(true);
        try {
            await api.matchKindleManually(purchase.asin, picked.map((book) => book.id), markRead);
            onClose(true);
        }
        catch (failure) {
            setError(String(failure));
            setBusy(false);
        }
    };
    return (_jsx("div", { className: "dialog-backdrop", onPointerDown: (event) => { if (!busy && event.target === event.currentTarget)
            onClose(false); }, children: _jsxs("div", { className: "dialog details-dialog kindle-archive-picker", role: "dialog", "aria-label": "Match a Kindle purchase", onKeyDown: (event) => { if (!busy && event.key === "Escape")
                onClose(false); }, children: [_jsx("h2", { children: "Match with your Archive" }), _jsxs("p", { children: ["Choose one book or the members of \u201C", purchase.title, "\u201D."] }), _jsx("input", { autoFocus: true, type: "search", "aria-label": "Search Archive", placeholder: "Search by title, author or series", value: search, onChange: (event) => { setSearch(event.target.value); setPage(0); } }), _jsxs("div", { className: "hero-actions", children: [purchase.author && _jsxs("button", { type: "button", className: "btn btn-quiet btn-small", onClick: () => { setSearch(purchase.author); setSeries(""); setPage(0); }, children: ["Books by ", purchase.author] }), series && _jsx("button", { type: "button", className: "btn btn-quiet btn-small", onClick: () => { setSeries(""); setPage(0); }, children: "Clear series filter" })] }), !series && suggested.length > 0 && (_jsxs("div", { className: "hero-actions", children: [_jsx("span", { className: "muted", children: "Suggested series" }), suggested.map((item) => _jsx("button", { type: "button", className: "btn btn-quiet btn-small", onClick: () => showSeries(item.name), children: item.name }, item.name))] })), picked.length > 0 && _jsxs("p", { className: "muted", children: ["Selected ", picked.length, " \u00B7 ", picked.map((book) => book.title).join(", ")] }), results && (_jsxs(_Fragment, { children: [results.books.length === 0 && _jsx("p", { children: "No Archive books match." }), _jsx("ul", { className: "history-list kindle-picker-results", children: results.books.map((book) => (_jsxs("li", { className: "history-row", children: [_jsxs("label", { children: [_jsx("input", { type: "checkbox", checked: picked.some((item) => item.id === book.id), onChange: () => choose(book) }), " ", book.title, " \u00B7 ", book.authors.join(", ")] }), book.series && !series && _jsxs("button", { type: "button", className: "btn btn-quiet btn-small", onClick: () => showSeries(book.series), children: ["Show ", book.series] })] }, book.id))) }), _jsx(Pagination, { page: results.page, pageSize: results.pageSize, total: results.total, onPage: setPage })] })), purchase.read && _jsxs("label", { children: [_jsx("input", { type: "checkbox", checked: markRead, onChange: (event) => setMarkRead(event.target.checked) }), " Mark selected unread books Read"] }), error && _jsx("p", { role: "alert", children: error }), _jsxs("div", { className: "dialog-actions", children: [_jsx("button", { type: "button", className: "btn btn-quiet", disabled: busy, onClick: () => onClose(false), children: "Cancel" }), _jsx("button", { type: "button", className: "btn btn-primary", disabled: busy || !picked.length, onClick: () => void save(), children: "Confirm match" })] })] }) }));
}

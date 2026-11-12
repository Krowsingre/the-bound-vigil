import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
// Where your books are: every book, and whether its file is on this computer,
// in the main sync place and in the second. Each place is asked for its own
// list of files, so books another device put there count too.
import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { Icon } from "../components/Icon";
import { showBookDetails } from "../details/openDetails";
import { placeWords } from "../settings/SyncFolderPanel";
const PAGE = 100;
export function placeName(check) {
    const p = check.provider;
    return placeWords(p, true);
}
/** Not on this computer and in no place that could be checked. */
export function nowhere(b) {
    return !b.here && b.main !== true && b.also !== true;
}
export function matches(b, filter, search) {
    const ok = filter === "here"
        ? b.here
        : filter === "notHere"
            ? !b.here
            : filter === "noMain"
                ? b.main === false
                : filter === "noAlso"
                    ? b.also === false
                    : filter === "nowhere"
                        ? nowhere(b)
                        : true;
    if (!ok)
        return false;
    const q = search.trim().toLowerCase();
    return !q || b.title.toLowerCase().includes(q) || b.authors.some((a) => a.toLowerCase().includes(q));
}
function Mark({ value, place }) {
    if (value === null)
        return _jsx("span", { className: "places-mark is-unknown", title: `${place} couldn't be checked`, children: "\u2013" });
    return value ? (_jsxs("span", { className: "places-mark is-yes", title: `In ${place}`, children: [_jsx(Icon, { name: "check", size: 16 }), _jsx("span", { className: "visually-hidden", children: "Yes" })] })) : (_jsxs("span", { className: "places-mark is-no", title: `Not in ${place}`, children: [_jsx("span", { "aria-hidden": true, children: "\u00B7" }), _jsx("span", { className: "visually-hidden", children: "No" })] }));
}
export function BookPlacesPage({ onOpenSyncSettings }) {
    const [view, setView] = useState(null);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState("all");
    const [search, setSearch] = useState("");
    const [shown, setShown] = useState(PAGE);
    const load = () => {
        setLoading(true);
        setError(null);
        api
            .bookPlaces()
            .then(setView)
            .catch((e) => setError(e instanceof Error ? e.message : String(e)))
            .finally(() => setLoading(false));
    };
    useEffect(load, []);
    useEffect(() => setShown(PAGE), [filter, search]);
    const books = view?.books ?? [];
    const counts = useMemo(() => ({
        here: books.filter((b) => b.here).length,
        notHere: books.filter((b) => !b.here).length,
        noMain: books.filter((b) => b.main === false).length,
        noAlso: books.filter((b) => b.also === false).length,
        nowhere: books.filter(nowhere).length,
    }), [books]);
    const list = useMemo(() => books.filter((b) => matches(b, filter, search)), [books, filter, search]);
    const main = view?.main ?? null;
    const also = view?.also ?? null;
    const mainName = main ? placeName(main) : "";
    const alsoName = also ? placeName(also) : "";
    // A place that couldn't be answered might hold a book, so "nowhere" waits for every place.
    const allChecked = !main?.problem && !also?.problem;
    const filters = [
        { id: "all", label: "All", count: books.length },
        { id: "here", label: "On this computer", count: counts.here },
        { id: "notHere", label: "Not on this computer", count: counts.notHere },
        ...(main && !main.problem ? [{ id: "noMain", label: `Missing from ${mainName}`, count: counts.noMain }] : []),
        ...(also && !also.problem ? [{ id: "noAlso", label: `Missing from ${alsoName}`, count: counts.noAlso }] : []),
        ...(counts.nowhere && allChecked ? [{ id: "nowhere", label: "Nowhere", count: counts.nowhere }] : []),
    ];
    return (_jsxs("div", { className: "library imports-page places-page", children: [_jsxs("header", { className: "library-head", children: [_jsxs("div", { children: [_jsx("h1", { className: "library-title", children: "Where your books are" }), _jsxs("p", { className: "eyebrow", children: ["This computer", main ? `, ${mainName}` : "", also ? ` and ${alsoName}` : ""] })] }), _jsxs("div", { className: "imports-actions", children: [_jsxs("button", { type: "button", className: "btn btn-quiet", onClick: onOpenSyncSettings, children: [_jsx(Icon, { name: "settings", size: 16 }), " Sync settings"] }), _jsxs("button", { type: "button", className: "btn btn-primary", disabled: loading, onClick: load, children: [_jsx(Icon, { name: "sync", size: 16 }), " ", loading ? "Checking…" : "Check again"] })] })] }), error ? (_jsxs("div", { className: "imports-empty", children: [_jsx(Icon, { name: "warning", size: 28 }), _jsx("p", { children: error })] })) : !view ? (_jsxs("div", { className: "imports-empty", children: [_jsx(Icon, { name: "cloud", size: 28 }), _jsx("p", { children: "Asking each place which books it holds. With a big library this takes a little while." })] })) : (_jsxs(_Fragment, { children: [[main, also].map((check, i) => check?.problem && (_jsxs("p", { className: "form-error", children: [placeName(check), ": ", check.problem, " Its column shows a dash until it can be checked."] }, i))), !main && !also && _jsx("p", { className: "settings-row-hint", children: "Sync is off, so books are only on this computer or nowhere." }), _jsxs("div", { className: "places-tools", children: [_jsx("div", { className: "segmented places-filters", role: "radiogroup", "aria-label": "Which books to show", children: filters.map((f) => (_jsxs("button", { type: "button", role: "radio", "aria-checked": filter === f.id, onClick: () => setFilter(f.id), children: [f.label, " ", _jsx("span", { className: "places-count", children: (f.count ?? 0).toLocaleString() })] }, f.id))) }), _jsx("input", { type: "search", className: "places-search", placeholder: "Find a title or author", "aria-label": "Find a title or author", value: search, onChange: (e) => setSearch(e.target.value) })] }), list.length === 0 ? (_jsx("p", { className: "settings-row-hint places-none", children: "No books here." })) : (_jsxs("table", { className: "places-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { scope: "col", children: "Book" }), _jsx("th", { scope: "col", children: "This computer" }), main && _jsx("th", { scope: "col", children: mainName }), also && _jsx("th", { scope: "col", children: alsoName })] }) }), _jsx("tbody", { children: list.slice(0, shown).map((b) => (_jsxs("tr", { className: allChecked && nowhere(b) ? "is-bad" : undefined, children: [_jsx("td", { children: _jsxs("button", { type: "button", className: "places-book", onClick: () => showBookDetails(b.bookId), children: [_jsx("span", { className: "import-name", children: b.title }), _jsx("span", { className: "import-detail", children: [b.authors.join(", "), b.format.toUpperCase()].filter(Boolean).join(" · ") })] }) }), _jsx("td", { children: _jsx(Mark, { value: b.here, place: "this computer" }) }), main && (_jsx("td", { children: _jsx(Mark, { value: b.main, place: mainName }) })), also && (_jsx("td", { children: _jsx(Mark, { value: b.also, place: alsoName }) }))] }, b.bookId))) })] })), list.length > shown && (_jsxs("button", { type: "button", className: "btn btn-quiet places-more", onClick: () => setShown((n) => n + PAGE * 5), children: ["Show ", Math.min(PAGE * 5, list.length - shown).toLocaleString(), " more of ", (list.length - shown).toLocaleString()] }))] }))] }));
}

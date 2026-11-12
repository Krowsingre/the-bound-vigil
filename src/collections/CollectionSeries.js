import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// Finding the missing books of the series in a collection: one panel for a
// single series, or every series in it checked at once.
import { useState } from "react";
import { api, isHome, isWeb } from "../api";
import { Icon } from "../components/Icon";
import { useToast } from "../components/Toast";
import { SeriesPanel } from "../library/SeriesPanel";
/** Each series in `books` once, with an author to narrow the search. */
export function seriesIn(books) {
    const found = new Map();
    for (const book of books) {
        const name = book.series?.trim();
        if (!name)
            continue;
        const key = name.toLowerCase();
        if (!found.has(key))
            found.set(key, { name, author: book.authors[0] ?? "" });
    }
    return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}
export function CollectionSeries({ collection, books, refreshKey, onChanged, }) {
    const toast = useToast();
    const [checking, setChecking] = useState(null);
    /** After checking them all: the series with something to show. */
    const [shown, setShown] = useState(null);
    const [checked, setChecked] = useState(0);
    if (isWeb || isHome || collection.kind === "smart")
        return null;
    const series = seriesIn(books);
    if (series.length === 0)
        return null;
    if (series.length === 1 || collection.kind === "series") {
        const one = collection.kind === "series" ? { name: collection.name, author: series[0]?.author ?? "" } : series[0];
        return _jsx(SeriesPanel, { name: one.name, author: one.author, refreshKey: refreshKey, onChanged: onChanged, withFind: true });
    }
    const checkAll = async () => {
        setChecking({ done: 0, total: series.length });
        const left = [];
        let failed = 0;
        for (const [i, s] of series.entries()) {
            try {
                const review = await api.findSeriesBooks(s.name, s.author);
                if (review.matches.length || review.missing.some((m) => !m.hidden))
                    left.push(s.name);
            }
            catch {
                failed++;
            }
            setChecking({ done: i + 1, total: series.length });
        }
        setChecking(null);
        setShown(left);
        setChecked((n) => n + 1);
        if (failed)
            toast(`${failed} of the ${series.length} series couldn't be found online.`);
    };
    return (_jsxs("section", { className: "series-panel", "aria-label": "Series in this collection", children: [_jsxs("header", { className: "series-head", children: [_jsxs("div", { children: [_jsxs("strong", { children: [series.length, " series"] }), _jsx("span", { className: "muted", children: checking
                                    ? `Checking ${checking.done + 1 > checking.total ? checking.total : checking.done + 1} of ${checking.total}…`
                                    : shown
                                        ? shown.length
                                            ? `${shown.length} of them ${shown.length === 1 ? "has" : "have"} books you're missing, or books to check.`
                                            : "You have every book listed online for all of them."
                                        : "Find the books you're missing from every series in this collection." })] }), _jsxs("button", { type: "button", className: "btn btn-quiet", disabled: !!checking, onClick: () => void checkAll(), children: [_jsx(Icon, { name: "search", size: 16 }), " ", checking ? "Looking…" : shown ? "Check again" : `Find missing books in all ${series.length}`] })] }), shown?.map((name) => (_jsx(SeriesPanel, { name: name, author: series.find((s) => s.name === name)?.author ?? "", refreshKey: refreshKey + checked, onChanged: onChanged }, name)))] }));
}

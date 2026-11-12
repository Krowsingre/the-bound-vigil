import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
// Preferences › Archive › Reading history: books finished, dropped or rated,
// kept after they leave the library. Any one can be taken off for good.
import { useEffect, useState } from "react";
import { api } from "../api";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Icon } from "../components/Icon";
import { Stars } from "../components/StarRating";
import { useToast } from "../components/Toast";
import { authorLine } from "../lib/format";
import { Section } from "./controls";
/** How many show before "Show all". */
const FIRST = 30;
export function ReadingHistorySection() {
    const toast = useToast();
    const [entries, setEntries] = useState(null);
    const [search, setSearch] = useState("");
    const [all, setAll] = useState(false);
    const [forgetting, setForgetting] = useState(null);
    useEffect(() => {
        let current = true;
        api.readingHistory().then((list) => current && setEntries(list), () => current && setEntries([]));
        return () => {
            current = false;
        };
    }, []);
    const words = search.trim().toLowerCase();
    const found = (entries ?? []).filter((e) => !words || `${e.title} ${e.authors.join(" ")}`.toLowerCase().includes(words));
    const shown = all || words ? found : found.slice(0, FIRST);
    const forget = async (entry) => {
        setForgetting(null);
        try {
            await api.forgetReading(entry.bookId);
            setEntries((list) => (list ?? []).filter((e) => e.bookId !== entry.bookId));
        }
        catch (e) {
            toast(`That didn't work: ${String(e)}`);
        }
    };
    return (_jsxs(Section, { id: "history", title: "Reading history", collapsible: true, lede: "Books you've finished, dropped or rated, kept even after they leave your library. Take one off and nothing about it is kept, on any of your devices.", children: [entries === null ? (_jsx("div", { className: "library-loading", "aria-busy": "true", "aria-label": "Loading your reading history" })) : entries.length === 0 ? (_jsx("p", { className: "settings-row-hint", children: "Nothing yet. Books you finish, drop or rate show here." })) : (_jsxs(_Fragment, { children: [entries.length > 8 && (_jsxs("label", { className: "history-search", children: [_jsx(Icon, { name: "search", size: 15 }), _jsx("input", { type: "search", value: search, onChange: (e) => setSearch(e.target.value), placeholder: "Find a book", "aria-label": "Find a book in your reading history" })] })), _jsx("ul", { className: "history-list", children: shown.map((e) => (_jsxs("li", { className: "history-row", children: [_jsxs("span", { className: "history-text", children: [_jsx("span", { className: "history-title", children: e.title }), _jsx("span", { className: "muted history-meta", children: [
                                                authorLine(e.authors),
                                                e.status === "read" ? "Finished" : e.status === "dropped" ? "Dropped" : null,
                                                e.finishedAt ? new Date(e.finishedAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : null,
                                                e.bookId.startsWith("suggested:") ? "From Suggested reading" : e.inLibrary ? null : "No longer in your library",
                                            ]
                                                .filter(Boolean)
                                                .join(" · ") })] }), _jsx(Stars, { value: e.stars, size: 13 }), _jsx("button", { type: "button", className: "icon-btn icon-btn-s", "aria-label": `Take ${e.title} off your reading history`, title: "Take off your reading history", onClick: () => setForgetting(e), children: _jsx(Icon, { name: "close", size: 15 }) })] }, e.bookId))) }), words && found.length === 0 && _jsxs("p", { className: "settings-row-hint", children: ["No book in your reading history matches \u201C", search.trim(), "\u201D."] }), !all && !words && found.length > FIRST && (_jsxs("button", { type: "button", className: "btn btn-quiet btn-small", onClick: () => setAll(true), children: ["Show all ", found.length] }))] })), forgetting && (_jsx(ConfirmDialog, { title: `Take ${forgetting.title} off your reading history?`, body: forgetting.inLibrary
                    ? "It goes from your history on all your devices. The book stays in your library with its rating and status, and comes back here if you finish, drop or rate it again."
                    : "It goes for good, on all your devices. Nothing about it is kept.", confirm: "Take it off", danger: true, onCancel: () => setForgetting(null), onConfirm: () => void forget(forgetting) }))] }));
}

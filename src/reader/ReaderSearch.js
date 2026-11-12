import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { forwardRef, useEffect, useRef, useState } from "react";
import { Icon } from "../components/Icon";
/** Search inside the book (Ctrl+K). Results list by chapter; picking one goes there. */
export const ReaderSearch = forwardRef(function ReaderSearch({ run, clear, onGo, autoFocus }, inputRef) {
    const [query, setQuery] = useState("");
    const [groups, setGroups] = useState([]);
    const [progress, setProgress] = useState(null);
    const [open, setOpen] = useState(false);
    const root = useRef(null);
    const runId = useRef(0);
    const gone = useRef(false);
    const reset = () => {
        runId.current++;
        setGroups([]);
        setProgress(null);
        clear();
    };
    const start = async () => {
        const q = query.trim();
        reset();
        if (!q)
            return;
        const id = runId.current;
        const results = run(q);
        if (!results)
            return;
        setOpen(true);
        setProgress(0);
        for await (const r of results) {
            if (id !== runId.current) {
                // Closed mid-search: the page it just marked is cleared too.
                if (gone.current)
                    clear();
                return;
            }
            if (r === "done")
                break;
            if ("progress" in r)
                setProgress(r.progress);
            else if (r.subitems.length)
                setGroups((g) => [...g, { label: r.label, hits: r.subitems }]);
        }
        if (id === runId.current)
            setProgress(null);
    };
    useEffect(() => {
        gone.current = false;
        return () => {
            gone.current = true;
            runId.current++;
        };
    }, []);
    useEffect(() => {
        if (!open)
            return;
        const close = (e) => !root.current?.contains(e.target) && setOpen(false);
        document.addEventListener("pointerdown", close);
        return () => document.removeEventListener("pointerdown", close);
    }, [open]);
    const count = groups.reduce((n, g) => n + g.hits.length, 0);
    return (_jsxs("div", { className: "reader-search", ref: root, children: [_jsxs("form", { className: "search", role: "search", onSubmit: (e) => {
                    e.preventDefault();
                    void start();
                }, children: [_jsx(Icon, { name: "search", size: 16 }), _jsx("input", { ref: inputRef, type: "search", "aria-label": "Search in this book", placeholder: "Search in this book\u2026", value: query, onChange: (e) => {
                            setQuery(e.target.value);
                            if (!e.target.value) {
                                reset();
                                setOpen(false);
                            }
                        }, onFocus: () => groups.length && setOpen(true), onKeyDown: (e) => {
                            if (e.key === "Escape") {
                                setQuery("");
                                reset();
                                setOpen(false);
                                e.currentTarget.blur();
                            }
                        }, autoFocus: autoFocus, autoComplete: "off", spellCheck: false }), _jsx("kbd", { children: "Ctrl K" })] }), open && (query.trim() || progress !== null) && (_jsxs("div", { className: "reader-search-results", role: "listbox", "aria-label": "Search results", children: [_jsx("p", { className: "reader-search-status", children: progress !== null
                            ? `Searching… ${Math.round(progress * 100)}%`
                            : count
                                ? `${count} ${count === 1 ? "match" : "matches"}`
                                : "No matches in this book." }), groups.map((g, gi) => (_jsxs("div", { className: "reader-search-group", children: [g.label && _jsx("p", { className: "reader-search-chapter", children: g.label }), g.hits.map((h) => (_jsxs("button", { type: "button", role: "option", "aria-selected": false, className: "reader-search-hit", onClick: () => {
                                    setOpen(false);
                                    onGo(h.cfi);
                                }, children: [h.excerpt.pre, _jsx("mark", { children: h.excerpt.match }), h.excerpt.post] }, h.cfi)))] }, gi)))] }))] }));
});

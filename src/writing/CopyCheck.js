import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
// The plagiarism check: the book's passages looked for, word for word, in the
// books of the library on this device. Nothing is sent anywhere.
import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { bookOrder } from "./epub";
import { isMade, readPage } from "./pages";
/** The pages worth checking, as plain text: quotations and epigraphs are left out, since they're meant to be someone else's words. */
export function writingSections(chapters) {
    const out = [];
    for (const c of bookOrder(chapters)) {
        if (c.role === "part")
            continue;
        const page = readPage(c.page, c.role);
        if (isMade(page) || page.kind === "epigraph" || page.kind === "sources")
            continue;
        const doc = new DOMParser().parseFromString(`<body>${c.body}</body>`, "text/html");
        doc.querySelectorAll("blockquote, aside, [data-footnote]").forEach((el) => el.remove());
        doc.querySelectorAll("p, div, li, h1, h2, h3, br").forEach((el) => el.after("\n"));
        const text = (doc.body.textContent ?? "").replace(/[ \t]+/g, " ").trim();
        if (text)
            out.push({ title: c.title.trim() || "Untitled page", text });
    }
    return out;
}
export function CopyCheckDialog({ project, onFlush, onClose }) {
    const [progress, setProgress] = useState(null);
    const [found, setFound] = useState(null);
    const [titles, setTitles] = useState([]);
    const [error, setError] = useState(null);
    const [stopping, setStopping] = useState(false);
    const running = useRef(false);
    useEffect(() => {
        const stop = api.onCopyCheckProgress(setProgress);
        let stale = false;
        running.current = true;
        void (async () => {
            try {
                const sections = writingSections(await onFlush());
                setTitles(sections.map((s) => s.title));
                const result = await api.copyCheck(sections, project.title);
                if (!stale)
                    setFound(result);
            }
            catch (e) {
                if (!stale)
                    setError(String(e).replace(/^Error: /, ""));
            }
            finally {
                running.current = false;
            }
        })();
        return () => {
            stale = true;
            stop();
            if (running.current)
                void api.copyCheckStop();
        };
    }, [project.id]); // Once per opening.
    const words = found?.reduce((n, m) => n + m.words, 0) ?? 0;
    return (_jsx("div", { className: "dialog-backdrop", onPointerDown: (e) => e.target === e.currentTarget && onClose(), children: _jsxs("div", { className: "dialog writing-dialog copy-check", role: "dialog", "aria-label": "Check for copied passages", onKeyDown: (e) => e.key === "Escape" && onClose(), children: [_jsx("h2", { children: "Check for copied passages" }), _jsx("p", { className: "muted dialog-lede", children: "Looks for passages of twelve words or more that also appear, word for word, in the books in your library on this device. Quotations and epigraphs are left out, and so are copies of this book. Nothing leaves your device." }), error ? (_jsx("p", { className: "form-error", role: "alert", children: error })) : !found ? (_jsxs("div", { className: "copy-check-progress", children: [_jsx("progress", { max: progress?.total || 1, value: progress?.done ?? 0 }), _jsx("span", { className: "muted", children: progress ? `Read ${progress.done.toLocaleString()} of ${progress.total.toLocaleString()} books` : "Getting the books ready…" })] })) : (_jsxs(_Fragment, { children: [_jsxs("p", { className: `preflight-summary${found.length ? " is-problem" : " is-ready"}`, children: [stopping ? "Stopped part-way. " : "", found.length
                                    ? `${words.toLocaleString()} words were found in ${found.length} ${found.length === 1 ? "book" : "books"}.`
                                    : `No passages of twelve words or more were found${progress ? ` in ${progress.done.toLocaleString()} books` : ""}.`] }), _jsx("ul", { className: "copy-check-list", children: found.map((m) => (_jsxs("li", { children: [_jsxs("div", { className: "copy-check-book", children: [_jsx("strong", { children: m.title }), m.author && _jsxs("span", { className: "muted", children: [" by ", m.author] }), _jsxs("span", { className: "preflight-for", children: [m.words.toLocaleString(), " words"] })] }), m.passages.map((p, i) => (_jsxs("blockquote", { children: [_jsxs("span", { className: "muted copy-check-where", children: [titles[p.section] ?? "A page", " \u00B7 ", p.words, " words"] }), p.text] }, i)))] }, m.bookId))) }), found.length > 0 && _jsx("p", { className: "muted writing-export-note", children: "A match can be fine: a common saying, a quotation you've credited, or your own earlier book. Rewrite or credit anything that isn't." })] })), _jsxs("div", { className: "dialog-actions", children: [!found && !error && (_jsx("button", { type: "button", className: "btn btn-quiet", disabled: stopping, onClick: () => {
                                setStopping(true);
                                void api.copyCheckStop();
                            }, children: "Stop" })), _jsx("button", { type: "button", className: "btn btn-primary", onClick: onClose, children: found || error ? "Done" : "Close" })] })] }) }));
}

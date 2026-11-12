import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
// The check before uploading, as a window: choose the stores, see what each
// would turn away and what's worth fixing, in plain words.
import { useEffect, useState } from "react";
import { readExport } from "./epub";
import { IsbnGuide } from "./IsbnGuide";
import { pagesKey } from "./PaperbackCover";
import { preflight, STORES } from "./preflightChecks";
import { bookInput } from "./WritingDialogs";
const STORES_KEY = "tbv.preflight.stores";
const savedStores = () => {
    try {
        const saved = JSON.parse(localStorage.getItem(STORES_KEY) ?? "null");
        if (Array.isArray(saved))
            return STORES.map((s) => s.value).filter((s) => saved.includes(s));
    }
    catch {
        // The usual stores, then.
    }
    return ["kdp", "apple", "kobo", "bn", "google", "kdpPrint"];
};
const GROUPS = [
    { level: "problem", title: "Stores would turn these away", none: "Nothing a store would turn away." },
    { level: "warning", title: "Worth fixing", none: "Nothing else to fix." },
    { level: "ok", title: "Checked and fine", none: "" },
];
export function PreflightDialog({ project, onFlush, onClose }) {
    const [stores, setStores] = useState(savedStores);
    const [findings, setFindings] = useState(null);
    const [error, setError] = useState(null);
    useEffect(() => {
        let stale = false;
        setFindings(null);
        void (async () => {
            try {
                const chapters = await onFlush();
                const settings = readExport(project.export);
                let pages = null;
                try {
                    pages = Number(localStorage.getItem(pagesKey(project.id))) || null;
                }
                catch {
                    // Not known yet.
                }
                const found = preflight({ book: await bookInput(project, chapters, settings), stores, print: { pages, trim: settings.print.trim } });
                if (!stale)
                    setFindings(found);
            }
            catch (e) {
                if (!stale)
                    setError(String(e).replace(/^Error: /, ""));
            }
        })();
        return () => void (stale = true);
        // The book is read once per choice of stores.
    }, [stores]);
    const toggle = (store) => {
        const next = stores.includes(store) ? stores.filter((s) => s !== store) : [...stores, store];
        setStores(next);
        try {
            localStorage.setItem(STORES_KEY, JSON.stringify(next));
        }
        catch {
            // Remembered for this time only.
        }
    };
    const problems = findings?.filter((f) => f.level === "problem").length ?? 0;
    return (_jsx("div", { className: "dialog-backdrop", onPointerDown: (e) => e.target === e.currentTarget && onClose(), children: _jsxs("div", { className: "dialog writing-dialog preflight", role: "dialog", "aria-label": "Check before uploading", onKeyDown: (e) => e.key === "Escape" && onClose(), children: [_jsx("h2", { children: "Check before uploading" }), _jsx("p", { className: "muted dialog-lede", children: "Checks the book's pages and links, its details and cover, and each store's own rules, so nothing is turned away after you upload." }), _jsx("div", { className: "preflight-stores", role: "group", "aria-label": "Where it's going", children: STORES.map((s) => (_jsx("button", { type: "button", className: `chip${stores.includes(s.value) ? " is-active" : ""}`, "aria-pressed": stores.includes(s.value), onClick: () => toggle(s.value), children: s.label }, s.value))) }), error ? (_jsx("p", { className: "form-error", role: "alert", children: error })) : !findings ? (_jsx("p", { className: "muted", children: "Checking the book\u2026" })) : (_jsxs(_Fragment, { children: [_jsx("p", { className: `preflight-summary${problems ? " is-problem" : " is-ready"}`, children: problems ? `${problems} ${problems === 1 ? "thing needs" : "things need"} fixing before you upload.` : stores.length ? "Ready to upload." : "Choose where the book is going." }), GROUPS.map((g) => {
                            const list = findings.filter((f) => f.level === g.level);
                            if (!list.length && !g.none)
                                return null;
                            return (_jsxs("section", { className: `preflight-group is-${g.level}`, children: [_jsx("h3", { children: g.title }), !list.length && _jsx("p", { className: "muted", children: g.none }), _jsx("ul", { children: list.map((f, i) => (_jsxs("li", { children: [_jsx("strong", { children: f.title }), f.stores?.length ? _jsx("span", { className: "preflight-for", children: f.stores.map((s) => STORES.find((x) => x.value === s).label).join(" · ") }) : null, _jsx("p", { children: f.detail }), f.where?.length ? _jsxs("p", { className: "muted preflight-where", children: ["On: ", f.where.slice(0, 8).join(", "), f.where.length > 8 ? ` and ${f.where.length - 8} more` : ""] }) : null] }, i))) })] }, g.level));
                        })] })), _jsx(IsbnGuide, {}), _jsx("div", { className: "dialog-actions", children: _jsx("button", { type: "button", className: "btn btn-primary", onClick: onClose, children: "Done" }) })] }) }));
}

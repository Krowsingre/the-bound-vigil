import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { api } from "../api";
import { hashOf } from "../lib/format";
export function CollectionsTab({ collections, onOpenCollection, }) {
    if (collections === null)
        return _jsx("div", { className: "library-loading", "aria-busy": "true" });
    if (collections.length === 0)
        return (_jsxs("div", { className: "library-empty", children: [_jsx("h2", { children: "No collections yet" }), _jsx("p", { className: "muted", children: "Collections group books your way, like a reading list for winter. Make them in the Compendium, or from any book's \u2026 menu." })] }));
    return (_jsx("ul", { className: "tiles collection-grid", children: collections.map((c) => (_jsx("li", { children: _jsxs("button", { type: "button", className: "tile", onClick: () => onOpenCollection(c.id), children: [_jsx("span", { className: `tile-art tile-art-${Math.min(c.coverPaths.length, 4)}`, "data-tone": hashOf(c.id) % 4, children: c.coverPaths.map((p) => (_jsx("img", { src: api.coverUrl(p), alt: "", draggable: false }, p))) }), _jsx("span", { className: "book-title", children: c.name }), _jsxs("span", { className: "book-author", children: [c.count, " ", c.count === 1 ? "book" : "books"] })] }) }, c.id))) }));
}

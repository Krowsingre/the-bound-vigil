import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { api } from "../api";
import { BookCover } from "../components/BookCover";
import { Icon } from "../components/Icon";
import { Menu } from "../components/Menu";
import { authorLine, percent } from "../lib/format";
import { Badge } from "./badges";
import { CollectionPicture } from "./CollectionCards";
import { bookCount, KIND_LABEL, SMART_INFO } from "./collectionInfo";
const PANEL_BOOKS = 5;
/** The selected collection, at the side of the Collections page. */
export function CollectionPanel({ selected, series, refreshKey, menuFor, onOpen, onOpenBook, }) {
    const [detail, setDetail] = useState(null);
    const [error, setError] = useState(null);
    const key = JSON.stringify(selected);
    useEffect(() => {
        let current = true;
        setError(null);
        api.getCollection(selected).then((d) => current && setDetail(d), (e) => current && setError(String(e)));
        return () => {
            current = false;
        };
        // `key` stands for `selected`, which is a fresh object on each render.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key, refreshKey]);
    if (error)
        return _jsx("aside", { className: "collection-panel muted", children: error });
    if (!detail)
        return _jsx("aside", { className: "collection-panel", "aria-busy": "true" });
    const c = detail.collection;
    const name = selected.kind === "smart" ? SMART_INFO[selected.smart].name : selected.kind === "series" ? selected.name : (c?.name ?? "");
    const badge = selected.kind === "smart" ? SMART_INFO[selected.smart].badge : selected.kind === "series" ? "scroll" : c?.badge;
    const description = selected.kind === "smart"
        ? SMART_INFO[selected.smart].description
        : selected.kind === "series"
            ? `A series by ${authorLine(series.find((s) => s.name === selected.name)?.authors ?? []) || "unknown authors"}, in reading order.`
            : c?.description;
    const kindLabel = selected.kind === "smart" ? "Smart collection" : selected.kind === "series" ? "Series" : c?.rules ? "Filled by rules" : c && KIND_LABEL[c.kind];
    const covers = detail.books.slice(0, 3).map(({ id, title, authors, coverPath }) => ({ id, title, authors, coverPath }));
    const menu = menuFor(detail);
    return (_jsxs("aside", { className: "collection-panel", "aria-label": `${name}, selected`, children: [_jsx(CollectionPicture, { collection: { id: c?.id ?? name, picture: c?.picture ?? null, picturePath: c?.picturePath ?? null, covers }, className: "panel-picture", shape: "square" }), _jsxs("div", { className: "panel-title", "data-item-menu": true, children: [_jsx(Badge, { name: badge, size: 22 }), _jsx("h2", { children: name }), menu.length > 0 && _jsx(Menu, { label: `More for ${name}`, trigger: _jsx(Icon, { name: "more" }), items: menu })] }), _jsxs("p", { className: "panel-meta", children: [bookCount(detail.books.length), kindLabel && _jsxs(_Fragment, { children: [" \u00B7 ", kindLabel] })] }), description && _jsx("p", { className: "panel-description", children: description }), _jsx("h3", { className: "panel-heading", children: "Books in this collection" }), detail.books.length === 0 ? (_jsx("p", { className: "muted panel-empty", children: selected.kind === "collection" && c?.kind !== "shelf"
                    ? "No books yet. Add them from any book's … menu, or from the collection itself."
                    : "No books here right now." })) : (_jsx("ul", { className: "panel-books", children: detail.books.slice(0, PANEL_BOOKS).map((b) => (_jsx("li", { children: _jsxs("button", { type: "button", className: "panel-book", onClick: () => onOpenBook(b.id), title: `Open ${b.title}`, children: [_jsx(BookCover, { book: b, size: "s" }), _jsxs("span", { className: "panel-book-text", children: [_jsx("span", { className: "panel-book-title", children: b.title }), _jsx("span", { className: "panel-book-author", children: authorLine(b.authors) }), b.status === "in_progress" && _jsx("span", { className: "panel-book-progress", children: percent(b.totalProgression) })] })] }) }, b.id))) })), detail.books.length > PANEL_BOOKS && (_jsxs("p", { className: "muted panel-more", children: ["and ", bookCount(detail.books.length - PANEL_BOOKS), " more"] })), _jsxs("button", { type: "button", className: "btn btn-quiet btn-wide panel-view", onClick: onOpen, children: ["View collection ", _jsx(Icon, { name: "arrowRight", size: 16 })] })] }));
}

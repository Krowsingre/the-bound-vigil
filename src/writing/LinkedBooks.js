import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// Linked books in Scribe (embre, 4 November 2026): books linked as editions
// of one book show as one card, not separately. Opening it shows the
// editions in order, each a book you can still write in, and under each
// edition the drafts kept of it, which are locked copies to read.
import { useEffect, useState } from "react";
import { api } from "../api";
import { Icon } from "../components/Icon";
import { Menu } from "../components/Menu";
import { relativeTime } from "../lib/format";
import { readExport } from "./epub";
import { isSample } from "./sampleBook";
/** The books as they show in Scribe: editions of one book together, every other book on its own, in the order given. */
export function shelve(books) {
    const groups = new Map();
    for (const book of books) {
        const edition = isSample(book) ? null : readExport(book.export).edition;
        if (edition)
            groups.set(edition.group, [...(groups.get(edition.group) ?? []), { book, edition }]);
    }
    const out = [];
    const placed = new Set();
    for (const book of books) {
        const group = isSample(book) ? null : readExport(book.export).edition?.group;
        const editions = group ? groups.get(group) : undefined;
        if (!group || !editions || editions.length < 2)
            out.push({ kind: "book", book });
        else if (!placed.has(group)) {
            placed.add(group);
            out.push({ kind: "linked", group, editions: [...editions].sort((a, b) => a.edition.number - b.edition.number) });
        }
    }
    return out;
}
/** The edition that stands for the whole book on its card: the latest. */
export const latestOf = (shelf) => shelf.editions[shelf.editions.length - 1].book;
const words = (n) => `${n.toLocaleString()} ${n === 1 ? "word" : "words"}`;
const dateOf = (iso) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
/** Everything kept under one linked book: its editions, and each one's drafts. */
export function LinkedBookView({ shelf, cover, menuFor, onOpen, onOpenDraft, onBack, refresh, }) {
    const latest = latestOf(shelf);
    const [drafts, setDrafts] = useState({});
    const ids = shelf.editions.map((e) => e.book.id).join(",");
    useEffect(() => {
        let live = true;
        for (const id of ids.split(",")) {
            api.writingDrafts(id).then((list) => live && setDrafts((d) => ({ ...d, [id]: list })), () => live && setDrafts((d) => ({ ...d, [id]: "error" })));
        }
        return () => void (live = false);
    }, [ids, refresh]);
    return (_jsxs("section", { className: "scribe-linked", "aria-labelledby": "scribe-linked-title", children: [_jsxs("button", { type: "button", className: "link-btn scribe-linked-back", onClick: onBack, children: [_jsx(Icon, { name: "chevronLeft", size: 15 }), " All your books"] }), _jsxs("header", { className: "scribe-linked-head", children: [_jsx("span", { className: "scribe-linked-cover", children: cover(latest) ? _jsx("img", { src: cover(latest), alt: "" }) : _jsx("span", { className: "scribe-book-blank", children: latest.title }) }), _jsxs("div", { children: [_jsx("h2", { id: "scribe-linked-title", className: "scribe-section-title", children: latest.title }), _jsx("p", { className: "muted", children: latest.author || "No author yet" }), _jsxs("p", { className: "muted scribe-linked-count", children: [shelf.editions.length, " editions, each with its own drafts"] })] })] }), _jsxs("p", { className: "muted scribe-linked-key", children: [_jsx("span", { className: "scribe-edition-badge scribe-linked-key-badge", children: "Edition" }), " a book you can still write in, with its own ISBNs.", " ", _jsxs("span", { className: "scribe-linked-key-draft", children: [_jsx(Icon, { name: "lock", size: 13 }), " Draft"] }), " ", "a locked copy of that edition, kept to read, highlight and make notes in."] }), _jsx("ol", { className: "scribe-editions", children: [...shelf.editions].reverse().map(({ book, edition }) => {
                    const kept = drafts[book.id];
                    return (_jsxs("li", { className: "scribe-edition", children: [_jsxs("div", { className: "scribe-edition-main", children: [_jsx("span", { className: "scribe-edition-number", "aria-hidden": true, children: edition.number }), _jsxs("button", { type: "button", className: "scribe-edition-open", onClick: () => onOpen(book.id), children: [_jsxs("span", { className: "scribe-edition-name", children: [_jsx("strong", { children: edition.name }), edition.year && _jsxs("span", { className: "muted", children: [" \u00B7 ", edition.year] }), book.id === latest.id && _jsx("span", { className: "scribe-edition-badge", children: "Latest" })] }), edition.note && _jsx("span", { className: "muted scribe-edition-note", children: edition.note }), _jsxs("span", { className: "muted scribe-edition-meta", children: [book.title !== latest.title ? `${book.title} · ` : "", book.chapters, " ", book.chapters === 1 ? "chapter" : "chapters", " \u00B7 ", words(book.words), " \u00B7 Edited ", relativeTime(book.updatedAt)] })] }), _jsxs("button", { type: "button", className: "btn btn-quiet btn-small scribe-edition-write", onClick: () => onOpen(book.id), children: [_jsx(Icon, { name: "pen", size: 14 }), " Write"] }), _jsx(Menu, { label: `More for the ${edition.name.toLowerCase()}`, className: "icon-btn", align: "end", trigger: _jsx(Icon, { name: "more", size: 18 }), items: menuFor(book) })] }), _jsx("div", { className: "scribe-edition-drafts", children: kept === undefined ? (_jsx("span", { className: "muted", children: "Looking for drafts\u2026" })) : kept === "error" ? (_jsx("span", { className: "muted", children: "Its drafts couldn't be listed." })) : kept.length === 0 ? (_jsx("span", { className: "muted", children: "No drafts kept of this edition yet. Keep one from Drafts inside the book." })) : (_jsx("ul", { "aria-label": `Drafts of the ${edition.name.toLowerCase()}`, children: [...kept].reverse().map((d) => (_jsx("li", { children: _jsxs("button", { type: "button", className: "scribe-draft", onClick: () => onOpenDraft(d.bookId), children: [_jsx(Icon, { name: "lock", size: 14 }), _jsxs("span", { className: "scribe-draft-name", children: ["Draft ", d.number] }), _jsxs("span", { className: "muted", children: [dateOf(d.createdAt), " \u00B7 ", words(d.words)] })] }) }, d.id))) })) })] }, book.id));
                }) })] }));
}

import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { BookCover } from "../components/BookCover";
import { Icon } from "../components/Icon";
import { Menu } from "../components/Menu";
import { authorLine, relativeTime } from "../lib/format";
import { highlightHex } from "../reader/settings";
import { KIND_LABEL, noteHeadline, personalTitle, placeLine } from "./noteInfo";
const KIND_ICON = {
    highlight: "highlight",
    annotation: "notePen",
    book_note: "bookOpen",
    personal: "noteLines",
};
/** The thin strip down a card's side: a highlight's own colour, or the kind's. */
function stripOf(n) {
    if (n.color)
        return highlightHex(n.color);
    return n.kind === "book_note" ? "#6f9a6a" : n.kind === "personal" ? "#d26a5c" : "var(--accent)";
}
/** "Oct 28, 2026". */
export function noteDate(iso) {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
/** What a card is called: the book it's from, or a personal note's title. */
export function cardTitle(n) {
    return n.book ? n.book.title : personalTitle(n);
}
export function Tags({ tags, most = 2, project }) {
    if (!tags?.length && !project)
        return null;
    tags = tags ?? [];
    return (_jsxs("span", { className: "note-tags", children: [project && (_jsxs("span", { className: "note-tag note-tag-book", title: `Belongs to ${project}`, children: [_jsx(Icon, { name: "pen", size: 11 }), " ", project] })), tags.slice(0, most).map((t) => (_jsx("span", { className: "note-tag", children: t }, t))), tags.length > most && _jsxs("span", { className: "note-tag", children: ["+", tags.length - most] })] }));
}
function Chosen({ on }) {
    return (_jsx("span", { className: `note-choose${on ? " is-on" : ""}`, "aria-hidden": true, children: on && _jsx(Icon, { name: "check", size: 13 }) }));
}
export function KindChip({ note }) {
    return _jsx("span", { className: `kind-chip kind-${note.kind}`, children: KIND_LABEL[note.kind] });
}
/** A book's cover, or a plain page for a personal note. */
export function NoteArt({ note, size }) {
    if (note.book)
        return _jsx(BookCover, { book: note.book, size: size });
    return (_jsx("span", { className: `cover cover-${size} note-art-personal`, "aria-hidden": true, children: _jsx(Icon, { name: "notes", size: size === "s" ? 16 : 26 }) }));
}
function NoteTitle({ note }) {
    return _jsx(_Fragment, { children: note.book ? note.book.title : personalTitle(note) });
}
function Words({ note, lines }) {
    const { quote, text } = noteHeadline(note);
    return (_jsxs("span", { className: "note-words", style: { ["--lines"]: lines }, children: [quote && (_jsxs("span", { className: "note-quote", style: note.color ? { ["--hl"]: highlightHex(note.color) } : undefined, children: ["\u201C", quote, "\u201D"] })), text && _jsx("span", { className: "note-body", children: text })] }));
}
function More({ note, items }) {
    return _jsx(Menu, { label: `More for this ${KIND_LABEL[note.kind].toLowerCase()}`, trigger: _jsx(Icon, { name: "moreVertical" }), items: items });
}
export function NoteList({ notes, selectedId, menuFor, onSelect, onOpen, chosen }) {
    return (_jsx("ul", { className: "note-rows", children: notes.map((n) => (_jsxs("li", { className: `note-row${n.id === selectedId ? " is-selected" : ""}${chosen?.has(n.id) ? " is-chosen" : ""}`, style: { ["--strip"]: stripOf(n) }, children: [chosen && _jsx(Chosen, { on: chosen.has(n.id) }), _jsxs("button", { type: "button", className: "note-row-open", onClick: () => onSelect(n), onDoubleClick: () => !chosen && onOpen(n), "aria-pressed": chosen ? chosen.has(n.id) : n.id === selectedId, children: [_jsx(NoteArt, { note: n, size: "s" }), _jsxs("span", { className: "note-row-text", children: [_jsxs("span", { className: "note-row-head", children: [_jsx("span", { className: "note-row-title", children: _jsx(NoteTitle, { note: n }) }), _jsx("span", { className: "note-row-place", children: placeLine(n) })] }), _jsxs("span", { className: "note-row-sub", children: [n.book && _jsx("span", { className: "note-row-author", children: authorLine(n.book.authors) }), _jsx("span", { className: "note-row-when", children: relativeTime(n.createdAt) })] }), _jsx(KindChip, { note: n }), _jsx(Words, { note: n, lines: 2 }), _jsx(Tags, { tags: n.tags, most: 4, project: n.project?.title })] })] }), n.pinnedAt && _jsx(Icon, { name: "pin", size: 15, className: "note-row-pin" }), !chosen && _jsx(More, { note: n, items: menuFor(n) })] }, n.id))) }));
}
export function NoteCards({ notes, selectedId, menuFor, onSelect, onOpen, chosen }) {
    return (_jsx("ul", { className: "note-cards", children: notes.map((n) => {
            const on = !!chosen?.has(n.id);
            return (_jsxs("li", { className: `note-card${n.id === selectedId ? " is-selected" : ""}${on ? " is-chosen" : ""}`, style: { ["--strip"]: stripOf(n) }, children: [_jsxs("button", { type: "button", className: "note-card-open", onClick: () => onSelect(n), onDoubleClick: () => !chosen && onOpen(n), "aria-pressed": chosen ? on : n.id === selectedId, children: [_jsx("span", { className: "note-card-icon", "aria-hidden": true, children: _jsx(Icon, { name: KIND_ICON[n.kind], size: 22 }) }), _jsxs("span", { className: "note-card-main", children: [_jsx("span", { className: "note-card-title", children: cardTitle(n) }), _jsx(Words, { note: n, lines: 3 }), _jsx(Tags, { tags: n.tags, project: n.project?.title }), _jsx("span", { className: "note-card-date", children: noteDate(n.updatedAt) })] }), n.book && (_jsx("span", { className: "note-card-thumb", children: _jsx(BookCover, { book: n.book, size: "s" }) }))] }), _jsx("span", { className: "note-card-corner", children: chosen ? (_jsx(Chosen, { on: on })) : (_jsxs(_Fragment, { children: [n.pinnedAt && _jsx(Icon, { name: "pin", size: 15, className: "note-card-pin" }), _jsx(More, { note: n, items: menuFor(n) })] })) })] }, n.id));
        }) }));
}
export function NoteTable({ notes, selectedId, menuFor, onSelect, onOpen, chosen }) {
    return (_jsxs("table", { className: "book-table note-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Note" }), _jsx("th", { children: "Type" }), _jsx("th", { children: "Book" }), _jsx("th", { children: "Tags" }), _jsx("th", { children: "Changed" }), _jsx("th", { "aria-label": "Actions" })] }) }), _jsx("tbody", { children: notes.map((n) => {
                    const { quote, text } = noteHeadline(n);
                    return (_jsxs("tr", { className: chosen?.has(n.id) || n.id === selectedId ? "is-selected" : undefined, onClick: () => onSelect(n), onDoubleClick: () => !chosen && onOpen(n), "aria-selected": chosen ? chosen.has(n.id) : n.id === selectedId, children: [_jsxs("td", { className: "note-table-words", children: [chosen && _jsx(Chosen, { on: chosen.has(n.id) }), n.pinnedAt && _jsx(Icon, { name: "pin", size: 13, className: "note-row-pin" }), n.color && _jsx("span", { className: "note-dot", style: { background: highlightHex(n.color) }, "aria-hidden": true }), n.kind === "personal" ? personalTitle(n) : (text ?? `“${quote}”`)] }), _jsx("td", { children: _jsx(KindChip, { note: n }) }), _jsx("td", { className: "muted", children: n.book?.title ?? "—" }), _jsx("td", { className: "muted", children: n.tags?.length ? n.tags.join(", ") : "—" }), _jsx("td", { className: "muted", children: noteDate(n.updatedAt) }), _jsx("td", { onClick: (e) => e.stopPropagation(), children: !chosen && _jsx(More, { note: n, items: menuFor(n) }) })] }, n.id));
                }) })] }));
}

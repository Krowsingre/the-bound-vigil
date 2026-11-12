import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState } from "react";
import { Icon } from "../components/Icon";
import { Menu } from "../components/Menu";
import { authorLine, relativeTime } from "../lib/format";
import { highlightHex } from "../reader/settings";
import { personalTitle, placeLine } from "./noteInfo";
import { KindChip, NoteArt } from "./NoteViews";
import { TagEditor } from "./TagsDialog";
/** The selected note in full, with your words editable in place. */
export function NotePanel({ note, related, menu, tags, onSave, onTags, onClose, onOpenInReader, onSelect, onViewAllForBook, }) {
    const [editing, setEditing] = useState(false);
    const [words, setWords] = useState(note.note ?? "");
    const [title, setTitle] = useState(note.title ?? "");
    const [busy, setBusy] = useState(false);
    const area = useRef(null);
    useEffect(() => {
        setEditing(false);
        setWords(note.note ?? "");
        setTitle(note.title ?? "");
    }, [note.id, note.note, note.title]);
    useEffect(() => {
        if (editing)
            area.current?.focus();
    }, [editing]);
    const save = async () => {
        setBusy(true);
        try {
            await onSave(note, words, note.kind === "personal" ? title : null);
            setEditing(false);
        }
        finally {
            setBusy(false);
        }
    };
    const personal = note.kind === "personal";
    const place = placeLine(note);
    const wordsLabel = personal ? "Note" : note.kind === "book_note" ? "About this book" : "My notes";
    // Cancelling throws the draft away, so editing again starts from the saved words.
    const cancel = () => {
        setEditing(false);
        setWords(note.note ?? "");
        setTitle(note.title ?? "");
    };
    return (_jsxs("aside", { className: "note-panel", "aria-label": "Open note", onKeyDown: (e) => e.key === "Escape" && !editing && onClose(), children: [_jsxs("div", { className: "note-panel-head", children: [_jsx(NoteArt, { note: note, size: "m" }), _jsxs("div", { className: "note-panel-book", children: [_jsx("h2", { children: note.book ? note.book.title : personalTitle(note) }), note.book && _jsx("p", { className: "muted", children: authorLine(note.book.authors) }), _jsx(KindChip, { note: note }), _jsx("p", { className: "note-panel-place", children: [place, relativeTime(note.createdAt)].filter(Boolean).join(" · ") })] }), _jsxs("div", { className: "note-panel-tools", children: [menu.length > 0 && _jsx(Menu, { label: "More for this note", trigger: _jsx(Icon, { name: "moreVertical" }), items: menu }), _jsx("button", { type: "button", className: "icon-btn", "aria-label": "Close the note", title: "Close", onClick: onClose, children: _jsx(Icon, { name: "close", size: 16 }) })] })] }), note.excerpt && (_jsxs("blockquote", { className: "note-panel-quote", style: { ["--hl"]: highlightHex(note.color) }, children: ["\u201C", note.excerpt, "\u201D"] })), _jsxs("section", { className: "note-panel-words", children: [_jsxs("div", { className: "note-panel-label", children: [_jsx("h3", { children: wordsLabel }), !editing && (_jsxs("button", { type: "button", className: "link-btn", onClick: () => setEditing(true), children: [_jsx(Icon, { name: "edit", size: 14 }), " ", note.note ? "Edit" : "Add your thoughts"] }))] }), editing ? (_jsxs("form", { className: "note-edit", onSubmit: (e) => {
                            e.preventDefault();
                            void save();
                        }, onKeyDown: (e) => {
                            if (e.key === "Escape")
                                cancel();
                            if (e.key === "Enter" && (e.ctrlKey || e.metaKey))
                                void save();
                        }, children: [personal && _jsx("input", { value: title, onChange: (e) => setTitle(e.target.value), placeholder: "Title (optional)", maxLength: 120 }), _jsx("textarea", { ref: area, value: words, onChange: (e) => setWords(e.target.value), rows: 7, placeholder: "Your thoughts\u2026" }), _jsxs("div", { className: "dialog-actions", children: [_jsx("button", { type: "button", className: "btn btn-quiet", onClick: cancel, disabled: busy, children: "Cancel" }), _jsx("button", { type: "submit", className: "btn btn-primary", disabled: busy, children: "Save" })] })] })) : note.note ? (_jsx("div", { className: "note-panel-text", children: note.note.split(/\n{2,}/).map((p, i) => (_jsx("p", { children: p }, i))) })) : (_jsx("p", { className: "muted note-panel-empty", children: "Nothing written yet." }))] }), _jsxs("section", { className: "note-panel-tags", children: [_jsx("div", { className: "note-panel-label", children: _jsx("h3", { children: "Tags" }) }), _jsx(TagEditor, { tags: note.tags ?? [], known: tags, onChange: (next) => void onTags(note, next) })] }), note.book && (_jsxs("button", { type: "button", className: "btn btn-primary note-open", onClick: () => onOpenInReader(note), children: [note.locator?.cfi ? "Open in Reader" : "Open the book", " ", _jsx(Icon, { name: "arrowRight", size: 16 })] })), note.book && related.length > 0 && (_jsxs("section", { className: "note-related", children: [_jsxs("div", { className: "note-panel-label", children: [_jsx("h3", { children: "Related notes" }), _jsxs("button", { type: "button", className: "link-btn", onClick: () => onViewAllForBook(note.book.id), children: ["View all ", _jsx(Icon, { name: "arrowRight", size: 14 })] })] }), _jsx("ul", { children: related.slice(0, 3).map((r) => (_jsx("li", { children: _jsxs("button", { type: "button", className: "note-related-item", onClick: () => onSelect(r), children: [_jsxs("span", { className: "note-related-head", children: [_jsx(KindChip, { note: r }), _jsx("span", { className: "muted", children: placeLine(r) })] }), _jsx("span", { className: "note-related-words", children: r.kind === "highlight" ? `“${r.excerpt}”` : r.note })] }) }, r.id))) })] }))] }));
}

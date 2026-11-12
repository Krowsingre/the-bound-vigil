import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// The Notes drawer beside a chapter. "This book" holds the notes that belong
// to the book being written (research and plans, kept out of the finished
// book), with a quick way to write one. "Everything" is all your highlights
// and notes, searchable. Choosing one puts it in where you're writing, as a
// quote with its book.
import { useEffect, useState } from "react";
import { api } from "../api";
import { Icon } from "../components/Icon";
import { useToast } from "../components/Toast";
import { noteHeadline, personalTitle } from "../notes/noteInfo";
import { PersonalNoteEditor } from "../notes/PersonalNoteEditor";
import { sourceLine } from "./fromNotes";
export function QuoteDrawer({ refreshKey, projectId, onInsert, onClose, }) {
    const toast = useToast();
    const [showing, setShowing] = useState("book");
    const [search, setSearch] = useState("");
    const [notes, setNotes] = useState(null);
    const [writing, setWriting] = useState(null);
    const [reload, setReload] = useState(0);
    useEffect(() => {
        let current = true;
        setNotes(null);
        const wait = setTimeout(() => {
            api
                .getNotes({
                tab: showing === "book" ? "personal" : "all",
                sort: "recent",
                search: search.trim() || null,
                bookId: null,
                colors: [],
                projectId: showing === "book" ? projectId : null,
            })
                .then((p) => current && setNotes(p.notes), () => current && setNotes([]));
        }, 200);
        return () => {
            current = false;
            clearTimeout(wait);
        };
    }, [search, refreshKey, showing, projectId, reload]);
    const saved = async (note, created) => {
        setWriting(null);
        try {
            if (created)
                await api.setNoteProject(note.id, projectId);
        }
        catch (error) {
            toast(`The note was saved in Personal notes. It couldn't be linked to this book: ${String(error)}`);
        }
        finally {
            setReload((n) => n + 1);
        }
    };
    const untie = async (n) => {
        try {
            await api.setNoteProject(n.id, null);
            setReload((r) => r + 1);
            toast("It's a note of its own again, in Scribe › Personal notes.");
        }
        catch (e) {
            toast(String(e));
        }
    };
    return (_jsxs("aside", { className: "quote-drawer", "aria-label": "Notes", children: [_jsxs("div", { className: "quote-drawer-head", children: [_jsx("strong", { children: "Notes" }), _jsx("button", { type: "button", className: "toolbar-button", "aria-label": "Close the notes", onClick: onClose, children: _jsx(Icon, { name: "close", size: 16 }) })] }), _jsx("div", { className: "segmented quote-drawer-switch", role: "radiogroup", "aria-label": "Which notes", children: [
                    ["book", "This book"],
                    ["all", "Everything"],
                ].map(([value, label]) => (_jsx("button", { type: "button", role: "radio", "aria-checked": showing === value, className: showing === value ? "is-active" : undefined, onClick: () => setShowing(value), children: label }, value))) }), _jsx("input", { className: "quote-drawer-search", type: "search", value: search, onChange: (e) => setSearch(e.target.value), placeholder: showing === "book" ? "Search this book's notes" : "Search notes and highlights", "aria-label": showing === "book" ? "Search this book's notes" : "Search notes and highlights" }), showing === "book" && (_jsxs("button", { type: "button", className: "btn btn-quiet quote-drawer-add", onClick: () => setWriting({}), children: [_jsx(Icon, { name: "plus", size: 15 }), " Write a note for this book"] })), writing && _jsx(PersonalNoteEditor, { initial: writing.note, refreshKey: refreshKey, onClose: () => setWriting(null), onSaved: (note, created) => void saved(note, created) }), _jsx("p", { className: "muted quote-drawer-hint", children: showing === "book" ? "Kept with this book, never in it. Choose one to put it in where you're writing." : "Choose one to put it in where you're writing." }), notes === null ? (_jsx("div", { className: "library-loading", "aria-busy": "true", "aria-label": "Loading the notes" })) : notes.length === 0 ? (_jsx("p", { className: "muted", children: search.trim()
                    ? "No notes match."
                    : showing === "book"
                        ? "No notes for this book yet. Write one above, or give a note to this book from its menu in Scribe › Personal notes."
                        : "Highlights and notes from your reading show up here." })) : (_jsx("ul", { className: "quote-drawer-list", children: notes.map((n) => {
                    const { quote, text } = noteHeadline(n);
                    return (_jsxs("li", { children: [_jsxs("button", { type: "button", onClick: () => onInsert(n), children: [quote && _jsxs("span", { className: "quote-drawer-quote", children: ["\u201C", quote, "\u201D"] }), text && _jsx("span", { className: "quote-drawer-text", children: text }), _jsx("span", { className: "muted quote-drawer-source", children: sourceLine(n) ?? personalTitle(n) })] }), n.kind === "personal" && (_jsx("button", { type: "button", className: "toolbar-button quote-drawer-edit", "aria-label": `Edit ${personalTitle(n)}`, onClick: () => setWriting({ note: n }), children: _jsx(Icon, { name: "edit", size: 14 }) })), showing === "book" && (_jsx("button", { type: "button", className: "toolbar-button quote-drawer-untie", "aria-label": "Take it off this book", title: "Take it off this book", onClick: () => void untie(n), children: _jsx(Icon, { name: "close", size: 14 }) }))] }, n.id));
                }) }))] }));
}

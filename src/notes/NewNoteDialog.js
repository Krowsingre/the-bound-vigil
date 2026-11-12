import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { api } from "../api";
import { BookCover } from "../components/BookCover";
import { Icon } from "../components/Icon";
import { authorLine } from "../lib/format";
/** Writing a note about a whole book. */
export function NewNoteDialog({ book: initialBook = null, onSaved, onCancel, }) {
    const [book, setBook] = useState(initialBook);
    const [text, setText] = useState("");
    const [error, setError] = useState(null);
    const [busy, setBusy] = useState(false);
    const save = async () => {
        if (!text.trim())
            return setError("Write something first.");
        if (!book)
            return setError("Pick the book this note is about.");
        setBusy(true);
        try {
            onSaved(await api.saveBookNote(book.id, null, text));
        }
        catch (e) {
            setError(String(e));
            setBusy(false);
        }
    };
    return (_jsx("div", { className: "dialog-backdrop", onPointerDown: (e) => e.target === e.currentTarget && !busy && onCancel(), children: _jsxs("form", { className: "dialog new-note-dialog", role: "dialog", "aria-label": "New book note", onSubmit: (e) => {
                e.preventDefault();
                void save();
            }, onKeyDown: (e) => {
                if (e.key === "Escape" && !busy)
                    onCancel();
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey))
                    void save();
            }, children: [_jsx("h2", { children: "New note about a book" }), book ? (_jsxs("div", { className: "picked-book", children: [_jsx(BookCover, { book: book, size: "s" }), _jsxs("span", { children: [_jsx("strong", { children: book.title }), _jsx("span", { className: "muted", children: authorLine(book.authors) })] }), !initialBook && (_jsx("button", { type: "button", className: "link-btn", onClick: () => setBook(null), children: "Change" }))] })) : (_jsx(BookPicker, { onPick: setBook })), book && (_jsxs("label", { className: "field", children: [_jsx("span", { children: "Your thoughts on the whole book" }), _jsx("textarea", { value: text, onChange: (e) => setText(e.target.value), rows: 8, autoFocus: true, placeholder: "Write freely\u2026" })] })), error && (_jsx("p", { className: "form-error", role: "alert", children: error })), _jsxs("div", { className: "dialog-actions", children: [_jsx("button", { type: "button", className: "btn btn-quiet", onClick: onCancel, disabled: busy, children: "Cancel" }), _jsx("button", { type: "submit", className: "btn btn-primary", disabled: busy, children: "Save note" })] })] }) }));
}
function BookPicker({ onPick }) {
    const [search, setSearch] = useState("");
    const [books, setBooks] = useState(null);
    useEffect(() => {
        let current = true;
        const t = setTimeout(() => {
            api
                .getLibrary({ shelf: "all", sort: "recently_opened", search: search.trim() || null, formats: [], location: null, page: 0, pageSize: 50 })
                .then((p) => current && setBooks(p.books), () => current && setBooks([]));
        }, 150);
        return () => {
            current = false;
            clearTimeout(t);
        };
    }, [search]);
    return (_jsxs("div", { className: "book-picker", children: [_jsxs("label", { className: "search", children: [_jsx(Icon, { name: "search", size: 16 }), _jsx("input", { autoFocus: true, type: "search", placeholder: "Which book?", value: search, onChange: (e) => setSearch(e.target.value), "aria-label": "Find the book" })] }), _jsx("ul", { className: "add-books-list book-picker-list", children: books === null ? (_jsx("li", { className: "library-loading", "aria-busy": "true" })) : books.length === 0 ? (_jsx("li", { className: "muted", children: "No books match." })) : (books.map((b) => (_jsx("li", { children: _jsxs("button", { type: "button", className: "add-book", onClick: () => onPick(b), children: [_jsx(BookCover, { book: b, size: "s" }), _jsxs("span", { className: "add-book-text", children: [_jsx("span", { className: "add-book-title", children: b.title }), _jsx("span", { className: "muted", children: authorLine(b.authors) })] })] }) }, b.id)))) })] }));
}

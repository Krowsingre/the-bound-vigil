import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// Pairing an audiobook with its ebook or document, from either side, so you
// can read along as it plays. Books with the same title come first.
import { useEffect, useState } from "react";
import { api } from "../api";
import { BookCover } from "../components/BookCover";
import { useToast } from "../components/Toast";
import { isAudio, isDocument } from "../lib/queryBooks";
import { lookForPairs } from "../readAlong/lineUp";
const fold = (text) => text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/^(the|a|an) /, "")
    .trim();
/** What's said when a document is paired: TBV can't follow one. */
export const DOCUMENT_PAIR_NOTE = "With a document, the audiobook plays alongside but TBV can't follow it: you turn the pages yourself.";
export function LinkEbook({ audiobook, onClose, }) {
    return _jsx(PairDialog, { book: audiobook, onClose: (other) => onClose(other && { id: other.id, name: other.title }) });
}
/**
 * Chooses the other half of a pair for `book`: ebooks and documents for an
 * audiobook, audiobooks for an ebook or document.
 */
export function PairDialog({ book, onClose }) {
    const toast = useToast();
    const listening = isAudio(book.format);
    const [search, setSearch] = useState(book.title);
    const [books, setBooks] = useState(null);
    useEffect(() => {
        let current = true;
        const query = {
            shelf: "all",
            sort: "title",
            search: search.trim() || null,
            formats: [],
            location: null,
            page: 0,
            pageSize: 40,
        };
        const wait = setTimeout(() => {
            const kinds = listening ? ["books", "documents"] : ["audiobooks"];
            Promise.all(kinds.map((kind) => api.getLibrary({ ...query, kind })))
                .then((pages) => {
                if (!current)
                    return;
                const title = fold(book.title);
                const found = pages.flatMap((p) => p.books).filter((b) => b.id !== book.id && isAudio(b.format) !== listening);
                setBooks(found.sort((a, b) => Number(fold(b.title) === title) - Number(fold(a.title) === title)));
            }, () => current && setBooks([]));
        }, 200);
        return () => {
            current = false;
            clearTimeout(wait);
        };
    }, [search, book.id, book.title, listening]);
    const link = (other) => {
        const [audio, text] = listening ? [book, other] : [other, book];
        return api.linkEbook(audio.id, text.id).then(() => {
            lookForPairs();
            toast(`“${audio.title}” is paired with “${text.title}”.` + (isDocument(text.format) ? ` ${DOCUMENT_PAIR_NOTE}` : ""));
            onClose(other);
        }, (e) => toast(`Couldn't pair them: ${String(e)}`));
    };
    return (_jsx("div", { className: "dialog-backdrop", onPointerDown: (e) => e.target === e.currentTarget && onClose(), children: _jsxs("div", { className: "dialog link-ebook", role: "dialog", "aria-label": listening ? "Pair with an ebook or document" : "Pair with an audiobook", onKeyDown: (e) => e.key === "Escape" && onClose(), children: [_jsx("h2", { children: listening ? "Read along with an ebook or document" : "Listen along with an audiobook" }), _jsx("p", { className: "muted add-dialog-book", children: listening
                        ? `Choose the ebook or document of “${book.title}”. While it plays, an ebook follows along page by page.`
                        : `Choose the audiobook of “${book.title}”. While it plays, ${isDocument(book.format) ? "you turn the pages yourself." : "the book follows along page by page."}` }), (listening || isDocument(book.format)) && _jsx("p", { className: "muted add-dialog-book", children: DOCUMENT_PAIR_NOTE }), _jsxs("label", { className: "field", children: [_jsx("span", { children: listening ? "Search your books and documents" : "Search your audiobooks" }), _jsx("input", { autoFocus: true, value: search, onChange: (e) => setSearch(e.target.value) })] }), _jsx("div", { className: "fetch-results", children: books === null ? (_jsx("div", { className: "library-loading", "aria-label": "Searching" })) : books.length === 0 ? (_jsxs("p", { className: "muted", children: [listening ? "No books or documents match." : "No audiobooks match.", " Import it first, or try fewer words."] })) : (books.map((b) => (_jsxs("button", { type: "button", className: "fetch-result", onClick: () => void link(b), children: [_jsx(BookCover, { book: b, size: "s" }), _jsxs("span", { className: "fetch-result-text", children: [_jsx("strong", { children: b.title }), _jsx("span", { className: "muted", children: [b.authors.join(", "), b.format.toUpperCase()].filter(Boolean).join(" · ") })] })] }, b.id)))) }), _jsx("div", { className: "dialog-actions", children: _jsx("button", { type: "button", className: "btn btn-quiet", onClick: () => onClose(), children: "Cancel" }) })] }) }));
}
let pairListener = null;
/** Opens the pairing dialog for a book, from its menu anywhere. */
export function askPair(book) {
    pairListener?.(book);
}
/** Where `askPair` draws its dialog; one, in App. */
export function PairHost() {
    const [book, setBook] = useState(null);
    useEffect(() => {
        pairListener = setBook;
        return () => {
            pairListener = null;
        };
    }, []);
    return book ? _jsx(PairDialog, { book: book, onClose: () => setBook(null) }) : null;
}

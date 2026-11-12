import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
// "Send to e-reader…": any book menu, or the Library's Select mode, asks for
// this dialog; the one host in App shows it. Books go one at a time after
// the dialog closes, and a toast says how it went.
import { useCallback, useEffect, useState } from "react";
import { api, isApp } from "../api";
import { Icon } from "../components/Icon";
import { useToast } from "../components/Toast";
import { destination, DESKTOP_ONLY, problemFor, summary, targetNote } from "./ereaders";
let listener = null;
export function askSendToEreader(books) {
    if (books.length)
        listener?.(books);
}
/** Sends each book that can go, one after another, and sums it up. */
async function sendAll(target, books) {
    const results = [];
    for (const book of books) {
        const problem = problemFor(target, book);
        if (problem) {
            results.push({ title: book.title, outcome: "failed", reason: problem });
            continue;
        }
        try {
            if (target.kind === "email") {
                await api.sendToKindle(book.id);
                results.push({ title: book.title, outcome: "sent" });
            }
            else {
                const copied = await api.copyToEreader(book.id, target.reader.root);
                results.push({ title: book.title, outcome: copied.alreadyThere ? "already" : "sent" });
            }
        }
        catch (e) {
            results.push({ title: book.title, outcome: "failed", reason: String(e).replace(/^Error: /, "") });
        }
    }
    return results;
}
export function SendToEreaderHost({ onSetUp }) {
    const [books, setBooks] = useState(null);
    const toast = useToast();
    useEffect(() => {
        listener = setBooks;
        return () => {
            listener = null;
        };
    }, []);
    if (!books)
        return null;
    return (_jsx(SendDialog, { books: books, onClose: () => setBooks(null), onSetUp: () => {
            setBooks(null);
            onSetUp();
        }, onSend: (target) => {
            setBooks(null);
            if (!isApp)
                return toast(DESKTOP_ONLY);
            const what = books.length === 1 ? `“${books[0].title}”` : `${books.length} books`;
            toast(`Sending ${what} to ${destination(target)}…`);
            void sendAll(target, books).then((results) => toast(summary(target, results)));
        } }));
}
function SendDialog({ books, onClose, onSetUp, onSend, }) {
    const [readers, setReaders] = useState(null);
    const [email, setEmail] = useState(null);
    const [looking, setLooking] = useState(false);
    const look = useCallback(() => {
        setLooking(true);
        Promise.all([api.listEreaders(), api.kindleEmailSettings()]).then(([found, mail]) => {
            setReaders(found);
            setEmail(mail);
            setLooking(false);
        }, () => {
            setReaders([]);
            setLooking(false);
        });
    }, []);
    useEffect(look, [look]);
    const named = readers?.filter((r) => r.kind !== "other") ?? [];
    const others = readers?.filter((r) => r.kind === "other") ?? [];
    const choice = (target, icon, name) => {
        const note = targetNote(target, books);
        return (_jsx("li", { children: _jsxs("button", { type: "button", className: "send-choice", disabled: note.blocked, onClick: () => onSend(target), children: [_jsx(Icon, { name: icon, size: 20 }), _jsxs("span", { className: "send-choice-text", children: [_jsx("span", { className: "send-choice-name", children: name }), _jsx("span", { className: note.blocked ? "send-choice-note is-blocked" : "send-choice-note", children: note.text })] })] }) }, target.kind === "cable" ? target.reader.root : "email"));
    };
    return (_jsx("div", { className: "dialog-backdrop", onPointerDown: (e) => e.target === e.currentTarget && onClose(), children: _jsxs("div", { className: "dialog send-dialog", role: "dialog", "aria-label": "Send to e-reader", onKeyDown: (e) => e.key === "Escape" && onClose(), children: [_jsx("h2", { children: "Send to e-reader" }), _jsx("p", { className: "muted add-dialog-book", children: books.length === 1 ? books[0].title : `${books.length} books` }), !isApp && _jsx("p", { className: "send-desktop-only", children: DESKTOP_ONLY }), readers === null ? (_jsx("div", { className: "library-loading", "aria-busy": "true", "aria-label": "Looking for e-readers" })) : (_jsxs(_Fragment, { children: [_jsxs("ul", { className: "send-list", children: [named.map((r) => choice({ kind: "cable", reader: r }, "ereader", r.name)), email && choice({ kind: "email", kindle: email.kindle }, "email", "Kindle by email")] }), !named.length && (_jsx("p", { className: "muted send-empty", children: "No e-readers are plugged in. Connect yours with its cable; if it asks, choose to connect it to the computer." })), others.length > 0 && (_jsxs(_Fragment, { children: [_jsx("h3", { className: "send-heading", children: "Other drives" }), _jsx("p", { className: "settings-row-hint", children: "These have a books folder. Choose one only if it's your e-reader." }), _jsx("ul", { className: "send-list", children: others.map((r) => choice({ kind: "cable", reader: r }, "folder", r.name)) })] })), !email && (_jsxs("p", { className: "send-setup", children: [_jsx(Icon, { name: "email", size: 16 }), " Send to your Kindle by email, even EPUB books.", " ", _jsx("button", { type: "button", className: "link-button", onClick: onSetUp, children: "Set it up" })] }))] })), _jsxs("div", { className: "dialog-actions", children: [_jsxs("button", { type: "button", className: "btn btn-quiet", disabled: looking, onClick: look, children: [_jsx(Icon, { name: "sync", size: 16 }), " ", looking ? "Looking…" : "Look again"] }), _jsx("button", { type: "button", className: "btn btn-primary", onClick: onClose, children: "Close" })] })] }) }));
}

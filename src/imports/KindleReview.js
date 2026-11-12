import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { RememberedDetails } from "../components/RememberedDetails";
// The review after choosing a list of Kindle books in Import books (a .json
// file): the books found in the library, the close ones to tick, and how
// many aren't in it. Nothing changes until Tag is pressed: then the books
// get the tag Kindle and, if wanted, the ones read on Kindle are marked Read.
// The rest wait in the Compendium as "Kindle, not in library".
import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { Icon } from "../components/Icon";
import { useToast } from "../components/Toast";
const books = (n) => `${n.toLocaleString()} ${n === 1 ? "book" : "books"}`;
const byLine = (title, authors) => {
    const who = Array.isArray(authors) ? authors.join(", ") : authors;
    return who ? `${title} by ${who}` : title;
};
/** Tells the Compendium's Kindle card that the list changed. */
export const KINDLE_CHANGED = "tbv:kindle-changed";
/** Whether a chosen file is a list of Kindle books rather than a book. */
export const isKindleList = (path) => /\.json$/i.test(path);
export function KindleReviewDialog({ review, imported, onClose }) {
    const toast = useToast();
    const [yes, setYes] = useState(new Set());
    const [markRead, setMarkRead] = useState(review.markRead);
    const [busy, setBusy] = useState(false);
    const first = useRef(null);
    useEffect(() => first.current?.focus(), []);
    const tagging = new Set([...review.matched, ...review.probable.filter((p) => yes.has(p.asin))].filter((m) => !m.borrowed).map((m) => m.bookId)).size;
    const nothing = review.matched.length === 0 && review.probable.length === 0;
    const apply = async () => {
        setBusy(true);
        try {
            const done = await api.applyKindle([...yes], markRead);
            const parts = [
                done.tagged > 0 ? `Tagged ${books(done.tagged)} Kindle.` : "No new books to tag.",
                done.markedRead > 0 && `${books(done.markedRead)} marked Read.`,
                done.missing > 0 && `${books(done.missing)} are in Kindle, not in library.`,
            ].filter(Boolean);
            toast(parts.join(" "));
            window.dispatchEvent(new Event(KINDLE_CHANGED));
            onClose(true);
        }
        catch (e) {
            toast(`That didn't work: ${String(e)}`);
            setBusy(false);
        }
    };
    return (_jsx("div", { className: "dialog-backdrop", onPointerDown: (e) => e.target === e.currentTarget && onClose(false), children: _jsxs("div", { className: "dialog kindle-review", role: "dialog", "aria-label": "Your Kindle books", onKeyDown: (e) => e.key === "Escape" && onClose(false), children: [_jsx("h2", { children: "Your Kindle books" }), imported && (_jsxs("p", { className: "muted", children: [books(imported.total), " in the file", imported.newPurchases < imported.total && `, ${imported.newPurchases.toLocaleString()} of them new`, ".", imported.borrowed > 0 && ` ${books(imported.borrowed)} were borrowed, not bought, so they won't be tagged or listed.`] })), nothing ? (_jsxs("p", { children: ["No books in your library are waiting to be matched. ", review.missing > 0 && `${books(review.missing)} are in the Compendium as Kindle, not in library.`] })) : (_jsxs(_Fragment, { children: [review.matched.length > 0 && (_jsxs(RememberedDetails, { disclosure: "kindle.inLibrary", className: "kindle-group", children: [_jsxs("summary", { children: [_jsx(Icon, { name: "check", size: 15 }), " ", _jsx("strong", { children: "In your library" }), " ", books(review.matched.length), ", same title and author"] }), _jsx("ul", { className: "kindle-list", children: review.matched.map((m) => (_jsx("li", { children: byLine(m.bookTitle, m.bookAuthors) }, m.asin))) })] })), review.probable.length > 0 && (_jsxs("div", { className: "kindle-group", children: [_jsxs("div", { className: "kindle-group-head", children: [_jsxs("span", { children: [_jsx("strong", { children: "Probably in your library" }), " ", books(review.probable.length), ". Tick each one that's the same book."] }), _jsx("button", { type: "button", className: "link-btn", onClick: () => setYes(yes.size === review.probable.length ? new Set() : new Set(review.probable.map((p) => p.asin))), children: yes.size === review.probable.length ? "Untick all" : "Tick all" })] }), _jsx("ul", { className: "kindle-list kindle-probable", children: review.probable.map((p) => (_jsx(ProbableRow, { match: p, checked: yes.has(p.asin), onChange: (on) => {
                                            const next = new Set(yes);
                                            if (on)
                                                next.add(p.asin);
                                            else
                                                next.delete(p.asin);
                                            setYes(next);
                                        } }, p.asin))) })] })), _jsxs("p", { className: "kindle-group kindle-missing-line", children: [_jsx(Icon, { name: "collections", size: 15 }), " ", _jsx("strong", { children: "Not in your library" }), " ", books(review.missing), ". They'll wait in the Compendium as Kindle, not in library, and leave it by themselves when you add them."] }), review.readToMark > 0 && (_jsxs("label", { className: "kindle-mark-read", children: [_jsx("input", { type: "checkbox", checked: markRead, onChange: (e) => setMarkRead(e.target.checked) }), _jsxs("span", { children: ["Mark the ", books(review.readToMark), " you've read on Kindle as Read", _jsx("span", { className: "muted", children: " Books you've already started or finished in TBV stay as they are." })] })] }))] })), _jsx("div", { className: "dialog-actions", children: nothing ? (_jsx("button", { ref: first, type: "button", className: "btn btn-primary", onClick: () => onClose(false), children: "Done" })) : (_jsxs(_Fragment, { children: [_jsx("button", { type: "button", className: "btn btn-quiet", onClick: () => onClose(false), disabled: busy, children: "Later" }), _jsx("button", { ref: first, type: "button", className: "btn btn-primary", onClick: () => void apply(), disabled: busy, children: busy ? "Tagging…" : `Tag ${books(tagging)} Kindle` })] })) })] }) }));
}
function ProbableRow({ match, checked, onChange }) {
    return (_jsx("li", { children: _jsxs("label", { children: [_jsx("input", { type: "checkbox", checked: checked, onChange: (e) => onChange(e.target.checked) }), _jsxs("span", { children: [_jsxs("span", { className: "kindle-probable-kindle", children: [_jsx("span", { className: "kindle-label", children: "Kindle" }), " ", byLine(match.title, match.author)] }), _jsxs("span", { className: "kindle-probable-yours muted", children: [_jsx("span", { className: "kindle-label", children: "Yours" }), " ", byLine(match.bookTitle, match.bookAuthors)] })] })] }) }));
}

import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
// A book's details: the other books of its series, in order. Books not in
// the library are greyed out, as on the series' own page.
import { useEffect, useState } from "react";
import { api, isHome, isWeb } from "../api";
import { BookCover } from "../components/BookCover";
import { Icon } from "../components/Icon";
import { useToast } from "../components/Toast";
import { showBookDetails } from "./openDetails";
const position = (i) => ("owned" in i ? i.owned.position : i.missing.position);
export function SeriesRow({ name, author, bookId, refreshKey, }) {
    const toast = useToast();
    const [review, setReview] = useState(null);
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        let current = true;
        api.seriesReview(name).then((r) => current && setReview(r), () => current && setReview(null));
        return () => {
            current = false;
        };
    }, [name, refreshKey]);
    if (!review)
        return null;
    const items = [
        ...review.ownedBooks.map((owned) => ({ owned })),
        ...review.missing.filter((m) => !m.hidden).map((missing) => ({ missing })),
    ].sort((a, b) => (position(a) ?? 1e9) - (position(b) ?? 1e9));
    const canLook = !isWeb && !isHome;
    if (items.length <= 1 && (review.checkedAt || !canLook))
        return null;
    const find = () => {
        setBusy(true);
        api
            .findSeriesBooks(name, author)
            .then(setReview, (e) => toast(String(e).replace(/^Error: /, "")))
            .finally(() => setBusy(false));
    };
    return (_jsxs("section", { className: "details-section", children: [_jsxs("h2", { children: ["In this series", review.checkedAt && (_jsxs("span", { className: "details-origin", children: ["You have ", review.owned, " of ", review.listed] }))] }), _jsx("ul", { className: "series-strip", children: items.map((item) => "owned" in item ? (_jsx("li", { className: item.owned.book.id === bookId ? "is-current" : undefined, children: _jsxs("button", { type: "button", className: "series-strip-book", onClick: () => showBookDetails(item.owned.book.id), disabled: item.owned.book.id === bookId, children: [_jsx(BookCover, { book: item.owned.book, size: "s" }), _jsx("span", { className: "series-strip-title", title: item.owned.book.title, children: item.owned.book.title }), _jsx("span", { className: "muted", children: item.owned.position !== null ? `Book ${item.owned.position}` : "No number" })] }) }, item.owned.book.id)) : (_jsxs("li", { className: "is-missing", children: [_jsx(MissingCover, { book: item.missing }), _jsx("span", { className: "series-strip-title", title: item.missing.title, children: item.missing.title }), _jsxs("span", { className: "muted", children: [item.missing.position !== null ? `Book ${item.missing.position}` : "No number", item.missing.read ? " · Read" : ""] })] }, `missing-${item.missing.key}`))) }), !review.checkedAt && canLook && (_jsxs("button", { type: "button", className: "view-all", disabled: busy, onClick: find, children: [_jsx(Icon, { name: "search", size: 14 }), " ", busy ? "Looking…" : "Find the rest of the series online"] }))] }));
}
function MissingCover({ book }) {
    const [failed, setFailed] = useState(false);
    return (_jsx("div", { className: "cover cover-s missing-cover", title: `${book.title} (not in your library)`, children: book.coverUrl && !failed ? (_jsx("img", { className: "private-picture", src: book.coverUrl, alt: "", draggable: false, onError: () => setFailed(true) })) : (_jsx("div", { className: "cover-generated missing-blank", children: _jsx("span", { className: "cover-title", children: book.title }) })) }));
}

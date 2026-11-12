import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { BookCover } from "../components/BookCover";
import { Icon } from "../components/Icon";
import { Menu } from "../components/Menu";
import { ProgressBar } from "../components/ProgressBar";
import { Stars } from "../components/StarRating";
import { authorLine, percent } from "../lib/format";
import { formatLabel } from "../lib/queryBooks";
import { bookContextMenu, bookMenu, clickBook } from "../home/bookActions";
/** A series stack while choosing: its tick, and whether a click chooses it. */
function pickedSeries(name, selection) {
    if (!selection?.toggleSeries)
        return null;
    const on = !!selection.hasSeries?.(name);
    return {
        on,
        mark: (_jsx("span", { className: `select-mark${on ? " is-on" : ""}`, "aria-hidden": true, children: on && _jsx(Icon, { name: "check", size: 14 }) })),
        toggle: () => selection.toggleSeries(name),
    };
}
const press = (book, actions, selection, books, shift) => selection ? selection.toggle(book, shift ? books : undefined) : clickBook(book, actions);
/** The tick on a chosen book, and the props that say it's chosen. */
function picked(book, selection) {
    if (!selection)
        return { mark: null, props: {} };
    const on = selection.has(book.id);
    return {
        mark: (_jsx("span", { className: `select-mark${on ? " is-on" : ""}`, "aria-hidden": true, children: on && _jsx(Icon, { name: "check", size: 14 }) })),
        props: { "aria-pressed": on },
    };
}
const STATUS = { unread: "Unread", in_progress: "In progress", read: "Read", dropped: "Dropped" };
function seriesLine(book) {
    if (!book.series)
        return null;
    return book.seriesIndex != null ? `${book.series} #${book.seriesIndex}` : book.series;
}
function Marks({ book }) {
    return (_jsxs(_Fragment, { children: [book.pinnedAt && (_jsx("span", { className: "mark", title: "Pinned to the top of the Archive", children: _jsx(Icon, { name: "pin", size: 13, label: "Pinned" }) })), book.favorite && (_jsx("span", { className: "mark", title: "Favourite", children: _jsx(Icon, { name: "heart", size: 13, label: "Favourite" }) })), book.wantToRead && (_jsx("span", { className: "mark", title: "Up next", children: _jsx(Icon, { name: "bookmark", size: 13, label: "Up next" }) }))] }));
}
function MoreMenu({ book, actions }) {
    return _jsx(Menu, { label: `More for ${book.title}`, trigger: _jsx(Icon, { name: "more" }), items: bookMenu(book, actions) });
}
function Progress({ book }) {
    if (book.status !== "in_progress")
        return null;
    return (_jsxs("span", { className: "progress-line", children: [_jsx(ProgressBar, { value: book.totalProgression }), _jsx("span", { className: "num", children: percent(book.totalProgression) })] }));
}
export function BookGrid({ books, actions, selection, seriesCounts, seriesPublished, seriesCovers, onOpenSeries, seriesMenu, showStatus }) {
    return (_jsx("ul", { className: `book-grid${selection ? " is-selecting" : ""}`, children: books.map((book) => {
            const count = seriesCounts?.[book.id];
            if (count && book.series && onOpenSeries) {
                const name = book.series.trim();
                const cover = seriesCovers?.[book.id] ?? book;
                const pick = pickedSeries(name, selection);
                return (_jsxs("li", { className: `grid-card series-stack${pick?.on ? " is-selected" : ""}`, children: [_jsxs("button", { type: "button", className: "grid-open", "aria-label": pick ? `Choose series ${name}` : "Open series " + name, "aria-pressed": pick ? pick.on : undefined, onClick: () => (pick ? pick.toggle() : onOpenSeries(name)), children: [_jsx(BookCover, { book: cover, seriesCount: count, seriesPublished: seriesPublished?.[book.id] }, cover.id), pick?.mark] }), _jsxs("div", { className: "grid-caption", children: [_jsx("div", { className: "grid-text", children: _jsx("span", { className: "book-title", children: name }) }), seriesMenu && _jsx(Menu, { label: "More for " + name, trigger: _jsx(Icon, { name: "more" }), items: seriesMenu(name) })] })] }, book.id));
            }
            const { mark, props } = picked(book, selection);
            return (_jsxs("li", { className: `grid-card${selection?.has(book.id) ? " is-selected" : ""}`, ...bookContextMenu(book, actions), children: [_jsxs("button", { type: "button", className: "grid-open", onClick: (e) => press(book, actions, selection, books, e.shiftKey), title: `${book.title}, ${authorLine(book.authors)}`, ...props, children: [_jsx(BookCover, { book: book }), mark] }), _jsxs("div", { className: "grid-caption", children: [_jsxs("div", { className: "grid-text", children: [_jsx("span", { className: "book-title", children: book.title }), _jsxs("span", { className: "book-author", children: [authorLine(book.authors), _jsx(Marks, { book: book })] }), showStatus && _jsx("span", { className: "book-author", children: [seriesLine(book), STATUS[book.status]].filter(Boolean).join(" · ") })] }), _jsx(MoreMenu, { book: book, actions: actions })] }), _jsx(Progress, { book: book })] }, book.id));
        }) }));
}
export function BookList({ books, actions, selection, seriesCounts, seriesPublished, seriesCovers, onOpenSeries, seriesMenu }) {
    return (_jsx("ul", { className: "book-list", children: books.map((book) => {
            const count = seriesCounts?.[book.id];
            const name = book.series?.trim();
            if (count && name && onOpenSeries) {
                const cover = seriesCovers?.[book.id] ?? book;
                const pick = pickedSeries(name, selection);
                return _jsxs("li", { className: `list-row series-list-row${pick?.on ? " is-selected" : ""}`, children: [_jsxs("button", { type: "button", className: "list-open", "aria-label": pick ? `Choose series ${name}` : `Open series ${name}`, "aria-pressed": pick ? pick.on : undefined, onClick: () => (pick ? pick.toggle() : onOpenSeries(name)), children: [pick?.mark, _jsx(BookCover, { book: cover, size: "s", seriesCount: count, seriesPublished: seriesPublished?.[book.id] }, cover.id), _jsx("span", { className: "list-text", children: _jsx("span", { className: "book-title", children: name }) })] }), seriesMenu && _jsx(Menu, { label: `More for ${name}`, trigger: _jsx(Icon, { name: "more" }), items: seriesMenu(name) })] }, book.id);
            }
            const { mark, props } = picked(book, selection);
            return (_jsxs("li", { className: `list-row${selection?.has(book.id) ? " is-selected" : ""}`, ...bookContextMenu(book, actions), children: [_jsxs("button", { type: "button", className: "list-open", onClick: (e) => press(book, actions, selection, books, e.shiftKey), ...props, children: [mark, _jsx(BookCover, { book: book, size: "s" }), _jsxs("span", { className: "list-text", children: [_jsx("span", { className: "book-title", children: book.title }), _jsxs("span", { className: "book-author", children: [authorLine(book.authors), _jsx(Marks, { book: book })] }), seriesLine(book) && _jsx("span", { className: "book-author", children: seriesLine(book) }), book.tags.length > 0 && _jsx("span", { className: "book-tags", children: book.tags.join(" · ") }), _jsx(Stars, { value: book.rating, size: 13 })] })] }), _jsx("span", { className: "list-status", children: book.status === "in_progress" ? _jsx(Progress, { book: book }) : _jsx("span", { className: "muted", children: STATUS[book.status] }) }), _jsx("span", { className: "list-format muted", children: formatLabel(book.format) }), _jsx("span", { className: "list-added muted", children: new Date(book.addedAt).toLocaleDateString() }), _jsx(MoreMenu, { book: book, actions: actions })] }, book.id));
        }) }));
}
export function BookTable({ books, actions, selection, seriesCounts, seriesPublished, seriesCovers, onOpenSeries, seriesMenu }) {
    return (_jsxs("table", { className: "book-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { scope: "col", children: "Title" }), _jsx("th", { scope: "col", children: "Author" }), _jsx("th", { scope: "col", children: "Series" }), _jsx("th", { scope: "col", children: "Status" }), _jsx("th", { scope: "col", children: "Rating" }), _jsx("th", { scope: "col", children: "Format" }), _jsx("th", { scope: "col", children: "Added" }), _jsx("th", { scope: "col", children: _jsx("span", { className: "visually-hidden", children: "Actions" }) })] }) }), _jsx("tbody", { children: books.map((book) => {
                    const count = seriesCounts?.[book.id];
                    const name = book.series?.trim();
                    const pick = count && name ? pickedSeries(name, selection) : null;
                    if (count && name && onOpenSeries)
                        return _jsxs("tr", { className: `series-table-row${pick?.on ? " is-selected" : ""}`, children: [_jsx("td", { colSpan: 7, children: _jsxs("button", { type: "button", "aria-label": pick ? `Choose series ${name}` : `Open series ${name}`, "aria-pressed": pick ? pick.on : undefined, className: "table-title series-table-open", onClick: () => (pick ? pick.toggle() : onOpenSeries(name)), children: [pick?.mark, _jsx(BookCover, { book: seriesCovers?.[book.id] ?? book, size: "s", seriesCount: count, seriesPublished: seriesPublished?.[book.id] }), name] }) }), _jsx("td", { children: seriesMenu && _jsx(Menu, { label: `More for ${name}`, trigger: _jsx(Icon, { name: "more" }), items: seriesMenu(name) }) })] }, book.id);
                    const { mark, props } = picked(book, selection);
                    return (_jsxs("tr", { className: selection?.has(book.id) ? "is-selected" : undefined, ...bookContextMenu(book, actions), children: [_jsxs("td", { children: [_jsxs("button", { type: "button", className: "table-title", onClick: (e) => press(book, actions, selection, books, e.shiftKey), ...props, children: [mark, book.title] }), _jsx(Marks, { book: book }), book.availability !== "local" && (_jsx("span", { className: "mark", title: book.availability === "cloud" ? "In the cloud" : "File missing", children: _jsx(Icon, { name: book.availability === "cloud" ? "cloud" : "warning", size: 13 }) }))] }), _jsx("td", { children: authorLine(book.authors) }), _jsx("td", { className: "muted", children: seriesLine(book) ?? "" }), _jsx("td", { className: "num", children: book.status === "in_progress" ? percent(book.totalProgression) : STATUS[book.status] }), _jsx("td", { children: _jsx(Stars, { value: book.rating, size: 12 }) }), _jsx("td", { className: "muted", children: formatLabel(book.format) }), _jsx("td", { className: "muted num", children: new Date(book.addedAt).toLocaleDateString() }), _jsx("td", { children: _jsx(MoreMenu, { book: book, actions: actions }) })] }, book.id));
                }) })] }));
}

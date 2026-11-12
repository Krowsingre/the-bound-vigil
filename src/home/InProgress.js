import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { BookCover } from "../components/BookCover";
import { Icon } from "../components/Icon";
import { Menu } from "../components/Menu";
import { ProgressBar } from "../components/ProgressBar";
import { authorLine, percent } from "../lib/format";
import { bookContextMenu, bookMenu, clickBook } from "./bookActions";
import { EmptyNote, Section } from "./Section";
/** Books under way, with their title, author and how far along: covers on a
 * phone, and on a computer a list with a ••• menu for each. */
export function InProgress({ books, actions, onViewAll, list = false }) {
    return (_jsx(Section, { title: "In progress", onViewAll: books.length ? onViewAll : undefined, className: "in-progress", children: books.length === 0 ? (_jsx(EmptyNote, { children: "Books you're reading will be listed here with how far along you are." })) : list ? (_jsx("ul", { className: "progress-list", children: books.map((book) => (_jsxs("li", { className: "progress-row", ...bookContextMenu(book, actions), children: [_jsxs("button", { type: "button", className: "progress-open", onClick: () => clickBook(book, actions), title: `${book.title}, ${authorLine(book.authors)}`, children: [_jsx(BookCover, { book: book, size: "s" }), _jsxs("span", { className: "progress-text", children: [_jsx("span", { className: "book-title", children: book.title }), _jsx("span", { className: "book-author", children: authorLine(book.authors) }), _jsxs("span", { className: "progress-line", children: [_jsx(ProgressBar, { value: book.totalProgression }), _jsx("span", { className: "num", children: percent(book.totalProgression) })] })] })] }), _jsx(Menu, { label: `More for ${book.title}`, className: "icon-btn icon-btn-round book-more", trigger: _jsx(Icon, { name: "more", size: 16 }), items: bookMenu(book, actions) })] }, book.id))) })) : (_jsx("ul", { className: "shelf", children: books.map((book) => (_jsx("li", { ...bookContextMenu(book, actions), children: _jsxs("button", { type: "button", className: "shelf-book", onClick: () => clickBook(book, actions), title: `${book.title}, ${authorLine(book.authors)}`, children: [_jsx(BookCover, { book: book }), _jsx("span", { className: "book-title", children: book.title }), _jsx("span", { className: "book-author", children: authorLine(book.authors) }), _jsxs("span", { className: "progress-line", children: [_jsx(ProgressBar, { value: book.totalProgression }), _jsx("span", { className: "num", children: percent(book.totalProgression) })] })] }) }, book.id))) })) }));
}

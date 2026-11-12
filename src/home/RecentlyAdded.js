import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { api } from "../api";
import { BookCover } from "../components/BookCover";
import { Icon } from "../components/Icon";
import { Menu } from "../components/Menu";
import { seriesCover } from "../lib/queryBooks";
import { authorLine } from "../lib/format";
import { bookContextMenu, bookMenu, clickBook } from "./bookActions";
import { EmptyNote, Section } from "./Section";
/** The newest books, as covers. On a computer each has a ••• menu beside its title. */
export function RecentlyAdded({ books, actions, onViewAll, onOpenSeries, menus = false }) {
    let coverChoices = {};
    try {
        coverChoices = JSON.parse(localStorage.getItem("tbv.stackCovers.books") ?? "{}") ?? {};
    }
    catch { /* Use automatic covers. */ }
    const stacks = new Map();
    for (const book of books) {
        const key = book.series?.trim().toLowerCase();
        if (!key)
            continue;
        const members = stacks.get(key) ?? [];
        members.push(book);
        stacks.set(key, members);
    }
    const seriesKey = JSON.stringify([...stacks.values()].filter((members) => members.length > 1).map(([book]) => book.series.trim()));
    const [totals, setTotals] = useState({});
    useEffect(() => {
        const series = JSON.parse(seriesKey);
        if (!series.length)
            return;
        let current = true;
        void api.getLibrary({ kind: "books", shelf: "all", sort: "title", search: null, formats: [], location: null, series, groupSeries: true, omitFacets: true, page: 0, pageSize: series.length })
            .then((page) => {
            if (!current)
                return;
            setTotals(Object.fromEntries(page.books.flatMap((book) => {
                const owned = page.seriesCounts?.[book.id];
                return book.series && owned !== undefined ? [[book.series.trim().toLowerCase(), { owned, published: page.seriesPublished?.[book.id] }]] : [];
            })));
        }, () => { if (current)
            setTotals({}); });
        return () => { current = false; };
    }, [seriesKey, books]);
    return (_jsx(Section, { title: "Recently added", onViewAll: books.length ? onViewAll : undefined, className: "recent", children: books.length === 0 ? (_jsx(EmptyNote, { children: "Books you import will appear here." })) : (_jsx("ul", { className: "shelf", children: books.map((book) => {
                const name = book.series?.trim();
                const members = name ? stacks.get(name.toLowerCase()) : undefined;
                if (name && members && members.length > 1) {
                    if (members[0] !== book)
                        return null;
                    const cover = seriesCover(members, coverChoices[name.toLowerCase()]) ?? book;
                    const total = totals[name.toLowerCase()];
                    return _jsx("li", { className: "series-stack", children: _jsxs("button", { type: "button", className: "shelf-book", "aria-label": `Open series ${name}`, onClick: () => onOpenSeries(name), children: [_jsx(BookCover, { book: cover, seriesCount: total?.owned, seriesPublished: total?.published }), _jsx("span", { className: "book-title", children: name })] }) }, book.id);
                }
                return (_jsxs("li", { className: menus ? "has-menu" : undefined, ...bookContextMenu(book, actions), children: [_jsxs("button", { type: "button", className: "shelf-book", onClick: () => clickBook(book, actions), title: `${book.title}, ${authorLine(book.authors)}`, children: [_jsx(BookCover, { book: book }), _jsx("span", { className: "book-title", children: book.title }), _jsx("span", { className: "book-author", children: authorLine(book.authors) })] }), menus && _jsx(Menu, { label: `More for ${book.title}`, className: "icon-btn book-more", trigger: _jsx(Icon, { name: "more", size: 14 }), items: bookMenu(book, actions) })] }, book.id));
            }) })) }));
}

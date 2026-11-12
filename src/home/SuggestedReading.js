import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// Sanctum's Suggested reading. It fills from three places, in this order,
// leaving out books already in the library and any marked Not interested:
// 1. Krowsingre Publishing's own list, read from krowsingre.github.io, so a
//    new book shows without an update;
// 2. other books by the authors you read most, found on Open Library (only
//    author names are sent; off in Preferences › Appearance › Sanctum);
// 3. books you own and haven't started, Up next first.
// The online ones are looked up once a day and kept here till the next.
// One you've read or dropped elsewhere can be marked so, and rated: it goes
// into Reading history (synced) and leaves the row; View all lists them.
import { createElement, useCallback, useEffect, useMemo, useState } from "react";
import { api, isApp, openExternal } from "../api";
import { askBrowser } from "../browse/browserAsk";
import { BookCover } from "../components/BookCover";
import { Icon } from "../components/Icon";
import { Menu } from "../components/Menu";
import { StarRating, Stars } from "../components/StarRating";
import { useToast } from "../components/Toast";
import { authorLine } from "../lib/format";
import { useAppSettings } from "../settings/appSettings";
import { clickBook } from "./bookActions";
import { EmptyNote, Section } from "./Section";
/** The publisher's list. Each entry: title, authors, cover (an address, or a
 * path beside the list), about, and a free `download` or a `buy` link;
 * `pinned` ones come first. */
export const PUBLISHER_LIST = "https://krowsingre.github.io/the-bound-vigil/suggested.json";
const CACHE_KEY = "tbv.sanctum.suggestions";
const HIDDEN_KEY = "sanctum.notInterested";
const SHOWN = 4;
const SOURCE_TITLE = {
    publisher: "From Krowsingre Publishing",
    authors: "More from authors you read",
    shelves: "From your shelves",
};
/** Starts the Reading history id of a suggestion you've marked. */
const MARKED = "suggested:";
const keyOf = (title, authors) => `${title.trim().toLowerCase()}|${(authors[0] ?? "").trim().toLowerCase()}`;
/** "Dune: Deluxe Edition" is Dune, for finding it in the library. */
const mainTitle = (title) => title.split(/\s*[:(]/)[0].trim() || title;
async function fromPublisher(signal) {
    const res = await fetch(PUBLISHER_LIST, { signal, cache: "no-cache" });
    if (!res.ok)
        return [];
    const data = (await res.json());
    const books = (data.books ?? []).filter((b) => typeof b.title === "string" && b.title.trim());
    books.sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned));
    return books.map((b) => {
        const authors = Array.isArray(b.authors) ? b.authors : b.authors ? [b.authors] : [];
        return {
            key: keyOf(b.title, authors),
            source: "publisher",
            title: b.title.trim(),
            authors,
            coverUrl: b.cover ? new URL(b.cover, PUBLISHER_LIST).href : null,
            about: b.about ?? null,
            download: b.download ?? null,
            buy: b.buy ?? null,
        };
    });
}
async function fromAuthors(authors, signal) {
    const found = await Promise.all(authors.slice(0, 3).map(async (author) => {
        const params = new URLSearchParams({ author, sort: "rating", limit: "8", fields: "key,title,author_name,cover_i" });
        const res = await fetch(`https://openlibrary.org/search.json?${params}`, { signal });
        if (!res.ok)
            return [];
        const data = (await res.json());
        return (data.docs ?? [])
            .filter((d) => d.title && d.cover_i)
            .map((d) => ({
            key: keyOf(d.title, d.author_name ?? [author]),
            source: "authors",
            title: d.title,
            authors: d.author_name?.slice(0, 2) ?? [author],
            coverUrl: `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg`,
            page: d.key ? `https://openlibrary.org${d.key}` : null,
        }));
    }));
    // A few from each author in turn, so one prolific author doesn't fill the row.
    const mixed = [];
    for (let i = 0; i < 8; i++)
        for (const list of found)
            if (list[i])
                mixed.push(list[i]);
    return mixed;
}
function readCache() {
    try {
        const raw = localStorage.getItem(CACHE_KEY);
        return raw ? JSON.parse(raw) : null;
    }
    catch {
        return null;
    }
}
/** The online suggestions, looked up once a day (and again when your authors change). */
function useOnline(on, authors) {
    const authorsKey = authors.join("|");
    const today = new Date().toISOString().slice(0, 10);
    const [items, setItems] = useState(() => {
        const cached = readCache();
        return on && cached ? cached.items : [];
    });
    useEffect(() => {
        if (!on || !isApp)
            return setItems([]);
        const cached = readCache();
        if (cached && cached.day === today && cached.authors === authorsKey)
            return setItems(cached.items);
        const stop = new AbortController();
        const names = authorsKey ? authorsKey.split("|") : [];
        void Promise.all([fromPublisher(stop.signal).catch(() => []), fromAuthors(names, stop.signal).catch(() => [])]).then(async ([publisher, byAuthors]) => {
            const all = [...publisher, ...byAuthors];
            const owned = await api.ownedTitles(all.map((s) => mainTitle(s.title))).catch(() => all.map(() => false));
            // Your own picks stay even when owned; the rest only when new to you.
            const fresh = all.filter((s, i) => s.source === "publisher" || !owned[i]);
            if (stop.signal.aborted)
                return;
            setItems(fresh);
            try {
                localStorage.setItem(CACHE_KEY, JSON.stringify({ day: today, authors: authorsKey, items: fresh }));
            }
            catch {
                // Looked up again next time.
            }
        });
        return () => stop.abort();
    }, [on, authorsKey, today]);
    return items;
}
export function SuggestedReading({ shelves, readAuthors, actions, onNavigate, }) {
    const { settings } = useAppSettings();
    const online = useOnline(settings.suggestOnline, readAuthors);
    const [hidden, setHidden] = useState([]);
    const [chosen, setChosen] = useState(null);
    const [all, setAll] = useState(false);
    useEffect(() => {
        api.getSetting(HIDDEN_KEY).then((raw) => setHidden(raw ? JSON.parse(raw) : []), () => undefined);
    }, []);
    const hide = (s) => {
        const next = [...new Set([...hidden, s.key])];
        setHidden(next);
        void api.setSetting(HIDDEN_KEY, JSON.stringify(next)).catch(() => undefined);
    };
    const toast = useToast();
    // Books in Reading history: ones you've marked here, and any you've read or
    // rated before (even gone from the library), so they aren't suggested.
    const [history, setHistory] = useState([]);
    const loadHistory = useCallback(() => {
        api.readingHistory().then(setHistory, () => undefined);
    }, []);
    useEffect(loadHistory, [loadHistory]);
    const marks = useMemo(() => {
        const map = new Map();
        for (const e of history)
            map.set(e.bookId.startsWith(MARKED) ? e.bookId.slice(MARKED.length) : keyOf(e.title, e.authors), e);
        return map;
    }, [history]);
    const markOf = (s) => {
        const e = marks.get(s.key);
        return e ? { status: e.status, stars: e.stars } : { status: null, stars: null };
    };
    const mark = (s, change) => {
        if (s.book) {
            if (change.status)
                actions.setStatus(s.book, change.status);
            if (change.stars !== undefined)
                actions.setRating(s.book, change.stars);
            return;
        }
        const was = markOf(s);
        const next = { ...was, ...change };
        api.markSuggestion(s.key, s.title, s.authors, next.status, next.stars).then(() => {
            loadHistory();
            if (next.status && next.status !== was.status)
                toast(`“${s.title}” is marked ${next.status}, in your reading history.`);
            else if (next.stars != null && next.stars !== was.stars)
                toast(`“${s.title}” is rated, in your reading history.`);
        }, (e) => toast(`Couldn't mark “${s.title}”: ${String(e)}`));
    };
    const unmark = (s) => {
        api.markSuggestion(s.key, s.title, s.authors, null, null).then(loadHistory, (e) => toast(`That didn't work: ${String(e)}`));
    };
    const list = useMemo(() => {
        const own = shelves.map((book) => ({ key: keyOf(book.title, book.authors), source: "shelves", title: book.title, authors: book.authors, coverUrl: null, book }));
        const seen = new Set();
        return [...online, ...own].filter((s) => !hidden.includes(s.key) && (!!s.book || !marks.has(s.key)) && !seen.has(s.key) && (seen.add(s.key), true));
    }, [online, shelves, hidden, marks]);
    /** The ones you've marked from here, newest first, with a cover when the row still has it. */
    const marked = useMemo(() => history
        .filter((e) => e.bookId.startsWith(MARKED))
        .map((e) => {
        const key = e.bookId.slice(MARKED.length);
        const seen = online.find((s) => s.key === key);
        return seen ?? { key, source: "authors", title: e.title, authors: e.authors, coverUrl: null };
    }), [history, online]);
    const open = (s) => (s.book ? clickBook(s.book, actions) : setChosen(s));
    const menu = (s) => {
        const now = markOf(s);
        const status = s.book ? (s.book.status === "read" || s.book.status === "dropped" ? s.book.status : null) : now.status;
        const stars = s.book ? s.book.rating : now.stars;
        const isMarked = !s.book && marks.has(s.key);
        return [
            s.book ? { label: "Open", icon: "bookOpen", onSelect: () => actions.open(s.book) } : { label: "More about it", icon: "info", onSelect: () => setChosen(s) },
            {
                heading: createElement("span", { className: "menu-rating" }, "Your rating", createElement(StarRating, { value: stars, size: 18, onChange: (r) => mark(s, { stars: r }) })),
            },
            "divider",
            status === "read"
                ? { label: "Read", icon: "check", disabled: true, onSelect: () => undefined }
                : { label: "Mark as read", icon: "check", hint: "Read it somewhere else", onSelect: () => mark(s, { status: "read" }) },
            status === "dropped"
                ? { label: "Dropped", disabled: true, onSelect: () => undefined }
                : { label: "Mark as dropped", hint: "Started, not going back", onSelect: () => mark(s, { status: "dropped" }) },
            ...(isMarked
                ? [{ label: "Unmark", hint: "Takes it off your reading history", onSelect: () => unmark(s) }]
                : [{ label: "Not interested", icon: "eyeOff", onSelect: () => hide(s) }]),
        ];
    };
    return (_jsxs(Section, { title: "Suggested reading", className: "suggested", onViewAll: list.length > SHOWN ? () => setAll(true) : undefined, children: [list.length === 0 ? (_jsx(EmptyNote, { children: "Books you might like to read next will appear here." })) : (_jsx("ul", { className: "shelf", children: list.slice(0, SHOWN).map((s) => (_jsx(SuggestionCard, { s: s, onOpen: () => open(s), menu: menu(s) }, s.key))) })), chosen && (_jsx(SuggestionDialog, { s: chosen, mark: markOf(chosen), onMark: (change) => mark(chosen, change), onClose: () => setChosen(null), onHide: () => (hide(chosen), setChosen(null)), onNavigate: onNavigate })), all && (_jsx("div", { className: "dialog-backdrop", onPointerDown: (e) => e.target === e.currentTarget && setAll(false), children: _jsxs("div", { className: "dialog suggested-all", role: "dialog", "aria-label": "Suggested reading", onKeyDown: (e) => e.key === "Escape" && setAll(false), children: [_jsxs("header", { className: "catalogues-head", children: [_jsx("h2", { children: "Suggested reading" }), _jsx("button", { type: "button", className: "icon-btn", "aria-label": "Close", onClick: () => setAll(false), children: _jsx(Icon, { name: "close", size: 18 }) })] }), Object.keys(SOURCE_TITLE).map((source) => {
                            const some = list.filter((s) => s.source === source);
                            if (!some.length)
                                return null;
                            return (_jsxs("section", { className: "suggested-group", children: [_jsx("h3", { className: "section-title", children: SOURCE_TITLE[source] }), _jsx("ul", { className: "shelf", children: some.map((s) => (_jsx(SuggestionCard, { s: s, onOpen: () => (setAll(false), open(s)), menu: menu(s) }, s.key))) })] }, source));
                        }), marked.length > 0 && (_jsxs("section", { className: "suggested-group", children: [_jsx("h3", { className: "section-title", children: "You've marked" }), _jsx("ul", { className: "shelf", children: marked.map((s) => (_jsx(SuggestionCard, { s: s, onOpen: () => setChosen(s), menu: menu(s), mark: markOf(s) }, s.key))) })] }))] }) }))] }));
}
function SuggestionCard({ s, onOpen, menu, mark }) {
    return (_jsxs("li", { className: "has-menu", children: [_jsxs("button", { type: "button", className: "shelf-book", onClick: onOpen, title: `${s.title}, ${authorLine(s.authors)}`, children: [_jsx(OnlineCover, { s: s }), _jsx("span", { className: "book-title", children: s.title }), _jsx("span", { className: "book-author", children: authorLine(s.authors) }), mark && (_jsxs("span", { className: "suggested-mark muted", children: [mark.status === "read" ? "Read" : mark.status === "dropped" ? "Dropped" : null, _jsx(Stars, { value: mark.stars, size: 11 })] }))] }), _jsx(Menu, { label: `More for ${s.title}`, className: "icon-btn book-more", trigger: _jsx(Icon, { name: "more", size: 14 }), items: menu })] }));
}
function OnlineCover({ s }) {
    const [failed, setFailed] = useState(false);
    if (s.book || !s.coverUrl || failed)
        return _jsx(BookCover, { book: s.book ?? { id: `sha256:${s.key}`, title: s.title, authors: s.authors, coverPath: null } });
    return (_jsxs("div", { className: "cover cover-m", children: [_jsxs("div", { className: "cover-private", "aria-hidden": true, children: [_jsx("span", { className: "cover-title", children: s.title }), _jsx("span", { className: "cover-author", children: authorLine(s.authors) })] }), _jsx("img", { src: s.coverUrl, alt: "", loading: "lazy", draggable: false, onError: () => setFailed(true) })] }));
}
/** A book from online: what it is, and one way to get it. */
function SuggestionDialog({ s, mark, onMark, onClose, onHide, onNavigate, }) {
    // Kept here too, so a rating and a mark made one after the other both stay.
    const [now, setNow] = useState(mark);
    const change = (next) => {
        const both = { ...now, ...next };
        setNow(both);
        onMark(both);
    };
    const toast = useToast();
    const [busy, setBusy] = useState(false);
    const add = async () => {
        setBusy(true);
        try {
            await api.downloadWebBook(s.download, s.title);
            toast(`${s.title} is coming into your library.`);
            onClose();
        }
        catch (e) {
            toast(String(e).replace(/^Error: /, ""));
        }
        finally {
            setBusy(false);
        }
    };
    const inDiscover = (url) => {
        askBrowser({ url });
        onClose();
        onNavigate("catalogs");
    };
    return (_jsx("div", { className: "dialog-backdrop", onPointerDown: (e) => e.target === e.currentTarget && onClose(), children: _jsxs("div", { className: "dialog suggestion-dialog", role: "dialog", "aria-label": s.title, onKeyDown: (e) => e.key === "Escape" && onClose(), children: [_jsx(OnlineCover, { s: s }), _jsxs("div", { className: "suggestion-body", children: [_jsx("p", { className: "eyebrow", children: SOURCE_TITLE[s.source] }), _jsx("h2", { children: s.title }), _jsx("p", { className: "muted", children: authorLine(s.authors) }), s.about && _jsx("p", { className: "suggestion-about", children: s.about }), _jsxs("div", { className: "suggestion-mark", children: [_jsx("span", { className: "muted", children: "Read it already?" }), _jsx(StarRating, { value: now.stars, size: 20, onChange: (r) => change({ stars: r }) }), _jsxs("button", { type: "button", className: `btn btn-small${now.status === "read" ? " btn-primary" : " btn-quiet"}`, onClick: () => change({ status: "read" }), children: [_jsx(Icon, { name: "check", size: 14 }), " Read"] }), _jsx("button", { type: "button", className: `btn btn-small${now.status === "dropped" ? " btn-primary" : " btn-quiet"}`, onClick: () => change({ status: "dropped" }), children: "Dropped" })] }), _jsxs("div", { className: "dialog-actions", children: [_jsx("button", { type: "button", className: "btn btn-quiet", onClick: onHide, children: "Not interested" }), s.download ? (_jsxs("button", { type: "button", className: "btn btn-primary", disabled: busy, onClick: () => void add(), children: [_jsx(Icon, { name: "download", size: 15 }), " Add to library"] })) : s.buy ? (_jsxs("button", { type: "button", className: "btn btn-primary", onClick: () => void openExternal(s.buy), children: ["Buy ", _jsx(Icon, { name: "external", size: 14 })] })) : s.page ? (_jsxs("button", { type: "button", className: "btn btn-primary", onClick: () => inDiscover(s.page), children: [_jsx(Icon, { name: "compass", size: 15 }), " Find it in Discover"] })) : null] })] })] }) }));
}

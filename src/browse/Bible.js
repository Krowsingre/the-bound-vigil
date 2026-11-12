import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
// Browse › Bible: the King James, World English and American Standard
// versions, brought in as normal books (they sync, take highlights and open
// in the reader), and a picker that opens one at a chapter.
import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { Icon } from "../components/Icon";
import { useToast } from "../components/Toast";
import { bibleTarget, NEW_TESTAMENT, OLD_TESTAMENT, TRANSLATIONS } from "./bibleBooks";
const CHOSEN_KEY = "tbv.bible.translation";
function readChosen() {
    try {
        const id = localStorage.getItem(CHOSEN_KEY);
        return TRANSLATIONS.some((t) => t.id === id) ? id : null;
    }
    catch {
        return null;
    }
}
/** The library's copy of a translation, found by its title. */
async function findInLibrary(t) {
    for (const words of t.titled) {
        const page = await api.getLibrary({ shelf: "all", sort: "title", search: words, formats: [], location: null, page: 0, pageSize: 20 });
        const found = page.books.find((b) => b.title.toLowerCase().includes(words));
        if (found)
            return found.id;
    }
    return null;
}
/** Whether Go to a chapter is folded away, remembered on this device. */
const FOLDED_KEY = "tbv.bible.folded";
function readFolded() {
    try {
        return localStorage.getItem(FOLDED_KEY) !== "0";
    }
    catch {
        return true;
    }
}
export function Bible({ refreshKey, onOpenBook, onOpenSite, }) {
    const [owned, setOwned] = useState({});
    const [adding, setAdding] = useState({});
    const [chosen, setChosen] = useState(readChosen);
    const [book, setBook] = useState(null);
    const [folded, setFolded] = useState(readFolded);
    const fold = () => setFolded((was) => {
        try {
            localStorage.setItem(FOLDED_KEY, was ? "0" : "1");
        }
        catch {
            // Only remembered where the browser allows it.
        }
        return !was;
    });
    const toast = useToast();
    const look = useCallback(async () => {
        const found = await Promise.all(TRANSLATIONS.map(async (t) => [t.id, await findInLibrary(t).catch(() => null)]));
        setOwned(Object.fromEntries(found.filter(([, id]) => id)));
    }, []);
    useEffect(() => {
        void look();
    }, [look, refreshKey]);
    // A translation being added shows up once the import queue has it in.
    useEffect(() => api.onImports((view) => view.done === view.total && void look()), [look]);
    const inLibrary = TRANSLATIONS.filter((t) => owned[t.id]);
    const reading = inLibrary.find((t) => t.id === chosen) ?? inLibrary[0] ?? null;
    const choose = (id) => {
        setChosen(id);
        try {
            localStorage.setItem(CHOSEN_KEY, id);
        }
        catch {
            // Remembered for this visit only.
        }
    };
    const add = async (t) => {
        setAdding((a) => ({ ...a, [t.id]: true }));
        try {
            await api.downloadWebBook(t.url, t.name);
            toast(`The ${t.name} is being added to your library.`);
        }
        catch (e) {
            toast(`The ${t.name} couldn't be brought in: ${String(e)}`);
        }
        finally {
            setAdding((a) => ({ ...a, [t.id]: false }));
        }
    };
    const open = (chapter) => {
        const id = reading && owned[reading.id];
        if (id && book)
            onOpenBook(id, bibleTarget(book.code, chapter));
    };
    const testament = (title, books) => (_jsxs("section", { className: "bible-testament", "aria-label": title, children: [_jsx("h3", { children: title }), _jsx("ul", { className: "bible-books", children: books.map((b) => (_jsx("li", { children: _jsx("button", { type: "button", className: b === book ? "is-current" : undefined, "aria-pressed": b === book, onClick: () => setBook(b === book ? null : b), children: b.name }) }, b.code))) })] }));
    return (_jsxs("div", { className: "bible", children: [_jsx("ul", { className: "bible-translations", children: TRANSLATIONS.map((t) => (_jsxs("li", { className: "bible-translation", children: [_jsxs("div", { children: [_jsxs("strong", { children: [t.name, " ", _jsxs("span", { className: "muted", children: ["(", t.short, ")"] })] }), _jsx("span", { className: "muted", children: t.year }), _jsx("p", { className: "muted", children: t.about })] }), owned[t.id] ? (_jsxs("button", { type: "button", className: "btn btn-quiet btn-small", onClick: () => onOpenBook(owned[t.id]), children: [_jsx(Icon, { name: "library", size: 14 }), " Open"] })) : (_jsx("button", { type: "button", className: "btn btn-primary btn-small", disabled: adding[t.id], onClick: () => void add(t), children: adding[t.id] ? ("Bringing it in…") : (_jsxs(_Fragment, { children: [_jsx(Icon, { name: "download", size: 14 }), " Add to library"] })) }))] }, t.id))) }), _jsxs("p", { className: "muted bible-note", children: ["All three are public domain, from eBible.org. Each one is a normal book in your library, so it syncs and keeps your highlights and notes.", onOpenSite && (_jsxs(_Fragment, { children: [" ", _jsx("button", { type: "button", className: "link-btn", onClick: () => onOpenSite("https://ebible.org/download.php"), children: "More translations on eBible.org" })] }))] }), reading ? (_jsxs("div", { className: "bible-picker", children: [_jsxs("div", { className: "bible-picker-head", children: [_jsx("h2", { children: _jsxs("button", { type: "button", className: "bible-fold", "aria-expanded": !folded, onClick: fold, children: [_jsx(Icon, { name: folded ? "chevronRight" : "chevronDown", size: 18 }), " Go to a chapter"] }) }), !folded && inLibrary.length > 1 && (_jsx("div", { className: "tabs", role: "tablist", "aria-label": "Translation", children: inLibrary.map((t) => (_jsx("button", { type: "button", role: "tab", "aria-selected": t === reading, className: `tab${t === reading ? " is-active" : ""}`, onClick: () => choose(t.id), children: t.short }, t.id))) }))] }), !folded && book && (_jsxs("section", { className: "bible-chapters", "aria-label": `Chapters of ${book.name}`, children: [_jsxs("h3", { children: [book.name, " ", _jsxs("span", { className: "muted", children: ["in the ", reading.short] })] }), _jsx("ul", { children: Array.from({ length: book.chapters }, (_, i) => (_jsx("li", { children: _jsx("button", { type: "button", onClick: () => open(i + 1), "aria-label": `${book.name} ${i + 1}`, children: i + 1 }) }, i))) })] })), !folded && testament("Old Testament", OLD_TESTAMENT), !folded && testament("New Testament", NEW_TESTAMENT)] })) : (_jsx("p", { className: "muted bible-empty", children: "Add a translation above, and you can open it here at any book and chapter." }))] }));
}

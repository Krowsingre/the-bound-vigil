import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// Store editions: your books' pages in each store, an "Also by" page made
// from them, and one click to make a copy of the book for every store, each
// with its links pointing to that store (see editions.ts).
import { useEffect, useRef, useState } from "react";
import { api, isWeb } from "../api";
import { Icon } from "../components/Icon";
import { useToast } from "../components/Toast";
import { buildEpub, epubFiles } from "./epub";
import { alsoByHtml, editionFileName, retarget, STORES } from "./editions";
import { KINDS, readPage, writePage } from "./pages";
import { bookInput } from "./WritingDialogs";
const LINK_FIELDS = [
    ...STORES.map((s) => ({ key: s.id, label: s.label, hint: s.id === "amazon" ? "https://www.amazon.com/dp/…" : s.id === "apple" ? "https://books.apple.com/…" : "https://…" })),
    { key: "everywhere", label: "Everywhere else", hint: "Your website, or a universal book link" },
];
const EDITIONS_KEY = "tbv.editions.stores";
function savedStores() {
    try {
        const saved = JSON.parse(localStorage.getItem(EDITIONS_KEY) ?? "null");
        if (Array.isArray(saved))
            return saved.filter((s) => s === "plain" || STORES.some((x) => x.id === s));
    }
    catch {
        // Every store, then.
    }
    return [...STORES.map((s) => s.id), "plain"];
}
export function StoreEditionsDialog({ project, chapters, settings, onSettings, onFlush, onChanged, onClose, }) {
    const [books, setBooks] = useState(settings.storeBooks);
    const [stores, setStores] = useState(savedStores);
    const [plans, setPlans] = useState(null);
    const [busy, setBusy] = useState(null);
    const [error, setError] = useState(null);
    const toast = useToast();
    // Kept a moment after typing stops, and when the dialog closes.
    const waiting = useRef(null);
    const settingsRef = useRef({ settings, onSettings });
    settingsRef.current = { settings, onSettings };
    useEffect(() => {
        const timer = setInterval(() => {
            if (!waiting.current)
                return;
            const { settings: s, onSettings: save } = settingsRef.current;
            save({ ...s, storeBooks: waiting.current });
            waiting.current = null;
        }, 700);
        return () => {
            clearInterval(timer);
            const { settings: s, onSettings: save } = settingsRef.current;
            if (waiting.current)
                save({ ...s, storeBooks: waiting.current });
        };
    }, []);
    const keep = (next) => {
        setBooks(next);
        waiting.current = next;
    };
    const change = (id, change) => keep(books.map((b) => (b.id === id ? { ...b, ...change } : b)));
    const setLink = (book, key, value) => {
        const links = { ...book.links };
        if (value.trim())
            links[key] = value.trim();
        else
            delete links[key];
        change(book.id, { links });
    };
    // What each edition would change, worked out from the book as it stands.
    useEffect(() => {
        let current = true;
        const timer = setTimeout(() => {
            void (async () => {
                const input = await bookInput(project, chapters, { ...settings, storeBooks: books }).catch(() => null);
                if (!input || !current)
                    return;
                const pages = epubFiles(input)
                    .files.filter(([name, data]) => /\.xhtml$/.test(name) && typeof data === "string")
                    .map(([, data]) => data);
                setPlans(STORES.map((s) => {
                    const each = pages.map((p) => retarget(p, s.id, books));
                    return { store: s.id, changed: each.reduce((n, r) => n + r.changed, 0), unlinked: each.flatMap((r) => r.unlinked) };
                }));
            })();
        }, 300);
        return () => {
            current = false;
            clearTimeout(timer);
        };
        // The other settings only matter for the words of the pages, so books alone start it again.
    }, [project, chapters, books]);
    const addOthers = async () => {
        try {
            const all = await api.writingProjects();
            const have = new Set(books.map((b) => b.title.trim().toLowerCase()));
            const more = all
                .filter((p) => p.id !== project.id && p.title.trim() && !have.has(p.title.trim().toLowerCase()))
                .filter((p) => !project.author || !p.author || p.author.trim().toLowerCase() === project.author.trim().toLowerCase())
                .map((p) => ({ id: crypto.randomUUID(), title: p.title.trim(), links: {} }));
            if (!more.length)
                return toast("Every book you're writing is in the list already.");
            keep([...books, ...more]);
        }
        catch (e) {
            toast(String(e));
        }
    };
    const writeAlsoBy = async () => {
        const html = alsoByHtml(books, project.title);
        if (!html)
            return setError("Add another book to the list first.");
        setError(null);
        setBusy("Writing the page…");
        try {
            const latest = await onFlush();
            const page = latest.find((c) => readPage(c.page, c.role).kind === "also_by");
            if (page)
                await api.saveWritingChapter(page.id, page.title, html);
            else {
                const last = [...latest].reverse().find((c) => c.role === "back") ?? latest[latest.length - 1];
                await api.addWritingSection(project.id, {
                    title: KINDS.also_by.title?.(project) ?? "Also by the author",
                    body: html,
                    role: "back",
                    page: writePage({ ...readPage("{}"), kind: "also_by", inContents: true, showTitle: true }),
                    after: last?.id ?? null,
                });
            }
            onChanged();
            toast(page ? "Your Also by page has been rewritten from the list." : "An Also by page has been added at the back.");
        }
        catch (e) {
            setError(String(e).replace(/^Error: /, ""));
        }
        finally {
            setBusy(null);
        }
    };
    const exportAll = async () => {
        if (!stores.length)
            return setError("Choose at least one store.");
        setError(null);
        try {
            localStorage.setItem(EDITIONS_KEY, JSON.stringify(stores));
        }
        catch {
            // Chosen for this time only.
        }
        try {
            const folder = isWeb ? null : await api.chooseFolder("Where the editions go");
            if (!isWeb && !folder)
                return;
            setBusy("Making the editions…");
            const latest = await onFlush();
            const input = await bookInput(project, latest, { ...settings, storeBooks: books }, true);
            const join = (name) => (folder ? `${folder}${folder.includes("\\") ? "\\" : "/"}${name}` : null);
            const order = [...STORES.map((s) => s.id), "plain"].filter((s) => stores.includes(s));
            for (const [i, store] of order.entries()) {
                setBusy(`Making the editions… ${i + 1} of ${order.length}`);
                const edition = store === "plain" ? null : store;
                const name = editionFileName(project.title, edition);
                await api.saveExportFile(buildEpub({ ...input, edition }), name, join(name));
            }
            toast(isWeb ? `${order.length} editions have been downloaded.` : `${order.length} editions have been saved.`);
            onClose();
        }
        catch (e) {
            setError(String(e).replace(/^Error: /, ""));
        }
        finally {
            setBusy(null);
        }
    };
    const toggle = (s) => setStores((list) => (list.includes(s) ? list.filter((x) => x !== s) : [...list, s]));
    return (_jsx("div", { className: "dialog-backdrop", onPointerDown: (e) => e.target === e.currentTarget && !busy && onClose(), children: _jsxs("div", { className: "dialog writing-dialog store-editions", role: "dialog", "aria-label": "Store editions", onKeyDown: (e) => e.key === "Escape" && !busy && onClose(), children: [_jsx("h2", { children: "Store editions" }), _jsx("p", { className: "dialog-lede", children: "Create a separate EPUB for each bookstore, with links to your other books adjusted for that store. Your manuscript stays the same; only the retailer-specific links change." }), _jsx("p", { className: "muted dialog-lede", children: "Stores turn books away when they send readers to another store. List your books' pages in each store, and every edition's links go to the right one. Links to other stores that aren't in the list keep their words but lose the link." }), _jsxs("section", { className: "store-books", "aria-label": "Your books in each store", children: [_jsxs("div", { className: "store-books-head", children: [_jsx("h3", { children: "Your books in each store" }), _jsxs("div", { className: "store-books-actions", children: [_jsx("button", { type: "button", className: "btn btn-quiet btn-small", onClick: () => void addOthers(), children: "Add the other books I'm writing" }), _jsxs("button", { type: "button", className: "btn btn-quiet btn-small", onClick: () => keep([...books, { id: crypto.randomUUID(), title: "", links: {} }]), children: [_jsx(Icon, { name: "plus", size: 14 }), " Add a book"] })] })] }), books.length === 0 && _jsx("p", { className: "muted store-books-empty", children: "No books yet. Add the ones you link to: your other books, a series' next book, or this one, for review links." }), books.map((b) => (_jsxs("div", { className: "store-book", children: [_jsxs("div", { className: "store-book-title", children: [_jsx("input", { value: b.title, placeholder: "Title", "aria-label": "Title", maxLength: 300, onChange: (e) => change(b.id, { title: e.target.value }) }), _jsx("button", { type: "button", className: "btn btn-quiet btn-icon btn-small", "aria-label": `Take ${b.title || "this book"} off the list`, title: "Take off the list", onClick: () => keep(books.filter((x) => x.id !== b.id)), children: _jsx(Icon, { name: "close", size: 14 }) })] }), _jsx("div", { className: "store-book-links", children: LINK_FIELDS.map((f) => (_jsxs("label", { className: "field", children: [_jsx("span", { children: f.label }), _jsx("input", { type: "url", value: b.links[f.key] ?? "", placeholder: f.hint, maxLength: 600, onChange: (e) => setLink(b, f.key, e.target.value) })] }, f.key))) })] }, b.id))), books.length > 0 && (_jsx("button", { type: "button", className: "btn btn-quiet btn-small store-also-by", disabled: !!busy, onClick: () => void writeAlsoBy(), children: "Write the Also by page from this list" }))] }), _jsxs("fieldset", { className: "writing-export-group store-editions-pick", children: [_jsx("legend", { children: "Editions to make" }), STORES.map((s) => {
                            const plan = plans?.find((p) => p.store === s.id);
                            return (_jsxs("label", { className: "check-row store-edition", children: [_jsx("input", { type: "checkbox", checked: stores.includes(s.id), onChange: () => toggle(s.id) }), _jsxs("span", { children: [_jsx("b", { children: s.edition }), _jsx("span", { className: "muted", children: !plan
                                                    ? "Checking the links…"
                                                    : [
                                                        plan.changed ? `${plan.changed} ${plan.changed === 1 ? "link goes" : "links go"} to ${s.label}` : "",
                                                        plan.unlinked.length ? `${plan.unlinked.length} kept as words only (${plan.unlinked.slice(0, 3).join(", ")}${plan.unlinked.length > 3 ? "…" : ""})` : "",
                                                    ]
                                                        .filter(Boolean)
                                                        .join("; ") || "No store links to change" })] })] }, s.id));
                        }), _jsxs("label", { className: "check-row store-edition", children: [_jsx("input", { type: "checkbox", checked: stores.includes("plain"), onChange: () => toggle("plain") }), _jsxs("span", { children: [_jsx("b", { children: "Everywhere else" }), _jsx("span", { className: "muted", children: "Links as you wrote them, for your website or other shops" })] })] })] }), error && (_jsx("p", { className: "form-error", role: "alert", children: error })), _jsxs("div", { className: "dialog-actions", children: [_jsx("button", { type: "button", className: "btn btn-quiet", onClick: onClose, disabled: !!busy, children: "Close" }), _jsx("button", { type: "button", className: "btn btn-primary", disabled: !!busy || !stores.length, onClick: () => void exportAll(), children: busy ?? `Export ${stores.length === 1 ? "1 edition" : `${stores.length} editions`}` })] })] }) }));
}

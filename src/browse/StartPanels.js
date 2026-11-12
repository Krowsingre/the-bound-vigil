import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// The start page's Bookmarks and Reading List tiles open these, in the same
// kind of panel as History and Downloads.
import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { Icon } from "../components/Icon";
import { useToast } from "../components/Toast";
import { siteOf } from "./browserPrefs";
import { onReadingList, readReadingList, removeFromReadingList } from "./readingList";
import { readBookmarkHtml, writeBookmarkHtml } from "./bookmarkHtml";
import { SiteBadge } from "./SiteBadge";
export function Panel({ title, onClose, children }) {
    return (_jsx("div", { className: "dialog-backdrop", onPointerDown: (e) => e.target === e.currentTarget && onClose(), children: _jsxs("div", { className: "dialog browser-history", role: "dialog", "aria-label": title, onKeyDown: (e) => e.key === "Escape" && onClose(), children: [_jsxs("header", { className: "catalogues-head", children: [_jsx("h2", { children: title }), _jsx("button", { type: "button", className: "icon-btn", "aria-label": "Close", onClick: onClose, children: _jsx(Icon, { name: "close", size: 18 }) })] }), children] }) }));
}
export function BookmarksPanel({ onGo, onClose, onChanged, page }) {
    const toast = useToast();
    const [marks, setMarks] = useState([]);
    const [draft, setDraft] = useState(page ?? null);
    const [busy, setBusy] = useState(false);
    const importFile = useRef(null);
    useEffect(() => { void api.bookmarks().then(setMarks, (e) => toast(String(e))); }, [toast]);
    const change = async (work, after) => {
        setBusy(true);
        try {
            await work();
            after?.();
            setMarks(await api.bookmarks());
            onChanged();
        }
        catch (e) {
            toast(String(e).replace(/^Error: /, ""));
        }
        finally {
            setBusy(false);
        }
    };
    const importBookmarks = (file) => void change(async () => {
        const entries = readBookmarkHtml(await file.text());
        if (!entries.length) {
            toast("No web bookmarks found in that file.");
            return;
        }
        const existing = new Set((await api.bookmarks()).map((mark) => mark.url));
        let added = 0;
        let failed = 0;
        let skipped = 0;
        for (const entry of entries) {
            if (existing.has(entry.url)) {
                skipped += 1;
                continue;
            }
            try {
                await api.addBookmark(entry.title, entry.url, entry.folder);
                existing.add(entry.url);
                added += 1;
            }
            catch {
                failed += 1;
            }
        }
        toast([added + " imported", skipped + " duplicates skipped", ...(failed ? [failed + " failed"] : [])].join(" · "));
    });
    const exportBookmarks = async () => {
        setBusy(true);
        try {
            const name = "TBV Bookmarks.html";
            const bytes = new TextEncoder().encode(writeBookmarkHtml(await api.bookmarks()));
            if (api.kind === "app") {
                const path = await api.pickExportPath(name, "html");
                if (path)
                    await api.saveExportFile(bytes, name, path);
            }
            else {
                const url = URL.createObjectURL(new Blob([bytes], { type: "text/html;charset=utf-8" }));
                const link = document.createElement("a");
                link.href = url;
                link.download = name;
                link.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
            }
        }
        catch (error) {
            toast(String(error).replace(/^Error: /, ""));
        }
        finally {
            setBusy(false);
        }
    };
    const folders = new Map();
    for (const mark of marks) {
        const name = mark.folder ?? "";
        const group = folders.get(name) ?? [];
        group.push(mark);
        folders.set(name, group);
    }
    const save = () => {
        if (!draft)
            return;
        const folder = draft.folder?.trim() || null;
        void change(() => draft.id
            ? api.editBookmark(draft.id, draft.title, draft.url, folder)
            : api.addBookmark(draft.title, draft.url, folder), () => page ? onClose() : setDraft(null));
    };
    return (_jsxs(Panel, { title: page ? (page.id ? "Edit bookmark" : "Add bookmark") : "Bookmarks", onClose: onClose, children: [draft ? (_jsxs("form", { className: "bookmark-editor", onSubmit: (e) => { e.preventDefault(); save(); }, children: [_jsxs("label", { children: ["Name ", _jsx("input", { autoFocus: true, value: draft.title, maxLength: 200, onChange: (e) => setDraft({ ...draft, title: e.target.value }) })] }), _jsxs("label", { children: ["Address ", _jsx("input", { type: "url", required: true, value: draft.url, onChange: (e) => setDraft({ ...draft, url: e.target.value }) })] }), _jsxs("label", { children: ["Folder ", _jsx("input", { list: "bookmark-folders", placeholder: "No folder", value: draft.folder ?? "", maxLength: 120, onChange: (e) => setDraft({ ...draft, folder: e.target.value }) })] }), _jsx("datalist", { id: "bookmark-folders", children: [...folders.keys()].filter(Boolean).map((name) => _jsx("option", { value: name }, name)) }), _jsxs("div", { className: "bookmark-editor-actions", children: [_jsx("button", { type: "submit", className: "btn btn-primary btn-small", disabled: busy, children: page && !page.id ? "Add bookmark" : "Save" }), page?.id && _jsx("button", { type: "button", className: "btn btn-danger btn-small", disabled: busy, onClick: () => void change(() => api.removeBookmark(page.id), onClose), children: "Remove bookmark" }), _jsx("button", { type: "button", className: "btn btn-quiet btn-small", disabled: busy, onClick: () => page ? onClose() : setDraft(null), children: "Cancel" })] })] })) : (_jsxs("div", { className: "bookmark-editor-actions", children: [_jsx("button", { type: "button", className: "btn btn-quiet btn-small", disabled: busy, onClick: () => setDraft({ id: "", title: "", url: "" }), children: "Add bookmark" }), _jsx("button", { type: "button", className: "btn btn-quiet btn-small", disabled: busy, onClick: () => importFile.current?.click(), children: "Import HTML" }), _jsx("button", { type: "button", className: "btn btn-quiet btn-small", disabled: busy || !marks.length, onClick: () => void exportBookmarks(), children: "Export HTML" }), _jsx("input", { ref: importFile, type: "file", accept: ".html,.htm,text/html", hidden: true, onChange: (event) => {
                            const file = event.target.files?.[0];
                            event.target.value = "";
                            if (file)
                                importBookmarks(file);
                        } })] })), !page && _jsx("ul", { className: "browser-download-list browser-history-list", children: [...folders].flatMap(([name, group]) => [
                    _jsx("li", { children: _jsx("h3", { children: name || "No folder" }) }, "folder:" + name),
                    ...group.map((m, index) => (_jsxs("li", { children: [_jsxs("button", { type: "button", className: "browser-history-open", onClick: () => onGo(m.url), title: m.url, children: [_jsx(SiteBadge, { url: m.url, title: m.title, size: 22 }), _jsxs("span", { className: "browser-download-name", children: [_jsx("b", { children: m.title }), _jsx("span", { className: "muted", children: siteOf(m.url) ?? m.url })] })] }), _jsx("button", { type: "button", className: "icon-btn", disabled: busy || index === 0, "aria-label": "Move " + m.title + " up", onClick: () => void change(() => api.moveBookmark(m.id, -1)), children: "\u2191" }), _jsx("button", { type: "button", className: "icon-btn", disabled: busy || index === group.length - 1, "aria-label": "Move " + m.title + " down", onClick: () => void change(() => api.moveBookmark(m.id, 1)), children: "\u2193" }), _jsx("button", { type: "button", className: "icon-btn", disabled: busy, "aria-label": "Edit " + m.title, onClick: () => setDraft(m), children: _jsx(Icon, { name: "edit", size: 15 }) }), _jsx("button", { type: "button", className: "icon-btn", disabled: busy, "aria-label": "Remove the bookmark for " + m.title, onClick: () => void change(() => api.removeBookmark(m.id), () => { if (draft?.id === m.id)
                                    setDraft(null); }), children: _jsx(Icon, { name: "close", size: 14 }) })] }, m.id))),
                ]) })] }));
}
export function ReadingListPanel({ onOpenBook, onClose }) {
    const toast = useToast();
    const [list, setList] = useState(readReadingList);
    useEffect(() => onReadingList(() => setList(readReadingList())), []);
    const open = async (bookId) => {
        try {
            // Still being added, or since deleted from the library.
            await api.bookDetails(bookId);
        }
        catch {
            toast("That page isn't in your library yet. If you saved it just now, it's still being added.");
            return;
        }
        onClose();
        onOpenBook(bookId);
    };
    return (_jsx(Panel, { title: "Reading List", onClose: onClose, children: list.length === 0 ? (_jsx("p", { className: "muted", children: "Open a page in reader view and choose Save to Reading List. It's kept as a book in your library, to read here or on any device." })) : (_jsx("ul", { className: "browser-download-list browser-history-list", children: list.map((e) => (_jsxs("li", { children: [_jsxs("button", { type: "button", className: "browser-history-open", onClick: () => void open(e.bookId), title: e.url, children: [_jsx(Icon, { name: "notes", size: 18 }), _jsxs("span", { className: "browser-download-name", children: [_jsx("b", { children: e.title }), _jsxs("span", { className: "muted", children: [siteOf(e.url) ?? e.url, " \u00B7 ", new Date(e.at).toLocaleDateString(undefined, { day: "numeric", month: "short" })] })] })] }), _jsx("button", { type: "button", className: "icon-btn", "aria-label": `Take ${e.title} off the Reading List`, title: "Take off the list (the book stays in your library)", onClick: () => removeFromReadingList(e.bookId), children: _jsx(Icon, { name: "close", size: 14 }) })] }, e.bookId))) })) }));
}

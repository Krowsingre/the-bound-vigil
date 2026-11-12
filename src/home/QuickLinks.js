import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
// Sanctum's Quick Links: tiles that go to almost anything in TBV (a page,
// one of Discover's panels, a book, a collection) or to a website, kept
// apart from Discover's own links and synced. See crates/tbv-core/src/sanctum_links.rs.
import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { askBrowser } from "../browse/browserAsk";
import { addressFor, isAddress, readableAddress } from "../browse/browserPrefs";
import { GALLERY, galleryUrl } from "../collections/gallery";
import { holdForMenu } from "../components/ContextMenu";
import { Icon } from "../components/Icon";
import { useToast } from "../components/Toast";
import { hashOf } from "../lib/format";
import { NAV } from "../shell/routes";
import { Section } from "./Section";
const PANELS = [
    { target: "tbv:discover", panel: null, label: "Discover", icon: "compass" },
    { target: "tbv:bookmarks", panel: "bookmarks", label: "Bookmarks", icon: "bookOpen" },
    { target: "tbv:downloads", panel: "downloads", label: "Downloads", icon: "download" },
    { target: "tbv:reading", panel: "reading", label: "Reading List", icon: "file" },
    { target: "tbv:history", panel: "history", label: "History", icon: "clock" },
];
/** The pages a link can open, besides Discover's panels. */
const PAGES = NAV.filter((n) => n.route !== "home" && n.route !== "catalogs");
function kindOf(target) {
    if (target.startsWith("tbv:") || target.startsWith("page:"))
        return "page";
    if (target.startsWith("book:"))
        return "book";
    if (target.startsWith("collection:"))
        return "collection";
    return "site";
}
/** The icon a link shows: its own, else its kind's. */
function iconOf(link) {
    if (link.icon)
        return link.icon;
    const page = PANELS.find((p) => p.target === link.target);
    if (page)
        return page.icon;
    const nav = PAGES.find((p) => `page:${p.route}` === link.target);
    if (nav)
        return nav.icon;
    const kind = kindOf(link.target);
    return kind === "book" ? "bookOpen" : kind === "collection" ? "layers" : "globe";
}
/** Goes where a link points. */
export function followLink(target, go) {
    const panel = PANELS.find((p) => p.target === target);
    if (panel) {
        if (panel.panel)
            askBrowser({ panel: panel.panel });
        return go.onNavigate("catalogs");
    }
    if (target.startsWith("page:"))
        return go.onNavigate(target.slice(5));
    if (target.startsWith("book:"))
        return go.onOpenBook(target.slice(5));
    if (target.startsWith("collection:"))
        return go.onOpenCollection(target.slice(11));
    askBrowser({ url: target });
    go.onNavigate("catalogs");
}
export function QuickLinks({ refreshKey, ...go }) {
    const [links, setLinks] = useState(null);
    const [editing, setEditing] = useState(null);
    const toast = useToast();
    const reload = useCallback(() => api.sanctumLinks().then(setLinks, () => setLinks([])), []);
    useEffect(() => void reload(), [reload, refreshKey]);
    if (!links)
        return _jsx(Section, { title: "Quick links", className: "sanctum-links", children: null });
    return (_jsxs(Section, { title: "Quick links", className: "sanctum-links", action: _jsxs("button", { type: "button", className: "view-all", onClick: () => setEditing({ mode: "list" }), children: ["Edit ", _jsx("span", { "aria-hidden": true, children: "\u2192" })] }), children: [_jsxs("ul", { className: "link-tiles", children: [links.map((l) => {
                        const picture = pictureOf(l);
                        return (_jsxs("li", { ...holdForMenu(`More for ${l.title}`, () => [
                                { label: "Open", icon: "external", onSelect: () => followLink(l.target, go) },
                                { label: "Edit…", icon: "edit", onSelect: () => setEditing({ mode: "edit", link: l }) },
                                {
                                    label: "Remove",
                                    icon: "trash",
                                    danger: true,
                                    onSelect: () => void api.removeSanctumLink(l.id).then(reload, (e) => toast(String(e).replace(/^Error: /, ""))),
                                },
                            ]), children: [_jsxs("button", { type: "button", className: `link-tile${picture ? " has-picture" : ""}`, "data-tone": hashOf(l.title) % 4, onClick: () => followLink(l.target, go), title: l.title, children: [picture && _jsx("img", { className: l.picture?.startsWith("gallery:") ? undefined : "private-picture", src: picture, alt: "", draggable: false }), _jsx(Icon, { name: iconOf(l), size: 30 }), _jsx("span", { children: l.title })] }), _jsx("button", { type: "button", className: "link-tile-edit", "aria-label": `Edit ${l.title}`, title: "Edit", onClick: () => setEditing({ mode: "edit", link: l }), children: _jsx(Icon, { name: "edit", size: 13 }) })] }, l.id));
                    }), _jsx("li", { children: _jsxs("button", { type: "button", className: "link-tile link-tile-add", onClick: () => setEditing({ mode: "add" }), children: [_jsx(Icon, { name: "plus", size: 30 }), _jsx("span", { children: "Add Link" })] }) })] }), editing && (_jsx(LinksEditor, { links: links, start: editing.mode === "add" ? blank() : editing.mode === "edit" ? draftOf(editing.link) : null, onChanged: reload, onClose: () => setEditing(null) }))] }));
}
/** What a tile shows behind its name, if anything. */
function pictureOf(link) {
    const picture = link.picture ?? "";
    if (picture.startsWith("gallery:"))
        return galleryUrl(picture.slice(8), "square");
    if (link.picturePath)
        return api.coverUrl(link.picturePath) || null;
    return null;
}
const draftOf = (l) => ({ id: l.id, kind: kindOf(l.target), title: l.title, target: l.target, icon: l.icon, picture: l.picture ?? "" });
const KINDS = [
    { kind: "page", label: "A page" },
    { kind: "book", label: "A book" },
    { kind: "collection", label: "A collection" },
    { kind: "site", label: "A website" },
];
const blank = (kind = "page") => ({ id: null, kind, title: "", target: "", icon: "", picture: "" });
/** Edit ›: add, rename, move and take off links. Changes save as they're made, and sync. */
function LinksEditor({ links, start, onChanged, onClose }) {
    const toast = useToast();
    /** Opened straight on one link (Add Link, or a tile's Edit): closing the form closes it all. */
    const adding = !!start;
    const [draft, setDraft] = useState(start);
    const [busy, setBusy] = useState(false);
    const run = async (work) => {
        setBusy(true);
        try {
            await work();
            await onChanged();
            return true;
        }
        catch (e) {
            toast(String(e).replace(/^Error: /, ""));
            return false;
        }
        finally {
            setBusy(false);
        }
    };
    const save = async () => {
        if (!draft)
            return;
        let target = draft.target;
        if (draft.kind === "site") {
            const url = isAddress(target) ? addressFor(target) : null;
            if (!url)
                return toast("Type the site's address, such as standardebooks.org.");
            target = url;
        }
        if (!target)
            return toast("Choose where the link goes.");
        // A picture from the computer is copied in once the link is saved.
        const file = draft.picture.startsWith("file:") ? draft.picture.slice(5) : null;
        const picture = file ? "" : draft.picture;
        const ok = await run(async () => {
            const id = draft.id ? (await api.updateSanctumLink(draft.id, draft.title, target, draft.icon, picture), draft.id) : (await api.addSanctumLink(draft.title, target, draft.icon, picture)).id;
            if (file)
                await api.setSanctumLinkPictureFile(id, file);
        });
        if (ok) {
            if (adding)
                onClose();
            else
                setDraft(null);
        }
    };
    return (_jsx("div", { className: "dialog-backdrop", onPointerDown: (e) => e.target === e.currentTarget && onClose(), children: _jsxs("div", { className: "dialog quick-links-editor", role: "dialog", "aria-label": "Edit Quick links", onKeyDown: (e) => e.key === "Escape" && (draft && !adding ? setDraft(null) : onClose()), children: [_jsxs("header", { className: "catalogues-head", children: [_jsx("h2", { children: draft ? (draft.id ? "Change link" : "Add a link") : "Quick links" }), _jsx("button", { type: "button", className: "icon-btn", "aria-label": "Close", onClick: onClose, children: _jsx(Icon, { name: "close", size: 18 }) })] }), draft ? (_jsxs("form", { className: "quick-link-form", onSubmit: (e) => {
                        e.preventDefault();
                        void save();
                    }, children: [_jsx("div", { className: "segmented link-kinds", role: "radiogroup", "aria-label": "Goes to", children: KINDS.map((k) => (_jsx("button", { type: "button", role: "radio", "aria-checked": draft.kind === k.kind, onClick: () => setDraft({ ...draft, kind: k.kind, target: "" }), children: k.label }, k.kind))) }), _jsx(TargetPicker, { draft: draft, onChange: setDraft }), _jsxs("label", { className: "field", children: [_jsx("span", { children: "Name" }), _jsx("input", { value: draft.title, maxLength: 60, onChange: (e) => setDraft({ ...draft, title: e.target.value }), placeholder: "As it shows on the tile" })] }), _jsx(PicturePicker, { draft: draft, onChange: setDraft }), _jsxs("div", { className: "dialog-actions", children: [_jsx("button", { type: "button", className: "btn btn-quiet", onClick: () => (adding ? onClose() : setDraft(null)), children: adding ? "Cancel" : "Back" }), _jsx("button", { type: "submit", className: "btn btn-primary", disabled: busy || !draft.target.trim(), children: draft.id ? "Save" : "Add" })] })] })) : (_jsxs(_Fragment, { children: [_jsx("ul", { className: "browser-download-list quick-links-list", children: links.map((l, i) => (_jsxs("li", { children: [_jsxs("button", { type: "button", className: "browser-history-open", onClick: () => setDraft(draftOf(l)), title: `Change ${l.title}`, children: [pictureOf(l) ? _jsx("img", { className: "quick-links-thumb", src: pictureOf(l), alt: "" }) : _jsx(Icon, { name: iconOf(l), size: 20 }), _jsxs("span", { className: "browser-download-name", children: [_jsx("b", { children: l.title }), _jsx("span", { className: "muted", children: describe(l.target) })] })] }), _jsx("button", { type: "button", className: "icon-btn", "aria-label": `Edit ${l.title}`, title: "Edit", disabled: busy, onClick: () => setDraft(draftOf(l)), children: _jsx(Icon, { name: "edit", size: 16 }) }), _jsx("button", { type: "button", className: "icon-btn", "aria-label": `Move ${l.title} up`, disabled: busy || i === 0, onClick: () => void run(() => api.moveSanctumLink(l.id, i - 1)), children: _jsx(Icon, { name: "chevronUp", size: 16 }) }), _jsx("button", { type: "button", className: "icon-btn", "aria-label": `Move ${l.title} down`, disabled: busy || i === links.length - 1, onClick: () => void run(() => api.moveSanctumLink(l.id, i + 1)), children: _jsx(Icon, { name: "chevronDown", size: 16 }) }), _jsx("button", { type: "button", className: "icon-btn", "aria-label": `Take ${l.title} off`, disabled: busy, onClick: () => void run(() => api.removeSanctumLink(l.id)), children: _jsx(Icon, { name: "trash", size: 16 }) })] }, l.id))) }), links.length === 0 && _jsx("p", { className: "muted", children: "No links yet." }), _jsx("div", { className: "dialog-actions", children: _jsxs("button", { type: "button", className: "btn btn-primary", onClick: () => setDraft(blank()), children: [_jsx(Icon, { name: "plus", size: 15 }), " Add a link"] }) })] }))] }) }));
}
/** Where a link goes, in a few words, for the editor's list. */
function describe(target) {
    const panel = PANELS.find((p) => p.target === target);
    if (panel)
        return panel.panel ? `Discover › ${panel.label}` : "Discover";
    const page = PAGES.find((p) => `page:${p.route}` === target);
    if (page)
        return page.label;
    if (target.startsWith("book:"))
        return "A book";
    if (target.startsWith("collection:"))
        return "A collection";
    return readableAddress(target);
}
/** The choice of where a link goes, for its kind. Picking one also names it, unless a name was typed. */
function TargetPicker({ draft, onChange }) {
    const pick = (target, title, icon = "") => onChange({ ...draft, target, title: draft.title && draft.id ? draft.title : title, icon });
    if (draft.kind === "site")
        return (_jsxs("label", { className: "field", children: [_jsx("span", { children: "Address" }), _jsx("input", { value: draft.target, inputMode: "url", autoCapitalize: "off", spellCheck: false, onChange: (e) => onChange({ ...draft, target: e.target.value }), placeholder: "standardebooks.org", autoFocus: true })] }));
    if (draft.kind === "page")
        return (_jsxs("label", { className: "field", children: [_jsx("span", { children: "Page" }), _jsxs("select", { value: draft.target, onChange: (e) => {
                        const p = PANELS.find((x) => x.target === e.target.value);
                        const n = PAGES.find((x) => `page:${x.route}` === e.target.value);
                        pick(e.target.value, p?.label ?? n?.label ?? "");
                    }, children: [_jsx("option", { value: "", children: "Choose a page\u2026" }), _jsx("optgroup", { label: "Discover", children: PANELS.map((p) => (_jsx("option", { value: p.target, children: p.panel ? `Discover › ${p.label}` : p.label }, p.target))) }), _jsx("optgroup", { label: "Pages", children: PAGES.map((p) => (_jsx("option", { value: `page:${p.route}`, children: p.label }, p.route))) })] })] }));
    if (draft.kind === "collection")
        return _jsx(CollectionPicker, { value: draft.target, onPick: (c) => pick(`collection:${c.id}`, c.name) });
    return _jsx(BookPicker, { value: draft.target, onPick: (b) => pick(`book:${b.id}`, b.title) });
}
function CollectionPicker({ value, onPick }) {
    const [list, setList] = useState([]);
    useEffect(() => {
        api.getCollectionsOverview().then((o) => setList(o.collections), () => undefined);
    }, []);
    return (_jsxs("label", { className: "field", children: [_jsx("span", { children: "Collection" }), _jsxs("select", { value: value, onChange: (e) => {
                    const c = list.find((x) => `collection:${x.id}` === e.target.value);
                    if (c)
                        onPick(c);
                }, children: [_jsx("option", { value: "", children: list.length ? "Choose a collection…" : "No collections yet" }), list.map((c) => (_jsx("option", { value: `collection:${c.id}`, children: c.name }, c.id)))] })] }));
}
function BookPicker({ value, onPick }) {
    const [search, setSearch] = useState("");
    const [found, setFound] = useState([]);
    useEffect(() => {
        const words = search.trim();
        if (!words)
            return setFound([]);
        let current = true;
        const timer = window.setTimeout(() => {
            api
                .getLibrary({ shelf: "all", sort: "title", search: words, formats: [], location: null, kind: null, page: 0, pageSize: 6 })
                .then((page) => current && setFound(page.books), () => undefined);
        }, 200);
        return () => {
            current = false;
            window.clearTimeout(timer);
        };
    }, [search]);
    return (_jsxs("div", { className: "field", children: [_jsxs("label", { children: [_jsx("span", { children: "Book" }), _jsx("input", { type: "search", value: search, onChange: (e) => setSearch(e.target.value), placeholder: "Search by title or author", autoFocus: true })] }), found.length > 0 && (_jsx("ul", { className: "link-book-results", role: "listbox", "aria-label": "Books found", children: found.map((b) => (_jsx("li", { children: _jsxs("button", { type: "button", role: "option", "aria-selected": value === `book:${b.id}`, onClick: () => onPick(b), children: [_jsx("b", { children: b.title }), _jsx("span", { className: "muted", children: b.authors.join(", ") })] }) }, b.id))) }))] }));
}
/** The tile's picture: none, one of TBV's paintings, the book's own cover, or one from the computer. */
function PicturePicker({ draft, onChange }) {
    const toast = useToast();
    const set = (picture) => onChange({ ...draft, picture });
    const bookCover = draft.kind === "book" && draft.target ? `cover:${draft.target.slice(5)}` : null;
    const fromComputer = async () => {
        try {
            const path = await api.pickCollectionPicture();
            if (path)
                set(`file:${path}`);
        }
        catch (e) {
            toast(String(e).replace(/^Error: /, ""));
        }
    };
    const own = draft.picture.startsWith("file:") || draft.picture.startsWith("picture:");
    return (_jsxs("fieldset", { className: "field link-picture", children: [_jsx("legend", { children: "Picture" }), _jsxs("div", { className: "link-picture-choices", children: [_jsx("button", { type: "button", className: "btn btn-quiet btn-small", "aria-pressed": !draft.picture, onClick: () => set(""), children: "None" }), bookCover && (_jsx("button", { type: "button", className: "btn btn-quiet btn-small", "aria-pressed": draft.picture === bookCover, onClick: () => set(bookCover), children: "The book's cover" })), _jsxs("button", { type: "button", className: "btn btn-quiet btn-small", "aria-pressed": own, onClick: () => void fromComputer(), children: [_jsx(Icon, { name: "image", size: 14 }), " ", own ? "Your picture (change…)" : "From your computer…"] })] }), _jsx("div", { className: "picture-grid", children: GALLERY.map((g) => (_jsx("button", { type: "button", "aria-pressed": draft.picture === `gallery:${g.name}`, title: g.label, onClick: () => set(`gallery:${g.name}`), children: _jsx("img", { src: galleryUrl(g.name, "square") ?? undefined, alt: g.label, loading: "lazy", draggable: false }) }, g.name))) })] }));
}

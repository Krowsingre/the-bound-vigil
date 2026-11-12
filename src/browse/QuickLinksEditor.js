import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
// The start page's Edit ›: add, rename, move, take off and choose the
// painting of each Quick Link. Changes save as they're made, and sync.
import { useState } from "react";
import { api } from "../api";
import { GALLERY, galleryUrl } from "../collections/gallery";
import { Icon } from "../components/Icon";
import { useToast } from "../components/Toast";
import { addressFor, isAddress, readableAddress } from "./browserPrefs";
import { SiteBadge } from "./SiteBadge";
/** A painting no Quick Link has yet, or any when all are taken. */
export function freePainting(used) {
    const free = GALLERY.filter((g) => !used.includes(g.name));
    const from = free.length ? free : GALLERY;
    return from[Math.floor(Math.random() * from.length)].name;
}
export function QuickLinksEditor({ links, onChanged, onClose }) {
    const toast = useToast();
    const [draft, setDraft] = useState(null);
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
        // Typed without "https://" is fine; words alone aren't an address.
        const url = isAddress(draft.url) ? addressFor(draft.url) : null;
        if (!url) {
            toast("Type the site's address, such as standardebooks.org.");
            return;
        }
        const ok = await run(() => (draft.id ? api.updateQuickLink(draft.id, draft.title, url, draft.picture) : api.addQuickLink(draft.title, url, draft.picture)));
        if (ok)
            setDraft(null);
    };
    return (_jsx("div", { className: "dialog-backdrop", onPointerDown: (e) => e.target === e.currentTarget && onClose(), children: _jsxs("div", { className: "dialog quick-links-editor", role: "dialog", "aria-label": "Edit Quick Links", onKeyDown: (e) => e.key === "Escape" && (draft ? setDraft(null) : onClose()), children: [_jsxs("header", { className: "catalogues-head", children: [_jsx("h2", { children: draft ? (draft.id ? "Change Quick Link" : "Add a Quick Link") : "Quick Links" }), _jsx("button", { type: "button", className: "icon-btn", "aria-label": "Close", onClick: onClose, children: _jsx(Icon, { name: "close", size: 18 }) })] }), draft ? (_jsxs("form", { className: "quick-link-form", onSubmit: (e) => {
                        e.preventDefault();
                        void save();
                    }, children: [_jsxs("label", { className: "field", children: [_jsx("span", { children: "Name" }), _jsx("input", { value: draft.title, maxLength: 80, onChange: (e) => setDraft({ ...draft, title: e.target.value }), placeholder: "Standard Ebooks" })] }), _jsxs("label", { className: "field", children: [_jsx("span", { children: "Address" }), _jsx("input", { value: draft.url, inputMode: "url", autoCapitalize: "off", spellCheck: false, onChange: (e) => setDraft({ ...draft, url: e.target.value }), placeholder: "standardebooks.org" })] }), _jsxs("fieldset", { className: "field", children: [_jsx("legend", { children: "Painting" }), _jsx("div", { className: "picture-grid", children: GALLERY.map((g) => (_jsx("button", { type: "button", "aria-pressed": draft.picture === g.name, title: g.label, onClick: () => setDraft({ ...draft, picture: g.name }), children: _jsx("img", { src: galleryUrl(g.name, "square") ?? undefined, alt: g.label, loading: "lazy", draggable: false }) }, g.name))) })] }), _jsxs("div", { className: "dialog-actions", children: [_jsx("button", { type: "button", className: "btn btn-quiet", onClick: () => setDraft(null), children: "Back" }), _jsx("button", { type: "submit", className: "btn btn-primary", disabled: busy || !draft.url.trim(), children: draft.id ? "Save" : "Add" })] })] })) : (_jsxs(_Fragment, { children: [_jsx("ul", { className: "browser-download-list quick-links-list", children: links.map((l, i) => (_jsxs("li", { children: [_jsxs("button", { type: "button", className: "browser-history-open", onClick: () => setDraft({ id: l.id, title: l.title, url: l.url, picture: l.picture }), title: `Change ${l.title}`, children: [_jsx(SiteBadge, { url: l.url, title: l.title, size: 24 }), _jsxs("span", { className: "browser-download-name", children: [_jsx("b", { children: l.title }), _jsx("span", { className: "muted", children: readableAddress(l.url) })] }), galleryUrl(l.picture, "square") && _jsx("img", { className: "quick-links-thumb", src: galleryUrl(l.picture, "square"), alt: "" })] }), _jsx("button", { type: "button", className: "icon-btn", "aria-label": `Edit ${l.title}`, title: "Edit", disabled: busy, onClick: () => setDraft({ id: l.id, title: l.title, url: l.url, picture: l.picture }), children: _jsx(Icon, { name: "edit", size: 16 }) }), _jsx("button", { type: "button", className: "icon-btn", "aria-label": `Move ${l.title} up`, disabled: busy || i === 0, onClick: () => void run(() => api.moveQuickLink(l.id, i - 1)), children: _jsx(Icon, { name: "chevronUp", size: 16 }) }), _jsx("button", { type: "button", className: "icon-btn", "aria-label": `Move ${l.title} down`, disabled: busy || i === links.length - 1, onClick: () => void run(() => api.moveQuickLink(l.id, i + 1)), children: _jsx(Icon, { name: "chevronDown", size: 16 }) }), _jsx("button", { type: "button", className: "icon-btn", "aria-label": `Take ${l.title} off`, disabled: busy, onClick: () => void run(() => api.removeQuickLink(l.id)), children: _jsx(Icon, { name: "trash", size: 16 }) })] }, l.id))) }), links.length === 0 && _jsx("p", { className: "muted", children: "No Quick Links yet." }), _jsx("div", { className: "dialog-actions", children: _jsxs("button", { type: "button", className: "btn btn-primary", onClick: () => setDraft({ id: null, title: "", url: "", picture: freePainting(links.map((l) => l.picture)) }), children: [_jsx(Icon, { name: "plus", size: 15 }), " Add a Quick Link"] }) })] }))] }) }));
}

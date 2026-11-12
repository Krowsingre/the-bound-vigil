import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useRef, useState } from "react";
import { api, isApp } from "../api";
import { BookCover } from "../components/BookCover";
import { Icon } from "../components/Icon";
import { Badge, BADGE_NAMES } from "./badges";
import { CollectionPicture } from "./CollectionCards";
import { GALLERY, galleryName, galleryUrl } from "./gallery";
import { newRule, usable } from "./rules";
import { RulesEditor } from "./RulesEditor";
/**
 * Making a new collection or changing one: name, description, type, badge,
 * picture and pinning. A shelf keeps its name and type.
 */
export function CollectionEditor({ collection, books, addBookIds = [], onSaved, onCancel, }) {
    const shelf = collection?.kind === "shelf";
    const [name, setName] = useState(collection?.name ?? "");
    const [description, setDescription] = useState(collection?.description ?? "");
    const [kind, setKind] = useState(collection?.kind ?? "collection");
    const [badge, setBadge] = useState(collection?.badge ?? null);
    const [pinned, setPinned] = useState(collection?.pinned ?? false);
    // Kept while switching to "by hand" and back, so nothing typed is lost.
    const [rules, setRules] = useState(collection?.rules ?? { any: false, rules: [newRule()] });
    const [byRules, setByRules] = useState(!!collection?.rules);
    const [picture, setPicture] = useState({
        picture: collection?.picture ?? null,
        picturePath: collection?.picturePath ?? null,
    });
    const [tab, setTab] = useState(collection?.picture?.startsWith("cover:") ? "covers" : "gallery");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const nameRef = useRef(null);
    useEffect(() => {
        if (!shelf)
            nameRef.current?.focus();
    }, [shelf]);
    const chooseFile = async () => {
        if (!isApp)
            return setError("Choosing a picture from your computer works in the desktop app.");
        try {
            const file = await api.pickCollectionPicture();
            if (file)
                setPicture({ file });
        }
        catch (e) {
            setError(`That picture couldn't be used: ${String(e)}`);
        }
    };
    const save = async () => {
        if (!shelf && !name.trim())
            return setError("Give the collection a name.");
        setBusy(true);
        setError(null);
        const ready = { ...rules, rules: rules.rules.filter(usable) };
        if (byRules && !ready.rules.length)
            return setError("Finish at least one rule, or choose books by hand.");
        const input = {
            name,
            description: description.trim() || null,
            kind: byRules ? "collection" : kind,
            badge,
            pinned,
            rules: byRules ? ready : null,
        };
        try {
            let saved = collection ? await api.updateCollection(collection.id, input) : await api.createCollection(input);
            if (!collection && addBookIds.length && !byRules)
                await api.addToCollection(saved.id, addBookIds);
            if ("file" in picture)
                saved = await api.setCollectionPictureFile(saved.id, picture.file);
            else if (picture.picture !== saved.picture)
                saved = await api.setCollectionPicture(saved.id, picture.picture);
            onSaved(saved);
        }
        catch (e) {
            setError(String(e));
            setBusy(false);
        }
    };
    const shown = "file" in picture ? { picture: null, picturePath: null } : picture;
    const preview = { id: collection?.id ?? "new", covers: books.slice(0, 3), ...shown };
    const current = "file" in picture ? null : picture.picture;
    // A picture chosen before the paintings arrived shows as the one standing in for it.
    const currentGallery = current?.startsWith("gallery:") ? `gallery:${galleryName(current.slice("gallery:".length))}` : null;
    const title = collection ? `Edit ${shelf ? "shelf" : kind === "reading_list" ? "reading list" : "collection"}` : "New collection";
    return (_jsx("div", { className: "dialog-backdrop", onPointerDown: (e) => e.target === e.currentTarget && !busy && onCancel(), children: _jsxs("form", { className: "dialog collection-editor", role: "dialog", "aria-label": title, onSubmit: (e) => {
                e.preventDefault();
                void save();
            }, onKeyDown: (e) => e.key === "Escape" && !busy && onCancel(), children: [_jsxs("div", { className: "editor-preview", children: [_jsx(CollectionPicture, { collection: preview }), _jsxs("span", { className: "editor-preview-name", children: [_jsx(Badge, { name: badge, size: 18 }), name.trim() || "Untitled collection"] })] }), _jsxs("div", { className: "editor-body", children: [_jsx("h2", { children: title }), _jsxs("label", { className: "field", children: [_jsx("span", { children: "Name" }), _jsx("input", { ref: nameRef, value: name, maxLength: 80, disabled: shelf, onChange: (e) => setName(e.target.value), placeholder: "Winter reading, Gothic, Book club\u2026" }), shelf && _jsx("small", { className: "muted", children: "The built-in shelves keep their names." })] }), !shelf && (_jsxs(_Fragment, { children: [_jsxs("label", { className: "field", children: [_jsx("span", { children: "Description" }), _jsx("textarea", { value: description, maxLength: 600, rows: 2, onChange: (e) => setDescription(e.target.value), placeholder: "Optional. A line about what belongs here." })] }), _jsxs("fieldset", { className: "field", children: [_jsx("legend", { children: "Books" }), _jsxs("div", { className: "segmented", role: "radiogroup", "aria-label": "Books", children: [_jsx("button", { type: "button", role: "radio", "aria-checked": !byRules, onClick: () => setByRules(false), children: "Chosen by hand" }), _jsx("button", { type: "button", role: "radio", "aria-checked": byRules, onClick: () => setByRules(true), children: "Filled by rules" })] }), byRules ? (_jsx(RulesEditor, { rules: rules, onChange: setRules })) : (_jsx("small", { className: "muted", children: "You add books yourself, from any book\u2019s menu." }))] }), !byRules && (_jsxs("fieldset", { className: "field", children: [_jsx("legend", { children: "Type" }), _jsx("div", { className: "segmented", role: "radiogroup", "aria-label": "Type", children: [
                                                ["collection", "Collection"],
                                                ["reading_list", "Reading list"],
                                            ].map(([value, label]) => (_jsx("button", { type: "button", role: "radio", "aria-checked": kind === value, onClick: () => setKind(value), children: label }, value))) }), _jsx("small", { className: "muted", children: kind === "reading_list"
                                                ? "A reading list keeps its books in the order you set."
                                                : "A collection lists its newest additions first." })] }))] })), _jsxs("fieldset", { className: "field", children: [_jsx("legend", { children: "Badge" }), _jsxs("div", { className: "badge-grid", role: "radiogroup", "aria-label": "Badge", children: [_jsx("button", { type: "button", role: "radio", "aria-checked": badge === null, className: "badge-none", onClick: () => setBadge(null), children: "None" }), BADGE_NAMES.map((b) => (_jsx("button", { type: "button", role: "radio", "aria-checked": badge === b, "aria-label": b, title: b, onClick: () => setBadge(b), children: _jsx(Badge, { name: b, size: 20 }) }, b)))] })] }), _jsxs("fieldset", { className: "field", children: [_jsx("legend", { children: "Picture" }), _jsx("div", { className: "tabs picture-tabs", role: "tablist", children: [
                                        ["gallery", "TBV gallery"],
                                        ["covers", "Book covers"],
                                        ["computer", "From your computer"],
                                    ].map(([value, label]) => (_jsx("button", { type: "button", role: "tab", "aria-selected": tab === value, className: `tab${tab === value ? " is-active" : ""}`, onClick: () => setTab(value), children: label }, value))) }), tab === "gallery" && (_jsx(_Fragment, { children: _jsx("div", { className: "picture-grid", children: GALLERY.map((g) => {
                                            const value = `gallery:${g.name}`;
                                            return (_jsx("button", { type: "button", "aria-pressed": currentGallery === value, title: g.label, onClick: () => setPicture({ picture: value, picturePath: null }), children: _jsx("img", { src: galleryUrl(g.name, "square") ?? undefined, alt: g.label, loading: "lazy", draggable: false }) }, g.name));
                                        }) }) })), tab === "covers" &&
                                    (books.length ? (_jsx("div", { className: "picture-grid picture-grid-covers", children: books.map((b) => {
                                            const value = `cover:${b.id}`;
                                            return (_jsx("button", { type: "button", "aria-pressed": current === value, title: b.title, onClick: () => setPicture({ picture: value, picturePath: b.coverPath }), children: _jsx(BookCover, { book: b, size: "m" }) }, b.id));
                                        }) })) : (_jsx("p", { className: "muted picture-empty", children: "Add books first, then pick one of their covers." }))), tab === "computer" && (_jsxs("div", { className: "picture-computer", children: [_jsxs("button", { type: "button", className: "btn btn-quiet", onClick: () => void chooseFile(), children: [_jsx(Icon, { name: "image", size: 16 }), " Choose a picture\u2026"] }), _jsx("small", { className: "muted", children: "file" in picture
                                                ? `Picked ${picture.file.split(/[\\/]/).pop()}. It's used when you save.`
                                                : "TBV keeps its own copy, and it goes to your other devices with sync." })] })), current && (_jsx("button", { type: "button", className: "link-btn", onClick: () => setPicture({ picture: null, picturePath: null }), children: "Use the book covers instead of a picture" }))] }), _jsxs("label", { className: "check-row", children: [_jsx("input", { type: "checkbox", checked: pinned, onChange: (e) => setPinned(e.target.checked) }), "Pin to the top of Collections"] }), error && (_jsx("p", { className: "form-error", role: "alert", children: error })), _jsxs("div", { className: "dialog-actions", children: [_jsx("button", { type: "button", className: "btn btn-quiet", onClick: onCancel, disabled: busy, children: "Cancel" }), _jsx("button", { type: "submit", className: "btn btn-primary", disabled: busy, children: collection ? "Save" : "Create" })] })] })] }) }));
}

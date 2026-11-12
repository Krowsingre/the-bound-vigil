import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
// The book's research sources: add each once (a book, an article, a web
// page…), choose the citation style, and cite one at the cursor with the page
// it's from. Opened from the editor's Cite tool, or from the book's menu.
import { useMemo, useState } from "react";
import { Icon } from "../components/Icon";
import { emptySource, FIELD_LABELS, SOURCE_TYPES, citationFormats, citationLabel } from "./sources";
const newId = () => `src-${crypto.randomUUID()}`;
const HINTS = {
    authors: "One a line, as Family, Given. An organisation goes as its name.",
    editors: "One a line, as Family, Given.",
    date: "Year, or year-month-day, e.g. 2024 or 2024-03-18",
    accessed: "e.g. 2026-10-30",
    pages: "e.g. 45-67",
};
export function SourceForm({ source, onSave, onCancel }) {
    const [draft, setDraft] = useState(source);
    const type = SOURCE_TYPES.find((t) => t.value === draft.type) ?? SOURCE_TYPES[0];
    const set = (change) => setDraft((d) => ({ ...d, ...change }));
    return (_jsxs("div", { className: "sources-form", children: [_jsxs("label", { className: "field", children: [_jsx("span", { children: "Kind" }), _jsx("select", { value: draft.type, onChange: (e) => set({ type: e.target.value }), children: SOURCE_TYPES.map((t) => (_jsx("option", { value: t.value, children: t.label }, t.value))) })] }), _jsx("div", { className: "sources-fields", children: type.fields.map((key) => {
                    const label = key === "container" ? (type.container ?? FIELD_LABELS.container) : FIELD_LABELS[key];
                    const many = key === "authors" || key === "editors";
                    const wide = many || key === "title" || key === "container" || key === "url";
                    return (_jsxs("label", { className: `field${wide ? " is-wide" : ""}`, children: [_jsx("span", { children: label }), many ? (_jsx("textarea", { rows: 2, value: draft[key], onChange: (e) => set({ [key]: e.target.value }), placeholder: HINTS[key] })) : (_jsx("input", { value: draft[key], onChange: (e) => set({ [key]: e.target.value }), placeholder: HINTS[key], autoFocus: key === type.fields[0] }))] }, key));
                }) }), _jsxs("div", { className: "dialog-actions", children: [_jsx("button", { type: "button", className: "btn btn-quiet", onClick: onCancel, children: "Cancel" }), _jsx("button", { type: "button", className: "btn btn-primary", disabled: !draft.title.trim(), onClick: () => onSave(draft), children: "Save source" })] })] }));
}
export function SourcesDialog({ sources, style, onChange, onCite, current, onClose, }) {
    const [editing, setEditing] = useState(null);
    const [search, setSearch] = useState("");
    const [locator, setLocator] = useState(current?.locator ?? "");
    const [chosen, setChosen] = useState(current?.source ?? null);
    const [removing, setRemoving] = useState(null);
    const shown = useMemo(() => {
        const q = search.trim().toLowerCase();
        const list = [...sources].sort((a, b) => citationLabel(a, "").localeCompare(citationLabel(b, "")));
        return q ? list.filter((s) => `${s.title} ${s.authors} ${s.container} ${s.date}`.toLowerCase().includes(q)) : list;
    }, [sources, search]);
    const save = (s) => {
        const next = sources.some((x) => x.id === s.id) ? sources.map((x) => (x.id === s.id ? s : x)) : [...sources, s];
        onChange(next, style);
        setEditing(null);
        if (onCite)
            setChosen(s.id);
    };
    const citing = !!onCite;
    const pick = chosen ? sources.find((s) => s.id === chosen) : undefined;
    return (_jsx("div", { className: "dialog-backdrop", onPointerDown: (e) => e.target === e.currentTarget && onClose(), children: _jsxs("div", { className: "dialog writing-dialog sources-dialog", role: "dialog", "aria-label": citing ? "Cite a source" : "Sources", onKeyDown: (e) => e.key === "Escape" && (editing ? setEditing(null) : onClose()), children: [_jsx("h2", { children: editing ? (sources.some((s) => s.id === editing.id) ? "Change source" : "Add a source") : citing ? "Cite a source" : "Sources" }), editing ? (_jsx(SourceForm, { source: editing, onSave: save, onCancel: () => setEditing(null) })) : (_jsxs(_Fragment, { children: [_jsxs("label", { className: "field", children: [_jsx("span", { children: "Citation format" }), _jsx("select", { value: style, onChange: (e) => onChange(sources, e.target.value), children: citationFormats(style).map((s) => (_jsxs("option", { value: s.value, children: [s.label, " \u00B7 ", s.hint] }, s.value))) })] }), _jsx("p", { className: "muted sources-note", children: "The style sets how citations and the Sources page at the back are written. It doesn't change the rest of the book." }), _jsxs("div", { className: "sources-bar", children: [_jsx("input", { type: "search", className: "sources-search", placeholder: "Find a source", "aria-label": "Find a source", value: search, onChange: (e) => setSearch(e.target.value) }), _jsxs("button", { type: "button", className: "btn btn-quiet btn-small", onClick: () => setEditing(emptySource(newId())), children: [_jsx(Icon, { name: "plus", size: 15 }), " Add a source"] })] }), sources.length === 0 ? (_jsx("p", { className: "muted sources-empty", children: "No sources yet. Add the books, articles and pages you draw on, then cite them anywhere in the book." })) : (_jsx("ul", { className: "sources-list", role: citing ? "listbox" : undefined, "aria-label": "Sources", children: shown.map((s) => (_jsxs("li", { className: chosen === s.id ? "is-on" : "", children: [_jsxs("button", { type: "button", className: "sources-item", role: citing ? "option" : undefined, "aria-selected": citing ? chosen === s.id : undefined, onClick: () => (citing ? setChosen(s.id) : setEditing(s)), children: [_jsx("strong", { children: s.title || "Untitled" }), _jsx("span", { className: "muted", children: [s.authors.split("\n")[0], s.container, s.date].filter((x) => x.trim()).join(" · ") || SOURCE_TYPES.find((t) => t.value === s.type)?.label })] }), _jsx("button", { type: "button", className: "icon-btn", "aria-label": `Change ${s.title}`, title: "Change", onClick: () => setEditing(s), children: _jsx(Icon, { name: "edit", size: 15 }) }), _jsx("button", { type: "button", className: "icon-btn", "aria-label": `Remove ${s.title}`, title: "Remove", onClick: () => setRemoving(s), children: _jsx(Icon, { name: "trash", size: 15 }) })] }, s.id))) })), removing && (_jsxs("div", { className: "sources-confirm", role: "alert", children: [_jsxs("span", { children: ["Remove \u201C", removing.title || "Untitled", "\u201D? Citations of it in the text will show as a removed source."] }), _jsx("button", { type: "button", className: "btn btn-quiet btn-small", onClick: () => setRemoving(null), children: "Keep" }), _jsx("button", { type: "button", className: "btn btn-danger btn-small", onClick: () => {
                                        onChange(sources.filter((x) => x.id !== removing.id), style);
                                        if (chosen === removing.id)
                                            setChosen(null);
                                        setRemoving(null);
                                    }, children: "Remove" })] })), _jsxs("div", { className: "dialog-actions", children: [citing && (_jsxs("label", { className: "field sources-locator", children: [_jsx("span", { children: "Page" }), _jsx("input", { value: locator, onChange: (e) => setLocator(e.target.value), placeholder: "e.g. 12 or 45-47", maxLength: 40 })] })), _jsx("button", { type: "button", className: "btn btn-quiet", onClick: onClose, children: citing ? "Cancel" : "Done" }), citing && (_jsx("button", { type: "button", className: "btn btn-primary", disabled: !pick, onClick: () => pick && onCite(pick, locator), children: current ? "Change citation" : "Cite" }))] })] }))] }) }));
}

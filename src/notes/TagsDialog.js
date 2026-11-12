import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { Icon } from "../components/Icon";
import { cleanTags } from "./noteQuery";
import { cardTitle } from "./NoteViews";
/** A note's tags as removable chips, a box for more, and the tags other notes have. */
export function TagEditor({ tags, known, onChange }) {
    const [typed, setTyped] = useState("");
    const add = (words) => {
        const next = cleanTags([...tags, ...words.split(",")]);
        if (next.length !== tags.length)
            onChange(next);
        setTyped("");
    };
    const offered = known.filter((k) => !tags.some((t) => t.toLowerCase() === k.toLowerCase())).slice(0, 12);
    return (_jsxs("div", { className: "tag-editor", children: [_jsxs("div", { className: "tag-editor-chips", children: [tags.map((t) => (_jsxs("span", { className: "note-tag is-removable", children: [t, _jsx("button", { type: "button", "aria-label": `Take off ${t}`, onClick: () => onChange(tags.filter((x) => x !== t)), children: _jsx(Icon, { name: "close", size: 11 }) })] }, t))), _jsx("input", { value: typed, onChange: (e) => (e.target.value.endsWith(",") ? add(e.target.value) : setTyped(e.target.value)), onKeyDown: (e) => {
                            if (e.key === "Enter" && typed.trim()) {
                                e.preventDefault();
                                add(typed);
                            }
                            else if (e.key === "Backspace" && !typed && tags.length)
                                onChange(tags.slice(0, -1));
                        }, onBlur: () => typed.trim() && add(typed), placeholder: tags.length ? "Add another" : "Add a tag", "aria-label": "Add a tag", maxLength: 40 })] }), offered.length > 0 && (_jsx("div", { className: "tag-editor-known", children: offered.map((k) => (_jsxs("button", { type: "button", className: "note-tag is-offered", onClick: () => add(k), children: ["+ ", k] }, k))) }))] }));
}
/** Changing one note's tags. */
export function TagsDialog({ note, known, onSave, onCancel }) {
    const [tags, setTags] = useState(note.tags ?? []);
    return (_jsx("div", { className: "dialog-backdrop", onPointerDown: (e) => e.target === e.currentTarget && onCancel(), children: _jsxs("div", { className: "dialog tags-dialog", role: "dialog", "aria-label": "Tags", onKeyDown: (e) => e.key === "Escape" && onCancel(), children: [_jsx("h2", { children: "Tags" }), _jsxs("p", { className: "muted dialog-lede", children: ["For ", cardTitle(note), ". Press Enter or type a comma after each tag."] }), _jsx(TagEditor, { tags: tags, known: known, onChange: setTags }), _jsxs("div", { className: "dialog-actions", children: [_jsx("button", { type: "button", className: "btn btn-quiet", onClick: onCancel, children: "Cancel" }), _jsx("button", { type: "button", className: "btn btn-primary", onClick: () => onSave(tags), children: "Save" })] })] }) }));
}

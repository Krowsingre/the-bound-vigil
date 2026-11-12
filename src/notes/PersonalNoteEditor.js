import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { FormattedText } from "../writing/FormattedText";
import { personalTitle } from "./noteInfo";
import { TagEditor } from "./TagsDialog";
export function PersonalNoteEditor({ initial, refreshKey, onSaved, onClose }) {
    const [note, setNote] = useState(initial);
    const [title, setTitle] = useState(initial?.title ?? "");
    const [text, setText] = useState(initial?.note ?? "");
    const [tags, setTags] = useState(initial?.tags ?? []);
    const [expanded, setExpanded] = useState(false);
    const [otherNotes, setOtherNotes] = useState([]);
    const [known, setKnown] = useState([]);
    const [listError, setListError] = useState(false);
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const [discard, setDiscard] = useState(null);
    const saving = useRef(false);
    const dialog = useRef(null);
    const titleInput = useRef(null);
    const dirty = title !== (note?.title ?? "") || text !== (note?.note ?? "") ||
        JSON.stringify(tags) !== JSON.stringify(note?.tags ?? []);
    useEffect(() => {
        const el = dialog.current;
        if (!el)
            return;
        const opener = document.activeElement;
        el.showModal();
        titleInput.current?.focus();
        return () => {
            el.close();
            if (opener instanceof HTMLElement && opener.isConnected)
                opener.focus();
        };
    }, []);
    useEffect(() => {
        let current = true;
        void api.getNotes({ tab: "personal", sort: "recent", search: null, bookId: null, colors: [] }).then((page) => {
            if (!current)
                return;
            setOtherNotes(page.notes);
            setKnown(page.tags);
            setListError(false);
        }, () => { if (current)
            setListError(true); });
        return () => { current = false; };
    }, [refreshKey]);
    const load = (next) => {
        setNote(next);
        setTitle(next?.title ?? "");
        setText(next?.note ?? "");
        setTags(next?.tags ?? []);
        setError("");
        titleInput.current?.focus();
    };
    const leave = (close, next) => {
        if (saving.current)
            return;
        if (dirty)
            setDiscard({ close, next });
        else if (close)
            onClose();
        else
            load(next);
    };
    const save = async () => {
        if (saving.current || discard)
            return;
        if (!title.trim() && !text.trim())
            return setError("Write something first.");
        saving.current = true;
        setBusy(true);
        setError("");
        try {
            onSaved(await api.savePersonalNote(note?.id ?? null, title.trim() || null, text, tags), !note);
        }
        catch (failure) {
            setError(String(failure));
            setBusy(false);
            saving.current = false;
        }
    };
    return (_jsx("dialog", { ref: dialog, className: `dialog personal-note-editor${expanded ? " is-expanded" : ""}`, "aria-labelledby": "personal-note-heading", onCancel: (event) => { event.preventDefault(); if (discard)
            setDiscard(null);
        else
            leave(true); }, children: _jsxs("form", { onSubmit: (event) => { event.preventDefault(); void save(); }, onKeyDown: (event) => {
                if (event.defaultPrevented || event.nativeEvent.isComposing || event.key !== "Enter" || !(event.ctrlKey || event.metaKey))
                    return;
                event.preventDefault();
                void save();
            }, children: [_jsxs("header", { className: "personal-note-head", children: [_jsx("h2", { id: "personal-note-heading", children: note ? "Edit personal note" : "New personal note" }), _jsx("button", { type: "button", className: "btn btn-quiet", "aria-pressed": expanded, disabled: busy || !!discard, onClick: () => setExpanded(!expanded), children: expanded ? "Compact view" : "Expand editor" })] }), _jsxs("div", { className: "personal-note-layout", inert: busy || !!discard, children: [_jsxs("aside", { className: "personal-note-sidebar", children: [_jsxs("label", { className: "field", children: [_jsx("span", { children: "Title" }), _jsx("input", { ref: titleInput, value: title, onChange: (event) => setTitle(event.target.value), placeholder: "Optional", maxLength: 120 })] }), _jsxs("fieldset", { className: "personal-note-tags", children: [_jsx("legend", { children: "Tags" }), _jsx(TagEditor, { tags: tags, known: known, onChange: setTags }, note?.id ?? "new")] }), expanded && _jsxs("nav", { className: "personal-note-list", "aria-label": "Other personal notes", children: [_jsx("button", { type: "button", className: "btn btn-quiet btn-small", disabled: busy, onClick: () => leave(false), children: "New personal note" }), otherNotes.filter((item) => item.id !== note?.id).map((item) => (_jsx("button", { type: "button", className: "link-btn", disabled: busy, onClick: () => leave(false, item), children: personalTitle(item) }, item.id))), listError && _jsx("p", { className: "muted", children: "Other notes couldn\u2019t be loaded." })] })] }), _jsx("section", { className: "personal-note-writing", "aria-label": "Note text", children: _jsx(FormattedText, { value: text, onChange: setText, rows: 10, placeholder: "Write freely\u2026", label: "Note text" }, note?.id ?? "new") })] }), error && _jsx("p", { className: "form-error", role: "alert", children: error }), discard ? _jsxs("div", { className: "dialog-actions", role: "group", "aria-label": "Unsaved changes", children: [_jsx("span", { children: "Discard unsaved changes?" }), _jsx("button", { type: "button", className: "btn btn-quiet", autoFocus: true, onClick: (event) => { event.preventDefault(); setDiscard(null); }, children: "Keep editing" }), _jsx("button", { type: "button", className: "btn btn-danger", onClick: () => {
                                setDiscard(null);
                                if (discard.close)
                                    onClose();
                                else
                                    load(discard.next);
                            }, children: "Discard changes" })] }, "discard") : _jsxs("div", { className: "dialog-actions", children: [_jsx("button", { type: "button", className: "btn btn-quiet", onClick: () => leave(true), disabled: busy, children: "Cancel" }), _jsx("button", { type: "submit", className: "btn btn-primary", disabled: busy, children: "Save note" })] }, "save")] }) }));
}

import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
// Editing a book's details, or the same details on many books at once. Book
// files never change: an edit is kept beside the book and shows over its own
// details, and taking the edit away shows them again.
import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { useToast } from "../components/Toast";
import { AUDIO_ONLY, cleanValue, DETAIL_FIELDS, effective, isList, listOf } from "../lib/details";
import { isAudio } from "../lib/queryBooks";
import { ChipInput } from "./ChipInput";
import { AddOrReplace, joined } from "../components/AddOrReplace";
/** The details that make sense to set on many books at once. */
const MASS_FIELDS = ["authors", "series", "genres", "publisher", "published", "language"];
const toForm = (field, value) => (isList(field) ? listOf(value) : (value ?? ""));
const fromForm = (value) => (Array.isArray(value) ? JSON.stringify(value) : value);
export function DetailsEditor({ books, onClose }) {
    const many = books.length > 1;
    const toast = useToast();
    const [fields, setFields] = useState(many ? [] : null);
    const [values, setValues] = useState({});
    // Many books: only the details ticked here change.
    const [chosen, setChosen] = useState(new Set());
    // Lists (authors, genres, narrators): add to what a book has, or replace it.
    // Many books start on Add; one book shows its list to change.
    const [modes, setModes] = useState({});
    const modeOf = (field) => modes[field] ?? (many ? "add" : "replace");
    const [error, setError] = useState(null);
    const [saving, setSaving] = useState(false);
    const [confirmation, setConfirmation] = useState(null);
    const close = useRef(onClose);
    close.current = onClose;
    useEffect(() => {
        if (many)
            return;
        api.bookDetails(books[0].id).then((d) => {
            setFields(d.fields);
            setValues(Object.fromEntries(d.fields.map((f) => [f.field, toForm(f.field, effective(f))])));
        }, (e) => {
            toast(`Couldn't open the details: ${String(e)}`);
            close.current(false);
        });
    }, [many, books, toast]);
    const set = (field, value) => {
        setValues((v) => ({ ...v, [field]: value }));
        if (many)
            setChosen((c) => new Set(c).add(field));
        setError(null);
    };
    /** A list a book has now, as it shows. */
    const listNow = (book, field) => {
        if (!many)
            return listOf(effective(fields?.find((f) => f.field === field) ?? {}) ?? null);
        return (field === "authors" ? book.authors : field === "genres" ? book.genres : (book.narrators ?? [])) ?? [];
    };
    /** What's typed, joined to what `book` has where the field adds. */
    const typedFor = (book, field, typed) => Array.isArray(typed) && modeOf(field) === "add" ? joined(listNow(book, field), typed) : typed;
    const changes = (book) => {
        if (many)
            return [...chosen].flatMap((field) => {
                const v = values[field] ?? (isList(field) ? [] : "");
                // Adding nothing changes nothing.
                if (Array.isArray(v) && !v.length && modeOf(field) === "add")
                    return [];
                return [{ field, value: cleanValue(field, fromForm(typedFor(book, field, v))) }];
            });
        const out = [];
        for (const f of fields ?? []) {
            const typed = values[f.field];
            if (typed === undefined)
                continue;
            const value = cleanValue(f.field, fromForm(typedFor(book, f.field, typed)));
            const shown = effective(f);
            if (value === (shown ?? (isList(f.field) ? "[]" : "")))
                continue;
            // Back to what it would show anyway: take the edit away instead of keeping a copy.
            const beneath = f.fetched ?? f.own;
            out.push({ field: f.field, value: beneath !== null && value === beneath ? null : value });
        }
        return out;
    };
    const save = async () => {
        // Books whose changes come out the same are saved together.
        const groups = new Map();
        try {
            for (const book of books) {
                const list = changes(book);
                if (!list.length)
                    continue;
                const key = JSON.stringify(list);
                const group = groups.get(key) ?? { ids: [], list };
                group.ids.push(book.id);
                groups.set(key, group);
            }
        }
        catch (e) {
            return setError(e instanceof Error ? e.message : String(e));
        }
        if (!groups.size)
            return onClose(false);
        setSaving(true);
        try {
            const touched = new Set();
            let count = 0;
            for (const group of groups.values()) {
                for (const id of group.ids) {
                    const current = (await api.bookDetails(id)).fields;
                    const conflicts = group.list.filter((change) => current.some((field) => field.field === change.field && field.fetched !== null && field.fetchedFrom && field.fetchedFrom !== "file" &&
                        (field.edited === null || field.edited === field.fetched) && change.value !== null && change.value !== field.fetched));
                    if (conflicts.length) {
                        count++;
                        conflicts.forEach((change) => touched.add(change.field));
                    }
                }
            }
            if (count) {
                setSaving(false);
                setConfirmation({ groups: [...groups.values()], fields: DETAIL_FIELDS.filter((entry) => touched.has(entry.field)).map((entry) => entry.label), count });
                return;
            }
            apply([...groups.values()]);
        }
        catch (failure) {
            setSaving(false);
            setError(String(failure));
        }
    };
    const apply = (groups) => {
        setConfirmation(null);
        setSaving(true);
        groups.reduce((done, g) => done.then(() => api.editDetails(g.ids, g.list)), Promise.resolve())
            .then(() => {
            toast(many ? `Updated ${books.length} books.` : `Saved the details of “${books[0].title}”.`);
            onClose(true);
        }, (e) => {
            setSaving(false);
            setError(String(e));
        });
    };
    // Narrators belong to audiobooks only.
    const audio = books.every((b) => isAudio(b.format));
    const shownFields = DETAIL_FIELDS.filter((f) => (!many || MASS_FIELDS.includes(f.field) || (audio && f.field === "narrators")) && (audio || !AUDIO_ONLY.includes(f.field)));
    const undoEdit = (f) => {
        setModes((m) => ({ ...m, [f.field]: "replace" }));
        set(f.field, toForm(f.field, f.fetched ?? f.own));
    };
    const chooseMode = (field, mode) => {
        if (mode === modeOf(field))
            return;
        setModes((m) => ({ ...m, [field]: mode }));
        // One book: Replace shows the list it has, Add starts empty.
        if (!many) {
            const had = listNow(books[0], field);
            const typed = values[field] ?? [];
            set(field, mode === "replace" ? joined(had, typed) : typed.filter((t) => !had.includes(t)));
        }
    };
    return (_jsxs(_Fragment, { children: [_jsx("div", { className: "dialog-backdrop", onPointerDown: (e) => e.target === e.currentTarget && onClose(false), children: _jsxs("div", { className: "dialog details-dialog", role: "dialog", "aria-label": many ? "Edit details of many books" : "Edit details", onKeyDown: (e) => e.key === "Escape" && onClose(false), children: [_jsx("h2", { children: many ? `Edit ${books.length} books` : "Edit details" }), _jsx("p", { className: "muted add-dialog-book", children: many
                                ? "Tick the details to change. They're set the same on every book you chose; the rest stay as they are."
                                : books[0].title }), fields === null ? (_jsx("div", { className: "library-loading", "aria-busy": "true", "aria-label": "Loading the details" })) : (_jsx("div", { className: "details-form", children: shownFields.map(({ field, label, long }) => {
                                const f = fields.find((x) => x.field === field);
                                const value = values[field] ?? (isList(field) ? [] : "");
                                const off = many && !chosen.has(field);
                                return (_jsxs("div", { className: `field details-field${off ? " is-off" : ""}`, children: [_jsxs("span", { className: "details-field-head", children: [many ? (_jsxs("label", { className: "check-row", children: [_jsx("input", { type: "checkbox", checked: !off, onChange: (e) => setChosen((c) => {
                                                                const next = new Set(c);
                                                                if (e.target.checked)
                                                                    next.add(field);
                                                                else
                                                                    next.delete(field);
                                                                return next;
                                                            }) }), label] })) : (_jsx("label", { htmlFor: `detail-${field}`, children: label })), f?.edited !== null && f?.edited !== undefined && (_jsx("button", { type: "button", className: "view-all", onClick: () => undoEdit(f), children: "Undo my edit" }))] }), Array.isArray(value) && (_jsx(AddOrReplace, { mode: modeOf(field), onChange: (m) => chooseMode(field, m), label: `Add to or replace ${label.toLowerCase()}` })), Array.isArray(value) && modeOf(field) === "add" && !many && listNow(books[0], field).length > 0 && (_jsxs("span", { className: "details-origin", children: ["Joins ", listNow(books[0], field).join(", "), "."] })), Array.isArray(value) ? (_jsx(ChipInput, { value: value, onChange: (v) => set(field, v), label: label, placeholder: field === "genres" ? "Type a genre and press Enter" : "Type a name and press Enter" })) : long ? (_jsx("textarea", { id: `detail-${field}`, rows: 6, value: value, onChange: (e) => set(field, e.target.value) })) : (_jsx("input", { id: `detail-${field}`, value: value, inputMode: field === "series_index" ? "decimal" : undefined, placeholder: field === "published"
                                                ? "Like 1897 or 1897-05-26"
                                                : field === "language"
                                                    ? "Like en or English"
                                                    : undefined, "aria-label": many ? label : undefined, onChange: (e) => set(field, e.target.value) }))] }, field));
                            }) })), error && (_jsx("p", { className: "form-error", role: "alert", children: error })), _jsxs("div", { className: "dialog-actions", children: [_jsx("button", { type: "button", className: "btn btn-quiet", onClick: () => onClose(false), children: "Cancel" }), _jsx("button", { type: "button", className: "btn btn-primary", disabled: saving || fields === null || (many && !chosen.size), onClick: save, children: many ? `Change ${books.length} books` : "Save" })] })] }) }), confirmation && (_jsx(ConfirmDialog, { title: "Replace details found online?", body: confirmation.fields.join(", ") + (confirmation.count === 1 ? " on one book" : " on " + confirmation.count + " books") + " will use your edits.", confirm: "Apply my edits", onConfirm: () => apply(confirmation.groups), onCancel: () => setConfirmation(null) }))] }));
}

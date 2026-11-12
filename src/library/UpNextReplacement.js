import { jsxs as _jsxs, jsx as _jsx, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { api } from "../api";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { UP_NEXT_LIMIT } from "./shelfLimits";
const REPLACE = "tbv:replace-up-next";
export function askUpNextReplacement(book) {
    window.dispatchEvent(new CustomEvent(REPLACE, { detail: book }));
}
export function UpNextReplacementHost({ onChanged }) {
    const [book, setBook] = useState(null);
    const [members, setMembers] = useState([]);
    const [picked, setPicked] = useState("");
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        const open = (event) => setBook(event.detail);
        window.addEventListener(REPLACE, open);
        return () => window.removeEventListener(REPLACE, open);
    }, []);
    useEffect(() => {
        if (!book)
            return;
        let active = true;
        setMembers([]);
        setPicked("");
        setError("");
        void api.getLibrary({ shelf: "want_to_read", sort: "title", search: null, formats: [], location: null, page: 0, pageSize: UP_NEXT_LIMIT }).then((page) => { if (active)
            setMembers(page.books); }, (failure) => { if (active)
            setError(String(failure)); });
        return () => { active = false; };
    }, [book]);
    if (!book)
        return null;
    const replace = async () => {
        if (busy || !picked)
            return;
        setBusy(true);
        try {
            await api.setWantToRead(book.id, true, picked);
            onChanged();
            setBook(null);
        }
        catch (failure) {
            setError(String(failure));
        }
        finally {
            setBusy(false);
        }
    };
    return (_jsx(ConfirmDialog, { title: "Replace a book in Up Next", body: _jsxs(_Fragment, { children: [_jsxs("p", { children: ["Up Next holds 15 books. Choose which book to replace with \u201C", book.title, "\u201D."] }), _jsxs("label", { children: ["Book to replace", _jsxs("select", { disabled: busy || !members.length, value: picked, onChange: (event) => { setPicked(event.target.value); setError(""); }, children: [_jsx("option", { value: "", children: "Choose a book" }), members.map((member) => _jsxs("option", { value: member.id, children: [member.title, " \u00B7 ", member.authors.join(", ")] }, member.id))] })] }), error && _jsx("p", { role: "alert", children: error })] }), confirm: busy ? "Replacing..." : "Replace", confirmDisabled: busy || !picked, onConfirm: () => void replace(), onCancel: () => { if (!busy)
            setBook(null); } }));
}

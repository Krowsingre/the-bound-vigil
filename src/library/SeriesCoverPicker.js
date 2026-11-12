import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { api } from "../api";
import { BookCover } from "../components/BookCover";
import { ConfirmDialog } from "../components/ConfirmDialog";
export function SeriesCoverPicker({ name, kind, chosen, onChoose, onClose }) {
    const [page, setPage] = useState(0);
    const [result, setResult] = useState();
    const [error, setError] = useState("");
    const [selected, setSelected] = useState(chosen ?? "");
    useEffect(() => {
        let current = true;
        void api.getLibrary({ kind, series: [name], shelf: "all", sort: "series", search: null, formats: [], location: null, page, pageSize: 16, omitFacets: true })
            .then((data) => { if (current)
            setResult(data); }, (failure) => { if (current)
            setError(String(failure)); });
        return () => { current = false; };
    }, [kind, name, page]);
    return _jsx(ConfirmDialog, { title: `Choose cover for ${name}`, confirm: "Use this cover", confirmDisabled: !selected, onConfirm: () => onChoose(selected), onCancel: onClose, body: error ? _jsx("p", { role: "alert", children: error }) : !result ? _jsx("p", { children: "Loading books\u2026" }) : _jsxs(_Fragment, { children: [_jsxs("fieldset", { className: "series-cover-options", children: [_jsx("legend", { children: "Books in this series" }), result.books.map((book) => _jsxs("label", { className: "series-cover-option", children: [_jsx("input", { type: "radio", name: "series-cover", checked: selected === book.id, onChange: () => setSelected(book.id) }), _jsx(BookCover, { book: book, size: "s" }), _jsxs("span", { children: [book.seriesIndex != null && `#${book.seriesIndex} · `, book.title] })] }, book.id))] }), result.total > result.pageSize && _jsxs("div", { children: [_jsx("button", { type: "button", disabled: !page, onClick: () => setPage(page - 1), children: "Previous" }), _jsx("button", { type: "button", disabled: (page + 1) * result.pageSize >= result.total, onClick: () => setPage(page + 1), children: "Next" })] })] }) });
}

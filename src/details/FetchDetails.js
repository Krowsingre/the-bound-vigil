import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
// Finding a book's details online: search Google Books and Open Library,
// choose the match, then tick which details to keep. What's kept is saved as
// fetched details, under your own edits and over the book's own.
import { useCallback, useEffect, useRef, useState } from "react";
import { api, isApp } from "../api";
import { BookCover } from "../components/BookCover";
import { Icon } from "../components/Icon";
import { useToast } from "../components/Toast";
import { AUDIO_ONLY, DETAIL_FIELDS, cleanValue, detailLabel, effective, isList, listOf } from "../lib/details";
import { foundValues, openLibraryDescription, searchOnline, SOURCE_NAME } from "../lib/onlineDetails";
import { isAudio } from "../lib/queryBooks";
function shown(field, value) {
    if (!value)
        return "";
    return isList(field) ? listOf(value).join(", ") : value;
}
export function FetchDetails({ book, onClose }) {
    const toast = useToast();
    const [details, setDetails] = useState(null);
    const [query, setQuery] = useState({ title: book.title, author: book.authors[0] ?? "", isbn: "" });
    const [results, setResults] = useState(null);
    const [searching, setSearching] = useState(false);
    const [error, setError] = useState(null);
    const [chosen, setChosen] = useState(null);
    const [values, setValues] = useState({});
    const [edits, setEdits] = useState({});
    const [keep, setKeep] = useState(new Set());
    const [cover, setCover] = useState(false);
    const [saving, setSaving] = useState(false);
    const running = useRef(null);
    const search = useCallback((q) => {
        running.current?.abort();
        const stop = new AbortController();
        running.current = stop;
        setSearching(true);
        setError(null);
        searchOnline(q, stop.signal, isApp ? (source, lookup) => api.searchDetailsMore(source, lookup.title, lookup.author) : undefined).then((found) => {
            if (stop.signal.aborted)
                return;
            setResults(found);
            setSearching(false);
        }, (e) => {
            if (stop.signal.aborted)
                return;
            setError(e instanceof Error ? e.message : String(e));
            setResults([]);
            setSearching(false);
        });
    }, []);
    // Search straight away with what the book already says.
    useEffect(() => {
        api.bookDetails(book.id).then((d) => {
            setDetails(d);
            const isbn = d.fields.find((f) => f.field === "isbn");
            const q = { title: book.title, author: book.authors[0] ?? "", isbn: (isbn && effective(isbn)) ?? "" };
            setQuery(q);
            search(q);
        }, () => search({ title: book.title, author: book.authors[0] ?? "", isbn: "" }));
        return () => running.current?.abort();
    }, [book, search]);
    const choose = async (f) => {
        setChosen(f);
        setEdits({});
        setError(null);
        let found = f;
        // Open Library keeps descriptions on the work's own page.
        if (f.source === "openlibrary" && f.workKey && !f.synopsis) {
            const stop = new AbortController();
            running.current = stop;
            try {
                const synopsis = await openLibraryDescription(f.workKey, stop.signal);
                found = { ...f, synopsis };
            }
            catch {
                /* the rest is still worth keeping */
            }
        }
        const v = foundValues(found);
        setValues(v);
        // Ticked to start with: what the book is missing, or differs from what it shows.
        const fields = details?.fields ?? [];
        setKeep(new Set(Object.keys(v).filter((field) => {
            const current = fields.find((x) => x.field === field);
            const now = current ? effective(current) : null;
            return field !== "title" && (!now || now === "[]" || now !== v[field]) && !(current && current.edited !== null);
        })));
        // Offered for every book; ticked to start with only where there's none.
        setCover(Boolean(found.coverUrl && !book.coverPath && isApp));
    };
    const save = async () => {
        if (!chosen)
            return;
        setSaving(true);
        setError(null);
        try {
            const picked = Object.fromEntries(DETAIL_FIELDS.filter(({ field }) => keep.has(field) && values[field] !== undefined).map(({ field }) => {
                const edit = edits[field];
                const value = edit === undefined ? values[field] : isList(field) ? JSON.stringify(edit.split("\n")) : edit;
                const cleaned = cleanValue(field, value);
                if (!cleaned || cleaned === "[]")
                    throw new Error(`Enter a value for ${detailLabel(field)} or uncheck it.`);
                return [field, cleaned];
            }));
            if (Object.keys(picked).length)
                await api.saveFetched(book.id, chosen.source, picked);
            if (cover && chosen.coverUrl)
                await api.fetchCover(book.id, chosen.coverUrl);
            toast(`Kept ${Object.keys(picked).length + (cover ? 1 : 0)} details from ${SOURCE_NAME[chosen.source]}.`);
            onClose(true);
        }
        catch (e) {
            setSaving(false);
            setError(`Couldn't save: ${e instanceof Error ? e.message : String(e)}`);
        }
    };
    const toggle = (field) => setKeep((k) => {
        const next = new Set(k);
        if (next.has(field))
            next.delete(field);
        else
            next.add(field);
        return next;
    });
    return (_jsx("div", { className: "dialog-backdrop", onPointerDown: (e) => e.target === e.currentTarget && onClose(false), children: _jsxs("div", { className: "dialog fetch-dialog", role: "dialog", "aria-label": "Find details online", onKeyDown: (e) => e.key === "Escape" && onClose(false), children: [_jsx("h2", { children: "Find details online" }), _jsxs("p", { className: "muted add-dialog-book", children: [book.title, ". Searches Google Books, Open Library", isApp ? ", Audible and Hardcover (when it's connected)" : "", ". Your book file isn't changed."] }), !chosen ? (_jsxs(_Fragment, { children: [_jsxs("form", { className: "fetch-search", onSubmit: (e) => {
                                e.preventDefault();
                                search(query);
                            }, children: [_jsxs("label", { className: "field", children: [_jsx("span", { children: "Title" }), _jsx("input", { value: query.title, onChange: (e) => setQuery({ ...query, title: e.target.value }) })] }), _jsxs("label", { className: "field", children: [_jsx("span", { children: "Author" }), _jsx("input", { value: query.author, onChange: (e) => setQuery({ ...query, author: e.target.value }) })] }), _jsxs("label", { className: "field", children: [_jsx("span", { children: "ISBN" }), _jsx("input", { value: query.isbn, placeholder: "Optional", onChange: (e) => setQuery({ ...query, isbn: e.target.value }) })] }), _jsxs("button", { type: "submit", className: "btn btn-quiet", disabled: searching, children: [_jsx(Icon, { name: "search", size: 16 }), " Search"] })] }), error && (_jsx("p", { className: "form-error", role: "alert", children: error })), _jsx("div", { className: "fetch-results", "aria-busy": searching, children: searching ? (_jsx("div", { className: "library-loading", "aria-label": "Searching" })) : results && results.length === 0 ? (!error && _jsx("p", { className: "muted", children: "Nothing found. Try fewer words, or just the ISBN." })) : (results?.map((r) => (_jsxs("button", { type: "button", className: "fetch-result", onClick: () => void choose(r), children: [_jsx("span", { className: "fetch-thumb", children: r.coverUrl ? _jsx("img", { className: "private-picture", src: r.coverUrl, alt: "", loading: "lazy" }) : _jsx(Icon, { name: "image", size: 18 }) }), _jsxs("span", { className: "fetch-result-text", children: [_jsx("strong", { children: r.title }), _jsx("span", { className: "muted", children: [r.authors.join(", "), r.published?.slice(0, 4), r.publisher].filter(Boolean).join(" · ") }), (r.series || r.narrators?.length) && (_jsx("span", { className: "muted", children: [r.series && `${r.series}${r.seriesIndex ? ` #${r.seriesIndex}` : ""}`, r.narrators?.length && `Read by ${r.narrators.join(", ")}`]
                                                    .filter(Boolean)
                                                    .join(" · ") })), _jsx("span", { className: "fetch-source", children: SOURCE_NAME[r.source] })] })] }, r.id)))) }), _jsx("div", { className: "dialog-actions", children: _jsx("button", { type: "button", className: "btn btn-quiet", onClick: () => onClose(false), children: "Cancel" }) })] })) : (_jsxs(_Fragment, { children: [_jsxs("p", { className: "fetch-chosen", children: ["From ", SOURCE_NAME[chosen.source], ". Tick what to keep.", details?.fields.some((f) => f.edited !== null && values[f.field]) &&
                                    " A checked value replaces your manual edit for that field."] }), _jsxs("div", { className: "fetch-compare", role: "table", "aria-label": "Details found", children: [_jsxs("div", { className: "fetch-row fetch-row-head", role: "row", children: [_jsx("span", { role: "columnheader" }), _jsx("span", { role: "columnheader", children: "Now" }), _jsx("span", { role: "columnheader", children: "Found" })] }), DETAIL_FIELDS.filter((f) => values[f.field] && (isAudio(book.format) || !AUDIO_ONLY.includes(f.field))).map(({ field, long }) => {
                                    const current = details?.fields.find((x) => x.field === field);
                                    return (_jsxs("div", { className: "fetch-row", role: "row", children: [_jsxs("label", { role: "cell", className: "fetch-field", children: [_jsx("input", { type: "checkbox", checked: keep.has(field), onChange: () => toggle(field) }), detailLabel(field)] }), _jsx("span", { role: "cell", className: "fetch-now", children: shown(field, current ? effective(current) : null) || _jsx("em", { className: "muted", children: "Empty" }) }), _jsx("span", { role: "cell", className: "fetch-found", children: long || isList(field) ? (_jsx("textarea", { "aria-label": `Found ${detailLabel(field)}`, rows: long ? 4 : 2, value: edits[field] ?? (isList(field) ? listOf(values[field]).join("\n") : values[field]), onChange: (event) => setEdits({ ...edits, [field]: event.target.value }) })) : (_jsx("input", { "aria-label": `Found ${detailLabel(field)}`, value: edits[field] ?? values[field], onChange: (event) => setEdits({ ...edits, [field]: event.target.value }) })) })] }, field));
                                }), chosen.coverUrl && isApp && (_jsxs("label", { className: "fetch-row", role: "row", children: [_jsxs("span", { role: "cell", className: "fetch-field", children: [_jsx("input", { type: "checkbox", checked: cover, onChange: (e) => setCover(e.target.checked) }), "Cover"] }), _jsx("span", { role: "cell", className: "fetch-now", children: book.coverPath ? _jsx(BookCover, { book: book, size: "s" }) : _jsx("em", { className: "muted", children: "None" }) }), _jsx("span", { role: "cell", className: "fetch-found", children: _jsx("img", { className: "fetch-cover", src: chosen.coverUrl, alt: "" }) })] }))] }), error && (_jsx("p", { className: "form-error", role: "alert", children: error })), _jsxs("div", { className: "dialog-actions", children: [_jsx("button", { type: "button", className: "btn btn-quiet", onClick: () => setChosen(null), children: "Back to results" }), _jsx("button", { type: "button", className: "btn btn-primary", disabled: saving || (!keep.size && !cover), onClick: () => void save(), children: "Keep ticked details" })] })] }))] }) }));
}

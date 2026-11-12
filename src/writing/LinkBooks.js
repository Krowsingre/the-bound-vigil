import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
// Linking two books that were started separately: as editions of one book
// (a first and second edition, a revised version, a translation…), or the
// other book kept as a locked draft of this one. The other book itself is
// never changed when it becomes a draft; it stays in Scribe until deleted.
import { useMemo, useState } from "react";
import { api } from "../api";
import { editionName, editionOrFirst } from "./bookEditions";
import { exportProblems, readExport } from "./epub";
import { makeEpub } from "./WritingDialogs";
import { isSample } from "./sampleBook";
/** The edition settings each book should end with, so `other` (and any editions it already had) join `book`'s editions. */
export function linkEditions(book, other, all, place) {
    const ours = editionOrFirst(readExport(book.export), book.createdAt.slice(0, 4));
    const theirs = editionOrFirst(readExport(other.export), other.createdAt.slice(0, 4));
    const group = (b) => readExport(b.export).edition?.group;
    const members = (g, self, own) => {
        const list = all.filter((b) => b.id !== self.id && group(b) === g).map((b) => ({ id: b.id, edition: readExport(b.export).edition }));
        return [...list, { id: self.id, edition: own }].sort((a, b) => a.edition.number - b.edition.number);
    };
    const ourSide = members(ours.group, book, ours);
    // Already linked: nothing moves.
    if (ours.group === theirs.group)
        return new Map(ourSide.map((m) => [m.id, m.edition]));
    const theirSide = members(theirs.group, other, theirs).filter((m) => !ourSide.some((o) => o.id === m.id));
    const order = place === "after" ? [...ourSide, ...theirSide] : [...theirSide, ...ourSide];
    const out = new Map();
    order.forEach((m, i) => {
        const number = i + 1;
        // A name the writer typed stays; the usual "Second edition" follows the new number.
        const named = m.edition.name.trim() && m.edition.name !== editionName(m.edition.number);
        out.set(m.id, { ...m.edition, group: ours.group, number, name: named ? m.edition.name : editionName(number) });
    });
    return out;
}
export function LinkBookDialog({ project, books, onDone, onCancel, }) {
    // The sample book (Paradise Lost) is never offered.
    const choices = useMemo(() => books.filter((b) => b.id !== project.id && !isSample(b)).sort((a, b) => a.title.localeCompare(b.title)), [books, project.id]);
    const [otherId, setOtherId] = useState(choices[0]?.id ?? "");
    const [as, setAs] = useState("edition");
    const [place, setPlace] = useState("after");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const other = choices.find((b) => b.id === otherId) ?? null;
    const linked = !!other && readExport(other.export).edition?.group != null && readExport(other.export).edition?.group === readExport(project.export).edition?.group;
    const link = async () => {
        if (!other)
            return;
        setBusy(true);
        setError(null);
        try {
            if (as === "edition") {
                const plan = linkEditions(project, other, books, place);
                for (const [id, edition] of plan) {
                    const b = id === project.id ? project : books.find((x) => x.id === id);
                    if (!b)
                        continue;
                    const settings = readExport(b.export);
                    if (JSON.stringify(settings.edition) === JSON.stringify(edition))
                        continue;
                    await api.setWritingExport(id, JSON.stringify({ ...settings, edition }));
                }
                const name = plan.get(other.id)?.name.toLowerCase();
                onDone(name ? `Linked. ${other.title} is now the ${name}.` : "Linked as editions of one book.");
            }
            else {
                const view = await api.writingProject(other.id);
                const problems = exportProblems(view.chapters);
                if (problems.length)
                    throw new Error(`${other.title} has nothing written in it yet.`);
                const next = (await api.writingDrafts(project.id)).reduce((n, d) => Math.max(n, d.number), 0) + 1;
                const draft = await api.saveWritingDraft(project.id, await makeEpub({ ...project, title: `${project.title} (Draft ${next})` }, view.chapters, readExport(view.project.export)));
                onDone(`${other.title} is kept as Draft ${draft.number} of this book. It's still in Scribe too; delete it there if you don't need it.`);
            }
        }
        catch (e) {
            setError(String(e).replace(/^Error: /, ""));
            setBusy(false);
        }
    };
    return (_jsx("div", { className: "dialog-backdrop", onPointerDown: (e) => e.target === e.currentTarget && !busy && onCancel(), children: _jsxs("form", { className: "dialog writing-dialog link-books", role: "dialog", "aria-label": "Link another book", onSubmit: (e) => {
                e.preventDefault();
                void link();
            }, onKeyDown: (e) => e.key === "Escape" && !busy && onCancel(), children: [_jsx("h2", { children: "Link another book" }), _jsx("p", { className: "muted dialog-lede", children: "For two books you started separately that are really one book: an earlier edition, a revised version, or a draft." }), choices.length === 0 ? (_jsx("p", { className: "muted", children: "There are no other books in Scribe to link." })) : (_jsxs(_Fragment, { children: [_jsxs("label", { className: "field", children: [_jsx("span", { children: "The other book" }), _jsx("select", { value: otherId, onChange: (e) => setOtherId(e.target.value), children: choices.map((b) => (_jsxs("option", { value: b.id, children: [b.title, b.author ? ` · ${b.author}` : ""] }, b.id))) })] }), _jsxs("fieldset", { className: "import-into", "aria-label": "Link it as", children: [_jsxs("label", { className: "check-row", children: [_jsx("input", { type: "radio", name: "link-as", checked: as === "edition", onChange: () => setAs("edition") }), _jsxs("span", { children: [_jsx("strong", { children: "Another edition or version" }), _jsx("span", { className: "muted", children: " \u00B7 both stay books you can write in, linked under Editions, each with its own ISBNs." })] })] }), as === "edition" && (_jsxs("div", { className: "segmented link-books-place", role: "radiogroup", "aria-label": "Which comes first", children: [_jsx("button", { type: "button", role: "radio", "aria-checked": place === "before", className: place === "before" ? "is-active" : "", onClick: () => setPlace("before"), children: "It came before this one" }), _jsx("button", { type: "button", role: "radio", "aria-checked": place === "after", className: place === "after" ? "is-active" : "", onClick: () => setPlace("after"), children: "It came after this one" })] })), _jsxs("label", { className: "check-row", children: [_jsx("input", { type: "radio", name: "link-as", checked: as === "draft", onChange: () => setAs("draft") }), _jsxs("span", { children: [_jsx("strong", { children: "A draft of this book" }), _jsx("span", { className: "muted", children: " \u00B7 kept locked under Drafts, to read, highlight and make notes in." })] })] })] }), linked && as === "edition" && _jsx("p", { className: "muted writing-export-note", children: "These two are already editions of the same book." })] })), error && (_jsx("p", { className: "form-error", role: "alert", children: error })), _jsxs("div", { className: "dialog-actions", children: [_jsx("button", { type: "button", className: "btn btn-quiet", onClick: onCancel, disabled: busy, children: "Cancel" }), _jsx("button", { type: "submit", className: "btn btn-primary", disabled: busy || !other || (linked && as === "edition"), children: busy ? "Linking…" : "Link" })] })] }) }));
}

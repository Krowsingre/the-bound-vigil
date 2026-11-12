import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { RememberedDetails } from "../components/RememberedDetails";
// Bringing a manuscript written elsewhere into Scribe, in stages:
// 1. choose the file, which is only looked at (nothing is made yet);
// 2. confirm you own it or may publish it, a box that is never ticked for
//    you and that no import skips;
// 3. check how it was rebuilt: its sections in Front, Body and Back, what
//    each one is, and anything to check;
// 4. the book is made, with a signed record of the confirmation and the
//    original file kept beside it. The report goes into the book's notes.
// A Scribe book file (.tbv) is confirmed the same way, then opened exactly
// as it was saved, with nothing rebuilt or guessed (see tbvFile.ts).
// Opened from a book's Drafts, the file comes in as another draft of that
// book instead: kept as a locked draft to read, or made the version being
// written (the words there now are kept as a draft first).
import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { Icon } from "../components/Icon";
import { formatBytes } from "../settings/controls";
import { ACK_CONFIRMATION, ACK_PARAGRAPHS, ACK_TITLE, POLICY_VERSION, sha256Hex, WORDING } from "./acknowledgment";
import { AuthorLabel } from "./AuthorInfo";
import { exportProblems, readExport } from "./epub";
import { pictureAddress } from "./extensions";
import { bestSplit, readDocumentBytes, readDraftEpub } from "./importDoc";
import { buildManuscript, inspect, MANUSCRIPT_ACCEPT, MARK_HELP } from "./manuscript";
import { ADD_MENUS, KINDS, writePage, readPage } from "./pages";
import { bookFromTbv } from "./openTbv";
import { readTbv } from "./tbvFile";
import { makeEpub } from "./WritingDialogs";
const SPLITS = [
    { value: "spine", label: "Keep the draft pages" },
    { value: "marks", label: "At its page marks (===)" },
    { value: "headings", label: "At its headings" },
    { value: "lines", label: "At lines like \"Chapter 1\"" },
    { value: "none", label: "Don't split: one section" },
];
const AREAS = [
    { area: "front", label: "Front matter" },
    { area: "chapter", label: "Body" },
    { area: "back", label: "Back matter" },
];
/** Large pictures are made the size Scribe keeps, as when one is added by hand. */
async function shrinkPictures(html) {
    const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
    for (const img of doc.querySelectorAll("img")) {
        const src = img.getAttribute("src") ?? "";
        if (src.length < 400_000)
            continue;
        try {
            const blob = await (await fetch(src)).blob();
            img.setAttribute("src", await pictureAddress(new File([blob], "picture", { type: blob.type })));
        }
        catch {
            // Kept as it came.
        }
    }
    return doc.body.innerHTML;
}
const escapeHtml = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** The report, as a note kept with the book. */
function reportNote(m, fileName) {
    const lines = m.issues.map((i) => {
        const where = i.section === null ? "" : `${m.sections[i.section]?.title || "A poem"}: `;
        return `<li>${escapeHtml(where + i.message)}</li>`;
    });
    return `<p>Imported from ${escapeHtml(fileName)}. Check these against the original before publishing:</p><ul>${lines.join("")}</ul>`;
}
/** Keeps a book's words as they are now as its next draft. Returns false when there's nothing written to keep. */
async function keepAsDraft(projectId) {
    const view = await api.writingProject(projectId);
    if (exportProblems(view.chapters).length)
        return false;
    const next = (await api.writingDrafts(projectId)).reduce((n, d) => Math.max(n, d.number), 0) + 1;
    await api.saveWritingDraft(projectId, await makeEpub({ ...view.project, title: `${view.project.title} (Draft ${next})` }, view.chapters, readExport(view.project.export)));
    return true;
}
/** Saves the chapters of `from` as the next draft of `into`, in `into`'s name and with `settings`' styles. */
async function draftFrom(from, into, styles) {
    const view = await api.writingProject(from);
    const problems = exportProblems(view.chapters);
    if (problems.length)
        throw new Error(problems[0]);
    const next = (await api.writingDrafts(into.id)).reduce((n, d) => Math.max(n, d.number), 0) + 1;
    const settings = readExport(styles === "from" ? view.project.export : into.export);
    await api.saveWritingDraft(into.id, await makeEpub({ ...into, title: `${into.title} (Draft ${next})` }, view.chapters, settings));
}
export function ImportBookDialog({ onCreated, onCancel, into, onIntoDone, restoreDraft, }) {
    const [how, setHow] = useState(restoreDraft ? "current" : "draft");
    const picking = useRef(null);
    const [stage, setStage] = useState("choose");
    const [picked, setPicked] = useState(null);
    const [agreed, setAgreed] = useState(false);
    const [doc, setDoc] = useState(null);
    const [manuscript, setManuscript] = useState(null);
    const [tbv, setTbv] = useState(null);
    const [title, setTitle] = useState("");
    const [author, setAuthor] = useState("");
    const [split, setSplit] = useState("headings");
    /** The file has page marks, so splitting at them is offered. */
    const [marked, setMarked] = useState(false);
    const [busy, setBusy] = useState(null);
    const [error, setError] = useState(null);
    useEffect(() => {
        if (!restoreDraft)
            return;
        let current = true;
        setBusy("Opening the draft…");
        void (async () => {
            try {
                const file = await api.readBookFile(restoreDraft.bookId);
                const d = readDraftEpub(new Uint8Array(await file.arrayBuffer()));
                if (!current)
                    return;
                const at = "spine";
                setMarked(false);
                setDoc(d);
                setSplit(at);
                setManuscript(buildManuscript(d, at));
                setStage("review");
            }
            catch (failure) {
                if (current)
                    setError(String(failure).replace(/^Error: /, ""));
            }
            finally {
                if (current)
                    setBusy(null);
            }
        })();
        return () => { current = false; };
    }, [restoreDraft]);
    const open = async (file) => {
        if (!file)
            return;
        setError(null);
        setAgreed(false);
        setBusy("Looking at the file…");
        try {
            const bytes = new Uint8Array(await file.arrayBuffer());
            const inspection = inspect(file.name, bytes);
            setPicked({ name: file.name, bytes, inspection, sha256: inspection.supported ? await sha256Hex(bytes) : "" });
            setStage(inspection.supported ? "confirm" : "choose");
        }
        catch (e) {
            setError(String(e).replace(/^Error: /, ""));
        }
        finally {
            setBusy(null);
        }
    };
    /** Only once they've agreed is the manuscript read and rebuilt. */
    const rebuild = async () => {
        if (!picked || !agreed)
            return;
        setError(null);
        setBusy(picked.inspection.format === "tbv" ? "Opening the book file…" : "Rebuilding the book…");
        try {
            if (picked.inspection.format === "tbv") {
                const book = readTbv(picked.bytes);
                setTbv(book);
                setManuscript(null);
                setTitle(book.title);
                setAuthor(book.author ?? "");
                setStage("review");
                return;
            }
            setTbv(null);
            const d = await readDocumentBytes(picked.name, picked.bytes);
            const at = bestSplit(d.html);
            setMarked(at === "marks");
            setDoc(d);
            setSplit(at);
            setManuscript(buildManuscript(d, at));
            setTitle(d.title);
            setAuthor(d.author ?? "");
            setStage("review");
        }
        catch (e) {
            setError(String(e).replace(/^Error: /, ""));
        }
        finally {
            setBusy(null);
        }
    };
    const change = (i, edit) => setManuscript((m) => (m ? { ...m, sections: m.sections.map((s, j) => (j === i ? { ...s, ...edit, sure: true } : s)), issues: m.issues.filter((x) => !(x.section === i && x.kind === "classification" && edit.area)) } : m));
    /** A Scribe book file, made into the book it was saved from. */
    const makeFromTbv = async (book) => {
        if (!picked || !agreed)
            return;
        setError(null);
        try {
            const made = await bookFromTbv(book, {
                title: title.trim() || book.title,
                author: author.trim() || null,
                acknowledgment: {
                    policyVersion: POLICY_VERSION,
                    wording: WORDING,
                    sourceName: picked.name,
                    sourceSha256: picked.sha256,
                    sourceBytes: picked.bytes.length,
                    sourceFormat: "tbv",
                    method: "checkbox",
                    ...(book.history.length ? { carried: book.history } : {}),
                },
                source: { name: picked.name, bytes: picked.bytes },
                onStep: setBusy,
            });
            onCreated(made);
        }
        catch (e) {
            setError(String(e).replace(/^Error: /, ""));
            setBusy(null);
        }
    };
    /** The signed confirmation and the kept original, for the book the words go into. */
    const sign = async (projectId, p) => {
        setBusy("Signing the record…");
        await api.recordWritingImport(projectId, {
            policyVersion: POLICY_VERSION,
            wording: WORDING,
            sourceName: p.name,
            sourceSha256: p.sha256,
            sourceBytes: p.bytes.length,
            sourceFormat: p.inspection.format,
            method: "checkbox",
        });
        setBusy("Keeping the original…");
        await api.keepWritingSource(projectId, p.name, p.bytes);
    };
    /** Adds the chosen sections to a book, after what's there. Returns the ids added. */
    const addSections = async (projectId, m, chosen) => {
        const added = [];
        let previous = null;
        // Each part made, by its place in the manuscript, so the sections after it go in it.
        const parts = new Map();
        for (let i = 0; i < chosen.length; i++) {
            setBusy(`Adding section ${i + 1} of ${chosen.length}…`);
            const s = chosen[i];
            if (s.isPart) {
                const part = await api.addWritingSection(projectId, { title: s.title, role: "part", page: "{}", after: previous });
                parts.set(m.sections.indexOf(s), part.id);
                previous = part.id;
                added.push(part.id);
                continue;
            }
            const page = { ...readPage(JSON.stringify({ kind: s.kind }), s.area === "chapter" ? "chapter" : s.area), byHand: !!s.byHand };
            const part = s.partOf === undefined ? null : (parts.get(s.partOf) ?? null);
            const made = await api.addWritingSection(projectId, { title: s.title, body: await shrinkPictures(s.body), role: s.area, part, page: writePage(page), after: previous });
            previous = made.id;
            added.push(made.id);
        }
        return added;
    };
    const saveReport = async (projectId, m, p) => {
        if (!m.issues.length)
            return;
        const note = await api.savePersonalNote(null, `Import report: ${p.name}`, reportNote(m, p.name)).catch(() => null);
        if (note)
            await api.setNoteProject(note.id, projectId).catch(() => undefined);
    };
    /** The file as another draft of the book it was opened from. */
    const makeInto = async (book) => {
        if (!picked || !agreed)
            return;
        const chosen = manuscript?.sections.filter((s) => s.include) ?? [];
        if (manuscript && !chosen.length)
            return setError("Keep at least one section.");
        setError(null);
        let scratch = null;
        try {
            if (how === "current" && manuscript) {
                // The words there now are kept first, so nothing is lost.
                setBusy("Keeping today's words as a draft…");
                await keepAsDraft(book.id);
                const before = (await api.writingProject(book.id)).chapters;
                await sign(book.id, picked);
                const added = await addSections(book.id, manuscript, chosen);
                setBusy("Putting the new words in place…");
                try {
                    for (const c of before)
                        await api.deleteWritingChapter(c.id);
                }
                catch (e) {
                    // Half-swapped would be worse than either: take the new sections back out.
                    for (const id of added)
                        await api.deleteWritingChapter(id).catch(() => undefined);
                    throw e;
                }
                await saveReport(book.id, manuscript, picked);
            }
            else {
                // A locked draft is an EPUB, so the file is made into a book out of sight first, then that book becomes the draft.
                setBusy("Reading the file…");
                if (tbv) {
                    // Its notes stay out: they'd belong to a book that's only there for a moment.
                    scratch = await bookFromTbv({ ...tbv, notes: [] }, { title: book.title, author: book.author, onStep: setBusy });
                }
                else if (manuscript) {
                    const view = await api.createWritingProject(book.title, book.author);
                    scratch = view.project.id;
                    await addSections(scratch, manuscript, chosen);
                    for (const c of view.chapters)
                        await api.deleteWritingChapter(c.id).catch(() => undefined);
                }
                else
                    return;
                await sign(book.id, picked);
                setBusy("Making the draft…");
                await draftFrom(scratch, book, tbv ? "from" : "into");
                if (manuscript)
                    await saveReport(book.id, manuscript, picked);
            }
            onIntoDone?.(how);
        }
        catch (e) {
            setError(String(e).replace(/^Error: /, ""));
            setBusy(null);
        }
        finally {
            if (scratch)
                await api.deleteWritingProject(scratch).catch(() => undefined);
        }
    };
    const make = async () => {
        if (restoreDraft && into && manuscript) {
            if (busy)
                return;
            const chosen = manuscript.sections.filter((section) => section.include);
            if (!chosen.length)
                return setError("Keep at least one section.");
            setError(null);
            setBusy("Preparing editable sections…");
            try {
                const parts = new Map();
                const sections = [];
                for (const section of chosen) {
                    if (section.isPart) {
                        parts.set(manuscript.sections.indexOf(section), sections.length);
                        sections.push({ section: { title: section.title, role: "part", page: "{}" } });
                    }
                    else {
                        const page = { ...readPage(JSON.stringify({ kind: section.kind }), section.area), byHand: !!section.byHand };
                        sections.push({
                            section: { title: section.title, body: await shrinkPictures(section.body), role: section.area, page: writePage(page) },
                            partIndex: section.partOf === undefined ? undefined : parts.get(section.partOf),
                        });
                    }
                }
                const before = await api.writingProject(into.id);
                const hasWork = before.chapters.some((chapter) => chapter.role !== "chapter" ||
                    (chapter.body.trim() !== "" && chapter.body.trim() !== "<p></p>"));
                if (hasWork) {
                    setBusy("Keeping the current manuscript as a draft…");
                    if (!(await keepAsDraft(into.id)))
                        throw new Error("The current manuscript couldn't be backed up.");
                }
                const latest = await api.writingProject(into.id);
                const chapters = (view) => JSON.stringify(view.chapters.map((chapter) => [chapter.id, chapter.updatedAt]));
                if (chapters(before) !== chapters(latest))
                    throw new Error("The manuscript changed. Reopen the draft and try again.");
                setBusy("Restoring the draft for editing…");
                await api.restoreWritingDraft(into.id, restoreDraft.id, latest.project.updatedAt, sections);
                onIntoDone?.("current");
            }
            catch (failure) {
                setError(String(failure).replace(/^Error: /, ""));
                setBusy(null);
            }
            return;
        }
        if (into)
            return makeInto(into);
        if (tbv)
            return makeFromTbv(tbv);
        if (!picked || !manuscript || !agreed)
            return;
        const chosen = manuscript.sections.filter((s) => s.include);
        if (!chosen.length)
            return setError("Keep at least one section.");
        setError(null);
        let made = null;
        try {
            setBusy("Making the book…");
            const view = await api.createWritingProject(title.trim() || manuscript.title || "Untitled", author.trim() || null);
            made = view.project.id;
            // The confirmation is signed first: no book is made from an import without it.
            await sign(made, picked);
            if (manuscript.description || manuscript.language)
                await api.updateWritingDetails(made, { title: view.project.title, author: view.project.author, series: null, seriesIndex: null, language: manuscript.language, description: manuscript.description }).catch(() => undefined);
            if (manuscript.isbn) {
                const settings = readExport(view.project.export);
                await api.setWritingExport(made, JSON.stringify({ ...settings, copyright: { ...settings.copyright, isbn: manuscript.isbn } })).catch(() => undefined);
            }
            await addSections(made, manuscript, chosen);
            // The empty chapter every new book starts with.
            for (const c of view.chapters)
                await api.deleteWritingChapter(c.id).catch(() => undefined);
            await saveReport(made, manuscript, picked);
            onCreated(made);
        }
        catch (e) {
            // Nothing half-made is left behind.
            if (made)
                await api.deleteWritingProject(made).catch(() => undefined);
            setError(String(e).replace(/^Error: /, ""));
            setBusy(null);
        }
    };
    const sections = manuscript?.sections ?? [];
    const kept = sections.filter((s) => s.include);
    const words = kept.reduce((n, s) => n + s.words, 0);
    const wholeBook = manuscript?.issues.filter((i) => i.section === null) ?? [];
    return (_jsx("div", { className: "dialog-backdrop", onPointerDown: (e) => e.target === e.currentTarget && !busy && onCancel(), children: _jsxs("form", { className: "dialog writing-dialog import-book", role: "dialog", "aria-label": restoreDraft ? "Un-draft book" : into ? "Import a new draft" : "Import a manuscript", onSubmit: (e) => {
                e.preventDefault();
                if (stage === "confirm")
                    void rebuild();
                else if (stage === "review")
                    void make();
            }, onKeyDown: (e) => e.key === "Escape" && !busy && onCancel(), children: [_jsx("h2", { children: restoreDraft ? `Un-draft Draft ${restoreDraft.number}` : into ? `A new draft of ${into.title}` : "Import a manuscript" }), restoreDraft && _jsx("p", { className: "dialog-lede", children: "Restore this draft as the editable manuscript. The saved draft stays available, and any current writing is backed up first." }), restoreDraft && busy && stage === "choose" && _jsx("p", { role: "status", children: busy }), stage === "choose" && !restoreDraft && (_jsxs(_Fragment, { children: [into && (_jsx("p", { className: "dialog-lede", children: "Bring in a version of this book you've worked on elsewhere, such as an edit in Word. It comes in as another draft, so the book's earlier drafts are all kept." })), _jsx("p", { className: "muted dialog-lede", children: "Rebuild a book you've written elsewhere as a Scribe book you can edit: Word, OpenDocument, RTF, plain text, Markdown, HTML, EPUB or PDF, or a Kindle Create project made from a PDF (zip its folder first). For Google Docs, download it as Word first. A Scribe book file (.tbv) opens exactly as it was saved. Your file is never changed." }), _jsxs("div", { className: "import-book-file", children: [_jsx("button", { type: "button", className: "btn btn-quiet", disabled: !!busy, onClick: () => picking.current?.click(), children: picked ? "Choose another file" : "Choose a file" }), picked && _jsx("span", { className: "muted", children: picked.name })] }), _jsxs(RememberedDetails, { disclosure: "writing.importMarks", className: "import-marks", children: [_jsx("summary", { children: "Writing in another app? Mark your pages" }), _jsx("p", { children: "In any app, put a line like these where each page starts. Scribe then knows what every page is, with nothing guessed. The words after the colon are the page's title." }), _jsx("pre", { children: ["=== title page", "=== copyright", "=== dedication", "=== contents", "=== part: Book One", "=== chapter: Arrival", "=== poem: Ash on the road", "=== end part", "=== acknowledgments", "=== about the author"].join("\n") }), _jsxs("p", { className: "muted", children: ["Every kind of page works: ", MARK_HELP.join(", "), "."] })] }), picked && !picked.inspection.supported && (_jsxs("div", { className: "import-unsupported", role: "alert", children: [_jsx(Icon, { name: "info", size: 16 }), _jsxs("div", { children: [_jsxs("strong", { children: [picked.inspection.label, ": not rebuilt"] }), _jsx("p", { children: picked.inspection.reason })] })] }))] })), _jsx("input", { ref: picking, type: "file", accept: MANUSCRIPT_ACCEPT, hidden: true, onChange: (e) => {
                        void open(e.target.files?.[0]);
                        e.target.value = "";
                    } }), stage === "confirm" && picked && (_jsxs(_Fragment, { children: [_jsxs("p", { className: "import-book-picked", children: [_jsx(Icon, { name: "file", size: 16 }), " ", _jsx("strong", { children: picked.name }), " ", _jsxs("span", { className: "muted", children: ["\u00B7 ", picked.inspection.label, " \u00B7 ", formatBytes(picked.bytes.length)] })] }), _jsxs("section", { className: "import-ack", "aria-labelledby": "import-ack-title", children: [_jsx("h3", { id: "import-ack-title", children: ACK_TITLE }), ACK_PARAGRAPHS.map((p) => (_jsx("p", { children: p }, p))), _jsxs("label", { className: "check-row import-ack-confirm", children: [_jsx("input", { type: "checkbox", checked: agreed, onChange: (e) => setAgreed(e.target.checked) }), _jsx("span", { children: ACK_CONFIRMATION })] })] }), _jsx("p", { className: "muted writing-export-note", children: "TBV keeps a signed record of this with the book: when you agreed, on which device, and a fingerprint of the file. It isn't a check of who wrote the book, and it never leaves your devices and sync." })] })), stage === "review" && into && !restoreDraft && (_jsxs("fieldset", { className: "import-into", "aria-label": "How it comes in", children: [_jsxs("label", { className: "check-row", children: [_jsx("input", { type: "radio", name: "import-into", checked: how === "draft", onChange: () => setHow("draft") }), _jsxs("span", { children: [_jsx("strong", { children: "Keep it as a draft" }), _jsx("span", { className: "muted", children: " \u00B7 locked, to read, highlight and make notes in. The words you're writing don't change." })] })] }), _jsxs("label", { className: "check-row", children: [_jsx("input", { type: "radio", name: "import-into", checked: how === "current", disabled: !!tbv, onChange: () => setHow("current") }), _jsxs("span", { children: [_jsx("strong", { children: "Write from it" }), _jsxs("span", { className: "muted", children: [" ", "\u00B7 it becomes the version you're writing. The words there now are kept as a draft first.", tbv ? " (A Scribe book file can only come in as a draft; open it as its own book to write from it.)" : ""] })] })] })] })), stage === "review" && tbv && !into && (_jsxs(_Fragment, { children: [_jsxs("div", { className: "writing-export-styles import-book-details", children: [_jsxs("label", { className: "field", children: [_jsx("span", { children: "Title" }), _jsx("input", { value: title, onChange: (e) => setTitle(e.target.value), maxLength: 200 })] }), _jsxs("label", { className: "field", children: [_jsx(AuthorLabel, {}), _jsx("input", { value: author, onChange: (e) => setAuthor(e.target.value), maxLength: 200, placeholder: "Your name, or a pen name" })] })] }), _jsx(TbvSummary, { book: tbv })] })), stage === "review" && tbv && into && _jsx(TbvSummary, { book: tbv }), stage === "review" && manuscript && doc && (_jsxs(_Fragment, { children: [_jsxs("div", { className: "writing-export-styles import-book-details", children: [!into && (_jsxs(_Fragment, { children: [_jsxs("label", { className: "field", children: [_jsx("span", { children: "Title" }), _jsx("input", { value: title, onChange: (e) => setTitle(e.target.value), maxLength: 200 })] }), _jsxs("label", { className: "field", children: [_jsx(AuthorLabel, {}), _jsx("input", { value: author, onChange: (e) => setAuthor(e.target.value), maxLength: 200, placeholder: "Your name, or a pen name" })] })] })), _jsxs("label", { className: "field", children: [_jsx("span", { children: "Split into sections" }), _jsx("select", { value: split, onChange: (e) => {
                                                const at = e.target.value;
                                                setSplit(at);
                                                setManuscript(buildManuscript(doc, at));
                                            }, children: SPLITS.filter((s) => (s.value !== "marks" || marked) && (s.value !== "spine" || restoreDraft)).map((s) => (_jsx("option", { value: s.value, children: s.label }, s.value))) })] })] }), _jsxs("p", { className: "muted writing-export-note", children: [kept.length, " ", kept.length === 1 ? "section" : "sections", ", ", words.toLocaleString(), " words.", " ", split === "marks"
                                    ? "Each page is what its mark says. Untick anything you don't want."
                                    : "Check where each one goes and what it is; untick anything you don't want, such as a contents page, which Scribe makes for you."] }), manuscript.issues.length > 0 && (_jsxs("div", { className: "import-report", role: "status", children: [_jsxs("strong", { children: [_jsx(Icon, { name: "info", size: 15 }), " ", manuscript.issues.length, " ", manuscript.issues.length === 1 ? "thing" : "things", " to check"] }), wholeBook.length > 0 && (_jsx("ul", { children: wholeBook.map((i, n) => (_jsx("li", { children: i.message }, n))) })), !restoreDraft && _jsx("p", { className: "muted", children: "The list is also kept in the book's notes, so you can work through it after the import." })] })), _jsx("div", { className: "import-areas", children: AREAS.map(({ area, label }) => {
                                const here = sections.map((s, i) => ({ s, i })).filter(({ s }) => s.area === area);
                                return (_jsxs("section", { className: "import-area", "aria-label": label, children: [_jsxs("h3", { children: [label, " ", _jsx("span", { className: "muted", children: here.length })] }), here.length === 0 ? (_jsx("p", { className: "muted import-area-empty", children: "Nothing here." })) : (_jsx("ol", { className: "import-book-chapters", children: here.map(({ s, i }) => {
                                                const flags = manuscript.issues.filter((x) => x.section === i);
                                                return (_jsxs("li", { className: [flags.length ? "is-flagged" : "", s.partOf !== undefined ? "is-in-part" : ""].filter(Boolean).join(" ") || undefined, children: [_jsxs("div", { className: "check-row", children: [_jsx("input", { type: "checkbox", "aria-label": `Bring in ${s.title || "this section"}`, checked: s.include, onChange: (e) => change(i, { include: e.target.checked }) }), _jsx("span", { className: "import-book-chapter-title", children: s.title || _jsx("em", { className: "muted", children: "Untitled poem" }) }), s.isPart ? (_jsx("span", { className: "muted import-kind-label", children: "Section" })) : (_jsx("select", { className: "import-kind", "aria-label": `What ${s.title || "this section"} is`, value: `${s.area}:${s.kind}`, onChange: (e) => {
                                                                        const [a, k] = e.target.value.split(":");
                                                                        change(i, { area: a, kind: k, ...(restoreDraft && KINDS[k].made ? { byHand: true } : {}) });
                                                                    }, children: AREAS.map((g) => (_jsx("optgroup", { label: g.label, children: ADD_MENUS[g.area]
                                                                            // Made by Scribe, so only offered for a page the writer marked as one.
                                                                            .filter((k) => (k !== "contents" && k !== "sources") || k === s.kind)
                                                                            .map((k) => (_jsx("option", { value: `${g.area}:${k}`, children: KINDS[k].label }, k))) }, g.area))) })), _jsx("span", { className: "muted import-words", children: s.words.toLocaleString() })] }), flags.map((f, n) => (_jsxs("p", { className: "import-flag", children: [_jsx(Icon, { name: "info", size: 13 }), " ", f.message] }, n)))] }, i));
                                            }) }))] }, area));
                            }) })] })), error && (_jsx("p", { className: "form-error", role: "alert", children: error })), _jsxs("div", { className: "dialog-actions", children: [stage !== "choose" && !restoreDraft && (_jsx("button", { type: "button", className: "btn btn-quiet", disabled: !!busy, onClick: () => {
                                setError(null);
                                setStage(stage === "review" ? "confirm" : "choose");
                            }, children: "Back" })), _jsx("button", { type: "button", className: "btn btn-quiet", onClick: onCancel, disabled: !!busy, children: "Cancel" }), stage === "choose" && !restoreDraft && (_jsx("button", { type: "button", className: "btn btn-primary", disabled: !!busy || !picked?.inspection.supported, onClick: () => setStage("confirm"), children: busy ?? "Continue" })), stage === "confirm" && (_jsx("button", { type: "submit", className: "btn btn-primary", disabled: !!busy || !agreed, children: busy ?? "Agree and continue" })), stage === "review" && (_jsx("button", { type: "submit", className: "btn btn-primary", disabled: !!busy || (!tbv && !kept.length), children: busy ?? (restoreDraft ? "Un-draft" : into ? (how === "current" ? "Write from it" : "Keep as a draft") : "Make the book") }))] })] }) }));
}
/** What a Scribe book file holds, by area, before the book is made from it. */
function TbvSummary({ book }) {
    const label = (p) => {
        if (p.role === "part")
            return "Section";
        const page = readPage(JSON.stringify(p.page), p.role);
        return KINDS[page.kind].label;
    };
    const areaOf = (p) => (p.role === "part" ? "chapter" : p.role);
    const words = book.pages.reduce((n, p) => n + (new DOMParser().parseFromString(`<body>${p.body}</body>`, "text/html").body.textContent ?? "").split(/\s+/).filter((w) => /\w/.test(w)).length, 0);
    const parts = book.pages.filter((p) => p.role === "part").length;
    return (_jsxs(_Fragment, { children: [_jsxs("p", { className: "muted writing-export-note", children: [book.pages.length, " ", book.pages.length === 1 ? "page" : "pages", ", ", words.toLocaleString(), " words", parts ? `, in ${parts} ${parts === 1 ? "section" : "sections"}` : "", book.cover ? ", with its cover" : "", book.notes.length ? `, and ${book.notes.length} ${book.notes.length === 1 ? "note" : "notes"}` : "", ". Everything comes in as it was saved", book.madeBy ? ` by ${book.madeBy}` : "", ": kinds, styles, store editions and sources.", book.history.length ? " Where the book came from is kept too, signed into its new record." : ""] }), book.newer && (_jsxs("div", { className: "import-report", role: "status", children: [_jsxs("strong", { children: [_jsx(Icon, { name: "info", size: 15 }), " Made by a newer TBV"] }), _jsx("p", { className: "muted", children: "Anything this version doesn't know yet is left out. Update TBV to bring in all of it." })] })), _jsx("div", { className: "import-areas", children: AREAS.map(({ area, label: heading }) => {
                    const here = book.pages.filter((p) => areaOf(p) === area);
                    return (_jsxs("section", { className: "import-area", "aria-label": heading, children: [_jsxs("h3", { children: [heading, " ", _jsx("span", { className: "muted", children: here.length })] }), here.length === 0 ? (_jsx("p", { className: "muted import-area-empty", children: "Nothing here." })) : (_jsx("ol", { className: "import-book-chapters", children: here.map((p, i) => (_jsx("li", { className: p.part !== null ? "is-in-part" : undefined, children: _jsxs("div", { className: "check-row", children: [_jsx("span", { className: "import-book-chapter-title", children: p.title || _jsx("em", { className: "muted", children: label(p) === "Poem" ? "Untitled poem" : "Untitled" }) }), _jsx("span", { className: "muted import-kind-label", children: label(p) })] }) }, i))) }))] }, area));
                }) })] }));
}

import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
// "Add to a book I'm writing": a note becomes a new chapter, or goes on the
// end of one. The note itself stays where it was.
import { useEffect, useState } from "react";
import { api } from "../api";
import { useToast } from "../components/Toast";
import { chapterTitle, quoteHtml } from "./fromNotes";
const NEW_CHAPTER = "";
export function NoteToBookDialog({ note, onClose, onGoToBooks }) {
    const [projects, setProjects] = useState(null);
    const [projectId, setProjectId] = useState("");
    const [chapters, setChapters] = useState([]);
    const [chapterId, setChapterId] = useState(NEW_CHAPTER);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const toast = useToast();
    useEffect(() => {
        api.writingProjects().then((list) => {
            setProjects(list);
            setProjectId((id) => id || list[0]?.id || "");
        }, (e) => setError(String(e)));
    }, []);
    useEffect(() => {
        setChapterId(NEW_CHAPTER);
        if (!projectId)
            return setChapters([]);
        let current = true;
        api.writingProject(projectId).then((v) => current && setChapters(v.chapters), () => current && setChapters([]));
        return () => {
            current = false;
        };
    }, [projectId]);
    const add = async () => {
        setBusy(true);
        setError(null);
        try {
            const html = quoteHtml(note);
            const onto = chapters.find((c) => c.id === chapterId);
            if (onto)
                await api.saveWritingChapter(onto.id, onto.title, onto.body + html);
            else {
                const title = chapterTitle(note);
                const last = [...chapters].reverse().find((c) => c.role === "chapter") ?? chapters[chapters.length - 1] ?? null;
                const added = await api.addWritingChapter(projectId, title, last?.id ?? null);
                await api.saveWritingChapter(added.id, title, html);
            }
            const book = projects?.find((p) => p.id === projectId);
            toast(onto ? `Added to the end of ${onto.title || "that chapter"}.` : `Added to ${book?.title ?? "your book"} as a new chapter.`);
            onClose();
        }
        catch (e) {
            setError(String(e));
            setBusy(false);
        }
    };
    return (_jsx("div", { className: "dialog-backdrop", onPointerDown: (e) => e.target === e.currentTarget && !busy && onClose(), children: _jsxs("form", { className: "dialog writing-dialog", role: "dialog", "aria-label": "Add to a book I'm writing", onSubmit: (e) => {
                e.preventDefault();
                void add();
            }, onKeyDown: (e) => e.key === "Escape" && !busy && onClose(), children: [_jsx("h2", { children: "Add to a book I'm writing" }), projects && projects.length === 0 ? (_jsx("p", { className: "muted", children: "You aren't writing a book yet. Start one in Scribe, then come back to add this note to it." })) : (_jsxs(_Fragment, { children: [_jsxs("label", { className: "field", children: [_jsx("span", { children: "Book" }), _jsx("select", { value: projectId, onChange: (e) => setProjectId(e.target.value), disabled: !projects, children: (projects ?? []).map((p) => (_jsx("option", { value: p.id, children: p.title }, p.id))) })] }), _jsxs("label", { className: "field", children: [_jsx("span", { children: "Where it goes" }), _jsxs("select", { value: chapterId, onChange: (e) => setChapterId(e.target.value), children: [_jsx("option", { value: NEW_CHAPTER, children: "A new chapter at the end" }), chapters.map((c) => (_jsxs("option", { value: c.id, children: ["The end of ", c.title || "an untitled chapter"] }, c.id)))] })] }), _jsxs("p", { className: "muted", children: [note.excerpt.trim() ? "The highlighted words go in as a quote with the book's title and author underneath. " : "", "The note stays in your notes too."] })] })), error && (_jsx("p", { className: "form-error", role: "alert", children: error })), _jsxs("div", { className: "dialog-actions", children: [_jsx("button", { type: "button", className: "btn btn-quiet", onClick: onClose, disabled: busy, children: projects?.length === 0 ? "Close" : "Cancel" }), projects?.length === 0 ? (_jsx("button", { type: "button", className: "btn btn-primary", onClick: onGoToBooks, children: "Go to my books" })) : (_jsx("button", { type: "submit", className: "btn btn-primary", disabled: busy || !projectId, children: "Add it" }))] })] }) }));
}

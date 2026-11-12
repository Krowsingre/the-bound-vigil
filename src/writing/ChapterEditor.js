import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
// Writing one chapter: a ProseMirror editor (through Tiptap) with the
// formatting an EPUB can carry. Words are saved a moment after typing stops,
// and straight away when the chapter is left.
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useMemo, useRef, useState } from "react";
import { isApp } from "../api";
import { Icon } from "../components/Icon";
import { onBeforeQuit } from "../lib/beforeQuit";
import { countWords } from "./records";
import { poemWarnings } from "./pages";
import { citationLabel, citedIds, isNumberedStyle } from "./sources";
import { SourcesDialog } from "./SourcesDialog";
import { CanvaPictureDialog, useCanvaStatus } from "./CanvaLink";
import { canvaHere } from "../settings/CanvaSection";
import { BlockLookExtension, Citation, Footnote, Highlight, PageBreak, Picture, pictureAddress, PoemLines, Subscript, Superscript, TextLookMark } from "./extensions";
import { useToast } from "../components/Toast";
import { Menu } from "../components/Menu";
import { usePublisher } from "../license/Publisher";
const SAVE_AFTER_MS = 800;
function Tool({ label, shortcut, active, disabled, onClick, icon, text, }) {
    return (_jsx("button", { type: "button", className: `writing-tool${active ? " is-on" : ""}`, "aria-label": label, "aria-pressed": active, title: shortcut ? `${label} (${shortcut})` : label, disabled: disabled, 
        // Keeps the words selected while the button is pressed.
        onMouseDown: (e) => e.preventDefault(), onClick: onClick, children: icon ? _jsx(Icon, { name: icon, size: 17 }) : _jsx("span", { className: "writing-tool-text", children: text }) }));
}
/** Fonts a passage can be set in: ones TBV can put inside the book, and the reader's own kinds. */
const FONTS = [
    { label: "The book's font", value: null },
    { label: "Lora", value: "Lora, serif" },
    { label: "Echolume", value: "Echolume, serif" },
    { label: "Serif", value: "serif" },
    { label: "Sans serif", value: "sans-serif" },
    { label: "Typewriter", value: "monospace" },
];
const SIZES = [
    { label: "Small", value: "0.85em" },
    { label: "Normal", value: null },
    { label: "Large", value: "1.2em" },
    { label: "Larger", value: "1.5em" },
    { label: "Largest", value: "2em" },
];
const LETTERS = [
    { label: "Tight", value: "-0.02em" },
    { label: "Normal", value: null },
    { label: "Wide", value: "0.05em" },
    { label: "Wider", value: "0.12em" },
    { label: "Widest", value: "0.25em" },
];
const WORDS = [
    { label: "Normal", value: null },
    { label: "Wide", value: "0.2em" },
    { label: "Wider", value: "0.5em" },
];
const LINES = [
    { label: "The book's own", value: null },
    { label: "Single", value: "1.2" },
    { label: "1.5 lines", value: "1.5" },
    { label: "Double", value: "2" },
];
const ALIGNS = [
    { label: "The book's own", value: null },
    { label: "Left", value: "left" },
    { label: "Centre", value: "center" },
    { label: "Right", value: "right" },
    { label: "Justified", value: "justify" },
];
/** A toolbar button that opens a short list of choices. */
function ToolMenu({ label, text, icon, active, items }) {
    return (_jsx(Menu, { label: label, align: "start", className: `writing-tool writing-tool-menu${active ? " is-on" : ""}`, trigger: _jsxs(_Fragment, { children: [icon ? _jsx(Icon, { name: icon, size: 17 }) : _jsx("span", { className: "writing-tool-text", children: text }), _jsx(Icon, { name: "chevronDown", size: 11 })] }), items: items }));
}
function Toolbar({ editor, poem, cites, chapter }) {
    const [canva] = useCanvaStatus();
    const canvaOn = canvaHere && !!canva?.available && !!canva.name;
    const [canvaPicture, setCanvaPicture] = useState(false);
    const publisher = usePublisher();
    const state = useEditorState({
        editor,
        selector: ({ editor: e }) => ({
            bold: e.isActive("bold"),
            italic: e.isActive("italic"),
            underline: e.isActive("underline"),
            strike: e.isActive("strike"),
            h2: e.isActive("heading", { level: 2 }),
            h3: e.isActive("heading", { level: 3 }),
            quote: e.isActive("blockquote"),
            bullets: e.isActive("bulletList"),
            numbers: e.isActive("orderedList"),
            link: e.isActive("link"),
            highlight: e.isActive("highlight"),
            sup: e.isActive("superscript"),
            sub: e.isActive("subscript"),
            look: e.getAttributes("textLook"),
            block: (e.isActive("heading") ? e.getAttributes("heading") : e.getAttributes("paragraph")),
            canIndent: e.can().sinkListItem("listItem"),
            canOutdent: e.can().liftListItem("listItem"),
            footnote: e.isActive("footnote") ? (e.getAttributes("footnote").text ?? "") : null,
            citation: e.isActive("citation") ? e.getAttributes("citation") : null,
            picture: e.isActive("picture") ? e.getAttributes("picture") : null,
            canUndo: e.can().undo(),
            canRedo: e.can().redo(),
        }),
    });
    const [linking, setLinking] = useState(null);
    const [noting, setNoting] = useState(null);
    const [citing, setCiting] = useState(false);
    const picking = useRef(null);
    const toast = useToast();
    const run = () => editor.chain().focus();
    const addPicture = async (file) => {
        if (!file)
            return;
        try {
            run().insertPicture(await pictureAddress(file), file.name.replace(/\.[^.]+$/, "")).run();
        }
        catch (e) {
            toast(e instanceof Error ? e.message : String(e));
        }
    };
    const saveNote = () => {
        const text = (noting ?? "").trim();
        if (text)
            run().setFootnote(text).run();
        else if (state.footnote !== null)
            run().deleteSelection().run();
        setNoting(null);
    };
    // Choosing a footnote in the text opens its words to change.
    useEffect(() => {
        if (state.footnote !== null)
            setNoting(state.footnote);
    }, [state.footnote]);
    const look = (change) => run().setTextLook(change).run();
    const choose = (list, current, pick) => list.map((o) => ({ label: o.label, checked: (current ?? null) === o.value, onSelect: () => pick(o.value) }));
    const caps = state.look.textTransform === "uppercase" ? "all" : state.look.fontVariant === "small-caps" ? "small" : null;
    const saveLink = () => {
        const url = (linking ?? "").trim();
        if (!url)
            run().extendMarkRange("link").unsetLink().run();
        else
            run().extendMarkRange("link").setLink({ href: /^(https?:|mailto:)/i.test(url) ? url : `https://${url}` }).run();
        setLinking(null);
    };
    return (_jsxs("div", { className: "writing-toolbar", role: "toolbar", "aria-label": "Formatting", children: [_jsx(Tool, { label: "Bold", shortcut: "Ctrl+B", text: "B", active: state.bold, onClick: () => run().toggleBold().run() }), _jsx(Tool, { label: "Italic", shortcut: "Ctrl+I", text: "I", active: state.italic, onClick: () => run().toggleItalic().run() }), _jsx(Tool, { label: "Underline", shortcut: "Ctrl+U", text: "U", active: state.underline, onClick: () => run().toggleUnderline().run() }), _jsx(Tool, { label: "Strikethrough", text: "S", active: state.strike, onClick: () => run().toggleStrike().run() }), _jsx(Tool, { label: "Highlight", icon: "highlight", active: state.highlight, onClick: () => run().toggleMark("highlight").run() }), _jsx(Tool, { label: "Superscript", text: "x\u00B2", active: state.sup, onClick: () => run().toggleMark("superscript").run() }), _jsx(Tool, { label: "Subscript", text: "x\u2082", active: state.sub, onClick: () => run().toggleMark("subscript").run() }), _jsx(ToolMenu, { label: "Capitals", text: "Aa", active: caps !== null, items: [
                    { label: "As written", checked: caps === null, onSelect: () => look({ textTransform: null, fontVariant: null }) },
                    { label: "ALL CAPS", checked: caps === "all", onSelect: () => look({ textTransform: "uppercase", fontVariant: null }) },
                    { label: "Small Caps", checked: caps === "small", onSelect: () => look({ textTransform: null, fontVariant: "small-caps" }) },
                    "divider",
                    { label: "Change to Title Case", hint: "Retypes the letters", onSelect: () => run().titleCase().run() },
                ] }), _jsx("span", { className: "writing-tool-gap" }), _jsx(ToolMenu, { label: "Font", icon: "readingA", active: !!state.look.fontFamily, items: [
                    ...choose(FONTS, state.look.fontFamily, (fontFamily) => look({ fontFamily })),
                    "divider",
                    { heading: _jsx("span", { className: "writing-tool-note", children: "Many e-readers let readers choose their own font, which can replace this." }) },
                ] }), _jsx(ToolMenu, { label: "Text size", icon: "textSize", active: !!state.look.fontSize, items: choose(SIZES, state.look.fontSize, (fontSize) => look({ fontSize })) }), _jsx(ToolMenu, { label: "Spacing", icon: "sliders", active: !!(state.look.letterSpacing || state.look.wordSpacing || state.block.lineHeight), items: [
                    { heading: "Between letters" },
                    ...choose(LETTERS, state.look.letterSpacing, (letterSpacing) => look({ letterSpacing })),
                    { heading: "Between words" },
                    ...choose(WORDS, state.look.wordSpacing, (wordSpacing) => look({ wordSpacing })),
                    { heading: "Between lines" },
                    ...choose(LINES, state.block.lineHeight, (lineHeight) => run().setBlockLook({ lineHeight }).run()),
                ] }), _jsx(ToolMenu, { label: "Alignment", text: { left: "⇤", center: "↔", right: "⇥", justify: "☰" }[state.block.textAlign ?? "left"] ?? "⇤", active: !!state.block.textAlign, items: choose(ALIGNS, state.block.textAlign, (textAlign) => run().setBlockLook({ textAlign }).run()) }), _jsx("span", { className: "writing-tool-gap" }), !poem && (_jsxs(_Fragment, { children: [_jsx(Tool, { label: "Heading", text: "H", active: state.h2, onClick: () => run().toggleHeading({ level: 2 }).run() }), _jsx(Tool, { label: "Smaller heading", text: "h", active: state.h3, onClick: () => run().toggleHeading({ level: 3 }).run() }), _jsx(Tool, { label: "Quote", icon: "quote", active: state.quote, onClick: () => run().toggleBlockquote().run() }), _jsx(Tool, { label: "List", icon: "listBullet", active: state.bullets, onClick: () => run().toggleBulletList().run() }), _jsx(Tool, { label: "Numbered list", icon: "listNumber", active: state.numbers, onClick: () => run().toggleOrderedList().run() })] })), (state.bullets || state.numbers) && (_jsxs(_Fragment, { children: [_jsx(Tool, { label: "Move out", shortcut: "Shift+Tab", text: "\u21E0", disabled: !state.canOutdent, onClick: () => run().liftListItem("listItem").run() }), _jsx(Tool, { label: "Move in", shortcut: "Tab", text: "\u21E2", disabled: !state.canIndent, onClick: () => run().sinkListItem("listItem").run() })] })), _jsx(Tool, { label: "Scene break", text: "\u2042", onClick: () => run().setHorizontalRule().run() }), _jsx(Tool, { label: "Page break", icon: "pageBreak", onClick: () => run().setPageBreak().run() }), canvaOn ? (_jsx(ToolMenu, { label: "Picture", icon: "image", items: [
                    { label: "From a file…", icon: "image", onSelect: () => picking.current?.click() },
                    { label: "Design one in Canva…", icon: "palette", onSelect: () => publisher.check("Canva", () => setCanvaPicture(true)) },
                ] })) : (_jsx(Tool, { label: "Picture", icon: "image", onClick: () => picking.current?.click() })), canvaPicture && chapter && (_jsx(CanvaPictureDialog, { projectId: chapter.projectId, chapterId: chapter.id, onPicture: addPicture, onClose: () => setCanvaPicture(false) })), _jsx(Tool, { label: state.footnote !== null ? "Change footnote" : "Footnote", text: "\u00B9", active: state.footnote !== null || noting !== null, onClick: () => setNoting(noting === null ? (state.footnote ?? "") : null) }), cites && (_jsx(Tool, { label: state.citation ? "Change citation" : "Cite a source", icon: "bookClosed", active: !!state.citation || citing, onClick: () => setCiting(true) })), cites && citing && (_jsx(SourcesDialog, { sources: cites.sources, style: cites.citationStyle, onChange: cites.onSources, current: state.citation, onCite: (source, locator) => {
                    run().setCitation(source.id, locator, citationLabel(source, locator)).run();
                    setCiting(false);
                }, onClose: () => setCiting(false) })), _jsx("input", { ref: picking, type: "file", accept: "image/png,image/jpeg,image/gif,image/webp", hidden: true, onChange: (e) => {
                    void addPicture(e.target.files?.[0]);
                    e.target.value = "";
                } }), _jsx(Tool, { label: state.link ? "Change link" : "Link", icon: "link", active: state.link || linking !== null, onClick: () => setLinking(linking === null ? (editor.getAttributes("link").href ?? "") : null) }), _jsx("span", { className: "writing-tool-gap" }), _jsx(Tool, { label: "Undo", shortcut: "Ctrl+Z", icon: "undo", disabled: !state.canUndo, onClick: () => run().undo().run() }), _jsx(Tool, { label: "Redo", shortcut: "Ctrl+Y", icon: "redo", disabled: !state.canRedo, onClick: () => run().redo().run() }), noting !== null && (_jsxs("form", { className: "writing-link writing-note", onSubmit: (e) => {
                    e.preventDefault();
                    saveNote();
                }, children: [_jsx("input", { autoFocus: true, value: noting, placeholder: "The footnote's words", "aria-label": "Footnote words", maxLength: 2000, onChange: (e) => setNoting(e.target.value), onKeyDown: (e) => e.key === "Escape" && setNoting(null) }), _jsx("button", { type: "submit", className: "btn btn-primary btn-small", children: noting.trim() ? (state.footnote !== null ? "Change" : "Add footnote") : state.footnote !== null ? "Remove footnote" : "Cancel" })] })), state.picture && noting === null && linking === null && _jsx(PictureLook, { editor: editor, look: state.picture }), linking !== null && (_jsxs("form", { className: "writing-link", onSubmit: (e) => {
                    e.preventDefault();
                    saveLink();
                }, children: [_jsx("input", { autoFocus: true, value: linking, placeholder: "https://\u2026", "aria-label": "Link address", onChange: (e) => setLinking(e.target.value), onKeyDown: (e) => e.key === "Escape" && setLinking(null) }), _jsx("button", { type: "submit", className: "btn btn-primary btn-small", children: linking.trim() ? "Link" : "Remove link" })] }))] }));
}
/** The picture selected: its caption, its description for readers who can't see it, and whether it has a page of its own. */
function PictureLook({ editor, look }) {
    const publisher = usePublisher();
    const set = (change) => editor.commands.setPictureLook(change);
    return (_jsxs("div", { className: "writing-link writing-picture-look", children: [_jsx("input", { value: look.caption ?? "", placeholder: "Caption under the picture", "aria-label": "Caption", maxLength: 400, onChange: (e) => {
                    const caption = e.target.value;
                    if (!look.caption && caption && !publisher.allowed)
                        return publisher.check("Captions", () => undefined);
                    set({ caption });
                } }), _jsx("input", { value: look.alt ?? "", placeholder: "What it shows, for readers who can't see it", "aria-label": "Description", maxLength: 400, onChange: (e) => set({ alt: e.target.value }) }), _jsxs("label", { className: "check-row", children: [_jsx("input", { type: "checkbox", checked: look.size === "full", onChange: (e) => {
                            const full = e.target.checked;
                            if (full)
                                publisher.check("Full-page pictures", () => set({ size: "full" }));
                            else
                                set({ size: "inline" });
                        } }), _jsx("span", { children: "A page of its own" })] })] }));
}
export function ChapterEditor({ chapter, citationChapters, onSave, onSaveState, flushRef, insertRef, poem = null, sources, citationStyle = "chicago-notes", onSources, }) {
    const [title, setTitle] = useState(chapter.title);
    const [warnings, setWarnings] = useState(() => (poem ? poemWarnings(chapter.body) : []));
    const pending = useRef(null);
    const timer = useRef(null);
    const latest = useRef({ title: chapter.title, body: chapter.body });
    const saveRef = useRef(onSave);
    saveRef.current = onSave;
    const stateRef = useRef(onSaveState);
    stateRef.current = onSaveState;
    const inFlight = useRef(Promise.resolve());
    const flush = async () => {
        if (timer.current)
            clearTimeout(timer.current);
        timer.current = null;
        const next = pending.current;
        // Nothing new waiting: a save already on its way is still waited for.
        if (!next)
            return inFlight.current;
        pending.current = null;
        const run = (async () => {
            stateRef.current("saving", countWords(next.body));
            try {
                await saveRef.current(next.title, next.body);
                stateRef.current(pending.current ? "unsaved" : "saved", countWords(next.body));
            }
            catch {
                // Kept to try again with the next change, or when the chapter is left.
                pending.current = pending.current ?? next;
                stateRef.current("failed", countWords(next.body));
            }
        })();
        inFlight.current = run;
        return run;
    };
    if (flushRef)
        flushRef.current = flush;
    const change = (part) => {
        latest.current = { ...latest.current, ...part };
        pending.current = latest.current;
        stateRef.current("unsaved", countWords(latest.current.body));
        if (timer.current)
            clearTimeout(timer.current);
        timer.current = setTimeout(() => void flush(), SAVE_AFTER_MS);
    };
    const numbering = useMemo(() => {
        if (!isNumberedStyle(citationStyle))
            return null;
        const ordered = citationChapters ?? [];
        const index = ordered.findIndex((c) => c.id === chapter.id);
        const known = new Set(sources?.map((source) => source.id));
        const previous = citedIds(index < 0 ? [] : ordered.slice(0, index)).filter((id) => known.has(id));
        return { previous, known };
    }, [chapter.id, citationChapters, citationStyle, sources]);
    const numberingRef = useRef(numbering);
    numberingRef.current = numbering;
    const editor = useEditor({
        extensions: [
            StarterKit.configure({
                heading: { levels: [2, 3] },
                code: false,
                codeBlock: false,
                link: { openOnClick: false, autolink: true, protocols: ["mailto"] },
            }),
            Picture,
            Footnote,
            PageBreak,
            Highlight,
            Superscript,
            Subscript,
            TextLookMark,
            BlockLookExtension,
            Citation.configure({ numbering: () => numberingRef.current }),
            ...(poem ? [PoemLines] : []),
        ],
        content: chapter.body || "<p></p>",
        editorProps: { attributes: { class: "writing-page", spellcheck: "true", "aria-label": "Chapter text" } },
        onUpdate: ({ editor: e }) => {
            const body = e.getHTML();
            change({ body });
            if (poem)
                setWarnings(poemWarnings(body));
        },
    });
    useEffect(() => {
        if (editor)
            editor.view.dispatch(editor.state.tr);
    }, [editor, numbering]);
    if (insertRef)
        insertRef.current = editor ? (html) => void editor.chain().focus().insertContent(html).run() : null;
    // Leaving the chapter saves what's waiting. Quitting the app waits for it;
    // a browser tab asks before closing while words are unsaved.
    useEffect(() => {
        stateRef.current("saved", countWords(chapter.body));
        const unregister = onBeforeQuit(flush);
        const beforeClose = (e) => {
            if (!pending.current || isApp)
                return;
            void flush();
            e.preventDefault();
        };
        window.addEventListener("beforeunload", beforeClose);
        return () => {
            unregister();
            window.removeEventListener("beforeunload", beforeClose);
            void flush();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return (_jsxs("div", { className: "writing-editor", children: [editor && _jsx(Toolbar, { editor: editor, poem: !!poem, chapter: chapter, cites: sources && onSources ? { sources, citationStyle, onSources } : undefined }), _jsxs("div", { className: `writing-sheet${poem ? ` is-poem${poem === "centred" ? " is-centred" : ""}` : ""}`, onClick: (e) => e.target === e.currentTarget && editor?.commands.focus("end"), children: [_jsx("input", { className: "writing-chapter-title", value: title, placeholder: poem ? "Title (if left empty, the first line names it)" : "Chapter title", "aria-label": "Chapter title", maxLength: 200, onChange: (e) => {
                            setTitle(e.target.value);
                            change({ title: e.target.value });
                        }, onKeyDown: (e) => {
                            if (e.key === "Enter") {
                                e.preventDefault();
                                editor?.commands.focus("start");
                            }
                        } }), _jsx(EditorContent, { editor: editor }), poem && (_jsxs("div", { className: "writing-poem-help muted", children: [_jsx("p", { children: "Enter starts a new line. Press Enter on an empty line to start a new stanza. Tab indents a line." }), warnings.map((w) => (_jsxs("p", { className: "writing-poem-warning", children: [_jsx(Icon, { name: "warning", size: 14 }), " ", w] }, w)))] }))] })] }));
}

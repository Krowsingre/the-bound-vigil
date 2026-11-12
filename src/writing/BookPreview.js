import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
// Everything that goes into the exported book, in place of the editor: the cover,
// the title page, every section in order and the pages Scribe makes, as the
// EPUB has them. It follows your writing as it's saved.
import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { Icon } from "../components/Icon";
import { usePublisher } from "../license/Publisher";
import { BOOK_STYLES, chooseStyle } from "./bookStyles";
import { bookOrder, copyrightHtml, inlineXhtml, madeSectionHtml, previewHtml } from "./epub";
import { imageMime, loadBookFonts } from "./fonts";
import { EditionFields } from "./EditionFields";
import { editionName, firstEdition } from "./bookEditions";
import { IsbnGuide } from "./IsbnGuide";
import { citationFormats, citedIds, emptySource, makeCiter } from "./sources";
import { SourceForm } from "./SourcesDialog";
import { DEFAULT_RIGHTS, KINDS, readPage } from "./pages";
const WIDTHS = [
    { value: "phone", label: "Phone", px: 380 },
    { value: "ereader", label: "E-reader", px: 560 },
    { value: "full", label: "Wide", px: 0 },
];
export function BookPreview({ project, chapters, settings, showing, picked, onShowList, onSettings, onClose, }) {
    const publisher = usePublisher();
    const [url, setUrl] = useState(null);
    const [width, setWidth] = useState("ereader");
    const [cover, setCover] = useState(null);
    const frame = useRef(null);
    const scroll = useRef(0);
    useEffect(() => {
        let current = true;
        if (!project.cover)
            return setCover(null);
        api.writingCover(project.id).then((bytes) => {
            const mime = bytes.length ? imageMime(bytes) : null;
            if (current)
                setCover(mime ? { bytes, mime } : null);
        }, () => current && setCover(null));
        return () => {
            current = false;
        };
    }, [project.id, project.cover, project.coverPath]);
    // Made again a moment after the words or settings change, keeping the place it was scrolled to.
    useEffect(() => {
        let made = null;
        let current = true;
        const timer = window.setTimeout(async () => {
            const [fonts, citer] = await Promise.all([
                loadBookFonts(settings, chapters).catch(() => ({ font: null, passageFonts: [] })),
                makeCiter(settings.citationStyle, settings.sources, bookOrder(chapters), settings.customSourceFormat).catch(() => null),
            ]);
            if (!current)
                return;
            made = URL.createObjectURL(new Blob([previewHtml({ project, chapters, settings, cover, citer, ...fonts })], { type: "text/html" }));
            scroll.current = frame.current?.contentWindow?.scrollY ?? scroll.current;
            setUrl(made);
        }, 350);
        return () => {
            current = false;
            window.clearTimeout(timer);
            if (made) {
                const old = made;
                // Let go once the next one has replaced it.
                window.setTimeout(() => URL.revokeObjectURL(old), 2000);
            }
        };
    }, [project, chapters, settings, cover]);
    const goTo = (id, smooth) => {
        const n = id ? bookOrder(chapters).findIndex((c) => c.id === id) + 1 : 0;
        const target = n ? frame.current?.contentDocument?.getElementById(`c${n}`) : null;
        target?.closest("article")?.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
    };
    useEffect(() => goTo(showing, true), [showing, picked]); // eslint-disable-line react-hooks/exhaustive-deps
    const px = WIDTHS.find((w) => w.value === width)?.px ?? 0;
    return (_jsxs("aside", { className: "book-preview", "aria-label": "Preview of the book", children: [_jsxs("div", { className: "book-preview-head", children: [onShowList && (_jsx("button", { type: "button", className: "writing-list-toggle", "aria-label": "Show the list", title: "Show the list", onClick: onShowList, children: _jsx(Icon, { name: "panelLeft", size: 17 }) })), _jsx("strong", { children: "Preview" }), _jsx("div", { className: "segmented book-preview-widths", role: "radiogroup", "aria-label": "Preview width", children: WIDTHS.map((w) => (_jsx("button", { type: "button", role: "radio", "aria-checked": width === w.value, className: width === w.value ? "is-active" : "", onClick: () => setWidth(w.value), children: w.label }, w.value))) }), _jsxs("button", { type: "button", className: "btn btn-quiet btn-small", onClick: onClose, children: [_jsx(Icon, { name: "edit", size: 16 }), " Back to writing"] })] }), _jsxs("div", { className: "book-styles book-preview-styles", role: "radiogroup", "aria-label": "Book style", children: [_jsxs("button", { type: "button", role: "radio", "aria-checked": !settings.bookStyle, className: "book-style", onClick: () => onSettings(chooseStyle(settings, null)), children: [_jsx("b", { children: "Your own" }), _jsx("span", { children: "Your export settings" })] }), BOOK_STYLES.map((s) => (_jsxs("button", { type: "button", role: "radio", "aria-checked": settings.bookStyle === s.id, className: `book-style book-style-${s.id}`, onClick: () => publisher.check("Book styles", () => onSettings(chooseStyle(settings, s.id))), children: [_jsx("b", { children: s.label }), _jsx("span", { children: s.about })] }, s.id)))] }), _jsx("div", { className: "book-preview-stage", children: url ? (_jsx("iframe", { ref: frame, title: "The book as it will be exported", src: url, sandbox: "allow-same-origin", style: px ? { width: px } : undefined, onLoad: () => frame.current?.contentWindow?.scrollTo(0, scroll.current) })) : (_jsx("div", { className: "library-loading", "aria-busy": "true", "aria-label": "Making the preview" })) })] }));
}
const field = (label, value, onChange, placeholder = "", multiline = false) => (_jsxs("label", { className: "field", children: [_jsx("span", { children: label }), multiline ? _jsx("textarea", { rows: 3, value: value, placeholder: placeholder, onChange: (e) => onChange(e.target.value) }) : _jsx("input", { value: value, placeholder: placeholder, onChange: (e) => onChange(e.target.value) })] }, label));
/**
 * A page Scribe makes (half title, title page, copyright, contents): what it
 * will say, the details it's made from, and a way to write it yourself.
 */
function BibliographyEntries({ citer, chapters, sources, onEdit }) {
    const cited = new Set(citedIds(chapters));
    const entries = citer?.bibliography() ?? [];
    if (!entries.length)
        return _jsx("p", { className: "muted", children: "Sources you cite or add here will appear in the bibliography." });
    return (_jsx("ul", { className: "writing-bibliography", children: entries.map(({ sourceId, html }) => {
            const source = sources.find((entry) => entry.id === sourceId);
            if (!source)
                return null;
            const additional = source.includeInBibliography && !cited.has(source.id);
            const text = inlineXhtml(html.replace(/^<div[^>]*>|<\/div>$/g, "")).replace(/ href="[^"]*"/g, "");
            return (_jsxs("li", { className: additional ? "is-additional" : undefined, children: [_jsxs("div", { children: [_jsx("span", { dangerouslySetInnerHTML: { __html: text } }), additional && _jsx("small", { children: "Added here \u00B7 uncited" })] }), _jsx("button", { type: "button", className: "icon-btn", "aria-label": `Edit ${source.title}`, onClick: () => onEdit(source), children: _jsx(Icon, { name: "edit", size: 16 }) })] }, source.id));
        }) }));
}
export function MadePage({ chapter, project, chapters, settings, onTitle, onCopyright, onEdition, onWriteMyself, onOpenDetails, onOpenSources, onSourcesChange, onFormatChange, canUndoSources, canRedoSources, onUndoSources, onRedoSources, }) {
    const page = readPage(chapter.page, chapter.role);
    const [title, setTitle] = useState(chapter.title);
    const [copyright, setCopyright] = useState(settings.copyright);
    const [citer, setCiter] = useState(null);
    const [editingSource, setEditingSource] = useState(null);
    const [customFormat, setCustomFormat] = useState(settings.customSourceFormat);
    useEffect(() => setCustomFormat(settings.customSourceFormat), [settings.customSourceFormat]);
    useEffect(() => {
        if (page.kind !== "sources")
            return;
        let current = true;
        void makeCiter(settings.citationStyle, settings.sources, bookOrder(chapters), settings.customSourceFormat).then((c) => current && setCiter(c), () => current && setCiter(null));
        return () => {
            current = false;
        };
    }, [page.kind, settings.citationStyle, settings.customSourceFormat, settings.sources, chapters]);
    useEffect(() => setTitle(chapter.title), [chapter.id, chapter.title]);
    useEffect(() => setCopyright(settings.copyright), [settings.copyright]);
    // Until the writer sets one, a first edition, named as their old Edition box had it.
    const [edition, setEdition] = useState(settings.edition);
    useEffect(() => setEdition(settings.edition), [settings.edition]);
    const shownEdition = edition ?? { ...firstEdition(""), group: "", name: settings.copyright.edition.trim() || editionName(1) };
    const changeEdition = (next) => {
        const kept = next.group ? next : { ...next, group: crypto.randomUUID() };
        setEdition(kept);
        onEdition(kept);
    };
    const html = page.kind === "sources" ? "" : page.kind === "copyright" ? copyrightHtml(project, copyright, new Date(), edition) : madeSectionHtml({ project, chapters, settings, citer }, chapter.id);
    // Links between pages only work in the book itself.
    const shown = html.replace(/ href="[^"]*"/g, "");
    const change = (c) => {
        const next = { ...copyright, ...c };
        setCopyright(next);
        onCopyright(next);
    };
    const about = {
        half_title: "Just the book's title, on a page of its own before the title page.",
        title_page: "Made from the book's title, author and series. Change them in Book details.",
        copyright: "Made from the details below and the book's author. Leave a box empty to leave it out.",
        contents: "Lists the sections shown in the contents, and stays up to date as you add, rename and move them.",
        sources: "Cited sources appear here automatically. You can edit their details or add sources directly to the bibliography.",
    }[page.kind];
    return (_jsxs("div", { className: "writing-sheet made-page", children: [_jsx("p", { className: "made-page-kind", children: KINDS[page.kind].label }), page.showTitle && (_jsx("input", { className: "writing-chapter-title made-page-title", "aria-label": "Title", value: title, onChange: (e) => setTitle(e.target.value), onBlur: () => title !== chapter.title && onTitle(title) })), _jsx("p", { className: "muted", children: about }), page.kind === "copyright" && (_jsxs("div", { className: "made-page-fields", children: [_jsxs("div", { className: "writing-details-row", children: [field("Year", copyright.year, (year) => change({ year }), String(new Date().getFullYear())), field("Copyright holder", copyright.holder, (holder) => change({ holder }), project.author ?? "The author")] }), _jsx(EditionFields, { edition: shownEdition, onChange: changeEdition }), copyright.isbn.trim() && !Object.values(shownEdition.isbns).some((i) => i?.trim()) && field("ISBN (format not given)", copyright.isbn, (isbn) => change({ isbn }), "None"), field("Publisher", copyright.publisher, (publisher) => change({ publisher }), "None"), field("Rights", copyright.rights, (rights) => change({ rights }), DEFAULT_RIGHTS, true), field("Notice", copyright.notice, (notice) => change({ notice }), "e.g. This is a work of fiction. Names and places are the author's invention.", true), _jsxs("label", { className: "check-row", children: [_jsx("input", { type: "checkbox", checked: copyright.credit !== false, onChange: (e) => change({ credit: e.target.checked }) }), _jsx("span", { children: "Add \"Made with The Bound Vigil\" at the foot of the page" })] }), _jsx(IsbnGuide, {})] })), page.kind === "sources" ? (_jsx("div", { className: "made-page-preview made-sources", "aria-label": "Bibliography entries", onKeyDown: (event) => {
                    if (editingSource || !(event.ctrlKey || event.metaKey) || event.altKey || event.target.closest("input, textarea, select, [contenteditable=true]"))
                        return;
                    const key = event.key.toLowerCase();
                    if (key !== "z" && key !== "y")
                        return;
                    event.preventDefault();
                    if (key === "y" || event.shiftKey)
                        onRedoSources();
                    else
                        onUndoSources();
                }, children: editingSource ? (_jsx(SourceForm, { source: editingSource, onCancel: () => setEditingSource(null), onSave: (source) => {
                        const existing = settings.sources.some((entry) => entry.id === source.id);
                        onSourcesChange(existing ? settings.sources.map((entry) => entry.id === source.id ? source : entry) : [...settings.sources, source]);
                        setEditingSource(null);
                    } }, editingSource.id)) : (_jsxs(_Fragment, { children: [_jsxs("div", { className: "settings-actions", children: [_jsxs("label", { className: "field", children: [_jsx("span", { children: "Format" }), _jsx("select", { value: settings.citationStyle, onChange: (event) => onFormatChange(event.target.value, settings.customSourceFormat), children: citationFormats(settings.citationStyle).map(({ value, label }) => _jsx("option", { value: value, children: label }, value)) })] }), _jsxs("button", { type: "button", className: "btn btn-quiet", disabled: !canUndoSources, onClick: onUndoSources, children: [_jsx(Icon, { name: "undo", size: 16 }), " Undo"] }), _jsxs("button", { type: "button", className: "btn btn-quiet", disabled: !canRedoSources, onClick: onRedoSources, children: [_jsx(Icon, { name: "redo", size: 16 }), " Redo"] })] }), settings.citationStyle === "custom" && (_jsxs("div", { className: "settings-actions", children: [_jsxs("label", { className: "field", children: [_jsx("span", { children: "Custom entry format" }), _jsx("input", { value: customFormat, maxLength: 500, placeholder: "{author}. {title}. {date}", onChange: (event) => setCustomFormat(event.target.value) }), _jsxs("small", { children: ["Fields: ", "{author}, {title}, {publication}, {publisher}, {date}, {url}, {doi}", ". Leave blank for the default numbered layout."] })] }), _jsx("button", { type: "button", className: "btn btn-quiet", disabled: customFormat === settings.customSourceFormat, onClick: () => onFormatChange("custom", customFormat), children: "Apply format" })] })), _jsx(BibliographyEntries, { citer: citer, chapters: chapters, sources: settings.sources, onEdit: setEditingSource }), _jsxs("button", { type: "button", className: "btn btn-quiet", onClick: () => setEditingSource({ ...emptySource(crypto.randomUUID()), includeInBibliography: true }), children: [_jsx(Icon, { name: "plus", size: 16 }), " Add a source"] })] })) })) : (_jsx("div", { className: `made-page-preview made-${page.kind}`, "aria-label": "What the page will say", dangerouslySetInnerHTML: { __html: shown } })), _jsxs("div", { className: "settings-actions", children: [page.kind === "title_page" || page.kind === "half_title" ? (_jsxs("button", { type: "button", className: "btn btn-quiet", onClick: onOpenDetails, children: [_jsx(Icon, { name: "info", size: 16 }), " Book details"] })) : null, page.kind === "sources" && (_jsxs("button", { type: "button", className: "btn btn-quiet", onClick: onOpenSources, children: [_jsx(Icon, { name: "bookClosed", size: 16 }), " Sources and citation style"] })), page.kind !== "sources" && (_jsxs("button", { type: "button", className: "btn btn-quiet", onClick: () => onWriteMyself(html), children: [_jsx(Icon, { name: "edit", size: 16 }), " Write it myself"] }))] })] }));
}

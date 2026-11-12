import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { RememberedDetails } from "../components/RememberedDetails";
import { FormattedText } from "./FormattedText";
import { useEffect, useRef, useState } from "react";
import { api, isApp, isWeb, isWindows } from "../api";
import { canvaHere } from "../settings/CanvaSection";
import { CanvaLink, EXPORT_CHANGED, keepCanvaDesign, keptCanvaDesign, useCanvaStatus } from "./CanvaLink";
import { wordsStamp } from "./canvaDesigns";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Icon } from "../components/Icon";
import { Menu } from "../components/Menu";
import { usePublisher } from "../license/Publisher";
import { useToast } from "../components/Toast";
import { bookOrder, buildEpub, epubFileName, exportProblems, readExport } from "./epub";
import { imageMime, loadBookFonts } from "./fonts";
import { citationProblems, makeCiter } from "./sources";
import { AuthorLabel } from "./AuthorInfo";
import { CoverMaker } from "./CoverMaker";
import { coverSeries, SERIES_NUMBERS, SERIES_WORDS, titlePageSeries } from "./seriesLabel";
import { WhereItCameFrom } from "./WhereItCameFrom";
import { pagesKey } from "./PaperbackCover";
import { BOOK_STYLES } from "./bookStyles";
import { buildDocx } from "./docx";
import { printHtml, TRIMS } from "./printBook";
import { bookFileName, buildTxt } from "./txt";
import { readPage, startingTitle, TEMPLATES, templateSections } from "./pages";
/** Everything an export is made from: the book, its cover, its sources and the fonts chosen. */
export async function bookInput(project, chapters, settings, withSounds = false) {
    const problems = citationProblems(settings.sources, chapters);
    if (problems.length)
        throw new Error(problems.join("\n"));
    const coverBytes = project.cover ? await api.writingCover(project.id) : new Uint8Array();
    const mime = coverBytes.length ? imageMime(coverBytes) : null;
    const citer = await makeCiter(settings.citationStyle, settings.sources, bookOrder(chapters), settings.customSourceFormat);
    return {
        project,
        chapters,
        settings,
        cover: mime ? { bytes: coverBytes, mime } : null,
        citer,
        ...(await loadBookFonts(settings, chapters)),
        ...(withSounds ? { sounds: await poemSounds(chapters) } : {}),
    };
}
/** The sounds of the book's poems that this device has, to go inside an EPUB. */
export async function poemSounds(chapters) {
    const sounds = new Map();
    for (const c of chapters) {
        const file = readPage(c.page, c.role).sound?.file;
        if (!file || sounds.has(file))
            continue;
        const bytes = await api.writingSound(file).catch(() => null);
        if (bytes?.length)
            sounds.set(file, bytes);
    }
    return sounds;
}
/** The book made into an EPUB, with its cover and the font chosen. */
export async function makeEpub(project, chapters, settings) {
    return buildEpub(await bookInput(project, chapters, settings, true));
}
const OPENS_WITH = [
    { value: null, label: "The cover, then a title page" },
    { value: "cover", label: "The cover only" },
    { value: "title", label: "A title page only" },
    { value: "none", label: "Straight into the book" },
];
/** Starting a new book. */
export function NewBookDialog({ onCreated, onCancel, startWith = "blank", }) {
    const [title, setTitle] = useState("");
    const [author, setAuthor] = useState("");
    const [template, setTemplate] = useState(startWith);
    const [error, setError] = useState(null);
    const [busy, setBusy] = useState(false);
    const create = async () => {
        if (!title.trim())
            return setError("Give the book a title. You can change it later.");
        setBusy(true);
        try {
            const made = await api.createWritingProject(title, author.trim() || null);
            // Every book starts with a first chapter; a template adds the pages around it.
            const first = made.chapters[0];
            for (const s of templateSections(template)) {
                const added = await api.addWritingSection(made.project.id, {
                    title: s.title ?? startingTitle(s.kind, made.project),
                    role: s.role,
                    page: s.role === "part" ? "{}" : JSON.stringify({ kind: s.kind }),
                });
                if (s.role === "part" && first)
                    await api.setWritingChapterPart(first.id, added.id);
            }
            // Remembered for the book's card ("Novel · 12 chapters").
            await api.setWritingExport(made.project.id, JSON.stringify({ ...readExport(made.project.export), kind: template, citationStyle: "custom" }));
            onCreated(made.project.id);
        }
        catch (e) {
            setError(String(e));
            setBusy(false);
        }
    };
    return (_jsx("div", { className: "dialog-backdrop", onPointerDown: (e) => e.target === e.currentTarget && !busy && onCancel(), children: _jsxs("form", { className: "dialog writing-dialog", role: "dialog", "aria-label": "New book", onSubmit: (e) => {
                e.preventDefault();
                void create();
            }, onKeyDown: (e) => e.key === "Escape" && !busy && onCancel(), children: [_jsx("h2", { children: "New book" }), _jsxs("label", { className: "field", children: [_jsx("span", { children: "Title" }), _jsx("input", { value: title, onChange: (e) => setTitle(e.target.value), maxLength: 200, autoFocus: true })] }), _jsxs("label", { className: "field", children: [_jsx(AuthorLabel, {}), _jsx("input", { value: author, onChange: (e) => setAuthor(e.target.value), placeholder: "Your name, or a pen name" })] }), _jsxs("fieldset", { className: "writing-templates", children: [_jsx("legend", { children: "Start with" }), _jsx("div", { className: "writing-template-grid", children: TEMPLATES.map((t) => (_jsxs("label", { className: `writing-template${template === t.value ? " is-on" : ""}`, children: [_jsx("input", { type: "radio", name: "writing-template", checked: template === t.value, onChange: () => setTemplate(t.value) }), _jsx("strong", { children: t.label }), _jsx("span", { children: t.hint })] }, t.value))) })] }), error && (_jsx("p", { className: "form-error", role: "alert", children: error })), _jsxs("div", { className: "dialog-actions", children: [_jsx("button", { type: "button", className: "btn btn-quiet", onClick: onCancel, disabled: busy, children: "Cancel" }), _jsx("button", { type: "submit", className: "btn btn-primary", disabled: busy, children: "Start writing" })] })] }) }));
}
/** A book's details, as an EPUB will carry them, and its cover. */
export function DetailsDialog({ project, onSaved, onCancel, focus = "title", }) {
    const [details, setDetails] = useState({
        title: project.title,
        author: project.author,
        series: project.series,
        seriesIndex: project.seriesIndex,
        language: project.language,
        description: project.description,
    });
    const [cover, setCover] = useState(project);
    const savedSeriesStyle = readExport(project.export).seriesStyle;
    const [seriesStyle, setSeriesStyle] = useState(savedSeriesStyle);
    const [opensWith, setOpensWith] = useState(project.coverPage);
    const [making, setMaking] = useState(false);
    const [error, setError] = useState(null);
    const [busy, setBusy] = useState(false);
    const set = (change) => setDetails((d) => ({ ...d, ...change }));
    const save = async () => {
        if (!details.title.trim())
            return setError("The book needs a title.");
        setBusy(true);
        try {
            // Saved first, so the book that comes back carries it.
            if (seriesStyle.word !== savedSeriesStyle.word || seriesStyle.numbers !== savedSeriesStyle.numbers)
                await api.setWritingExport(project.id, JSON.stringify({ ...readExport(project.export), seriesStyle }));
            const saved = await api.updateWritingDetails(project.id, details);
            onSaved(opensWith !== project.coverPage ? await api.setWritingCoverPage(project.id, opensWith) : saved);
        }
        catch (e) {
            setError(String(e));
            setBusy(false);
        }
    };
    const pickCover = async () => {
        const path = await api.pickWritingCover();
        if (!path)
            return;
        try {
            setCover(await api.setWritingCover(project.id, path));
        }
        catch (e) {
            setError(String(e));
        }
    };
    const removeCover = async () => {
        try {
            setCover(await api.setWritingCover(project.id, null));
        }
        catch (e) {
            setError(String(e));
        }
    };
    const coverSrc = cover.coverPath ? (isWeb ? cover.coverPath : api.coverUrl(cover.coverPath)) : null;
    return (_jsxs("div", { className: "dialog-backdrop", onPointerDown: (e) => e.target === e.currentTarget && !busy && onCancel(cover), children: [_jsxs("form", { className: "dialog writing-dialog writing-details", role: "dialog", "aria-label": "Book details", onSubmit: (e) => {
                    e.preventDefault();
                    void save();
                }, onKeyDown: (e) => e.key === "Escape" && !busy && onCancel(cover), children: [_jsx("h2", { children: "Book details" }), _jsx("p", { className: "muted dialog-lede", children: "These go into the EPUB, so e-readers and stores show them." }), _jsxs("div", { className: "writing-details-grid", children: [_jsxs("div", { className: "writing-details-cover", children: [coverSrc ? _jsx("img", { src: coverSrc, alt: "" }) : _jsx("div", { className: "writing-cover-blank", children: details.title || "Cover" }), !isWeb && (_jsx("button", { type: "button", className: "btn btn-quiet btn-small", onClick: () => void pickCover(), autoFocus: focus === "cover", children: cover.cover ? "Change cover" : "Choose a cover" })), !isWeb && (_jsx("button", { type: "button", className: "btn btn-quiet btn-small", onClick: () => setMaking(true), children: "Make a cover" })), cover.cover && (_jsx("button", { type: "button", className: "link-btn", onClick: () => void removeCover(), children: "Remove cover" }))] }), _jsxs("div", { className: "writing-details-fields", children: [_jsxs("label", { className: "field", children: [_jsx("span", { children: "Title" }), _jsx("input", { value: details.title, onChange: (e) => set({ title: e.target.value }), maxLength: 200, autoFocus: focus === "title" })] }), _jsxs("label", { className: "field", children: [_jsx(AuthorLabel, {}), _jsx("input", { value: details.author ?? "", onChange: (e) => set({ author: e.target.value }), autoFocus: focus === "author" })] }), _jsxs("div", { className: "writing-details-row", children: [_jsxs("label", { className: "field", children: [_jsx("span", { children: "Series" }), _jsx("input", { value: details.series ?? "", onChange: (e) => set({ series: e.target.value }), placeholder: "None" })] }), _jsxs("label", { className: "field writing-number", children: [_jsx("span", { children: "Number" }), _jsx("input", { type: "number", min: 0, step: "any", value: details.seriesIndex ?? "", onChange: (e) => set({ seriesIndex: e.target.value === "" ? null : Number(e.target.value) }) })] }), _jsxs("label", { className: "field writing-number", children: [_jsx("span", { children: "Language" }), _jsx("input", { value: details.language ?? "", onChange: (e) => set({ language: e.target.value }), placeholder: "en", maxLength: 20 })] })] }), !!details.series?.trim() && _jsx(SeriesStyleFields, { style: seriesStyle, index: details.seriesIndex, series: details.series.trim(), onChange: setSeriesStyle }), _jsxs("div", { className: "field", children: [_jsx("span", { children: "Description" }), _jsx(FormattedText, { rows: 4, value: details.description ?? "", onChange: (description) => set({ description }), placeholder: "The words on the back of the book" })] }), _jsxs("label", { className: "field", children: [_jsx("span", { children: "The book opens with" }), _jsx("select", { value: opensWith ?? "", onChange: (e) => setOpensWith((e.target.value || null)), children: OPENS_WITH.map((o) => (_jsx("option", { value: o.value ?? "", children: o.label }, o.value ?? ""))) })] })] })] }), _jsx(WhereItCameFrom, { projectId: project.id }), error && (_jsx("p", { className: "form-error", role: "alert", children: error })), _jsxs("div", { className: "dialog-actions", children: [_jsx("button", { type: "button", className: "btn btn-quiet", onClick: () => onCancel(cover), disabled: busy, children: "Cancel" }), _jsx("button", { type: "submit", className: "btn btn-primary", disabled: busy, children: "Save" })] })] }), making && (_jsx(CoverMaker, { project: { ...cover, title: details.title || cover.title, author: details.author ?? cover.author }, seriesLine: details.series?.trim() ? coverSeries(details.series.trim(), details.seriesIndex, seriesStyle) : null, onCancel: () => setMaking(false), onMade: (p) => {
                    setCover(p);
                    setMaking(false);
                } }))] }));
}
/** What the book's place in its series is called: Book, Volume… and how the number is written. */
function SeriesStyleFields({ style, index, series, onChange }) {
    const isPreset = SERIES_WORDS.includes(style.word);
    // Chosen apart from the word, so picking "Another word…" shows its box even while it still reads "Book".
    const [custom, setCustom] = useState(!isPreset && !!style.word);
    const preset = custom ? "other" : isPreset ? style.word : "none";
    return (_jsxs("div", { className: "writing-details-row series-style", children: [_jsxs("label", { className: "field", children: [_jsx("span", { children: "Called" }), _jsxs("select", { value: preset, onChange: (e) => {
                            setCustom(e.target.value === "other");
                            if (e.target.value !== "other")
                                onChange({ ...style, word: e.target.value === "none" ? "" : e.target.value });
                        }, children: [SERIES_WORDS.map((w) => (_jsx("option", { value: w, children: w }, w))), _jsx("option", { value: "other", children: "Another word\u2026" }), _jsx("option", { value: "none", children: "Just the number" })] })] }), preset === "other" && (_jsxs("label", { className: "field", children: [_jsx("span", { children: "Your word" }), _jsx("input", { value: style.word, maxLength: 40, onChange: (e) => onChange({ ...style, word: e.target.value }) })] })), _jsxs("label", { className: "field", children: [_jsx("span", { children: "Number written as" }), _jsx("select", { value: style.numbers, onChange: (e) => onChange({ ...style, numbers: e.target.value }), children: SERIES_NUMBERS.map((n) => (_jsx("option", { value: n.value, children: n.label }, n.value))) })] }), _jsxs("p", { className: "settings-row-hint series-style-example", children: ["Title page: ", titlePageSeries(series, index ?? 2, style), ". Cover: ", coverSeries(series, index ?? 2, style), "."] })] }));
}
const FONTS = [
    { value: "none", label: "None, the reader chooses" },
    { value: "lora", label: "Lora" },
    { value: "echolume", label: "Echolume" },
];
const BREAKS = [
    { value: "asterisks", label: "* * *" },
    { value: "ornament", label: "❦" },
    { value: "line", label: "A short line" },
    { value: "space", label: "A blank space" },
];
const DEPTHS = [
    { value: 1, label: "Chapters" },
    { value: 2, label: "Chapters and headings" },
    { value: 3, label: "Chapters, headings and smaller headings" },
];
const FORMATS = [
    { value: "epub", label: "EPUB", lede: "A standard EPUB 3 that e-readers and stores accept. Changes show in the preview straight away." },
    { value: "pdf", label: "Print PDF", lede: "Pages ready for a paperback: a trim size KDP and IngramSpark accept, mirrored margins, running heads and page numbers." },
    { value: "docx", label: "Word", lede: "A Word file with Word's own heading styles, real footnotes, pictures and page breaks, for editors and beta readers." },
    { value: "txt", label: "Text", lede: "Plain text: the words alone, with titles in capitals and each chapter's notes after it." },
    { value: "manuscript", label: "Manuscript", lede: "A standard manuscript for agents, publishers and magazines, as a Word file." },
];
/** The book's look for print: Lora when the e-reader would have chosen, since a printed page has to carry its own font. */
const forPrint = (settings) => (settings.font === "none" ? { ...settings, font: "lora" } : settings);
/** Making the book into a file: how it looks, and where it goes. */
export function ExportDialog({ project, chapters, onFlush, onSettings, onClose, }) {
    const [settings, setSettings] = useState(() => readExport(project.export));
    // A Canva design kept while this is open (the printed pages) joins these settings, so the next change doesn't drop it.
    useEffect(() => {
        const changed = (e) => {
            const { projectId, json } = e.detail;
            if (projectId === project.id)
                setSettings((s) => ({ ...s, canva: readExport(json).canva }));
        };
        window.addEventListener(EXPORT_CHANGED, changed);
        return () => window.removeEventListener(EXPORT_CHANGED, changed);
    }, [project.id]);
    const [format, setFormat] = useState(() => {
        try {
            const saved = localStorage.getItem("tbv.writing.exportFormat");
            return FORMATS.some((f) => f.value === saved) ? saved : "epub";
        }
        catch {
            return "epub";
        }
    });
    const [addToLibrary, setAddToLibrary] = useState(!isWeb);
    // An EPUB goes to the library; Word, text and PDF files are saved as files too by default.
    const [saveCopy, setSaveCopy] = useState(() => isWeb || format !== "epub");
    const [busy, setBusy] = useState(null);
    const [error, setError] = useState(null);
    const toast = useToast();
    const publisher = usePublisher();
    const set = (change) => {
        // Changing a setting a style chose keeps the style's looks, with that one setting changed.
        const next = { ...settings, ...change };
        setSettings(next);
        onSettings(next);
    };
    const setPrint = (change) => set({ print: { ...settings.print, ...change } });
    const setManuscript = (change) => set({ manuscript: { ...settings.manuscript, ...change } });
    const pick = (f) => {
        setFormat(f);
        setSaveCopy(isWeb || f !== "epub");
        setError(null);
        try {
            localStorage.setItem("tbv.writing.exportFormat", f);
        }
        catch {
            // Remembered for this time only.
        }
    };
    const problems = [...exportProblems(chapters), ...citationProblems(settings.sources, chapters)];
    const hasParts = chapters.some((c) => c.role === "part");
    const lede = FORMATS.find((f) => f.value === format).lede;
    const input = (latest, s) => bookInput(project, latest, s);
    const make = async () => {
        if (format !== "pdf" && !addToLibrary && !saveCopy)
            return setError("Choose where it goes.");
        // A style or a print PDF chosen while trying TBV needs Publisher to export once the trial is over.
        if (!publisher.allowed && (format === "pdf" || (format !== "txt" && format !== "manuscript" && settings.bookStyle)))
            return publisher.check(format === "pdf" ? "Print-ready PDF" : "Book styles", () => undefined);
        setError(null);
        try {
            if (format === "epub") {
                setBusy("Making the EPUB…");
                const latest = await onFlush();
                const fileName = epubFileName(project.title);
                const path = saveCopy && !isWeb ? await api.pickEpubSavePath(fileName) : null;
                if (saveCopy && !isWeb && !path && !addToLibrary)
                    return setBusy(null);
                const bytes = await makeEpub(project, latest, settings);
                await api.setWritingExport(project.id, JSON.stringify(settings));
                await api.saveWritingEpub(bytes, fileName, path, addToLibrary);
                toast(addToLibrary ? (path ? "Saved, and being added to your library." : "Being added to your library.") : isWeb ? "The EPUB has been downloaded." : "The EPUB has been saved.");
                return onClose();
            }
            if (format === "pdf") {
                // Windows saves the PDF itself; elsewhere the print dialog has "Save as PDF".
                const path = isWindows ? await api.pickExportPath(bookFileName(project.title, "pdf"), "pdf") : null;
                if (isWindows && !path)
                    return;
                setBusy("Laying out the pages…");
                const latest = await onFlush();
                await api.setWritingExport(project.id, JSON.stringify(settings));
                const pages = await api.printBook(printHtml(await input(latest, forPrint(settings)), settings.print), path);
                // The saved PDF goes into the Archive's Documents too.
                if (path && addToLibrary)
                    await api.queueImports([path]).catch(() => 0);
                try {
                    localStorage.setItem(pagesKey(project.id), String(pages));
                }
                catch {
                    // The cover maker guesses from the words instead.
                }
                toast(path ? `The PDF has been saved: ${pages} pages${addToLibrary ? ", and is being added to your Documents" : ""}.` : `${pages} pages, ready to print or save as a PDF.`);
                return onClose();
            }
            const extension = format === "txt" ? "txt" : "docx";
            const fileName = bookFileName(format === "manuscript" ? `${project.title} (manuscript)` : project.title, extension);
            const path = saveCopy && !isWeb ? await api.pickExportPath(fileName, extension) : null;
            if (saveCopy && !isWeb && !path && !addToLibrary)
                return;
            setBusy(format === "txt" ? "Making the text file…" : "Making the Word file…");
            const latest = await onFlush();
            await api.setWritingExport(project.id, JSON.stringify(settings));
            const book = await input(latest, settings);
            const bytes = format === "txt" ? new TextEncoder().encode(buildTxt(book)) : await buildDocx(book, format === "manuscript" ? settings.manuscript : null);
            if (isWeb) {
                await api.saveExportFile(bytes, fileName, null);
                toast(`${fileName} has been downloaded.`);
            }
            else {
                // The same saving as an EPUB's: a copy where it was asked for, and into the Archive's Documents.
                await api.saveWritingEpub(bytes, fileName, path, addToLibrary);
                toast(addToLibrary ? (path ? `${fileName} has been saved, and is being added to your Documents.` : `${fileName} is being added to your Documents.`) : `${fileName} has been saved.`);
            }
            onClose();
        }
        catch (e) {
            setError(String(e).replace(/^Error: /, ""));
        }
        finally {
            setBusy(null);
        }
    };
    const select = (label, value, options, onChange, autoFocus = false) => (_jsxs("label", { className: "field", children: [_jsx("span", { children: label }), _jsx("select", { autoFocus: autoFocus, value: String(value), onChange: (e) => onChange(options.find((o) => String(o.value) === e.target.value).value), children: options.map((o) => (_jsx("option", { value: String(o.value), children: o.label }, String(o.value)))) })] }));
    const check = (label, checked, onChange) => (_jsxs("label", { className: "check-row", children: [_jsx("input", { type: "checkbox", checked: checked, onChange: (e) => onChange(e.target.checked) }), _jsx("span", { children: label })] }));
    const styled = format === "epub" || format === "pdf" || format === "docx";
    return (_jsx("div", { className: "dialog-backdrop", onPointerDown: (e) => e.target === e.currentTarget && !busy && onClose(), children: _jsxs("form", { className: "dialog writing-dialog writing-export", role: "dialog", "aria-label": "Export", onSubmit: (e) => {
                e.preventDefault();
                void make();
            }, onKeyDown: (e) => e.key === "Escape" && !busy && onClose(), children: [_jsx("h2", { children: "Export" }), _jsx("div", { className: "segmented writing-export-formats", role: "radiogroup", "aria-label": "Format", children: FORMATS.map((f) => (_jsx("button", { type: "button", role: "radio", "aria-checked": format === f.value, onClick: () => (f.value === "pdf" ? publisher.check("Print-ready PDF", () => pick(f.value)) : pick(f.value)), children: f.label }, f.value))) }), _jsx("p", { className: "muted dialog-lede", children: lede }), styled && (_jsxs("p", { className: "muted writing-export-style", children: ["Book style: ", _jsx("b", { children: BOOK_STYLES.find((s) => s.id === settings.bookStyle)?.label ?? "Your own" }), ". Choose and compare styles in Preview, before exporting."] })), styled && (_jsxs(RememberedDetails, { disclosure: "writing.exportOptions", className: "writing-export-more", children: [_jsx("summary", { children: "Fonts, headings and paragraphs" }), select("Font", settings.font, FONTS, (font) => set({ font }), true), select("Scene breaks", settings.sceneBreak, BREAKS, (sceneBreak) => set({ sceneBreak })), format === "epub" && select("Table of contents", settings.tocDepth, DEPTHS, (tocDepth) => set({ tocDepth })), _jsxs("div", { className: "writing-export-styles", children: [select("Paragraphs", settings.paragraphs, [{ value: "indent", label: "Indented" }, { value: "space", label: "Spaced" }], (paragraphs) => set({ paragraphs })), select("Lines", settings.align, [{ value: "justify", label: "Justified" }, { value: "left", label: "Ragged right" }], (align) => set({ align })), select("Chapter titles", settings.titles, [{ value: "center", label: "Centred" }, { value: "left", label: "On the left" }], (titles) => set({ titles }))] }), check("Start each chapter on a new page", settings.newPage, (newPage) => set({ newPage })), _jsxs("div", { className: "writing-export-styles", children: [select("Chapter headings", settings.chapterHeading, [
                                    { value: "title", label: "The title only" },
                                    { value: "number", label: "Chapter 1, then the title" },
                                    { value: "words", label: "Chapter One, then the title" },
                                    { value: "numeral", label: "1, then the title" },
                                ], (chapterHeading) => set({ chapterHeading })), hasParts &&
                                    select("Chapter numbers", settings.numbering, [
                                        { value: "restart", label: "Start again in each section" },
                                        { value: "continuous", label: "Run on through the book" },
                                    ], (numbering) => set({ numbering }))] }), check("A large first letter at the start of each chapter", settings.dropCap, (dropCap) => set({ dropCap })), check("The first line of each chapter in small capitals", settings.smallCaps, (smallCaps) => set({ smallCaps }))] })), format === "pdf" && (_jsxs("fieldset", { className: "writing-export-group", children: [_jsx("legend", { children: "Pages" }), select("Trim size", settings.print.trim, TRIMS.map((t) => ({ value: t.value, label: t.label })), (trim) => setPrint({ trim })), check("Mirrored margins, wider on the inside (grows with the page count)", settings.print.mirrored, (mirrored) => setPrint({ mirrored })), check("Start chapters on a right-hand page", settings.print.chaptersRight, (chaptersRight) => setPrint({ chaptersRight })), check("Running heads: the book's title on the left, the chapter's on the right", settings.print.runningHeads, (runningHeads) => setPrint({ runningHeads })), check("Page numbers", settings.print.pageNumbers, (pageNumbers) => setPrint({ pageNumbers })), check("Bleed: an extra eighth of an inch for pictures that run to the edge", settings.print.bleed, (bleed) => setPrint({ bleed })), _jsx(CanvaPages, { project: project, settings: settings, onFlush: onFlush, input: input }), _jsx("p", { className: "muted writing-export-note", children: isWindows
                                ? "The PDF is saved where you choose, at the trim size, with its fonts inside it."
                                : isApp
                                    ? "The pages open in a window with the print dialog. Choose Save as PDF there."
                                    : "The pages open in a new tab with the print dialog. Choose Save as PDF there, with margins set to None." })] })), format === "manuscript" && (_jsxs("fieldset", { className: "writing-export-group", children: [_jsx("legend", { children: "Manuscript" }), _jsxs("div", { className: "writing-export-styles", children: [select("Layout", settings.manuscript.layout, [
                                    { value: "shunn", label: "Prose (Shunn standard)" },
                                    { value: "poetry", label: "Poetry (standard poetry)" },
                                ], (layout) => setManuscript({ layout }), true), select("Font", settings.manuscript.font, [
                                    { value: "times", label: "Times New Roman, 12 pt" },
                                    { value: "courier", label: "Courier New, 12 pt" },
                                ], (font) => setManuscript({ font }))] }), _jsx("p", { className: "muted writing-export-note", children: "Your details go at the top of the first page. Your surname, the title and the page number head every page after it." }), _jsxs("label", { className: "field", children: [_jsx("span", { children: "Your name (legal name, if you write under a pen name)" }), _jsx("input", { value: settings.manuscript.name, placeholder: project.author ?? "", onChange: (e) => setManuscript({ name: e.target.value }) })] }), _jsxs("label", { className: "field", children: [_jsx("span", { children: "Address" }), _jsx("textarea", { rows: 2, value: settings.manuscript.address, onChange: (e) => setManuscript({ address: e.target.value }) })] }), _jsxs("div", { className: "writing-export-styles", children: [_jsxs("label", { className: "field", children: [_jsx("span", { children: "Phone" }), _jsx("input", { value: settings.manuscript.phone, onChange: (e) => setManuscript({ phone: e.target.value }) })] }), _jsxs("label", { className: "field", children: [_jsx("span", { children: "Email" }), _jsx("input", { type: "email", value: settings.manuscript.email, onChange: (e) => setManuscript({ email: e.target.value }) })] })] })] })), format === "epub" && (_jsxs("div", { className: "writing-export-where", children: [_jsx("strong", { children: "Where it goes" }), !isWeb && check("Add it to my library, where it can be read or sent to a Kindle", addToLibrary, setAddToLibrary), check(isWeb ? "Download the EPUB" : "Save a copy on this device", saveCopy, setSaveCopy), _jsx("p", { className: "muted writing-export-note", children: "Every EPUB made here notes, inside the file where readers don't see it, that it was made with The Bound Vigil. The \"Made with\" line on the copyright page can be turned off there." })] })), (format === "txt" || format === "docx" || format === "manuscript") && !isWeb && (_jsxs("div", { className: "writing-export-where", children: [_jsx("strong", { children: "Where it goes" }), check("Add it to my Documents in the Archive", addToLibrary, setAddToLibrary), check("Save a copy on this device", saveCopy, setSaveCopy)] })), format === "pdf" && isWindows && (_jsxs("div", { className: "writing-export-where", children: [_jsx("strong", { children: "Where it goes" }), check("Also add it to my Documents in the Archive", addToLibrary, setAddToLibrary)] })), (error || problems.length > 0) && (_jsx("p", { className: "form-error", role: "alert", children: error ?? problems[0] })), _jsxs("div", { className: "dialog-actions", children: [_jsx("button", { type: "button", className: "btn btn-quiet", onClick: onClose, disabled: !!busy, children: "Cancel" }), _jsx("button", { type: "submit", className: "btn btn-primary", disabled: !!busy || problems.length > 0, children: busy ?? (format === "pdf" && !isWindows ? "Lay out and print" : "Export") })] })] }) }));
}
const dateOf = (iso) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
/**
 * A book's drafts. A new draft keeps the book as it stands, locked, and you
 * carry on writing; earlier drafts open in the reader for highlights and
 * notes, and stay in Scribe (never the Archive).
 */
export function DraftsDialog({ project, onFlush, onOpen, onImport, onRestore, onClose, }) {
    const [drafts, setDrafts] = useState(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const [deleting, setDeleting] = useState(null);
    const toast = useToast();
    useEffect(() => {
        let current = true;
        api.writingDrafts(project.id).then((list) => current && setDrafts(list), (e) => current && setError(String(e)));
        return () => {
            current = false;
        };
    }, [project.id]);
    const next = (drafts ?? []).reduce((n, d) => Math.max(n, d.number), 0) + 1;
    const keep = async () => {
        setBusy(true);
        setError(null);
        try {
            const latest = await onFlush();
            const problems = exportProblems(latest);
            if (problems.length)
                throw new Error(problems[0]);
            const draft = await api.saveWritingDraft(project.id, await makeEpub({ ...project, title: `${project.title} (Draft ${next})` }, latest, readExport(project.export)));
            setDrafts((list) => [...(list ?? []), draft]);
            toast(`Kept as Draft ${draft.number}. You're writing Draft ${draft.number + 1} now.`);
        }
        catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        }
        setBusy(false);
    };
    return (_jsxs("div", { className: "dialog-backdrop", onPointerDown: (e) => e.target === e.currentTarget && !busy && onClose(), children: [_jsxs("div", { className: "dialog writing-dialog writing-drafts", role: "dialog", "aria-label": "Drafts", onKeyDown: (e) => e.key === "Escape" && !busy && onClose(), children: [_jsx("h2", { children: "Drafts" }), _jsx("p", { className: "muted dialog-lede", children: "A new draft keeps the book as it is now, locked, and you carry on writing. Open an earlier draft to read it, highlight it and make notes, just like a book in your Archive." }), _jsxs("div", { className: "writing-draft-now", children: [_jsxs("div", { children: [_jsxs("strong", { children: ["Draft ", next] }), _jsx("span", { className: "muted", children: " \u00B7 the one you're writing" })] }), _jsxs("button", { type: "button", className: "btn btn-primary", disabled: busy || drafts === null, onClick: () => void keep(), children: [_jsx(Icon, { name: "plus", size: 15 }), " ", busy ? "Keeping…" : "New draft"] })] }), drafts === null && !error ? (_jsx("div", { className: "library-loading", "aria-busy": "true", "aria-label": "Loading drafts" })) : drafts && drafts.length > 0 ? (_jsx("ul", { className: "writing-draft-list", children: [...drafts].reverse().map((d) => (_jsxs("li", { children: [_jsxs("button", { type: "button", className: "writing-draft", onClick: () => onOpen(d.bookId), children: [_jsx(Icon, { name: "lock", size: 15 }), _jsxs("span", { className: "writing-draft-name", children: ["Draft ", d.number] }), _jsxs("span", { className: "muted", children: [dateOf(d.createdAt), " \u00B7 ", d.words.toLocaleString(), " ", d.words === 1 ? "word" : "words"] })] }), _jsx(Menu, { label: `More for Draft ${d.number}`, className: "icon-btn icon-btn-s", align: "end", trigger: _jsx(Icon, { name: "more", size: 16 }), items: [
                                        { label: "Open", icon: "bookOpen", onSelect: () => onOpen(d.bookId) },
                                        { label: "Un-draft…", icon: "edit", onSelect: () => onRestore(d) },
                                        "divider",
                                        { label: "Delete draft…", icon: "trash", danger: true, onSelect: () => setDeleting(d) },
                                    ] })] }, d.id))) })) : (_jsx("p", { className: "muted writing-drafts-empty", children: "No earlier drafts yet." })), error && (_jsx("p", { className: "form-error", role: "alert", children: error })), _jsxs("div", { className: "dialog-actions", children: [onImport && (_jsxs("button", { type: "button", className: "btn btn-quiet writing-drafts-import", onClick: onImport, disabled: busy, children: [_jsx(Icon, { name: "upload", size: 15 }), " Import a file as a draft\u2026"] })), _jsx("button", { type: "button", className: "btn btn-quiet", onClick: onClose, disabled: busy, children: "Done" })] })] }), deleting && (_jsx(ConfirmDialog, { title: `Delete Draft ${deleting.number}?`, body: "Its highlights and notes go too, on all your devices. The book you're writing isn't changed.", confirm: "Delete draft", danger: true, onCancel: () => setDeleting(null), onConfirm: () => {
                    const gone = deleting;
                    setDeleting(null);
                    void api.deleteWritingDraft(gone.id).then(() => setDrafts((list) => (list ?? []).filter((d) => d.id !== gone.id)), (e) => toast(String(e)));
                } }))] }));
}
/** Counts a PDF's pages from its page objects, without opening it. */
export function pdfPageCount(bytes) {
    const text = new TextDecoder("latin1").decode(bytes);
    return (text.match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;
}
/** The printed pages laid out in Canva: sent as a PDF, changed there, and brought back as the PDF for the printer. */
function CanvaPages({ project, settings, onFlush, input, }) {
    const [status] = useCanvaStatus();
    const [changed, setChanged] = useState(false);
    const picking = useRef(null);
    const waiting = useRef(null);
    const toast = useToast();
    const trim = TRIMS.find((t) => t.value === settings.print.trim) ?? TRIMS[0];
    const on = canvaHere && !!status?.available && !!status.name;
    // The words changed after the pages went to Canva: those changes aren't in the design.
    useEffect(() => {
        if (!on)
            return;
        let live = true;
        void (async () => {
            const kept = await keptCanvaDesign(project.id, "interior");
            if (!kept?.stamp)
                return;
            const latest = await onFlush();
            const now = await wordsStamp(latest.filter((c) => c.role !== "part").map((c) => c.body));
            if (live)
                setChanged(now !== kept.stamp);
        })().catch(() => undefined);
        return () => void (live = false);
    }, [on, project.id]);
    // Closing the file picker without choosing fires "cancel", not "change".
    useEffect(() => {
        const input = picking.current;
        if (!input)
            return;
        const cancelled = () => {
            waiting.current?.(null);
            waiting.current = null;
        };
        input.addEventListener("cancel", cancelled);
        return () => input.removeEventListener("cancel", cancelled);
    }, []);
    const choosePdf = () => new Promise((resolve) => {
        waiting.current = resolve;
        picking.current?.click();
    });
    /** Lays the pages out as usual, then sends that PDF. */
    const sendPages = async () => {
        const latest = await onFlush();
        const title = `${project.title} (pages)`;
        if (isWindows) {
            const path = await api.pickExportPath(bookFileName(`${project.title} (pages for Canva)`, "pdf"), "pdf");
            if (!path)
                throw new Error("Choose where to save the pages first.");
            await api.printBook(printHtml(await input(latest, forPrint(settings)), settings.print), path);
            toast("Sending the pages to Canva. A long book takes a minute or two.");
            return api.canvaImportFile(path, title);
        }
        // Elsewhere the print dialog saves the PDF; then it's chosen to send.
        await api.printBook(printHtml(await input(latest, forPrint(settings)), settings.print), null);
        toast("Save the pages as a PDF in the print dialog, then choose that file.");
        const file = await choosePdf();
        if (!file)
            throw new Error("No PDF was chosen, so nothing went to Canva.");
        toast("Sending the pages to Canva. A long book takes a minute or two.");
        return api.canvaImport(title, "application/pdf", new Uint8Array(await file.arrayBuffer()));
    };
    const bringBack = async (pdf) => {
        const fileName = bookFileName(`${project.title} (pages from Canva)`, "pdf");
        const path = isWeb ? null : await api.pickExportPath(fileName, "pdf");
        if (!isWeb && !path)
            return;
        await api.saveExportFile(pdf, fileName, path);
        const pages = pdfPageCount(pdf);
        if (pages) {
            try {
                // The paperback cover's spine follows the pages Canva sent back.
                localStorage.setItem(pagesKey(project.id), String(pages));
            }
            catch {
                // The cover maker guesses from the words instead.
            }
            const kept = await keptCanvaDesign(project.id, "interior");
            if (kept)
                await keepCanvaDesign(project.id, "interior", { ...kept, pages });
        }
        toast(`${fileName} has been saved${pages ? `: ${pages} pages` : ""}.`);
    };
    if (!canvaHere)
        return null;
    return (_jsxs(_Fragment, { children: [changed && (_jsxs("p", { className: "import-flag canva-pages-changed", role: "status", children: [_jsx(Icon, { name: "warning", size: 14 }), " The book's words have changed since its pages went to Canva. Those changes aren't in the Canva design: make them there too, or send the pages again with Start a new design."] })), _jsx(CanvaLink, { what: "the book's pages", size: `${trim.label}`, canva: {
                    project,
                    for: "interior",
                    title: `${project.title} (pages)`,
                    width: Math.round(trim.width * 300),
                    height: Math.round(trim.height * 300),
                    format: "pdf",
                    make: sendPages,
                    record: async () => ({ stamp: await wordsStamp((await onFlush()).filter((c) => c.role !== "part").map((c) => c.body)) }),
                    designLabel: "Send the pages to Canva",
                    backLabel: "Bring the pages back as PDF",
                    onBack: (bytes) => bringBack(bytes),
                } }), _jsx("input", { ref: picking, type: "file", accept: "application/pdf,.pdf", hidden: true, onChange: (e) => {
                    const file = e.target.files?.[0] ?? null;
                    e.target.value = "";
                    waiting.current?.(file);
                    waiting.current = null;
                } })] }));
}

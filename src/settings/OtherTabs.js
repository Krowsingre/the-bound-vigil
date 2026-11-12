import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { RememberedDetails } from "../components/RememberedDetails";
import { useEffect, useRef, useState } from "react";
import { api, isAndroid, isApp, isIOS, openExternal } from "../api";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Icon } from "../components/Icon";
import { useToast } from "../components/Toast";
import { DuplicatesDialog } from "./DuplicatesDialog";
import { canBuyIn, ManageSubscription, OwnerCode, PlanButtons, PRIVACY_POLICY, publisherWords, standardWords, TERMS, useLicense } from "../license/License";
import { PublisherPlans, PublisherTools } from "../license/Publisher";
import { canSelfUpdate, useUpdater } from "./updates";
import { SORTS } from "../library/libraryView";
import { TextSettings } from "../reader/ReaderPopovers";
import { PAGE_COLORS, resolveTheme, WIDTHS } from "../reader/settings";
import { readLocal, useAppDark, useAppSettings, writeLocal } from "./appSettings";
import { useReaderSettings } from "./AppearanceTab";
import { ActionTile, Columns, formatBytes, RadioList, Row, Section, SectionGroup, Segmented, Select, Toggle } from "./controls";
import { HardcoverSection } from "./HardcoverSection";
import { CanvaSection, canvaHere } from "./CanvaSection";
import { ReadingHistorySection } from "./ReadingHistory";
const READING_FONTS = {
    lora: '"Lora", Georgia, serif',
    georgia: "Georgia, Gelasio, serif",
    sans: "var(--font-sans)",
    echolume: '"Echolume", sans-serif',
    publisher: "Georgia, Gelasio, serif",
};
export function ReadingTab() {
    const [reader, change] = useReaderSettings();
    const dark = useAppDark();
    if (!reader)
        return null;
    const colors = PAGE_COLORS[resolveTheme(reader.theme, dark)];
    return (_jsx(Columns, { side: isApp ? _jsx(ReadAlongSection, {}) : undefined, children: _jsx(Section, { id: "text", title: "Text and page", lede: "These are the same choices as the Aa button in the reader, and apply to every book.", aside: _jsxs("div", { className: "reading-sample", style: { background: colors.background, color: colors.text }, children: [_jsx("p", { style: {
                            fontFamily: READING_FONTS[reader.font],
                            fontSize: reader.size,
                            lineHeight: reader.lineHeight,
                            textAlign: reader.justify ? "justify" : "start",
                            maxWidth: WIDTHS[reader.width] / 1.6,
                        }, children: "It was the best of times, it was the worst of times, it was the age of wisdom, it was the age of foolishness, it was the epoch of belief, it was the epoch of incredulity, it was the season of Light, it was the season of Darkness." }), _jsx("span", { className: "reading-sample-note", style: { color: colors.muted }, children: "Charles Dickens, A Tale of Two Cities" })] }), children: _jsx(TextSettings, { settings: reader, onChange: change }) }) }));
}
/** On a phone, lining up is off until it's turned on and the warning agreed to. */
const LINE_UP_DEFAULTS = { auto: !isIOS && !isAndroid, model: "standard", effort: "gentle", background: true, agreed: false };
/** Said before lining up is turned on on a phone, and under the switch. */
export const PHONE_LINE_UP_WARNING = "Confluence works the phone's processor hard for a long time. It can drain the battery, even when the phone is plugged in, and it may make the phone overheat. TBV pauses when the phone gets too warm and carries on once it has cooled down. A computer with TBV open converges pairs for your phone as well.";
const LINE_UP_KEY = "readAlong.lineUp";
/** How this device lines up books with their audiobooks, word by word. */
function ReadAlongSection() {
    const [set, setSet] = useState(null);
    const [models, setModels] = useState([]);
    const [asking, setAsking] = useState(false);
    const toast = useToast();
    useEffect(() => {
        api.getSetting(LINE_UP_KEY).then((raw) => {
            let saved = {};
            try {
                saved = raw ? JSON.parse(raw) : {};
            }
            catch {
                // A broken value falls back to the defaults.
            }
            setSet({ ...LINE_UP_DEFAULTS, ...saved });
        }, () => setSet(LINE_UP_DEFAULTS));
        api.speechModels().then(setModels, () => setModels([]));
    }, []);
    if (!set)
        return null;
    if (isAndroid)
        return (_jsx(Section, { id: "read-along", title: "Read-along", children: _jsx("p", { className: "settings-row-hint", children: "Confluence doesn't run in the Android test version yet. Pairs converged on your computer or iPhone sync here, and the others follow along by chapter." }) }));
    const change = (patch) => {
        const next = { ...set, ...patch };
        setSet(next);
        void api.setSetting(LINE_UP_KEY, JSON.stringify(next)).then(() => api.wakeLiningUp());
    };
    const size = models.reduce((sum, [, bytes]) => sum + bytes, 0);
    return (_jsxs(Section, { id: "read-along", title: "Read-along", lede: "A book paired with its audiobook converges with it word by word in Confluence, so the words light up as they're read. Activity shows how far each pair has got.", children: [_jsx(Toggle, { label: "Run Confluence by itself", hint: isIOS
                    ? `Off unless you turn it on. ${PHONE_LINE_UP_WARNING}`
                    : "When it's off, nothing converges on this device. Pairs still follow along by chapter.", checked: set.auto && (!isIOS || set.agreed), onChange: (auto) => (auto && isIOS ? setAsking(true) : change({ auto })) }), asking && (_jsx(ConfirmDialog, { title: "Run Confluence on this phone?", body: PHONE_LINE_UP_WARNING, confirm: "Turn on", onConfirm: () => {
                    setAsking(false);
                    change({ auto: true, agreed: true });
                }, onCancel: () => setAsking(false) })), _jsx(Row, { label: "Accuracy", hint: "Applies to what converges from now on.", stack: true, children: _jsx(RadioList, { label: "Accuracy", value: set.model, options: [
                        { value: "standard", label: "Standard", hint: "Hears words more reliably. A one-time download of about 190 MB." },
                        { value: "faster", label: "Faster", hint: "About twice as quick, with a few more missed words. About 60 MB." },
                    ], onChange: (model) => change({ model }) }) }), _jsx(Row, { label: "Speed", hint: "Gently uses half the processor, so everything else stays quick.", children: _jsx(Segmented, { label: "Speed", value: set.effort, options: [
                        { value: "gentle", label: "Gently" },
                        { value: "full", label: "As fast as possible" },
                    ], onChange: (effort) => change({ effort }) }) }), isIOS && (_jsx(Toggle, { label: "Carry on in the background while charging", hint: "iPhone lets this run only when the phone is plugged in and not in use.", checked: set.background, onChange: (background) => change({ background }) })), _jsx(Row, { label: "Speech model", hint: size ? `${formatBytes(size)} on this device.` : "Not downloaded yet. It's fetched the first time a pair converges.", children: size > 0 && (_jsx("button", { type: "button", className: "btn btn-quiet", onClick: () => void api.removeSpeechModels().then(() => {
                        setModels([]);
                        toast("Speech model removed. It's downloaded again when it's needed.");
                    }, () => toast("The speech model couldn't be removed.")), children: "Remove" })) })] }));
}
const LIBRARY_LAYOUTS = [
    { value: "grid", label: "Covers" },
    { value: "list", label: "List" },
    { value: "compact", label: "Compact" },
];
function useLibraryInfo() {
    const [info, setInfo] = useState(null);
    useEffect(() => {
        api.libraryInfo().then(setInfo, () => setInfo(null));
    }, []);
    return info;
}
function ShowButton({ path, label = "Show in File Explorer" }) {
    const toast = useToast();
    return (_jsxs("button", { type: "button", className: "btn btn-quiet", onClick: () => (isApp ? api.showFolder(path).catch((e) => toast(String(e))) : toast("This opens File Explorer in the desktop app.")), children: [_jsx(Icon, { name: "folder", size: 16 }), " ", label] }));
}
export function LibraryTab({ layout, sort, onChange, }) {
    const info = useLibraryInfo();
    const { settings, change } = useAppSettings();
    const side = (_jsxs(_Fragment, { children: [_jsxs(SectionGroup, { id: "where", title: "Where your books live", lede: "TBV's own copy of each book, and the books you've deleted.", holds: ["folder", "deleted"], children: [_jsx(Section, { id: "folder", title: "Archive folder", lede: "TBV keeps its own copy of every book you import here. The originals you imported from are left alone.", children: info ? (_jsx(_Fragment, { children: _jsx(Row, { label: "Folder", hint: `${info.bookCount} ${info.bookCount === 1 ? "book" : "books"}, ${formatBytes(info.booksBytes)}`, stack: true, children: _jsxs("div", { className: "path-row", children: [_jsx("code", { className: "path", children: info.booksDir }), _jsx(ShowButton, { path: info.booksDir })] }) }) })) : (_jsx("p", { className: "settings-row-hint", children: "The library folder couldn't be read." })) }), _jsx(DeletedBooksSection, {})] }), _jsxs(SectionGroup, { id: "ratings", title: "Ratings sites", lede: "Your ratings in and out of Goodreads and Hardcover.", holds: ["goodreads", "hardcover"], children: [_jsx(GoodreadsSection, {}), _jsx(HardcoverSection, {})] })] }));
    return (_jsxs(Columns, { side: side, children: [_jsxs(Section, { id: "view", title: "Archive view", lede: "How the Archive starts out. Changing it there is remembered too.", children: [_jsx(Row, { label: "Layout", children: _jsx(Segmented, { label: "Archive layout", value: layout, options: LIBRARY_LAYOUTS, onChange: (l) => onChange({ layout: l }) }) }), _jsx(Row, { label: "Sort books by", children: _jsx(Select, { label: "Sort books by", value: sort, options: SORTS.map((s) => ({ value: s.sort, label: s.label })), onChange: (s) => onChange({ sort: s }) }) }), _jsx(Row, { label: "Pages", hint: "Applies to Archive and Resonance on desktop. Phones always scroll continuously.", children: _jsx(Toggle, { label: "Scroll on without page numbers", hint: "More books load as you reach the end.", checked: settings.scrollLibrary, onChange: (scrollLibrary) => change({ scrollLibrary }) }) })] }), _jsxs(SectionGroup, { id: "tidying", title: "Tidying your Archive", lede: "Your tags, and books you have more than once.", holds: ["tags", "duplicates"], children: [_jsx(TagsSection, {}), _jsx(DuplicatesSection, {})] }), _jsx(ReadingHistorySection, {})] }));
}
function TagsSection() {
    const toast = useToast();
    const [tags, setTags] = useState(null);
    const [removing, setRemoving] = useState(null);
    const load = () => void api.allTags().then(setTags, () => setTags([]));
    useEffect(load, []);
    const remove = async (tag) => {
        setRemoving(null);
        try {
            // The Library hands books over a page at a time.
            const ids = [];
            for (let page = 0;; page++) {
                const found = await api.getLibrary({ shelf: "all", sort: "title", search: null, formats: [], location: null, tags: [tag.name], page, pageSize: 200 });
                ids.push(...found.books.map((b) => b.id));
                if (found.page < page || ids.length >= found.total || !found.books.length)
                    break;
            }
            await api.removeTag(ids, tag.name);
            toast(`Took “${tag.name}” off ${tag.count} ${tag.count === 1 ? "book" : "books"}.`);
        }
        catch (e) {
            toast(`That didn't work: ${String(e)}`);
        }
        load();
    };
    return (_jsxs(Section, { id: "tags", title: "Tags", lede: "Your own labels for books. Add them from any book's menu, right-click a book, or filter the Archive by them.", children: [tags === null ? null : tags.length === 0 ? (_jsx("p", { className: "settings-row-hint", children: "No tags yet. Right-click a book, or open its \u2026 menu, and choose Add tags." })) : (_jsx("ul", { className: "tag-manage", children: tags.map((t) => (_jsx("li", { children: _jsxs("span", { className: "tag-chip", children: [t.name, _jsx("span", { className: "muted num", children: t.count }), _jsx("button", { type: "button", "aria-label": `Remove ${t.name} from every book`, title: "Remove from every book", onClick: () => setRemoving(t), children: _jsx(Icon, { name: "close", size: 12 }) })] }) }, t.name))) })), removing && (_jsx(ConfirmDialog, { title: `Remove the tag “${removing.name}”?`, body: `It comes off all ${removing.count} ${removing.count === 1 ? "book" : "books"} that have it. The books stay in your library.`, confirm: "Remove tag", danger: true, onCancel: () => setRemoving(null), onConfirm: () => void remove(removing) }))] }));
}
/** What happens when an import brings back a book that was deleted before. */
function DeletedBooksSection() {
    const { settings, change } = useAppSettings();
    return (_jsx(Section, { id: "deleted", title: "Deleted books", lede: "TBV remembers the books you've deleted, on any of your devices, by the file itself, so renamed copies are recognised too.", children: _jsx("div", { className: "toggle-list", children: _jsx(Toggle, { label: "Skip books I've deleted", hint: settings.skipDeletedImports
                    ? "Imports leave them out. The Imports page lists them as skipped."
                    : "Imports bring them back and put them in the Previously deleted collection, so you can look them over.", checked: settings.skipDeletedImports, onChange: (skipDeletedImports) => change({ skipDeletedImports }) }) }) }));
}
function DuplicatesSection() {
    const toast = useToast();
    const [groups, setGroups] = useState(null);
    const [busy, setBusy] = useState(false);
    const find = async () => {
        setBusy(true);
        try {
            const found = await api.findDuplicates();
            if (found.length)
                setGroups(found);
            else
                toast("No duplicates found. Every book in your library looks different.");
        }
        catch (e) {
            toast(`That didn't work: ${String(e)}`);
        }
        finally {
            setBusy(false);
        }
    };
    return (_jsxs(Section, { id: "duplicates", title: "Duplicates", lede: "Finds books that look like the same book twice: the same ISBN, or the same title and author. Nothing is deleted unless you choose to.", children: [_jsx("div", { className: "action-tiles", children: _jsx(ActionTile, { icon: _jsx(Icon, { name: "copy", size: 22 }), title: "Find duplicate books", hint: "Compare them side by side and pick which to keep.", disabled: busy, onClick: () => void find() }) }), groups && _jsx(DuplicatesDialog, { groups: groups, onClose: () => setGroups(null) })] }));
}
function GoodreadsSection() {
    const toast = useToast();
    const [busy, setBusy] = useState(false);
    const [report, setReport] = useState(null);
    const exportFile = async () => {
        setBusy(true);
        try {
            const count = await api.exportGoodreads();
            if (count !== null)
                toast(`Saved ${count} ${count === 1 ? "book" : "books"}. On Goodreads, open My Books, then Import and export, and import this file.`);
        }
        catch (e) {
            toast(`That didn't work: ${String(e)}`);
        }
        finally {
            setBusy(false);
        }
    };
    const start = async () => {
        setBusy(true);
        try {
            const done = await api.importGoodreads();
            if (done)
                setReport(done);
        }
        catch (e) {
            toast(`That didn't work: ${String(e)}`);
        }
        finally {
            setBusy(false);
        }
    };
    return (_jsxs(Section, { id: "goodreads", title: "Goodreads", lede: "Goodreads doesn't let other apps change your account, so ratings travel by file. Bring a Goodreads export into TBV, or make a file of your TBV ratings and shelves for Goodreads to import.", children: [_jsxs("div", { className: "action-tiles", children: [_jsx(ActionTile, { icon: _jsx(Icon, { name: "upload", size: 22 }), title: "Import a Goodreads export", hint: "Only fills in what TBV is missing.", disabled: busy, onClick: () => void start() }), _jsx(ActionTile, { icon: _jsx(Icon, { name: "download", size: 22 }), title: "Export for Goodreads", hint: "Your ratings, reading status and shelves.", disabled: busy, onClick: () => void exportFile() })] }), _jsx("p", { className: "settings-row-hint", children: "On the Goodreads website, open My Books, then Import and export, and choose Export Library. Save the file it gives you, then choose it here." }), report && _jsx(GoodreadsReport, { report: report, onClose: () => setReport(null) })] }));
}
function GoodreadsReport({ report, onClose }) {
    const close = useRef(null);
    useEffect(() => close.current?.focus(), []);
    const books = (n) => `${n} ${n === 1 ? "book" : "books"}`;
    const lines = [
        report.ratings > 0 && `Ratings added to ${books(report.ratings)}.`,
        report.statuses > 0 && `Reading status brought in for ${books(report.statuses)}.`,
        !!report.upNextSkipped && `${books(report.upNextSkipped)} left out because Up Next is full.`,
        report.upNext > 0 && `${books(report.upNext)} put in Up next.`,
        report.favourites > 0 && `${books(report.favourites)} marked as favourites.`,
        report.collectionsCreated.length > 0 &&
            `New ${report.collectionsCreated.length === 1 ? "collection" : "collections"} from your shelves: ${report.collectionsCreated.join(", ")}.`,
        report.collectionBooks > 0 && `${books(report.collectionBooks)} added to collections.`,
    ].filter(Boolean);
    return (_jsx("div", { className: "dialog-backdrop", onPointerDown: (e) => e.target === e.currentTarget && onClose(), children: _jsxs("div", { className: "dialog goodreads-report", role: "dialog", "aria-label": "Goodreads import", onKeyDown: (e) => e.key === "Escape" && onClose(), children: [_jsx("h2", { children: "Goodreads import" }), _jsxs("p", { className: "muted", children: [report.matched, " of the ", report.rows, " books in your export are in your library."] }), lines.length > 0 ? (_jsx("ul", { children: lines.map((l) => (_jsx("li", { children: l }, l))) })) : (_jsx("p", { children: "TBV already had everything the export holds, so nothing changed." })), report.notFound.length > 0 && (_jsxs(RememberedDetails, { disclosure: "preferences.goodreadsReport", children: [_jsxs("summary", { children: [books(report.notFound.length), " from Goodreads aren't in your library"] }), _jsx("ul", { className: "goodreads-missing", children: report.notFound.map((b) => (_jsx("li", { children: b }, b))) })] })), _jsx("div", { className: "dialog-actions", children: _jsx("button", { ref: close, type: "button", className: "btn btn-primary", onClick: onClose, children: "Done" }) })] }) }));
}
const COLLECTIONS_PREFS = "tbv.collections.view";
export function CollectionsTab() {
    const { settings, change } = useAppSettings();
    const [layout, setLayout] = useState(() => (readLocal(COLLECTIONS_PREFS).layout === "list" ? "list" : "grid"));
    return (_jsxs(Section, { id: "show", title: "What the Compendium shows", lede: "Sorting and your own order are set in the Compendium itself.", children: [_jsxs("div", { className: "toggle-list", children: [_jsx(Toggle, { label: "Show smart collections", hint: "Recently added, Unread, In progress and the others that fill themselves.", checked: settings.showSmartCollections, onChange: (showSmartCollections) => change({ showSmartCollections }) }), _jsx(Toggle, { label: "Show series", hint: "Series found in your books' details, next to your own collections.", checked: settings.showSeries, onChange: (showSeries) => change({ showSeries }) })] }), _jsx(Row, { label: "Your collections appear as", children: _jsx(Segmented, { label: "Compendium layout", value: layout, options: [
                        { value: "grid", label: "Cards" },
                        { value: "list", label: "List" },
                    ], onChange: (l) => {
                        setLayout(l);
                        writeLocal(COLLECTIONS_PREFS, { layout: l });
                    } }) })] }));
}
const NOTES_PREFS = "tbv.notes.view";
export function NotesTab() {
    const toast = useToast();
    const saved = readLocal(NOTES_PREFS);
    const [layout, setLayout] = useState(saved.layout === "cards" || saved.layout === "compact" ? saved.layout : "list");
    const [sort, setSort] = useState(saved.sort === "updated" || saved.sort === "book" ? saved.sort : "recent");
    return (_jsxs(_Fragment, { children: [_jsxs(Section, { id: "view", title: "Notes", lede: "How Scribe shows your notes, and all of them in one file.", children: [_jsx(Row, { label: "Layout", children: _jsx(Segmented, { label: "Notes layout", value: layout, options: [
                                { value: "list", label: "List" },
                                { value: "cards", label: "Cards" },
                                { value: "compact", label: "Compact" },
                            ], onChange: (l) => {
                                setLayout(l);
                                writeLocal(NOTES_PREFS, { layout: l });
                            } }) }), _jsx(Row, { label: "Sort notes by", children: _jsx(Select, { label: "Sort notes by", value: sort, options: [
                                { value: "recent", label: "Recently added" },
                                { value: "updated", label: "Recently changed" },
                                { value: "book", label: "Book, in reading order" },
                            ], onChange: (s) => {
                                setSort(s);
                                writeLocal(NOTES_PREFS, { sort: s });
                            } }) }), _jsx(Row, { label: "Export notes", hint: "Every highlight and note in one Markdown file, grouped by book. It opens in any text editor, Obsidian or Notion.", children: _jsxs("button", { type: "button", className: "btn btn-quiet", onClick: () => {
                                if (!isApp)
                                    return toast("Exporting works in the desktop app.");
                                api.exportNotesMarkdown().then((done) => done && toast("Exported your notes."), (e) => toast(`That didn't work: ${String(e)}`));
                            }, children: [_jsx(Icon, { name: "download", size: 16 }), " Export as Markdown"] }) })] }), canvaHere && _jsx(CanvaSection, {})] }));
}
const FORMATS = [
    { ext: "EPUB", name: "The standard eBook format" },
    { ext: "PDF", name: "Fixed pages, like print" },
    { ext: "MOBI", name: "Older Kindle books" },
    { ext: "AZW3", name: "Kindle books without DRM (also AZW)" },
    { ext: "CBZ, CBR", name: "Comics and graphic novels" },
    { ext: "FB2", name: "FictionBook (also zipped, as FBZ)" },
    { ext: "TXT", name: "Plain text, split into chapters where it has them" },
    { ext: "DOCX", name: "Word documents, with their formatting" },
    { ext: "DOC", name: "Older Word documents, as text only" },
];
export function FilesTab() {
    const formats = (_jsxs(Section, { id: "formats", title: "Book formats", lede: "TBV imports and reads all of these.", children: [_jsx("ul", { className: "format-list", children: FORMATS.map((f) => (_jsxs("li", { children: [_jsx("span", { className: "format-ext", children: f.ext }), _jsx("span", { className: "settings-row-hint", children: f.name }), _jsx("span", { className: "format-state is-ready", children: "Opens in the reader" })] }, f.ext))) }), _jsx("p", { className: "settings-row-hint", children: "Books with DRM (copy protection) can't be opened by any reader but the shop's own." })] }));
    return (_jsx(Columns, { side: formats, children: _jsx(Section, { id: "files", title: "Your book files", lede: "What TBV does, and never does, with your books.", children: _jsxs("ul", { className: "promise-list", children: [_jsxs("li", { children: [_jsx(Icon, { name: "check", size: 18 }), " Importing copies a book into TBV's library folder. The file you imported from stays where it was."] }), _jsxs("li", { children: [_jsx(Icon, { name: "check", size: 18 }), " TBV never changes a book file. Titles, authors, covers and other details you correct are kept beside the book, and a reset brings back the book's own."] }), _jsxs("li", { children: [_jsx(Icon, { name: "check", size: 18 }), " The same book imported twice is recognised from its contents, so it appears once."] }), _jsxs("li", { children: [_jsx(Icon, { name: "check", size: 18 }), " Removing a book from this device keeps your progress and notes. Deleting it removes it everywhere."] })] }) }) }));
}
export function AccessibilityTab() {
    const { settings, change } = useAppSettings();
    return (_jsx(_Fragment, { children: _jsx(Section, { id: "vision", title: "Seeing and motion", lede: "Interface size is under Appearance, and reading text sizes under Reading.", children: _jsxs("div", { className: "toggle-list", children: [_jsx(Toggle, { label: "Use high contrast", hint: "Darker text, clearer edges and a stronger focus colour.", checked: settings.highContrast, onChange: (highContrast) => change({ highContrast }) }), _jsx(Toggle, { label: "Always show where focus is", hint: "Draws a ring around the control you are on, even after a mouse click.", checked: settings.strongFocus, onChange: (strongFocus) => change({ strongFocus }) }), _jsx(Toggle, { label: "Underline links", hint: "Makes text you can click easier to spot.", checked: settings.underlineLinks, onChange: (underlineLinks) => change({ underlineLinks }) }), _jsx(Toggle, { label: "Reduce motion", hint: "Turns off animations, fades and sliding panels.", checked: settings.reduceMotion, onChange: (reduceMotion) => change({ reduceMotion }) })] }) }) }));
}
const EVERYWHERE = [
    ["Alt + Shift + ← / →", "Back / Forward through app screens"],
    ["Alt + ← / → in Discover", "Back / Forward through webpages"],
    ["Ctrl + 1 to 7", "Go to Sanctum, Archive, Resonance, Compendium, Scribe, Discover or Preferences"],
    ["Ctrl + F  or  Ctrl + K", "Search"],
    ["Ctrl + O", "Import books"],
    ["Ctrl + \\", "Show or hide the sidebar"],
    ["Alt + arrow keys", "Move a collection when sorted by Your order"],
];
const READER = [
    ["Alt + Shift + ←", "Return from a book jump, or leave the book"],
    ["→  or  Page Down  or  Space", "Next page"],
    ["←  or  Page Up  or  Shift + Space", "Previous page"],
    ["Ctrl + F", "Search in the book"],
    ["Ctrl + B", "Add or remove a bookmark"],
    ["F", "Focus mode"],
    ["R", "Read aloud, or pause reading"],
    ["F11", "Full screen"],
    ["Esc", "Close a panel, leave focus mode or full screen"],
];
function KeyTable({ rows }) {
    return (_jsx("table", { className: "key-table", children: _jsx("tbody", { children: rows.map(([keys, what]) => (_jsxs("tr", { children: [_jsx("td", { children: keys.split(/\s{2}or\s{2}/).map((k, i) => (_jsxs("span", { children: [i > 0 && _jsx("span", { className: "key-or", children: " or " }), _jsx("kbd", { children: k })] }, k))) }), _jsx("td", { children: what })] }, keys))) }) }));
}
export function ShortcutsTab() {
    return (_jsx(Columns, { side: _jsx(Section, { id: "reader", title: "While reading", lede: "Page keys turn pages when Turn pages is chosen; with Scroll they scroll.", children: _jsx(KeyTable, { rows: READER }) }), children: _jsx(Section, { id: "everywhere", title: "Everywhere", children: _jsx(KeyTable, { rows: EVERYWHERE }) }) }));
}
export function AdvancedTab() {
    const info = useLibraryInfo();
    const { reset } = useAppSettings();
    const toast = useToast();
    const [confirming, setConfirming] = useState(false);
    return (_jsxs(Columns, { side: _jsx(Section, { id: "reset", title: "Reset settings", lede: "Puts Appearance, Compendium, Accessibility and Sync choices back as they came. Your books, notes and collections are not touched.", children: _jsx("button", { type: "button", className: "btn btn-quiet", onClick: () => setConfirming(true), children: "Reset settings\u2026" }) }), children: [_jsx(Section, { id: "data", title: "Data on this device", lede: "Your library's details, progress, notes and collections live in one database file.", children: info ? (_jsxs(_Fragment, { children: [_jsx(Row, { label: "Database", hint: formatBytes(info.databaseBytes), stack: true, children: _jsxs("div", { className: "path-row", children: [_jsx("code", { className: "path", children: info.database }), _jsx(ShowButton, { path: info.database })] }) }), _jsx(Row, { label: "Data version", hint: "Goes up when an update changes how TBV stores things. Backups from newer versions need the newer TBV.", children: _jsx("span", { className: "settings-value", children: info.schemaVersion }) })] })) : (_jsx("p", { className: "settings-row-hint", children: "The data folder couldn't be read." })) }), confirming && (_jsx(ConfirmDialog, { title: "Reset settings?", body: "Theme, scale, accessibility and sync choices go back to how they came. Your library, notes and collections stay as they are.", confirm: "Reset settings", onCancel: () => setConfirming(false), onConfirm: () => {
                    reset();
                    setConfirming(false);
                    toast("Settings are back as they came.");
                } }))] }));
}
const CREDITS = [
    {
        name: "Echolume",
        what: "A reading and interface font, by Krowsingre Publishing",
        licence: "All rights reserved, Krowsingre Publishing LLC",
    },
    {
        name: "foliate-js",
        what: "The page engine inside the reader",
        licence: "MIT",
        url: "https://github.com/johnfactotum/foliate-js",
    },
    {
        name: "WordNet 3.1",
        what: "The reader's offline dictionary on Windows and Android. WordNet 3.0 Copyright 2006 by Princeton University. All rights reserved. Provided as is, without warranties.",
        licence: "WordNet licence",
        url: "https://wordnet.princeton.edu/license-and-commercial-use",
    },
    {
        name: "zip.js",
        what: "Opening EPUB files",
        licence: "BSD 3-Clause",
        url: "https://github.com/gildas-lormeau/zip.js",
    },
    {
        name: "fflate",
        what: "Unpacking compressed book files",
        licence: "MIT",
        url: "https://github.com/101arrowz/fflate",
    },
    {
        name: "PDF.js",
        what: "Showing PDF books, by Mozilla",
        licence: "Apache 2.0",
        url: "https://github.com/mozilla/pdf.js",
    },
    {
        name: "Readability",
        what: "Discover's reader mode, by Mozilla",
        licence: "Apache 2.0",
        url: "https://github.com/mozilla/readability",
    },
    {
        name: "adblock-rust",
        what: "Discover's blocking engine, by Brave",
        licence: "MPL 2.0",
        url: "https://github.com/brave/adblock-rust",
    },
    {
        name: "EasyList and EasyPrivacy",
        what: "Discover's advert and tracker lists, by the EasyList authors (downloaded to your device)",
        licence: "GPLv3 or CC BY-SA 3.0",
        url: "https://easylist.to/",
    },
    {
        name: "Malicious URL Blocklist",
        what: "Discover's list of harmful sites, by curbengh, from abuse.ch's URLhaus (downloaded to your device)",
        licence: "CC0 or MIT",
        url: "https://gitlab.com/malware-filter/urlhaus-filter",
    },
    {
        name: "Mammoth",
        what: "Reading Word documents",
        licence: "BSD 2-Clause",
        url: "https://github.com/mwilliamson/mammoth.js",
    },
    {
        name: "Lora",
        what: "The default reading font, by Cyreal",
        licence: "SIL Open Font License 1.1",
        url: "https://github.com/cyrealtype/Lora-Cyrillic",
    },
    {
        name: "Gelasio",
        what: "Titles where Georgia isn't installed",
        licence: "SIL Open Font License 1.1",
        url: "https://github.com/SorkinType/Gelasio",
    },
    {
        name: "Tauri",
        what: "The desktop app around TBV",
        licence: "MIT or Apache 2.0",
        url: "https://tauri.app",
    },
    {
        name: "React",
        what: "The interface",
        licence: "MIT",
        url: "https://react.dev",
    },
    {
        name: "SQLite",
        what: "The library's database",
        licence: "Public domain",
        url: "https://sqlite.org",
    },
    {
        name: "citeproc-js",
        what: "Writes citations in Scribe",
        licence: "CPAL 1.0",
        url: "https://github.com/Juris-M/citeproc-js",
    },
    {
        name: "Citation Style Language styles",
        what: "APA, MLA, Chicago and the other citation styles",
        licence: "CC BY-SA 3.0",
        url: "https://citationstyles.org",
    },
];
/** The trial, or the purchase. */
function YourCopy() {
    const { license, busy, buy, restore } = useLicense();
    if (!license)
        return null;
    const ends = new Date(license.trialEnds * 1000).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
    // TBV for life with Publisher on a subscription on top.
    const publisherOnTop = license.state === "owned" && license.plan === "lifetime" && !!license.publisher && !license.publisherForLife && canBuyIn(license);
    const words = license.state === "owned"
        ? standardWords(license)
        : license.trialDays > 0
            ? `${license.daysLeft === 1 ? "1 day" : `${license.daysLeft} days`} left of your free trial (until ${ends}). Choose a plan to keep using it after that.`
            : "Choose a plan to use The Bound Vigil.";
    return (_jsxs(Section, { id: "licence", title: "TBV Standard", lede: words, children: [license.state !== "owned" && canBuyIn(license) && (_jsxs("div", { className: "settings-actions", children: [_jsx(PlanButtons, {}), _jsx("button", { type: "button", className: "btn btn-quiet", disabled: busy, onClick: () => void restore(), children: "I bought it already" })] })), license.state !== "owned" && !canBuyIn(license) && (_jsx("p", { className: "settings-row-hint", children: "This copy didn't come from a store, so it can't be bought in. The Bound Vigil will be sold in the Microsoft Store and the App Store." })), license.state === "owned" && canBuyIn(license) && (_jsxs("div", { className: "settings-actions", children: [(license.plan === "monthly" || license.plan === "yearly") && (_jsxs("button", { type: "button", className: "btn btn-quiet", disabled: busy, onClick: () => void buy(license.publisher ? "publisherLifetime" : "lifetime"), children: ["Switch to lifetime", (license.publisher ? license.publisherPrice : license.price) ? ` for ${license.publisher ? license.publisherPrice : license.price}` : ""] })), !publisherOnTop && _jsx(ManageSubscription, {}), _jsx("button", { type: "button", className: "btn btn-quiet", disabled: busy, onClick: () => void restore(), children: "Restore purchases" })] })), license.state !== "owned" && _jsx(OwnerCode, {})] }));
}
function updateWords(state) {
    switch (state.step) {
        case "idle":
            return "TBV can look for a newer version and install it for you.";
        case "checking":
            return "Looking for a newer version…";
        case "checked":
            return state.info.version ? `Version ${state.info.version} is ready to install.` : "You have the newest version.";
        case "installing": {
            const p = state.progress;
            if (!p)
                return `Getting version ${state.info.version}…`;
            if (p.total && p.downloaded >= p.total)
                return "Installing. TBV will open again by itself.";
            return p.total ? `Getting version ${state.info.version}… ${Math.round((p.downloaded / p.total) * 100)}%` : `Getting version ${state.info.version}… ${formatBytes(p.downloaded)}`;
        }
        case "failed":
            return state.message;
    }
}
function Updates() {
    const { settings, change } = useAppSettings();
    const { state, check, install } = useUpdater();
    const ready = state.step === "checked" && state.info.version ? state.info : null;
    return (_jsxs(Section, { id: "updates", title: "Updates", lede: updateWords(state), children: [ready?.notes && _jsx("p", { className: "settings-row-hint update-notes", children: ready.notes }), _jsx("div", { className: "settings-actions", children: ready ? (_jsx("button", { type: "button", className: "btn btn-primary", onClick: () => install(ready), children: "Install and restart" })) : (_jsx("button", { type: "button", className: "btn btn-quiet", disabled: state.step === "checking" || state.step === "installing", onClick: check, children: "Check for updates" })) }), _jsxs("div", { className: "toggle-list", children: [_jsx(Toggle, { label: "Look for updates when TBV opens", hint: "TBV says when a newer version is ready.", checked: settings.checkUpdates, onChange: (checkUpdates) => change({ checkUpdates }) }), _jsx(Toggle, { label: "Install updates by themselves", hint: "When TBV opens and finds a newer version, it installs it straight away and starts again.", checked: settings.checkUpdates && settings.autoInstallUpdates, disabled: !settings.checkUpdates, onChange: (autoInstallUpdates) => change({ autoInstallUpdates }) })] })] }));
}
function AboutVersion({ version }) {
    return (_jsxs(_Fragment, { children: [_jsx("p", { className: "about-lede", children: "A quiet reader for the books you keep. Your library stays yours: on your computer, and in the cloud services you choose." }), _jsx(Row, { label: "Version", children: _jsx("span", { className: "settings-value", children: version }) }), _jsx("p", { className: "about-made muted", children: "The Bound Vigil was designed by Krowsingre Publishing and built with the help of AI (Anthropic's Claude)." }), _jsxs("p", { className: "about-links muted", children: [_jsx("button", { type: "button", className: "link-btn", onClick: () => void openExternal(TERMS), children: "Terms of use" }), " · ", _jsx("button", { type: "button", className: "link-btn", onClick: () => void openExternal(PRIVACY_POLICY), children: "Privacy policy" })] })] }));
}
/** Preferences › Your plan: TBV itself beside Publisher. */
export function PlanTab() {
    return (_jsx(Columns, { side: _jsx(PublisherPlan, {}), children: _jsx(YourCopy, {}) }));
}
function PublisherPlan() {
    const { license, busy, buy } = useLicense();
    if (!license)
        return null;
    // TBV for life with Publisher on a subscription on top: keeping Publisher for good is
    // the upgrade for those who bought TBV for life themselves, otherwise full price.
    const onTop = license.state === "owned" && license.plan === "lifetime" && !!license.publisher && !license.publisherForLife && canBuyIn(license);
    const keep = license.lifetimeShared ? "publisherLifetime" : "publisherUpgrade";
    const keepPrice = keep === "publisherUpgrade" ? license.upgradePrice : license.publisherPrice;
    const lede = license.publisher
        ? publisherWords(license)
        : license.state === "trial"
            ? "Everything you need to publish, on top of all of TBV, included while you try it."
            : "Everything you need to publish, on top of all of TBV. Your writing and exports to EPUB, Word and text stay free to use either way.";
    return (_jsxs(Section, { id: "publisher", title: "TBV Publisher", lede: lede, children: [_jsx(PublisherTools, {}), !license.publisher && canBuyIn(license) && _jsx(PublisherPlans, { license: license }), onTop && (_jsxs("div", { className: "settings-actions", children: [_jsxs("button", { type: "button", className: "btn btn-quiet", disabled: busy, onClick: () => void buy(keep), children: ["Keep Publisher for life", keepPrice ? ` for ${keepPrice}` : ""] }), _jsx(ManageSubscription, {})] }))] }));
}
export function AboutTab() {
    const [version, setVersion] = useState("0.91.0");
    useEffect(() => {
        if (!isApp)
            return;
        void import("@tauri-apps/api/app").then(({ getVersion }) => getVersion().then(setVersion, () => undefined));
    }, []);
    return (_jsxs(_Fragment, { children: [_jsx(Columns, { children: canSelfUpdate ? (_jsxs(SectionGroup, { id: "about", title: "The Bound Vigil", holds: ["updates"], children: [_jsx(AboutVersion, { version: version }), _jsx(Updates, {})] })) : (_jsx(Section, { id: "about", title: "The Bound Vigil", children: _jsx(AboutVersion, { version: version }) })) }), _jsx(Section, { id: "licences", title: "Built with", lede: "TBV stands on the work of these projects. Thank you to their authors.", children: _jsx("ul", { className: "credit-list", children: CREDITS.map((c) => (_jsxs("li", { children: [c.url ? (_jsx("button", { type: "button", className: "credit-name link-btn", onClick: () => void openExternal(c.url), children: c.name })) : (_jsx("span", { className: "credit-name", children: c.name })), _jsx("span", { className: "settings-row-hint", children: c.what }), _jsx("span", { className: "credit-licence", children: c.licence })] }, c.name))) }) })] }));
}

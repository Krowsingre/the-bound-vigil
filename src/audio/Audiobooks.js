import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
// The Audiobooks page: Continue listening, every audiobook (searched, filtered
// by genre, author, narrator and status), and a panel for the one chosen, with
// its chapters, details, files and collections.
import { useCallback, useEffect, useState } from "react";
import { api, isServerBook } from "../api";
import { askAddToCollection } from "../collections/AddToCollection";
import { BookCover } from "../components/BookCover";
import { Icon } from "../components/Icon";
import { ProgressBar } from "../components/ProgressBar";
import { showBookDetails } from "../details/openDetails";
import { bookContextMenu, makeBookActions } from "../home/bookActions";
import { useToast } from "../components/Toast";
import { Library } from "../library/Library";
import { formatLength } from "../lib/queryBooks";
import { formatBytes } from "../settings/controls";
import { LinkEbook } from "./LinkEbook";
import { useNarrow } from "../lib/useNarrow";
import { chapterAt, chapterLength, clock, onCue, usePlayer } from "./player";
const PANEL_TABS = [
    { tab: "chapters", label: "Chapters" },
    { tab: "details", label: "Details" },
    { tab: "files", label: "Files" },
    { tab: "collections", label: "Collections" },
];
/** "8h 24m left", from where you are. */
function timeLeft(book) {
    if (!book.durationMs)
        return null;
    const left = book.durationMs - (book.resumeLocator?.audioMs ?? 0);
    return left > 0 ? `${formatLength(left)} left` : null;
}
const AUDIO_VIEWS = [
    { type: "audiobook", label: "Audiobooks" },
    { type: "podcast", label: "Podcasts" },
    { type: "music", label: "Music" },
];
const PAIRING_KEY = "tbv.audiobooks.pairing";
function readPairing() {
    try {
        const saved = localStorage.getItem(PAIRING_KEY);
        return saved === "paired" || saved === "alone" ? saved : "all";
    }
    catch {
        return "all";
    }
}
export function Audiobooks({ view, search, refreshKey, onChange, onClearSearch, onImportBooks, onImportFolder, onOpenCollection, onReadAlong, onOpenSeries, seriesBack, onShowAllSeries, restoreScroll, onScrollRestored, }) {
    const player = usePlayer();
    const [chosen, setChosen] = useState(null);
    // Resonance's switch: every audiobook, the ones paired with their ebook, or the ones on their own.
    const [pairing, setPairing] = useState(readPairing);
    const choosePairing = (next) => {
        setPairing(next);
        onChange({ page: 0 });
        try {
            localStorage.setItem(PAIRING_KEY, next);
        }
        catch {
            // Remembered until TBV closes.
        }
    };
    const [listening, setListening] = useState(null);
    const [reload, setReload] = useState(0);
    const toast = useToast();
    const actions = makeBookActions(api, toast, () => setReload((n) => n + 1), (id) => void player.load(id));
    useEffect(() => {
        let current = true;
        api
            .getLibrary({
            kind: "audiobooks",
            shelf: "in_progress",
            sort: "recently_opened",
            paired: pairing === "all" ? null : pairing === "paired",
            search: null,
            formats: [],
            location: view.location,
            audioType: view.audioType,
            page: 0,
            pageSize: 10,
        })
            .then((page) => current && setListening(page.books), () => current && setListening([]));
        return () => {
            current = false;
        };
    }, [refreshKey, reload, player.playing, pairing, view.location, view.audioType]);
    // The panel shows the book chosen, else the one playing (if it's in the
    // library, not played from a server), else the last listened to.
    const playingHere = player.book && !isServerBook(player.book.book.id) ? player.book.book.id : null;
    const shown = chosen ?? playingHere ?? listening?.[0]?.id ?? null;
    const showContinue = !seriesBack && view.tab === "all" && !search.trim() && listening !== null && listening.length > 0;
    // Tapping a cover shows the audiobook in the panel (and the player bar);
    // playing stays on the Listen and Play buttons. On a phone the panel opens
    // as a sheet over the list; where it sits below the list, it scrolls into view.
    const narrow = useNarrow();
    const [sheet, setSheet] = useState(false);
    const choose = useCallback((id) => {
        setChosen(id);
        if (narrow)
            setSheet(true);
        else if (window.matchMedia?.("(max-width: 1180px)").matches) {
            requestAnimationFrame(() => document.querySelector(".audio-panel")?.scrollIntoView({ block: "start", behavior: "smooth" }));
        }
    }, [narrow]);
    useEffect(() => onCue(choose), [choose]);
    return (_jsxs("div", { className: "audiobooks", children: [_jsx("div", { className: "audiobooks-main", children: _jsx(Library, { kind: "audiobooks", onOpenSeries: onOpenSeries, seriesBack: seriesBack, onShowAllSeries: onShowAllSeries, restoreScroll: restoreScroll, onScrollRestored: onScrollRestored, paired: (seriesBack && !onShowAllSeries) || pairing === "all" ? null : pairing === "paired", onPairing: (value) => choosePairing(value === null ? "all" : value ? "paired" : "alone"), switcher: !seriesBack && (_jsx("div", { className: "segmented page-switch", role: "group", "aria-label": "Audio type", children: AUDIO_VIEWS.map(({ type, label }) => (_jsx("button", { type: "button", "aria-pressed": view.audioType === type, title: view.audioType === type ? "Show all audio" : undefined, onClick: () => onChange({ audioType: view.audioType === type ? null : type, page: 0 }), children: label }, type))) })), view: view, search: search, refreshKey: refreshKey + reload, onChange: onChange, onClearSearch: onClearSearch, onImportBooks: onImportBooks, onImportFolder: onImportFolder, onOpenBook: choose, onOpenCollection: onOpenCollection, intro: showContinue && (_jsxs("section", { className: "listen-row", "aria-label": "Continue listening", children: [_jsx("h2", { className: "section-title", children: "Continue listening" }), _jsx("ul", { className: "listen-cards", children: listening.map((b) => (_jsxs("li", { className: `listen-card${b.id === shown ? " is-chosen" : ""}`, ...bookContextMenu(b, actions), children: [_jsxs("button", { type: "button", className: "listen-open", onClick: () => actions.open(b), children: [_jsx(BookCover, { book: b, size: "m" }), _jsx("span", { className: "listen-title", children: b.title }), _jsx("span", { className: "muted listen-author", children: b.authors.join(", ") || "Unknown author" })] }), _jsx(ProgressBar, { value: b.totalProgression, label: `${Math.round((b.totalProgression ?? 0) * 100)}% listened` }), _jsx("span", { className: "muted listen-meta", children: [b.resumeLocator?.chapter, timeLeft(b)].filter(Boolean).join(" · ") })] }, b.id))) })] })) }) }), shown && (!narrow || sheet) && (_jsxs(_Fragment, { children: [narrow && _jsx("div", { className: "audio-sheet-backdrop", "aria-hidden": true, onClick: () => setSheet(false) }), _jsx(AudiobookPanel, { bookId: shown, refreshKey: refreshKey + reload, onOpenCollection: onOpenCollection, onReadAlong: onReadAlong, onChanged: () => setReload((n) => n + 1), onClose: narrow ? () => setSheet(false) : undefined }, shown)] }))] }));
}
function AudiobookPanel({ bookId, refreshKey, onOpenCollection, onReadAlong, onChanged, onClose, }) {
    const player = usePlayer();
    const [book, setBook] = useState(null);
    const [details, setDetails] = useState(null);
    const [tab, setTab] = useState("chapters");
    const [linking, setLinking] = useState(false);
    const toast = useToast();
    useEffect(() => {
        let current = true;
        api.audiobook(bookId).then((b) => current && setBook(b), () => current && setBook(null));
        api.bookDetails(bookId).then((d) => current && setDetails(d), () => undefined);
        return () => {
            current = false;
        };
    }, [bookId, refreshKey]);
    if (!book)
        return _jsx("aside", { className: `audio-panel${onClose ? " is-sheet" : ""}`, "aria-busy": "true" });
    const playing = player.book?.book.id === bookId;
    const at = playing ? player.positionMs : book.positionMs;
    const current = chapterAt(book.chapters, at);
    const next = book.chapters[current + 1];
    const b = book.book;
    const started = at > 0 && at < book.durationMs - 1000;
    return (_jsxs("aside", { className: `audio-panel${onClose ? " is-sheet" : ""}`, "aria-label": `About ${b.title}`, children: [onClose && (_jsx("button", { type: "button", className: "icon-btn audio-sheet-close", "aria-label": "Close", onClick: onClose, children: _jsx(Icon, { name: "close", size: 18 }) })), _jsxs("div", { className: "audio-panel-head", children: [_jsx(BookCover, { book: b, size: "l" }), _jsxs("div", { className: "audio-panel-title", children: [_jsx("h2", { children: b.title }), _jsx("p", { children: b.authors.join(", ") || "Unknown author" }), book.narrators.length > 0 && _jsxs("p", { className: "muted", children: ["Narrated by ", book.narrators.join(", ")] }), b.genres.length > 0 && (_jsx("div", { className: "details-chips", children: b.genres.slice(0, 3).map((g) => (_jsx("span", { className: "tag-chip", children: g }, g))) })), _jsxs("div", { className: "audio-panel-actions", children: [_jsxs("button", { type: "button", className: "btn btn-primary", onClick: () => (playing ? player.toggle() : void player.load(bookId)), children: [_jsx(Icon, { name: playing && player.playing ? "pause" : "play", size: 16 }), " ", playing && player.playing ? "Pause" : started ? "Resume" : b.status === "read" ? "Listen again" : "Listen"] }), book.ebook && (_jsxs("button", { type: "button", className: "btn btn-quiet", title: `Read ${book.ebook.name} as you listen`, onClick: () => onReadAlong(book.ebook.id), children: [_jsx(Icon, { name: "library", size: 16 }), " Read along"] })), _jsx("button", { type: "button", className: "icon-btn", "aria-label": "Book details", title: "Book details", onClick: () => showBookDetails(bookId), children: _jsx(Icon, { name: "info", size: 18 }) })] })] })] }), _jsx("div", { className: "tabs audio-panel-tabs", role: "tablist", "aria-label": "About this audiobook", children: PANEL_TABS.map((t) => (_jsx("button", { type: "button", role: "tab", "aria-selected": tab === t.tab, className: `tab${tab === t.tab ? " is-active" : ""}`, onClick: () => setTab(t.tab), children: t.label }, t.tab))) }), _jsxs("div", { className: "audio-panel-body", children: [tab === "chapters" &&
                        (book.chapters.length ? (_jsxs(_Fragment, { children: [_jsxs("div", { className: "audio-where", children: [_jsxs("span", { children: [book.chapters[current]?.title, " ", _jsxs("span", { className: "muted", children: ["\u00B7 ", clock(at), " / ", clock(book.durationMs)] })] }), _jsxs("span", { className: "num", children: [Math.round((at / Math.max(1, book.durationMs)) * 100), "%"] })] }), _jsx(ProgressBar, { value: at / Math.max(1, book.durationMs), label: "Listened" }), _jsx("ol", { className: "chapter-list", children: book.chapters.map((c, i) => (_jsx("li", { children: _jsxs("button", { type: "button", className: `chapter-row${i === current ? " is-current" : ""}`, "aria-current": i === current || undefined, onClick: () => {
                                                if (playing)
                                                    player.seek(c.startMs);
                                                else
                                                    void player.load(bookId).then(() => player.seek(c.startMs));
                                            }, children: [_jsx("span", { className: "num muted", children: i + 1 }), _jsx("span", { className: "chapter-name", children: c.title }), _jsx("span", { className: "num muted", children: clock(chapterLength(book, i)) })] }) }, i))) })] })) : (_jsx("p", { className: "muted", children: "This audiobook has no chapters marked. Skip 30 seconds at a time, or use the bar below." }))), tab === "details" && (_jsxs("dl", { className: "details-facts audio-facts", children: [_jsxs("div", { children: [_jsx("dt", { children: "Length" }), _jsx("dd", { children: formatLength(book.durationMs) || "Unknown" })] }), _jsxs("div", { children: [_jsx("dt", { children: "Narrators" }), _jsx("dd", { children: book.narrators.join(", ") || "Not known" })] }), b.series && (_jsxs("div", { children: [_jsx("dt", { children: "Series" }), _jsxs("dd", { children: [b.series, b.seriesIndex !== null && `, book ${b.seriesIndex}`] })] })), _jsxs("div", { children: [_jsx("dt", { children: "Status" }), _jsx("dd", { children: b.status === "read" ? "Finished" : b.status === "in_progress" ? "Listening" : "Not started" })] }), _jsxs("div", { children: [_jsx("dt", { children: "Read along with" }), _jsxs("dd", { children: [book.ebook ? book.ebook.name : _jsx("span", { className: "muted", children: "No ebook linked" }), " ", _jsx("button", { type: "button", className: "view-all", onClick: () => setLinking(true), children: book.ebook ? "Change" : "Link an ebook" }), book.ebook && (_jsx("button", { type: "button", className: "view-all", onClick: () => api.linkEbook(bookId, null).then(() => {
                                                    setBook({ ...book, ebook: null });
                                                    player.refresh();
                                                }, (e) => toast(String(e))), children: "Unlink" }))] })] })] })), tab === "files" && (_jsxs(_Fragment, { children: [_jsxs("p", { className: "muted", children: [b.availability === "cloud"
                                        ? "In the cloud only. It downloads when you play it."
                                        : b.inCloud
                                            ? "On this device and in the cloud."
                                            : "On this device.", details?.fileSize ? ` ${formatBytes(details.fileSize)} in all.` : ""] }), _jsx("ol", { className: "chapter-list", children: book.parts.map((p, i) => (_jsxs("li", { className: "chapter-row is-static", children: [_jsx("span", { className: "num muted", children: i + 1 }), _jsx("span", { className: "chapter-name", children: p.name }), _jsx("span", { className: "num muted", children: clock(p.durationMs) })] }, i))) })] })), tab === "collections" && (_jsxs("div", { className: "details-chips", children: [(details?.collections ?? []).map((c) => (_jsxs("button", { type: "button", className: "tag-chip tag-chip-add", onClick: () => onOpenCollection(c.id), children: [_jsx(Icon, { name: "collections", size: 12 }), " ", c.name] }, c.id))), _jsx("button", { type: "button", className: "view-all", onClick: () => askAddToCollection(b), children: "Add to a collection" })] }))] }), next && (_jsxs("div", { className: "audio-up-next", children: [_jsx("h3", { children: "Up next" }), _jsxs("button", { type: "button", className: "chapter-row", onClick: () => (playing ? player.seek(next.startMs) : void player.load(bookId).then(() => player.seek(next.startMs))), children: [_jsx("span", { className: "num muted", children: current + 2 }), _jsx("span", { className: "chapter-name", children: next.title }), _jsx("span", { className: "num muted", children: clock(chapterLength(book, current + 1)) })] })] })), linking && (_jsx(LinkEbook, { audiobook: b, onClose: (ebook) => {
                    setLinking(false);
                    if (ebook !== undefined) {
                        setBook({ ...book, ebook });
                        player.refresh();
                        onChanged();
                    }
                } }))] }));
}

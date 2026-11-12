import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { downloadable, useBatchDownloads } from "./BatchDownloads";
import { ofKind } from "../lib/queryBooks";
import { SeriesCoverPicker } from "./SeriesCoverPicker";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, isHome, isWeb } from "../api";
import { askAddToCollection } from "../collections/AddToCollection";
import { askEditDetails, showBookDetails } from "../details/openDetails";
import { askSendToEreader } from "../ereaders/SendToEreader";
import { askSendWithLocalSend, canSendWithLocalSend } from "../localsend/SendWithLocalSend";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Icon } from "../components/Icon";
import { Menu } from "../components/Menu";
import { FindMissingButton, SeriesPanel, useSeriesReview } from "./SeriesPanel";
import { useToast } from "../components/Toast";
import { makeBookActions, phoneChoiceShown } from "../home/bookActions";
import { Spent, Stat } from "../home/ReadingActivity";
import { useTimeSpent } from "../home/useTimeSpent";
import { TagsDialog, deleteWarning, removeWarning } from "./BookDialogs";
import { BookGrid, BookList, BookTable } from "./BookViews";
import { CollectionsTab } from "./CollectionsTab";
import { LibraryToolbar } from "./LibraryToolbar";
import { excludeCount, NO_FILTERS, PAGE_SIZE } from "./libraryView";
import { Pagination } from "./Pagination";
import { useNarrow } from "../lib/useNarrow";
import { useAppSettings } from "../settings/appSettings";
const WORDS = {
    books: { title: "Archive", one: "book", many: "books", total: "Total" },
    documents: { title: "Archive", one: "document", many: "documents", total: "Total" },
    audiobooks: { title: "Resonance", one: "audiobook", many: "audiobooks", total: "Total" },
};
/** The switch at the top right of the Archive and Resonance: Books or Documents, Paired or Audiobooks only. */
export function PageSwitch({ label, value, options, onChange, }) {
    return (_jsx("div", { className: "segmented page-switch", role: "radiogroup", "aria-label": label, children: options.map((o) => (_jsx("button", { type: "button", role: "radio", "aria-checked": value === o.value, onClick: () => onChange(o.value), children: o.label }, o.value))) }));
}
export function Library({ kind = "books", view, search, refreshKey, onChange, onClearSearch, onImportBooks, onImportFolder, onOpenBook, onOpenCollection, intro, switcher, paired = null, onPairing, onOpenSeries, seriesBack, onShowAllSeries, restoreScroll, onScrollRestored, }) {
    const [load, setLoad] = useState({ state: "loading" });
    const loadedView = useRef("");
    const spent = useTimeSpent(refreshKey);
    const [collections, setCollections] = useState(null);
    const [reload, setReload] = useState(0);
    // Choosing books to change many at once.
    const [selected, setSelected] = useState(null);
    /** The book picked last, where a Shift-click range starts. */
    const lastPicked = useRef(null);
    /** The books of each series chosen as a stack, by series name. */
    const [stackBooks, setStackBooks] = useState(() => new Map());
    const [tagging, setTagging] = useState(false);
    const [asking, setAsking] = useState(null);
    const [seriesRemoval, setSeriesRemoval] = useState(null);
    const [bulkBusy, setBusy] = useState(null);
    const downloads = useBatchDownloads(() => setReload((n) => n + 1));
    const busy = bulkBusy || downloads.progress || null;
    const seriesBooks = async (name) => {
        const detail = await api.getCollection({ kind: "series", name });
        return detail.books.filter((book) => ofKind(book, kind));
    };
    const downloadSeries = (name) => downloads.download(() => seriesBooks(name));
    /** The search and filters everything was last chosen for. */
    const toast = useToast();
    const askRemoveSeriesDownloads = async (name) => {
        setBusy("Checking downloads…");
        try {
            const books = (await seriesBooks(name)).filter((book) => book.availability === "local");
            if (!books.some((book) => book.inCloud)) {
                toast(books.length ? "The downloaded files are the only copies and will stay on this device." : "This series has no downloads on this device.");
                return;
            }
            setSeriesRemoval({ name, books });
            setAsking("download");
        }
        catch (error) {
            toast(String(error));
        }
        finally {
            setBusy(null);
        }
    };
    const words = WORDS[kind];
    // On a phone there are no pages: more books load as the list nears its end.
    // A computer can ask for the same in Settings.
    const narrow = useNarrow();
    const { settings: { scrollLibrary }, change: changeSettings } = useAppSettings();
    const [pins, setPins] = useState([]);
    const [pinnedSeries, setPinnedSeries] = useState([]);
    const [pinnedStacks, setPinnedStacks] = useState(null);
    const [facets, setFacets] = useState(null);
    const [searching, setSearching] = useState(false);
    const [coverPicker, setCoverPicker] = useState(null);
    const coverKey = `tbv.stackCovers.${kind}`;
    const [coverChoices, setCoverChoices] = useState(() => {
        try {
            const value = JSON.parse(localStorage.getItem(coverKey) ?? "{}");
            return Object.fromEntries(Object.entries(value ?? {}).filter(([, id]) => typeof id === "string"));
        }
        catch {
            return {};
        }
    });
    const changeCover = (name, id) => {
        const key = name.trim().toLowerCase();
        const next = { ...coverChoices };
        if (id)
            next[key] = id;
        else
            delete next[key];
        setCoverChoices(next);
        try {
            localStorage.setItem(coverKey, JSON.stringify(next));
        }
        catch { /* Keep this session's choice. */ }
    };
    const toggleSeriesPin = (name, pinned) => {
        void api.setArchiveSeriesPin(name, pinned).then(() => {
            setReload((n) => n + 1);
            if (!pinned)
                toast("Series unpinned.", { label: "Undo", run: () => toggleSeriesPin(name, true) });
        }, (error) => toast(String(error)));
    };
    const seriesMenu = (name) => {
        const key = name.trim().toLowerCase();
        const pinned = pinnedSeries.some((value) => value.trim().toLowerCase() === key);
        return [
            { label: "Download", icon: "download", disabled: !!busy, onSelect: () => void downloadSeries(name) },
            { label: "Remove download", icon: "cloudOff", disabled: !!busy, onSelect: () => void askRemoveSeriesDownloads(name) },
            { label: "Choose stack cover", onSelect: () => setCoverPicker(name) },
            ...(coverChoices[key] ? [{ label: "Reset to automatic", onSelect: () => changeCover(name) }] : []),
            ...(kind === "books" ? [{ label: pinned ? "Unpin series" : "Pin series", onSelect: () => toggleSeriesPin(name, !pinned) }] : []),
        ];
    };
    const [pinsExpanded, setPinsExpanded] = useState(() => {
        try {
            return localStorage.getItem("tbv.archive.pinsCollapsed") === "0";
        }
        catch {
            return false;
        }
    });
    const togglePins = (expanded) => {
        setPinsExpanded(expanded);
        try {
            localStorage.setItem("tbv.archive.pinsCollapsed", expanded ? "0" : "1");
        }
        catch { /* The current view still folds. */ }
    };
    const endless = narrow || scrollLibrary;
    /** Phone: how many pages are shown, and the books of every page after the first. */
    const [pages, setPages] = useState(1);
    const [later, setLater] = useState([]);
    const loadingMore = useRef(false);
    const end = useRef(null);
    const actions = useMemo(() => makeBookActions(api, toast, () => setReload((n) => n + 1), onOpenBook), [toast, onOpenBook]);
    const shelf = view.tab === "collections" ? "all" : view.tab;
    const Layout = { grid: BookGrid, list: BookList, compact: BookTable }[view.layout];
    // Series stay stacked while choosing: a stack is chosen whole.
    const groupSeries = kind !== "documents" && view.seriesGrouping !== "individual" && !seriesBack;
    const inSeries = !!seriesBack;
    const seriesName = inSeries ? view.series[0] : undefined;
    const [seriesTotal, setSeriesTotal] = useState(null);
    useEffect(() => {
        if (!seriesName)
            return;
        let current = true;
        void api.getLibrary({ kind, shelf: "all", sort: "series", search: null, formats: [], location: null, series: [seriesName], page: 0, pageSize: 1, omitFacets: true })
            .then((data) => { if (current)
            setSeriesTotal({ name: seriesName, count: data.total }); }, () => { if (current)
            setSeriesTotal(null); });
        return () => { current = false; };
    }, [seriesName, kind, refreshKey, reload]);
    const separatePins = kind === "books" && !inSeries;
    const pinnedFirst = !inSeries;
    const pinned = separatePins ? false : undefined;
    const query = {
        shelf,
        sort: view.sort,
        search: search.trim() || null,
        formats: view.formats,
        location: view.location,
        tags: view.tags,
        genres: view.genres,
        languages: view.languages,
        downloadable: view.downloadable,
        authors: view.authors,
        series: view.series,
        narrators: view.narrators,
        hideRead: view.hideRead,
        exclude: view.exclude,
        kind,
        paired,
        audioType: view.audioType,
        pinnedFirst,
        pinned,
        groupSeries,
        mixSeries: groupSeries && view.seriesGrouping === "mixed",
        omitFacets: true,
        seriesCoverChoices: coverChoices,
    };
    const queryKey = JSON.stringify(query);
    const requestKey = queryKey + ":" + (endless ? 0 : view.page);
    const inFlight = useRef(false);
    const pendingRequest = useRef(null);
    const previousSearch = useRef(query.search);
    useEffect(() => {
        let current = true;
        void api.getLibrary({ kind, shelf: "all", sort: "recently_added", search: null, formats: [], location: null, page: 0, pageSize: 1 })
            .then((data) => { if (current)
            setFacets(data); }, () => undefined);
        if (kind === "books")
            void api.archiveSeriesPins?.().then((names) => {
                if (current)
                    setPinnedSeries(names);
            }, () => undefined);
        return () => { current = false; };
    }, [kind, refreshKey, reload]);
    useEffect(() => {
        let current = true;
        let scheduled = false;
        let indicator;
        setSearching(false);
        const wait = previousSearch.current !== query.search && !!query.search;
        previousSearch.current = query.search;
        const run = () => {
            if (!current)
                return;
            inFlight.current = true;
            if (query.search)
                indicator = window.setTimeout(() => { if (current)
                    setSearching(true); }, 180);
            const results = api.getLibrary({ ...query, page: endless ? 0 : view.page, pageSize: PAGE_SIZE }).then((data) => {
                if (!current)
                    return;
                window.clearTimeout(indicator);
                loadedView.current = requestKey;
                setLoad({ state: "ready", data });
                setSearching(false);
            }, (error) => {
                if (!current)
                    return;
                setSearching(false);
                window.clearTimeout(indicator);
                setLoad({ state: "error", message: String(error) });
            });
            const pinnedRequests = [];
            if (separatePins && view.tab !== "collections") {
                pinnedRequests.push(api.getLibrary({ ...query, pinned: true, groupSeries: false, page: 0, pageSize: 200 })
                    .then((data) => { if (current)
                    setPins(data.books.filter((book) => book.pinnedAt)); }, () => { if (current)
                    setPins([]); }));
                const matching = pinnedSeries.filter((name) => !query.series.length || query.series.some((value) => value.toLowerCase() === name.toLowerCase()));
                if (matching.length)
                    pinnedRequests.push(api.getLibrary({
                        ...query, pinned: undefined, pinnedFirst: false, groupSeries: true, mixSeries: false, series: matching, page: 0, pageSize: 200,
                    }).then((data) => { if (current)
                        setPinnedStacks(data); }, () => { if (current)
                        setPinnedStacks(null); }));
                else
                    setPinnedStacks(null);
            }
            void Promise.all([results, ...pinnedRequests]).finally(() => {
                inFlight.current = false;
                const next = pendingRequest.current;
                pendingRequest.current = null;
                next?.();
            });
        };
        const submit = () => {
            if (scheduled)
                return;
            scheduled = true;
            if (inFlight.current)
                pendingRequest.current = run;
            else
                run();
        };
        const timer = wait ? window.setTimeout(submit, 150) : undefined;
        if (!wait)
            submit();
        window.addEventListener("tbv:submit-library-search", submit);
        return () => {
            current = false;
            window.clearTimeout(timer);
            window.clearTimeout(indicator);
            window.removeEventListener("tbv:submit-library-search", submit);
            if (pendingRequest.current === run)
                pendingRequest.current = null;
        };
    }, [requestKey, pinnedSeries, separatePins, refreshKey, reload]);
    // A new search, filter, shelf or sort starts the phone's list from the top.
    useEffect(() => {
        setPages(1);
        setLater([]);
        loadingMore.current = false;
    }, [queryKey, endless]);
    // The later pages come again after a change (a book moved shelf, say), so the list keeps its place.
    useEffect(() => {
        if (!endless || pages < 2)
            return;
        let current = true;
        loadingMore.current = true;
        Promise.all(Array.from({ length: pages - 1 }, (_, i) => api.getLibrary({ ...query, page: i + 1, pageSize: PAGE_SIZE })))
            .then((got) => current && setLater(got.filter((p, i) => p.page === i + 1)), () => { })
            .finally(() => {
            if (current)
                loadingMore.current = false;
        });
        return () => {
            current = false;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [endless, refreshKey, reload]);
    // The next page, once more of it is wanted.
    useEffect(() => {
        if (!endless || pages < 2 || later.length >= pages - 1)
            return;
        let current = true;
        loadingMore.current = true;
        const want = pages - 1;
        api
            .getLibrary({ ...query, page: want, pageSize: PAGE_SIZE })
            .then((p) => current && setLater((l) => (l.length === want - 1 && p.page === want ? [...l, p] : l)), () => { })
            .finally(() => {
            loadingMore.current = false;
        });
        return () => {
            current = false;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [endless, pages, later.length]);
    useEffect(() => {
        if (view.tab !== "collections")
            return;
        let current = true;
        api.getCollections().then((c) => current && setCollections(c), () => current && setCollections([]));
        return () => {
            current = false;
        };
    }, [view.tab, refreshKey]);
    // Chosen books keep up with changes made to them, like a tag just added.
    useEffect(() => {
        if (load.state !== "ready")
            return;
        setSelected((s) => {
            if (!s || !load.data.books.some((b) => s.has(b.id)))
                return s;
            const next = new Map(s);
            load.data.books.forEach((b) => next.has(b.id) && next.set(b.id, b));
            return next;
        });
    }, [load]);
    // Only books the search and filters show stay chosen: when they change,
    // chosen books they now leave out are let go, so changing many never
    // reaches a book you can't see.
    const chosenIds = useRef([]);
    chosenIds.current = selected ? [...selected.keys()] : [];
    useEffect(() => {
        // A series' books are looked up again under the new search and filters.
        setStackBooks((m) => (m.size ? new Map() : m));
        const ids = chosenIds.current;
        if (!ids.length)
            return;
        let current = true;
        const chunks = Array.from({ length: Math.ceil(ids.length / 200) }, (_, i) => ids.slice(i * 200, i * 200 + 200));
        Promise.all(chunks.map((chunk) => api.getLibrary({ ...query, pinned: undefined, groupSeries: false, ids: chunk, page: 0, pageSize: 200 }))).then((pages) => {
            if (!current)
                return;
            const shown = new Set(pages.flatMap((p) => p.books.map((b) => b.id)));
            setSelected((s) => {
                if (!s || [...s.keys()].every((id) => shown.has(id)))
                    return s;
                return new Map([...s].filter(([id]) => shown.has(id)));
            });
        }, () => undefined);
        return () => {
            current = false;
        };
    }, [queryKey, refreshKey, reload]); // eslint-disable-line react-hooks/exhaustive-deps
    // A new page starts at the top, like turning a page.
    useEffect(() => {
        if (!endless || inSeries)
            document.querySelector(".content")?.scrollTo({ top: 0 });
    }, [view.page, endless, inSeries]);
    const first = load.state === "ready" ? load.data : null;
    // On a phone, the first page with every later one loaded so far.
    const page = useMemo(() => (first && endless && later.length ? {
        ...first,
        books: [...first.books, ...later.flatMap((p) => p.books)],
        seriesCounts: Object.assign({}, first.seriesCounts, ...later.map((p) => p.seriesCounts)),
        seriesPublished: Object.assign({}, first.seriesPublished, ...later.map((p) => p.seriesPublished)),
        seriesCovers: Object.assign({}, first.seriesCovers, ...later.map((p) => p.seriesCovers)),
    } : first), [first, endless, later]);
    // One series shown: its check for missing books (button up top, list under the books).
    const checkedSeries = !isWeb && !isHome && view.tab !== "collections" && view.series.length === 1 ? view.series[0] : null;
    const seriesAuthor = page?.books[0]?.authors[0] ?? "";
    const seriesCheckState = useSeriesReview(checkedSeries, seriesAuthor, refreshKey + reload, () => setReload((n) => n + 1));
    const seriesCheck = checkedSeries ? seriesCheckState : null;
    useEffect(() => {
        if (restoreScroll == null || !first || loadedView.current !== requestKey || (endless && hasPendingScroll()))
            return;
        const id = requestAnimationFrame(() => {
            document.querySelector(".content")?.scrollTo({ top: restoreScroll });
            onScrollRestored?.();
        });
        return () => cancelAnimationFrame(id);
        function hasPendingScroll() {
            const content = document.querySelector(".content");
            if (!content || content.scrollHeight - content.clientHeight >= restoreScroll)
                return false;
            if ((later.length + 1) * PAGE_SIZE >= first.total)
                return false;
            if (!loadingMore.current)
                setPages((n) => Math.max(n, later.length + 2));
            return true;
        }
    }, [restoreScroll, first, later.length, endless, onScrollRestored, requestKey]);
    const hasMore = endless && loadedView.current === requestKey && page !== null && (later.length + 1) * PAGE_SIZE < page.total;
    // Genres, tags, formats and languages come from the books themselves: a
    // filter on one that no book has any more (its last book changed or went)
    // is dropped, so the lists never hold names the library doesn't.
    useEffect(() => {
        if (!facets)
            return;
        const change = gone(view, facets);
        if (change)
            onChange(change);
    }, [facets]); // eslint-disable-line react-hooks/exhaustive-deps
    // Near the end of the list, the next page loads.
    useEffect(() => {
        const target = end.current;
        if (!hasMore || !target || typeof IntersectionObserver !== "function")
            return;
        const watch = new IntersectionObserver((seen) => {
            if (seen.some((s) => s.isIntersecting) && !loadingMore.current)
                setPages((n) => Math.max(n, later.length + 2));
        }, { root: document.querySelector(".content"), rootMargin: "800px 0px" });
        watch.observe(target);
        return () => watch.disconnect();
    }, [hasMore, later.length]);
    const counts = facets?.counts ?? null;
    const filtered = view.formats.length > 0 || view.location !== null || view.tags.length > 0 || view.genres.length > 0 || view.languages.length > 0 || view.downloadable || view.authors.length > 0 || view.series.length > 0 || view.narrators.length > 0 || view.hideRead || excludeCount(view.exclude) > 0;
    const selection = selected && {
        has: (id) => selected.has(id),
        toggle: (book, range) => {
            const from = range?.findIndex((b) => b.id === lastPicked.current) ?? -1;
            const to = range?.findIndex((b) => b.id === book.id) ?? -1;
            lastPicked.current = book.id;
            setSelected((s) => {
                const next = new Map(s);
                if (range && from >= 0 && to >= 0) {
                    // Shift: everything between the last book picked and this one.
                    for (const b of range.slice(Math.min(from, to), Math.max(from, to) + 1))
                        next.set(b.id, b);
                }
                else if (next.has(book.id))
                    next.delete(book.id);
                else
                    next.set(book.id, book);
                return next;
            });
        },
        hasSeries: (name) => {
            const books = stackBooks.get(name);
            return !!books?.length && books.every((b) => selected.has(b.id));
        },
        toggleSeries: (name) => void chooseSeries([name], !selection?.hasSeries?.(name)),
    };
    /** Every book of these series (as the filters show them), chosen or let go together. */
    async function booksOfSeries(name) {
        const known = stackBooks.get(name);
        if (known)
            return known;
        const found = [];
        for (let p = 0;; p++) {
            const got = await api.getLibrary({ ...query, series: [name], pinned: undefined, groupSeries: false, page: p, pageSize: 200 });
            found.push(...got.books);
            if (got.page < p || (got.page + 1) * got.pageSize >= got.total)
                break;
        }
        return found;
    }
    async function chooseSeries(names, on, alsoBooks = []) {
        try {
            const lists = await Promise.all(names.map(async (n) => [n, await booksOfSeries(n)]));
            setStackBooks((m) => {
                const next = new Map(m);
                for (const [n, books] of lists)
                    next.set(n, books);
                return next;
            });
            setSelected((s) => {
                const next = new Map(s ?? []);
                for (const b of [...lists.flatMap(([, books]) => books), ...alsoBooks]) {
                    if (on)
                        next.set(b.id, b);
                    else
                        next.delete(b.id);
                }
                return next;
            });
        }
        catch (e) {
            toast(`Couldn't choose that series: ${String(e)}`);
        }
    }
    /**
     * A series with one book in the library, or just one of its books on this
     * device, opens that book's page (which shows the rest of the series too);
     * any other series opens as a series.
     */
    const openStack = (name, openAsSeries) => {
        void seriesBooks(name).then((books) => {
            const here = books.filter((b) => b.availability === "local");
            const only = books.length === 1 ? books[0] : here.length === 1 ? here[0] : null;
            if (only)
                showBookDetails(only.id);
            else
                openAsSeries(name);
        }, () => openAsSeries(name));
    };
    /** A book shown as its series' stack, or null for a book shown on its own. */
    const stackOf = (b) => (groupSeries && page?.seriesCounts?.[b.id] && b.series?.trim() ? b.series.trim() : null);
    const chosen = selected ? [...selected.values()] : [];
    /** Chooses every book the current filters and search show, on every page. */
    const chooseAll = async () => {
        setBusy("Choosing…");
        try {
            const all = new Map(selected ?? []);
            for (let p = 0;; p++) {
                const got = await api.getLibrary({ ...query, pinned: undefined, groupSeries: false, page: p, pageSize: 200 });
                got.books.forEach((b) => all.set(b.id, b));
                if (got.page < p || (got.page + 1) * got.pageSize >= got.total)
                    break;
            }
            setSelected(all);
            setEverything(all.size);
            if (groupSeries) {
                // Every stack is chosen too, so its tick shows and choosing it again lets it go.
                const bySeries = new Map();
                for (const b of all.values()) {
                    const name = b.series?.trim();
                    if (name)
                        bySeries.set(name, [...(bySeries.get(name) ?? []), b]);
                }
                setStackBooks(bySeries);
            }
        }
        catch (e) {
            toast(`Couldn't choose them all: ${String(e)}`);
        }
        finally {
            setBusy(null);
        }
    };
    const none = !selected?.size;
    const pageAllChosen = !!page?.books.length && page.books.every((b) => {
        const name = stackOf(b);
        return name ? !!selection?.hasSeries?.(name) : selected?.has(b.id);
    });
    // Books a search or filter hides are let go from the choice, so this many means all of them.
    const matchingBooks = (page?.total ?? 0) + pins.length;
    const [everything, setEverything] = useState(null);
    // Stacked series count once in the total, so "all" is the number of books "All in library" found.
    const libraryAllChosen = groupSeries
        ? everything !== null && everything > 0 && (selected?.size ?? 0) >= everything
        : matchingBooks > 0 && (selected?.size ?? 0) >= matchingBooks;
    const chosenActions = [
        { label: "Edit details", icon: "edit", disabled: none, onSelect: () => askEditDetails(chosen) },
        { label: "Tags", icon: "tag", disabled: none, onSelect: () => setTagging(true) },
        { label: "Add to or take out of a collection", icon: "collections", disabled: none, onSelect: () => askAddToCollection(chosen) },
        ...(kind !== "audiobooks" ? [{ label: "Send to e-reader", icon: "ereader", disabled: none, onSelect: () => askSendToEreader(chosen) }] : []),
        ...(canSendWithLocalSend ? [{ label: "Send with Grimoire", icon: "upload", disabled: none, onSelect: () => askSendWithLocalSend(chosen) }] : []),
        ...(!isWeb && phoneChoiceShown()
            ? [
                { label: "Send to device", icon: "upload", disabled: none, onSelect: () => actions.setPhoneWanted?.(chosen, true) },
                ...(chosen.some((b) => b.phoneWanted)
                    ? [{ label: "Stop sending to device", icon: "cloudOff", onSelect: () => actions.setPhoneWanted?.(chosen.filter((b) => b.phoneWanted), false) }]
                    : []),
            ]
            : []),
        { label: "Save copies", icon: "copy", disabled: none || busy !== null, onSelect: () => void saveChosen() },
        {
            label: "Download",
            icon: "download",
            disabled: !chosen.some(downloadable) || busy !== null,
            onSelect: () => void downloads.download(async () => chosen),
        },
        {
            label: "Remove download",
            icon: "cloudOff",
            hint: "Keeps the cloud copy",
            disabled: !chosen.some((b) => b.availability === "local" && b.inCloud) || busy !== null,
            onSelect: () => setAsking("download"),
        },
        "divider",
        { label: "Clear choice", icon: "close", disabled: none || busy !== null, onSelect: () => setSelected(new Map()) },
        { label: "Remove from library", icon: "close", disabled: none || busy !== null, onSelect: () => setAsking("remove") },
        { label: "Delete", icon: "trash", danger: true, disabled: none || busy !== null, onSelect: () => setAsking("delete") },
    ];
    /** Removes downloads, removes from the library, or deletes, one book at a time. */
    const changeChosen = async (what) => {
        const targets = seriesRemoval?.books ?? chosen;
        setAsking(null);
        setSeriesRemoval(null);
        const local = what === "download" ? targets.filter((book) => book.availability === "local") : targets;
        const list = what === "download" ? local.filter((book) => book.inCloud) : targets;
        const verb = { remove: "Removing", delete: "Deleting", download: "Removing downloads" }[what];
        const work = { remove: api.removeFromLibrary, delete: api.deleteBook, download: api.removeDownload }[what];
        let failed = 0;
        for (let i = 0; i < list.length; i++) {
            setBusy(`${verb}: ${i + 1} of ${list.length}…`);
            try {
                await work(list[i].id);
            }
            catch {
                failed++;
            }
        }
        setBusy(null);
        if (what !== "download")
            setSelected(new Map());
        setReload((n) => n + 1);
        const done = list.length - failed;
        const count = (n) => (n === 1 ? `1 ${words.one}` : `${n} ${words.many}`);
        const skipped = local.length - list.length;
        toast(what === "download"
            ? `Removed the downloads of ${count(done)}. They're still in the cloud.` +
                (skipped ? ` ${count(skipped)} ${skipped === 1 ? "isn't" : "aren't"} in the cloud yet, so ${skipped === 1 ? "it was" : "they were"} kept here.` : "") +
                (failed ? ` ${count(failed)} couldn't be removed.` : "")
            : failed
                ? `${what === "remove" ? "Removed" : "Deleted"} ${done} of ${list.length}. ${failed} couldn't be changed.`
                : `${what === "remove" ? "Removed" : "Deleted"} ${count(done)}.`);
    };
    const saveChosen = async () => {
        try {
            setBusy("Saving copies…");
            const done = await api.saveCopies(chosen.map((b) => b.id));
            if (done)
                toast(`Saved ${done.saved === 1 ? "a copy" : `${done.saved} copies`} to ${done.folder}.`);
        }
        catch (e) {
            toast(`Couldn't save the copies: ${String(e)}`);
        }
        finally {
            setBusy(null);
        }
    };
    let body;
    if (load.state === "error") {
        body = (_jsxs("div", { className: "library-empty", role: "alert", children: [_jsxs("h2", { children: ["Your ", kind === "documents" ? "documents" : "library", " couldn't be loaded"] }), _jsx("p", { className: "muted", children: load.message }), _jsx("button", { type: "button", className: "btn btn-primary", onClick: () => setReload((n) => n + 1), children: "Try again" })] }));
    }
    else if (view.tab === "collections") {
        body = _jsx(CollectionsTab, { collections: collections, onOpenCollection: onOpenCollection });
    }
    else if (!page) {
        body = _jsx("div", { className: "library-loading", "aria-busy": "true", "aria-label": "Loading your library" });
    }
    else if (facets?.counts.all === 0) {
        body = (_jsxs("div", { className: "library-empty", children: [_jsxs("h2", { children: ["No ", words.many, " yet"] }), _jsx("p", { className: "muted", children: kind === "documents"
                        ? "PDF, Word and text files you import show up here, apart from your books. TBV keeps its own copy and never changes your files."
                        : "Import the books you already have. TBV keeps its own copy and never changes your files." }), _jsxs("div", { className: "hero-actions", children: [_jsxs("button", { type: "button", className: "btn btn-primary", onClick: onImportBooks, children: [_jsx(Icon, { name: "importFile", size: 16 }), " Import ", words.many] }), _jsxs("button", { type: "button", className: "btn btn-quiet", onClick: onImportFolder, children: [_jsx(Icon, { name: "folder", size: 16 }), " Import a folder"] })] })] }));
    }
    else if (page.total === 0 && (pins.length > 0 || (pinnedStacks?.books.length ?? 0) > 0)) {
        body = null;
    }
    else if (page.total === 0) {
        body = (_jsxs("div", { className: "library-empty", children: [_jsx("h2", { children: "Nothing matches" }), _jsxs("p", { className: "muted", children: [search.trim() ? `No ${words.many} on this shelf match “${search.trim()}”.` : `No ${words.many} on this shelf yet.`, filtered && " Filters are also narrowing the list."] }), _jsxs("div", { className: "hero-actions", children: [search.trim() && (_jsx("button", { type: "button", className: "btn btn-quiet", onClick: onClearSearch, children: "Clear search" })), filtered && (_jsx("button", { type: "button", className: "btn btn-quiet", onClick: () => onChange(NO_FILTERS), children: "Clear filters" })), view.tab !== "all" && (_jsxs("button", { type: "button", className: "btn btn-quiet", onClick: () => onChange({ tab: "all" }), children: ["Show all ", words.many] }))] })] }));
    }
    else {
        const noun = groupSeries ? ["item", "items"] : [words.one, words.many];
        const openSeries = onOpenSeries ?? ((name) => {
            onClearSearch();
            onChange({ ...NO_FILTERS, tab: "all", series: [name], sort: "series", page: 0 });
        });
        const items = _jsx(Layout, { books: page.books, actions: actions, selection: selection, seriesCounts: groupSeries ? page.seriesCounts : undefined, seriesCovers: page.seriesCovers, seriesPublished: page.seriesPublished, seriesMenu: seriesMenu, showStatus: inSeries, onOpenSeries: (name) => openStack(name, openSeries) });
        body = endless ? (_jsxs(_Fragment, { children: [items, _jsx("div", { ref: end, className: "library-end muted num", children: hasMore ? _jsx("span", { className: "library-more", "aria-busy": "true", "aria-label": `Loading more ${words.many}` }) : `${page.total.toLocaleString()} ${page.total === 1 ? noun[0] : noun[1]}` })] })) : (_jsxs(_Fragment, { children: [_jsx(Pagination, { top: true, page: page.page, pageSize: page.pageSize, total: page.total, onPage: (p) => onChange({ page: p }) }), items, _jsx(Pagination, { noun: noun, page: page.page, pageSize: page.pageSize, total: page.total, onPage: (p) => onChange({ page: p }) })] }));
    }
    return (_jsxs("div", { className: "library", children: [_jsxs("header", { className: "library-head is-stacked", children: [seriesBack && _jsxs("button", { type: "button", className: "back-link", onClick: seriesBack, children: [_jsx(Icon, { name: "chevronLeft", size: 14 }), " Back to ", words.title] }), _jsxs("div", { className: "library-title-row", children: [_jsx("h1", { className: "library-title", children: inSeries ? view.series[0] : words.title }), switcher] }), seriesName && (_jsxs("div", { className: "settings-actions", children: [_jsx("button", { type: "button", className: "btn btn-quiet", disabled: !!busy, onClick: () => void downloadSeries(seriesName), children: "Download" }), _jsx("button", { type: "button", className: "btn btn-quiet", disabled: !!busy, onClick: () => void askRemoveSeriesDownloads(seriesName), children: "Remove download" }), seriesCheck && _jsx(FindMissingButton, { state: seriesCheck })] })), !seriesName && seriesCheck && (_jsx("div", { className: "settings-actions", children: _jsx(FindMissingButton, { state: seriesCheck }) })), seriesName && seriesTotal?.name === seriesName && page && page.total < seriesTotal.count && (_jsxs("div", { className: "search-note", children: [_jsxs("span", { children: [page.total, " of ", seriesTotal.count, " books shown"] }), onShowAllSeries && _jsx("button", { type: "button", className: "view-all", onClick: onShowAllSeries, children: "Show all books in this series" })] })), counts && (_jsxs("div", { className: "stats stats-5 library-stats", children: [_jsx(Stat, { icon: "circleProgress", value: counts.inProgress, label: "In progress" }), _jsx(Stat, { icon: "checkCircle", value: counts.read, label: "Read" }), _jsx(Stat, { icon: "circle", value: counts.unread, label: "Unread" }), _jsx(Stat, { icon: kind === "audiobooks" ? "headphones" : "bookOpen", value: counts.all, label: words.total }), spent &&
                                (kind === "audiobooks" ? (_jsx(Stat, { icon: "clock", value: _jsx(Spent, { seconds: spent.listen }), label: "Listened" })) : (_jsx(Stat, { icon: "clock", value: _jsx(Spent, { seconds: spent.read }), label: "Time read" })))] }))] }), isWeb && (_jsx("div", { className: "segmented library-reach", role: "radiogroup", "aria-label": "Which books to show", children: [
                    { on: false, label: "Full library" },
                    { on: true, label: "Available to download" },
                ].map(({ on, label }) => (_jsx("button", { type: "button", role: "radio", "aria-checked": view.downloadable === on, onClick: () => onChange({ downloadable: on, page: 0 }), children: label }, label))) })), !seriesBack && _jsx(LibraryToolbar, { view: view, counts: counts, formats: facets?.formats ?? [], tags: facets?.tags ?? [], genres: facets?.genres ?? [], languages: facets?.languages ?? [], authors: facets?.authors ?? undefined, narrators: facets?.narrators ?? undefined, allLabel: kind === "books" ? undefined : `All ${words.many}`, allowSeries: kind !== "documents", seriesNames: facets?.seriesNames ?? [], paired: paired, onPairing: onPairing, continuous: scrollLibrary, onContinuous: narrow ? undefined : (enabled) => {
                    changeSettings({ scrollLibrary: enabled });
                    onChange({ page: 0 });
                    document.querySelector(".content")?.scrollTo({ top: 0 });
                }, selecting: selected !== null, onSelecting: (on) => setSelected(on ? new Map() : null), onSelectAll: () => void chooseAll(), onChange: onChange }), selected && view.tab !== "collections" && (_jsxs("div", { className: "select-bar", role: "toolbar", "aria-label": `Change many ${words.many}`, children: [_jsx("span", { className: "select-count", children: selected.size ? `${selected.size} chosen` : `Click ${words.many} to choose them` }), busy && _jsx("span", { className: "select-count", children: busy }), _jsxs("span", { className: "select-actions", children: [_jsx(Menu, { label: `Do something with the chosen ${words.many}`, className: "btn btn-quiet", align: "start", trigger: _jsxs(_Fragment, { children: ["Actions ", _jsx(Icon, { name: "chevronDown", size: 13 })] }), items: chosenActions }), !endless && (_jsxs("label", { className: "select-all", children: [_jsx("input", { type: "checkbox", checked: pageAllChosen, disabled: !page?.books.length || busy !== null, onChange: (e) => {
                                            if (!page)
                                                return;
                                            const on = e.target.checked;
                                            const stacks = page.books.map(stackOf).filter((n) => !!n);
                                            const single = page.books.filter((b) => !stackOf(b));
                                            void chooseSeries(stacks, on, single);
                                        } }), "All on page"] })), _jsxs("label", { className: "select-all", children: [_jsx("input", { type: "checkbox", checked: libraryAllChosen, disabled: !page?.total || busy !== null, onChange: (e) => (e.target.checked ? void chooseAll() : setSelected(new Map())) }), "All in library"] }), _jsx("button", { type: "button", className: "btn btn-primary", disabled: busy !== null, onClick: () => setSelected(null), children: "Done" })] })] })), asking && (_jsx(ConfirmDialog, { title: {
                    download: seriesRemoval ? `Remove downloads for “${seriesRemoval.name}”?` :
                        `Remove the downloads of ${chosen.length === 1 ? `“${chosen[0].title}”` : `${chosen.length} ${words.many}`}?`,
                    remove: `Remove ${chosen.length === 1 ? `“${chosen[0].title}”` : `${chosen.length} ${words.many}`} from your library?`,
                    delete: `Delete ${chosen.length === 1 ? `“${chosen[0].title}”` : `${chosen.length} ${words.many}`} for good?`,
                }[asking], body: asking === "download"
                    ? "This frees up space on this device. The books stay in your library and in the cloud, and download again when you open them. Books that aren't in the cloud yet are kept here."
                    : (asking === "remove" ? removeWarning : deleteWarning)(chosen.length > 1), confirm: { download: "Remove downloads", remove: "Remove from library", delete: "Delete for good" }[asking], danger: asking !== "download", onCancel: () => { setAsking(null); setSeriesRemoval(null); }, onConfirm: () => void changeChosen(asking) })), tagging && (_jsx(TagsDialog, { books: chosen, onClose: (changed) => {
                    setTagging(false);
                    if (changed)
                        setReload((n) => n + 1);
                } })), search.trim() && view.tab !== "collections" && (_jsxs("p", { className: "search-note", children: ["Showing results for \u201C", search.trim(), "\u201D", _jsx("button", { type: "button", className: "view-all", onClick: onClearSearch, children: "Clear" })] })), view.tab !== "collections" && intro, searching && _jsx("p", { className: "muted library-searching", role: "status", children: "Searching\u2026" }), coverPicker && _jsx(SeriesCoverPicker, { name: coverPicker, kind: kind, chosen: coverChoices[coverPicker.trim().toLowerCase()], onChoose: (id) => { changeCover(coverPicker, id); setCoverPicker(null); }, onClose: () => setCoverPicker(null) }), downloads.feedback, _jsxs("div", { className: "library-body", children: [separatePins && (pins.length > 0 || (pinnedStacks?.books.length ?? 0) > 0) && view.tab !== "collections" && (_jsxs("details", { className: "library-pins", open: pinsExpanded, onToggle: (event) => togglePins(event.currentTarget.open), children: [_jsxs("summary", { children: [_jsx(Icon, { name: "pin", size: 16 }), " Pinned books ", _jsx("span", { className: "tab-count num", children: pins.length + (pinnedStacks?.books.length ?? 0) })] }), _jsx(Layout, { books: pins, actions: actions, selection: selection }), pinnedStacks && pinnedStacks.books.length > 0 && (_jsx(Layout, { books: pinnedStacks.books, actions: actions, seriesCounts: pinnedStacks.seriesCounts, seriesCovers: pinnedStacks.seriesCovers, seriesPublished: pinnedStacks.seriesPublished, onOpenSeries: onOpenSeries && ((name) => openStack(name, onOpenSeries)), seriesMenu: seriesMenu }))] })), body] }), seriesCheck && checkedSeries && (_jsx(SeriesPanel, { name: checkedSeries, author: seriesAuthor, refreshKey: refreshKey + reload, onChanged: () => setReload((n) => n + 1), state: seriesCheck }))] }));
}
/** A book that can be downloaded here: only in the cloud, or its file gone from here. */
const KNOWN_LISTS = ["formats", "tags", "genres", "languages"];
/** The filters to keep when some of `view`'s names aren't in the library any more, or null when all are. */
export function gone(view, page) {
    const change = {};
    const exclude = { ...view.exclude };
    let changed = false;
    for (const list of KNOWN_LISTS) {
        const known = new Set(page[list].map((n) => n.toLowerCase()));
        const keep = (names) => names.filter((n) => known.has(n.toLowerCase()));
        const shown = keep(view[list]);
        const hidden = keep(view.exclude[list]);
        if (shown.length !== view[list].length)
            change[list] = shown;
        if (hidden.length !== view.exclude[list].length)
            exclude[list] = hidden;
        changed ||= shown.length !== view[list].length || hidden.length !== view.exclude[list].length;
    }
    if (!changed)
        return null;
    return { ...change, exclude, page: 0 };
}

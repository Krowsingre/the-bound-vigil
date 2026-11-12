import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Icon } from "../components/Icon";
import { Menu } from "../components/Menu";
import { useToast } from "../components/Toast";
import { CollectionCard, PinnedCard, SeriesCard, SmartCard } from "./CollectionCards";
import { CollectionEditor } from "./CollectionEditor";
import { sameRef, SMART_INFO } from "./collectionInfo";
import { CollectionPanel } from "./CollectionPanel";
import { CollectionView } from "./CollectionView";
import { KindleCard, KindleView, KINDLE_NAME } from "./KindleList";
import { KINDLE_CHANGED } from "../imports/KindleReview";
import { moved, useReorder } from "./useReorder";
import { useAppSettings } from "../settings/appSettings";
import { Stat } from "../home/ReadingActivity";
import { PageSwitch } from "../library/Library";
const SORTS = [
    { sort: "custom", label: "Your order" },
    { sort: "name", label: "Name, A to Z" },
    { sort: "size", label: "Most books" },
    { sort: "rating", label: "Highest rated" },
    { sort: "created", label: "Recently created" },
    { sort: "changed", label: "Recently changed" },
];
const SMART_SORTS = [
    { sort: "custom", label: "Your order" },
    { sort: "name", label: "Name, A to Z" },
    { sort: "size", label: "Most books" },
    { sort: "rating", label: "Highest rated" },
];
/** Highest average rating first; collections with no rated books last. */
const byRating = (a, b) => (b.rating ?? -1) - (a.rating ?? -1);
const PREFS_KEY = "tbv.collections.view";
/** Your order for the smart compendiums, kept with this device's settings. A
 * new name since the set changed in 1.23, so it starts in the usual order. */
const SMART_ORDER_KEY = "compendium.smartOrder";
const SIDE_KEY = "tbv.compendium.side";
const SMART_FOLDED_KEY = "tbv.compendium.smartFolded";
function readStored(key) {
    try {
        return localStorage.getItem(key);
    }
    catch {
        return null;
    }
}
function store(key, value) {
    try {
        localStorage.setItem(key, value);
    }
    catch {
        /* just not remembered */
    }
}
function readPrefs() {
    try {
        const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}");
        return {
            sort: SORTS.some((s) => s.sort === p.sort) ? p.sort : "custom",
            smartSort: SMART_SORTS.some((s) => s.sort === p.smartSort) ? p.smartSort : "custom",
            layout: p.layout === "list" ? "list" : "grid",
        };
    }
    catch {
        return { sort: "custom", smartSort: "custom", layout: "grid" };
    }
}
/** Your order for the smart collections, with any new kinds at the end. */
function orderSmart(list, saved) {
    const rank = (k) => {
        const i = saved.indexOf(k);
        return i < 0 ? saved.length + list.findIndex((s) => s.kind === k) : i;
    };
    return [...list].sort((a, b) => rank(a.kind) - rank(b.kind));
}
export function Collections({ open, refreshKey, onOpen, onOpenBook, onChanged, onDiscover, search, kindleOpen, setKindleOpen, kindleSearch, }) {
    const [overview, setOverview] = useState(null);
    const [error, setError] = useState(null);
    const [reload, setReload] = useState(0);
    const [selected, setSelected] = useState(null);
    const [tab, setTab] = useState("all");
    const [side, setSide] = useState(() => (readStored(SIDE_KEY) === "series" ? "series" : "compendiums"));
    const [smartFolded, setSmartFolded] = useState(() => readStored(SMART_FOLDED_KEY) !== "0");
    const changeSide = (next) => {
        setSide(next);
        store(SIDE_KEY, next);
    };
    const foldSmart = () => {
        setSmartFolded(!smartFolded);
        store(SMART_FOLDED_KEY, smartFolded ? "0" : "1");
    };
    const [prefs, setPrefs] = useState(readPrefs);
    const [smartOrder, setSmartOrder] = useState([]);
    const filter = search;
    const wide = useWide();
    const [editing, setEditing] = useState(null);
    const [deleting, setDeleting] = useState(null);
    const toast = useToast();
    const { settings } = useAppSettings();
    const [kindle, setKindle] = useState(null);
    useEffect(() => {
        let current = true;
        const load = () => api.kindleSummary().then((k) => current && setKindle(k), () => undefined);
        void load();
        window.addEventListener(KINDLE_CHANGED, load);
        return () => {
            current = false;
            window.removeEventListener(KINDLE_CHANGED, load);
        };
    }, [refreshKey, reload]);
    // Opening another collection leaves the Kindle list.
    useEffect(() => {
        if (open)
            setKindleOpen(false);
    }, [open]);
    useEffect(() => {
        let current = true;
        api.getCollectionsOverview().then((o) => {
            if (!current)
                return;
            setOverview(o);
            setError(null);
        }, (e) => current && setError(String(e)));
        return () => {
            current = false;
        };
    }, [refreshKey, reload]);
    useEffect(() => {
        api.getSetting(SMART_ORDER_KEY).then((json) => {
            try {
                const saved = JSON.parse(json ?? "[]");
                if (Array.isArray(saved))
                    setSmartOrder(saved.filter((k) => typeof k === "string"));
            }
            catch {
                /* start from the usual order */
            }
        }, () => undefined);
    }, []);
    // Something is always selected for the side panel: the first pinned one to start.
    const firstPinned = overview?.pinned[0]?.id;
    useEffect(() => {
        if (!selected && firstPinned)
            setSelected({ kind: "collection", id: firstPinned });
    }, [selected, firstPinned]);
    const changePrefs = (change) => setPrefs((p) => {
        const next = { ...p, ...change };
        try {
            localStorage.setItem(PREFS_KEY, JSON.stringify(next));
        }
        catch {
            /* just not remembered */
        }
        return next;
    });
    const changed = useCallback(() => {
        setReload((n) => n + 1);
        onChanged();
    }, [onChanged]);
    const edit = useCallback(async (collection) => {
        const detail = await api.getCollection({ kind: "collection", id: collection.id }).catch(() => null);
        setEditing({
            collection,
            books: (detail?.books ?? []).map(({ id, title, authors, coverPath }) => ({ id, title, authors, coverPath })),
        });
    }, []);
    const togglePin = useCallback((c) => api
        .updateCollection(c.id, { name: c.name, description: c.description, kind: c.kind, badge: c.badge, pinned: !c.pinned, rules: c.rules })
        .then(changed, (e) => toast(String(e))), [changed, toast]);
    const menuFor = useCallback((c) => [
        { label: "Open", onSelect: () => onOpen({ kind: "collection", id: c.id }) },
        { label: c.kind === "shelf" ? "Change picture or badge…" : "Edit…", icon: "edit", onSelect: () => void edit(c) },
        c.pinned
            ? { label: "Unpin from the top", onSelect: () => void togglePin(c) }
            : { label: "Pin to the top", onSelect: () => void togglePin(c) },
        ...(c.kind === "shelf"
            ? []
            : ["divider", { label: "Delete…", icon: "trash", danger: true, onSelect: () => setDeleting(c) }]),
    ], [edit, togglePin, onOpen]);
    const detailMenu = useCallback((detail) => (detail.collection ? menuFor(detail.collection).slice(1) : []), [menuFor]);
    const confirmDelete = (c) => api.deleteCollection(c.id).then(() => {
        setDeleting(null);
        toast(`Deleted ${c.name}. Its books are still in your library.`);
        if (selected?.kind === "collection" && selected.id === c.id)
            setSelected(null);
        if (open?.kind === "collection" && open.id === c.id)
            onOpen(null);
        changed();
    }, (e) => toast(String(e)));
    const dialogs = (_jsxs(_Fragment, { children: [editing && (_jsx(CollectionEditor, { collection: editing.collection, books: editing.books, onCancel: () => setEditing(null), onSaved: (saved) => {
                    setEditing(null);
                    if (!editing.collection) {
                        toast(saved.rules
                            ? `Made ${saved.name}. It holds ${saved.count} ${saved.count === 1 ? "book" : "books"} now and keeps up by itself.`
                            : `Made ${saved.name}. Add books from any book's … menu, or from the collection.`);
                        setSelected({ kind: "collection", id: saved.id });
                    }
                    changed();
                } })), deleting && (_jsx(ConfirmDialog, { title: `Delete ${deleting.name}?`, body: "The collection goes on every device. The books in it stay in your library.", confirm: "Delete collection", danger: true, onCancel: () => setDeleting(null), onConfirm: () => void confirmDelete(deleting) }))] }));
    const q = filter.trim().toLocaleLowerCase();
    const matches = (...texts) => !q || texts.some((t) => t?.toLocaleLowerCase().includes(q));
    const kindleCard = !!kindle && kindle.total > 0 && (kindle.missing > 0 || kindle.removed > 0 || kindle.waiting > 0) && tab !== "reading_lists" && matches(KINDLE_NAME, "kindle amazon");
    const own = useMemo(() => {
        const list = (overview?.collections ?? []).filter((c) => (tab === "all" || (tab === "collections" && c.kind === "collection") || (tab === "reading_lists" && c.kind === "reading_list")) &&
            matches(c.name, c.description));
        const sorters = {
            custom: () => 0,
            name: (a, b) => a.name.localeCompare(b.name),
            size: (a, b) => b.count - a.count || a.name.localeCompare(b.name),
            rating: (a, b) => byRating(a, b) || a.name.localeCompare(b.name),
            created: (a, b) => b.createdAt.localeCompare(a.createdAt),
            changed: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
        };
        return [...list].sort(sorters[prefs.sort]);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [overview, tab, q, prefs.sort]);
    const smart = useMemo(() => {
        const list = overview?.smart ?? [];
        if (prefs.smartSort === "name")
            return [...list].sort((a, b) => SMART_INFO[a.kind].name.localeCompare(SMART_INFO[b.kind].name));
        if (prefs.smartSort === "size")
            return [...list].sort((a, b) => b.count - a.count);
        if (prefs.smartSort === "rating")
            return [...list].sort(byRating);
        return orderSmart(list, smartOrder);
    }, [overview, prefs.smartSort, smartOrder]);
    const reorderSmart = useReorder(smart.map((s) => s.kind), prefs.smartSort === "custom", (kind, to) => {
        const next = moved(smart.map((s) => s.kind), kind, to);
        setSmartOrder(next);
        api.setSetting(SMART_ORDER_KEY, JSON.stringify(next)).catch((e) => toast(String(e)));
    });
    // Your order covers every collection, so a move within a filtered view
    // lands next to the card it was dropped on.
    const reorderOwn = useReorder(own.map((c) => c.id), prefs.sort === "custom" && !q, (id, to) => {
        if (!overview)
            return;
        const target = own[to]?.id;
        const full = overview.collections.map((c) => c.id);
        const index = target ? full.indexOf(target) : full.length - 1;
        const order = moved(full, id, index);
        setOverview({ ...overview, collections: order.map((cid) => overview.collections.find((c) => c.id === cid)) });
        api.moveCollection(id, index).then(changed, (e) => {
            toast(String(e));
            changed();
        });
    });
    const series = (settings.showSeries ? (overview?.series ?? []) : []).filter((s) => side === "series" && matches(s.name, ...s.authors));
    const { shown: seriesShown, more } = useShownBit(series.length, `${side}/${q}`);
    if (kindleOpen && !open)
        return (_jsx(KindleView, { filter: kindleSearch, onDiscover: onDiscover, onBack: () => setKindleOpen(false), onChanged: () => {
                setReload((n) => n + 1);
                onChanged();
            } }));
    if (open)
        return (_jsxs(_Fragment, { children: [_jsx(CollectionView, { collection: open, series: overview?.series ?? [], refreshKey: refreshKey + reload, menuFor: detailMenu, onBack: () => onOpen(null), onOpenBook: onOpenBook, onChanged: changed }), dialogs] }));
    if (error)
        return (_jsx("div", { className: "collections-page", children: _jsxs("div", { className: "library-empty", role: "alert", children: [_jsx("h2", { children: "Your collections couldn't be loaded" }), _jsx("p", { className: "muted", children: error }), _jsx("button", { type: "button", className: "btn btn-primary", onClick: () => setReload((n) => n + 1), children: "Try again" })] }) }));
    if (!overview)
        return _jsx("div", { className: "collections-page library-loading", "aria-busy": "true", "aria-label": "Loading your collections" });
    const counts = {
        collections: overview.collections.filter((c) => c.kind === "collection").length,
        reading_lists: overview.collections.filter((c) => c.kind === "reading_list").length,
        series: overview.series.length,
    };
    // Without room for the side panel, a click opens the collection straight away.
    // One click opens a collection; the side panel then shows it on the way back.
    const pick = (ref) => {
        setSelected(ref);
        onOpen(ref);
    };
    const isSel = (ref) => sameRef(selected, ref);
    return (_jsxs("div", { className: "collections-page compendium", children: [_jsxs("header", { className: "library-head is-stacked compendium-head", children: [_jsxs("div", { className: "library-title-row", children: [_jsx("h1", { className: "library-title", children: "Compendium" }), settings.showSeries && (_jsx(PageSwitch, { label: "Compendiums or series", value: side, options: [
                                    { value: "compendiums", label: "Compendiums" },
                                    { value: "series", label: "Series" },
                                ], onChange: changeSide }))] }), _jsxs("div", { className: "stats stats-5 library-stats", children: [_jsx(Stat, { icon: "squares", value: counts.collections, label: "Collections" }), _jsx(Stat, { icon: "listNumber", value: counts.reading_lists, label: "Reading lists" }), settings.showSeries && _jsx(Stat, { icon: "layers", value: counts.series, label: "Series" })] })] }), _jsxs("div", { className: "collections-layout", children: [_jsx("div", { className: "collections-main", children: side === "series" && settings.showSeries ? (_jsx("section", { className: "collections-section", children: series.length === 0 ? (_jsx("div", { className: "library-empty collections-empty", children: q ? (_jsxs(_Fragment, { children: [_jsx("h2", { children: "Nothing matches" }), _jsxs("p", { className: "muted", children: ["No series match \u201C", filter.trim(), "\u201D."] })] })) : (_jsxs(_Fragment, { children: [_jsx("h2", { children: "No series yet" }), _jsx("p", { className: "muted", children: "Series appear here when your books say which series they belong to." })] })) })) : (_jsxs("ul", { className: `collection-cards collection-cards-${prefs.layout}`, children: [series.slice(0, seriesShown).map((s) => {
                                        const ref = { kind: "series", name: s.name };
                                        return (_jsx(SeriesCard, { series: s, layout: prefs.layout, selected: isSel(ref), onSelect: () => pick(ref), onOpen: () => onOpen(ref) }, s.name));
                                    }), series.length > seriesShown && _jsx("li", { ref: more, className: "collection-more", "aria-hidden": true })] })) })) : (_jsxs(_Fragment, { children: [overview.pinned.length > 0 && !q && (_jsx("section", { "aria-label": "Pinned", children: _jsx("ul", { className: "pinned-row", children: overview.pinned.map((c) => {
                                            const ref = { kind: "collection", id: c.id };
                                            return (_jsx(PinnedCard, { collection: c, selected: isSel(ref), menu: menuFor(c), onSelect: () => pick(ref), onOpen: () => onOpen(ref) }, c.id));
                                        }) }) })), !q && settings.showSmartCollections && (_jsxs("section", { className: "collections-section", children: [_jsxs("div", { className: "section-head section-head-tools", children: [_jsxs("button", { type: "button", className: "section-fold", "aria-expanded": !smartFolded, onClick: foldSmart, children: [_jsx("h2", { children: "Smart compendiums" }), _jsx(Icon, { name: smartFolded ? "chevronDown" : "chevronUp", size: 18 })] }), !smartFolded && _jsx(Menu, { label: "Sort smart compendiums", className: "toolbar-button", trigger: _jsxs(_Fragment, { children: [_jsx(Icon, { name: "sort", size: 16 }), " ", _jsx(Icon, { name: "chevronDown", size: 12 })] }), items: SMART_SORTS.map((s) => ({
                                                        label: s.label,
                                                        checked: prefs.smartSort === s.sort,
                                                        onSelect: () => changePrefs({ smartSort: s.sort }),
                                                    })) })] }), !smartFolded && _jsx("ul", { className: "smart-row", children: smart.map((s) => {
                                                const ref = { kind: "smart", smart: s.kind };
                                                return (_jsx(SmartCard, { smart: s, selected: isSel(ref), reorder: reorderSmart(s.kind), onSelect: () => pick(ref), onOpen: () => onOpen(ref) }, s.kind));
                                            }) })] })), _jsxs("section", { className: "collections-section", children: [_jsxs("div", { className: "section-head section-head-tools", children: [_jsx("h2", { children: "Your compendiums" }), _jsxs("button", { type: "button", className: "btn btn-primary btn-small", onClick: () => setEditing({ books: [] }), children: [_jsx(Icon, { name: "plus", size: 14 }), " New"] })] }), _jsxs("div", { className: "library-toolbar is-compact", children: [_jsx("div", { className: "scribe-chips", role: "tablist", "aria-label": "Kinds of collection", children: [
                                                        ["all", "All"],
                                                        ["collections", "Collections"],
                                                        ["reading_lists", "Reading lists"],
                                                    ].map(([value, label]) => (_jsx("button", { type: "button", role: "tab", "aria-selected": tab === value, className: `chip${tab === value ? " is-active" : ""}`, onClick: () => setTab(value), children: label }, value))) }), _jsxs("div", { className: "toolbar-controls", children: [_jsx(Menu, { label: "Sort collections", className: "toolbar-button", trigger: _jsxs(_Fragment, { children: [_jsx(Icon, { name: "sort", size: 16 }), " ", _jsx(Icon, { name: "chevronDown", size: 12 })] }), items: SORTS.map((s) => ({ label: s.label, checked: prefs.sort === s.sort, onSelect: () => changePrefs({ sort: s.sort }) })) }), _jsx("div", { className: "layout-switch", role: "radiogroup", "aria-label": "Layout", children: [
                                                                ["grid", "Cards", "grid"],
                                                                ["list", "List", "list"],
                                                            ].map(([value, label, icon]) => (_jsx("button", { type: "button", role: "radio", "aria-checked": prefs.layout === value, "aria-label": label, title: label, className: prefs.layout === value ? "is-active" : undefined, onClick: () => changePrefs({ layout: value }), children: _jsx(Icon, { name: icon, size: 16 }) }, value))) })] })] }), own.length === 0 && !kindleCard ? (_jsx("div", { className: "library-empty collections-empty", children: q ? (_jsxs(_Fragment, { children: [_jsx("h2", { children: "Nothing matches" }), _jsxs("p", { className: "muted", children: ["No collections match \u201C", filter.trim(), "\u201D."] })] })) : (_jsxs(_Fragment, { children: [_jsx("h2", { children: "No collections yet" }), _jsx("p", { className: "muted", children: "Group books your way: a reading list for winter, a shelf of comfort reads, a book club." }), _jsx("button", { type: "button", className: "btn btn-primary", onClick: () => setEditing({ books: [] }), children: "Make your first collection" })] })) })) : (_jsxs("ul", { className: `collection-cards collection-cards-${prefs.layout}`, children: [own.map((c) => {
                                                    const ref = { kind: "collection", id: c.id };
                                                    return (_jsx(CollectionCard, { collection: c, layout: prefs.layout, selected: isSel(ref), menu: menuFor(c), reorder: reorderOwn(c.id), onSelect: () => pick(ref), onOpen: () => onOpen(ref) }, c.id));
                                                }), kindleCard && _jsx(KindleCard, { summary: kindle, layout: prefs.layout, onOpen: () => setKindleOpen(true) }), !q && (_jsx("li", { className: "collection-card collection-card-new", children: _jsxs("button", { type: "button", className: "collection-card-open", onClick: () => setEditing({ books: [] }), children: [_jsx("span", { className: "new-plus", "aria-hidden": true, children: "+" }), _jsxs("span", { children: [_jsx("span", { className: "collection-card-name", children: "Create a new collection" }), _jsx("span", { className: "collection-card-meta", children: "Organize your library your way." })] })] }) }))] }))] })] })) }), selected && wide && (_jsx(CollectionPanel, { selected: selected, series: overview.series, refreshKey: refreshKey + reload, menuFor: detailMenu, onOpen: () => onOpen(selected), onOpenBook: onOpenBook }))] }), dialogs] }));
}
/** Wide enough for the side panel beside the collections (see collections.css). */
function useWide() {
    const query = "(min-width: 1201px)";
    const [wide, setWide] = useState(() => typeof matchMedia === "function" && matchMedia(query).matches);
    useEffect(() => {
        if (typeof matchMedia !== "function")
            return;
        const list = matchMedia(query);
        const change = () => setWide(list.matches);
        list.addEventListener("change", change);
        return () => list.removeEventListener("change", change);
    }, []);
    return wide;
}
const SERIES_AT_ONCE = 60;
/**
 * How many series cards to draw: a first lot, then more as the end comes
 * into view, so thousands of series (and their covers) don't all load at once.
 */
function useShownBit(total, resetKey) {
    const [shown, setShown] = useState(SERIES_AT_ONCE);
    // A callback ref, so a fresh end marker (back from a collection) is watched too.
    const [end, more] = useState(null);
    useEffect(() => setShown(SERIES_AT_ONCE), [resetKey]);
    useEffect(() => {
        if (!end || shown >= total || typeof IntersectionObserver !== "function")
            return;
        const watching = new IntersectionObserver((seen) => seen.some((e) => e.isIntersecting) && setShown((n) => n + SERIES_AT_ONCE), { rootMargin: "600px" });
        watching.observe(end);
        return () => watching.disconnect();
    }, [end, shown, total]);
    return { shown, more };
}

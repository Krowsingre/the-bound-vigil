export const PAGE_SIZE = 24;
export const NO_EXCLUDE = { formats: [], tags: [], genres: [], authors: [], narrators: [], series: [], languages: [] };
/** How many things are left out. */
export const excludeCount = (x) => Object.values(x).reduce((n, list) => n + list.length, 0);
/** Every filter off. */
export const NO_FILTERS = {
    formats: [],
    location: null,
    tags: [],
    genres: [],
    languages: [],
    downloadable: false,
    authors: [],
    series: [],
    narrators: [],
    hideRead: false,
    audioType: null,
    exclude: NO_EXCLUDE,
};
export const TABS = [
    { tab: "all", label: "All books" },
    { tab: "favorites", label: "Favourites" },
    { tab: "want_to_read", label: "Up next" },
    { tab: "send_to_device", label: "Sent to device" },
    { tab: "in_progress", label: "In progress" },
    { tab: "read", label: "Read" },
    { tab: "unread", label: "Unread" },
    { tab: "collections", label: "Collections" },
];
export const SORTS = [
    { sort: "recently_added", label: "Recently added" },
    { sort: "recently_opened", label: "Recently opened" },
    { sort: "title", label: "Title" },
    { sort: "author", label: "Author" },
    { sort: "series", label: "Series" },
    { sort: "progress", label: "Progress" },
    { sort: "rating", label: "Your rating" },
    { sort: "genre", label: "Genre" },
];
const KEY = "tbv.libraryView";
const keyOf = (kind) => (kind === "books" ? KEY : `tbv.${kind}View`);
/** Sort and layout are remembered on this device, for each page of books; the rest starts fresh. */
export function initialView(kind = "books") {
    const view = { tab: "all", sort: "recently_added", formats: [], location: null, tags: [], genres: [], languages: [], downloadable: false, authors: [], series: [], narrators: [], hideRead: false, exclude: NO_EXCLUDE, page: 0, layout: "grid", seriesGrouping: "individual" };
    try {
        const saved = JSON.parse(localStorage.getItem(keyOf(kind)) ?? "{}");
        if (SORTS.some((s) => s.sort === saved.sort))
            view.sort = saved.sort;
        if (saved.layout === "grid" || saved.layout === "list" || saved.layout === "compact")
            view.layout = saved.layout;
        if (kind !== "documents") {
            if (saved.layout === "series")
                view.seriesGrouping = "seriesFirst";
            else if (saved.seriesGrouping === "mixed" || saved.seriesGrouping === "seriesFirst")
                view.seriesGrouping = saved.seriesGrouping;
        }
        view.hideRead = saved.hideRead === true;
    }
    catch {
        /* fall back to defaults */
    }
    return view;
}
export function rememberView(view, kind = "books") {
    try {
        localStorage.setItem(keyOf(kind), JSON.stringify({ sort: view.sort, layout: view.layout, seriesGrouping: view.seriesGrouping, hideRead: view.hideRead }));
    }
    catch {
        /* the choice just won't be remembered */
    }
}
/** Page numbers to show, with null for a gap: 1 … 4 5 6 … 12. */
export function pageItems(current, count) {
    if (count <= 7)
        return Array.from({ length: count }, (_, i) => i);
    const keep = new Set([0, count - 1, current - 1, current, current + 1]);
    if (current <= 2)
        [1, 2, 3].forEach((p) => keep.add(p));
    if (current >= count - 3)
        [count - 4, count - 3, count - 2].forEach((p) => keep.add(p));
    const pages = [...keep].filter((p) => p >= 0 && p < count).sort((a, b) => a - b);
    const items = [];
    pages.forEach((p, i) => {
        if (i > 0 && p - pages[i - 1] > 1)
            items.push(null);
        items.push(p);
    });
    return items;
}

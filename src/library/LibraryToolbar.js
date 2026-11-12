import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState } from "react";
import { phoneChoiceShown } from "../home/bookActions";
import { Icon } from "../components/Icon";
import { Menu } from "../components/Menu";
import { formatLabel } from "../lib/queryBooks";
import { languageName } from "../lib/language";
import { excludeCount, NO_FILTERS, SORTS, TABS } from "./libraryView";
const COUNT_OF = {
    all: "all",
    favorites: "favorites",
    want_to_read: "wantToRead",
    send_to_device: "sendToDevice",
    in_progress: "inProgress",
    read: "read",
    unread: "unread",
    collections: "collections",
};
const LAYOUTS = [
    { layout: "grid", label: "Covers", icon: "grid" },
    { layout: "list", label: "List", icon: "list" },
    { layout: "compact", label: "Compact list", icon: "rows" },
];
const GROUPING = [
    { value: "individual", label: "Individual books" },
    { value: "mixed", label: "Stacked and mixed" },
    { value: "seriesFirst", label: "Stacked, series first" },
];
const OPENED_KEY = "tbv.filters.opened";
function readOpened() {
    try {
        const names = JSON.parse(localStorage.getItem(OPENED_KEY) ?? "[]");
        return new Set(names.map((name) => name === "Collections" ? "Shelf" : name));
    }
    catch {
        return new Set();
    }
}
export function LibraryToolbar({ view, counts, formats, tags, genres, languages = [], authors = [], narrators = [], allLabel, allowSeries = false, seriesNames = [], paired = null, onPairing, continuous = false, onContinuous, selecting, onSelecting, onSelectAll, onChange, }) {
    const sortLabel = SORTS.find((s) => s.sort === view.sort)?.label;
    // The shelves are chosen in Filter, under Collections, leaving one row of icons.
    const tabName = (tab) => (tab === "all" && allLabel ? allLabel : (TABS.find((t) => t.tab === tab)?.label ?? ""));
    // Filter's groups start folded; the ones opened stay open next time.
    const [opened, setOpened] = useState(readOpened);
    const [mode, setMode] = useState("include");
    const [find, setFind] = useState({ series: "", tags: "" });
    const fold = (name) => {
        const next = new Set(opened);
        if (next.has(name))
            next.delete(name);
        else
            next.add(name);
        setOpened(next);
        try {
            localStorage.setItem(OPENED_KEY, JSON.stringify([...next]));
        }
        catch {
            // Remembering is only a convenience.
        }
    };
    /** A group of the filter menu, under a heading that folds it away. */
    const group = (name, on, entries) => entries.length
        ? [
            "divider",
            {
                heading: (_jsxs("button", { type: "button", className: "menu-fold", "aria-expanded": opened.has(name), onClick: () => fold(name), children: [_jsx("strong", { children: name }), on > 0 && _jsx("span", { className: "tab-count num", children: on }), _jsx(Icon, { name: opened.has(name) ? "chevronUp" : "chevronDown", size: 14 })] })),
            },
            ...(opened.has(name) ? entries : []),
        ]
        : [];
    const onIn = (list) => view[list].length + view.exclude[list].length;
    const filterCount = view.formats.length +
        (view.location ? 1 : 0) +
        view.tags.length +
        view.genres.length +
        view.languages.length +
        view.authors.length +
        view.series.length +
        view.narrators.length +
        (view.hideRead ? 1 : 0) +
        (paired === null ? 0 : 1) +
        excludeCount(view.exclude);
    const toggleValue = (list, value) => {
        const included = view[list];
        const excluded = view.exclude[list];
        const without = (values) => values.filter((item) => item !== value);
        onChange({
            [list]: mode === "include" && !included.includes(value) ? [...included, value] : without(included),
            exclude: { ...view.exclude, [list]: mode === "exclude" && !excluded.includes(value) ? [...excluded, value] : without(excluded) },
            page: 0,
        });
    };
    const item = (list, value, label) => ({
        label,
        checked: view[list].includes(value),
        excluded: view.exclude[list].includes(value),
        onSelect: () => toggleValue(list, value),
    });
    const all = (list, known) => [...new Set([...known, ...view[list], ...view.exclude[list]])];
    const names = (list, heading, known) => group(heading, onIn(list), all(list, known).map((name) => item(list, name, name)));
    const searchable = (list, heading, known) => {
        const values = all(list, known);
        if (!values.length)
            return [];
        return group(heading, onIn(list), [
            { heading: _jsx("input", { type: "search", "aria-label": `Find ${heading.toLowerCase()}`, placeholder: `Find ${heading.toLowerCase()}…`, value: find[list], onChange: (event) => setFind({ ...find, [list]: event.target.value }) }) },
            ...values.filter((value) => value.toLowerCase().includes(find[list].trim().toLowerCase()))
                .map((value) => item(list, value, value)),
        ]);
    };
    // A shelf is chosen in Filter, so it counts there too.
    const filterBadge = filterCount + (view.tab !== "all" ? 1 : 0);
    const clearFilters = () => {
        onPairing?.(null);
        onChange({ ...NO_FILTERS, audioType: view.audioType, tab: "all", page: 0 });
    };
    // Put quick filters first, then shelves and metadata filters.
    const filterItems = [
        { label: "Hide finished books", checked: view.hideRead, onSelect: () => onChange({ hideRead: !view.hideRead, page: 0 }) },
        { label: "On this device", checked: view.location === "on_device", onSelect: () => onChange({ location: view.location === "on_device" ? null : "on_device" }) },
        ...(onPairing ? [
            { label: "Pairing", hint: paired === null ? "All" : paired ? "Paired" : "Unpaired", submenu: [
                    { label: "All", checked: paired === null, onSelect: () => onPairing(null) },
                    { label: "Paired", checked: paired === true, onSelect: () => onPairing(true) },
                    { label: "Unpaired", checked: paired === false, onSelect: () => onPairing(false) },
                ] },
        ] : []),
        "divider",
        ...(filterBadge ? [{ label: "Clear filters", icon: "close", onSelect: clearFilters }] : []),
        ...(filterBadge ? [{ heading: _jsx("span", { className: "menu-tip", children: [view.tab !== "all" ? tabName(view.tab) : "", view.hideRead ? "Hide finished" : "",
                        view.location ? "On this device" : "", paired !== null ? paired ? "Paired" : "Unpaired" : "",
                        ...["series", "tags", "genres", "formats", "languages", "authors", "narrators"]
                            .flatMap((key) => [...view[key], ...view.exclude[key].map((value) => `Exclude ${value}`)])].filter(Boolean).join(" · ") }) }] : []),
        ...group("Shelf", view.tab === "all" ? 0 : 1, TABS.filter(({ tab }) => tab !== "send_to_device" || phoneChoiceShown()).map(({ tab }) => ({
            label: tabName(tab),
            hint: counts?.[COUNT_OF[tab]] !== undefined ? String(counts[COUNT_OF[tab]]) : undefined,
            checked: view.tab === tab,
            onSelect: () => onChange({ tab }),
        }))),
        "divider",
        { heading: _jsxs("div", { className: "menu-tip", role: "group", "aria-label": "Filter selection", children: [_jsx("button", { type: "button", className: "btn btn-quiet btn-small", "aria-pressed": mode === "include", onClick: () => setMode("include"), children: "Include" }), _jsx("button", { type: "button", className: "btn btn-quiet btn-small", "aria-pressed": mode === "exclude", onClick: () => setMode("exclude"), children: "Exclude" })] }) },
        ...searchable("series", "Series", seriesNames),
        ...searchable("tags", "Tags", tags),
        ...group("More filters", onIn("genres") + onIn("languages") + onIn("formats") + onIn("authors") + onIn("narrators"), [
            ...group("Genres", onIn("genres"), all("genres", genres).map((g) => item("genres", g, g))),
            ...group("Language", onIn("languages"), all("languages", languages)
                .map((code) => ({ code, name: languageName(code) })).sort((a, b) => a.name.localeCompare(b.name))
                .map(({ code, name }) => item("languages", code, name))),
            ...group("Format", onIn("formats"), all("formats", formats).map((f) => item("formats", f, formatLabel(f)))),
            ...names("authors", "Authors", authors),
            ...names("narrators", "Narrators", narrators),
        ]),
    ];
    return (_jsx("div", { className: "library-toolbar is-compact", children: _jsxs("div", { className: "toolbar-controls", children: [view.tab !== "collections" && (_jsx(Menu, { label: `Sort by ${sortLabel}`, className: "toolbar-button", trigger: _jsxs(_Fragment, { children: [_jsx(Icon, { name: "sort", size: 16, className: "toolbar-icon" }), _jsx(Icon, { name: "chevronDown", size: 12, className: "toolbar-chevron" })] }), items: [
                        ...SORTS.slice(0, 5).map((entry) => ({
                            label: entry.label, checked: entry.sort === view.sort, onSelect: () => onChange({ sort: entry.sort }),
                        })),
                        { label: "More sort options", hint: SORTS.slice(5).some((entry) => entry.sort === view.sort) ? sortLabel : undefined,
                            submenu: SORTS.slice(5).map((entry) => ({
                                label: entry.label, checked: entry.sort === view.sort, onSelect: () => onChange({ sort: entry.sort }),
                            })) },
                    ] })), _jsx(Menu, { label: "Filter", className: `toolbar-button${filterBadge ? " is-on" : ""}`, trigger: _jsxs(_Fragment, { children: [_jsx(Icon, { name: "filter", size: 16 }), filterBadge > 0 && _jsx("span", { className: "tab-count num", children: filterBadge }), _jsx(Icon, { name: "chevronDown", size: 12, className: "toolbar-chevron" })] }), items: filterItems }), view.tab === "collections" && _jsx("span", { className: "tabs-menu", children: tabName(view.tab) }), view.tab !== "collections" && (_jsxs(_Fragment, { children: [_jsx(Menu, { label: "Select", className: `toolbar-button${selecting ? " is-on" : ""}`, trigger: _jsxs(_Fragment, { children: [_jsx(Icon, { name: "check", size: 16 }), _jsx(Icon, { name: "chevronDown", size: 12, className: "toolbar-chevron" })] }), items: [
                                selecting
                                    ? { label: "Done choosing", onSelect: () => onSelecting(false) }
                                    : { label: "Choose books", onSelect: () => onSelecting(true) },
                                ...(onSelectAll ? [{ label: "Choose everything shown", onSelect: onSelectAll }] : []),
                            ] }), _jsx("span", { className: "toolbar-divider", "aria-hidden": true }), (view.tab !== "all" || view.location === "on_device") && (_jsxs("span", { className: "tabs-menu", children: [tabName(view.tab), view.location === "on_device" && " · Downloaded"] })), onContinuous && (_jsx(Menu, { label: continuous ? "Browsing mode: Continuous scroll" : "Browsing mode: Paged", className: "toolbar-button", trigger: _jsxs(_Fragment, { children: [_jsx(Icon, { name: "rows", size: 16 }), _jsx(Icon, { name: "chevronDown", size: 12, className: "toolbar-chevron" })] }), items: [
                                { label: "Paged", checked: !continuous, onSelect: () => onContinuous(false) },
                                { label: "Continuous scroll", checked: continuous, onSelect: () => onContinuous(true) },
                            ] })), allowSeries && _jsx(Menu, { label: `Series: ${GROUPING.find((item) => item.value === view.seriesGrouping)?.label}`, className: "toolbar-button", trigger: _jsxs(_Fragment, { children: [_jsx(Icon, { name: "bookOpen", size: 16 }), " Series ", _jsx(Icon, { name: "chevronDown", size: 12, className: "toolbar-chevron" })] }), items: GROUPING.map(({ value, label }) => ({ label, checked: view.seriesGrouping === value,
                                onSelect: () => onChange({ seriesGrouping: value, page: 0 }) })) }), _jsx("div", { className: "layout-switch", role: "radiogroup", "aria-label": "Layout", children: LAYOUTS.map((l) => (_jsx("button", { type: "button", "data-layout": l.layout, role: "radio", "aria-checked": view.layout === l.layout, "aria-label": l.label, title: l.label, className: view.layout === l.layout ? "is-active" : undefined, onClick: () => onChange({ layout: l.layout, page: 0 }), children: _jsx(Icon, { name: l.icon, size: 18 }) }, l.layout))) })] }))] }) }));
}

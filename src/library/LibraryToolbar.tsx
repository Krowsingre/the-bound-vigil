import { useState } from "react";
import { phoneChoiceShown } from "../home/bookActions";
import type { ShelfCounts } from "../api/types";
import { Icon } from "../components/Icon";
import { Menu, type MenuEntry } from "../components/Menu";
import { formatLabel } from "../lib/queryBooks";
import { languageName } from "../lib/language";
import { excludeCount, NO_FILTERS, SORTS, TABS, type Layout, type LibraryTab, type LibraryView } from "./libraryView";

type FilterList = "formats" | "tags" | "genres" | "languages" | "authors" | "series" | "narrators";

const COUNT_OF: Record<LibraryTab, keyof ShelfCounts> = {
  all: "all",
  favorites: "favorites",
  want_to_read: "wantToRead",
  send_to_device: "sendToDevice",
  in_progress: "inProgress",
  read: "read",
  unread: "unread",
  collections: "collections",
};

const LAYOUTS: { layout: Layout; label: string; icon: "grid" | "list" | "rows" | "bookOpen" }[] = [
  { layout: "grid", label: "Covers", icon: "grid" },
  { layout: "series", label: "Series stacks", icon: "bookOpen" },
  { layout: "list", label: "List", icon: "list" },
  { layout: "compact", label: "Compact list", icon: "rows" },
];

const OPENED_KEY = "tbv.filters.opened";

function readOpened(): Set<string> {
  try {
    const names = JSON.parse(localStorage.getItem(OPENED_KEY) ?? "[]") as string[];
    return new Set(names.map((name) => name === "Collections" ? "Shelf" : name));
  } catch {
    return new Set();
  }
}

export function LibraryToolbar({
  view,
  counts,
  formats,
  tags,
  genres,
  languages = [],
  authors = [],
  narrators = [],
  allLabel,
  allowSeries = false,
  seriesNames = [],
  paired = null,
  onPairing,
  continuous = false,
  onContinuous,
  selecting,
  onSelecting,
  onSelectAll,
  onChange,
}: {
  view: LibraryView;
  counts: ShelfCounts | null;
  formats: string[];
  tags: string[];
  genres: string[];
  /** Languages the books are in, as short codes. */
  languages?: string[];
  /** Audiobooks only: who wrote and who reads them. */
  authors?: string[];
  narrators?: string[];
  /** The first tab's name, when it isn't "All books". */
  allLabel?: string;
  allowSeries?: boolean;
  seriesNames?: string[];
  paired?: boolean | null;
  onPairing?: (value: boolean | null) => void;
  continuous?: boolean;
  onContinuous?: (enabled: boolean) => void;
  selecting: boolean;
  onSelecting: (on: boolean) => void;
  /** Starts choosing with every book the page shows already chosen. */
  onSelectAll?: () => void;
  onChange: (change: Partial<LibraryView>) => void;
}) {
  const sortLabel = SORTS.find((s) => s.sort === view.sort)?.label;
  // The shelves are chosen in Filter, under Collections, leaving one row of icons.
  const tabName = (tab: LibraryTab) => (tab === "all" && allLabel ? allLabel : (TABS.find((t) => t.tab === tab)?.label ?? ""));
  // Filter's groups start folded; the ones opened stay open next time.
  const [opened, setOpened] = useState(readOpened);
  const [mode, setMode] = useState<"include" | "exclude">("include");
  const [find, setFind] = useState({ series: "", tags: "" });
  const fold = (name: string) => {
    const next = new Set(opened);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setOpened(next);
    try {
      localStorage.setItem(OPENED_KEY, JSON.stringify([...next]));
    } catch {
      // Remembering is only a convenience.
    }
  };
  /** A group of the filter menu, under a heading that folds it away. */
  const group = (name: string, on: number, entries: MenuEntry[]): MenuEntry[] =>
    entries.length
      ? [
          "divider",
          {
            heading: (
              <button type="button" className="menu-fold" aria-expanded={opened.has(name)} onClick={() => fold(name)}>
                <strong>{name}</strong>
                {on > 0 && <span className="tab-count num">{on}</span>}
                <Icon name={opened.has(name) ? "chevronUp" : "chevronDown"} size={14} />
              </button>
            ),
          },
          ...(opened.has(name) ? entries : []),
        ]
      : [];
  const onIn = (list: FilterList) => view[list].length + view.exclude[list].length;
  const filterCount =
    view.formats.length +
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
  const toggleValue = (list: FilterList, value: string) => {
    const included = view[list];
    const excluded = view.exclude[list];
    const without = (values: string[]) => values.filter((item) => item !== value);
    onChange({
      [list]: mode === "include" && !included.includes(value) ? [...included, value] : without(included),
      exclude: { ...view.exclude, [list]: mode === "exclude" && !excluded.includes(value) ? [...excluded, value] : without(excluded) },
      page: 0,
    });
  };
  const item = (list: FilterList, value: string, label: string): MenuEntry => ({
    label,
    checked: view[list].includes(value),
    excluded: view.exclude[list].includes(value),
    onSelect: () => toggleValue(list, value),
  });
  const all = (list: FilterList, known: string[]) => [...new Set([...known, ...view[list], ...view.exclude[list]])];
  const names = (list: "authors" | "narrators", heading: string, known: string[]): MenuEntry[] =>
    group(heading, onIn(list), all(list, known).map((name) => item(list, name, name)));
  const searchable = (list: "series" | "tags", heading: string, known: string[]): MenuEntry[] => {
    const values = all(list, known);
    if (!values.length) return [];
    return group(heading, onIn(list), [
      { heading: <input type="search" aria-label={`Find ${heading.toLowerCase()}`} placeholder={`Find ${heading.toLowerCase()}…`}
        value={find[list]} onChange={(event) => setFind({ ...find, [list]: event.target.value })} /> },
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
  const filterItems: MenuEntry[] = [
    { label: "Hide finished books", checked: view.hideRead, onSelect: () => onChange({ hideRead: !view.hideRead, page: 0 }) },
    { label: "On this device", checked: view.location === "on_device", onSelect: () => onChange({ location: view.location === "on_device" ? null : "on_device" }) },
    ...(onPairing ? ([
      { label: "Pairing", hint: paired === null ? "All" : paired ? "Paired" : "Unpaired", submenu: [
        { label: "All", checked: paired === null, onSelect: () => onPairing(null) },
        { label: "Paired", checked: paired === true, onSelect: () => onPairing(true) },
        { label: "Unpaired", checked: paired === false, onSelect: () => onPairing(false) },
      ] },
    ] as MenuEntry[]) : []),
    "divider",
    ...(filterBadge ? [{ label: "Clear filters", icon: "close", onSelect: clearFilters } as MenuEntry] : []),
    ...(filterBadge ? [{ heading: <span className="menu-tip">
      {[view.tab !== "all" ? tabName(view.tab) : "", view.hideRead ? "Hide finished" : "",
        view.location ? "On this device" : "", paired !== null ? paired ? "Paired" : "Unpaired" : "",
        ...(["series", "tags", "genres", "formats", "languages", "authors", "narrators"] as const)
          .flatMap((key) => [...view[key], ...view.exclude[key].map((value) => `Exclude ${value}`)])].filter(Boolean).join(" · ")}
    </span> } as MenuEntry] : []),
    ...group(
      "Shelf",
      view.tab === "all" ? 0 : 1,
      TABS.filter(({ tab }) => tab !== "send_to_device" || phoneChoiceShown()).map(({ tab }) => ({
        label: tabName(tab),
        hint: counts?.[COUNT_OF[tab]] !== undefined ? String(counts[COUNT_OF[tab]]) : undefined,
        checked: view.tab === tab,
        onSelect: () => onChange({ tab }),
      })),
    ),
    "divider",
    { heading: <div className="menu-tip" role="group" aria-label="Filter selection">
      <button type="button" className="btn btn-quiet btn-small" aria-pressed={mode === "include"} onClick={() => setMode("include")}>Include</button>
      <button type="button" className="btn btn-quiet btn-small" aria-pressed={mode === "exclude"} onClick={() => setMode("exclude")}>Exclude</button>
    </div> },
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

  return (
    <div className="library-toolbar is-compact">
      <div className="toolbar-controls">
        {view.tab !== "collections" && (
          <Menu
            label={`Sort by ${sortLabel}`}
            className="toolbar-button"
            trigger={
              <>
                <Icon name="sort" size={16} className="toolbar-icon" />
                <Icon name="chevronDown" size={12} className="toolbar-chevron" />
              </>
            }
            items={[
              ...SORTS.slice(0, 5).map((entry) => ({
                label: entry.label, checked: entry.sort === view.sort, onSelect: () => onChange({ sort: entry.sort }),
              })),
              { label: "More sort options", hint: SORTS.slice(5).some((entry) => entry.sort === view.sort) ? sortLabel : undefined,
                submenu: SORTS.slice(5).map((entry) => ({
                  label: entry.label, checked: entry.sort === view.sort, onSelect: () => onChange({ sort: entry.sort }),
                })) },
            ]}
          />
        )}
        <Menu
          label="Filter"
          className={`toolbar-button${filterBadge ? " is-on" : ""}`}
          trigger={
            <>
              <Icon name="filter" size={16} />
              {filterBadge > 0 && <span className="tab-count num">{filterBadge}</span>}
              <Icon name="chevronDown" size={12} className="toolbar-chevron" />
            </>
          }
          items={filterItems}
        />
        {view.tab === "collections" && <span className="tabs-menu">{tabName(view.tab)}</span>}
        {view.tab !== "collections" && (
          <>
            <Menu
              label="Select"
              className={`toolbar-button${selecting ? " is-on" : ""}`}
              trigger={
                <>
                  <Icon name="check" size={16} />
                  <Icon name="chevronDown" size={12} className="toolbar-chevron" />
                </>
              }
              items={[
                selecting
                  ? { label: "Done choosing", onSelect: () => onSelecting(false) }
                  : { label: "Choose books", onSelect: () => onSelecting(true) },
                ...(onSelectAll ? [{ label: "Choose everything shown", onSelect: onSelectAll }] : []),
              ]}
            />
            <span className="toolbar-divider" aria-hidden />
            {/* A shelf other than everything is named here; it's chosen in Filter. */}
            {(view.tab !== "all" || view.location === "on_device") && (
              <span className="tabs-menu">
                {tabName(view.tab)}
                {view.location === "on_device" && " · Downloaded"}
              </span>
            )}
            {onContinuous && (
              <Menu
                label={continuous ? "Browsing mode: Continuous scroll" : "Browsing mode: Paged"}
                className="toolbar-button"
                trigger={<><Icon name="rows" size={16} /><Icon name="chevronDown" size={12} className="toolbar-chevron" /></>}
                items={[
                  { label: "Paged", checked: !continuous, onSelect: () => onContinuous(false) },
                  { label: "Continuous scroll", checked: continuous, onSelect: () => onContinuous(true) },
                ]}
              />
            )}
            <div className="layout-switch" role="radiogroup" aria-label="Layout">
              {LAYOUTS.filter((l) => allowSeries || l.layout !== "series").map((l) => (
                <button
                  key={l.layout}
                  type="button"
                  data-layout={l.layout}
                  role="radio"
                  aria-checked={view.layout === l.layout}
                  aria-label={l.label}
                  title={l.label}
                  className={view.layout === l.layout ? "is-active" : undefined}
                  onClick={() => onChange({ layout: l.layout, page: 0 })}
                >
                  <Icon name={l.icon} size={18} />
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

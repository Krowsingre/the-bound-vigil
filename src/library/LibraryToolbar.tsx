import { useState } from "react";
import type { Location, ShelfCounts } from "../api/types";
import { Icon } from "../components/Icon";
import { Menu, type MenuEntry } from "../components/Menu";
import { formatLabel } from "../lib/queryBooks";
import { languageName } from "../lib/language";
import { useNarrow } from "../lib/useNarrow";
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

const LAYOUTS: { layout: Layout; label: string; icon: "grid" | "list" | "rows" }[] = [
  { layout: "grid", label: "Covers", icon: "grid" },
  { layout: "list", label: "List", icon: "list" },
  { layout: "compact", label: "Compact list", icon: "rows" },
];

const OPENED_KEY = "tbv.filters.opened";

function readOpened(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(OPENED_KEY) ?? "[]") as string[]);
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
  selecting,
  onSelecting,
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
  selecting: boolean;
  onSelecting: (on: boolean) => void;
  onChange: (change: Partial<LibraryView>) => void;
}) {
  const sortLabel = SORTS.find((s) => s.sort === view.sort)?.label;
  // On a phone the shelves don't fit in a row, so they're in Filter, under Collections.
  const narrow = useNarrow();
  const tabName = (tab: LibraryTab) => (tab === "all" && allLabel ? allLabel : (TABS.find((t) => t.tab === tab)?.label ?? ""));
  // Filter's groups start folded; the ones opened stay open next time.
  const [opened, setOpened] = useState(readOpened);
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
    excludeCount(view.exclude);
  // Each click moves a filter on: show only these, then leave these out, then off.
  const cycle = (list: FilterList, value: string) => {
    const shown = view[list].includes(value);
    const hidden = view.exclude[list].includes(value);
    const without = (l: string[]) => l.filter((x) => x !== value);
    onChange({
      [list]: shown ? without(view[list]) : hidden ? view[list] : [...view[list], value],
      exclude: { ...view.exclude, [list]: shown ? [...view.exclude[list], value] : without(view.exclude[list]) },
      page: 0,
    });
  };
  const item = (list: FilterList, value: string, label: string): MenuEntry => ({
    label,
    checked: view[list].includes(value),
    excluded: view.exclude[list].includes(value),
    onSelect: () => cycle(list, value),
  });
  const all = (list: FilterList, known: string[]) => [...new Set([...known, ...view[list], ...view.exclude[list]])];
  const names = (list: "authors" | "series" | "narrators", heading: string, known: string[]): MenuEntry[] =>
    group(
      heading,
      onIn(list),
      all(list, known).map((n) => item(list, n, n)),
    );
  // On a phone a shelf is chosen in Filter, so it counts there too.
  const filterBadge = filterCount + (narrow && view.tab !== "all" ? 1 : 0);
  const setLocation = (l: Location) => onChange({ location: view.location === l ? null : l });

  // Clear filters, then where the file is, the shelves (phone), genre and
  // language, then the rest.
  const filterItems: MenuEntry[] = [
    ...(filterCount ? ([{ label: "Clear filters", icon: "close", onSelect: () => onChange(NO_FILTERS) }] as MenuEntry[]) : []),
    { heading: <span className="menu-tip">Click once to show only those, twice to hide them.</span> },
    ...group("Location", view.location ? 1 : 0, [
      { label: "Downloaded", checked: view.location === "on_device", onSelect: () => setLocation("on_device") },
      { label: "Not downloaded", checked: view.location === "cloud_only", onSelect: () => setLocation("cloud_only") },
    ]),
    ...(narrow
      ? group(
          "Collections",
          view.tab === "all" ? 0 : 1,
          TABS.map(({ tab }) => ({
            label: tabName(tab),
            hint: counts?.[COUNT_OF[tab]] !== undefined ? String(counts[COUNT_OF[tab]]) : undefined,
            checked: view.tab === tab,
            onSelect: () => onChange({ tab }),
          })),
        )
      : []),
    ...group(
      "Genres",
      onIn("genres"),
      all("genres", genres).map((g) => item("genres", g, g)),
    ),
    ...(languages.length > 1 || view.languages.length || view.exclude.languages.length
      ? group(
          "Language",
          onIn("languages"),
          all("languages", languages)
            .map((l) => ({ code: l, name: languageName(l) }))
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(({ code, name }) => item("languages", code, name)),
        )
      : []),
    ...group(
      "Format",
      onIn("formats"),
      all("formats", formats).map((f) => item("formats", f, formatLabel(f))),
    ),
    ...group(
      "Tags",
      onIn("tags"),
      all("tags", tags).map((t) => item("tags", t, t)),
    ),
    ...names("authors", "Authors", authors),
    ...names("series", "Series", []),
    ...names("narrators", "Narrators", narrators),
    "divider",
    { label: "Hide finished books", checked: view.hideRead, onSelect: () => onChange({ hideRead: !view.hideRead, page: 0 }) },
  ];

  return (
    <div className="library-toolbar">
      <div className="tabs" role="tablist" aria-label="Shelves">
        {TABS.map(({ tab, label }) => {
          const count = counts?.[COUNT_OF[tab]];
          return (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={view.tab === tab}
              className={`tab${view.tab === tab ? " is-active" : ""}`}
              onClick={() => onChange({ tab })}
            >
              {tab === "all" && allLabel ? allLabel : label}
              {count !== undefined && <span className="tab-count num">{count}</span>}
            </button>
          );
        })}
      </div>
      {/* On a phone the shelf is only named here; it's chosen in Filter. */}
      <span className="tabs-menu">
        {tabName(view.tab)}
        {view.location === "on_device" && view.tab !== "collections" && " · Downloaded"}
      </span>

      {(view.tab !== "collections" || narrow) && (
        <div className="toolbar-controls">
          {view.tab !== "collections" && (
            <Menu
              label={`Sort by ${sortLabel}`}
              className="toolbar-button"
              trigger={
                <>
                  <Icon name="sort" size={16} className="toolbar-icon" />
                  <span className="toolbar-label">
                    <span className="muted">Sort:</span> {sortLabel} <Icon name="chevronDown" size={14} />
                  </span>
                </>
              }
              items={SORTS.map((s) => ({
                label: s.label,
                checked: s.sort === view.sort,
                onSelect: () => onChange({ sort: s.sort }),
              }))}
            />
          )}
          <Menu
            label="Filter"
            className={`toolbar-button${filterBadge ? " is-on" : ""}`}
            trigger={
              <>
                <Icon name="filter" size={16} /> <span className="toolbar-label">Filter</span>
                {filterBadge > 0 && <span className="tab-count num">{filterBadge}</span>}
                <Icon name="chevronDown" size={14} className="toolbar-label" />
              </>
            }
            items={filterItems}
          />
          {view.tab !== "collections" && (
            <>
              <button
                type="button"
                className={`toolbar-button${selecting ? " is-on" : ""}`}
                aria-pressed={selecting}
                title="Choose books to change many at once"
                onClick={() => onSelecting(!selecting)}
              >
                <Icon name="check" size={16} /> <span className="toolbar-label">Select</span>
              </button>
              <div className="layout-switch" role="radiogroup" aria-label="Layout">
                {LAYOUTS.map((l) => (
                  <button
                    key={l.layout}
                    type="button"
                    data-layout={l.layout}
                    role="radio"
                    aria-checked={view.layout === l.layout}
                    aria-label={l.label}
                    title={l.label}
                    className={view.layout === l.layout ? "is-active" : undefined}
                    onClick={() => onChange({ layout: l.layout })}
                  >
                    <Icon name={l.icon} size={18} />
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

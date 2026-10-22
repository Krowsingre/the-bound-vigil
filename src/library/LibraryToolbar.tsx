import type { Location, ShelfCounts } from "../api/types";
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

const LAYOUTS: { layout: Layout; label: string; icon: "grid" | "list" | "rows" }[] = [
  { layout: "grid", label: "Covers", icon: "grid" },
  { layout: "list", label: "List", icon: "list" },
  { layout: "compact", label: "Compact list", icon: "rows" },
];

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
    all(list, known).length
      ? ["divider", { heading: <strong>{heading}</strong> }, ...all(list, known).map((n) => item(list, n, n))]
      : [];
  const setLocation = (l: Location) => onChange({ location: view.location === l ? null : l });

  const filterItems: MenuEntry[] = [
    ...(filterCount ? ([{ label: "Clear filters", icon: "close", onSelect: () => onChange(NO_FILTERS) }, "divider"] as MenuEntry[]) : []),
    { label: "Hide finished books", checked: view.hideRead, onSelect: () => onChange({ hideRead: !view.hideRead, page: 0 }) },
    "divider",
    { heading: <span className="menu-tip">Click once to show only those, twice to hide them.</span> },
    { heading: <strong>Format</strong> },
    ...all("formats", formats).map((f) => item("formats", f, formatLabel(f))),
    "divider",
    { heading: <strong>Where the file is</strong> },
    { label: "On this device", checked: view.location === "on_device", onSelect: () => setLocation("on_device") },
    { label: "In the cloud only", checked: view.location === "cloud_only", onSelect: () => setLocation("cloud_only") },
    ...(all("tags", tags).length
      ? (["divider", { heading: <strong>Tags</strong> }, ...all("tags", tags).map((t) => item("tags", t, t))] as MenuEntry[])
      : []),
    ...(all("genres", genres).length
      ? (["divider", { heading: <strong>Genres</strong> }, ...all("genres", genres).map((g) => item("genres", g, g))] as MenuEntry[])
      : []),
    ...(languages.length > 1 || view.languages.length || view.exclude.languages.length
      ? ([
          "divider",
          { heading: <strong>Language</strong> },
          ...all("languages", languages)
            .map((l) => ({ code: l, name: languageName(l) }))
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(({ code, name }) => item("languages", code, name)),
        ] as MenuEntry[])
      : []),
    ...names("authors", "Authors", authors),
    ...names("series", "Series", []),
    ...names("narrators", "Narrators", narrators),
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

      {view.tab !== "collections" && (
        <div className="toolbar-controls">
          <Menu
            label={`Sort by ${sortLabel}`}
            className="toolbar-button"
            trigger={
              <>
                <span className="muted">Sort:</span> {sortLabel} <Icon name="chevronDown" size={14} />
              </>
            }
            items={SORTS.map((s) => ({ label: s.label, checked: s.sort === view.sort, onSelect: () => onChange({ sort: s.sort }) }))}
          />
          <Menu
            label="Filter"
            className={`toolbar-button${filterCount ? " is-on" : ""}`}
            trigger={
              <>
                <Icon name="filter" size={16} /> Filter
                {filterCount > 0 && <span className="tab-count num">{filterCount}</span>}
                <Icon name="chevronDown" size={14} />
              </>
            }
            items={filterItems}
          />
          <button
            type="button"
            className={`toolbar-button${selecting ? " is-on" : ""}`}
            aria-pressed={selecting}
            title="Choose books to change many at once"
            onClick={() => onSelecting(!selecting)}
          >
            <Icon name="check" size={16} /> Select
          </button>
          <div className="layout-switch" role="radiogroup" aria-label="Layout">
            {LAYOUTS.map((l) => (
              <button
                key={l.layout}
                type="button"
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
        </div>
      )}
    </div>
  );
}

import type { Location, ShelfCounts } from "../api/types";
import { Icon } from "../components/Icon";
import { Menu, type MenuEntry } from "../components/Menu";
import { formatLabel } from "../lib/queryBooks";
import { SORTS, TABS, type Layout, type LibraryTab, type LibraryView } from "./libraryView";

const COUNT_OF: Record<LibraryTab, keyof ShelfCounts> = {
  all: "all",
  favorites: "favorites",
  want_to_read: "wantToRead",
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
    view.formats.length + (view.location ? 1 : 0) + view.tags.length + view.genres.length + view.authors.length + view.narrators.length;
  const toggle = (list: "authors" | "narrators", name: string) =>
    onChange({ [list]: view[list].includes(name) ? view[list].filter((x) => x !== name) : [...view[list], name] });
  const names = (list: "authors" | "narrators", heading: string, known: string[]): MenuEntry[] =>
    known.length || view[list].length
      ? [
          "divider",
          { heading: <strong>{heading}</strong> },
          ...[...new Set([...known, ...view[list]])].map((n) => ({ label: n, checked: view[list].includes(n), onSelect: () => toggle(list, n) })),
        ]
      : [];
  const toggleGenre = (g: string) =>
    onChange({ genres: view.genres.includes(g) ? view.genres.filter((x) => x !== g) : [...view.genres, g] });
  const toggleTag = (t: string) => onChange({ tags: view.tags.includes(t) ? view.tags.filter((x) => x !== t) : [...view.tags, t] });
  const toggleFormat = (f: string) =>
    onChange({ formats: view.formats.includes(f) ? view.formats.filter((x) => x !== f) : [...view.formats, f] });
  const setLocation = (l: Location) => onChange({ location: view.location === l ? null : l });

  const filterItems: MenuEntry[] = [
    { heading: <strong>Format</strong> },
    ...formats.map((f) => ({ label: formatLabel(f), checked: view.formats.includes(f), onSelect: () => toggleFormat(f) })),
    "divider",
    { heading: <strong>Where the file is</strong> },
    { label: "On this device", checked: view.location === "on_device", onSelect: () => setLocation("on_device") },
    { label: "In the cloud only", checked: view.location === "cloud_only", onSelect: () => setLocation("cloud_only") },
    ...(tags.length
      ? ([
          "divider",
          { heading: <strong>Tags</strong> },
          ...[...new Set([...tags, ...view.tags])].map((t) => ({ label: t, checked: view.tags.includes(t), onSelect: () => toggleTag(t) })),
        ] as MenuEntry[])
      : []),
    ...(genres.length || view.genres.length
      ? ([
          "divider",
          { heading: <strong>Genres</strong> },
          ...[...new Set([...genres, ...view.genres])].map((g) => ({
            label: g,
            checked: view.genres.includes(g),
            onSelect: () => toggleGenre(g),
          })),
        ] as MenuEntry[])
      : []),
    ...names("authors", "Authors", authors),
    ...names("narrators", "Narrators", narrators),
    ...(filterCount
      ? ([
          "divider",
          { label: "Clear filters", onSelect: () => onChange({ formats: [], location: null, tags: [], genres: [], authors: [], narrators: [] }) },
        ] as MenuEntry[])
      : []),
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

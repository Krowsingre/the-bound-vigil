import type { Location, ShelfCounts } from "../api/types";
import { Icon } from "../components/Icon";
import { Menu, type MenuEntry } from "../components/Menu";
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
  onChange,
}: {
  view: LibraryView;
  counts: ShelfCounts | null;
  formats: string[];
  onChange: (change: Partial<LibraryView>) => void;
}) {
  const sortLabel = SORTS.find((s) => s.sort === view.sort)?.label;
  const filterCount = view.formats.length + (view.location ? 1 : 0);
  const toggleFormat = (f: string) =>
    onChange({ formats: view.formats.includes(f) ? view.formats.filter((x) => x !== f) : [...view.formats, f] });
  const setLocation = (l: Location) => onChange({ location: view.location === l ? null : l });

  const filterItems: MenuEntry[] = [
    { heading: <strong>Format</strong> },
    ...formats.map((f) => ({ label: f.toUpperCase(), checked: view.formats.includes(f), onSelect: () => toggleFormat(f) })),
    "divider",
    { heading: <strong>Where the file is</strong> },
    { label: "On this device", checked: view.location === "on_device", onSelect: () => setLocation("on_device") },
    { label: "In the cloud only", checked: view.location === "cloud_only", onSelect: () => setLocation("cloud_only") },
    ...(filterCount
      ? (["divider", { label: "Clear filters", onSelect: () => onChange({ formats: [], location: null }) }] as MenuEntry[])
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
              {label}
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

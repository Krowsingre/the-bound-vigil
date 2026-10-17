import { useEffect, useRef, useState } from "react";
import type { SortOrder } from "../api/types";
import { Icon } from "../components/Icon";
import type { Layout } from "../library/libraryView";
import { AppearanceTab } from "./AppearanceTab";
import { AboutTab, AccessibilityTab, AdvancedTab, CollectionsTab, FilesTab, LibraryTab, NotesTab, ReadingTab, ShortcutsTab } from "./OtherTabs";
import { searchSettings, SETTINGS_TABS, type SettingsTab } from "./settingsIndex";
import { SyncTab } from "./SyncTab";
import { isWeb } from "../api";
import { WebSyncTab } from "../web/WebConnect";

/** The pages the web version has: the rest are about files and features on a computer. */
const WEB_TABS = new Set<SettingsTab>(["appearance", "reading", "collections", "sync", "accessibility", "about"]);
const TABS = isWeb ? SETTINGS_TABS.filter((t) => WEB_TABS.has(t.tab)) : SETTINGS_TABS;

/** Settings: its own menu of pages on the left, the chosen page on the right. */
export function Settings({
  tab,
  onTab,
  libraryLayout,
  librarySort,
  onLibraryView,
  sidebarShown,
  onSidebarShown,
  onRestored,
}: {
  tab: SettingsTab;
  onTab: (tab: SettingsTab) => void;
  libraryLayout: Layout;
  librarySort: SortOrder;
  onLibraryView: (change: { layout?: Layout; sort?: SortOrder }) => void;
  sidebarShown: boolean;
  onSidebarShown: (shown: boolean) => void;
  /** The library was replaced from a backup, so every page should reload. */
  onRestored: () => void;
}) {
  const [query, setQuery] = useState("");
  const [jumpTo, setJumpTo] = useState<string | null>(null);
  const body = useRef<HTMLDivElement>(null);
  const results = searchSettings(query).filter((r) => TABS.some((t) => t.tab === r.tab));
  const page = SETTINGS_TABS.find((t) => t.tab === tab)!;

  // A new page starts at its top, or at the section picked from search.
  useEffect(() => {
    const target = jumpTo ? document.getElementById(`settings-${jumpTo}`) : null;
    if (target) {
      target.scrollIntoView({ block: "start" });
      target.classList.add("is-found");
      const t = setTimeout(() => target.classList.remove("is-found"), 1600);
      setJumpTo(null);
      return () => clearTimeout(t);
    }
    body.current?.closest(".content")?.scrollTo({ top: 0 });
  }, [tab, jumpTo]);

  const content = (() => {
    switch (tab) {
      case "appearance":
        return (
          <AppearanceTab
            layout={libraryLayout}
            onLayout={(layout) => onLibraryView({ layout })}
            sidebarShown={sidebarShown}
            onSidebarShown={onSidebarShown}
          />
        );
      case "reading":
        return <ReadingTab />;
      case "library":
        return <LibraryTab layout={libraryLayout} sort={librarySort} onChange={onLibraryView} />;
      case "collections":
        return <CollectionsTab />;
      case "notes":
        return <NotesTab />;
      case "sync":
        return isWeb ? <WebSyncTab /> : <SyncTab onRestored={onRestored} />;
      case "files":
        return <FilesTab />;
      case "accessibility":
        return <AccessibilityTab />;
      case "shortcuts":
        return <ShortcutsTab />;
      case "advanced":
        return <AdvancedTab />;
      case "about":
        return <AboutTab />;
    }
  })();

  return (
    <div className="settings-page">
      <nav className="settings-nav" aria-label="Settings">
        <p className="settings-eyebrow">Settings</p>
        <label className="search settings-search">
          <Icon name="search" size={16} />
          <input type="search" placeholder="Search settings…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search settings" />
        </label>
        {query.trim() ? (
          <ul className="settings-menu settings-results">
            {results.length === 0 ? (
              <li className="settings-row-hint settings-no-results">Nothing in Settings matches “{query.trim()}”.</li>
            ) : (
              results.map((r) => (
                <li key={`${r.tab}-${r.section}`}>
                  <button
                    type="button"
                    className="settings-menu-item"
                    onClick={() => {
                      onTab(r.tab);
                      setJumpTo(r.section);
                    }}
                  >
                    <span>
                      {r.label}
                      <span className="settings-result-page">{SETTINGS_TABS.find((t) => t.tab === r.tab)?.label}</span>
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
        ) : (
          <ul className="settings-menu">
            {TABS.map((t) => (
              <li key={t.tab}>
                <button
                  type="button"
                  className={`settings-menu-item${tab === t.tab ? " is-active" : ""}`}
                  aria-current={tab === t.tab ? "page" : undefined}
                  onClick={() => onTab(t.tab)}
                >
                  <Icon name={t.icon} size={20} />
                  {t.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </nav>
      <div className="settings-body" ref={body}>
        <header className="settings-head">
          <h1>{page.label}</h1>
          <p className="muted">{page.lede}</p>
        </header>
        {content}
      </div>
    </div>
  );
}

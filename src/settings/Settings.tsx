import { useEffect, useRef, useState } from "react";
import type { SortOrder } from "../api/types";
import { Icon } from "../components/Icon";
import type { Layout } from "../library/libraryView";
import { AppearanceTab } from "./AppearanceTab";
import { BrowserTab } from "./BrowserTab";
import { AboutTab, AccessibilityTab, AdvancedTab, CollectionsTab, FilesTab, LibraryTab, NotesTab, ReadingTab, ShortcutsTab } from "./OtherTabs";
import { searchSettings, SETTINGS_TABS, type SettingsTab } from "./settingsIndex";
import { SyncTab } from "./SyncTab";
import { EreadersTab } from "./EreadersTab";
import { ServersTab } from "./ServersTab";
import { isHome, isWeb } from "../api";
import { WebSyncTab } from "../web/WebConnect";
import { unfoldSection } from "./controls";
import { ActivityTab, type ActivitySide } from "./ActivityTab";
import { useNarrow } from "../lib/useNarrow";

/** The pages the web version has: the rest are about files and features on a computer. */
const WEB_TABS = new Set<SettingsTab>(["appearance", "reading", "collections", "sync", "activity", "accessibility", "about"]);
// On the phone at home, the computer keeps the settings; these change only how this phone shows things.
const HOME_TABS = new Set<SettingsTab>(["appearance", "reading", "accessibility", "about"]);
const TABS = isWeb ? SETTINGS_TABS.filter((t) => WEB_TABS.has(t.tab)) : isHome ? SETTINGS_TABS.filter((t) => HOME_TABS.has(t.tab)) : SETTINGS_TABS;

/** The computer's list of pages, in groups split by a thin line. */
const GROUPS: SettingsTab[][] = [
  ["appearance", "reading", "library", "collections", "notes", "browser", "files", "ereaders"],
  ["sync", "activity", "servers"],
  ["accessibility", "shortcuts", "advanced", "about"],
];
const GROUPED = GROUPS.map((group) => group.flatMap((tab) => TABS.filter((t) => t.tab === tab))).filter((g) => g.length > 0);

/** Settings: its own menu of pages on the left, the chosen page on the right.
 * A phone opens on a landing page of cards instead; a computer opens on Appearance. */
export function Settings({
  tab,
  onTab,
  jump,
  onJumped,
  libraryLayout,
  librarySort,
  onLibraryView,
  sidebarShown,
  onSidebarShown,
  onRestored,
  activity,
}: {
  /** null: the landing page, with a button for each tab. */
  tab: SettingsTab | null;
  onTab: (tab: SettingsTab | null) => void;
  /** A section to show, asked for from elsewhere in the app (the Profile card from the sync circle). */
  jump?: string | null;
  onJumped?: () => void;
  libraryLayout: Layout;
  librarySort: SortOrder;
  onLibraryView: (change: { layout?: Layout; sort?: SortOrder }) => void;
  sidebarShown: boolean;
  onSidebarShown: (shown: boolean) => void;
  /** The library was replaced from a backup, so every page should reload. */
  onRestored: () => void;
  /** Preferences › Activity: which side shows, and the app's Imports and Sync activity panes. */
  activity: { side: ActivitySide; onSide: (side: ActivitySide) => void; imports: React.ReactNode; sync: React.ReactNode };
}) {
  const narrow = useNarrow();
  // A computer has no landing page.
  tab = tab ?? (narrow ? null : "appearance");
  const [query, setQuery] = useState("");
  const [jumpTo, setJumpTo] = useState<string | null>(null);
  useEffect(() => {
    if (!jump) return;
    setJumpTo(jump);
    onJumped?.();
  }, [jump, onJumped]);
  const body = useRef<HTMLDivElement>(null);
  const jumped = useRef(false);
  const results = searchSettings(query).filter((r) => TABS.some((t) => t.tab === r.tab));
  const page = SETTINGS_TABS.find((t) => t.tab === tab);

  // A new page starts at its top, or at the section picked from search
  // (opened first, and found once it's drawn: it may sit inside another).
  useEffect(() => {
    if (!jumpTo) {
      // Not when the jump just made has been cleared.
      if (jumped.current) jumped.current = false;
      else body.current?.closest(".content")?.scrollTo({ top: 0 });
      return;
    }
    unfoldSection(jumpTo);
    let fade: ReturnType<typeof setTimeout> | undefined;
    const frame = requestAnimationFrame(() => {
      const target = document.getElementById(`settings-${jumpTo}`);
      if (target) {
        target.scrollIntoView({ block: "start" });
        target.classList.add("is-found");
        fade = setTimeout(() => target.classList.remove("is-found"), 1600);
      }
      jumped.current = true;
      setJumpTo(null);
    });
    return () => {
      cancelAnimationFrame(frame);
      if (fade) clearTimeout(fade);
    };
  }, [tab, jumpTo]);

  const content = (() => {
    switch (tab) {
      case "appearance":
        return (
          <AppearanceTab
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
      case "browser":
        return <BrowserTab />;
      case "sync":
        return isWeb ? <WebSyncTab /> : <SyncTab onRestored={onRestored} />;
      case "activity":
        return <ActivityTab {...activity} />;
      case "files":
        return <FilesTab />;
      case "ereaders":
        return <EreadersTab />;
      case "servers":
        return <ServersTab />;
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

  const search = (
    <label className="search settings-search">
      <Icon name="search" size={16} />
      <input type="search" placeholder="Search preferences…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search preferences" />
    </label>
  );
  const found = (
    <ul className="settings-menu settings-results">
      {results.length === 0 ? (
        <li className="settings-row-hint settings-no-results">Nothing in Preferences matches “{query.trim()}”.</li>
      ) : (
        results.map((r) => (
          <li key={`${r.tab}-${r.section}`}>
            <button
              type="button"
              className="settings-menu-item"
              onClick={() => {
                setQuery("");
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
  );

  // The landing page's cards are the menu, so the list of pages shows only inside one.
  if (!page) {
    return (
      <div className="settings-page is-landing">
        <div className="settings-body" ref={body}>
          <header className="settings-head settings-landing-head">
            <div>
              <h1>Preferences</h1>
              <p className="muted">Choose what to change.</p>
            </div>
            {search}
          </header>
          {query.trim() ? (
            found
          ) : (
            <ul className="settings-landing">
              {TABS.map((t) => (
                <li key={t.tab}>
                  <button type="button" className="settings-landing-card" onClick={() => onTab(t.tab)}>
                    <Icon name={t.icon} size={22} />
                    <span className="settings-landing-text">
                      <span className="settings-landing-name">{t.label}</span>
                      <span className="settings-row-hint">{t.lede}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="settings-page">
      <nav className="settings-nav" aria-label="Preferences">
        <p className="settings-eyebrow">Preferences</p>
        {search}
        {query.trim() ? (
          found
        ) : (
          (narrow ? [TABS] : GROUPED).map((group, i) => (
            <ul key={i} className="settings-menu">
              {group.map((t) => (
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
          ))
        )}
      </nav>
      <div className="settings-body" ref={body}>
        <header className="settings-head">
          {narrow && (
            <button type="button" className="link-btn settings-back" onClick={() => onTab(null)}>
              <Icon name="chevronLeft" size={16} /> All preferences
            </button>
          )}
          <h1>{page.label}</h1>
          {!narrow && <span className="settings-ornament" aria-hidden />}
          <p className="muted">{page.lede}</p>
          {isHome && (
            <p className="settings-row-hint">
              You're using TBV from your computer. Changes here last until this page reloads; the rest of the settings are on the computer.
            </p>
          )}
        </header>
        {content}
      </div>
    </div>
  );
}

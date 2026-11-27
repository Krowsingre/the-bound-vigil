import { useEffect, useRef, useState } from "react";
import type { SortOrder } from "../api/types";
import { Icon, type IconName } from "../components/Icon";
import type { Layout } from "../library/libraryView";
import { AppearanceTab } from "./AppearanceTab";
import { ProfileSection } from "./ProfileSection";
import { AccountPage } from "./AccountPage";
import { BrowserTab } from "./BrowserTab";
import { AboutTab, AccessibilityTab, PlanTab, AdvancedTab, CollectionsTab, ConnectionsTab, DeskLibraryTab, FilesTab, LibraryTab, NotesTab, ReadingTab, ShortcutsTab } from "./OtherTabs";
import { searchSettings, SETTINGS_TABS, type SettingsTab } from "./settingsIndex";
import { SyncTab } from "./SyncTab";
import { EreadersTab } from "./EreadersTab";
import { isHome, isWeb } from "../api";
import { WebSyncTab } from "../web/WebConnect";
import { PrefsDesk, unfoldSection } from "./controls";
import { ActivityTab, type ActivitySide } from "./ActivityTab";
import { useShortcuts } from "../lib/shortcuts";
import { useNarrow } from "../lib/useNarrow";

/** The pages the web version has: the rest are about files and features on a computer. */
const WEB_TABS = new Set<SettingsTab>(["appearance", "reading", "collections", "sync", "activity", "accessibility", "about", "profile"]);
// On the phone at home, the computer keeps the settings; these change only how this phone shows things.
const HOME_TABS = new Set<SettingsTab>(["appearance", "reading", "accessibility", "about"]);
const TABS = isWeb ? SETTINGS_TABS.filter((t) => WEB_TABS.has(t.tab)) : isHome ? SETTINGS_TABS.filter((t) => HOME_TABS.has(t.tab)) : SETTINGS_TABS;

/** The computer's list of pages, in groups split by a thin line. */
const GROUPS: SettingsTab[][] = [
  // About is its own page, straight under Your plan (embre, 31 October); Profile below About (19 November).
  ["plan", "about", "profile"],
  ["appearance", "reading", "library", "collections", "notes", "browser", "files", "ereaders"],
  ["sync", "activity"],
  ["accessibility", "shortcuts", "advanced"],
];
const GROUPED = GROUPS.map((group) => group.flatMap((tab) => TABS.filter((t) => t.tab === tab))).filter((g) => g.length > 0);

/** A page of Attune on a computer: one or more of the phone's pages, one under another. */
interface DeskPage {
  tab: SettingsTab;
  label: string;
  icon: IconName;
  holds: SettingsTab[];
}
const tabOf = (tab: SettingsTab) => SETTINGS_TABS.find((t) => t.tab === tab)!;
const own = (tab: SettingsTab): DeskPage => ({ tab, label: tabOf(tab).label, icon: tabOf(tab).icon, holds: [tab] });

/** The computer's eight pages, down from sixteen (embre, 21 November). Phones keep theirs for now. */
const DESK_GROUPS: DeskPage[][] = [
  // Account comes first, the start of Attune's new pages (embre, 27 November). The old pages stay for now.
  [own("account")],
  [{ tab: "profile", label: "You & TBV", icon: "person", holds: ["profile", "plan", "about", "advanced"] }],
  [
    own("appearance"),
    own("reading"),
    { tab: "library", label: "Library", icon: "library", holds: ["library", "collections", "notes", "files"] },
    { tab: "ereaders", label: "Connections", icon: "connections", holds: ["ereaders"] },
    own("browser"),
  ],
  [{ tab: "sync", label: "Sync & Backup", icon: "cloud", holds: ["sync", "activity"] }],
  [{ tab: "accessibility", label: "Accessibility", icon: "accessibility", holds: ["accessibility", "shortcuts"] }],
];
const DESK_PAGES = DESK_GROUPS.flat();
/** Sections that moved to another page on a computer. */
const DESK_SECTION_PAGE: Record<string, SettingsTab> = { goodreads: "ereaders", hardcover: "ereaders", ratings: "ereaders", canva: "ereaders" };
/** The computer page holding a tab (or one of its sections). */
export function deskPageOf(tab: SettingsTab, section?: string): DeskPage {
  const moved = section ? DESK_SECTION_PAGE[section] : undefined;
  return DESK_PAGES.find((p) => p.holds.includes(moved ?? tab)) ?? DESK_PAGES.find((p) => p.tab === "appearance")!;
}

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
  query,
  onQuery,
  onOpenPlaces,
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
  /** Attune › Activity: which side shows, and the app's Imports and Sync activity panes. */
  activity: { side: ActivitySide; onSide: (side: ActivitySide) => void; imports: React.ReactNode; sync: React.ReactNode };
  /** What's typed in the top bar's search box, which searches Attune here (there's no second box). */
  query: string;
  onQuery: (text: string) => void;
  /** Where your books are: on a computer it's reached from Sync & Backup. */
  onOpenPlaces?: () => void;
}) {
  const narrow = useNarrow();
  // Keyboard shortcuts are left out where there's no keyboard (a phone, or an iPad without one).
  const keys = useShortcuts();
  const grouped = keys ? GROUPED : GROUPED.map((g) => g.filter((t) => t.tab !== "shortcuts")).filter((g) => g.length > 0);
  if (!keys && tab === "shortcuts") tab = null;
  // A computer has no landing page.
  tab = tab ?? (narrow ? null : "appearance");
  const setQuery = onQuery;
  const [jumpTo, setJumpTo] = useState<string | null>(null);
  useEffect(() => {
    if (!jump) return;
    setJumpTo(jump);
    onJumped?.();
  }, [jump, onJumped]);
  const body = useRef<HTMLDivElement>(null);
  const jumped = useRef(false);
  const desk = !narrow && !isWeb && !isHome;
  // Account is a computer page for now: a window narrowed below the computer layout shows Visage instead.
  if (!desk && tab === "account") tab = "profile";
  // Account is a computer page for now; phones find the same things on Visage.
  const results = searchSettings(query).filter((r) => TABS.some((t) => t.tab === r.tab) && (keys || r.tab !== "shortcuts") && (desk || r.tab !== "account"));
  const deskPage = desk && tab ? deskPageOf(tab) : null;
  const page = deskPage ? { ...tabOf(deskPage.tab), label: deskPage.label } : SETTINGS_TABS.find((t) => t.tab === tab);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // A tab inside a bigger computer page: open the page there (Activity, Your plan, Shortcuts).
  useEffect(() => {
    if (!deskPage || !tab || tab === deskPage.tab) return;
    if (tab === "shortcuts") setShortcutsOpen(true);
    else setJumpTo(`tab-${tab}`);
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

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
      const target = document.getElementById(`settings-${jumpTo}`) ?? document.getElementById(`settings-tab-${jumpTo}`);
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

  const deskContent = (() => {
    if (!deskPage) return null;
    const part = (t: SettingsTab, node: React.ReactNode) => (
      <div key={t} id={`settings-tab-${t}`} className="settings-desk-part">
        {node}
      </div>
    );
    switch (deskPage.tab) {
      case "account":
        return <AccountPage />;
      case "profile":
        return [part("profile", <ProfileSection />), part("plan", <PlanTab />), part("about", <AboutTab />), part("advanced", <AdvancedTab />)];
      case "library":
        return <DeskLibraryTab />;
      case "ereaders":
        return <ConnectionsTab />;
      case "sync":
        return [part("sync", <SyncTab onRestored={onRestored} onOpenPlaces={onOpenPlaces} />), part("activity", <ActivityTab {...activity} />)];
      case "accessibility":
        return (
          <>
            <AccessibilityTab onShortcuts={keys ? () => setShortcutsOpen(true) : undefined} />
            {shortcutsOpen && (
              <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && setShortcutsOpen(false)}>
                <div className="dialog shortcuts-sheet" role="dialog" aria-label="Keyboard shortcuts" onKeyDown={(e) => e.key === "Escape" && setShortcutsOpen(false)}>
                  <div className="shortcuts-sheet-head">
                    <h2>Keyboard shortcuts</h2>
                    <button type="button" className="icon-btn" aria-label="Close" autoFocus onClick={() => setShortcutsOpen(false)}>
                      <Icon name="close" size={18} />
                    </button>
                  </div>
                  <ShortcutsTab />
                </div>
              </div>
            )}
          </>
        );
      default:
        return null;
    }
  })();

  const content = deskContent ?? (() => {
    switch (tab) {
      case "plan":
        return <PlanTab />;
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
      case "accessibility":
        return <AccessibilityTab />;
      case "shortcuts":
        return <ShortcutsTab />;
      case "advanced":
        return <AdvancedTab />;
      case "about":
        return <AboutTab />;
      case "profile":
        return <ProfileSection />;
      case "account":
        return <AccountPage />;
    }
  })();

  const found = (
    <ul className="settings-menu settings-results">
      {results.length === 0 ? (
        <li className="settings-row-hint settings-no-results">Nothing in Attune matches “{query.trim()}”.</li>
      ) : (
        results.map((r) => (
          <li key={`${r.tab}-${r.section}`}>
            <button
              type="button"
              className="settings-menu-item"
              onClick={() => {
                setQuery("");
                onTab(desk ? deskPageOf(r.tab, r.section).tab : r.tab);
                // Shortcuts are a sheet on a computer: open it rather than jump on the page.
                if (desk && r.tab === "shortcuts") {
                  setShortcutsOpen(true);
                  return;
                }
                setJumpTo(r.section);
              }}
            >
              <span>
                {r.label}
                <span className="settings-result-page">{desk ? deskPageOf(r.tab, r.section).label : SETTINGS_TABS.find((t) => t.tab === r.tab)?.label}</span>
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
              <h1>Attune</h1>
              <p className="muted">Choose what to change.</p>
            </div>
          </header>
          {query.trim() ? (
            found
          ) : (
            // The same groups as the computer's list, split by a thin line.
            grouped.map((group, i) => (
              <ul key={i} className="settings-landing">
                {group.map((t) => (
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
            ))
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="settings-page">
      <nav className="settings-nav" aria-label="Attune">
        <p className="settings-eyebrow">Attune</p>
        {query.trim() ? (
          found
        ) : (
          (desk ? DESK_GROUPS : grouped).map((group, i) => (
            <ul key={i} className="settings-menu">
              {group.map((t) => (
                <li key={t.tab}>
                  <button
                    type="button"
                    className={`settings-menu-item${(deskPage?.tab ?? tab) === t.tab ? " is-active" : ""}`}
                    aria-current={(deskPage?.tab ?? tab) === t.tab ? "page" : undefined}
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
      <div className={`settings-body${desk && page.tab === "account" ? " attune" : ""}`} ref={body}>
        {/* Visage has no heading: its Visage / Oathkin switch sits at the top instead (embre, 20 November). */}
        {!(desk && page.tab === "account") && (
        <header className={`settings-head${page.tab === "profile" && !desk ? " is-bare" : ""}`}>
          {narrow && (
            <button type="button" className="link-btn settings-back" onClick={() => onTab(null)}>
              <Icon name="chevronLeft" size={16} /> Attune
            </button>
          )}
          {(page.tab !== "profile" || desk) && (
            <>
              <h1>{page.label}</h1>
              {!narrow && <span className="settings-ornament" aria-hidden />}
              {!desk && <p className="muted">{page.lede}</p>}
            </>
          )}
          {isHome && (
            <p className="settings-row-hint">
              You're using TBV from your computer. Changes here last until this page reloads; the rest of the settings are on the computer.
            </p>
          )}
        </header>
        )}
        <PrefsDesk.Provider value={desk}>{content}</PrefsDesk.Provider>
      </div>
    </div>
  );
}

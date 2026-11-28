import { useEffect, useRef, useState } from "react";
import type { SortOrder } from "../api/types";
import { Icon, type IconName } from "../components/Icon";
import type { Layout } from "../library/libraryView";
import { AppearanceTab } from "./AppearanceTab";
import { ProfileSection } from "./ProfileSection";
import { AccountPage } from "./AccountPage";
import { BrowserTab } from "./BrowserTab";
import { AboutTab, AccessibilityTab, PlanTab, AdvancedTab, CollectionsTab, FilesTab, LibraryTab, NotesTab, ReadingTab, ShortcutsTab } from "./OtherTabs";
import { DeskAppearance, DeskLibrary, DeskManagement, DeskReading } from "./DeskPages";
import { DeskConnections } from "./DeskConnections";
import { DeskNexus, DeskWebSecurity } from "./DeskNexus";
import { DeskActivity, DeskStorage, DeskSync } from "./DeskSync";
import { DeskAbout, DeskAccessibility } from "./DeskAbout";
import { searchSettings, SETTINGS_TABS, type SettingsTab } from "./settingsIndex";
import { SyncTab } from "./SyncTab";
import { EreadersTab } from "./EreadersTab";
import { isHome, isWeb } from "../api";
import { WebSyncTab } from "../web/WebConnect";
import { PrefsDesk, unfoldSection } from "./controls";
import { ActivityTab, type ActivitySide } from "./ActivityTab";
import { AtWindow } from "./AtWindow";
import { AttunePhone, PhoneSubPage, type PhoneSub } from "./attune";
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

/**
 * The computer's pages (embre, 21 and 27 November). Phones keep theirs for now. Library holds
 * the Compendium's settings and the ones moved to it; Management holds the Archive's files,
 * tags, duplicates, deleted books, reading history and the Scribe export.
 */
const DESK_GROUPS: DeskPage[][] = [
  [
    own("account"),
    own("appearance"),
    own("reading"),
    { tab: "collections", label: "Library", icon: "library", holds: ["collections"] },
    { tab: "library", label: "Management", icon: "layers", holds: ["library", "notes", "files"] },
    { tab: "ereaders", label: "Connections", icon: "connections", holds: ["ereaders"] },
    // Discover's settings are Nexus and Web Security (embre, 28 November).
    { tab: "browser", label: "Nexus", icon: "globe", holds: ["browser"] },
    own("security"),
  ],
  // Sync & Backup split in three (embre, 28 November).
  [
    { tab: "sync", label: "Sync", icon: "cloud", holds: ["sync"] },
    own("storage"),
    { tab: "activity", label: "Activity", icon: "activity", holds: ["activity"] },
  ],
  [{ tab: "accessibility", label: "Accessibility", icon: "accessibility", holds: ["accessibility", "shortcuts"] }],
  // About is back on the computer (embre, 28 November), with Troubleshooting from Advanced,
  // under its own line (28 November).
  [{ tab: "about", label: "About", icon: "info", holds: ["about", "advanced"] }],
];
const DESK_PAGES = DESK_GROUPS.flat();
/** Sections that moved to another page on a computer, as "tab/section". */
const DESK_SECTION_PAGE: Record<string, SettingsTab> = {
  "library/goodreads": "ereaders",
  "library/hardcover": "ereaders",
  "library/ratings": "ereaders",
  "notes/canva": "ereaders",
  // Visage's things are on Account now (embre, 27 November).
  "profile/profile": "account",
  "profile/oathkin": "account",
  // Moved to Library (embre, 27 November).
  "appearance/privacy": "collections",
  "appearance/sanctum": "collections",
  "reading/read-along": "collections",
  // Web Security (embre, 28 November).
  "browser/protection": "security",
  "browser/redirects": "security",
  "browser/sites": "security",
  "browser/sitedata": "security",
  "browser/history": "security",
  // Storage & Backup.
  "sync/usage": "storage",
  "sync/storage": "storage",
  "sync/tidy": "storage",
  "sync/contents": "storage",
  "sync/move": "storage",
  "sync/backup": "storage",
  "sync/places": "storage",
};
/** Your plan opens in a window over Attunement (from About's Plan card, or from elsewhere in TBV). */
const NOT_ON_DESK = new Set<SettingsTab>(["plan"]);

/** The computer page holding a tab (or one of its sections). */
export function deskPageOf(tab: SettingsTab, section?: string): DeskPage {
  const moved = section ? DESK_SECTION_PAGE[`${tab}/${section}`] : undefined;
  const wanted = moved ?? (tab === "profile" ? "account" : tab);
  return DESK_PAGES.find((p) => p.holds.includes(wanted)) ?? DESK_PAGES.find((p) => p.tab === "appearance")!;
}

/** The computer pages built to the Attunement framework: no page title, sections that fold. */
const ATTUNE_PAGES = new Set<SettingsTab>(["account", "appearance", "reading", "collections", "library", "ereaders", "browser", "security", "sync", "storage", "activity", "accessibility", "about"]);

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
  // A phone has the same pages, drawn as an iPhone's own settings (embre, 28 November).
  const phone = narrow && !isWeb && !isHome;
  const attune = desk || phone;
  // The web version and the phone at home keep the older pages.
  if (!attune && tab === "account") tab = "profile";
  if (!attune && tab === "security") tab = "browser";
  if (!attune && tab === "storage") tab = "sync";
  const results = searchSettings(query).filter(
    (r) =>
      TABS.some((t) => t.tab === r.tab) &&
      (keys || r.tab !== "shortcuts") &&
      (attune || r.tab !== "account") &&
      (desk || !r.desk) &&
      !(attune && NOT_ON_DESK.has(r.tab) && r.tab !== "plan"),
  );
  const planOpen = desk && tab === "plan";
  const deskPage = attune && tab && !(phone && tab === "plan") ? deskPageOf(tab) : null;
  const page = deskPage ? { ...tabOf(deskPage.tab), label: deskPage.label } : SETTINGS_TABS.find((t) => t.tab === tab);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // A page within a phone's page, like a friend on Account.
  const [sub, setSub] = useState<PhoneSub | null>(null);
  useEffect(() => setSub(null), [tab]);
  // A tab inside a bigger computer page: open the page there (Activity, Your plan, Shortcuts).
  useEffect(() => {
    if (!deskPage || !tab || tab === deskPage.tab || NOT_ON_DESK.has(tab)) return;
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
    switch (deskPage.tab) {
      case "account":
        return <AccountPage />;
      case "appearance":
        return <DeskAppearance sidebarShown={sidebarShown} onSidebarShown={onSidebarShown} />;
      case "reading":
        return <DeskReading />;
      case "collections":
        return <DeskLibrary />;
      case "library":
        return <DeskManagement />;
      case "ereaders":
        return <DeskConnections />;
      case "browser":
        return <DeskNexus />;
      case "security":
        return <DeskWebSecurity />;
      case "sync":
        return <DeskSync />;
      case "storage":
        return <DeskStorage onRestored={onRestored} onOpenPlaces={onOpenPlaces} />;
      case "activity":
        return <DeskActivity imports={activity.imports} sync={activity.sync} />;
      case "accessibility":
        return (
          <>
            <DeskAccessibility keys={keys} />
            {shortcutsOpen && (
              <AtWindow title="Keyboard shortcuts" className="shortcuts-sheet" onClose={() => setShortcutsOpen(false)}>
                <ShortcutsTab />
              </AtWindow>
            )}
          </>
        );
      case "about":
        return <DeskAbout onOpenPlan={phone ? () => onTab("plan") : undefined} />;
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
        <li className="settings-row-hint settings-no-results">Nothing in Attunement matches “{query.trim()}”.</li>
      ) : (
        results.map((r) => (
          <li key={`${r.tab}-${r.section}`}>
            <button
              type="button"
              className="settings-menu-item"
              onClick={() => {
                setQuery("");
                if (attune && r.tab === "plan") return onTab("plan");
                onTab(attune ? deskPageOf(r.tab, r.section).tab : r.tab);
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
                <span className="settings-result-page">{attune && r.tab !== "plan" ? deskPageOf(r.tab, r.section).label : SETTINGS_TABS.find((t) => t.tab === r.tab)?.label}</span>
              </span>
            </button>
          </li>
        ))
      )}
    </ul>
  );

  if (phone) {
    const title = sub?.title ?? (tab === "plan" ? "Your plan" : (page?.label ?? "Attunement"));
    return (
      <div className="settings-page at-ios-page">
        <div className="at-ios-nav">
          {sub ? (
            <button type="button" className="at-ios-back" onClick={sub.onBack}>
              <Icon name="chevronLeft" size={20} />
              {sub.back}
            </button>
          ) : tab ? (
            <button type="button" className="at-ios-back" onClick={() => onTab(tab === "plan" ? "about" : null)}>
              <Icon name="chevronLeft" size={20} />
              {tab === "plan" ? "About" : "Attunement"}
            </button>
          ) : (
            <span />
          )}
          <h1 className="at-ios-title">{title}</h1>
          <span />
        </div>
        <div className="settings-body attune at-ios-body" ref={body}>
          {!tab ? (
            query.trim() ? (
              found
            ) : (
              <PhoneList onTab={onTab} />
            )
          ) : (
            <AttunePhone.Provider value={true}>
              <PhoneSubPage.Provider value={setSub}>
                <PrefsDesk.Provider value={false}>{tab === "plan" ? <PlanTab /> : deskContent}</PrefsDesk.Provider>
              </PhoneSubPage.Provider>
            </AttunePhone.Provider>
          )}
        </div>
      </div>
    );
  }

  // The landing page's cards are the menu, so the list of pages shows only inside one.
  if (!page) {
    return (
      <div className="settings-page is-landing">
        <div className="settings-body" ref={body}>
          <header className="settings-head settings-landing-head">
            <div>
              <h1>Attunement</h1>
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
      <nav className="settings-nav" aria-label="Attunement">
        <p className="settings-eyebrow">Attunement</p>
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
      <div className={`settings-body${desk && ATTUNE_PAGES.has(page.tab) ? " attune" : ""}`} ref={body}>
        {/* The Attunement pages have no heading (embre, 27 November). */}
        {!(desk && ATTUNE_PAGES.has(page.tab)) && (
        <header className={`settings-head${page.tab === "profile" && !desk ? " is-bare" : ""}`}>
          {narrow && (
            <button type="button" className="link-btn settings-back" onClick={() => onTab(null)}>
              <Icon name="chevronLeft" size={16} /> Attunement
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
      {planOpen && (
        <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onTab("about")}>
          <div className="dialog plan-sheet" role="dialog" aria-label="Your plan" onKeyDown={(e) => e.key === "Escape" && onTab("about")}>
            <div className="shortcuts-sheet-head">
              <h2>Your plan</h2>
              <button type="button" className="icon-btn" aria-label="Close" autoFocus onClick={() => onTab("about")}>
                <Icon name="close" size={18} />
              </button>
            </div>
            <PrefsDesk.Provider value={desk}>
              <PlanTab />
            </PrefsDesk.Provider>
          </div>
        </div>
      )}
    </div>
  );
}

/** A phone's list of pages: coloured icons in groups, as an iPhone's own Settings (embre, 28 November). */
const PHONE_GROUPS: { tab: SettingsTab; label: string; icon: IconName; color: string }[][] = [
  [{ tab: "account", label: "Account", icon: "person", color: "#8a8f98" }],
  [
    { tab: "appearance", label: "Appearance", icon: "palette", color: "#5b7fa6" },
    { tab: "reading", label: "Reading", icon: "readingA", color: "#a0714f" },
    { tab: "collections", label: "Library", icon: "library", color: "#6d8b5e" },
    { tab: "library", label: "Management", icon: "layers", color: "#7a6a9a" },
    { tab: "ereaders", label: "Connections", icon: "connections", color: "#3f8f8f" },
  ],
  [
    { tab: "browser", label: "Nexus", icon: "globe", color: "#4a78c2" },
    { tab: "security", label: "Web Security", icon: "shield", color: "#5f6b7a" },
  ],
  [
    { tab: "sync", label: "Sync", icon: "cloud", color: "#3d82c4" },
    { tab: "storage", label: "Storage & Backup", icon: "database", color: "#8c7a55" },
    { tab: "activity", label: "Activity", icon: "activity", color: "#c0663f" },
  ],
  [
    { tab: "accessibility", label: "Accessibility", icon: "accessibility", color: "#3a6fd8" },
    { tab: "about", label: "About", icon: "info", color: "#8a8f98" },
  ],
];

function PhoneList({ onTab }: { onTab: (tab: SettingsTab) => void }) {
  return (
    <div className="at-ios-list">
      {PHONE_GROUPS.map((group, i) => (
        <ul key={i} className="at-ios-card">
          {group.map((t) => (
            <li key={t.tab}>
              <button type="button" className="at-ios-link" onClick={() => onTab(t.tab)}>
                <span className="at-ios-icon" style={{ background: t.color }} aria-hidden>
                  <Icon name={t.icon} size={18} />
                </span>
                <span className="at-ios-link-label">{t.label}</span>
                <Icon name="chevronRight" size={16} />
              </button>
            </li>
          ))}
        </ul>
      ))}
    </div>
  );
}

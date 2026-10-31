// Discover's start page, drawn by TBV (so it opens at once, and offline):
// a search box that hands over to the address box, tiles for Bookmarks,
// History, Downloads and the Reading List, Quick Links on gallery paintings,
// and the sites visited lately.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import type { QuickLink } from "../api/types";
import { galleryUrl } from "../collections/gallery";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Icon, type IconName } from "../components/Icon";
import { Menu } from "../components/Menu";
import { useToast } from "../components/Toast";
import type { ClosedTab } from "./browserTabs";
import { ClosedList } from "./ClosedList";
import { clearHistory, onHistory, readHistory, removeFromHistory } from "./browserHistory";
import { onBrowserPrefs, readBrowserPrefs, siteOf } from "./browserPrefs";
import { backgroundUrl, DiscoverBackgroundPicker } from "./DiscoverBackground";
import { QuickLinksEditor, freePainting } from "./QuickLinksEditor";
import { SiteBadge } from "./SiteBadge";

/** Paintings light enough on their left side (where the name sits) for dark text. */
const LIGHT_PAINTINGS = new Set([
  "aurelian-castle",
  "blush-botanical",
  "coastal-ruins",
  "vintage-herbarium",
  "snowbound-peaks",
  "winter-valley",
  "classical-coastal-ruins",
  "waterfall-citadel",
  "quiet-blossoms",
]);

export const isLightPainting = (name: string) => LIGHT_PAINTINGS.has(name);

/** How many sites Recent Sites shows. */
const RECENT = 5;

export type StartPanel = "bookmarks" | "history" | "downloads" | "reading";

/** A site's front door, for Recent Sites and Quick Links: its address without the page. */
const originOf = (url: string) => {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
};

function recentSites() {
  const seen = new Set<string>();
  const sites: { url: string; title: string; site: string }[] = [];
  for (const e of readHistory()) {
    if (e.kind !== "page") continue;
    const site = siteOf(e.url);
    if (!site || seen.has(site)) continue;
    seen.add(site);
    sites.push({ url: e.url, title: e.title?.trim() || site, site });
    if (sites.length === RECENT) break;
  }
  return sites;
}

const TILES: { panel: StartPanel; label: string; icon: IconName }[] = [
  { panel: "bookmarks", label: "Bookmarks", icon: "compass" },
  { panel: "history", label: "History", icon: "clock" },
  { panel: "downloads", label: "Downloads", icon: "download" },
  { panel: "reading", label: "Reading List", icon: "notes" },
];

export function StartPage({
  onGo,
  onNewTab,
  onPanel,
  search,
  onSearchChange,
  onSearch,
  closed,
  onReopen,
  privately = false,
}: {
  onGo: (url: string) => void;
  onNewTab: (url: string) => void;
  onPanel: (panel: StartPanel) => void;
  /** What's typed, shared with the address box at the top, so each shows the other's typing. */
  search: string;
  onSearchChange: (text: string) => void;
  /** Searches for (or goes to) what's typed. */
  onSearch: (text: string) => void;
  /** Tabs closed lately, for the Recently closed fold-out. */
  closed: ClosedTab[];
  onReopen: (index: number) => void;
  /** In a private tab, which says what it keeps. */
  privately?: boolean;
}) {
  const toast = useToast();
  const [links, setLinks] = useState<QuickLink[]>([]);
  const [editing, setEditing] = useState(false);
  const [recent, setRecent] = useState(recentSites);
  const [clearing, setClearing] = useState(false);
  const [showClosed, setShowClosed] = useState(false);
  const [prefs, setPrefs] = useState(readBrowserPrefs);
  useEffect(() => onBrowserPrefs(() => setPrefs(readBrowserPrefs())), []);
  const showRecent = prefs.showRecent && prefs.historyOn;
  const backdrop = backgroundUrl(prefs.background);
  const [choosing, setChoosing] = useState(false);
  // The picture stops at the scroll bar, so it never runs under it.
  const scroller = useRef<HTMLDivElement>(null);
  const [bar, setBar] = useState(0);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => setBar(el.offsetWidth - el.clientWidth);
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    if (el.firstElementChild) watch.observe(el.firstElementChild);
    return () => watch.disconnect();
  }, []);

  const reload = useCallback(() => api.quickLinks().then(setLinks, () => undefined), []);
  useEffect(() => void reload(), [reload]);
  useEffect(() => onHistory(() => setRecent(recentSites())), []);

  const used = useMemo(() => links.map((l) => l.picture), [links]);

  const addQuick = async (title: string, url: string) => {
    try {
      await api.addQuickLink(title, originOf(url) + "/", freePainting(used));
      await reload();
      toast(`${title} is in your Quick Links.`);
    } catch (e) {
      toast(String(e).replace(/^Error: /, ""));
    }
  };

  return (
    <>
    {backdrop && <div className="start-backdrop" style={{ backgroundImage: `url(${backdrop})`, right: bar }} aria-hidden />}
    <div
      ref={scroller}
      className={`start-page${backdrop ? " has-backdrop" : ""}`}
    >
      <button type="button" className="start-background-button" title="Change the background" aria-label="Change the background" onClick={() => setChoosing(true)}>
        <Icon name="image" size={17} />
      </button>
      <div className="start-inner">
        <h1 className="start-title">Discover</h1>
        <p className="start-lede">Explore the web, find new stories, and keep what matters to you.</p>
        <span className="start-rule" aria-hidden />
        {privately && (
          <p className="start-private">
            <Icon name="eyeOff" size={18} />
            <span>
              <b>Private tab.</b> Pages you visit here aren't kept in History, and the sites' cookies and sign-ins go when you close it. Downloads and bookmarks you make are kept.
            </span>
          </p>
        )}
        <form
          className="start-search"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            if (search.trim()) onSearch(search);
          }}
        >
          <Icon name="search" size={20} />
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search the web or enter a website…"
            aria-label="Search the web or enter a website"
            spellCheck={false}
            autoCapitalize="off"
            enterKeyHint="go"
          />
          <button type="submit" className="start-search-go" aria-label="Go" disabled={!search.trim()}>
            <Icon name="chevronRight" size={18} />
          </button>
        </form>
        <div className="start-tiles">
          {TILES.map((t) => (
            <button key={t.panel} type="button" className={`start-tile start-tile-${t.panel}`} onClick={() => onPanel(t.panel)}>
              <Icon name={t.icon} size={28} />
              <span>{t.label}</span>
            </button>
          ))}
        </div>

        <span className="start-rule start-rule-wide" aria-hidden />
        <section className="start-section" aria-labelledby="start-quick">
          <header>
            <h2 id="start-quick">Quick Links</h2>
            <button type="button" className="start-more" onClick={() => setEditing(true)}>
              Edit <Icon name="chevronRight" size={16} />
            </button>
          </header>
          {links.length === 0 ? (
            <p className="muted">Sites you add with Edit show here, each on a painting of its own.</p>
          ) : (
            <div className="quick-links">
              {links.map((l) => {
                const picture = galleryUrl(l.picture, "wide");
                return (
                  <button
                    key={l.id}
                    type="button"
                    className={`quick-link${isLightPainting(l.picture) ? " is-light" : ""}`}
                    style={picture ? { backgroundImage: `url(${picture})` } : undefined}
                    onClick={() => onGo(l.url)}
                    title={l.url}
                  >
                    <SiteBadge url={l.url} title={l.title} />
                    <span className="quick-link-name">{l.title}</span>
                    <span className="quick-link-open" aria-hidden>
                      <Icon name="external" size={16} />
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {showRecent && recent.length > 0 && (
          <>
            <span className="start-rule start-rule-wide" aria-hidden />
            <section className="start-section" aria-labelledby="start-recent">
              <header>
                <h2 id="start-recent">Recent Sites</h2>
                <button type="button" className="start-more" onClick={() => setClearing(true)}>
                  Clear <Icon name="chevronRight" size={16} />
                </button>
              </header>
              <ul className="recent-sites">
                {recent.map((r) => (
                  <li key={r.site}>
                    <button type="button" className="recent-site" onClick={() => onGo(r.url)} title={r.url}>
                      <span className="recent-site-icon">
                        <SiteBadge url={r.url} title={r.title} size={30} />
                      </span>
                      <span className="recent-site-text">
                        <b>{r.title}</b>
                        <span className="muted">{originOf(r.url)}</span>
                      </span>
                    </button>
                    <Menu
                      label={`More for ${r.title}`}
                      className="icon-btn"
                      trigger={<Icon name="moreVertical" size={18} />}
                      items={[
                        { label: "Open in new tab", icon: "plus", onSelect: () => onNewTab(r.url) },
                        { label: "Copy link", icon: "copy", onSelect: () => void navigator.clipboard?.writeText(r.url).then(() => toast("Link copied.")) },
                        { label: "Add to Quick Links", icon: "link", onSelect: () => void addQuick(r.title, r.url) },
                        {
                          label: "Remove from history",
                          icon: "trash",
                          onSelect: () => removeFromHistory(readHistory().filter((e) => siteOf(e.url) === r.site).map((e) => e.id)),
                        },
                      ]}
                    />
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}

        {closed.length > 0 && (
          <>
            <span className="start-rule start-rule-wide" aria-hidden />
            <section className="start-section" aria-labelledby="start-closed">
              <header>
                <h2 id="start-closed">Recently closed tabs</h2>
                <button type="button" className="start-more" aria-expanded={showClosed} onClick={() => setShowClosed(!showClosed)}>
                  {showClosed ? "Hide" : `Show ${closed.length}`} <Icon name={showClosed ? "chevronUp" : "chevronDown"} size={16} />
                </button>
              </header>
              {showClosed && <ClosedList closed={closed} onReopen={onReopen} />}
            </section>
          </>
        )}
      </div>
      {choosing && (
        <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && setChoosing(false)}>
          <div className="dialog start-background-dialog" role="dialog" aria-label="Start page background" onKeyDown={(e) => e.key === "Escape" && setChoosing(false)}>
            <header className="catalogues-head">
              <h2>Background</h2>
              <button type="button" className="icon-btn" aria-label="Close" onClick={() => setChoosing(false)}>
                <Icon name="close" size={18} />
              </button>
            </header>
            <p className="muted">A picture behind the start page, on this device. It's also in Preferences › Discover.</p>
            <DiscoverBackgroundPicker value={prefs.background} onError={toast} />
          </div>
        </div>
      )}
      {editing && <QuickLinksEditor links={links} onChanged={reload} onClose={() => setEditing(false)} />}
      {clearing && (
        <ConfirmDialog
          title="Clear Recent Sites?"
          body="This clears Discover's history, so these sites go from History too. Bookmarks, Quick Links, tabs and site sign-ins stay."
          confirm="Clear"
          danger
          onCancel={() => setClearing(false)}
          onConfirm={() => {
            clearHistory(null);
            setClearing(false);
          }}
        />
      )}
    </div>
    </>
  );
}

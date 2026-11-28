// Attunement › Nexus and Web Security on a computer (embre, 28 November): the browser's settings,
// split in two. Nexus is how the browser behaves; Web Security is what it blocks, the choices
// made for single sites, what sites keep, and history. No lines under the names; lists open in
// windows. Phones keep their Discover page as it was.

import { useEffect, useState } from "react";
import { api, isIOS, isWindows } from "../api";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { InfoTip } from "../components/InfoTip";
import { useToast } from "../components/Toast";
import { temporaryDownloads } from "../browse/browserDownloads";
import { clearHistory, HISTORY_KEEPS, trimHistory, type HistoryKeep } from "../browse/browserHistory";
import {
  DEFAULT_HOME,
  lowerFor,
  onBrowserPrefs,
  PROTECTION_LEVELS,
  protectionOf,
  readBrowserPrefs,
  REDIRECT_MODES,
  redirectHost,
  resetSite,
  SEARCH_ENGINES,
  sitesWithSettings,
  writeBrowserPrefs,
  zoomLabel,
  type BrowserPrefs,
  type LinksOpen,
  type ProtectionLevel,
  type RedirectMode,
  type SearchEngine,
} from "../browse/browserPrefs";
import { AtChoice, AtPage, AtPair, AtRow, AtRows, AtSection, AtSwitch, usePhone } from "./attune";
import { AtWindow } from "./AtWindow";
import { formatBytes, Select } from "./controls";

/** Tells an open browser about a change to protection; it's read afresh when the browser next opens anyway. */
const protect = (prefs: BrowserPrefs) => void api.browserProtect(protectionOf(prefs)).catch(() => undefined);

function useBrowserPrefs() {
  const [prefs, setPrefs] = useState(readBrowserPrefs);
  useEffect(() => onBrowserPrefs(() => setPrefs(readBrowserPrefs())), []);
  return prefs;
}

const SIGILS_OPEN: { value: LinksOpen; label: string }[] = [
  { value: "newTab", label: "In new tab" },
  { value: "current", label: "In existing tab" },
  { value: "browser", label: "In default browser" },
];

const sites = (n: number) => `${n} ${n === 1 ? "site" : "sites"}`;

export function DeskNexus() {
  const prefs = useBrowserPrefs();
  // A phone leaves out typing, playing when minimized and the download folder (embre, 28 November).
  const phone = usePhone();
  return (
    <AtPage className="at-nexus">
      <StartAndSearch prefs={prefs} />
      <AtPair>
        <AtSection id="navigation" title="Navigation" also={["apps"]}>
          <AtRows>
            <AtSwitch
              label="Open Nexus with previous tabs"
              checked={prefs.comeBack === "keep"}
              onChange={(on) => writeBrowserPrefs({ comeBack: on ? "keep" : "close" })}
            />
            <AtRow label="Open sigils" wide>
              <Select<LinksOpen> label="Open sigils" value={prefs.linksOpen} options={SIGILS_OPEN} onChange={(linksOpen) => writeBrowserPrefs({ linksOpen })} />
            </AtRow>
            <AtSwitch label="Ask before opening external links" checked={prefs.askApps} onChange={(askApps) => writeBrowserPrefs({ askApps })} />
          </AtRows>
        </AtSection>
        {!phone && <AtSection id="typing" title="Typing & Forms">
          <AtRows>
            <AtSwitch
              label="Tab autocomplete"
              checked={!prefs.quietTab}
              onChange={(on) => {
                writeBrowserPrefs({ quietTab: !on });
                void api.browserTabKeys(!on).catch(() => undefined);
              }}
            />
            {isWindows && (
              <AtSwitch
                label="Remember form history"
                checked={prefs.formMemory}
                onChange={(formMemory) => {
                  writeBrowserPrefs({ formMemory });
                  void api.browserFormMemory(formMemory).catch(() => undefined);
                }}
              />
            )}
          </AtRows>
        </AtSection>}
      </AtPair>
      <AtPair>
        <Downloads prefs={prefs} />
        <AtSection id="playing" title="Media">
          <AtRows>
            <AtSwitch label="Play outside Nexus" checked={prefs.keepPlaying} onChange={(keepPlaying) => writeBrowserPrefs({ keepPlaying })} />
            {!phone && (
              <AtSwitch
                label="Play when minimized"
                checked={prefs.backgroundPlay}
                onChange={(backgroundPlay) => {
                  writeBrowserPrefs({ backgroundPlay });
                  void api.browserKeepPlaying(backgroundPlay).catch(() => undefined);
                }}
              />
            )}
            <AtSwitch label="Picture in Picture returns to tab" checked={prefs.pipReturn} onChange={(pipReturn) => writeBrowserPrefs({ pipReturn })} />
          </AtRows>
        </AtSection>
      </AtPair>
    </AtPage>
  );
}

function StartAndSearch({ prefs }: { prefs: BrowserPrefs }) {
  const toast = useToast();
  const phone = usePhone();
  const [home, setHome] = useState(prefs.home);
  useEffect(() => setHome(prefs.home), [prefs.home]);
  const saveHome = () => {
    const text = home.trim();
    if (!text) return setHome(prefs.home);
    const address = /^https?:\/\//i.test(text) ? text : `https://${text}`;
    try {
      new URL(address);
    } catch {
      toast("That isn't a web address.");
      return setHome(prefs.home);
    }
    if (address !== prefs.home) {
      writeBrowserPrefs({ home: address });
      toast("Your home page is saved.");
    }
  };
  const search = (
    <>
      <AtRow label="Search engine">
        <Select<SearchEngine>
          label="Search engine"
          value={prefs.search}
          options={SEARCH_ENGINES.map((e) => ({ value: e.value, label: e.label }))}
          onChange={(search) => writeBrowserPrefs({ search })}
        />
      </AtRow>
      <AtSwitch label="Suggestions" checked={prefs.suggest} onChange={(suggest) => writeBrowserPrefs({ suggest })} />
    </>
  );
  const start = (
    <>
      <AtRow label="Start with">
        <AtChoice<"start" | "site">
          label="Start with"
          className="at-nexus-start"
          value={prefs.startPage ? "start" : "site"}
          options={[
            { value: "start", label: "Start page" },
            { value: "site", label: "A website" },
          ]}
          onChange={(v) => writeBrowserPrefs({ startPage: v === "start" })}
        />
      </AtRow>
      {!prefs.startPage && (
        <AtRow label="Home page">
          <input
            className="attune-input at-nexus-home"
            type="url"
            spellCheck={false}
            value={home}
            aria-label="Home page"
            onChange={(e) => setHome(e.target.value)}
            onBlur={saveHome}
            onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
          />
          <button
            type="button"
            className="btn btn-quiet"
            disabled={prefs.home === DEFAULT_HOME}
            onClick={() => (writeBrowserPrefs({ home: DEFAULT_HOME }), toast("Your home page is Project Gutenberg again."))}
          >
            Use Project Gutenberg
          </button>
        </AtRow>
      )}
      <AtSwitch label="Home button" checked={prefs.homeButton} onChange={(homeButton) => writeBrowserPrefs({ homeButton })} />
      <AtSwitch label="Recent Sites" checked={prefs.showRecent} disabled={!prefs.startPage} onChange={(showRecent) => writeBrowserPrefs({ showRecent })} />
    </>
  );
  // One card, two columns on a computer: Search | Start (embre, 28 November). A phone: one list.
  if (phone)
    return (
      <AtSection id="start" title="Start & Search" also={["search", "home"]}>
        <AtRows>
          {search}
          {start}
        </AtRows>
      </AtSection>
    );
  return (
    <AtSection id="start" title="Start & Search" also={["search", "home"]}>
      <div className="at-split">
        <div className="at-split-col">
          <h3 className="at-split-head">Search</h3>
          <AtRows>{search}</AtRows>
        </div>
        <div className="at-split-col">
          <h3 className="at-split-head">Start</h3>
          <AtRows>{start}</AtRows>
        </div>
      </div>
    </AtSection>
  );
}

function Downloads({ prefs }: { prefs: BrowserPrefs }) {
  const toast = useToast();
  const phone = usePhone();
  // Counted when the page opens (embre, 28 November).
  const [temporary, setTemporary] = useState<{ files: number; bytes: number } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [working, setWorking] = useState(false);
  const count = () =>
    void temporaryDownloads(false).then(
      (r) => setTemporary({ files: r.files, bytes: r.bytes }),
      () => setTemporary(null),
    );
  useEffect(count, []);
  const remove = async () => {
    setWorking(true);
    try {
      const result = await temporaryDownloads(true);
      toast(result.failed ? `Couldn't remove ${result.failed} temporary entries.` : "Temporary files removed.");
    } catch (error) {
      toast(String(error));
    } finally {
      setWorking(false);
      setConfirming(false);
      count();
    }
  };
  const chooseFolder = async () => {
    try {
      const downloadFolder = await api.chooseFolder("Choose where to save Nexus downloads", prefs.downloadFolder);
      if (downloadFolder) writeBrowserPrefs({ downloadFolder, askDownloadFolder: false });
    } catch (error) {
      toast(String(error));
    }
  };
  return (
    <AtSection id="downloads" title="Downloads">
      <AtRows>
        <AtSwitch label="Auto-add ebooks" checked={prefs.addWithoutAsking} onChange={(addWithoutAsking) => writeBrowserPrefs({ addWithoutAsking })} />
        {!phone && (
        <AtRow label="Download folder" wide>
          <code className="path at-path">{prefs.downloadFolder ?? "Downloads (TBV default)"}</code>
          <div className="at-buttons">
            <button type="button" className="btn btn-quiet" onClick={() => void chooseFolder()}>
              Choose…
            </button>
            <button type="button" className="btn btn-quiet" disabled={!prefs.downloadFolder} onClick={() => writeBrowserPrefs({ downloadFolder: null, askDownloadFolder: false })}>
              Reset
            </button>
          </div>
        </AtRow>
        )}
        {!phone && <AtSwitch label="Ask where to save" checked={prefs.askDownloadFolder} onChange={(askDownloadFolder) => writeBrowserPrefs({ askDownloadFolder })} />}
        <AtSwitch
          label="Delete temp files with history"
          checked={prefs.deleteTemporaryWithHistory}
          onChange={(deleteTemporaryWithHistory) => writeBrowserPrefs({ deleteTemporaryWithHistory })}
        />
        <AtRow label="Temp files">
          {temporary && <span className="at-count">{formatBytes(temporary.bytes)}</span>}
          <button type="button" className="btn btn-quiet" disabled={working || !temporary?.files} onClick={() => setConfirming(true)}>
            Remove…
          </button>
        </AtRow>
      </AtRows>
      {confirming && temporary && (
        <ConfirmDialog
          title="Remove temporary files?"
          body={`${temporary.files} ${temporary.files === 1 ? "file" : "files"} (${formatBytes(temporary.bytes)}). Active transfers and imports are skipped.`}
          confirm="Remove"
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            if (!working) void remove();
          }}
        />
      )}
    </AtSection>
  );
}

export function DeskWebSecurity() {
  const toast = useToast();
  const prefs = useBrowserPrefs();
  const [open, setOpen] = useState<"lowered" | "trusted" | "sites" | null>(null);
  const [clearing, setClearing] = useState<"history" | "data" | "forms" | null>(null);
  const level = PROTECTION_LEVELS.find((p) => p.value === prefs.protection);
  const close = () => setOpen(null);
  const withSettings = sitesWithSettings(prefs);
  return (
    <AtPage className="at-websecurity">
      <AtSection id="protection" title="Protection">
        <AtRows>
          <AtRow
            label={
              <span className="at-label-with-tip">
                Level
                <InfoTip label="What each level blocks" title="Protection">
                  {PROTECTION_LEVELS.map((p) => (
                    <p key={p.value}>
                      <strong>{p.label}.</strong> {p.hint}
                    </p>
                  ))}
                  <p>A site that won't work properly can have its protection lowered from its Site information sheet (the lock in the address box).</p>
                </InfoTip>
              </span>
            }
          >
            <Select<ProtectionLevel>
              label={`Protection level: ${level?.label ?? ""}`}
              value={prefs.protection}
              options={PROTECTION_LEVELS.map((p) => ({ value: p.value, label: p.value === "strict" ? `${p.label} (recommended)` : p.label }))}
              onChange={(protection) => protect(writeBrowserPrefs({ protection }))}
            />
          </AtRow>
          <AtRow label="Lowered sites">
            <span className="at-count">{sites(prefs.lowered.length)}</span>
            <button type="button" className="btn btn-quiet" disabled={prefs.lowered.length === 0} onClick={() => setOpen("lowered")}>
              Manage…
            </button>
          </AtRow>
        </AtRows>
      </AtSection>
      <AtPair>
        <AtSection id="redirects" title="Website Permissions" also={["sites"]}>
          <AtRows>
            <AtRow label="Redirects" wide>
              <Select<RedirectMode> label="Redirects" value={prefs.redirects} options={REDIRECT_MODES} onChange={(redirects) => protect(writeBrowserPrefs({ redirects }))} />
            </AtRow>
            <AtRow label="Trusted redirects">
              <span className="at-count">{sites(prefs.redirectAllowlist.length)}</span>
              <button type="button" className="btn btn-quiet" onClick={() => setOpen("trusted")}>
                Manage…
              </button>
            </AtRow>
            <AtRow label="Site settings">
              <span className="at-count">{sites(withSettings.length)}</span>
              <button type="button" className="btn btn-quiet" disabled={withSettings.length === 0} onClick={() => setOpen("sites")}>
                Manage…
              </button>
            </AtRow>
          </AtRows>
        </AtSection>
        <AtSection id="sitedata" title="Site Data">
          <AtRows>
            <AtSwitch label="Clear on startup" checked={prefs.clearOnStart} onChange={(clearOnStart) => writeBrowserPrefs({ clearOnStart })} />
            <AtRow label="Clear site data">
              <button type="button" className="btn btn-quiet" onClick={() => setClearing("data")}>
                Clear…
              </button>
            </AtRow>
            {isWindows && (
              <AtRow label="Clear form history">
                <button type="button" className="btn btn-quiet" onClick={() => setClearing("forms")}>
                  Clear…
                </button>
              </AtRow>
            )}
          </AtRows>
        </AtSection>
      </AtPair>
      <AtSection id="history" title="History">
        <AtRows>
          <AtSwitch label="Keep history" checked={prefs.historyOn} onChange={(historyOn) => writeBrowserPrefs({ historyOn })} />
          <AtSwitch label="Keep searches" checked={prefs.historySearches} disabled={!prefs.historyOn} onChange={(historySearches) => writeBrowserPrefs({ historySearches })} />
          <AtRow label="Keep for">
            <Select<HistoryKeep>
              label="Keep history for"
              value={prefs.historyKeep}
              options={HISTORY_KEEPS.map((k) => ({ value: k.value, label: k.label }))}
              onChange={(historyKeep) => {
                writeBrowserPrefs({ historyKeep });
                trimHistory(historyKeep);
              }}
            />
          </AtRow>
          <AtRow label="Clear history">
            <button type="button" className="btn btn-quiet" onClick={() => setClearing("history")}>
              Clear…
            </button>
          </AtRow>
        </AtRows>
      </AtSection>

      {open === "lowered" && (
        <AtWindow title="Lowered sites" onClose={close}>
          <SiteList
            empty="Every site has the usual protection."
            items={prefs.lowered.map((site) => ({ site }))}
            action="Restore protection"
            onAction={(site) => protect(lowerFor(site, false))}
          />
        </AtWindow>
      )}
      {open === "trusted" && (
        <AtWindow title="Trusted redirects" onClose={close}>
          <TrustedRedirects prefs={prefs} />
        </AtWindow>
      )}
      {open === "sites" && (
        <AtWindow title="Site settings" onClose={close}>
          <SiteList
            empty="None yet. Every site uses the usual settings."
            items={withSettings.map((site) => {
              const own = prefs.sites[site] ?? {};
              const what = [prefs.lowered.includes(site) && "Protection lowered", own.zoom && `Zoom ${zoomLabel(own.zoom)}`, own.desktop && isIOS && "Desktop version"].filter(Boolean);
              return { site, what: what.join(" · ") };
            })}
            action="Reset"
            onAction={(site) => {
              protect(resetSite(site));
              toast(`${site} is back to the usual settings.`);
            }}
          />
        </AtWindow>
      )}

      {clearing === "history" && (
        <ConfirmDialog
          title="Clear all history?"
          body="Every page and search goes from Nexus's history. Bookmarks, tabs and site sign-ins stay."
          confirm="Clear"
          danger
          onCancel={() => setClearing(null)}
          onConfirm={() => {
            clearHistory();
            setClearing(null);
            toast("Nexus's history is cleared.");
          }}
        />
      )}
      {clearing === "data" && (
        <ConfirmDialog
          title="Clear cookies and site data?"
          body="You'll be signed out of every website in Nexus. Saved passwords stay, and TBV's own data isn't touched."
          confirm="Clear"
          danger
          onCancel={() => setClearing(null)}
          onConfirm={() => {
            setClearing(null);
            void api
              .browserClear()
              .then(() => toast("Every site's cookies and data are cleared."))
              .catch((e: unknown) => toast(String(e)));
          }}
        />
      )}
      {clearing === "forms" && (
        <ConfirmDialog
          title="Clear form history?"
          body="What Nexus remembered from forms goes. Saved passwords stay."
          confirm="Clear"
          danger
          onCancel={() => setClearing(null)}
          onConfirm={() => {
            setClearing(null);
            void api.browserClearForms().then(
              () => toast("Saved form entries cleared."),
              (error: unknown) => toast(String(error)),
            );
          }}
        />
      )}
    </AtPage>
  );
}

function SiteList({ items, empty, action, onAction }: { items: { site: string; what?: string }[]; empty: string; action: string; onAction: (site: string) => void }) {
  if (items.length === 0) return <p className="settings-row-hint">{empty}</p>;
  return (
    <ul className="at-window-list">
      {items.map(({ site, what }) => (
        <li key={site}>
          <span className="at-window-item">
            {site}
            {what && <span className="settings-row-hint">{what}</span>}
          </span>
          <button type="button" className="btn btn-quiet" onClick={() => onAction(site)}>
            {action}
          </button>
        </li>
      ))}
    </ul>
  );
}

function TrustedRedirects({ prefs }: { prefs: BrowserPrefs }) {
  const toast = useToast();
  const [site, setSite] = useState("");
  return (
    <>
      <SiteList
        empty="None yet."
        items={prefs.redirectAllowlist.map((host) => ({ site: host }))}
        action="Remove"
        onAction={(host) => protect(writeBrowserPrefs({ redirectAllowlist: prefs.redirectAllowlist.filter((s) => s !== host) }))}
      />
      <form
        className="at-window-add"
        onSubmit={(event) => {
          event.preventDefault();
          const host = redirectHost(site);
          if (!host) return toast("Enter a website host.");
          protect(writeBrowserPrefs({ redirectAllowlist: [...new Set([...prefs.redirectAllowlist, host])] }));
          setSite("");
        }}
      >
        <input className="attune-input" value={site} placeholder="example.com" aria-label="Website to trust" onChange={(event) => setSite(event.target.value)} />
        <button type="submit" className="btn btn-quiet">
          Add site
        </button>
      </form>
    </>
  );
}

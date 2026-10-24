import { useEffect, useState } from "react";
import { api } from "../api";
import { useToast } from "../components/Toast";
import {
  COME_BACK,
  DEFAULT_HOME,
  lowerFor,
  onBrowserPrefs,
  PROTECTION_LEVELS,
  protectionOf,
  readBrowserPrefs,
  SEARCH_ENGINES,
  writeBrowserPrefs,
  type BrowserPrefs,
  type ComeBack,
  type ProtectionLevel,
  type SearchEngine,
} from "../browse/browserPrefs";
import { Row, Section, Select, Toggle } from "./controls";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { clearHistory, HISTORY_KEEPS, trimHistory, type HistoryKeep } from "../browse/browserHistory";

/** Tells an open browser about a change to protection; it's read afresh when the browser next opens anyway. */
const protect = (prefs: BrowserPrefs) => void api.browserProtect(protectionOf(prefs)).catch(() => undefined);

/** Discover's browser: what it searches with, where it starts, what it blocks, and what happens to downloads. */
export function BrowserTab() {
  const toast = useToast();
  const [prefs, setPrefs] = useState(readBrowserPrefs);
  const [home, setHome] = useState(prefs.home);
  const [clearing, setClearing] = useState(false);
  useEffect(() => onBrowserPrefs(() => setPrefs(readBrowserPrefs())), []);
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

  return (
    <>
      <Section id="search" title="Searching" lede="Words typed into Discover's address box that aren't a web address are searched for.">
        <Toggle
          label="Suggest from history and bookmarks while typing"
          hint="Also your Quick Links and open tabs. Everything comes from this device, so nothing you type is sent anywhere."
          checked={prefs.suggest}
          onChange={(suggest) => writeBrowserPrefs({ suggest })}
        />
        <Row label="Search engine">
          <Select<SearchEngine>
            label="Search engine"
            value={prefs.search}
            options={SEARCH_ENGINES.map((e) => ({
              value: e.value,
              label: e.label,
            }))}
            onChange={(search) => writeBrowserPrefs({ search })}
          />
        </Row>
      </Section>
      <Section id="home" title="Home page" lede="Where new tabs start, and where Discover's home button goes.">
        <Row label="Start with">
          <Select<"start" | "site">
            label="Start with"
            value={prefs.startPage ? "start" : "site"}
            options={[
              { value: "start", label: "Discover start page" },
              { value: "site", label: "A website" },
            ]}
            onChange={(v) => writeBrowserPrefs({ startPage: v === "start" })}
          />
        </Row>
        <Toggle
          label="Show Recent Sites on the start page"
          hint={prefs.historyOn ? "The sites you visited last, from History." : "History is off, so there are none to show."}
          checked={prefs.showRecent}
          disabled={!prefs.startPage}
          onChange={(showRecent) => writeBrowserPrefs({ showRecent })}
        />
        {!prefs.startPage && (
          <label className="field">
            <span>Home page</span>
            <input
              type="url"
              spellCheck={false}
              value={home}
              aria-label="Home page"
              onChange={(e) => setHome(e.target.value)}
              onBlur={saveHome}
              onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
            />
          </label>
        )}
        {!prefs.startPage && (
          <div className="connection-actions">
            <button
              type="button"
              className="btn btn-quiet"
              disabled={prefs.home === DEFAULT_HOME}
              onClick={() => (writeBrowserPrefs({ home: DEFAULT_HOME }), toast("Your home page is Project Gutenberg again."))}
            >
              Use Project Gutenberg
            </button>
          </div>
        )}
        <Row label="Coming back to Discover" hint="Starting at the home page closes your other tabs.">
          <Select<ComeBack>
            label="Coming back to Discover"
            value={prefs.comeBack}
            options={COME_BACK}
            onChange={(comeBack) => writeBrowserPrefs({ comeBack })}
          />
        </Row>
      </Section>
      <Section id="bar" title="Discover bar" lede="The row of buttons under the address: back, forward, reload, bookmark, tabs, reader view, downloads and •••.">
        <Toggle
          label="Hide the bar while scrolling"
          hint="It hides as a page scrolls down and comes back as it scrolls up, and the arrow in the address box takes you back to the top. Off: the arrow folds the bar away."
          checked={prefs.hideBar}
          onChange={(hideBar) => writeBrowserPrefs({ hideBar })}
        />
      </Section>
      <Section id="history" title="History" lede="Pages visited and words searched for in Discover, kept on this device only. Open it from Discover's ••• menu.">
        <Toggle label="Keep a history of pages visited" checked={prefs.historyOn} onChange={(historyOn) => writeBrowserPrefs({ historyOn })} />
        <Toggle
          label="Keep searches too"
          hint="Words typed into the address box that aren't a web address."
          checked={prefs.historySearches}
          disabled={!prefs.historyOn}
          onChange={(historySearches) => writeBrowserPrefs({ historySearches })}
        />
        <Row label="Keep history for">
          <Select<HistoryKeep>
            label="Keep history for"
            value={prefs.historyKeep}
            options={HISTORY_KEEPS.map((k) => ({ value: k.value, label: k.label }))}
            onChange={(historyKeep) => {
              writeBrowserPrefs({ historyKeep });
              trimHistory(historyKeep);
            }}
          />
        </Row>
        <Row label="Clear history" hint="Bookmarks, tabs and site sign-ins stay.">
          <button type="button" className="btn btn-quiet" onClick={() => setClearing(true)}>
            Clear history
          </button>
        </Row>
        {clearing && (
          <ConfirmDialog
            title="Clear all history?"
            body="Every page and search goes from Discover's history."
            confirm="Clear"
            danger
            onCancel={() => setClearing(false)}
            onConfirm={() => {
              clearHistory();
              setClearing(false);
              toast("Discover's history is cleared.");
            }}
          />
        )}
      </Section>
      <Section id="downloads" title="Downloads" lede="Ebooks you download in Discover.">
        <Toggle
          label="Add ebooks to the library without asking"
          hint="Off: TBV asks whether to add each ebook or keep it in Downloads."
          checked={prefs.addWithoutAsking}
          onChange={(addWithoutAsking) => writeBrowserPrefs({ addWithoutAsking })}
        />
      </Section>
      <Section id="playing" title="Videos and sound" lede="What happens to a video or music playing in Discover when you go to another page.">
        <Toggle
          label="Keep playing after leaving Discover"
          hint="Off: videos and sound pause when you leave Discover."
          checked={prefs.keepPlaying}
          onChange={(keepPlaying) => writeBrowserPrefs({ keepPlaying })}
        />
      </Section>
      <Section id="protection" title="Protection" lede="What Discover blocks on the websites you visit. A site that won't work properly can have its protection lowered from Discover's ••• menu.">
        <Row label="Protection" hint={PROTECTION_LEVELS.find((p) => p.value === prefs.protection)?.hint}>
          <Select<ProtectionLevel>
            label="Protection"
            value={prefs.protection}
            options={PROTECTION_LEVELS.map((p) => ({ value: p.value, label: p.value === "strict" ? `${p.label} (recommended)` : p.label }))}
            onChange={(protection) => protect(writeBrowserPrefs({ protection }))}
          />
        </Row>
        {prefs.lowered.length > 0 && (
          <>
            <p className="muted">Sites with protection lowered:</p>
            {prefs.lowered.map((site) => (
              <Row key={site} label={site}>
                <button type="button" className="btn btn-quiet" onClick={() => protect(lowerFor(site, false))}>
                  Restore protection
                </button>
              </Row>
            ))}
          </>
        )}
      </Section>
      <Section id="sitedata" title="Site data" lede="Cookies and saved logins from websites you've visited in Discover. TBV's own data isn't touched.">
        <Row label="Clear cookies and site data" hint="You'll be signed out of every website in Discover.">
          <button
            type="button"
            className="btn btn-quiet"
            onClick={() =>
              void api
                .browserClear()
                .then(() => toast("Every site's cookies and data are cleared."))
                .catch((e: unknown) => toast(String(e)))
            }
          >
            Clear
          </button>
        </Row>
      </Section>
    </>
  );
}

// Discover's History, from its ••• menu: the pages visited and the words
// searched for, newest first by day, to look through, search, open again,
// and delete one at a time or by time.

import { useEffect, useMemo, useState } from "react";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Icon } from "../components/Icon";
import { Menu } from "../components/Menu";
import { clearHistory, dayLabel, onHistory, readHistory, removeFromHistory, type HistoryEntry } from "./browserHistory";
import { readBrowserPrefs, siteOf } from "./browserPrefs";

type Showing = "all" | "page" | "search";

/** How many rows show before "Show more". */
const AT_ONCE = 200;
const HOUR = 3_600_000;

const CLEARS: { label: string; since: number | null }[] = [
  { label: "The last hour", since: HOUR },
  { label: "Today", since: 24 * HOUR },
  { label: "The last week", since: 7 * 24 * HOUR },
  { label: "Everything", since: null },
];

export function HistoryPanel({ onGo, onClose }: { onGo: (url: string) => void; onClose: () => void }) {
  const [list, setList] = useState(readHistory);
  const [find, setFind] = useState("");
  const [showing, setShowing] = useState<Showing>("all");
  const [shown, setShown] = useState(AT_ONCE);
  const [clearing, setClearing] = useState<(typeof CLEARS)[number] | null>(null);
  useEffect(() => onHistory(() => setList(readHistory())), []);
  useEffect(() => setShown(AT_ONCE), [find, showing]);

  const matching = useMemo(() => {
    const q = find.trim().toLocaleLowerCase();
    return list.filter((e) => (showing === "all" || e.kind === showing) && (!q || e.url.toLocaleLowerCase().includes(q) || (e.title ?? "").toLocaleLowerCase().includes(q)));
  }, [list, find, showing]);

  // Grouped by day, in order.
  const days: { label: string; entries: HistoryEntry[] }[] = [];
  for (const e of matching.slice(0, shown)) {
    const label = dayLabel(e.at);
    if (days[days.length - 1]?.label !== label) days.push({ label, entries: [] });
    days[days.length - 1].entries.push(e);
  }
  const off = !readBrowserPrefs().historyOn;

  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog browser-history" role="dialog" aria-label="History" onKeyDown={(e) => e.key === "Escape" && onClose()}>
        <header className="catalogues-head">
          <h2>History</h2>
          <Menu
            label="Clear history"
            className="btn btn-quiet btn-small"
            align="end"
            trigger={
              <>
                Clear <Icon name="chevronDown" size={12} />
              </>
            }
            items={CLEARS.map((c) => ({ label: c.label, onSelect: () => setClearing(c) }))}
          />
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <Icon name="close" size={18} />
          </button>
        </header>
        <label className="search browser-history-find">
          <Icon name="search" size={16} />
          <input type="search" placeholder="Search history…" aria-label="Search history" value={find} onChange={(e) => setFind(e.target.value)} />
        </label>
        <div className="scribe-chips browser-history-kinds" role="tablist" aria-label="What to show">
          {(
            [
              ["all", "All"],
              ["page", "Pages"],
              ["search", "Searches"],
            ] as const
          ).map(([value, label]) => (
            <button key={value} type="button" role="tab" aria-selected={showing === value} className={`chip${showing === value ? " is-active" : ""}`} onClick={() => setShowing(value)}>
              {label}
            </button>
          ))}
        </div>
        {off && <p className="muted">History is off in Preferences › Browser, so new pages aren't being kept.</p>}
        {matching.length === 0 ? (
          <p className="muted">{list.length ? "Nothing in your history matches." : "Pages you visit in Discover show here."}</p>
        ) : (
          <div className="browser-history-list">
            {days.map((d) => (
              <section key={d.label}>
                <h3>{d.label}</h3>
                <ul className="browser-download-list">
                  {d.entries.map((e) => (
                    <li key={e.id}>
                      <button type="button" className="browser-history-open" onClick={() => onGo(e.url)} title={e.url}>
                        <Icon name={e.kind === "search" ? "search" : "globe"} size={16} />
                        <span className="browser-download-name">
                          <b>{e.kind === "search" ? `“${e.title}”` : e.title?.trim() || siteOf(e.url) || e.url}</b>
                          <span className="muted">
                            {new Date(e.at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })} · {e.kind === "search" ? "Searched" : siteOf(e.url) ?? e.url}
                          </span>
                        </span>
                      </button>
                      <button type="button" className="icon-btn" aria-label={`Delete ${e.title ?? e.url} from history`} onClick={() => removeFromHistory([e.id])}>
                        <Icon name="close" size={14} />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
            {matching.length > shown && (
              <button type="button" className="btn btn-quiet" onClick={() => setShown((n) => n + AT_ONCE)}>
                Show more
              </button>
            )}
          </div>
        )}
      </div>
      {clearing && (
        <ConfirmDialog
          title={clearing.since === null ? "Clear all history?" : `Clear ${clearing.label.toLocaleLowerCase()}?`}
          body="The pages and searches go from Discover's history. Bookmarks, tabs and site sign-ins stay."
          confirm="Clear"
          danger
          onCancel={() => setClearing(null)}
          onConfirm={() => {
            clearHistory(clearing.since);
            setClearing(null);
          }}
        />
      )}
    </div>
  );
}

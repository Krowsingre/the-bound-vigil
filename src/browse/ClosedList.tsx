// Tabs closed lately, for the tab grid and the start page.

import { Icon } from "../components/Icon";
import { siteOf } from "./browserPrefs";
import type { ClosedTab } from "./browserTabs";

/** Newest first; each opens again where it was in the row. */
export function ClosedList({ closed, onReopen }: { closed: ClosedTab[]; onReopen: (index: number) => void }) {
  return (
    <ul className="browser-download-list browser-history-list">
      {closed.map((c, i) => (
        <li key={`${c.closed}-${i}`}>
          <button type="button" className="browser-history-open" onClick={() => onReopen(i)} title={c.url}>
            <Icon name="undo" size={16} />
            <span className="browser-download-name">
              <b>{c.title?.trim() || siteOf(c.url) || c.url}</b>
              <span className="muted">{siteOf(c.url) ?? c.url}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

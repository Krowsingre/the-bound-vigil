// What drops down under Discover's address box while typing: Paste and go,
// then matches from History, bookmarks, Quick Links and the open tabs. All of
// it is already on this device, so nothing typed is sent anywhere.

import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import type { Bookmark, QuickLink } from "../api/types";
import { Icon, type IconName } from "../components/Icon";
import { readHistory } from "./browserHistory";
import { readableAddress, readBrowserPrefs, siteOf } from "./browserPrefs";
import { readTabs } from "./browserTabs";
import { SiteBadge } from "./SiteBadge";

export interface Suggestion {
  kind: "tab" | "bookmark" | "quick" | "history";
  url: string;
  title: string;
  /** For "Switch to tab". */
  tab?: string;
}

const MOST = 6;
const ORDER: Suggestion["kind"][] = ["tab", "quick", "bookmark", "history"];

/** Best first: the site starting with what's typed, then the title, then anywhere in the address. */
export function suggestionsFor(typed: string, from: Suggestion[]): Suggestion[] {
  const q = typed.trim().toLocaleLowerCase();
  if (!q) return [];
  const bare = q.replace(/^https?:\/\//, "").replace(/^www\./, "");
  const scored: { s: Suggestion; score: number }[] = [];
  for (const s of from) {
    const site = siteOf(s.url) ?? "";
    const address = s.url.toLocaleLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "");
    const title = s.title.toLocaleLowerCase();
    const score = site.startsWith(bare) ? 3 : title.split(/\s+/).some((w) => w.startsWith(q)) ? 2 : address.includes(bare) || title.includes(q) ? 1 : 0;
    if (score) scored.push({ s, score: score * 10 - ORDER.indexOf(s.kind) });
  }
  scored.sort((a, b) => b.score - a.score);
  const seen = new Set<string>();
  const out: Suggestion[] = [];
  for (const { s } of scored) {
    // One line per address, an open tab winning.
    if (seen.has(s.url)) continue;
    seen.add(s.url);
    out.push(s);
    if (out.length === MOST) break;
  }
  return out;
}

const ICONS: Record<Suggestion["kind"], IconName> = { tab: "arrowRight", quick: "link", bookmark: "bookmark", history: "clock" };

export function AddressSuggestions({ typed, current, onGo, onTab }: { typed: string; current: string; onGo: (text: string) => void; onTab: (id: string) => void }) {
  const [marks, setMarks] = useState<Bookmark[]>([]);
  const [links, setLinks] = useState<QuickLink[]>([]);
  const suggest = readBrowserPrefs().suggest;
  useEffect(() => {
    if (!suggest) return;
    api.bookmarks().then(setMarks, () => undefined);
    api.quickLinks().then(setLinks, () => undefined);
  }, [suggest]);

  const list = useMemo(() => {
    // Only what's been typed; the address put up on tapping isn't a search.
    if (!suggest || !typed.trim() || typed === current) return [];
    const { tabs, active } = readTabs("");
    const from: Suggestion[] = [
      ...tabs.filter((t) => t.id !== active && /^https?:/i.test(t.url)).map((t) => ({ kind: "tab" as const, url: t.url, title: t.title ?? siteOf(t.url) ?? t.url, tab: t.id })),
      ...links.map((l) => ({ kind: "quick" as const, url: l.url, title: l.title })),
      ...marks.map((m) => ({ kind: "bookmark" as const, url: m.url, title: m.title })),
      ...readHistory()
        .filter((e) => e.kind === "page")
        .slice(0, 1000)
        .map((e) => ({ kind: "history" as const, url: e.url, title: e.title?.trim() || siteOf(e.url) || e.url })),
    ];
    return suggestionsFor(typed, from);
  }, [suggest, typed, current, marks, links]);

  const paste = async () => {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (text) onGo(text);
    } catch {
      // Not allowed to read the clipboard: nothing happens.
    }
  };

  return (
    <div className="address-suggestions" role="listbox" aria-label="Suggestions" onPointerDown={(e) => e.preventDefault()}>
      <button type="button" role="option" aria-selected={false} className="address-suggestion" onClick={() => void paste()}>
        <span className="address-suggestion-icon">
          <Icon name="paste" size={18} />
        </span>
        <span className="address-suggestion-text">
          <b>Paste and go</b>
        </span>
      </button>
      {list.map((s) => (
        <button key={`${s.kind}:${s.url}`} type="button" role="option" aria-selected={false} className="address-suggestion" onClick={() => (s.tab ? onTab(s.tab) : onGo(s.url))}>
          <span className="address-suggestion-icon">
            <SiteBadge url={s.url} title={s.title} size={20} />
          </span>
          <span className="address-suggestion-text">
            <b>{s.title}</b>
            <span className="muted">{s.kind === "tab" ? "Switch to tab" : readableAddress(s.url)}</span>
          </span>
          <Icon name={ICONS[s.kind]} size={14} className="address-suggestion-kind" />
        </button>
      ))}
    </div>
  );
}

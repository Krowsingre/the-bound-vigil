// Discover's tabs: what each shows, which is in front, kept on this device
// so they come back next time.

export interface BrowserTab {
  id: string;
  url: string;
  title: string | null;
}

export interface TabsState {
  tabs: BrowserTab[];
  active: string;
}

const KEY = "tbv.browser.tabs";
/** Where the one page was kept before there were tabs. */
const LAST_KEY = "tbv.browser.last";
/** Enough for anyone; the oldest go first past this. */
export const MOST_TABS = 30;

/** A new tab's name: letters and digits, as the browser accepts. */
export function newTabId(): string {
  return `t${Math.random().toString(36).slice(2, 12)}`;
}

export function readTabs(home: string): TabsState {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<TabsState> | null;
    const tabs = (saved?.tabs ?? []).filter((t): t is BrowserTab => !!t && /^[a-z0-9-]{1,40}$/i.test(t.id) && /^https?:\/\//i.test(t.url));
    if (tabs.length) return { tabs, active: tabs.some((t) => t.id === saved?.active) ? saved!.active! : tabs[0].id };
  } catch {
    // Start afresh.
  }
  let last: string | null = null;
  try {
    last = localStorage.getItem(LAST_KEY);
  } catch {
    // Home, then.
  }
  const first = { id: newTabId(), url: last && /^https?:\/\//i.test(last) ? last : home, title: null };
  return { tabs: [first], active: first.id };
}

export function writeTabs(state: TabsState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ tabs: state.tabs.map(({ id, url, title }) => ({ id, url, title })), active: state.active }));
  } catch {
    // Forgotten after this visit.
  }
}

/** Opens a tab after the one in front and brings it forward. */
export function openTab(state: TabsState, tab: BrowserTab): TabsState {
  const at = state.tabs.findIndex((t) => t.id === state.active);
  const tabs = [...state.tabs.slice(0, at + 1), tab, ...state.tabs.slice(at + 1)];
  return { tabs: tabs.length > MOST_TABS ? tabs.filter((t) => t.id !== tabs.find((x) => x.id !== tab.id)!.id) : tabs, active: tab.id };
}

/** Closes a tab; the one beside it comes forward. The last one closed leaves a fresh tab at `home`. */
export function closeTab(state: TabsState, id: string, home: string): TabsState {
  const at = state.tabs.findIndex((t) => t.id === id);
  if (at < 0) return state;
  const tabs = state.tabs.filter((t) => t.id !== id);
  if (!tabs.length) {
    const fresh = { id: newTabId(), url: home, title: null };
    return { tabs: [fresh], active: fresh.id };
  }
  const active = state.active === id ? tabs[Math.min(at, tabs.length - 1)].id : state.active;
  return { tabs, active };
}

/** A tab's page changed. */
export function updateTab(state: TabsState, id: string, change: Partial<Omit<BrowserTab, "id">>): TabsState {
  if (!state.tabs.some((t) => t.id === id)) return state;
  return { ...state, tabs: state.tabs.map((t) => (t.id === id ? { ...t, ...change } : t)) };
}

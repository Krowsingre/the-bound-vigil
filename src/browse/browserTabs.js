import { workspaceFrame } from "../shell/workspaceFrame";
const KEY = workspaceFrame ? "tbv.browser.tabs.secondary" : "tbv.browser.tabs";
/** Where the one page was kept before there were tabs. */
const LAST_KEY = "tbv.browser.last";
const pinnedFirst = (tabs) => [...tabs.filter((t) => t.pinned), ...tabs.filter((t) => !t.pinned)];
/** A new tab's name: letters and digits, as the browser accepts. */
export function newTabId() {
    return `t${Math.random().toString(36).slice(2, 12)}`;
}
/** One tab at the home page: Discover starting afresh. */
export function freshTabs(home) {
    const id = newTabId();
    return { tabs: [{ id, url: home, title: null }], active: id };
}
export function readTabs(home) {
    try {
        const saved = JSON.parse(localStorage.getItem(KEY) ?? "null");
        const tabs = (saved?.tabs ?? []).filter((t) => !!t && /^[a-z0-9-]{1,40}$/i.test(t.id) && (/^https?:\/\//i.test(t.url) || t.url === "tbv:start"));
        if (tabs.length)
            return { tabs: pinnedFirst(tabs), active: tabs.some((t) => t.id === saved?.active) ? saved.active : tabs[0].id };
    }
    catch {
        // Start afresh.
    }
    let last = null;
    try {
        last = workspaceFrame ? null : localStorage.getItem(LAST_KEY);
    }
    catch {
        // Home, then.
    }
    const first = { id: newTabId(), url: last && /^https?:\/\//i.test(last) ? last : home, title: null };
    return { tabs: [first], active: first.id };
}
/** Private tabs aren't kept. */
export function writeTabs(state) {
    const kept = state.tabs.filter((t) => !t.private);
    const active = kept.some((t) => t.id === state.active) ? state.active : kept[0]?.id;
    try {
        localStorage.setItem(KEY, JSON.stringify({ tabs: kept.map(({ id, url, title, pinned }) => (pinned ? { id, url, title, pinned } : { id, url, title })), active }));
    }
    catch {
        // Forgotten after this visit.
    }
}
/** Append unless a contextual action names the tab to open beside. */
export function openTab(state, tab, background = false, beside) {
    const active = background ? state.active : tab.id;
    const tabs = pinnedFirst(state.tabs);
    const source = tabs.findIndex((item) => item.id === beside);
    const firstUnpinned = tabs.findIndex((item) => !item.pinned);
    const boundary = firstUnpinned < 0 ? tabs.length : firstUnpinned;
    const position = tab.pinned ? boundary : source < 0 ? tabs.length : Math.max(source + 1, boundary);
    tabs.splice(position, 0, tab);
    return { tabs, active };
}
/** Closes a tab; the one beside it comes forward. The last one closed leaves a fresh tab at `home`. */
export function closeTab(state, id, home) {
    const at = state.tabs.findIndex((t) => t.id === id);
    if (at < 0)
        return state;
    const tabs = state.tabs.filter((t) => t.id !== id);
    if (!tabs.length) {
        const fresh = { id: newTabId(), url: home, title: null };
        return { tabs: [fresh], active: fresh.id };
    }
    const active = state.active === id ? tabs[Math.min(at, tabs.length - 1)].id : state.active;
    return { tabs, active };
}
/** A tab's page changed. */
export function updateTab(state, id, change) {
    if (!state.tabs.some((t) => t.id === id))
        return state;
    return { ...state, tabs: state.tabs.map((t) => (t.id === id ? { ...t, ...change } : t)) };
}
/** Moves a tab to where `onto` is, the others making room; which tab is in front stays. */
export function moveTab(state, id, onto) {
    const tab = state.tabs.find((t) => t.id === id);
    const to = state.tabs.findIndex((t) => t.id === onto);
    if (!tab || to < 0 || id === onto || !!tab.pinned !== !!state.tabs[to].pinned)
        return state;
    const tabs = state.tabs.filter((t) => t.id !== id);
    tabs.splice(to, 0, tab);
    return { ...state, tabs };
}
/** A copy of a tab, opened at the end and brought forward. */
export function duplicateTab(state, id) {
    const tab = state.tabs.find((t) => t.id === id);
    if (!tab)
        return state;
    return openTab(state, { id: newTabId(), url: tab.url, title: tab.title, private: tab.private });
}
/** The tabs Close other tabs would close: every one but `id` and the pinned ones. */
export function othersOf(state, id) {
    return state.tabs.filter((t) => t.id !== id && !t.pinned).map((t) => t.id);
}
/** The tabs after `id` that Close tabs to the right would close, leaving pinned ones. */
export function rightOf(state, id) {
    const at = state.tabs.findIndex((t) => t.id === id);
    return at < 0 ? [] : state.tabs.slice(at + 1).filter((t) => !t.pinned).map((t) => t.id);
}
/** Closes the tabs named; `id` comes forward when the one in front went with them. */
export function closeTabs(state, ids, id) {
    const tabs = state.tabs.filter((t) => !ids.includes(t.id));
    if (!tabs.some((t) => t.id === id))
        return state;
    return { tabs, active: tabs.some((t) => t.id === state.active) ? state.active : id };
}
/** Closes every tab but `id` (and the pinned ones), and brings `id` forward. */
export function closeOtherTabs(state, id) {
    const next = closeTabs(state, othersOf(state, id), id);
    return next === state && !state.tabs.some((t) => t.id === id) ? state : { ...next, active: id };
}
/** Pins a tab (to the end of the pinned ones at the start of the row) or unpins it (to just after them). */
export function pinTab(state, id, pinned) {
    const tab = state.tabs.find((t) => t.id === id);
    if (!tab)
        return state;
    const rest = state.tabs.filter((t) => t.id !== id);
    const after = rest.filter((t) => t.pinned).length;
    rest.splice(after, 0, pinned ? { ...tab, pinned: true } : { ...tab, pinned: undefined });
    return { ...state, tabs: rest };
}
const CLOSED_KEY = workspaceFrame ? "tbv.browser.closed.secondary" : "tbv.browser.closed";
const CLOSED_CHANGED = "tbv:browser-closed";
/** How many closed tabs are remembered, newest first. */
export const MOST_CLOSED = 10;
/**
 * Recently closed tabs last only as long as the app is open: the list starts
 * empty each time TBV starts (the same as clearing it as TBV closes, and it
 * can't be missed when the app is ended some other way).
 */
function startFresh() {
    try {
        const marker = `${CLOSED_KEY}.fresh`;
        if (sessionStorage.getItem(marker))
            return;
        sessionStorage.setItem(marker, "1");
        localStorage.removeItem(CLOSED_KEY);
    }
    catch {
        // Nothing kept to clear.
    }
}
if (typeof window !== "undefined")
    startFresh();
export function readClosedTabs() {
    try {
        const saved = JSON.parse(localStorage.getItem(CLOSED_KEY) ?? "[]");
        if (!Array.isArray(saved))
            return [];
        return saved.filter((t) => !!t && typeof t.url === "string" && /^https?:\/\//i.test(t.url) && typeof t.at === "number" && typeof t.closed === "number");
    }
    catch {
        return [];
    }
}
function writeClosed(list) {
    try {
        localStorage.setItem(CLOSED_KEY, JSON.stringify(list.slice(0, MOST_CLOSED)));
    }
    catch {
        // Forgotten after this visit.
    }
    window.dispatchEvent(new CustomEvent(CLOSED_CHANGED));
}
export function onClosedTabs(listener) {
    window.addEventListener(CLOSED_CHANGED, listener);
    return () => window.removeEventListener(CLOSED_CHANGED, listener);
}
/** Remembers tabs as they close. The start page isn't worth reopening, and private tabs leave nothing behind. */
export function rememberClosed(state, ids, now = Date.now()) {
    const gone = state.tabs
        .map((t, at) => ({ t, at }))
        .filter(({ t }) => ids.includes(t.id) && !t.private && /^https?:\/\//i.test(t.url))
        .map(({ t, at }) => ({ url: t.url, title: t.title, at, closed: now, id: t.id, pinned: t.pinned }))
        .reverse();
    if (gone.length)
        writeClosed([...gone, ...readClosedTabs()]);
    return gone;
}
/** Forgets the tabs closed in the last `since` milliseconds, or all of them (clearing history clears these too). */
export function clearClosedTabs(since = null, now = Date.now()) {
    writeClosed(since === null ? [] : readClosedTabs().filter((t) => now - t.closed > since));
}
/** Puts back a list taken away by Clear (its Undo). */
export function restoreClosedTabs(list) {
    // Tabs closed since the clear stay, newest first, ahead of those put back.
    const since = readClosedTabs();
    const kept = new Set(since.map((t) => t.id).filter(Boolean));
    writeClosed([...since, ...list.filter((t) => !t.id || !kept.has(t.id))]);
}
/** Takes a closed tab off the list (the newest, without `index`) to open it again. */
export function takeClosed(index = 0) {
    const list = readClosedTabs();
    const taken = list[index] ?? null;
    if (taken)
        writeClosed(list.filter((_, i) => i !== index));
    return taken;
}
/** Removes only the entries this Undo is restoring. Older saved entries have no ID. */
export function removeClosedBatch(batch) {
    const ids = new Set(batch.map((tab) => tab.id));
    writeClosed(readClosedTabs().filter((tab) => !tab.id || !ids.has(tab.id)));
}
/** Opens a closed tab again, back where it was in the row. */
export function reopenTab(state, closed) {
    const tab = { id: newTabId(), url: closed.url, title: closed.title, pinned: closed.pinned };
    const tabs = [...state.tabs];
    const pinned = tabs.filter((t) => t.pinned).length;
    const position = tab.pinned ? Math.min(closed.at, pinned) : Math.max(pinned, Math.min(closed.at, tabs.length));
    tabs.splice(position, 0, tab);
    return { tabs, active: tab.id };
}

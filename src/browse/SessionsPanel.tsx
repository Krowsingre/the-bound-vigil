import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { BrowserSession } from "../api/types";
import { Icon } from "../components/Icon";
import { useToast } from "../components/Toast";
import { newTabId, type BrowserTab, type TabsState } from "./browserTabs";
import { Panel } from "./StartPanels";

type SessionTab = Pick<BrowserTab, "url" | "title" | "pinned">;
export type SavedSession = BrowserSession;

/** Where sessions were kept before the library kept (and synced) them. */
const key = "tbv.browser.sessions";
function validUrl(url: unknown): url is string {
  if (url === "tbv:start") return true;
  if (typeof url !== "string" || !/^https?:\/\//i.test(url)) return false;
  try {
    const parsed = new URL(url);
    return !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

export function snapshotSession(state: TabsState): Pick<SavedSession, "tabs" | "active"> {
  const open = state.tabs.filter((tab) => !tab.private && validUrl(tab.url));
  return {
    tabs: open.map(({ url, title, pinned }) => ({ url, title, pinned: !!pinned })),
    active: Math.max(0, open.findIndex((tab) => tab.id === state.active)),
  };
}

export function restoreSession(session: SavedSession): TabsState {
  const tabs = session.tabs.map((tab) => ({ ...tab, id: newTabId() }));
  return { tabs: [...tabs.filter((tab) => tab.pinned), ...tabs.filter((tab) => !tab.pinned)], active: tabs[session.active]?.id ?? tabs[0].id };
}

/** Sessions kept on this device before 0.92, to move into the library once. */
function readOldSessions(): SavedSession[] {
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? "[]") as SavedSession[];
    return saved.filter((session) => session && typeof session.id === "string" && typeof session.name === "string" &&
      Array.isArray(session.tabs) && session.tabs.length > 0 && session.tabs.every((tab) => validUrl(tab?.url)));
  } catch {
    return [];
  }
}

let moving: Promise<void> | null = null;
/** Moves the sessions kept here before into the library, so they sync too. */
function moveOldSessions(): Promise<void> {
  moving ??= (async () => {
    const old = readOldSessions();
    for (const session of old) await api.putBrowserSession(session);
    try {
      localStorage.removeItem(key);
    } catch {
      // Moved again next time; the same sessions just update.
    }
  })().catch(() => {
    moving = null;
  });
  return moving;
}

/** This device's sessions first, then each other device's, by the device they were saved on. */
function byDevice(sessions: SavedSession[]): { key: string; label: string; sessions: SavedSession[] }[] {
  const groups = new Map<string, { key: string; label: string; sessions: SavedSession[] }>();
  groups.set("here", { key: "here", label: "This device", sessions: [] });
  for (const session of sessions) {
    const id = session.device ? session.deviceId ?? session.device : "here";
    const group = groups.get(id) ?? { key: id, label: session.device ?? "Another device", sessions: [] };
    group.sessions.push(session);
    groups.set(id, group);
  }
  return [...groups.values()].filter((group) => group.sessions.length);
}

const tabCount = (n: number) => `${n} ${n === 1 ? "tab" : "tabs"}`;

type Pending =
  | { action: "load" | "delete" | "overwrite"; session: SavedSession }
  | { action: "same-name"; session: SavedSession; saving: SavedSession }
  | { action: "new" };

export function SessionsPanel({ current, onLoad, onNew, onClose }: {
  current: TabsState;
  onLoad: (session: SavedSession) => void;
  /** Closes every tab and opens one at the home page. */
  onNew: () => void;
  onClose: () => void;
}) {
  const [sessions, setSessions] = useState<SavedSession[]>([]);
  const [draft, setDraft] = useState<SavedSession | null>(null);
  /** Starting a new session once the draft is saved. */
  const [thenNew, setThenNew] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const toast = useToast();
  const snapshot = snapshotSession(current);
  const reload = useCallback(() => {
    void moveOldSessions().then(() => api.browserSessions()).then(setSessions, () => undefined);
  }, []);
  // Sessions saved on other devices arrive with sync.
  useEffect(() => {
    reload();
    return api.onSync({ libraryChanged: reload });
  }, [reload]);

  const store = async (change: () => Promise<void>, after?: () => void) => {
    try {
      await change();
      setSessions(await api.browserSessions());
      setDraft(null);
      setPending(null);
      after?.();
    } catch (e) {
      toast(`Could not save the session: ${String(e)}`);
    }
  };
  const changeTab = (index: number, change: Partial<SessionTab>) => {
    if (!draft) return;
    setDraft({ ...draft, tabs: draft.tabs.map((tab, i) => i === index ? { ...tab, ...change } : tab) });
  };
  const move = (index: number, delta: number) => {
    if (!draft) return;
    const target = index + delta;
    const tabs = [...draft.tabs];
    [tabs[index], tabs[target]] = [tabs[target], tabs[index]];
    setDraft({ ...draft, tabs, active: draft.active === index ? target : draft.active === target ? index : draft.active });
  };
  const remove = (index: number) => {
    if (!draft) return;
    const tabs = draft.tabs.filter((_, i) => i !== index);
    const active = draft.active > index ? draft.active - 1 : Math.min(draft.active, tabs.length - 1);
    setDraft({ ...draft, tabs, active });
  };
  const confirmation = (p: Pending): { text: string; buttons: { label: string; primary?: boolean; act: () => void }[] } => {
    switch (p.action) {
      case "load":
        return { text: `Open “${p.session.name}”? Your open tabs will close.`, buttons: [{ label: "Open", primary: true, act: () => onLoad(p.session) }] };
      case "delete":
        return { text: `Delete “${p.session.name}”?`, buttons: [{ label: "Delete", primary: true, act: () => void store(() => api.removeBrowserSession(p.session.id)) }] };
      case "overwrite":
        return {
          text: `Replace “${p.session.name}” with your ${tabCount(snapshot.tabs.length)} open now?`,
          buttons: [{ label: "Replace", primary: true, act: () => void store(() => api.putBrowserSession({ ...p.session, ...snapshot }), () => toast(`Saved over “${p.session.name}”.`)) }],
        };
      case "same-name":
        return {
          text: `“${p.session.name}” already exists. Replace it?`,
          buttons: [{ label: "Replace", primary: true, act: () => void store(() => api.putBrowserSession({ ...p.saving, id: p.session.id }), thenNew ? onNew : undefined) }],
        };
      case "new":
        return snapshot.tabs.length
          ? {
            text: "Save your open tabs first?",
            buttons: [
              { label: "Save", primary: true, act: () => (setPending(null), setThenNew(true), setDraft({ id: newTabId(), name: "", ...snapshot })) },
              { label: "Don't save", act: onNew },
            ],
          }
          : { text: "Close all tabs and start a new session?", buttons: [{ label: "New session", primary: true, act: onNew }] };
    }
  };

  return (
    <Panel title="Sessions" onClose={onClose}>
      {pending ? (() => {
        const ask = confirmation(pending);
        return (
          <div className="bookmark-editor">
            <p>{ask.text}</p>
            <div className="bookmark-editor-actions">
              {ask.buttons.map((b) => (
                <button key={b.label} type="button" className={`btn btn-small ${b.primary ? "btn-primary" : "btn-quiet"}`} onClick={b.act}>{b.label}</button>
              ))}
              <button type="button" className="btn btn-quiet btn-small" onClick={() => setPending(null)}>Cancel</button>
            </div>
          </div>
        );
      })() : draft ? (
        <form className="bookmark-editor" onSubmit={(event) => {
          event.preventDefault();
          const updated = { ...draft, name: draft.name.trim(), tabs: draft.tabs.map((tab) => ({ ...tab, url: tab.url.trim() })) };
          if (!updated.name || !updated.tabs.length || !updated.tabs.every((tab) => validUrl(tab.url))) {
            toast("Enter a session name and use web addresses or tbv:start for its tabs.");
            return;
          }
          // Saving under a name that's taken saves over that session, once agreed.
          const same = sessions.find((session) => session.id !== draft.id && session.name.trim().toLocaleLowerCase() === updated.name.toLocaleLowerCase());
          if (same) setPending({ action: "same-name", session: same, saving: updated });
          else void store(() => api.putBrowserSession(updated), thenNew ? onNew : undefined);
        }}>
          <label>Session name <input autoFocus required maxLength={120} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
          <ol className="browser-session-tabs">
            {draft.tabs.map((tab, index) => (
              <li key={index}>
                <label>Tab {index + 1} address <input required value={tab.url} onChange={(event) => changeTab(index, { url: event.target.value, title: null })} /></label>
                <div className="bookmark-editor-actions">
                  <label><input type="checkbox" checked={!!tab.pinned} onChange={(event) => changeTab(index, { pinned: event.target.checked })} /> Pinned</label>
                  <button type="button" className="icon-btn" disabled={index === 0} aria-label={`Move tab ${index + 1} up`} onClick={() => move(index, -1)}>↑</button>
                  <button type="button" className="icon-btn" disabled={index === draft.tabs.length - 1} aria-label={`Move tab ${index + 1} down`} onClick={() => move(index, 1)}>↓</button>
                  <button type="button" className="icon-btn" disabled={draft.tabs.length === 1} aria-label={`Remove tab ${index + 1}`} onClick={() => remove(index)}><Icon name="close" size={14} /></button>
                </div>
              </li>
            ))}
          </ol>
          <div className="bookmark-editor-actions">
            <button type="button" className="btn btn-quiet btn-small" onClick={() => setDraft({ ...draft, tabs: [...draft.tabs, { url: "", title: null }] })}>Add tab</button>
            <button type="submit" className="btn btn-primary btn-small">Save session</button>
            <button type="button" className="btn btn-quiet btn-small" onClick={() => (setDraft(null), setThenNew(false))}>Cancel</button>
          </div>
        </form>
      ) : (
        <>
          <p className="muted">Sessions sync to all your devices. Addresses may contain site-specific tokens.</p>
          <div className="bookmark-editor-actions">
            <button type="button" className="btn btn-quiet btn-small" disabled={!snapshot.tabs.length} onClick={() => (setThenNew(false), setDraft({ id: newTabId(), name: "", ...snapshot }))}>Save open tabs</button>
            <button type="button" className="btn btn-quiet btn-small" onClick={() => setPending({ action: "new" })}>New session</button>
          </div>
          <div className="browser-history-list">
            {!sessions.length && <p className="muted">No sessions saved yet.</p>}
            {byDevice(sessions).map((group) => (
              <section key={group.key}>
                <h3>{group.label}</h3>
                <ul className="browser-download-list">
                  {group.sessions.map((session) => (
                    <li key={session.id}>
                      <button type="button" className="browser-history-open" onClick={() => setPending({ session, action: "load" })}>
                        <span className="browser-download-name"><b>{session.name}</b><span className="muted">{tabCount(session.tabs.length)}</span></span>
                      </button>
                      <button type="button" className="btn btn-quiet btn-small" disabled={!snapshot.tabs.length} title="Replace this session with the tabs open now" onClick={() => setPending({ session, action: "overwrite" })}>Save over</button>
                      <button type="button" className="icon-btn" aria-label={`Edit ${session.name}`} onClick={() => (setThenNew(false), setDraft(session))}><Icon name="edit" size={15} /></button>
                      <button type="button" className="icon-btn" aria-label={`Delete ${session.name}`} onClick={() => setPending({ session, action: "delete" })}><Icon name="close" size={15} /></button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </>
      )}
    </Panel>
  );
}

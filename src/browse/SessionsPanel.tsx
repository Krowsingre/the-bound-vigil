import { useEffect, useState } from "react";
import { Icon } from "../components/Icon";
import { useToast } from "../components/Toast";
import { newTabId, type BrowserTab, type TabsState } from "./browserTabs";
import { Panel } from "./StartPanels";

type SessionTab = Pick<BrowserTab, "url" | "title" | "pinned">;
export interface SavedSession { id: string; name: string; tabs: SessionTab[]; active: number }

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

function readSessions(): SavedSession[] {
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? "[]") as SavedSession[];
    return saved.filter((session) => session && typeof session.id === "string" && typeof session.name === "string" &&
      Array.isArray(session.tabs) && session.tabs.length > 0 && session.tabs.every((tab) => validUrl(tab?.url)));
  } catch {
    return [];
  }
}

export function SessionsPanel({ current, onLoad, onClose }: { current: TabsState; onLoad: (session: SavedSession) => void; onClose: () => void }) {
  const [sessions, setSessions] = useState(readSessions);
  const [draft, setDraft] = useState<SavedSession | null>(null);
  const [pending, setPending] = useState<{ session: SavedSession; action: "load" | "delete" } | null>(null);
  const toast = useToast();
  const snapshot = snapshotSession(current);
  useEffect(() => {
    const refresh = (event: StorageEvent) => {
      if (event.key === key) setSessions(readSessions());
    };
    window.addEventListener("storage", refresh);
    return () => window.removeEventListener("storage", refresh);
  }, []);

  const store = (update: (saved: SavedSession[]) => SavedSession[]) => {
    try {
      const next = update(readSessions());
      localStorage.setItem(key, JSON.stringify(next));
      setSessions(next);
      setDraft(null);
      setPending(null);
    } catch {
      toast("Could not save Discover sessions on this device.");
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

  return (
    <Panel title="Sessions" onClose={onClose}>
      {draft ? (
        <form className="bookmark-editor" onSubmit={(event) => {
          event.preventDefault();
          const updated = { ...draft, name: draft.name.trim(), tabs: draft.tabs.map((tab) => ({ ...tab, url: tab.url.trim() })) };
          if (!updated.name || !updated.tabs.length || !updated.tabs.every((tab) => validUrl(tab.url))) {
            toast("Enter a session name and use web addresses or tbv:start for its tabs.");
            return;
          }
          store((saved) => saved.some((session) => session.id === draft.id) ? saved.map((session) => session.id === draft.id ? updated : session) : [...saved, updated]);
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
            <button type="button" className="btn btn-quiet btn-small" onClick={() => setDraft(null)}>Cancel</button>
          </div>
        </form>
      ) : pending ? (
        <div className="bookmark-editor">
          <p>{pending.action === "load" ? `Replace the open tabs in this pane with “${pending.session.name}”?` : `Delete “${pending.session.name}”?`}</p>
          <div className="bookmark-editor-actions">
            <button type="button" className="btn btn-primary btn-small" onClick={() => pending.action === "load" ? onLoad(pending.session) : store((saved) => saved.filter((session) => session.id !== pending.session.id))}>{pending.action === "load" ? "Load session" : "Delete session"}</button>
            <button type="button" className="btn btn-quiet btn-small" onClick={() => setPending(null)}>Cancel</button>
          </div>
        </div>
      ) : (
        <>
          <p className="muted">Sessions save regular tab addresses on this device. Addresses may contain site-specific tokens.</p>
          <button type="button" className="btn btn-quiet btn-small" disabled={!snapshot.tabs.length} onClick={() => setDraft({ id: newTabId(), name: "", ...snapshot })}>Save open tabs</button>
          <ul className="browser-download-list browser-history-list">
            {sessions.map((session) => (
              <li key={session.id}>
                <button type="button" className="browser-history-open" onClick={() => setPending({ session, action: "load" })}>
                  <span className="browser-download-name"><b>{session.name}</b><span className="muted">{session.tabs.length} {session.tabs.length === 1 ? "tab" : "tabs"}</span></span>
                </button>
                <button type="button" className="icon-btn" aria-label={`Edit ${session.name}`} onClick={() => setDraft(session)}><Icon name="edit" size={15} /></button>
                <button type="button" className="icon-btn" aria-label={`Delete ${session.name}`} onClick={() => setPending({ session, action: "delete" })}><Icon name="close" size={15} /></button>
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}

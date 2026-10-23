// The web version's first screen and its Sync settings: which Supabase
// project holds the library, and signing in to it. The web version has no
// library of its own, so nothing else shows until it's signed in.

import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { SupabaseProject, SyncOverview } from "../api/types";
import emblem from "../assets/emblem.svg?raw";
import { Icon } from "../components/Icon";
import { useToast } from "../components/Toast";
import { relativeTime } from "../lib/format";
import { AccountPanel } from "../settings/AccountPanel";
import { MOVE_DESKTOP_ONLY } from "../api/moveStub";
import { Section } from "../settings/controls";
import { urlOk } from "./link";

const STATE_TEXT: Record<SyncOverview["status"]["state"], string> = {
  disabled: "Not signed in",
  idle: "Up to date",
  syncing: "Syncing…",
  offline: "Offline. Changes wait here",
  attention: "Needs you to choose",
  error: "Sync failed",
};

function ProjectForm({ project, onSaved, onCancel }: { project: SupabaseProject | null; onSaved: () => void; onCancel?: () => void }) {
  const toast = useToast();
  const [draft, setDraft] = useState<SupabaseProject>(project ?? { url: "", anonKey: "" });
  const ok = urlOk(draft.url) && !!draft.anonKey.trim();
  return (
    <form
      className="settings-subpanel supabase-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ok) return;
        api.setSupabaseProject({ url: draft.url.trim().replace(/\/$/, ""), anonKey: draft.anonKey.trim() }).then(onSaved, (e: unknown) => toast(String(e)));
      }}
    >
      <h3>Your Supabase project</h3>
      <p className="settings-row-hint">
        The easy way: on your computer, open TBV's Preferences › Sync & Backup and use <strong>Copy phone link</strong>, then open that link here. Or copy the
        project URL and publishable key from the desktop app's Sync settings into these boxes.
      </p>
      <label className="field">
        <span>Project URL</span>
        <input
          value={draft.url}
          onChange={(e) => setDraft({ ...draft, url: e.target.value })}
          placeholder="https://yourproject.supabase.co"
          spellCheck={false}
          autoCapitalize="none"
          inputMode="url"
        />
      </label>
      {draft.url.trim() && !urlOk(draft.url) && <p className="form-error">That doesn't look like a Supabase project address.</p>}
      <label className="field">
        <span>Publishable key</span>
        <input
          value={draft.anonKey}
          onChange={(e) => setDraft({ ...draft, anonKey: e.target.value })}
          placeholder="sb_publishable_… (or the older anon key, eyJ…)"
          spellCheck={false}
          autoCapitalize="none"
        />
      </label>
      <div className="dialog-actions">
        {onCancel && (
          <button type="button" className="btn btn-quiet" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button type="submit" className="btn btn-primary" disabled={!ok}>
          Save
        </button>
      </div>
    </form>
  );
}

/** Shows the app once signed in, and the way to connect until then. */
export function WebGate({ children }: { children: React.ReactNode }) {
  const [overview, setOverview] = useState<SyncOverview | null>(null);
  const reload = useCallback(() => void api.syncOverview().then(setOverview), []);
  useEffect(() => {
    reload();
    return api.onSync({ status: reload });
  }, [reload]);

  if (!overview) return null;
  if (overview.signedInAs) return <>{children}</>;
  return (
    <div className="web-connect">
      <div className="web-connect-card">
        <span className="web-connect-emblem" aria-hidden dangerouslySetInnerHTML={{ __html: emblem }} />
        <h1>The Bound Vigil</h1>
        <p className="muted">Read your library on this phone. Connect to the Supabase project your desktop app syncs with, then sign in with the same account.</p>
        {overview.lastError && <p className="form-error">{overview.lastError}</p>}
        {overview.project ? (
          <>
            <p className="web-connect-project">
              <Icon name="cloud" size={16} /> {overview.project.url.replace(/^https:\/\//, "")}
              <button type="button" className="btn btn-quiet btn-small" onClick={() => void api.setSupabaseProject(null).then(reload)}>
                Change
              </button>
            </p>
            <AccountPanel signedIn={null} onChanged={reload} />
          </>
        ) : (
          <ProjectForm project={null} onSaved={reload} />
        )}
      </div>
    </div>
  );
}

/** Preferences › Sync in the web version. */
export function WebSyncTab() {
  const toast = useToast();
  const [overview, setOverview] = useState<SyncOverview | null>(null);
  const [editing, setEditing] = useState(false);
  const reload = useCallback(() => void api.syncOverview().then(setOverview), []);
  useEffect(() => {
    reload();
    return api.onSync({ status: reload });
  }, [reload]);
  if (!overview) return null;
  const state = overview.status.state;
  return (
    <Section id="provider" title="Sync" lede="The web version keeps your library in step through your Supabase project.">
      <div className="connection-details web-connection">
        <dl>
          <dt>Status</dt>
          <dd>
            <span className={`status-dot is-${state}`} aria-hidden />
            {STATE_TEXT[state]}
          </dd>
          {overview.project && (
            <>
              <dt>Project</dt>
              <dd className="mono">{overview.project.url.replace(/^https:\/\//, "")}</dd>
            </>
          )}
          <dt>Last synced</dt>
          <dd>{overview.status.lastSuccessAt ? relativeTime(overview.status.lastSuccessAt) : "Never"}</dd>
          {overview.waitingToSend > 0 && (
            <>
              <dt>Waiting</dt>
              <dd>
                {overview.waitingToSend} {overview.waitingToSend === 1 ? "change" : "changes"} to send
              </dd>
            </>
          )}
        </dl>
        {overview.lastError && <p className="form-error">{overview.lastError}</p>}
        <div className="connection-actions">
          <button type="button" className="btn btn-primary" disabled={state === "syncing"} onClick={() => void api.syncNow()}>
            <Icon name="sync" size={16} /> {state === "syncing" ? "Syncing…" : "Sync now"}
          </button>
          <button type="button" className="btn btn-quiet" onClick={() => setEditing(true)}>
            <Icon name="settings" size={16} /> Change project
          </button>
        </div>
      </div>
      {editing && (
        <ProjectForm
          project={overview.project}
          onCancel={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            toast("Saved. Sign in to that project to read its library.");
            reload();
          }}
        />
      )}
      <AccountPanel signedIn={overview.signedInAs} onChanged={reload} />
      <p className="settings-row-hint">
        Books open from the cloud, so turn on Sync book files in the desktop app for the books you want here. Once opened, a book stays in this browser for
        reading offline.
      </p>
      <p className="settings-row-hint">{MOVE_DESKTOP_ONLY}</p>
    </Section>
  );
}

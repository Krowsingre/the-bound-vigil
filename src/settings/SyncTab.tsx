import { useCallback, useEffect, useState } from "react";
import { api, isApp, isWeb } from "../api";
import type { ProviderView, SupabaseProject, SyncOverview } from "../api/types";
import { relativeTime } from "../lib/format";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Icon } from "../components/Icon";
import { useToast } from "../components/Toast";
import { useAppSettings, type ConflictRule, type SyncFrequency } from "./appSettings";
import { AccountPanel } from "./AccountPanel";
import { SupabaseProjectForm } from "./SupabaseSetup";
import { MoveSection } from "./MoveSection";
import { AlsoSection } from "./AlsoSection";
import { TidySection } from "./TidySection";
import { UsageSection } from "./UsageSection";
import { HardcoverSection } from "./HardcoverSection";
import { serviceName, SyncFolderPanel, type FolderService } from "./SyncFolderPanel";
import { PROVIDERS, type Provider } from "./providers";
import { ActionTile, RadioList, Row, Section, Select, Toggle } from "./controls";

/** Sync's state in a few words, for the connection details. */
const STATE_TEXT: Record<SyncOverview["status"]["state"], string> = {
  disabled: "Not connected",
  idle: "Up to date",
  syncing: "Syncing…",
  offline: "Offline. Changes wait here",
  attention: "Needs you to choose",
  error: "Sync failed",
};

/** The card for the service in use. */
function cardFor(view: ProviderView): Provider {
  if (view.kind === "webdav") return "custom";
  if (view.kind === "folder") return PROVIDERS.some((p) => p.id === view.service) ? (view.service as Provider) : "custom";
  return "supabase";
}

export function SyncTab({ onRestored }: { onRestored: () => void }) {
  const { settings, changeSync } = useAppSettings();
  const sync = settings.sync;
  const toast = useToast();
  const [provider, setProvider] = useState<Provider>("supabase");
  const [overview, setOverview] = useState<SyncOverview | null>(null);
  const [editing, setEditing] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(
    () =>
      api.syncOverview().then(
        (o) => {
          setOverview(o);
          return o;
        },
        () => null,
      ),
    [],
  );
  useEffect(() => {
    void reload().then((o) => {
      if (o) setProvider(cardFor(o.provider));
    });
    return api.onSync({ status: () => void reload() });
  }, [reload]);

  const project = overview?.project ?? null;
  const signedIn = overview?.signedInAs ?? null;
  const state = overview?.status.state ?? "disabled";
  const current = overview?.provider ?? { kind: "supabase" as const, service: null, location: null, username: null };
  // Supabase counts as in use once signed in; a folder or server as soon as it's chosen.
  const inUse = current.kind === "off" ? null : current.kind === "supabase" ? (signedIn ? "supabase" : null) : cardFor(current);
  const showing = provider === inUse;

  const saveProject = (next: SupabaseProject | null) =>
    api.setSupabaseProject(next).then(
      () => {
        setEditing(false);
        void reload();
        toast(next ? "Saved. Now sign in below." : "TBV no longer uses that project.");
      },
      (e: unknown) => toast(String(e)),
    );

  const run = async (work: () => Promise<boolean>, done: string) => {
    if (!isApp) return toast("This works in the desktop app. The browser preview has sample books only.");
    setBusy(true);
    try {
      if (await work()) toast(done);
    } catch (e) {
      toast(`That didn't work: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const statusOf = (id: Provider) => {
    if (id === inUse) return current.kind === "webdav" ? "Connected by WebDAV" : "Connected";
    if (id === "supabase") return signedIn ? "Signed in, not in use" : project ? "Sign in to start" : "Not connected";
    return id === "custom" ? "A folder or WebDAV" : "Uses its app's folder";
  };
  const where =
    current.kind === "folder" ? `Folder (${serviceName(current.service)})` : current.kind === "webdav" ? "WebDAV server" : "Supabase";
  const chosen = PROVIDERS.find((p) => p.id === provider)!;

  return (
    <>
      <Section
        id="provider"
        title="Sync provider"
        lede="Choose the cloud service that carries your library between devices."
        aside={
          <div className="connection-details">
            <h3>Connection details</h3>
            <dl>
              <dt>Service</dt>
              <dd>{showing ? where : chosen.name}</dd>
              <dt>Status</dt>
              <dd>
                <span className={`status-dot${showing ? ` is-${state}` : ""}`} aria-hidden />
                {showing ? STATE_TEXT[state] : provider === "supabase" && project ? "Not signed in" : "Not connected"}
              </dd>
              {showing && current.location && (
                <>
                  <dt>{current.kind === "webdav" ? "Server" : "Folder"}</dt>
                  <dd className="mono">{current.location}</dd>
                </>
              )}
              {provider === "supabase" && project && (
                <>
                  <dt>Project</dt>
                  <dd className="mono">{project.url.replace(/^https:\/\//, "")}</dd>
                </>
              )}
              {provider === "supabase" && signedIn && (
                <>
                  <dt>Account</dt>
                  <dd>{signedIn}</dd>
                </>
              )}
              <dt>Last synced</dt>
              <dd>{showing && overview?.status.lastSuccessAt ? relativeTime(overview.status.lastSuccessAt) : "Never"}</dd>
              {showing && overview && overview.waitingToSend > 0 && (
                <>
                  <dt>Waiting</dt>
                  <dd>
                    {overview.waitingToSend} {overview.waitingToSend === 1 ? "change" : "changes"} to send
                  </dd>
                </>
              )}
            </dl>
            {showing && overview?.lastError && <p className="form-error">{overview.lastError}</p>}
            <div className="connection-actions">
              {showing && (
                <button type="button" className="btn btn-primary" disabled={state === "syncing"} onClick={() => void api.syncNow()}>
                  <Icon name="sync" size={16} /> {state === "syncing" ? "Syncing…" : "Sync now"}
                </button>
              )}
              {provider === "supabase" && signedIn && !showing && (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() =>
                    void api.setSyncProvider({ kind: "supabase" }).then(
                      () => (toast("Your library now syncs through Supabase."), void reload()),
                      (e: unknown) => toast(String(e)),
                    )
                  }
                >
                  Sync through Supabase
                </button>
              )}
              {provider === "supabase" && (
                <button type="button" className="btn btn-quiet" onClick={() => setEditing(true)}>
                  <Icon name="settings" size={16} /> {project ? "Manage connection" : "Set up Supabase"}
                </button>
              )}
              {showing && current.kind !== "supabase" && (
                <button
                  type="button"
                  className="btn btn-quiet btn-danger-text"
                  onClick={() =>
                    void api.setSyncProvider({ kind: "off" }).then(
                      () => (toast("TBV no longer syncs through that folder. Nothing in it was deleted."), void reload()),
                      (e: unknown) => toast(String(e)),
                    )
                  }
                >
                  Stop syncing here
                </button>
              )}
            </div>
          </div>
        }
      >
        <div className="provider-cards" role="radiogroup" aria-label="Sync provider">
          {PROVIDERS.map((p) => (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={provider === p.id}
              className={`provider-card${provider === p.id ? " is-active" : ""}`}
              onClick={() => setProvider(p.id)}
            >
              <span className="provider-art">{p.art}</span>
              <span className="provider-text">
                <span className="settings-row-label">{p.name}</span>
                <span className="settings-row-hint">
                  <span className={`status-dot${p.id === inUse ? " is-ready" : ""}`} aria-hidden />
                  {statusOf(p.id)}
                </span>
              </span>
            </button>
          ))}
        </div>

        {provider === "supabase" && (editing || !project) && (
          <SupabaseProjectForm
            key={project?.url ?? ""}
            initial={project}
            onSave={(next) => void saveProject(next)}
            onForget={project ? () => void saveProject(null) : undefined}
            onCancel={project ? () => setEditing(false) : undefined}
          />
        )}

        {provider === "supabase" && project && !editing && (
          <AccountPanel signedIn={signedIn} project={project} onChanged={() => void reload()} />
        )}

        {provider !== "supabase" && (
          <SyncFolderPanel key={provider} service={provider as FolderService} current={current} onChanged={() => void reload()} />
        )}
      </Section>

      {overview && overview.conflicts.length > 0 && (
        <Section id="conflicts" title="Changes to choose between" lede="This device and another changed the same things. Pick which version to keep.">
          <ul className="conflict-list">
            {overview.conflicts.map((c) => (
              <li key={`${c.kind}${c.key}`} className="conflict">
                <strong>{c.what}</strong>
                <dl>
                  <dt>On this device</dt>
                  <dd>{c.here}</dd>
                  <dt>In the cloud ({relativeTime(c.cloudChangedAt)})</dt>
                  <dd>{c.cloud}</dd>
                </dl>
                <div className="conflict-actions">
                  <button type="button" className="btn btn-quiet" onClick={() => void api.resolveSyncConflict(c.kind, c.key, false).then(reload)}>
                    Keep this device's
                  </button>
                  <button type="button" className="btn btn-quiet" onClick={() => void api.resolveSyncConflict(c.kind, c.key, true).then(reload)}>
                    Keep the cloud's
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {overview && inUse && !isWeb && <AlsoSection overview={overview} onChanged={() => void reload()} />}

      <MoveSection overview={overview} inUse={inUse} onChanged={reload} />

      {overview && !isWeb && <UsageSection overview={overview} />}

      {overview && !isWeb && <TidySection overview={overview} />}

      <Section
        id="options"
        title="Sync options"
        lede="Choose what goes between your devices."
        aside={
          <div className="settings-aside-note">
            <h3>
              <Icon name="info" size={18} /> About book file syncing
            </h3>
            <p>Book files are not synced unless you turn it on. Without it, other devices list your books and their covers, and a book opens where its file is.</p>
            <p>With it on, any of your devices can open any book, and downloads it the first time. TBV never changes the files themselves. Supabase's free plan holds 1 GB, and files over 50 MB are skipped.</p>
          </div>
        }
      >
        <div className="toggle-list">
          <Toggle
            label="Sync reading progress"
            hint="Where you are in each book, and what you've finished."
            checked={sync.progress}
            onChange={(progress) => changeSync({ progress })}
          />
          <Toggle
            label="Sync notes and highlights"
            hint="Highlights, notes, book notes, personal notes and bookmarks."
            checked={sync.notes}
            onChange={(notes) => changeSync({ notes })}
          />
          <Toggle
            label="Sync collections and reading lists"
            hint="Your collections, their pictures and badges, and favourites."
            checked={sync.collections}
            onChange={(collections) => changeSync({ collections })}
          />
          <Toggle
            label="Sync library details"
            hint="Titles, authors, series and other details you've corrected."
            checked={sync.metadata}
            onChange={(metadata) => changeSync({ metadata })}
          />
          <Toggle
            label="Sync book files"
            hint="Keep a copy of your books in the cloud."
            checked={sync.bookFiles}
            onChange={(bookFiles) => changeSync({ bookFiles })}
          />
          <Toggle
            label="Sync audiobook files"
            hint="Audiobooks are large, so this is separate. Their chapters and your place sync either way."
            checked={sync.audioFiles}
            onChange={(audioFiles) => changeSync({ audioFiles })}
          />
          <Toggle
            label="Stream audiobooks that aren't on this computer"
            hint="Play them straight from the cloud without downloading. Turn off to download each one before it plays."
            checked={sync.streamAudio}
            onChange={(streamAudio) => changeSync({ streamAudio })}
          />
        </div>
      </Section>

      <Section id="behaviour" title="Sync behaviour" lede="When TBV syncs, and what happens when two devices disagree.">
        <div className="settings-columns">
          <div>
            <Row label="How often">
              <Select<SyncFrequency>
                label="How often to sync"
                value={sync.frequency}
                options={[
                  { value: "automatic", label: "Automatically (Recommended)" },
                  { value: "15min", label: "Every 15 minutes" },
                  { value: "hourly", label: "Every hour" },
                  { value: "manual", label: "Only when I ask" },
                ]}
                onChange={(frequency) => changeSync({ frequency })}
              />
            </Row>
            <div className="toggle-list">
              <Toggle label="Sync when TBV opens" checked={sync.onStartup} onChange={(onStartup) => changeSync({ onStartup })} />
              <Toggle label="Sync when TBV closes" checked={sync.onClose} onChange={(onClose) => changeSync({ onClose })} />
            </div>
          </div>
          <div>
            <h3 className="settings-subhead">When devices disagree, use</h3>
            <RadioList<ConflictRule>
              label="When devices disagree"
              value={sync.conflicts}
              options={[
                {
                  value: "recent",
                  label: "The most recent change (Recommended)",
                  hint: "Keeps the newest version automatically.",
                },
                {
                  value: "ask",
                  label: "Ask me",
                  hint: "Lets you choose which version to keep.",
                },
                {
                  value: "local",
                  label: "This device's version",
                  hint: "Always keeps what is on this computer.",
                },
                {
                  value: "cloud",
                  label: "The cloud's version",
                  hint: "Always keeps what is in the cloud.",
                },
              ]}
              onChange={(conflicts) => changeSync({ conflicts })}
            />
          </div>
        </div>
      </Section>

      <HardcoverSection />

      <Section id="backup" title="Backup & restore" lede="Keep a copy of everything on this computer, or bring one back.">
        <div className="action-tiles">
          <ActionTile
            icon={<Icon name="download" size={22} />}
            title="Export library data"
            hint="Books' details, progress, notes and collections, as a readable file."
            disabled={busy}
            onClick={() => void run(() => api.exportLibrary(), "Exported your library data.")}
          />
          <ActionTile
            icon={<Icon name="folder" size={22} />}
            title="Create a backup"
            hint="A complete copy of TBV's data, to restore later."
            disabled={busy}
            onClick={() => void run(() => api.createBackup(), "Backup saved.")}
          />
          <ActionTile
            icon={<Icon name="upload" size={22} />}
            title="Restore from a backup"
            hint="Replaces this computer's library data with a backup."
            disabled={busy}
            onClick={() => (isApp ? setRestoring(true) : toast("Restoring works in the desktop app."))}
          />
        </div>
        <p className="settings-row-hint">Backups hold your library's data, not the book files. Your books stay in the library folder.</p>
      </Section>

      {restoring && (
        <ConfirmDialog
          title="Restore from a backup?"
          body="Your library data on this computer is replaced by the backup's: progress, notes, collections and settings. Make a backup first if you might want today's data back."
          confirm="Choose a backup…"
          danger
          onCancel={() => setRestoring(false)}
          onConfirm={() => {
            setRestoring(false);
            void run(async () => {
              const done = await api.restoreBackup();
              if (done) onRestored();
              return done;
            }, "Restored from the backup.");
          }}
        />
      )}
    </>
  );
}

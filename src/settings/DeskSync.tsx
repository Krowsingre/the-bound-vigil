// Attunement › Sync, Storage & Backup and Activity on a computer (embre, 28 November): Sync &
// Backup split in three. Sync is where and how the library syncs; Storage & Backup is the room
// Supabase holds, moving the library and keeping copies of it; Activity is what's running.
// Setting up a provider, the second place, tidying, browsing and moving open in windows.
// Phones keep their Sync page as it was.

import { useCallback, useEffect, useState } from "react";
import { api, isApp, isWeb } from "../api";
import type { HomeStatus, ProviderView, SupabaseProject, SupabaseUsage, SyncOverview } from "../api/types";
import { relativeTime } from "../lib/format";
import { behindText } from "../shell/SyncMenu";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ProgressBar } from "../components/ProgressBar";
import { useToast } from "../components/Toast";
import { useAppSettings, type ConflictRule, type SyncFrequency } from "./appSettings";
import { AccountPanel } from "./AccountPanel";
import { SupabaseProjectForm } from "./SupabaseSetup";
import { MoveSection } from "./MoveSection";
import { AlsoSection } from "./AlsoSection";
import { TidySection } from "./TidySection";
import { ContentsSection } from "./ContentsSection";
import { FREE_DATABASE, FREE_FILES, size } from "./UsageSection";
import { serviceName, SyncFolderPanel, type FolderService } from "./SyncFolderPanel";
import { ALL_PROVIDERS, PROVIDERS, ProviderPicker, type Provider } from "./providers";
import { AtPage, AtPair, AtRow, AtRows, AtSection, AtSwitch } from "./attune";
import { AtWindow } from "./AtWindow";
import { Select } from "./controls";
import { LiningUpPane } from "./ActivityTab";

const STATE_TEXT: Record<SyncOverview["status"]["state"], string> = {
  disabled: "Not connected",
  idle: "Connected",
  syncing: "Syncing…",
  offline: "Offline",
  attention: "Needs you",
  error: "Sync failed",
};

/** The card for a service in use. */
function cardFor(view: ProviderView): Provider | null {
  if (view.kind === "off") return null;
  if (view.kind === "webdav") return "custom";
  if (view.kind === "cloud") return view.service === "google" ? "gdrive" : (view.service as Provider);
  if (view.kind === "folder") return PROVIDERS.some((p) => p.id === view.service) ? (view.service as Provider) : "custom";
  return "supabase";
}

const placeOf = (view: ProviderView) =>
  view.kind === "folder" ? serviceName(view.service) : view.kind === "webdav" ? "WebDAV server" : view.kind === "cloud" ? serviceName(view.service) : "Supabase";

/** Sync's state, shared by the three pages: the overview, and whether Supabase is in use. */
function useOverview() {
  const [overview, setOverview] = useState<SyncOverview | null>(null);
  const reload = useCallback(
    () =>
      api.syncOverview().then(
        (o) => (setOverview(o), o),
        () => null,
      ),
    [],
  );
  useEffect(() => {
    void reload();
    return api.onSync({ status: () => void reload() });
  }, [reload]);
  const current = overview?.provider ?? { kind: "off" as const, service: null, location: null, username: null };
  // Supabase counts as in use once signed in; a folder or server as soon as it's chosen.
  const inUse = current.kind === "supabase" ? (overview?.signedInAs ? "supabase" : null) : cardFor(current);
  const supabaseOn = !!overview && ((overview.provider.kind === "supabase" && !!overview.signedInAs) || overview.also?.provider.kind === "supabase");
  return { overview, reload, current, inUse, supabaseOn };
}

export function DeskSync() {
  const { settings, changeSync } = useAppSettings();
  const sync = settings.sync;
  const toast = useToast();
  const { overview, reload, current, inUse, supabaseOn } = useOverview();
  // The provider window: Manage… opens on the service in use, Change… on the choice of services.
  const [setup, setSetup] = useState<"manage" | "change" | null>(null);
  const [also, setAlso] = useState(false);
  const state = overview?.status.state ?? "disabled";
  const signedIn = overview?.signedInAs ?? null;

  const stop = () =>
    void (current.kind === "supabase" ? api.syncSignOut() : api.setSyncProvider({ kind: "off" })).then(
      () => (
        toast(
          current.kind === "supabase"
            ? "Signed out. Your library stays on this device."
            : current.kind === "cloud"
              ? `TBV no longer syncs with ${serviceName(current.service)} and has signed out. Nothing there was deleted.`
              : "TBV no longer syncs through that folder. Nothing in it was deleted.",
        ),
        void reload()
      ),
      (e: unknown) => toast(String(e)),
    );

  return (
    <AtPage className="at-sync">
      {overview && overview.conflicts.length > 0 && (
        <AtSection id="conflicts" title="Conflicts">
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
        </AtSection>
      )}

      <AtSection id="provider" title="Primary Sync">
        <AtRows>
          <AtRow label="Provider">
            <span className="at-sync-state">
              <span className={`status-dot is-${inUse ? state : "disabled"}`} aria-hidden />
              {inUse ? STATE_TEXT[state] : "Not connected"}
            </span>
            {inUse && <span className="at-count is-strong">{placeOf(current)}</span>}
          </AtRow>
          {inUse && (signedIn || current.username) && (
            <AtRow label="Account">
              <span className="at-count is-strong">{current.kind === "supabase" ? signedIn : current.username}</span>
            </AtRow>
          )}
          {inUse === "supabase" && overview?.project && (
            <AtRow label="Project">
              <span className="at-count is-strong">{overview.project.url.replace(/^https:\/\//, "")}</span>
            </AtRow>
          )}
          {inUse && current.location && (
            <AtRow label={current.kind === "webdav" ? "Server" : "Folder"}>
              <code className="path at-path" title={current.location}>
                {current.location}
              </code>
            </AtRow>
          )}
          {inUse && (
            <AtRow label="Last synced">
              <span className="at-count is-strong">{overview?.status.lastSuccessAt ? relativeTime(overview.status.lastSuccessAt) : "Never"}</span>
            </AtRow>
          )}
          {inUse && overview && overview.waitingToSend > 0 && (
            <AtRow label="Waiting">
              <span className="at-count is-strong">
                {overview.waitingToSend} {overview.waitingToSend === 1 ? "change" : "changes"}
              </span>
            </AtRow>
          )}
        </AtRows>
        {inUse && overview?.lastError && <p className="form-error">{overview.lastError}</p>}
        {inUse && !!overview?.status.behind?.length && <p className="settings-row-hint">{behindText(overview.status.behind)}</p>}
        <div className="at-buttons at-card-actions">
          {inUse ? (
            <>
              <button type="button" className="btn btn-primary" disabled={state === "syncing"} onClick={() => void api.syncNow()}>
                {state === "syncing" ? "Syncing…" : "Sync now"}
              </button>
              <button type="button" className="btn btn-quiet" onClick={() => setSetup("manage")}>
                Manage…
              </button>
              <button type="button" className="btn btn-quiet" onClick={() => setSetup("change")}>
                Change…
              </button>
              <button type="button" className="btn btn-quiet btn-danger-text" onClick={stop}>
                {current.kind === "supabase" || current.kind === "cloud" ? "Sign out" : "Stop syncing"}
              </button>
            </>
          ) : (
            <button type="button" className="btn btn-primary" onClick={() => setSetup("change")}>
              Set up…
            </button>
          )}
        </div>
      </AtSection>

      {overview && inUse && !isWeb && (
        <AtSection id="also" title="Second Sync">
          <AtRows>
            {overview.also ? (
              <>
                <AtRow label="Second sync">
                  <span className="at-count is-strong">{placeOf(overview.also.provider)}</span>
                  <button type="button" className="btn btn-quiet" onClick={() => setAlso(true)}>
                    Manage…
                  </button>
                </AtRow>
                <AtRow label="Last synced">
                  <span className="at-count is-strong">{overview.also.lastSuccessAt ? relativeTime(overview.also.lastSuccessAt) : "Never"}</span>
                </AtRow>
                {overview.also.waitingToSend > 0 && (
                  <AtRow label="Waiting">
                    <span className="at-count is-strong">
                      {overview.also.waitingToSend} {overview.also.waitingToSend === 1 ? "change" : "changes"}
                    </span>
                  </AtRow>
                )}
              </>
            ) : (
              <AtRow label="Second sync">
                <button type="button" className="btn btn-quiet" onClick={() => setAlso(true)}>
                  Add…
                </button>
              </AtRow>
            )}
          </AtRows>
          {overview.also?.lastError && <p className="form-error">{overview.also.lastError}</p>}
        </AtSection>
      )}

      <AtSection id="options" title="Sync Options">
        <div className="at-rows at-columns">
          <AtSwitch
            label="Sync reading"
            checked={sync.progress && sync.notes && sync.collections}
            onChange={(on) => changeSync({ progress: on, notes: on, collections: on })}
          />
          <AtSwitch label="Sync library details" checked={sync.metadata} onChange={(metadata) => changeSync({ metadata })} />
          <AtSwitch label="Sync book files" checked={sync.bookFiles} onChange={(bookFiles) => changeSync({ bookFiles })} />
          <AtSwitch label="Sync audiobook files" checked={sync.audioFiles} onChange={(audioFiles) => changeSync({ audioFiles })} />
          <AtSwitch label="Sync Nexus history" checked={sync.browserHistory} onChange={(browserHistory) => changeSync({ browserHistory })} />
          <AtSwitch label="Stream audiobooks" checked={sync.streamAudio} onChange={(streamAudio) => changeSync({ streamAudio })} />
          {supabaseOn && <AtSwitch label="Split big files" checked={sync.splitBigFiles} onChange={(splitBigFiles) => changeSync({ splitBigFiles })} />}
        </div>
        {supabaseOn && (
          <AtRows>
            <AtRow label="Sync to Supabase">
              <Select<"all" | "chosen">
                label="Sync to Supabase"
                value={sync.phoneChosenOnly ? "chosen" : "all"}
                options={[
                  { value: "all", label: "Every book on this computer" },
                  { value: "chosen", label: "Only the books I choose" },
                ]}
                onChange={(v) => changeSync({ phoneChosenOnly: v === "chosen" })}
              />
            </AtRow>
          </AtRows>
        )}
      </AtSection>

      <AtSection id="behaviour" title="Sync Behavior">
        <AtRows>
          <AtRow label="How often">
            <Select<SyncFrequency>
              label="How often to sync"
              value={sync.frequency}
              options={[
                { value: "automatic", label: "Automatically" },
                { value: "15min", label: "Every 15 minutes" },
                { value: "hourly", label: "Every hour" },
                { value: "manual", label: "Only when I ask" },
              ]}
              onChange={(frequency) => changeSync({ frequency })}
            />
          </AtRow>
          <AtSwitch label="Sync on open" checked={sync.onStartup} onChange={(onStartup) => changeSync({ onStartup })} />
          <AtSwitch label="Sync on close" checked={sync.onClose} onChange={(onClose) => changeSync({ onClose })} />
          <AtRow label="On conflict">
            <Select<ConflictRule>
              label="On conflict"
              value={sync.conflicts}
              options={[
                { value: "recent", label: "Most recent change" },
                { value: "ask", label: "Ask me" },
                { value: "local", label: "This device's version" },
                { value: "cloud", label: "The cloud's version" },
              ]}
              onChange={(conflicts) => changeSync({ conflicts })}
            />
          </AtRow>
        </AtRows>
      </AtSection>

      {!isWeb && <Devices />}

      {setup && (
        <AtWindow title={setup === "manage" && inUse ? placeOf(current) : "Sync provider"} className="at-provider-window" onClose={() => setSetup(null)}>
          <ProviderSetup overview={overview} inUse={inUse} pick={setup === "change"} onChanged={() => void reload()} />
        </AtWindow>
      )}
      {also && overview && (
        <AtWindow title="Second sync" className="at-provider-window" onClose={() => setAlso(false)}>
          <AlsoSection overview={overview} onChanged={() => void reload()} />
        </AtWindow>
      )}
    </AtPage>
  );
}

/** Choosing and setting up the service: the old Sync provider section, in a window. */
function ProviderSetup({ overview, inUse, pick, onChanged }: { overview: SyncOverview | null; inUse: Provider | null; pick: boolean; onChanged: () => void }) {
  const toast = useToast();
  const [provider, setProvider] = useState<Provider>(inUse ?? "supabase");
  const [editing, setEditing] = useState(false);
  const project = overview?.project ?? null;
  const signedIn = overview?.signedInAs ?? null;
  const current = overview?.provider ?? { kind: "supabase" as const, service: null, location: null, username: null };
  const saveProject = (next: SupabaseProject | null) =>
    api.setSupabaseProject(next).then(
      () => {
        setEditing(false);
        onChanged();
        toast(next ? "Saved. Now sign in below." : "TBV no longer uses that project.");
      },
      (e: unknown) => toast(String(e)),
    );
  const statusOf = (id: Provider) => {
    if (id === inUse) return current.kind === "webdav" ? "Connected by WebDAV" : current.kind === "cloud" ? "Signed in" : "Connected";
    if (id === "supabase") return signedIn ? "Signed in, not in use" : project ? "Sign in to start" : "Not connected";
    return id === "custom" ? "A folder or WebDAV" : id === "dropbox" || id === "gdrive" || id === "onedrive" ? "Sign in, or its app's folder" : "Uses its app's folder";
  };
  return (
    <>
      {pick && <ProviderPicker picked={provider} onPick={setProvider} label="Sync provider" status={statusOf} inUse={inUse} />}
      {pick && <h3 className="at-window-subhead">{ALL_PROVIDERS.find((p) => p.id === provider)?.name}</h3>}
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
        <>
          <AccountPanel signedIn={signedIn} project={project} onChanged={onChanged} />
          <div className="at-buttons">
            {signedIn && inUse !== "supabase" && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() =>
                  void api.setSyncProvider({ kind: "supabase" }).then(
                    () => (toast("Your library now syncs through Supabase."), onChanged()),
                    (e: unknown) => toast(String(e)),
                  )
                }
              >
                Sync through Supabase
              </button>
            )}
            <button type="button" className="btn btn-quiet" onClick={() => setEditing(true)}>
              Change project…
            </button>
          </div>
        </>
      )}
      {provider !== "supabase" && <SyncFolderPanel key={provider} service={provider as FolderService} current={current} onChanged={onChanged} />}
    </>
  );
}

/** Streaming to a phone on the same Wi-Fi, and pairing it: shown only while it's on. */
function Devices() {
  const [status, setStatus] = useState<HomeStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = (work: () => Promise<HomeStatus>) => {
    setError(null);
    work().then(setStatus, (e: unknown) => setError(String(e).replace(/^Error: /, "")));
  };
  useEffect(() => {
    run(() => api.homeStatus());
    return api.onHomeChanged(() => run(() => api.homeStatus()));
  }, []);
  const address = status?.addresses[0];
  return (
    <AtSection id="home" title="Devices" also={["phone"]}>
      <AtRows>
        <AtSwitch label="Stream to mobile" checked={Boolean(status?.on)} disabled={!isApp && status === null} onChange={(on) => run(() => api.setHome(on))} />
        {status?.on && address && (
          <AtRow label="Pairing">
            <div className="at-pairing">
              {status.qr ? (
                <span className="home-qr" aria-label="QR code to open TBV on your phone" dangerouslySetInnerHTML={{ __html: status.qr }} />
              ) : (
                <div className="home-qr home-qr-used">
                  <span className="muted">Code used</span>
                </div>
              )}
              <div className="at-pairing-text">
                <span className="mono">{address}</span>
                <span className="muted">{status.code ? `Code ${status.code.replace(/(\d{3})(\d{3})/, "$1 $2")}` : "Code used"}</span>
                <div className="at-buttons">
                  <button type="button" className="btn btn-quiet" onClick={() => run(() => api.newHomeCode())}>
                    New code
                  </button>
                  {status.phones > 0 && (
                    <button type="button" className="btn btn-quiet btn-danger-text" onClick={() => run(() => api.forgetHomePhones())}>
                      Forget phones
                    </button>
                  )}
                </div>
              </div>
            </div>
          </AtRow>
        )}
      </AtRows>
      {status?.problem && <p className="form-error">{status.problem}</p>}
      {error && <p className="form-error">{error}</p>}
      {status?.on && !address && <p className="form-error">This computer doesn't seem to be on a network. Connect it to your Wi-Fi, then turn this off and on.</p>}
    </AtSection>
  );
}

export function DeskStorage({ onRestored, onOpenPlaces }: { onRestored: () => void; onOpenPlaces?: () => void }) {
  const toast = useToast();
  const { overview, reload, inUse, supabaseOn } = useOverview();
  const [open, setOpen] = useState<"tidy" | "browse" | "migrate" | "backup" | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [busy, setBusy] = useState(false);
  const close = () => setOpen(null);
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
  const supabase = overview && supabaseOn && !isWeb;
  const migration = (
    <AtSection id="move" title="Library Migration">
      <AtRows>
        <AtRow label="Move my library">
          <button type="button" className="btn btn-quiet" onClick={() => setOpen("migrate")}>
            Move…
          </button>
        </AtRow>
        <AtRow label="Keep a copy there">
          <button type="button" className="btn btn-quiet" onClick={() => setOpen("backup")}>
            Copy…
          </button>
        </AtRow>
      </AtRows>
    </AtSection>
  );
  return (
    <AtPage className="at-storage">
      {supabase && <SupabaseStorage />}
      {supabase ? (
        <AtPair>
          <AtSection id="tidy" title="Cloud Management" also={["contents"]}>
            <AtRows>
              <AtRow label="Tidy up Supabase">
                <button type="button" className="btn btn-quiet" onClick={() => setOpen("tidy")}>
                  Tidy…
                </button>
              </AtRow>
              <AtRow label="What's in Supabase">
                <button type="button" className="btn btn-quiet" onClick={() => setOpen("browse")}>
                  Browse…
                </button>
              </AtRow>
            </AtRows>
          </AtSection>
          {migration}
        </AtPair>
      ) : (
        migration
      )}
      <AtSection id="backup" title="Backup & Restore" also={["places"]}>
        <AtRows>
          {onOpenPlaces && (
            <AtRow label="Library location">
              <button type="button" className="btn btn-quiet" onClick={onOpenPlaces}>
                Show…
              </button>
            </AtRow>
          )}
          <AtRow label="Export library data">
            <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => void run(() => api.exportLibrary(), "Exported your library data.")}>
              Export…
            </button>
          </AtRow>
          <AtRow label="Back up library data">
            <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => void run(() => api.createBackup(), "Backup saved.")}>
              Back up…
            </button>
          </AtRow>
          <AtRow label="Restore library data">
            <button type="button" className="btn btn-quiet btn-danger-text" disabled={busy} onClick={() => (isApp ? setRestoring(true) : toast("Restoring works in the desktop app."))}>
              Restore…
            </button>
          </AtRow>
        </AtRows>
      </AtSection>
      {open === "tidy" && overview && (
        <AtWindow title="Tidy up Supabase" onClose={close}>
          <TidySection overview={overview} />
        </AtWindow>
      )}
      {open === "browse" && overview && (
        <AtWindow title="What's in Supabase" className="at-wide-window" onClose={close}>
          <ContentsSection overview={overview} />
        </AtWindow>
      )}
      {(open === "migrate" || open === "backup") && (
        <AtWindow title={open === "migrate" ? "Move my library" : "Keep a copy there"} className="at-provider-window" onClose={close}>
          <MoveSection overview={overview} inUse={inUse} onChanged={reload} startAs={open} onCancel={close} />
        </AtWindow>
      )}
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
    </AtPage>
  );
}

function SupabaseStorage() {
  const [usage, setUsage] = useState<SupabaseUsage | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const check = async () => {
    setChecking(true);
    setProblem(null);
    try {
      setUsage(await api.supabaseUsage());
    } catch (e) {
      setProblem(String(e));
    } finally {
      setChecking(false);
    }
  };
  useEffect(() => void check(), []);
  const held = usage
    ? [`${usage.files.toLocaleString()} files`, `books ${size(usage.bookBytes)}`, ...(usage.audioBytes ? [`audiobooks ${size(usage.audioBytes)}`] : []), `pictures ${size(usage.pictureBytes)}`].join(" · ")
    : null;
  return (
    <AtSection id="usage" title="Supabase Storage" also={["storage"]}>
      <AtRows>
        {usage && (
          <>
            <AtRow label="Files">
              <span className="at-meter">
                <ProgressBar value={usage.fileBytes / FREE_FILES} label={`Files: ${size(usage.fileBytes)} of ${size(FREE_FILES)}`} />
              </span>
              <span className="at-count">
                {size(usage.fileBytes)} of {size(FREE_FILES)}
              </span>
            </AtRow>
            {usage.databaseBytes !== null && (
              <AtRow label="Database">
                <span className="at-meter">
                  <ProgressBar value={usage.databaseBytes / FREE_DATABASE} label={`Database: ${size(usage.databaseBytes)} of ${size(FREE_DATABASE)}`} />
                </span>
                <span className="at-count">
                  {size(usage.databaseBytes)} of {size(FREE_DATABASE)}
                </span>
              </AtRow>
            )}
            <AtRow label="Files held">
              <span className="at-count is-strong">{held}</span>
            </AtRow>
          </>
        )}
      </AtRows>
      {problem && <p className="settings-row-hint">Couldn't check: {problem}</p>}
      <div className="at-buttons at-card-actions">
        <button type="button" className="btn btn-quiet" disabled={checking} onClick={() => void check()}>
          {checking ? "Checking…" : "Check again"}
        </button>
      </div>
    </AtSection>
  );
}

/** Imports, Sync and Confluence, one above another; each list scrolls in its own frame. */
export function DeskActivity({ imports, sync }: { imports: React.ReactNode; sync: React.ReactNode }) {
  return (
    <AtPage className="at-activity">
      <AtSection id="imports" title="Imports" also={["activity"]}>
        <div className="at-activity-frame">{imports}</div>
      </AtSection>
      {api.kind !== "web" && (
        <AtSection id="sync-activity" title="Sync">
          <div className="at-activity-frame">{sync}</div>
        </AtSection>
      )}
      {(isApp || api.kind === "preview") && (
        <AtSection id="lining" title="Confluence">
          <div className="at-activity-frame">
            <LiningUpPane />
          </div>
        </AtSection>
      )}
    </AtPage>
  );
}

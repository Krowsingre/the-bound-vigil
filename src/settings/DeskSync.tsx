// Attunement › Sync, Storage & Backup and Activity on a computer (embre, 28 November): Sync &
// Backup split in three. Sync is where and how the library syncs; Storage & Backup is the room
// Supabase holds, moving the library and keeping copies of it; Activity is what's running.
// Setting up a provider, the second place, tidying, browsing and moving open in windows.
// Phones keep their Sync page as it was.

import { useCallback, useEffect, useState } from "react";
import { api, isApp, isWeb } from "../api";
import type { CloudSpace, DeviceSpace, HomeStatus, ProviderView, Space, SupabaseProject, SupabaseUsage, SyncOverview } from "../api/types";
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
import { disconnectLabel, serviceName, SyncFolderPanel, type FolderService } from "./SyncFolderPanel";
import { ALL_PROVIDERS, FIRST_CARD, PROVIDERS, ProviderPicker, type Provider } from "./providers";
import { AtPage, AtPair, AtRow, AtRows, AtSection, AtSwitch, usePhone } from "./attune";
import { AtWindow } from "./AtWindow";
import { Select } from "./controls";
import { LiningUpPane } from "./ActivityTab";
import { thisDevice } from "./thisDevice";

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
  // The row shows only when there's a name to show in it (embre, 28 November).
  const accountName = current.kind === "supabase" ? signedIn : current.username;
  const phone = usePhone();

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
          {inUse && accountName && (
            <AtRow label="Account">
              <span className="at-count is-strong">{accountName}</span>
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
        {inUse && overview?.lastError && (
          <div className="sync-problem">
            <p className="form-error">{overview.lastError}</p>
            <button type="button" className="btn btn-quiet btn-small" disabled={state === "syncing"} onClick={() => void api.syncNow()}>
              Try again
            </button>
          </div>
        )}
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
                {current.kind === "supabase" || current.kind === "cloud" ? "Sign out" : disconnectLabel(current)}
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
        {supabaseOn && !phone && (
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
        {(() => {
          const often = (
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
          );
          const conflict = (
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
          );
          const onOpen = <AtSwitch label="Sync on open" checked={sync.onStartup} onChange={(onStartup) => changeSync({ onStartup })} />;
          const onClose = <AtSwitch label="Sync on close" checked={sync.onClose} onChange={(onClose) => changeSync({ onClose })} />;
          if (phone)
            return (
              <AtRows>
                {often}
                {onOpen}
                {onClose}
                {conflict}
              </AtRows>
            );
          // Two columns in the one card (embre, 28 November).
          return (
            <div className="at-split">
              <div className="at-split-col">
                <AtRows>
                  {often}
                  {conflict}
                </AtRows>
              </div>
              <div className="at-split-col">
                <AtRows>
                  {onOpen}
                  {onClose}
                </AtRows>
              </div>
            </div>
          );
        })()}
      </AtSection>

      {!isWeb && !phone && <Devices />}

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
  const [provider, setProvider] = useState<Provider>(inUse ?? FIRST_CARD);
  const [editing, setEditing] = useState(false);
  const project = overview?.project ?? null;
  const signedIn = overview?.signedInAs ?? null;
  const current: ProviderView = overview?.provider ?? { kind: "off", service: null, location: null, username: null };
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
  const phone = usePhone();
  const { overview, reload, inUse, supabaseOn, current } = useOverview();
  const clouds = useCloudSpace();
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
  const backup = (
    <AtSection id="backup" title="Backup & Restore" also={["places"]}>
        <AtRows>
          {phone ? (
            <AtRow label="Library location">
              <span className="at-count">{inUse ? placeOf(current) : `On this ${thisDevice()}`}</span>
            </AtRow>
          ) : (
            onOpenPlaces && (
              <AtRow label="Library location">
                <button type="button" className="btn btn-quiet" onClick={onOpenPlaces}>
                  Show…
                </button>
              </AtRow>
            )
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
  );
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
      {phone && backup}
      {phone && <SpaceSections clouds={clouds} />}
      {!phone && supabase && <SupabaseStorage split={clouds.list?.find((c) => c.provider.kind === "supabase") ?? null} />}
      {phone && supabase && (
        <AtSection id="tidy" title="Cloud Management" also={["contents"]}>
          <AtRows>
            <AtRow label="Tidy up Supabase">
              <button type="button" className="btn btn-quiet" onClick={() => setOpen("tidy")}>
                Tidy
              </button>
            </AtRow>
            <AtRow label="What's in Supabase">
              <button type="button" className="btn btn-quiet" onClick={() => setOpen("browse")}>
                Browse
              </button>
            </AtRow>
          </AtRows>
        </AtSection>
      )}
      {phone && supabase && <SupabaseStorage split={clouds.list?.find((c) => c.provider.kind === "supabase") ?? null} />}
      {phone ? null : supabase ? (
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
      {!phone && backup}
      {!phone && <SpaceSections clouds={clouds} />}
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

function SupabaseStorage({ split }: { split: CloudSpace | null }) {
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
            {split?.space ? (
              SPACE_KINDS.filter((k) => k.key !== "app").map((k) => (
                <AtRow key={k.key} label={k.label}>
                  <span className="at-count">{size(split.space![k.key as keyof Space])}</span>
                </AtRow>
              ))
            ) : (
              <AtRow label="Files held">
                <span className="at-count is-strong">{held}</span>
              </AtRow>
            )}
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

/**
 * Each Activity list as tall as a whole number of its rows, and never less than one,
 * so no row is ever cut part way (embre, 28 November). Measured again whenever the
 * window or a list changes.
 */
function useWholeRows(on: boolean) {
  useEffect(() => {
    if (!on) return;
    const page = document.querySelector<HTMLElement>(".at-activity:not(.is-ios)");
    if (!page) return;
    let frame = 0;
    const fit = () => {
      frame = 0;
      const lists = [...page.querySelectorAll<HTMLElement>(".activity-pane > .imports-group")];
      const cards = [...page.querySelectorAll<HTMLElement>(":scope > .at-section:not(.is-folded)")];
      // The least each list can be: its heading and one whole row (a list with no rows,
      // just a line saying so, is never cut at all).
      const least = lists.map((list) => {
        const rows = list.querySelectorAll<HTMLElement>("li");
        if (!rows.length) return { list, min: list.scrollHeight, above: 0, row: 0 };
        const box = list.getBoundingClientRect();
        const first = rows[0].getBoundingClientRect();
        const above = first.top - box.top + list.scrollTop;
        const row = rows.length > 1 ? rows[1].getBoundingClientRect().top - first.top : first.height;
        return { list, min: Math.ceil(above + Math.max(row, 0)), above, row };
      });
      // Each card and the page drawn at their least for a moment, to measure them…
      for (const { list, min } of least) Object.assign(list.style, { flex: "0 0 auto", height: `${min}px`, minHeight: "", maxHeight: "" });
      for (const card of cards) Object.assign(card.style, { flex: "none", minHeight: "" });
      Object.assign(page.style, { flex: "none", minHeight: "" });
      const cardLeast = cards.map((card) => card.offsetHeight);
      const pageLeast = page.offsetHeight;
      // …then put back to share the window, never smaller than that.
      for (const { list, min } of least) Object.assign(list.style, { flex: "", height: "", minHeight: `${min}px` });
      cards.forEach((card, i) => Object.assign(card.style, { flex: "", minHeight: `${cardLeast[i]}px` }));
      Object.assign(page.style, { flex: "", minHeight: `${pageLeast}px` });
      // A list that had to give way shows whole rows only.
      for (const { list, above, row } of least) {
        if (row <= 0 || list.scrollHeight <= list.clientHeight + 1) continue;
        const whole = Math.max(1, Math.floor((list.clientHeight - above) / row));
        list.style.maxHeight = `${Math.ceil(above + whole * row)}px`;
      }
    };
    const soon = () => {
      if (!frame) frame = requestAnimationFrame(fit);
    };
    const sized = new ResizeObserver(soon);
    sized.observe(page);
    page.querySelectorAll(".at-activity-frame").forEach((f) => sized.observe(f));
    const changed = new MutationObserver(soon);
    changed.observe(page, { childList: true, subtree: true });
    window.addEventListener("resize", soon);
    soon();
    return () => {
      cancelAnimationFrame(frame);
      sized.disconnect();
      changed.disconnect();
      window.removeEventListener("resize", soon);
    };
  }, [on]);
}

/** Imports, Sync and Confluence, one above another; each list scrolls in its own frame. */
export function DeskActivity({ imports, sync }: { imports: React.ReactNode; sync: React.ReactNode }) {
  useWholeRows(!usePhone());
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

/** The kinds of content in a breakdown, each with its colour (embre's approved pictures, 28 November). */
const SPACE_KINDS: { key: keyof DeviceSpace; label: string; color: string }[] = [
  { key: "app", label: "App", color: "#5b7fa6" },
  { key: "ebooks", label: "Ebooks", color: "#a0714f" },
  { key: "documents", label: "Documents", color: "#6d8b5e" },
  { key: "audiobooks", label: "Audiobooks", color: "#8a8f98" },
  { key: "other", label: "Other", color: "#c0663f" },
];

/** What each sync place holds by type, read once when the page opens. */
function useCloudSpace() {
  const [list, setList] = useState<CloudSpace[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    api.cloudSpace().then(
      (found) => live && setList(found),
      (e: unknown) => live && (setProblem(String(e).replace(/^Error: /, "")), setList([])),
    );
    return () => {
      live = false;
    };
  }, []);
  return { list, problem };
}

/** A breakdown: the total, a bar split by type, and a row for each type with its size. */
function SpaceBreakdown({ space, withApp }: { space: Space | DeviceSpace; withApp: boolean }) {
  const kinds = SPACE_KINDS.filter((k) => withApp || k.key !== "app");
  const sizes = kinds.map((k) => (space as DeviceSpace)[k.key] ?? 0);
  const total = sizes.reduce((a, b) => a + b, 0);
  return (
    <>
      <AtRow label="Total">
        <span className="at-count">{size(total)}</span>
      </AtRow>
      <div className="at-space-bar" aria-hidden>
        {kinds.map((k, i) => (sizes[i] > 0 ? <i key={k.key} style={{ width: `${(sizes[i] / Math.max(total, 1)) * 100}%`, background: k.color }} /> : null))}
      </div>
      {kinds.map((k, i) => (
        <AtRow
          key={k.key}
          label={
            <span className="at-space-kind">
              <span className="at-space-key" style={{ background: k.color }} aria-hidden />
              {k.label}
            </span>
          }
        >
          <span className="at-count">{size(sizes[i])}</span>
        </AtRow>
      ))}
    </>
  );
}

/** On this device, and in each sync place but Supabase (which has its own card), by type (embre, 28 November). */
function SpaceSections({ clouds }: { clouds: { list: CloudSpace[] | null; problem: string | null } }) {
  const [here, setHere] = useState<DeviceSpace | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    api.deviceSpace().then(
      (found) => live && setHere(found),
      (e: unknown) => live && setProblem(String(e).replace(/^Error: /, "")),
    );
    return () => {
      live = false;
    };
  }, []);
  const places = (clouds.list ?? []).filter((c) => c.provider.kind !== "supabase");
  // Side by side on a computer; a phone stacks them anyway.
  return (
    <AtPair>
      <AtSection id="space-here" title={`On this ${thisDevice()}`} also={["space"]}>
        <AtRows>{here ? <SpaceBreakdown space={here} withApp /> : <AtRow label={problem ? `Couldn't count: ${problem}` : "Counting…"} />}</AtRows>
      </AtSection>
      {places.map((c, i) => (
        <AtSection key={`${placeOf(c.provider)}${i}`} id={`space-cloud-${i}`} title={`In ${placeOf(c.provider)}`}>
          <AtRows>{c.space ? <SpaceBreakdown space={c.space} withApp={false} /> : <AtRow label={`Couldn't count: ${c.problem ?? "no answer"}`} />}</AtRows>
        </AtSection>
      ))}
    </AtPair>
  );
}

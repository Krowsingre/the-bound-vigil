// Preferences › Sync › Second sync: a second place kept in step at the same
// time as the first. For example, iCloud Drive holds every file (audiobooks
// too) while Supabase carries the library to a phone.

import { useState } from "react";
import { api, isApp } from "../api";
import type { ProviderChoice, SyncOverview } from "../api/types";
import { relativeTime } from "../lib/format";
import { Icon } from "../components/Icon";
import { useToast } from "../components/Toast";
import { useAppSettings } from "./appSettings";
import { serviceName, SyncFolderPanel, type FolderService } from "./SyncFolderPanel";
import { PROVIDERS, ProviderPicker, type Provider } from "./providers";
import { Section, Toggle } from "./controls";

export function AlsoSection({ overview, onChanged }: { overview: SyncOverview; onChanged: () => void }) {
  const { settings, changeSync } = useAppSettings();
  const sync = settings.sync;
  const toast = useToast();
  const [picked, setPicked] = useState<Provider | null>(null);
  const also = overview.also;
  const main = overview.provider;

  const choose = async (choice: ProviderChoice | null, where: string) => {
    if (!isApp) toast("This is the browser preview: nothing is synced here.");
    try {
      const joined = await api.setAlsoSync(choice);
      toast(
        !choice
          ? "TBV no longer syncs with the second place. Nothing there was deleted."
          : joined
            ? `Joined the library already in ${where}. Syncing now.`
            : `Your library now also syncs with ${where}.`,
      );
      setPicked(null);
      onChanged();
    } catch (e) {
      toast(`That didn't work: ${String(e)}`);
    }
  };

  // The place syncing now, as its card.
  const alsoId: Provider | null = !also
    ? null
    : also.provider.kind === "supabase"
      ? "supabase"
      : also.provider.kind === "folder" && PROVIDERS.some((p) => p.id === also.provider.service)
        ? (also.provider.service as Provider)
        : "custom";
  const pick = (p: Provider) => setPicked(p === alsoId ? null : p);

  const where = (kind: string, service: string | null) =>
    kind === "folder" ? serviceName(service) : kind === "webdav" ? "your WebDAV server" : "Supabase";

  return (
    <Section
      id="also"
      title="Second sync"
      lede="Keep a second place in step at the same time. For example, iCloud Drive can hold every file while Supabase carries your library to your phone."
    >
      {also && !picked ? (
        <>
          <ProviderPicker
            picked={alsoId}
            onPick={pick}
            label="Second place to sync with"
            status={(p) => (p === alsoId ? "Syncing" : "")}
            inUse={alsoId}
          />
          <div className="settings-subpanel">
            <h3>Also syncing with {where(also.provider.kind, also.provider.service)}</h3>
            <dl className="also-details">
              {also.provider.location && (
                <>
                  <dt>{also.provider.kind === "webdav" ? "Server" : "Folder"}</dt>
                  <dd className="mono">{also.provider.location}</dd>
                </>
              )}
              <dt>Last synced</dt>
              <dd>{also.lastSuccessAt ? relativeTime(also.lastSuccessAt) : "Never"}</dd>
              {also.waitingToSend > 0 && (
                <>
                  <dt>Waiting</dt>
                  <dd>
                    {also.waitingToSend} {also.waitingToSend === 1 ? "change" : "changes"} to send
                  </dd>
                </>
              )}
            </dl>
            {also.lastError && <p className="form-error">{also.lastError}</p>}
            <p className="settings-row-hint">
              Your progress, notes, collections and covers go to both places. Choose which files go to this one here; the Sync
              options below apply to both.
            </p>
            <div className="toggle-list">
              <Toggle
                label="Send book files here"
                hint="Ebooks and documents, so other devices on this place can open them."
                checked={sync.alsoBookFiles}
                onChange={(alsoBookFiles) => changeSync({ alsoBookFiles })}
              />
              <Toggle
                label="Send audiobook files here"
                hint="Audiobooks are large. Leave this off if this place has little room, such as Supabase's free plan."
                checked={sync.alsoAudioFiles}
                onChange={(alsoAudioFiles) => changeSync({ alsoAudioFiles })}
              />
            </div>
            <div className="dialog-actions">
              <button type="button" className="btn btn-quiet btn-danger-text" onClick={() => void choose(null, "")}>
                Stop the second sync
              </button>
            </div>
          </div>
        </>
      ) : (
        <>
          <ProviderPicker picked={picked} onPick={pick} label="Second place to sync with" />
          {picked === "supabase" &&
            (main.kind === "supabase" ? (
              <p className="settings-row-hint">Supabase is already your main sync. Pick another place for the second one.</p>
            ) : overview.signedInAs ? (
              <div className="dialog-actions">
                <button type="button" className="btn btn-primary" onClick={() => void choose({ kind: "supabase" }, "Supabase")}>
                  <Icon name="sync" size={16} /> Also sync through Supabase
                </button>
              </div>
            ) : (
              <p className="settings-row-hint">
                First set up Supabase and sign in on its card under Sync provider above. Signing in there won't move your main
                sync.
              </p>
            ))}
          {picked && picked !== "supabase" && (
            <SyncFolderPanel
              key={picked}
              service={picked as FolderService}
              current={{ kind: "off", service: null, location: null, username: null }}
              onChanged={onChanged}
              onUse={(choice) => void choose(choice, choice.kind === "webdav" ? "your WebDAV server" : serviceName(picked))}
              useLabel="Also sync here"
            />
          )}
        </>
      )}
    </Section>
  );
}

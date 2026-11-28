// Sync activity: what sync is doing right now in each place, file by file,
// and the files it moved lately. Kept only while TBV is open.

import { useEffect, useState } from "react";
import { api } from "../api";
import type { FileActivity, PlaceActivity, SyncActivity as Activity, SyncRestart, SyncStatus } from "../api/types";
import { Icon } from "../components/Icon";
import { ProgressBar } from "../components/ProgressBar";
import { relativeTime } from "../lib/format";
import { placeWords } from "../settings/SyncFolderPanel";
import { percentOf, placeProgress } from "./progress";

const NOTHING: Activity = { running: false, startedAt: null, finishedAt: null, places: [], recent: [], changes: [] };

function size(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function placeName(place: PlaceActivity): string {
  const p = place.provider;
  return placeWords(p, true);
}

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

function stepText(place: PlaceActivity): string {
  if (place.finished) return place.problem ? "Couldn't finish" : "Done";
  switch (place.step) {
    case "receiving":
      return "Getting changes from other devices…";
    case "sending":
      return "Sending this device's changes…";
    case "files":
      return place.filesTotal ? `Moving files: ${place.filesDone} of ${place.filesTotal}` : "Checking files…";
    default:
      return "Connecting…";
  }
}

function fileText(f: FileActivity, now = false): string {
  if (f.problem) return f.problem;
  const verb = f.direction === "up" ? (now ? "Uploading" : "Uploaded") : f.direction === "down" ? (now ? "Downloading" : "Downloaded") : now ? "Removing" : "Removed";
  return f.bytes && f.direction !== "erase" ? `${verb} · ${size(f.bytes)}` : verb;
}

function fileIcon(f: FileActivity) {
  return f.problem ? "warning" : f.direction === "up" ? "upload" : f.direction === "down" ? "download" : "trash";
}

function Place({ place }: { place: PlaceActivity }) {
  // Changes counted against what was waiting; files by count, as download
  // sizes aren't known until they arrive (embre, 28 November).
  const progress = placeProgress(place);
  const moving = !place.finished && place.step === "files" && place.filesTotal > 0;
  return (
    <section className={`imports-summary sync-place${place.problem ? " is-bad" : ""}`} aria-live="polite">
      <div className="imports-summary-text">
        <p className="eyebrow">{place.lane === "main" ? "Main sync" : "Second sync"}</p>
        <h2>{placeName(place)}</h2>
        {place.provider.location && <p className="settings-row-hint mono">{place.provider.location}</p>}
        <p className="settings-row-hint">
          {progress ? (progress.fraction === null ? progress.text : `${progress.text} (${percentOf(progress.fraction)})`) : stepText(place)}
          {place.finished && (place.received > 0 || place.sent > 0) &&
            ` · ${plural(place.received, "change")} received, ${plural(place.sent, "change")} sent`}
        </p>
      </div>
      {progress?.fraction != null && <ProgressBar value={progress.fraction} label={`${progress.text}, ${placeName(place)}`} />}
      {moving && place.bytesTotal > 0 && (
        <p className="settings-row-hint">
          {size(place.bytesDone)} of {size(place.bytesTotal)} uploaded
        </p>
      )}
      {place.current && (
        <div className="import-row is-current">
          <Icon name={fileIcon(place.current)} size={18} />
          <div className="import-text">
            <span className="import-name">{place.current.what}</span>
            <span className="import-detail">{fileText(place.current, true)}…</span>
          </div>
        </div>
      )}
      {place.problem && (
        <div className="sync-problem">
          <p className="form-error">{place.problem}</p>
          <button type="button" className="btn btn-quiet btn-small" onClick={() => void api.syncNow()}>
            Try again
          </button>
        </div>
      )}
    </section>
  );
}

export function SyncActivity({
  sync,
  onOpenSyncSettings,
  embedded = false,
}: {
  sync: SyncStatus | null;
  onOpenSyncSettings: () => void;
  /** Shown inside Attune › Activity, which gives the page its name. */
  embedded?: boolean;
}) {
  const [activity, setActivity] = useState<Activity>(NOTHING);
  useEffect(() => api.onSyncActivity(setActivity), []);
  // Each time sync started over, and why (embre, 28 November), read again as sync's state changes.
  const [restarts, setRestarts] = useState<SyncRestart[]>([]);
  useEffect(() => {
    let live = true;
    void api.syncOverview().then((o) => live && setRestarts(o.restarts ?? []), () => undefined);
    return () => {
      live = false;
    };
  }, [sync?.state, sync?.lastSuccessAt]);

  const off = (sync?.state ?? "disabled") === "disabled";
  const running = activity.running || sync?.state === "syncing";
  const problems = activity.recent.filter((f) => f.problem).length;

  return (
    <div className={`imports-page sync-activity-page${embedded ? " activity-pane" : " library"}`}>
      <header className={embedded ? "activity-head" : "library-head"}>
        <div>
          {!embedded && <h1 className="library-title">Sync activity</h1>}
          <p className={embedded ? "settings-row-hint" : "eyebrow"}>
            {running
              ? "Syncing now"
              : activity.finishedAt
                ? `Last sync finished ${relativeTime(activity.finishedAt)}`
                : sync?.lastSuccessAt
                  ? `Last synced ${relativeTime(sync.lastSuccessAt)}`
                  : "What sync is doing, file by file"}
          </p>
        </div>
        <div className="imports-actions">
          <button type="button" className="btn btn-quiet" onClick={onOpenSyncSettings}>
            <Icon name="settings" size={16} /> Sync settings
          </button>
          <button type="button" className="btn btn-primary" disabled={off || running} onClick={() => void api.syncNow()}>
            <Icon name="sync" size={16} /> Sync now
          </button>
        </div>
      </header>

      {off && activity.places.length === 0 ? (
        <div className="imports-empty">
          <Icon name="cloudOff" size={28} />
          <p>Sync is off, so nothing is being sent anywhere. Choose a cloud service in Sync settings to keep your devices in step.</p>
        </div>
      ) : activity.places.length === 0 && activity.recent.length === 0 ? (
        <div className="imports-empty">
          <Icon name="cloud" size={28} />
          <p>Nothing has synced since TBV opened. When it does, each place and every file it sends or fetches shows up here.</p>
        </div>
      ) : (
        <>
          <div className="sync-places">
            {activity.places.map((p) => (
              <Place key={p.lane} place={p} />
            ))}
          </div>

          {(activity.changes?.length ?? 0) > 0 && (
            <section className="imports-group">
              <div className="section-head">
                <h3 className="section-label">Recent changes · {activity.changes.length}</h3>
                <button type="button" className="btn btn-quiet btn-small" onClick={() => void api.clearSyncChanges()}>
                  Clear
                </button>
              </div>
              <ul className="imports-list">
                {activity.changes.map((c, i) => (
                  <li key={`${c.at}-${i}`} className="import-row">
                    <Icon name={c.direction === "up" ? "upload" : "download"} size={18} />
                    <div className="import-text">
                      <span className="import-name">{c.what}</span>
                      <span className="import-detail">
                        {c.direction === "up" ? "Sent from this device" : "From another device"}
                        {activity.places.length > 1 ? ` · ${c.lane === "main" ? "main sync" : "second sync"}` : ""}
                      </span>
                    </div>
                    <span className="import-detail sync-when">{relativeTime(c.at)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {activity.recent.length > 0 && (
            <section className="imports-group">
              <h3 className="section-label">
                Recent files · {activity.recent.length}
                {problems > 0 && ` · ${plural(problems, "problem")}`}
              </h3>
              <ul className="imports-list">
                {activity.recent.map((f, i) => (
                  <li key={`${f.at}-${i}`} className={`import-row${f.problem ? " is-bad" : ""}`}>
                    <Icon name={fileIcon(f)} size={18} />
                    <div className="import-text">
                      <span className="import-name">{f.what}</span>
                      <span className="import-detail">
                        {fileText(f)}
                        {f.lane === null ? " when you opened it" : activity.places.length > 1 ? ` · ${f.lane === "main" ? "main sync" : "second sync"}` : ""}
                      </span>
                    </div>
                    {f.problem && f.path ? (
                      <button type="button" className="btn btn-quiet btn-small" disabled={running} onClick={() => void api.retrySyncFile(f.path!)}>
                        Try again
                      </button>
                    ) : (
                      <span className="import-detail sync-when">{relativeTime(f.at)}</span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      {restarts.length > 0 && (
        <section className="imports-group sync-restarts">
          <h3 className="section-label">Started over · {restarts.length}</h3>
          <ul className="imports-list">
            {restarts.map((r, i) => (
              <li key={`${r.at}-${i}`} className="import-row">
                <Icon name="sync" size={18} />
                <div className="import-text">
                  <span className="import-name">{r.reason}</span>
                  <span className="import-detail">
                    {r.place === "main" ? "Main sync" : "Second sync"} · everything sent and read again
                  </span>
                </div>
                <span className="import-detail sync-when">{relativeTime(r.at)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

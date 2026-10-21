// Files from servers on the Imports page: every one chosen, in order, with
// how its download went. A few come down at once (Settings › Servers ›
// Connections); each joins the import queue as it arrives.

import type { QueuedServerFile } from "../api/types";
import { api } from "../api";
import { Icon } from "../components/Icon";
import { ProgressBar } from "../components/ProgressBar";
import { formatBytes } from "../settings/controls";
import type { ServerQueue } from "./serverQueue";

/** How long something took, in words: "45 s", "3 min 20 s", "1 h 5 min". */
export function took(from: string | null, to: string | null): string | null {
  if (!from || !to) return null;
  const s = Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 1000));
  if (s < 60) return `${Math.max(1, s)} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min${s % 60 ? ` ${s % 60} s` : ""}`;
  return `${Math.floor(s / 3600)} h${Math.floor((s % 3600) / 60) ? ` ${Math.floor((s % 3600) / 60)} min` : ""}`;
}

export function rowText(f: QueuedServerFile): { text: string; tone: "ok" | "now" | "bad" | "wait" } {
  const time = took(f.startedAt, f.finishedAt);
  switch (f.state) {
    case "waiting":
      return { text: `Waiting · ${formatBytes(f.size)}`, tone: "wait" };
    case "downloading":
      return { text: `Downloading ${formatBytes(f.bytesDone)} of ${formatBytes(f.size)}`, tone: "now" };
    case "downloaded":
      return { text: `Downloaded${time ? ` in ${time}` : ""} · waiting for the rest of its audiobook`, tone: "now" };
    case "importing":
      return { text: `Downloaded${time ? ` in ${time}` : ""} · being added to your library`, tone: "now" };
    case "done":
      return { text: `Downloaded${time ? ` in ${time}` : ""} · ${formatBytes(f.size)}`, tone: "ok" };
    case "failed":
      return { text: f.error ?? "Couldn't be downloaded.", tone: "bad" };
  }
}

export function ServerRows({ queue }: { queue: ServerQueue }) {
  const { view, rows, showMore } = queue;
  const c = view.counts;
  if (c.total === 0 && view.looking.length === 0 && !view.problem) return null;
  const notDown = c.waiting + c.downloading;
  return (
    <section className="imports-group server-rows" aria-label="From servers">
      <div className="server-rows-head">
        <h3 className="section-label">
          From servers · {c.total} {c.total === 1 ? "file" : "files"}
          {c.downloading > 0 && ` · ${c.downloading} downloading`}
          {c.waiting > 0 && ` · ${c.waiting} waiting`}
          {c.failed > 0 && ` · ${c.failed} failed`}
        </h3>
        <div className="imports-summary-actions">
          {notDown > 0 && (
            <button type="button" className="btn btn-quiet btn-danger-text" onClick={() => void api.cancelServerQueue()}>
              Stop the rest
            </button>
          )}
          {c.done + c.failed > 0 && (
            <button type="button" className="btn btn-quiet" onClick={() => void api.clearServerFinished()}>
              Clear finished
            </button>
          )}
        </div>
      </div>
      {c.total > 0 && (
        <>
          <ProgressBar value={c.bytesTotal ? c.bytesDone / c.bytesTotal : 0} label="Downloaded from servers" />
          <p className="settings-row-hint">
            {formatBytes(c.bytesDone)} of {formatBytes(c.bytesTotal)} · up to {view.connections} at once (Settings › Servers)
          </p>
        </>
      )}
      {view.looking.map((name, i) => (
        <p key={`${name}-${i}`} className="settings-row-hint" role="status">
          Looking through {name} for what you chose…
        </p>
      ))}
      {view.problem && <p className="form-error">{view.problem.startsWith("new-host-key:") ? "The server's key wasn't trusted, so nothing came down." : view.problem}</p>}
      <ul className="imports-list">
        {rows.map((f) => {
          const t = rowText(f);
          return (
            <li key={f.id} className={`import-row is-${t.tone === "now" ? "current" : t.tone}`}>
              <Icon
                name={t.tone === "bad" ? "warning" : t.tone === "ok" ? "check" : t.tone === "wait" ? "clock" : "download"}
                size={18}
              />
              <div className="import-text">
                <span className="import-name" title={f.remote}>
                  {f.name}
                </span>
                <span className="import-detail">
                  {f.serverName} · {t.text}
                </span>
                {f.state === "downloading" && <ProgressBar value={f.size ? f.bytesDone / f.size : 0} label={`${f.name} progress`} />}
              </div>
              {f.state === "failed" && (
                <button type="button" className="btn btn-quiet" onClick={() => void api.retryServerFile(f.id)}>
                  Try again
                </button>
              )}
              {(f.state === "waiting" || f.state === "downloading" || f.state === "failed") && (
                <button type="button" className="icon-btn" aria-label={`Remove ${f.name}`} title="Remove" onClick={() => void api.removeServerFile(f.id)}>
                  <Icon name="close" size={16} />
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {c.total > rows.length && (
        <button type="button" className="btn btn-quiet server-rows-more" onClick={showMore}>
          Show {Math.min(200, c.total - rows.length)} more of {c.total - rows.length}
        </button>
      )}
    </section>
  );
}

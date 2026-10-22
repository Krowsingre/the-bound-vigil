// Imports: books being added, like a downloads page. The newest import's
// books stay listed until cleared, with what happened to each.

import type { ImportResult, ImportsView } from "../api/types";
import { Icon } from "../components/Icon";
import { ProgressBar } from "../components/ProgressBar";
import type { ServerQueue } from "./serverQueue";
import { ServerRows } from "./ServerRows";
import { LocalSendRows } from "./LocalSendRows";
import type { SentFile } from "../api/types";

export function importCounts(view: ImportsView) {
  return { done: view.done, total: view.total, running: view.done < view.total };
}

function size(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function outcome(result: ImportResult | null): { text: string; tone: "ok" | "same" | "bad" } {
  switch (result?.outcome) {
    case "imported":
      return result.returned ? { text: "Deleted before, added to Previously deleted", tone: "same" } : { text: "Added", tone: "ok" };
    case "skippedDeleted":
      return { text: "Deleted before, skipped", tone: "same" };
    case "alreadyInLibrary":
      return { text: "Already in your library", tone: "same" };
    case "unsupported":
      return { text: "Not a book format TBV reads", tone: "bad" };
    case "failed":
      return { text: `Couldn't be added: ${result.reason}`, tone: "bad" };
    default:
      return { text: "Done", tone: "ok" };
  }
}

export function Imports({
  view,
  onCancel,
  onClear,
  onImportBooks,
  onImportFolder,
  onOpenBook,
  servers,
  sent = [],
}: {
  view: ImportsView;
  /** Files coming down from servers, desktop only. */
  servers?: ServerQueue;
  /** Files sent with LocalSend, desktop only. */
  sent?: SentFile[];
  onCancel: () => void;
  onClear: () => void;
  onImportBooks: () => void;
  onImportFolder: () => void;
  onOpenBook: (bookId: string) => void;
}) {
  const { done, total, running } = importCounts(view);
  const { current, waiting, finished } = view;
  // Whole-import progress counts the books under way by how much of them is read.
  const partly = view.currentBytes ? (view.currentRead / view.currentBytes) * current.length : 0;
  const overall = total ? (done + partly * 0.9) / total : 0;
  const added = view.added;
  const problems = view.failed + view.unsupported;

  return (
    <div className="library imports-page">
      <header className="library-head">
        <div>
          <h1 className="library-title">Imports</h1>
          <p className="eyebrow">Books being added to your library</p>
        </div>
        <div className="imports-actions">
          <button type="button" className="btn btn-quiet" onClick={onImportFolder}>
            <Icon name="folder" size={16} /> Import folder
          </button>
          <button type="button" className="btn btn-primary" onClick={onImportBooks}>
            <span aria-hidden>+</span> Import books
          </button>
        </div>
      </header>

      <LocalSendRows rows={sent} />
      {servers && <ServerRows queue={servers} />}

      {total === 0 ? (
        sent.length > 0 || (servers && (servers.view.counts.total > 0 || servers.view.looking.length > 0)) ? null : (
        <div className="imports-empty">
          <Icon name="download" size={28} />
          <p>Nothing is being imported. Books you import, or drop on the window, show up here while they're added.</p>
        </div>
        )
      ) : (
        <>
          <section className="imports-summary" aria-live="polite">
            <div className="imports-summary-text">
              <h2>{running ? `Adding ${Math.min(done + 1, total)} of ${total} ${total === 1 ? "book" : "books"}` : `Finished: ${total} ${total === 1 ? "book" : "books"}`}</h2>
              <p className="settings-row-hint">
                {added} added
                {view.returned > 0 && ` (${view.returned} previously deleted, in the Previously deleted collection)`}
                {view.already > 0 && `, ${view.already} already in your library`}
                {view.skippedDeleted > 0 && `, ${view.skippedDeleted} previously deleted and skipped`}
                {problems > 0 && `, ${problems} couldn't be added`}
                {running && ". You can keep using TBV meanwhile."}
              </p>
            </div>
            <ProgressBar value={running ? overall : 1} label={`${Math.round((running ? overall : 1) * 100)}% imported`} />
            <div className="imports-summary-actions">
              {(view.waitingCount > 0 || view.current.length > 0) && (
                <button type="button" className="btn btn-quiet btn-danger-text" onClick={onCancel}>
                  Stop importing
                </button>
              )}
              {done > 0 && (
                <button type="button" className="btn btn-quiet" onClick={onClear}>
                  Clear finished
                </button>
              )}
            </div>
          </section>

          {current.length > 0 && (
            <section className="imports-group">
              <h3 className="section-label">Now</h3>
              <ul className="imports-list">
                {current.map((i) => (
                  <li key={i.id} className="import-row is-current">
                    <Icon name="download" size={18} />
                    <div className="import-text">
                      <span className="import-name">{i.name}</span>
                      <span className="import-detail">
                        {i.stage === "adding"
                          ? "Copying into your library…"
                          : `Reading ${size(i.bytesRead)} of ${size(i.bytes)}${i.bytes > 5 * 1024 * 1024 ? " (files in a cloud folder may download first)" : ""}`}
                      </span>
                      <ProgressBar value={i.bytes ? i.bytesRead / i.bytes : 0} label={`${i.name} progress`} />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {waiting.length > 0 && (
            <section className="imports-group">
              <h3 className="section-label">Up next · {view.waitingCount}</h3>
              <ul className="imports-list">
                {waiting.map((i) => (
                  <li key={i.id} className="import-row">
                    <Icon name="clock" size={18} />
                    <div className="import-text">
                      <span className="import-name">{i.name}</span>
                      <span className="import-detail">{size(i.bytes)}</span>
                    </div>
                  </li>
                ))}
              </ul>
              {view.waitingCount > waiting.length && <p className="settings-row-hint">And {view.waitingCount - waiting.length} more.</p>}
            </section>
          )}

          {finished.length > 0 && (
            <section className="imports-group">
              <h3 className="section-label">
                Finished · {done}
                {done > finished.length && ` · latest ${finished.length} shown`}
              </h3>
              <ul className="imports-list">
                {finished.map((i) => {
                  const o = outcome(i.result);
                  const bookId = i.result && "bookId" in i.result ? i.result.bookId : null;
                  return (
                    <li key={i.id} className={`import-row is-${o.tone}`}>
                      <Icon name={o.tone === "bad" ? "warning" : "check"} size={18} />
                      <div className="import-text">
                        <span className="import-name">{i.result && "title" in i.result ? i.result.title : i.name}</span>
                        <span className="import-detail">{o.text}</span>
                      </div>
                      {bookId && (
                        <button type="button" className="btn btn-quiet" onClick={() => onOpenBook(bookId)}>
                          Read
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

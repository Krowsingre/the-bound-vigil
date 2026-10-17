// Imports: books being added, like a downloads page. The newest import's
// books stay listed until cleared, with what happened to each.

import type { ImportItem, ImportResult } from "../api/types";
import { Icon } from "../components/Icon";
import { ProgressBar } from "../components/ProgressBar";

/** Waiting books shown at once; the rest are counted. */
const SHOW_WAITING = 200;

export function importCounts(items: ImportItem[]) {
  const done = items.filter((i) => i.stage === "done").length;
  return { done, total: items.length, running: done < items.length };
}

function size(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function outcome(result: ImportResult | null): { text: string; tone: "ok" | "same" | "bad" } {
  switch (result?.outcome) {
    case "imported":
      return { text: "Added", tone: "ok" };
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
  items,
  onCancel,
  onClear,
  onImportBooks,
  onImportFolder,
  onOpenBook,
}: {
  items: ImportItem[];
  onCancel: () => void;
  onClear: () => void;
  onImportBooks: () => void;
  onImportFolder: () => void;
  onOpenBook: (bookId: string) => void;
}) {
  const { done, total, running } = importCounts(items);
  const current = items.filter((i) => i.stage === "reading" || i.stage === "adding");
  const waiting = items.filter((i) => i.stage === "waiting");
  const finished = items.filter((i) => i.stage === "done").reverse();
  // Whole-import progress counts the book under way by how much of it is read.
  const partly = current.reduce((sum, i) => sum + (i.bytes ? i.bytesRead / i.bytes : 0), 0);
  const overall = total ? (done + partly * 0.9) / total : 0;
  const added = finished.filter((i) => i.result?.outcome === "imported").length;
  const problems = finished.filter((i) => i.result?.outcome === "failed" || i.result?.outcome === "unsupported").length;

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

      {total === 0 ? (
        <div className="imports-empty">
          <Icon name="download" size={28} />
          <p>Nothing is being imported. Books you import, or drop on the window, show up here while they're added.</p>
        </div>
      ) : (
        <>
          <section className="imports-summary" aria-live="polite">
            <div className="imports-summary-text">
              <h2>{running ? `Adding ${Math.min(done + 1, total)} of ${total} ${total === 1 ? "book" : "books"}` : `Finished: ${total} ${total === 1 ? "book" : "books"}`}</h2>
              <p className="settings-row-hint">
                {added} added
                {finished.length - added - problems > 0 && `, ${finished.length - added - problems} already in your library`}
                {problems > 0 && `, ${problems} couldn't be added`}
                {running && ". You can keep using TBV meanwhile."}
              </p>
            </div>
            <ProgressBar value={running ? overall : 1} label={`${Math.round((running ? overall : 1) * 100)}% imported`} />
            <div className="imports-summary-actions">
              {waiting.length > 0 && (
                <button type="button" className="btn btn-quiet btn-danger-text" onClick={onCancel}>
                  Cancel the rest
                </button>
              )}
              {finished.length > 0 && (
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
              <h3 className="section-label">Up next · {waiting.length}</h3>
              <ul className="imports-list">
                {waiting.slice(0, SHOW_WAITING).map((i) => (
                  <li key={i.id} className="import-row">
                    <Icon name="clock" size={18} />
                    <div className="import-text">
                      <span className="import-name">{i.name}</span>
                      <span className="import-detail">{size(i.bytes)}</span>
                    </div>
                  </li>
                ))}
              </ul>
              {waiting.length > SHOW_WAITING && <p className="settings-row-hint">And {waiting.length - SHOW_WAITING} more.</p>}
            </section>
          )}

          {finished.length > 0 && (
            <section className="imports-group">
              <h3 className="section-label">Finished · {finished.length}</h3>
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

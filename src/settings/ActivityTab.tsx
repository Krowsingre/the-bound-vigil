// Preferences › Activity: what TBV is doing in the background, one switch
// apart: books being imported, what sync is sending and fetching, and pairs
// of books and audiobooks being lined up for read-along.

import { useEffect, useState } from "react";
import { api, isApp, isIOS } from "../api";
import type { ReadAlongPair } from "../api/types";
import { moved, useReorder, type ReorderProps } from "../collections/useReorder";
import { Icon } from "../components/Icon";
import { ProgressBar } from "../components/ProgressBar";
import { showBookDetails } from "../details/openDetails";
import { PageSwitch } from "../library/Library";
import { PauseLiningUpButton, pausedUntilText } from "../readAlong/PauseLiningUp";
import {
  liningUp,
  liningUpPaused,
  liningUpPausedUntil,
  linesUp,
  onLinedUp,
  onLiningUp,
  onPauseChange,
  pauseAfterThis,
  pausingAfterThis,
  readLineUp,
  type LiningUp,
} from "../readAlong/lineUp";

export type ActivitySide = "imports" | "sync" | "lining";

export function ActivityTab({
  side,
  onSide,
  imports,
  sync,
}: {
  side: ActivitySide;
  onSide: (side: ActivitySide) => void;
  /** The Imports and Sync activity panes, made by the app (they need its import queue and sync state). */
  imports: React.ReactNode;
  sync: React.ReactNode;
}) {
  return (
    <div className="activity-tab">
      <PageSwitch<ActivitySide>
        label="Which activity"
        value={side}
        options={[
          { value: "imports", label: "Imports" },
          ...(api.kind === "web" ? [] : [{ value: "sync" as const, label: "Sync" }]),
          ...(isApp || api.kind === "preview" ? [{ value: "lining" as const, label: "Confluence" }] : []),
        ]}
        onChange={onSide}
      />
      {side === "imports" ? imports : side === "sync" ? sync : <LiningUpPane />}
    </div>
  );
}

interface Row {
  pair: ReadAlongPair;
  ebook: string;
  audiobook: string;
}

/** Every pair, and how far each is lined up. */
function LiningUpPane() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [now, setNow] = useState<LiningUp | null>(liningUp());
  const [paused, setPaused] = useState(liningUpPaused());
  const [after, setAfter] = useState(pausingAfterThis());
  useEffect(
    () =>
      onPauseChange(() => {
        setPaused(liningUpPaused());
        setAfter(pausingAfterThis());
      }),
    [],
  );
  const [reload, setReload] = useState(0);
  const [view, setView] = useState<"queued" | "out">("queued");
  const queued = (rows ?? []).filter((r) => r.pair.queued && stillToDo(r.pair));
  const out = (rows ?? []).filter((r) => !r.pair.queued && stillToDo(r.pair));
  const finished = (rows ?? []).filter((r) => !stillToDo(r.pair));
  const order = queued.map((r) => keyOf(r.pair));
  // Shown at once; the next look at the list confirms it.
  const move = (key: string, to: number) => {
    const next = moved(order, key, to);
    const byKey = new Map((rows ?? []).map((r) => [keyOf(r.pair), r]));
    const placed = next.map((k) => byKey.get(k)!);
    setRows([...placed, ...(rows ?? []).filter((r) => !next.includes(keyOf(r.pair)))]);
    void api.orderReadAlongQueue(placed.map((r) => [r.pair.ebookId, r.pair.audiobookId])).finally(() => setReload((n) => n + 1));
  };
  const reorder = useReorder(order, true, move);
  const setQueued = (row: Row, on: boolean) => {
    setRows((rows ?? []).map((r) => (r === row ? { ...r, pair: { ...r.pair, queued: on } } : r)));
    void api.setReadAlongQueued(row.pair.ebookId, row.pair.audiobookId, on).finally(() => setReload((n) => n + 1));
  };
  useEffect(() => onLiningUp(setNow), []);
  useEffect(() => onLinedUp(() => setReload((n) => n + 1)), []);
  // Another device's pieces arrive with sync, so the list looks again now and then.
  useEffect(() => {
    const t = setInterval(() => setReload((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    let current = true;
    const title = (id: string) =>
      api.bookDetails(id).then(
        (d) => d.book.title,
        () => "",
      );
    void api.readAlongPairs().then(
      async (pairs) => {
        const found = await Promise.all(
          pairs.map(async (pair) => ({
            pair,
            ebook: await title(pair.ebookId),
            audiobook: await title(pair.audiobookId),
          })),
        );
        if (current) setRows(found);
      },
      () => current && setRows([]),
    );
    return () => {
      current = false;
    };
  }, [reload]);

  return (
    <div className="activity-pane">
      <header className="activity-head">
        <div>
          <p className="settings-row-hint">
            In Confluence, each book paired with its audiobook converges with it word by word, one pair at a time, on every device that has both downloaded. A computer works from
            the start and a phone from the end, so together they meet in the middle.{isIOS && " On this phone it's off until you turn it on in Preferences › Reading › Read-along."}
          </p>
        </div>
        <div className="imports-actions">
          {now && !paused && (
            <button
              type="button"
              className={`btn btn-quiet${after ? " is-active" : ""}`}
              aria-pressed={after}
              title={after ? "Carry on with the next pair after all" : "Finish this pair, then pause"}
              onClick={() => pauseAfterThis(!after)}
            >
              <Icon name="pause" size={16} /> {after ? "Pausing after this" : "Pause after this"}
            </button>
          )}
          <PauseLiningUpButton pauseLabel="Pause now" />
        </div>
      </header>
      {paused && <p className="settings-row-hint activity-paused">Paused on this device {pausedUntilText(liningUpPausedUntil())}.</p>}
      {now && (
        <section className="imports-summary" aria-live="polite">
          <div className="imports-summary-text">
            <h2>{now.title || "A book"} is converging</h2>
            <p className="settings-row-hint">
              {now.stage === "cooling"
                ? `Paused while the phone cools down, ${Math.floor(now.fraction * 100)}% done`
                : now.stage === "model"
                ? now.modelTotal
                  ? `Getting the speech model: ${mb(now.modelLoaded)} of ${mb(now.modelTotal)}`
                  : "Getting the speech model ready…"
                : `${Math.floor(now.fraction * 100)}% done`}
            </p>
          </div>
          <ProgressBar
            value={now.stage === "model" && now.modelTotal ? now.modelLoaded / now.modelTotal : now.fraction}
            label={`${Math.floor(now.fraction * 100)}% converged`}
          />
        </section>
      )}
      {rows === null ? null : rows.length === 0 ? (
        <div className="imports-empty">
          <Icon name="confluence" size={28} />
          <p>No books are paired with audiobooks yet. Pair one from a book's details, and it converges here.</p>
        </div>
      ) : (
        <>
          <div className="lining-switch">
            <PageSwitch<"queued" | "out">
              label="Which pairs"
              value={view}
              options={[
                { value: "queued", label: `Queued · ${queued.length}` },
                { value: "out", label: `Not queued · ${out.length}` },
              ]}
              onChange={setView}
            />
          </div>
          {view === "queued" ? (
            <section className="imports-group">
              {queued.length === 0 ? (
                <p className="settings-row-hint">Nothing is queued. Add pairs from Not queued, and they converge in the order you choose.</p>
              ) : (
                <>
                  <p className="settings-row-hint">The first pair converges next. Drag to change the order, or use the arrows.</p>
                  <ul className="imports-list">
                    {queued.map((r, index) => {
                      const k = keyOf(r.pair);
                      return (
                        <PairRow key={k} row={r} now={now} paused={paused} place={index + 1} reorder={reorder(k)}>
                          <button type="button" className="icon-btn" title="Move to the top" aria-label="Move to the top" disabled={index === 0} onClick={() => move(k, 0)}>
                            <Icon name="arrowUp" size={16} />
                          </button>
                          <button type="button" className="icon-btn" title="Move up" aria-label="Move up" disabled={index === 0} onClick={() => move(k, index - 1)}>
                            <Icon name="chevronUp" size={16} />
                          </button>
                          <button
                            type="button"
                            className="icon-btn"
                            title="Move down"
                            aria-label="Move down"
                            disabled={index === queued.length - 1}
                            onClick={() => move(k, index + 1)}
                          >
                            <Icon name="chevronDown" size={16} />
                          </button>
                          <button type="button" className="icon-btn" title="Take out of the queue" aria-label="Take out of the queue" onClick={() => setQueued(r, false)}>
                            <Icon name="minus" size={16} />
                          </button>
                        </PairRow>
                      );
                    })}
                  </ul>
                </>
              )}
            </section>
          ) : (
            <section className="imports-group">
              {out.length === 0 ? (
                <p className="settings-row-hint">Every pair still to converge is in the queue.</p>
              ) : (
                <>
                  <p className="settings-row-hint">These pairs don't converge until you add them to the queue.</p>
                  <ul className="imports-list">
                    {out.map((r) => (
                      <PairRow key={keyOf(r.pair)} row={r} now={now} paused={paused}>
                        <button type="button" className="btn btn-quiet" onClick={() => setQueued(r, true)}>
                          <Icon name="plus" size={16} /> Add to queue
                        </button>
                      </PairRow>
                    ))}
                  </ul>
                </>
              )}
            </section>
          )}
          {finished.length > 0 && (
            <section className="imports-group">
              <h3 className="section-label">Finished · {finished.length}</h3>
              <ul className="imports-list">
                {finished.map((r) => (
                  <PairRow key={keyOf(r.pair)} row={r} now={now} paused={paused} />
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

const keyOf = (p: ReadAlongPair) => `${p.ebookId}|${p.audiobookId}`;

/** Still to be lined up (not done, not given up on, and a book with words to follow). */
const stillToDo = (p: ReadAlongPair) => {
  if (!linesUp(p.ebookFormat)) return false;
  const l = readLineUp(p.timing);
  return !l?.done && !l?.failed;
};

function PairRow({
  row,
  now,
  paused,
  place,
  reorder,
  children,
}: {
  row: Row;
  now: LiningUp | null;
  paused: boolean;
  /** Its place in the queue, shown before it. */
  place?: number;
  reorder?: ReorderProps;
  children?: React.ReactNode;
}) {
  const live = now && now.ebookId === row.pair.ebookId && now.audiobookId === row.pair.audiobookId ? now : null;
  const { text, tone } = state(row.pair, live, paused);
  return (
    <li {...reorder} tabIndex={reorder?.draggable ? 0 : undefined} className={`import-row${tone === "bad" ? " is-bad" : ""}${live ? " is-current" : ""}`}>
      {place ? <span className="lining-place">{place}</span> : <Icon name={tone === "ok" ? "checkCircle" : tone === "bad" ? "warning" : "confluence"} size={18} />}
      <button type="button" className="import-text link-like" onClick={() => showBookDetails(row.pair.ebookId)}>
        <span className="import-name">{row.ebook || "A book"}</span>
        <span className="import-detail">
          {row.audiobook ? `With ${row.audiobook} · ` : ""}
          {text}
        </span>
      </button>
      {children && <span className="lining-actions">{children}</span>}
    </li>
  );
}

const mb = (n: number) => `${Math.round(n / 1024 / 1024)} MB`;

function state(pair: ReadAlongPair, live: LiningUp | null, paused: boolean): { text: string; tone: "ok" | "same" | "bad" } {
  if (!linesUp(pair.ebookFormat))
    return {
      text: "A document or comic: the pages are turned by hand",
      tone: "same",
    };
  const l = readLineUp(pair.timing);
  if (l?.done) return { text: "Converged word by word", tone: "ok" };
  if (l?.failed)
    return {
      text: `Couldn't converge: ${l.failed} It follows by chapter.`,
      tone: "bad",
    };
  const sofar = l ? Math.floor(Math.min(0.99, pair.pieces / l.pieces) * 100) : 0;
  if (live)
    return {
      text: `Converging now: ${Math.floor(live.fraction * 100)}%`,
      tone: "same",
    };
  if (!pair.here)
    return {
      text: `${sofar}% so far. Waits for a device with both the book and the audiobook downloaded`,
      tone: "same",
    };
  if (paused) return { text: `${sofar}% so far. Paused on this device`, tone: "same" };
  return {
    text: sofar ? `${sofar}% so far, waiting its turn` : "Waiting its turn",
    tone: "same",
  };
}

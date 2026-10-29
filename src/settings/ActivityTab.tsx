// Preferences › Activity: what TBV is doing in the background, one switch
// apart: books being imported, what sync is sending and fetching, and pairs
// of books and audiobooks being lined up for read-along.

import { useEffect, useState } from "react";
import { api, isApp } from "../api";
import type { ReadAlongPair } from "../api/types";
import { Icon } from "../components/Icon";
import { ProgressBar } from "../components/ProgressBar";
import { showBookDetails } from "../details/openDetails";
import { PageSwitch } from "../library/Library";
import { liningUp, liningUpPaused, linesUp, onLinedUp, onLiningUp, pauseLiningUp, readLineUp, resumeLiningUp, type LiningUp } from "../readAlong/lineUp";

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
          ...(isApp ? [{ value: "lining" as const, label: "Lining up" }] : []),
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
  const [reload, setReload] = useState(0);
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
            Each book paired with its audiobook is lined up word by word, one pair at a time, on every device that has both downloaded. A computer works from
            the start and a phone from the end, so together they meet in the middle.
          </p>
        </div>
        <div className="imports-actions">
          <button
            type="button"
            className="btn btn-quiet"
            onClick={() => {
              if (paused) resumeLiningUp();
              else pauseLiningUp();
              setPaused(!paused);
            }}
          >
            <Icon name={paused ? "play" : "pause"} size={16} /> {paused ? "Carry on lining up" : "Pause lining up"}
          </button>
        </div>
      </header>
      {now && (
        <section className="imports-summary" aria-live="polite">
          <div className="imports-summary-text">
            <h2>Lining up {now.title || "a book"}</h2>
            <p className="settings-row-hint">
              {now.stage === "model"
                ? now.modelTotal
                  ? `Getting the speech model: ${mb(now.modelLoaded)} of ${mb(now.modelTotal)}`
                  : "Getting the speech model ready…"
                : `${Math.floor(now.fraction * 100)}% done`}
            </p>
          </div>
          <ProgressBar
            value={now.stage === "model" && now.modelTotal ? now.modelLoaded / now.modelTotal : now.fraction}
            label={`${Math.floor(now.fraction * 100)}% lined up`}
          />
        </section>
      )}
      {rows === null ? null : rows.length === 0 ? (
        <div className="imports-empty">
          <Icon name="headphones" size={28} />
          <p>No books are paired with audiobooks yet. Pair one from a book's details, and it's lined up here.</p>
        </div>
      ) : (
        <section className="imports-group">
          <h3 className="section-label">Pairs · {rows.length}</h3>
          <ul className="imports-list">
            {rows.map((r) => {
              const live = now && now.ebookId === r.pair.ebookId && now.audiobookId === r.pair.audiobookId ? now : null;
              const { text, tone } = state(r.pair, live, paused);
              return (
                <li key={`${r.pair.ebookId}|${r.pair.audiobookId}`} className={`import-row${tone === "bad" ? " is-bad" : ""}`}>
                  <Icon name={tone === "ok" ? "checkCircle" : tone === "bad" ? "warning" : "headphones"} size={18} />
                  <button type="button" className="import-text link-like" onClick={() => showBookDetails(r.pair.ebookId)}>
                    <span className="import-name">{r.ebook || "A book"}</span>
                    <span className="import-detail">
                      {r.audiobook ? `With ${r.audiobook} · ` : ""}
                      {text}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
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
  if (l?.done) return { text: "Lined up word by word", tone: "ok" };
  if (l?.failed)
    return {
      text: `Couldn't be lined up: ${l.failed} It follows by chapter.`,
      tone: "bad",
    };
  const sofar = l ? Math.floor(Math.min(0.99, pair.pieces / l.pieces) * 100) : 0;
  if (live)
    return {
      text: `Lining up now: ${Math.floor(live.fraction * 100)}%`,
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

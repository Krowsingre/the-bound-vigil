// Looking over duplicate books: filters by format, the sharpest cover for
// every copy, deleting every copy of one format, and cleaning up by rule.

import { useMemo, useRef, useState } from "react";
import { api } from "../api";
import type { DuplicateGroup } from "../api/types";
import { BookCover } from "../components/BookCover";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Icon } from "../components/Icon";
import { useToast } from "../components/Toast";
import {
  copiesOfFormat,
  DEFAULT_FORMAT_ORDER,
  formatOrder,
  hasYourReading,
  keeperAfter,
  matchesFilter,
  planCleanup,
  setFormats,
  type DuplicateBook,
  type FormatFilter,
} from "../library/duplicatePlan";
import { authorLine } from "../lib/format";
import { readLocal, writeLocal } from "./appSettings";
import { formatBytes, Segmented } from "./controls";

const SAVED = "tbv.duplicates";
const PAGE = 100;

const copies = (n: number) => `${n.toLocaleString()} ${n === 1 ? "copy" : "copies"}`;
const sets = (n: number) => `${n.toLocaleString()} ${n === 1 ? "set" : "sets"}`;
const size = (books: DuplicateBook[]) => formatBytes(books.reduce((sum, b) => sum + b.fileSize, 0));

function facts(b: DuplicateBook) {
  return [
    b.format.toUpperCase(),
    b.fileSize ? formatBytes(b.fileSize) : null,
    b.coverSize ? `cover ${b.coverSize[0]}×${b.coverSize[1]}` : "no cover",
    `added ${new Date(b.addedAt).toLocaleDateString()}`,
    b.status === "in_progress" ? `${Math.round((b.totalProgression ?? 0) * 100)}% read` : b.status === "read" ? "read" : null,
    b.notes ? `${b.notes} ${b.notes === 1 ? "note" : "notes"}` : null,
    b.availability === "cloud" ? "in the cloud" : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** A set can be helped when its covers differ in size, or some copies have none. */
function canShareCover(g: DuplicateGroup) {
  const areas = g.books.map((b) => (b.coverSize ? b.coverSize[0] * b.coverSize[1] : 0));
  return Math.max(...areas) > 0 && areas.some((a) => a < Math.max(...areas));
}

type Work = { label: string; done: number; total: number };

export function DuplicatesDialog({ groups: start, onClose }: { groups: DuplicateGroup[]; onClose: () => void }) {
  const toast = useToast();
  const [groups, setGroups] = useState(start);
  const [filter, setFilter] = useState<FormatFilter>({ kind: "all" });
  const [limit, setLimit] = useState(PAGE);
  const [view, setView] = useState<"list" | "cleanup">("list");
  const [deleting, setDeleting] = useState<DuplicateBook | null>(null);
  const [bulkFormat, setBulkFormat] = useState<string | null>(null);
  const [work, setWork] = useState<Work | null>(null);
  const stop = useRef(false);

  const allFormats = useMemo(() => [...new Set(groups.flatMap(setFormats))].sort(), [groups]);
  const shown = useMemo(() => groups.filter((g) => matchesFilter(g, filter)), [groups, filter]);
  const shownFormats = useMemo(() => [...new Set(shown.flatMap(setFormats))].sort(), [shown]);
  const [savedOrder, setSavedOrder] = useState<string[]>(() => {
    const saved = readLocal(SAVED).order;
    return Array.isArray(saved) ? saved.map(String) : DEFAULT_FORMAT_ORDER;
  });
  const order = useMemo(() => formatOrder(savedOrder, groups), [savedOrder, groups]);
  const busy = work !== null;

  const refresh = async () => {
    const fresh = await api.findDuplicates();
    setGroups(fresh);
  };

  /** Runs `steps` one at a time with progress; a library stays usable meanwhile. */
  const run = async (label: string, steps: (() => Promise<unknown>)[]) => {
    stop.current = false;
    setWork({ label, done: 0, total: steps.length });
    let done = 0;
    let failed = 0;
    for (const step of steps) {
      if (stop.current) break;
      try {
        await step();
      } catch {
        failed++;
      }
      done++;
      if (done % 5 === 0 || done === steps.length) setWork({ label, done, total: steps.length });
    }
    try {
      await refresh();
    } catch {
      /* the list just stays as it was */
    }
    setWork(null);
    return { done, failed };
  };

  const shareCovers = async (list: DuplicateGroup[]) => {
    const { failed } = await run(
      "Giving every copy the sharpest cover",
      list.map((g) => () => api.shareBestCover(g.books.map((b) => b.id))),
    );
    toast(failed ? `Done, but ${sets(failed)} couldn't be changed.` : `Every copy in ${sets(list.length)} now has the sharpest cover.`);
  };

  const removeOne = async (book: DuplicateBook) => {
    setDeleting(null);
    try {
      const set = groups.find((g) => g.books.some((b) => b.id === book.id));
      const keeper = set && keeperAfter(set, [book], order);
      if (keeper) await api.mergeReading(keeper.id, book.id);
      await api.deleteBook(book.id);
      toast(`Deleted “${book.title}” (${book.format.toUpperCase()}).`);
      setGroups((list) => list.map((g) => ({ ...g, books: g.books.filter((b) => b.id !== book.id) })).filter((g) => g.books.length > 1));
    } catch (e) {
      toast(`Couldn't delete it: ${String(e)}`);
    }
  };

  const bulk = bulkFormat ? copiesOfFormat(shown, bulkFormat, order) : null;
  const deleteFormat = async () => {
    if (!bulk || !bulkFormat) return;
    const format = bulkFormat.toUpperCase();
    setBulkFormat(null);
    const { done, failed } = await run(
      `Deleting every ${format} copy`,
      bulk.remove.map((b) => async () => {
        const keeper = bulk.into.get(b.id);
        if (keeper) await api.mergeReading(keeper.id, b.id);
        await api.deleteBook(b.id);
      }),
    );
    toast(failed ? `Deleted ${copies(done - failed)}; ${copies(failed)} couldn't be deleted.` : `Deleted ${copies(done)}.`);
  };

  const dismiss = (g: DuplicateGroup) =>
    void api.dismissDuplicates(g.key).then(
      () => setGroups((list) => list.filter((x) => x.key !== g.key)),
      (e: unknown) => toast(String(e)),
    );

  const saveOrder = (next: string[]) => {
    setSavedOrder(next);
    writeLocal(SAVED, { order: next });
  };

  const filterKind = filter.kind;
  const exactly = filter.kind === "exactly" ? filter.formats : [];

  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div
        className="dialog duplicates-dialog"
        role="dialog"
        aria-label="Duplicate books"
        onKeyDown={(e) => !deleting && !bulkFormat && !busy && e.key === "Escape" && onClose()}
      >
        <h2>Duplicate books</h2>
        {work ? (
          <WorkProgress work={work} onStop={() => (stop.current = true)} />
        ) : view === "cleanup" ? (
          <CleanupView
            groups={shown}
            order={order}
            onOrder={saveOrder}
            onBack={() => setView("list")}
            onRun={async (steps, withCover) => {
              // One set at a time: its cover first, and its copies go only once that worked.
              const list = steps.map((s) => async () => {
                if (withCover) await api.shareBestCover([s.keep.id, ...s.remove.map((b) => b.id)]);
                // Your notes and place move first, so nothing of yours goes with a copy.
                for (const b of s.remove) {
                  await api.mergeReading(s.keep.id, b.id);
                  await api.deleteBook(b.id);
                }
              });
              const removed = steps.reduce((n, s) => n + s.remove.length, 0);
              const { done, failed } = await run(`Cleaning up ${sets(steps.length)}`, list);
              setView("list");
              toast(
                done < list.length
                  ? "Stopped. What was done stays done."
                  : failed
                    ? `Cleaned up, but ${sets(failed)} didn't work. Those are still listed.`
                    : `Cleaned up ${sets(steps.length)} and deleted ${copies(removed)}.`,
              );
            }}
          />
        ) : (
          <>
            {groups.length === 0 ? (
              <p className="muted">All sorted. No more duplicates to look at.</p>
            ) : (
              <p className="muted">
                {sets(groups.length)} of books look alike. Clean them up by rule, or delete copies one by one. The sharpest cover can go on every copy first,
                and it stays after the others are deleted.
              </p>
            )}
            {groups.length > 0 && (
              <div className="duplicate-tools">
                <Segmented
                  label="Which sets to show"
                  value={filterKind}
                  options={[
                    { value: "all", label: "All sets" },
                    { value: "same", label: "One format" },
                    { value: "exactly", label: "These formats" },
                  ]}
                  onChange={(kind) => {
                    setLimit(PAGE);
                    setFilter(kind === "exactly" ? { kind, formats: exactly } : { kind });
                  }}
                />
                {filter.kind === "exactly" && (
                  <div className="duplicate-formats" role="group" aria-label="Formats in a set">
                    {allFormats.map((f) => {
                      const on = exactly.includes(f);
                      return (
                        <button
                          key={f}
                          type="button"
                          className={`duplicate-format${on ? " is-on" : ""}`}
                          aria-pressed={on}
                          onClick={() => {
                            setLimit(PAGE);
                            setFilter({ kind: "exactly", formats: on ? exactly.filter((x) => x !== f) : [...exactly, f] });
                          }}
                        >
                          {f.toUpperCase()}
                        </button>
                      );
                    })}
                  </div>
                )}
                <p className="muted duplicate-count">
                  {filter.kind === "exactly" && exactly.length === 0
                    ? "Pick the formats a set should be made of."
                    : `Showing ${sets(shown.length)}${shown.length === groups.length ? "" : ` of ${groups.length.toLocaleString()}`}.`}
                </p>
                {shown.length > 0 && (
                  <div className="duplicate-actions">
                    <button type="button" className="btn btn-primary btn-small" onClick={() => setView("cleanup")}>
                      <Icon name="check" size={14} /> Clean up by rule…
                    </button>
                    {shown.some(canShareCover) && (
                      <button type="button" className="btn btn-quiet btn-small" onClick={() => void shareCovers(shown.filter(canShareCover))}>
                        <Icon name="image" size={14} /> Sharpest cover for every set
                      </button>
                    )}
                    <label className="duplicate-bulk">
                      <span className="visually-hidden">Delete every copy of a format</span>
                      <select
                        className="settings-select"
                        value=""
                        onChange={(e) => e.target.value && setBulkFormat(e.target.value)}
                        aria-label="Delete every copy of a format in the sets shown"
                      >
                        <option value="">Delete every…</option>
                        {shownFormats.map((f) => (
                          <option key={f} value={f}>
                            {f.toUpperCase()} in the sets shown
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                )}
              </div>
            )}
            <div className="duplicate-groups">
              {shown.slice(0, limit).map((g) => (
                <section key={g.key} className="duplicate-group">
                  <header>
                    <span className="muted">{g.reason}</span>
                    {canShareCover(g) && (
                      <button
                        type="button"
                        className="btn btn-quiet btn-small"
                        title="Every copy gets the largest cover between them"
                        onClick={() => void shareCovers([g])}
                      >
                        Use the sharpest cover
                      </button>
                    )}
                    <button type="button" className="btn btn-quiet btn-small" onClick={() => dismiss(g)}>
                      Not duplicates
                    </button>
                  </header>
                  <ul>
                    {g.books.map((b) => (
                      <li key={b.id} className="duplicate-book">
                        <BookCover book={b} size="s" />
                        <span className="duplicate-text">
                          <strong>{b.title}</strong>
                          <span className="muted">{authorLine(b.authors)}</span>
                          <span className="muted duplicate-facts">{facts(b)}</span>
                        </span>
                        <button type="button" className="btn btn-quiet btn-small" onClick={() => setDeleting(b)}>
                          <Icon name="trash" size={14} /> Delete
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
              {shown.length > limit && (
                <button type="button" className="btn btn-quiet duplicate-more" onClick={() => setLimit((l) => l + PAGE)}>
                  Show {Math.min(PAGE, shown.length - limit)} more
                </button>
              )}
            </div>
            <div className="dialog-actions">
              <button type="button" className="btn btn-primary" onClick={onClose}>
                Done
              </button>
            </div>
          </>
        )}
      </div>
      {deleting && (
        <ConfirmDialog
          title={`Delete this copy of “${deleting.title}”?`}
          body={`The ${deleting.format.toUpperCase()} copy leaves your library on every device${deleting.notes ? `, with its ${deleting.notes} ${deleting.notes === 1 ? "note" : "notes"}` : ""}. The other copies stay.`}
          confirm="Delete copy"
          danger
          onCancel={() => setDeleting(null)}
          onConfirm={() => void removeOne(deleting)}
        />
      )}
      {bulkFormat && bulk && (
        <ConfirmDialog
          title={bulk.remove.length ? `Delete ${copies(bulk.remove.length)} in ${bulkFormat.toUpperCase()}?` : `No ${bulkFormat.toUpperCase()} copies can go`}
          body={[
            bulk.remove.length
              ? `They leave your library on every device (${size(bulk.remove)}). Every set keeps at least one copy: where a set is all ${bulkFormat.toUpperCase()}, its best copy stays.`
              : `Each of these is the last copy of its set.`,
            bulk.remove.some(hasYourReading) ? "Your notes, highlights and place on them move to the copy each set keeps." : "",
          ]
            .filter(Boolean)
            .join(" ")}
          confirm={bulk.remove.length ? "Delete them" : "OK"}
          danger={bulk.remove.length > 0}
          onCancel={() => setBulkFormat(null)}
          onConfirm={() => (bulk.remove.length ? void deleteFormat() : setBulkFormat(null))}
        />
      )}
    </div>
  );
}

function WorkProgress({ work, onStop }: { work: Work; onStop: () => void }) {
  return (
    <div className="duplicate-work" aria-live="polite">
      <p>
        {work.label}… {work.done.toLocaleString()} of {work.total.toLocaleString()}
      </p>
      <progress max={work.total} value={work.done} />
      <p className="muted">You can keep using TBV. Stopping keeps what's already done.</p>
      <div className="dialog-actions">
        <button type="button" className="btn btn-quiet" onClick={onStop}>
          Stop
        </button>
      </div>
    </div>
  );
}

function CleanupView({
  groups,
  order,
  onOrder,
  onBack,
  onRun,
}: {
  groups: DuplicateGroup[];
  order: string[];
  onOrder: (order: string[]) => void;
  onBack: () => void;
  onRun: (steps: ReturnType<typeof planCleanup>["steps"], withCover: boolean) => Promise<void>;
}) {
  const plan = useMemo(() => planCleanup(groups, order), [groups, order]);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [withCover, setWithCover] = useState(true);
  const [limit, setLimit] = useState(PAGE);
  const [confirming, setConfirming] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const seen = new Set(groups.flatMap(setFormats));
  const chosen = plan.steps.filter((s) => !skipped.has(s.key));
  const removing = chosen.flatMap((s) => s.remove);

  const move = (format: string, to: number) => {
    const next = order.filter((f) => f !== format);
    next.splice(Math.max(0, Math.min(to, next.length)), 0, format);
    onOrder(next);
  };
  const visibleOrder = order.filter((f) => seen.has(f));

  return (
    <div className="duplicate-cleanup">
      <section className="duplicate-rules">
        <h3>Which copy stays</h3>
        <ol className="duplicate-order" aria-label="Formats, best first">
          {visibleOrder.map((f, i) => (
            <li
              key={f}
              draggable
              className={dragging === f ? "is-dragging" : undefined}
              onDragStart={(e) => {
                setDragging(f);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragEnd={() => setDragging(null)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (dragging && dragging !== f) move(dragging, order.indexOf(f));
                setDragging(null);
              }}
            >
              <span className="num">{i + 1}</span>
              <strong>{f.toUpperCase()}</strong>
              <button type="button" className="btn btn-quiet btn-icon btn-small" aria-label={`Move ${f.toUpperCase()} up`} disabled={i === 0} onClick={() => move(f, order.indexOf(visibleOrder[i - 1]))}>
                <Icon name="chevronUp" size={14} />
              </button>
              <button
                type="button"
                className="btn btn-quiet btn-icon btn-small"
                aria-label={`Move ${f.toUpperCase()} down`}
                disabled={i === visibleOrder.length - 1}
                onClick={() => move(f, order.indexOf(visibleOrder[i + 1]))}
              >
                <Icon name="chevronDown" size={14} />
              </button>
            </li>
          ))}
        </ol>
        <ul className="muted duplicate-rule-notes">
          <li>The copy in the format highest on this list stays. Drag to change the order.</li>
          <li>When copies share that format, the largest file stays.</li>
          <li>A copy with your notes, progress, rating, favourite, tags or collections always stays.</li>
        </ul>
        <label className="check-row">
          <input type="checkbox" checked={withCover} onChange={(e) => setWithCover(e.target.checked)} />
          <span>Give the copy that stays the sharpest cover first</span>
        </label>
      </section>

      <p className="duplicate-summary">
        {plan.steps.length
          ? `${sets(chosen.length)}: ${copies(removing.length)} to delete (${size(removing)}).`
          : "Nothing to clean up in the sets shown."}
      </p>
      <ul className="duplicate-plan">
        {plan.steps.slice(0, limit).map((s) => {
          const on = !skipped.has(s.key);
          return (
            <li key={s.key} className={on ? undefined : "is-off"}>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() =>
                    setSkipped((all) => {
                      const next = new Set(all);
                      if (on) next.add(s.key);
                      else next.delete(s.key);
                      return next;
                    })
                  }
                />
                <span className="duplicate-plan-text">
                  <strong>{s.keep.title}</strong>
                  <span>
                    Keep <b>{s.keep.format.toUpperCase()}</b>
                    {s.keep.fileSize ? ` ${formatBytes(s.keep.fileSize)}` : ""} <span className="muted">({s.why.replace(/\.$/, "").toLowerCase()})</span>
                  </span>
                  <span className="muted">
                    Delete {s.remove.map((b) => `${b.format.toUpperCase()}${b.fileSize ? ` ${formatBytes(b.fileSize)}` : ""}`).join(", ")}
                  </span>
                </span>
              </label>
            </li>
          );
        })}
        {plan.steps.length > limit && (
          <li>
            <button type="button" className="btn btn-quiet duplicate-more" onClick={() => setLimit((l) => l + PAGE)}>
              Show {Math.min(PAGE, plan.steps.length - limit)} more
            </button>
          </li>
        )}
      </ul>
      <div className="dialog-actions">
        <button type="button" className="btn btn-quiet" onClick={onBack}>
          Back
        </button>
        <button type="button" className="btn btn-danger" disabled={!removing.length} onClick={() => setConfirming(true)}>
          Delete {copies(removing.length)}
        </button>
      </div>
      {confirming && (
        <ConfirmDialog
          title={`Delete ${copies(removing.length)}?`}
          body={`They leave your library on every device (${size(removing)}). ${sets(chosen.length)} each keep one copy${withCover ? ", with the sharpest cover" : ""}.`}
          confirm="Delete them"
          danger
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            void onRun(chosen, withCover);
          }}
        />
      )}
    </div>
  );
}

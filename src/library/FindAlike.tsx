// Find alike (embre, 21 November): books by one author whose titles start
// alike, gathered into groups with the series they're already in. From a
// group: tick books and make them a series (numbers read from their titles,
// or from a list found online), add books to a series already there, leave a
// book out of the group until Find alike runs again, or keep it out of that
// group until Book details lets it back in.

import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import type { AlikeBook, AlikeField, AlikeGroup, AlikeIgnored, AlikeOptions, BookPreview, DetailChange, ItemKind, SeriesEntry } from "../api/types";
import { BookCover } from "../components/BookCover";
import { Icon } from "../components/Icon";
import { Menu } from "../components/Menu";
import { useToast } from "../components/Toast";
import { rowPick, useRangePick, withShift } from "../lib/rangePick";
import { useNarrow } from "../lib/useNarrow";

/** A title as it compares with a list found online: no subtitle, case, punctuation or leading article. */
export function titleKey(title: string): string {
  const main = title.split(/[:([]/)[0] ?? title;
  const words = main.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return (words.length > 1 && ["the", "a", "an"].includes(words[0]) ? words.slice(1) : words).join(" ");
}

/** Whole numbers missing between 1 and the highest one: "book 4 missing". */
export function gapsIn(numbers: number[]): number[] {
  const whole = new Set(numbers.filter((n) => Number.isFinite(n)).map(Math.floor));
  const top = Math.max(0, ...whole);
  const gaps: number[] = [];
  for (let n = 1; n < top; n++) if (!whole.has(n)) gaps.push(n);
  return gaps;
}

/** Empty, or a number as Book details takes it (0 to 99,999; a comma for the decimal point is fine). */
export function validNumber(text: string): boolean {
  const t = text.trim().replace(",", ".");
  if (!t) return true;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 && n < 100_000;
}

/** The details Find alike can match by or look only at, as they're named. */
export const ALIKE_FIELDS: { field: AlikeField; label: string; only: string }[] = [
  { field: "author", label: "Author", only: "Author" },
  { field: "title", label: "Title start", only: "Title has" },
  { field: "series", label: "Series", only: "Series" },
  { field: "publisher", label: "Publisher", only: "Publisher" },
  { field: "genre", label: "Genre", only: "Genre" },
  { field: "tag", label: "Tag", only: "Tag" },
  { field: "narrator", label: "Narrator", only: "Narrator" },
  { field: "language", label: "Language", only: "Language" },
  { field: "year", label: "Year", only: "Year" },
];
const DEFAULT_OPTIONS: AlikeOptions = { matchBy: ["author", "title"], only: [] };
const OPTIONS_KEY = "tbv.findAlike.options.";

function rememberedOptions(kind: ItemKind): AlikeOptions {
  try {
    const kept = JSON.parse(localStorage.getItem(OPTIONS_KEY + kind) ?? "null") as AlikeOptions | null;
    if (kept && Array.isArray(kept.matchBy) && kept.matchBy.length && Array.isArray(kept.only)) return kept;
  } catch {
    // Not kept: the usual options.
  }
  return DEFAULT_OPTIONS;
}

const books = (n: number) => `${n.toLocaleString()} ${n === 1 ? "book" : "books"}`;
const numberText = (n: number | null | undefined) => (n == null ? "" : String(n));
const sameGroup = (a: AlikeGroup, keys: string[]) => a.keys.some((k) => keys.includes(k));

/**
 * `from`: the books chosen when Find alike opened, or the one book its menu
 * was opened from. The whole library is still searched; only the groups with
 * one of these books in them are shown (embre, 21 November).
 */
export function FindAlike({ kind, from = [], onClose, onChanged }: { kind: ItemKind; from?: BookPreview[]; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const [groups, setGroups] = useState<AlikeGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string[] | null>(null);
  const [keptOut, setKeptOut] = useState<BookPreview[] | null>(null);
  const [showKeptOut, setShowKeptOut] = useState(false);
  const [ignored, setIgnored] = useState<AlikeIgnored[]>([]);
  const [showIgnored, setShowIgnored] = useState(false);
  // "Not in this group": left out until Find alike runs again, by group and book.
  const [notHere, setNotHere] = useState<Set<string>>(new Set());
  const [reload, setReload] = useState(0);
  const [options, setOptions] = useState<AlikeOptions>(() => rememberedOptions(kind));
  const [showOptions, setShowOptions] = useState(false);
  // What the search uses: the options a moment after the last change, so typing doesn't search each letter.
  const [searched, setSearched] = useState(options);
  useEffect(() => {
    const wait = window.setTimeout(() => setSearched(options), 400);
    try {
      localStorage.setItem(OPTIONS_KEY + kind, JSON.stringify(options));
    } catch {
      // Not kept: the usual options next time.
    }
    return () => window.clearTimeout(wait);
  }, [options, kind]);

  useEffect(() => {
    let current = true;
    setGroups(null);
    const asked = { ...searched, only: searched.only.filter((f) => f.value.trim()) };
    void api.findAlike?.(kind, asked).then(
      (found) => current && (setGroups(found), setError(null)),
      (e: unknown) => current && setError(String(e)),
    );
    void api.keptOutBooks?.(kind).then((found) => current && setKeptOut(found), () => current && setKeptOut([]));
    void api.alikeIgnored?.(kind).then((found) => current && setIgnored(found), () => current && setIgnored([]));
    return () => {
      current = false;
    };
  }, [kind, reload, searched]);

  const again = () => {
    setReload((n) => n + 1);
    onChanged();
  };
  const shownBooks = (g: AlikeGroup) => g.books.filter((b) => !notHere.has(`${g.keys[0]}|${b.book.id}`));
  const [startFrom, setStartFrom] = useState(from);
  const fromIds = useMemo(() => new Set(startFrom.map((b) => b.id)), [startFrom]);
  const shown = (groups ?? []).filter(
    (g) => shownBooks(g).length >= 2 && (!fromIds.size || shownBooks(g).some((b) => fromIds.has(b.book.id))),
  );
  const fromText = startFrom.length === 1 ? `“${startFrom[0].title}”` : `the ${books(startFrom.length)} chosen`;
  const group = open ? shown.find((g) => sameGroup(g, open)) ?? null : null;

  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog duplicates-dialog alike-dialog" role="dialog" aria-label="Find alike" onKeyDown={(e) => e.key === "Escape" && onClose()}>
        {group ? (
          <GroupView
            key={group.keys.join(" ")}
            group={{ ...group, books: shownBooks(group) }}
            onBack={() => setOpen(null)}
            onNotHere={(id) => setNotHere((s) => new Set(s).add(`${group.keys[0]}|${id}`))}
            onKeepOut={async (book) => {
              try {
                await api.keepOutOfAlike?.([book.id], group.keys, true);
                again();
                toast(`“${book.title}” is kept out of this group.`, {
                  label: "Undo",
                  run: () => void api.keepOutOfAlike?.([book.id], group.keys, false).then(again),
                });
              } catch (e) {
                toast(String(e));
              }
            }}
            onChanged={again}
            onIgnore={api.ignoreAlike ? async (hours) => {
              try {
                const made = await api.ignoreAlike!(kind, group.name, group.author, group.keys, hours);
                setOpen(null);
                again();
                toast(`“${group.name}” is ignored.`, { label: "Undo", run: () => void api.unignoreAlike?.(made.id).then(again) });
              } catch (e) {
                toast(String(e));
              }
            } : undefined}
          />
        ) : showIgnored ? (
          <Ignored list={ignored} onBack={() => setShowIgnored(false)} onBringBack={async (g) => {
            await api.unignoreAlike?.(g.id);
            again();
          }} />
        ) : showKeptOut ? (
          <KeptOut books={keptOut ?? []} onBack={() => setShowKeptOut(false)} onLetIn={async (book) => {
            await api.includeInAlike?.(book.id);
            again();
          }} />
        ) : (
          <>
            <div className="alike-head">
              <h2>Find alike</h2>
              <button type="button" className={`btn btn-quiet btn-small${showOptions ? " is-lit" : ""}`} aria-expanded={showOptions} onClick={() => setShowOptions((o) => !o)}>
                <Icon name="filter" size={14} /> Options
              </button>
            </div>
            <p className="muted alike-summary">
              Matching by {options.matchBy.map((f) => ALIKE_FIELDS.find((x) => x.field === f)?.label.toLowerCase()).join(", ")}
              {options.only.some((f) => f.value.trim())
                ? `; only ${options.only.filter((f) => f.value.trim()).map((f) => `${ALIKE_FIELDS.find((x) => x.field === f.field)?.only.toLowerCase()} “${f.value.trim()}”`).join(", ")}`
                : ""}
              .
            </p>
            {!!startFrom.length && (
              <p className="alike-from">
                <span>Alike to {fromText}, from the whole library.</span>
                <button type="button" className="btn btn-quiet btn-small" onClick={() => setStartFrom([])}>Show every group</button>
              </p>
            )}
            {showOptions && <OptionsPanel options={options} onChange={setOptions} />}
            {error ? (
              <p className="form-error" role="alert">{error}</p>
            ) : !groups ? (
              <div className="library-loading" aria-busy="true" aria-label="Looking for alike books" />
            ) : shown.length === 0 ? (
              <p className="muted">
                {startFrom.length
                  ? `Nothing alike found for ${fromText}. Try other details under Options.`
                  : "Nothing alike found. Books that share what they're matched by show up here."}
              </p>
            ) : (
              <>
                <p className="muted">
                  {shown.length.toLocaleString()} {shown.length === 1 ? "group" : "groups"}. Open one to make a series.
                </p>
                <ul className="alike-groups">
                  {shown.map((g) => {
                    const list = shownBooks(g);
                    const series = new Set(list.map((b) => b.book.series?.trim()).filter(Boolean));
                    const loose = list.filter((b) => !b.book.series?.trim()).length;
                    return (
                      <li key={g.keys.join(" ")}>
                        <button type="button" className="alike-group" onClick={() => setOpen(g.keys)}>
                          <BookCover book={list[0].book} size="s" />
                          <span className="alike-group-text">
                            <strong>{g.name}</strong>
                            <span className="muted">{g.author} · {books(list.length)}</span>
                            <span className="muted">
                              {[series.size ? `${series.size} series` : null, loose ? `${loose} not in a series` : null].filter(Boolean).join(" · ")}
                            </span>
                          </span>
                          <Icon name="chevronRight" size={16} />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
            <div className="dialog-actions">
              {!!ignored.length && (
                <button type="button" className="btn btn-quiet" onClick={() => setShowIgnored(true)}>
                  Ignored ({ignored.length})
                </button>
              )}
              {!!keptOut?.length && (
                <button type="button" className="btn btn-quiet" onClick={() => setShowKeptOut(true)}>
                  Kept out ({keptOut.length})
                </button>
              )}
              <button type="button" className="btn btn-quiet" onClick={() => (setNotHere(new Set()), setGroups(null), setReload((n) => n + 1))}>
                Run again
              </button>
              <button type="button" className="btn btn-primary" onClick={onClose}>Done</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function OptionsPanel({ options, onChange }: { options: AlikeOptions; onChange: (options: AlikeOptions) => void }) {
  const toggle = (field: AlikeField) => {
    const on = options.matchBy.includes(field);
    // At least one detail is always matched.
    if (on && options.matchBy.length === 1) return;
    onChange({ ...options, matchBy: on ? options.matchBy.filter((f) => f !== field) : [...options.matchBy, field] });
  };
  const setOnly = (i: number, change: Partial<{ field: AlikeField; value: string }>) =>
    onChange({ ...options, only: options.only.map((f, j) => (j === i ? { ...f, ...change } : f)) });
  return (
    <section className="alike-options" aria-label="Find alike options">
      <h3 className="section-label">Match by</h3>
      <div className="alike-chips" role="group" aria-label="Match by">
        {ALIKE_FIELDS.map(({ field, label }) => (
          <button key={field} type="button" className={`duplicate-format${options.matchBy.includes(field) ? " is-on" : ""}`}
            aria-pressed={options.matchBy.includes(field)} onClick={() => toggle(field)}>
            {label}
          </button>
        ))}
      </div>
      <h3 className="section-label">Only look at</h3>
      {options.only.map((f, i) => (
        <div key={i} className="alike-only">
          <select className="settings-select" aria-label="Detail" value={f.field} onChange={(e) => setOnly(i, { field: e.target.value as AlikeField })}>
            {ALIKE_FIELDS.map((x) => <option key={x.field} value={x.field}>{x.only}</option>)}
          </select>
          <input aria-label="Value" value={f.value} autoComplete="off" onChange={(e) => setOnly(i, { value: e.target.value })} />
          <button type="button" className="icon-btn icon-btn-s" aria-label="Remove" title="Remove"
            onClick={() => onChange({ ...options, only: options.only.filter((_, j) => j !== i) })}>
            <Icon name="close" size={14} />
          </button>
        </div>
      ))}
      <div className="alike-options-actions">
        <button type="button" className="btn btn-quiet btn-small" onClick={() => onChange({ ...options, only: [...options.only, { field: "tag", value: "" }] })}>
          + Add a detail
        </button>
        <button type="button" className="btn btn-quiet btn-small" onClick={() => onChange(DEFAULT_OPTIONS)}>Reset</button>
      </div>
    </section>
  );
}

function KeptOut({ books: list, onBack, onLetIn }: { books: BookPreview[]; onBack: () => void; onLetIn: (book: BookPreview) => Promise<void> }) {
  return (
    <>
      <button type="button" className="back-link" onClick={onBack}><Icon name="chevronLeft" size={14} /> All groups</button>
      <h2>Kept out of Find alike</h2>
      {list.length === 0 ? (
        <p className="muted">No books are kept out.</p>
      ) : (
        <ul className="alike-books">
          {list.map((book) => (
            <li key={book.id} className="duplicate-book">
              <BookCover book={book} size="s" />
              <span className="duplicate-text">
                <strong>{book.title}</strong>
                <span className="muted">{book.authors.join(", ")}</span>
              </span>
              <button type="button" className="btn btn-quiet btn-small" onClick={() => void onLetIn(book)}>Let back in</button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** When an ignored group comes back: its day and time, or never. */
function untilText(until: string | null): string {
  if (!until) return "Forever";
  const at = new Date(until);
  return `Until ${at.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}

function Ignored({ list, onBack, onBringBack }: { list: AlikeIgnored[]; onBack: () => void; onBringBack: (g: AlikeIgnored) => Promise<void> }) {
  return (
    <>
      <button type="button" className="back-link" onClick={onBack}><Icon name="chevronLeft" size={14} /> All groups</button>
      <h2>Ignored</h2>
      {list.length === 0 ? (
        <p className="muted">No groups are ignored.</p>
      ) : (
        <ul className="alike-books">
          {list.map((g) => (
            <li key={g.id} className="duplicate-book">
              <span className="duplicate-text">
                <strong>{g.name}</strong>
                <span className="muted">{[g.author, untilText(g.until)].filter(Boolean).join(" · ")}</span>
              </span>
              <button type="button" className="btn btn-quiet btn-small" onClick={() => void onBringBack(g)}>Bring back</button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** How long to ignore a group: hours typed in, a day, a week, a month, or for good. */
function IgnoreFor({ onIgnore }: { onIgnore: (hours: number | null) => void }) {
  const [hours, setHours] = useState("");
  const typed = Number(hours.replace(",", "."));
  const ok = hours.trim() !== "" && Number.isFinite(typed) && typed > 0;
  return (
    <div className="alike-ignore" role="group" aria-label="Ignore for">
      <input inputMode="decimal" placeholder="Hours" aria-label="Hours" value={hours} onChange={(e) => setHours(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && ok && onIgnore(typed)} />
      <button type="button" className="btn btn-quiet btn-small" disabled={!ok} onClick={() => onIgnore(typed)}>Hours</button>
      <button type="button" className="btn btn-quiet btn-small" onClick={() => onIgnore(24)}>Day</button>
      <button type="button" className="btn btn-quiet btn-small" onClick={() => onIgnore(24 * 7)}>Week</button>
      <button type="button" className="btn btn-quiet btn-small" onClick={() => onIgnore(24 * 30)}>Month</button>
      <button type="button" className="btn btn-quiet btn-small" onClick={() => onIgnore(null)}>Forever</button>
    </div>
  );
}

type Online = { state: "idle" } | { state: "looking" } | { state: "found"; entries: SeriesEntry[] } | { state: "failed"; reason: string };

function GroupView({ group, onBack, onNotHere, onKeepOut, onChanged, onIgnore }: {
  group: AlikeGroup;
  onBack: () => void;
  onNotHere: (bookId: string) => void;
  onKeepOut: (book: BookPreview) => Promise<void>;
  onChanged: () => void;
  onIgnore?: (hours: number | null) => Promise<void>;
}) {
  const toast = useToast();
  const loose = group.books.filter((b) => !b.book.series?.trim());
  const stacks = useMemo(() => {
    const byName = new Map<string, AlikeBook[]>();
    for (const b of group.books) {
      const name = b.book.series?.trim();
      if (name) byName.set(name, [...(byName.get(name) ?? []), b]);
    }
    return [...byName.entries()].map(([name, list]) => ({
      name,
      books: list.sort((a, b) => (a.book.seriesIndex ?? Infinity) - (b.book.seriesIndex ?? Infinity)),
    }));
  }, [group]);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [numbers, setNumbers] = useState<Map<string, string>>(
    () => new Map(group.books.map((b) => [b.book.id, b.book.series?.trim() ? numberText(b.book.seriesIndex) : numberText(b.guess)])),
  );
  const [name, setName] = useState(group.name);
  const [withAudio, setWithAudio] = useState(true);
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState<Online>({ state: "idle" });
  const titleOf = (id: string) => group.books.find((b) => b.book.id === id)?.book.title ?? "";

  const found = online.state === "found" ? online.entries : [];
  const onlineNumber = (b: AlikeBook) => found.find((e) => titleKey(e.title) === titleKey(b.book.title))?.position ?? null;
  const notHereOnline = found.filter((e) => !group.books.some((b) => titleKey(b.book.title) === titleKey(e.title)));
  // Books already in a series can be chosen too, so a group split across series can be joined.
  const chosenBooks = group.books.filter((b) => chosen.has(b.book.id));
  // Shift picks a range, in the order the books are shown.
  const order = [...stacks.flatMap((s) => s.books), ...loose].map((b) => b.book.id);
  const pickRange = useRangePick();
  const choose = (id: string) => (shift: boolean) => setChosen(pickRange(chosen, order, id, shift));
  // Series folded to their header line.
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const fold = (name: string) => setFolded((s) => {
    const next = new Set(s);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    return next;
  });
  const [ignoring, setIgnoring] = useState(false);
  // Computers: series on the left and books in no series on the right, each scrolling on its own.
  const two = !useNarrow() && stacks.length > 0 && loose.length > 0;
  const pairs = chosenBooks.filter((b) => b.pairedAudio);

  const lookUp = async () => {
    setOnline({ state: "looking" });
    try {
      const entries = (await api.seriesListOnline?.(stacks[0]?.name ?? name, group.author)) ?? [];
      setOnline({ state: "found", entries });
    } catch (e) {
      setOnline({ state: "failed", reason: e instanceof Error ? e.message : String(e) });
    }
  };

  /** Puts the chosen books in `series`, each with its number; Undo puts back what they had. */
  const putIn = async (series: string) => {
    const series_ = series.trim();
    if (!series_ || !chosenBooks.length) return;
    // Every number is checked before anything is saved, so a wrong one changes nothing.
    const wrong = chosenBooks.find((b) => !validNumber(numbers.get(b.book.id) ?? ""));
    if (wrong) return toast(`The number for “${wrong.book.title}” should be a number, like 2 or 2.5.`);
    setBusy(true);
    const changes: { id: string; number: string; before: BookPreview | null }[] = [];
    for (const b of chosenBooks) {
      const number = numbers.get(b.book.id)?.trim() ?? "";
      changes.push({ id: b.book.id, number, before: b.book });
      if (withAudio && b.pairedAudio) {
        const audio = await api.bookDetails(b.pairedAudio).then((d) => d.book, () => null);
        changes.push({ id: b.pairedAudio, number, before: audio });
      }
    }
    const set = (id: string, series: string | null, number: string | null): Promise<void> => {
      const edit: DetailChange[] = [
        { field: "series", value: series },
        { field: "series_index", value: number || null },
      ];
      return api.editDetails([id], edit);
    };
    const done: typeof changes = [];
    try {
      for (const c of changes) {
        await set(c.id, series_, c.number);
        done.push(c);
      }
      const count = chosenBooks.length;
      setChosen(new Set());
      onChanged();
      toast(`${books(count)} ${count === 1 ? "is" : "are"} now in “${series_}”.`, {
        label: "Undo",
        run: () => {
          void (async () => {
            for (const c of changes) await set(c.id, c.before?.series?.trim() || null, numberText(c.before?.seriesIndex) || null);
            onChanged();
          })();
        },
      });
    } catch (e) {
      // What was already changed goes back, so nothing is left half done.
      for (const c of done) await set(c.id, c.before?.series?.trim() || null, numberText(c.before?.seriesIndex) || null).catch(() => undefined);
      onChanged();
      toast(`Couldn't change the series, so nothing was changed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button type="button" className="back-link" onClick={onBack}><Icon name="chevronLeft" size={14} /> All groups</button>
      <div className="alike-head">
        <h2>{group.name}</h2>
        {onIgnore && (
          <button type="button" className={`btn btn-quiet btn-small${ignoring ? " is-lit" : ""}`} aria-expanded={ignoring} onClick={() => setIgnoring((o) => !o)}>
            <Icon name="eyeOff" size={14} /> Ignore
          </button>
        )}
      </div>
      {ignoring && onIgnore && <IgnoreFor onIgnore={(hours) => void onIgnore(hours)} />}
      <p className="muted">{group.author} · {books(group.books.length)}</p>

      <div className="alike-online">
        {online.state === "looking" ? (
          <span className="muted">Looking online…</span>
        ) : online.state === "found" ? (
          <>
            <span className="muted">
              Online lists {books(found.length)}{notHereOnline.length ? `, ${notHereOnline.length} not in this group` : ""}.
            </span>
            {loose.some((b) => onlineNumber(b) != null) && (
              <button type="button" className="btn btn-quiet btn-small" onClick={() => setNumbers((m) => {
                const next = new Map(m);
                for (const b of loose) {
                  const n = onlineNumber(b);
                  if (n != null) next.set(b.book.id, String(n));
                }
                return next;
              })}>Use online numbers</button>
            )}
          </>
        ) : (
          <>
            {online.state === "failed" && <span className="muted">{online.reason}</span>}
            {api.seriesListOnline && (
              <button type="button" className="btn btn-quiet btn-small" onClick={() => void lookUp()}>
                <Icon name="search" size={14} /> Look up online
              </button>
            )}
          </>
        )}
      </div>

      <div className={`alike-body${two ? " alike-two" : ""}`}>
        <div className="alike-col">
        {stacks.map((stack) => {
          const gaps = gapsIn(stack.books.map((b) => b.book.seriesIndex ?? NaN));
          return (
            <section key={stack.name} className={`duplicate-group alike-stack${folded.has(stack.name) ? " is-folded" : ""}`}>
              <header>
                <button type="button" className="icon-btn icon-btn-s alike-fold" aria-expanded={!folded.has(stack.name)}
                  aria-label={folded.has(stack.name) ? `Open ${stack.name}` : `Fold ${stack.name}`} onClick={() => fold(stack.name)}>
                  <Icon name={folded.has(stack.name) ? "chevronRight" : "chevronDown"} size={14} />
                </button>
                <span>
                  <strong>{stack.name}</strong> · {books(stack.books.length)}
                  {gaps.length > 0 && <span className="alike-gaps"> · Missing {gaps.length === 1 ? "book" : "books"} {gaps.join(", ")}</span>}
                </span>
                <button type="button" className="btn btn-quiet btn-small" disabled={busy || !chosenBooks.length} onClick={() => void putIn(stack.name)}>
                  Add chosen here
                </button>
              </header>
              {!folded.has(stack.name) && <ul>
                {stack.books.map((b) => (
                  <BookRow
                    key={b.book.id}
                    item={b}
                    titleOf={titleOf}
                    chosen={chosen.has(b.book.id)}
                    onChoose={choose(b.book.id)}
                    number={numbers.get(b.book.id) ?? ""}
                    onNumber={(n) => setNumbers((m) => new Map(m).set(b.book.id, n))}
                    onNotHere={onNotHere}
                    onKeepOut={onKeepOut}
                  />
                ))}
              </ul>}
            </section>
          );
        })}
        </div>
        {loose.length > 0 && (
        <div className="alike-col">
          <section className="duplicate-group">
            <header>
              <span><strong>Not in a series</strong> · {books(loose.length)}</span>
              <label className="select-all">
                <input
                  type="checkbox"
                  checked={loose.every((b) => chosen.has(b.book.id))}
                  onChange={(e) => setChosen((s) => {
                    const next = new Set(s);
                    for (const b of loose) e.target.checked ? next.add(b.book.id) : next.delete(b.book.id);
                    return next;
                  })}
                />
                Select all
              </label>
            </header>
            <ul>
              {loose.map((b) => (
                <BookRow
                  key={b.book.id}
                  item={b}
                  titleOf={titleOf}
                  chosen={chosen.has(b.book.id)}
                  onChoose={choose(b.book.id)}
                  number={numbers.get(b.book.id) ?? ""}
                  onNumber={(n) => setNumbers((m) => new Map(m).set(b.book.id, n))}
                  online={onlineNumber(b)}
                  onNotHere={onNotHere}
                  onKeepOut={onKeepOut}
                />
              ))}
            </ul>
          </section>
        </div>
        )}
        {notHereOnline.length > 0 && (
          <p className="muted alike-missing">
            Also listed online: {notHereOnline.slice(0, 6).map((e) => `${e.title}${e.position != null ? ` (${e.position})` : ""}`).join(", ")}
            {notHereOnline.length > 6 ? `, and ${notHereOnline.length - 6} more` : ""}.
          </p>
        )}
      </div>

      {(
        <div className="alike-make">
          <label className="field">
            <span>Series name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
          </label>
          {pairs.length > 0 && (
            <label className="alike-audio">
              <input type="checkbox" checked={withAudio} onChange={(e) => setWithAudio(e.target.checked)} />
              Paired audiobooks too
            </label>
          )}
          <button type="button" className="btn btn-primary" disabled={busy || !chosenBooks.length || !name.trim()} onClick={() => void putIn(name)}>
            {chosenBooks.length ? `Make a series of ${books(chosenBooks.length)}` : "Make a series"}
          </button>
        </div>
      )}
    </>
  );
}

function BookRow({ item, titleOf, chosen, onChoose, number, onNumber, online, onNotHere, onKeepOut }: {
  item: AlikeBook;
  titleOf: (id: string) => string;
  chosen?: boolean;
  /** Flips the book, or with Shift picks every book from the last one picked. */
  onChoose?: (shift: boolean) => void;
  number: string;
  onNumber?: (n: string) => void;
  online?: number | null;
  onNotHere: (bookId: string) => void;
  onKeepOut: (book: BookPreview) => Promise<void>;
}) {
  const { book } = item;
  return (
    <li className={`duplicate-book alike-book${chosen ? " is-chosen" : ""}${onChoose ? " is-pickable" : ""}`} {...(onChoose ? rowPick(onChoose) : {})}>
      {onChoose && (
        <input type="checkbox" aria-label={`Choose ${book.title}`} checked={!!chosen} onChange={(e) => onChoose(withShift(e))} />
      )}
      <BookCover book={book} size="s" />
      <span className="duplicate-text">
        <strong>{book.title}</strong>
        <span className="muted">
          {book.format.toUpperCase()}
          {item.sameAs ? ` · Same book as “${titleOf(item.sameAs)}”` : ""}
          {online != null && String(online) !== number ? ` · Online: ${online}` : ""}
        </span>
      </span>
      {onNumber ? (
        <label className="alike-number">
          <span className="visually-hidden">Number in the series</span>
          <input inputMode="decimal" placeholder="#" value={number} onChange={(e) => onNumber(e.target.value)} aria-label={`Number of ${book.title}`} />
        </label>
      ) : (
        number && <span className="alike-number-shown">{number}</span>
      )}
      <Menu
        label={`More for ${book.title}`}
        trigger={<Icon name="more" />}
        items={[
          { label: "Not in this group", hint: "Until Find alike runs again", icon: "close", onSelect: () => onNotHere(book.id) },
          { label: "Keep out of this group", hint: "Until Book details lets it back in", icon: "eyeOff", onSelect: () => void onKeepOut(book) },
        ]}
      />
    </li>
  );
}

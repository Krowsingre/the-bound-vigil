// Find alike (embre, 21 November): books by one author whose titles start
// alike, gathered into groups with the series they're already in. From a
// group: tick books and make them a series (numbers read from their titles,
// or from a list found online), add books to a series already there, leave a
// book out of the group until Find alike runs again, or keep it out of that
// group until Book details lets it back in.

import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import type { AlikeBook, AlikeGroup, BookPreview, DetailChange, ItemKind, SeriesEntry } from "../api/types";
import { BookCover } from "../components/BookCover";
import { Icon } from "../components/Icon";
import { Menu } from "../components/Menu";
import { useToast } from "../components/Toast";

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

const books = (n: number) => `${n.toLocaleString()} ${n === 1 ? "book" : "books"}`;
const numberText = (n: number | null | undefined) => (n == null ? "" : String(n));
const sameGroup = (a: AlikeGroup, keys: string[]) => a.keys.some((k) => keys.includes(k));

export function FindAlike({ kind, onClose, onChanged }: { kind: ItemKind; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const [groups, setGroups] = useState<AlikeGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string[] | null>(null);
  const [keptOut, setKeptOut] = useState<BookPreview[] | null>(null);
  const [showKeptOut, setShowKeptOut] = useState(false);
  // "Not in this group": left out until Find alike runs again, by group and book.
  const [notHere, setNotHere] = useState<Set<string>>(new Set());
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let current = true;
    void api.findAlike?.(kind).then(
      (found) => current && (setGroups(found), setError(null)),
      (e: unknown) => current && setError(String(e)),
    );
    void api.keptOutBooks?.(kind).then((found) => current && setKeptOut(found), () => current && setKeptOut([]));
    return () => {
      current = false;
    };
  }, [kind, reload]);

  const again = () => {
    setReload((n) => n + 1);
    onChanged();
  };
  const shownBooks = (g: AlikeGroup) => g.books.filter((b) => !notHere.has(`${g.keys[0]}|${b.book.id}`));
  const shown = (groups ?? []).filter((g) => shownBooks(g).length >= 2);
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
          />
        ) : showKeptOut ? (
          <KeptOut books={keptOut ?? []} onBack={() => setShowKeptOut(false)} onLetIn={async (book) => {
            await api.includeInAlike?.(book.id);
            again();
          }} />
        ) : (
          <>
            <h2>Find alike</h2>
            {error ? (
              <p className="form-error" role="alert">{error}</p>
            ) : !groups ? (
              <div className="library-loading" aria-busy="true" aria-label="Looking for alike books" />
            ) : shown.length === 0 ? (
              <p className="muted">Nothing alike found. Books by one author whose titles start alike show up here.</p>
            ) : (
              <>
                <p className="muted">
                  {shown.length.toLocaleString()} {shown.length === 1 ? "group" : "groups"} of books by one author with alike titles. Open one to make a series.
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

type Online = { state: "idle" } | { state: "looking" } | { state: "found"; entries: SeriesEntry[] } | { state: "failed"; reason: string };

function GroupView({ group, onBack, onNotHere, onKeepOut, onChanged }: {
  group: AlikeGroup;
  onBack: () => void;
  onNotHere: (bookId: string) => void;
  onKeepOut: (book: BookPreview) => Promise<void>;
  onChanged: () => void;
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
  const [numbers, setNumbers] = useState<Map<string, string>>(() => new Map(loose.map((b) => [b.book.id, numberText(b.guess)])));
  const [name, setName] = useState(group.name);
  const [withAudio, setWithAudio] = useState(true);
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState<Online>({ state: "idle" });
  const titleOf = (id: string) => group.books.find((b) => b.book.id === id)?.book.title ?? "";

  const found = online.state === "found" ? online.entries : [];
  const onlineNumber = (b: AlikeBook) => found.find((e) => titleKey(e.title) === titleKey(b.book.title))?.position ?? null;
  const notHereOnline = found.filter((e) => !group.books.some((b) => titleKey(b.book.title) === titleKey(e.title)));
  const chosenBooks = loose.filter((b) => chosen.has(b.book.id));
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
    try {
      for (const c of changes) await set(c.id, series_, c.number);
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
      toast(`Couldn't change the series: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button type="button" className="back-link" onClick={onBack}><Icon name="chevronLeft" size={14} /> All groups</button>
      <h2>{group.name}</h2>
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

      <div className="alike-body">
        {stacks.map((stack) => {
          const gaps = gapsIn(stack.books.map((b) => b.book.seriesIndex ?? NaN));
          return (
            <section key={stack.name} className="duplicate-group alike-stack">
              <header>
                <span>
                  <strong>{stack.name}</strong> · {books(stack.books.length)}
                  {gaps.length > 0 && <span className="alike-gaps"> · Missing {gaps.length === 1 ? "book" : "books"} {gaps.join(", ")}</span>}
                </span>
                <button type="button" className="btn btn-quiet btn-small" disabled={busy || !chosenBooks.length} onClick={() => void putIn(stack.name)}>
                  Add chosen here
                </button>
              </header>
              <ul>
                {stack.books.map((b) => (
                  <BookRow key={b.book.id} item={b} titleOf={titleOf} number={numberText(b.book.seriesIndex)} onNotHere={onNotHere} onKeepOut={onKeepOut} />
                ))}
              </ul>
            </section>
          );
        })}
        {loose.length > 0 && (
          <section className="duplicate-group">
            <header>
              <span><strong>Not in a series</strong> · {books(loose.length)}</span>
              <label className="select-all">
                <input
                  type="checkbox"
                  checked={chosen.size === loose.length}
                  onChange={(e) => setChosen(e.target.checked ? new Set(loose.map((b) => b.book.id)) : new Set())}
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
                  onChoose={(on) => setChosen((s) => {
                    const next = new Set(s);
                    if (on) next.add(b.book.id);
                    else next.delete(b.book.id);
                    return next;
                  })}
                  number={numbers.get(b.book.id) ?? ""}
                  onNumber={(n) => setNumbers((m) => new Map(m).set(b.book.id, n))}
                  online={onlineNumber(b)}
                  onNotHere={onNotHere}
                  onKeepOut={onKeepOut}
                />
              ))}
            </ul>
          </section>
        )}
        {notHereOnline.length > 0 && (
          <p className="muted alike-missing">
            Also listed online: {notHereOnline.slice(0, 6).map((e) => `${e.title}${e.position != null ? ` (${e.position})` : ""}`).join(", ")}
            {notHereOnline.length > 6 ? `, and ${notHereOnline.length - 6} more` : ""}.
          </p>
        )}
      </div>

      {loose.length > 0 && (
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
  onChoose?: (on: boolean) => void;
  number: string;
  onNumber?: (n: string) => void;
  online?: number | null;
  onNotHere: (bookId: string) => void;
  onKeepOut: (book: BookPreview) => Promise<void>;
}) {
  const { book } = item;
  return (
    <li className={`duplicate-book alike-book${chosen ? " is-chosen" : ""}`}>
      {onChoose && (
        <input type="checkbox" aria-label={`Choose ${book.title}`} checked={!!chosen} onChange={(e) => onChoose(e.target.checked)} />
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

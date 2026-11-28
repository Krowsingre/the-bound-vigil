// The series a book is in, as rows: each series once, with the numbers the
// book is in it ("3", a range "1–3" for an omnibus, or a list "10, 12, 14"
// for one that collects books that aren't one after another), or no number
// for a side story read after a given book. The first row is the main
// series; drag a row up, or press Make main, to change it. Older TBVs see
// only the main series.

import { useState } from "react";
import type { BookPreview, DetailChange, SeriesPlace } from "../api/types";
import { Icon } from "../components/Icon";
import { groupPlaces, numbersText, placesOf, samePlace } from "../lib/details";
export { placesFromFields } from "../lib/details";
import { SuggestInput } from "./Suggest";

export type PlaceKind = "number" | "omnibus" | "side";

/** One row as typed. */
export interface PlaceRow {
  key: number;
  name: string;
  kind: PlaceKind;
  /** "3", "1–3" or "10, 12, 14". */
  number: string;
  after: string;
  /** An omnibus's own number: "2" for Omnibus 2. */
  omnibus?: string;
}

let nextKey = 1;
const text = (n: number | null | undefined) => (n == null ? "" : String(n));

/** The rows for a book's places: a series' numbers share one row, a side story has its own. */
export function rowsOf(places: SeriesPlace[]): PlaceRow[] {
  const rows: PlaceRow[] = [];
  for (const { name, places: here } of groupPlaces(places)) {
    const sides = here.filter((p) => p.number == null && p.after != null);
    const numbered = here.filter((p) => p.number != null || p.omnibus != null);
    const omnibus = numbered.find((p) => p.omnibus != null)?.omnibus;
    if (numbered.length || !sides.length)
      rows.push({
        key: nextKey++,
        name,
        kind: omnibus != null ? "omnibus" : "number",
        number: numbersText(numbered),
        after: "",
        ...(omnibus != null ? { omnibus: text(omnibus) } : {}),
      });
    for (const p of sides) rows.push({ key: nextKey++, name, kind: "side", number: "", after: text(p.after) });
  }
  return rows;
}

export const emptyRow = (): PlaceRow => ({ key: nextKey++, name: "", kind: "number", number: "", after: "" });

/** A number typed, or null for none; throws when it isn't one. */
function numberOf(typed: string, what: string): number | null {
  const t = typed.trim();
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0 || n >= 100_000) throw new Error(`The ${what} should be a number, like 2 or 2.5.`);
  return n;
}

/** The numbers typed in a row, as places: "3", "1–3", "10, 12, 14", "1-3, 5". */
function numbersIn(name: string, typed: string): SeriesPlace[] {
  const out: SeriesPlace[] = [];
  for (const part of typed.split(/[,;]/)) {
    const item = part.trim();
    if (!item) continue;
    const range = /^(.+?)\s*(?:[-–—]|\bto\b)\s*(.+)$/i.exec(item);
    if (!range) {
      out.push({ name, number: numberOf(item, "number in series") });
      continue;
    }
    const number = numberOf(range[1], "number in series");
    const end = numberOf(range[2], "last number");
    if (number == null || end == null || end <= number) throw new Error(`For ${name}, write a range as the first and last numbers, like 1–3.`);
    out.push({ name, number, end });
  }
  return out;
}

/** The rows as places, main first; empty names are left out. Throws on a bad number. */
export function placesFromRows(rows: PlaceRow[]): SeriesPlace[] {
  const out: SeriesPlace[] = [];
  const add = (place: SeriesPlace) => {
    if (!out.some((p) => samePlace(p, place))) out.push(place);
  };
  for (const row of rows) {
    const name = row.name.split(/\s+/).filter(Boolean).join(" ");
    if (!name) continue;
    if (row.kind === "side") {
      add({ name, after: numberOf(row.after.replace(",", "."), "book a side story follows") ?? 0 });
      continue;
    }
    const numbers = numbersIn(name, row.number);
    const omnibus = row.kind === "omnibus" ? numberOf((row.omnibus ?? "").replace(",", "."), "omnibus number") : null;
    if (omnibus != null) {
      // The omnibus's own number goes with the books it holds, or alone.
      if (numbers.length) numbers.forEach((p) => add({ ...p, omnibus }));
      else add({ name, number: null, omnibus });
    } else if (numbers.length) numbers.forEach(add);
    // No number: only where the book isn't in that series already.
    else if (!out.some((p) => p.name.toLowerCase() === name.toLowerCase())) add({ name, number: null });
  }
  return out;
}

/** Whether places need the list kept beside the series and number. */
const needsList = (places: SeriesPlace[]) => places.length > 1 || places.some((p) => p.end != null || p.after != null || p.omnibus != null);

/** The details changes that give a book these places. */
export function placeChanges(places: SeriesPlace[]): DetailChange[] {
  const main = places[0];
  return [
    { field: "series", value: main?.name ?? "" },
    { field: "series_index", value: main?.number != null ? String(main.number) : "" },
    { field: "series_list", value: needsList(places) ? JSON.stringify(places) : null },
  ];
}

/** A bulk series change for one book: `name` numbered `number` (or none),
 *  added to the series it's in, or as its only series. */
export function bulkPlaces(book: BookPreview, name: string, number: number | null, add: boolean): SeriesPlace[] {
  const place: SeriesPlace = { name, number };
  if (!add) return [place];
  const had = placesOf(book);
  const at = had.findIndex((p) => p.name.toLowerCase() === name.toLowerCase());
  if (at < 0) return [...had, place];
  // Already in it: a number given replaces the one it had.
  return had.map((p, i) => (i === at && number != null ? { name: p.name, number } : p));
}

export function SeriesEditor({ rows, onChange, all }: { rows: PlaceRow[]; onChange: (rows: PlaceRow[]) => void; all: string[] }) {
  const [dragging, setDragging] = useState<number | null>(null);
  const update = (key: number, change: Partial<PlaceRow>) => onChange(rows.map((r) => (r.key === key ? { ...r, ...change } : r)));
  const move = (from: number, to: number) => {
    if (from === to) return;
    const next = [...rows];
    const [row] = next.splice(from, 1);
    next.splice(to, 0, row);
    onChange(next);
  };
  return (
    <div className="series-rows">
      {rows.map((row, i) => (
        <div
          key={row.key}
          className={`series-edit-row${dragging === i ? " is-dragging" : ""}`}
          onDragOver={(e) => {
            if (dragging === null) return;
            e.preventDefault();
            if (dragging !== i) {
              move(dragging, i);
              setDragging(i);
            }
          }}
          onDrop={(e) => e.preventDefault()}
        >
          <span
            className="series-drag"
            draggable={rows.length > 1}
            title={rows.length > 1 ? "Drag to change the main series" : undefined}
            aria-hidden
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", row.name);
              setDragging(i);
            }}
            onDragEnd={() => setDragging(null)}
          >
            <Icon name="menu" size={14} />
          </span>
          <SuggestInput
            className="series-edit-name"
            value={row.name}
            onChange={(name) => update(row.key, { name })}
            all={all.filter((n) => !rows.some((r) => r.key !== row.key && r.name.trim().toLowerCase() === n.toLowerCase()))}
            id={i === 0 ? "detail-series" : undefined}
            label={i === 0 ? "Main series" : `Series ${i + 1}`}
            placeholder="Series name"
          />
          <select
            className="series-edit-kind"
            aria-label={`How ${row.name || "the book"} is numbered`}
            value={row.kind}
            onChange={(e) => update(row.key, { kind: e.target.value as PlaceKind })}
          >
            <option value="number">Book</option>
            <option value="omnibus">Omnibus</option>
            <option value="side">Side story</option>
          </select>
          {row.kind === "side" ? (
            <label className="series-edit-numbers">
              <span className="muted">after</span>
              <input inputMode="decimal" autoComplete="off" value={row.after} placeholder="0" aria-label="After book" onChange={(e) => update(row.key, { after: e.target.value })} />
            </label>
          ) : (
            <span className="series-edit-numbers">
              <input
                className="series-edit-list"
                autoComplete="off"
                value={row.number}
                placeholder="3, 1–3, or 10, 12"
                title="One number, a range like 1–3, or several like 10, 12, 14"
                aria-label="Number in series"
                onChange={(e) => update(row.key, { number: e.target.value })}
              />
              {row.kind === "omnibus" && (
                <label className="series-edit-omnibus">
                  <span className="muted">no.</span>
                  <input
                    inputMode="decimal"
                    autoComplete="off"
                    value={row.omnibus ?? ""}
                    placeholder="1"
                    aria-label="Omnibus number"
                    onChange={(e) => update(row.key, { omnibus: e.target.value })}
                  />
                </label>
              )}
            </span>
          )}
          <span className="series-edit-tools">
            {i === 0 ? (
              rows.length > 1 && <span className="series-main-mark">Main</span>
            ) : (
              <button type="button" className="view-all" onClick={() => move(i, 0)}>
                Make main
              </button>
            )}
            <button type="button" className="icon-btn" aria-label={`Take the book out of ${row.name || "this series"}`} onClick={() => onChange(rows.filter((r) => r.key !== row.key))}>
              <Icon name="close" size={14} />
            </button>
          </span>
        </div>
      ))}
      <button type="button" className="view-all series-add" onClick={() => onChange([...rows, emptyRow()])}>
        <Icon name="plus" size={14} /> Add series
      </button>
    </div>
  );
}

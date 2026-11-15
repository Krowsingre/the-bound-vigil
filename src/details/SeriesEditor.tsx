// The series a book is in, as rows: each with its number, a range of
// numbers for an omnibus ("Books 1–3"), or no number for a side story read
// after a given book. The first row is the main series; drag a row up, or
// press Make main, to change it. Older TBVs see only the main series.

import { useState } from "react";
import type { BookPreview, DetailChange, SeriesPlace } from "../api/types";
import { Icon } from "../components/Icon";
import { placesOf } from "../lib/details";
export { placesFromFields } from "../lib/details";
import { SuggestInput } from "./Suggest";

export type PlaceKind = "number" | "range" | "side";

/** One row as typed. */
export interface PlaceRow {
  key: number;
  name: string;
  kind: PlaceKind;
  number: string;
  end: string;
  after: string;
}

let nextKey = 1;
const text = (n: number | null | undefined) => (n == null ? "" : String(n));

export function rowOf(place: SeriesPlace): PlaceRow {
  const kind: PlaceKind = place.number != null && place.end != null ? "range" : place.number == null && place.after != null ? "side" : "number";
  return { key: nextKey++, name: place.name, kind, number: text(place.number), end: text(place.end), after: text(place.after) };
}

export const emptyRow = (): PlaceRow => ({ key: nextKey++, name: "", kind: "number", number: "", end: "", after: "" });

/** A number typed, or null for none; throws when it isn't one. */
function numberOf(typed: string, what: string): number | null {
  const t = typed.trim().replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0 || n >= 100_000) throw new Error(`The ${what} should be a number, like 2 or 2.5.`);
  return n;
}

/** The rows as places, main first; empty names are left out. Throws on a bad number. */
export function placesFromRows(rows: PlaceRow[]): SeriesPlace[] {
  const out: SeriesPlace[] = [];
  for (const row of rows) {
    const name = row.name.split(/\s+/).filter(Boolean).join(" ");
    if (!name || out.some((p) => p.name.toLowerCase() === name.toLowerCase())) continue;
    if (row.kind === "side") {
      out.push({ name, after: numberOf(row.after, "book a side story follows") ?? 0 });
      continue;
    }
    const number = numberOf(row.number, "number in series");
    const end = row.kind === "range" ? numberOf(row.end, "last number") : null;
    if (row.kind === "range" && (number == null || end == null || end <= number))
      throw new Error(`For ${name}, give the first and last numbers the book holds, like 1 to 3.`);
    out.push(end != null ? { name, number, end } : { name, number });
  }
  return out;
}

/** Whether places need the list kept beside the series and number. */
const needsList = (places: SeriesPlace[]) => places.length > 1 || places.some((p) => p.end != null || p.after != null);

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
            <option value="range">Books</option>
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
                inputMode="decimal"
                autoComplete="off"
                value={row.number}
                placeholder={row.kind === "range" ? "1" : "No."}
                aria-label={row.kind === "range" ? "First number" : "Number in series"}
                onChange={(e) => update(row.key, { number: e.target.value })}
              />
              {row.kind === "range" && (
                <>
                  <span className="muted">to</span>
                  <input inputMode="decimal" autoComplete="off" value={row.end} placeholder="3" aria-label="Last number" onChange={(e) => update(row.key, { end: e.target.value })} />
                </>
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

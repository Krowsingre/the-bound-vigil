// A book's details in their layers, as the core keeps them (details.rs):
// your edit, else details fetched online (or read from the file beyond the
// basics), else the book's own. For the browser preview, the web version and
// the Book details page.

import type { BookPreview, DetailField, DetailFieldName, SeriesPlace } from "../api/types";

export const DETAIL_FIELDS: { field: DetailFieldName; label: string; list?: boolean; long?: boolean }[] = [
  { field: "title", label: "Title" },
  { field: "authors", label: "Authors", list: true },
  { field: "series", label: "Series" },
  { field: "series_index", label: "Number in series" },
  { field: "synopsis", label: "Description", long: true },
  { field: "genres", label: "Genres", list: true },
  { field: "publisher", label: "Publisher" },
  { field: "published", label: "Published" },
  { field: "language", label: "Language" },
  { field: "isbn", label: "ISBN" },
  { field: "narrators", label: "Narrators", list: true },
  // Every series a book is in; edited with the series, never on its own.
  { field: "series_list", label: "Series" },
];

/** Details that only audiobooks have. */
export const AUDIO_ONLY: DetailFieldName[] = ["narrators"];

export const detailLabel = (field: DetailFieldName) => DETAIL_FIELDS.find((f) => f.field === field)?.label ?? field;
export const isList = (field: DetailFieldName) => field === "authors" || field === "genres" || field === "narrators";

/** The value that shows: your edit, else fetched, else the book's own. */
export function effective(f: DetailField): string | null {
  return f.edited ?? f.fetched ?? f.own;
}

/** A list field's names, or a plain field's text, for showing. */
export function listOf(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

const collapse = (s: string) => s.split(/\s+/).filter(Boolean).join(" ");

/** A value as the core keeps it (clean_value in details.rs), or throws saying what's wrong. */
export function cleanValue(field: DetailFieldName, value: string): string {
  if (isList(field)) {
    const kept: string[] = [];
    for (const item of listOf(value).map(collapse).filter(Boolean)) {
      const short = [...item].slice(0, 500).join("");
      if (kept.length < 20 && !kept.some((k) => k.toLowerCase() === short.toLowerCase())) kept.push(short);
    }
    if (field === "authors" && !kept.length) throw new Error("A book needs at least one author.");
    return JSON.stringify(kept);
  }
  const text = field === "synopsis" ? [...value.trim()].slice(0, 20_000).join("") : [...collapse(value)].slice(0, 500).join("");
  if (field === "series_list") return cleanSeriesList(value);
  if (field === "title" && !text) throw new Error("A book needs a title.");
  if (field === "series_index" && text) {
    const n = Number(text.replace(",", "."));
    if (!Number.isFinite(n) || n < 0 || n >= 100_000) throw new Error("The number in series should be a number, like 2 or 2.5.");
    return String(n);
  }
  if (field === "isbn" && text) {
    const digits = text.replace(/[^0-9a-z]/gi, "").toUpperCase();
    if (digits.length !== 10 && digits.length !== 13) throw new Error("An ISBN has 10 or 13 digits.");
    return digits;
  }
  return text;
}

/** The parts of a book preview its details decide. */
export function previewFields(fields: DetailField[]): Partial<BookPreview> {
  const get = (name: DetailFieldName) => {
    const f = fields.find((x) => x.field === name);
    return f ? effective(f) : null;
  };
  const index = get("series_index");
  const series = get("series");
  const places = placesFromFields(fields);
  const needs = places.length > 1 || places.some((p) => p.end != null || p.after != null);
  return {
    seriesPlaces: needs ? places : undefined,
    title: get("title") ?? "",
    authors: listOf(get("authors")),
    series: series?.trim() ? series : null,
    seriesIndex: index?.trim() && Number.isFinite(Number(index)) ? Number(index) : null,
    synopsis: get("synopsis"),
    genres: listOf(get("genres")),
    narrators: listOf(get("narrators")),
  };
}

/** What these books already have for a detail, one spelling each, A to Z
 *  (detail_suggestions in browse.rs, for the preview and the web version). */
export function suggestionsFrom(books: BookPreview[], field: DetailFieldName): string[] {
  const values = books.flatMap((b): (string | null | undefined)[] => {
    switch (field) {
      case "series":
        return [b.series, ...(b.seriesPlaces ?? []).map((p) => p.name)];
      case "authors":
        return b.authors;
      case "genres":
        return b.genres ?? [];
      case "narrators":
        return b.narrators ?? [];
      case "language":
        return [b.language];
      default:
        return [];
    }
  });
  const kept = new Map<string, string>();
  for (const v of values) {
    const clean = v?.trim();
    if (clean && !kept.has(clean.toLowerCase())) kept.set(clean.toLowerCase(), clean);
  }
  return [...kept.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

/** The best few of `all` for what's typed: those starting with it first,
 *  then those holding it, leaving out what's already chosen. */
export function bestMatches(all: string[], typed: string, taken: string[] = [], limit = 6): string[] {
  const q = typed.trim().toLowerCase();
  if (!q) return [];
  const used = new Set(taken.map((t) => t.toLowerCase()));
  const starts: string[] = [];
  const holds: string[] = [];
  for (const name of all) {
    const low = name.toLowerCase();
    if (used.has(low) || low === q) continue;
    if (low.startsWith(q)) starts.push(name);
    else if (low.includes(q)) holds.push(name);
    if (starts.length >= limit) break;
  }
  return [...starts, ...holds].slice(0, limit);
}

/** "3" rather than "3.0". */
const num = (n: number) => String(n);

/** A book's places in series, main first: its own list, or its series and number. */
export function placesOf(book: Pick<BookPreview, "series" | "seriesIndex" | "seriesPlaces">): SeriesPlace[] {
  if (book.seriesPlaces?.length) return book.seriesPlaces;
  return book.series?.trim() ? [{ name: book.series.trim(), number: book.seriesIndex }] : [];
}

const nearly = (a: number | null | undefined, b: number | null | undefined) => (a == null ? b == null : b != null && Math.abs(a - b) < 1e-6);

/** The same series and the same place in it (same_as in series.rs). */
export const samePlace = (a: SeriesPlace, b: SeriesPlace) =>
  a.name.trim().toLowerCase() === b.name.trim().toLowerCase() && nearly(a.number, b.number) && nearly(a.end, b.end) && nearly(a.after, b.after);

/** Where a place sorts in its series: its number, or just after the book it follows. */
export const placeOrder = (p: SeriesPlace): number | null => p.number ?? (p.after != null ? p.after + 0.001 : null);

/** Its places in one series: usually one, several for a collection of books
 *  that aren't one after another in it (10, 12 and 14). Earliest first. */
export function placesIn(book: Pick<BookPreview, "series" | "seriesIndex" | "seriesPlaces">, name: string): SeriesPlace[] {
  const key = name.trim().toLowerCase();
  const order = (p: SeriesPlace) => placeOrder(p) ?? Number.MAX_VALUE;
  return placesOf(book)
    .filter((p) => p.name.trim().toLowerCase() === key)
    .sort((a, b) => order(a) - order(b));
}

/** Its first place in one series, if it's in it. */
export function placeIn(book: Pick<BookPreview, "series" | "seriesIndex" | "seriesPlaces">, name: string): SeriesPlace | null {
  return placesIn(book, name)[0] ?? null;
}

/** Places by series, each series once, in the order first listed. */
export function groupPlaces(places: SeriesPlace[]): { name: string; places: SeriesPlace[] }[] {
  const out: { name: string; places: SeriesPlace[] }[] = [];
  for (const p of places) {
    const group = out.find((g) => g.name.toLowerCase() === p.name.trim().toLowerCase());
    if (group) group.places.push(p);
    else out.push({ name: p.name.trim(), places: [p] });
  }
  return out;
}

/** The numbers typed for a series row: "10, 12, 14" or "1–3, 5". */
export function numbersText(places: SeriesPlace[]): string {
  return places
    .filter((p) => p.number != null)
    .map((p) => (p.end != null ? `${num(p.number!)}–${num(p.end)}` : num(p.number!)))
    .join(", ");
}

/** One series' places in words: "Book 3", "Books 10, 12, 14", "Books 1–3, 5". */
export function placesWords(places: SeriesPlace[]): string {
  if (places.length === 1) return placeWords(places[0]);
  const numbered = places.filter((p) => p.number != null);
  const parts = numbered.length ? [`Books ${numbersText(numbered)}`] : [];
  for (const p of places) if (p.number == null && p.after != null) parts.push(parts.length ? placeWords(p).toLowerCase() : placeWords(p));
  return parts.join("; ") || "No number";
}

/** One series' places, short: "#3", "#10, 12, 14". */
export function placesMark(places: SeriesPlace[]): string {
  if (places.length === 1) return placeMark(places[0]);
  const text = numbersText(places);
  return text ? `#${text}` : placeMark(places[0]);
}

/** A place in words, short: "#3", "#1–3", "Side story", or "" with no number. */
export function placeMark(place: SeriesPlace): string {
  if (place.number != null) return place.end != null ? `#${num(place.number)}–${num(place.end)}` : `#${num(place.number)}`;
  return place.after != null ? "Side story" : "";
}

/** A place in words, long: "Book 3", "Books 1–3", "Side story, after book 2". */
export function placeWords(place: SeriesPlace): string {
  if (place.number != null) return place.end != null ? `Books ${num(place.number)}–${num(place.end)}` : `Book ${num(place.number)}`;
  if (place.after != null) return place.after > 0 ? `Side story, after book ${num(place.after)}` : "Side story, before book 1";
  return "No number";
}

/** "Series #3", or "Series, side story": a place with its series' name. */
export function placeLine(place: SeriesPlace): string {
  const mark = placeMark(place);
  return !mark ? place.name : mark.startsWith("#") ? `${place.name} ${mark}` : `${place.name}, ${mark.toLowerCase()}`;
}

/** The places a book's details give, main first (places_of in series.rs). */
export function placesFromFields(fields: DetailField[]): SeriesPlace[] {
  const get = (name: string) => {
    const f = fields.find((x) => x.field === name);
    return f ? effective(f) : null;
  };
  const index = get("series_index");
  let list: SeriesPlace[] | undefined;
  try {
    const parsed = JSON.parse(get("series_list") ?? "null") as unknown;
    if (Array.isArray(parsed)) list = parsed as SeriesPlace[];
  } catch {
    list = undefined;
  }
  const main = get("series")?.trim() || null;
  const number = index?.trim() && Number.isFinite(Number(index)) ? Number(index) : null;
  if (!list) return main ? [{ name: main, number }] : [];
  const out: SeriesPlace[] = [];
  // Which listed place is the main one: the same series and number, or
  // (when an older TBV changed the number) the first place in that series.
  let mainAt = -1;
  if (main) {
    const same = (p: SeriesPlace) => p.name?.trim().toLowerCase() === main.toLowerCase();
    mainAt = list.findIndex((p) => same(p) && nearly(p.number, number));
    if (mainAt < 0) mainAt = list.findIndex(same);
    const kept = mainAt >= 0 ? list[mainAt] : undefined;
    const end = number != null && kept?.end != null && kept.end > number ? kept.end : null;
    const after = number == null ? (kept?.after ?? null) : null;
    out.push({ name: main, number, ...(end != null ? { end } : {}), ...(after != null ? { after } : {}) });
  }
  list.forEach((p, i) => {
    const name = p.name?.trim();
    const place = { ...p, name };
    if (name && i !== mainAt && !out.some((o) => samePlace(o, place))) out.push(place);
  });
  return out;
}


/** The series list as the core keeps it (clean_series_list in series.rs). */
function cleanSeriesList(value: string): string {
  let items: unknown;
  try {
    items = JSON.parse(value);
  } catch {
    throw new Error("The series should be a list.");
  }
  if (!Array.isArray(items)) throw new Error("The series should be a list.");
  const ok = (n: unknown) => (typeof n === "number" && Number.isFinite(n) && n >= 0 && n < 100_000 ? n : null);
  const kept: SeriesPlace[] = [];
  for (const item of items as Record<string, unknown>[]) {
    const name = [...collapse(String(item?.name ?? ""))].slice(0, 500).join("");
    if (!name || kept.length >= 20) continue;
    const number = ok(item.number);
    const end = number !== null && ok(item.end) !== null && ok(item.end)! > number ? ok(item.end) : null;
    const after = number === null ? ok(item.after) : null;
    const place: SeriesPlace = { name, ...(number !== null ? { number } : {}), ...(end !== null ? { end } : {}), ...(after !== null ? { after } : {}) };
    // In a series several times (10, 12 and 14), but each place once.
    if (!kept.some((k) => samePlace(k, place))) kept.push(place);
  }
  return JSON.stringify(kept);
}

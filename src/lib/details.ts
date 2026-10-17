// A book's details in their layers, as the core keeps them (details.rs):
// your edit, else details fetched online (or read from the file beyond the
// basics), else the book's own. For the browser preview, the web version and
// the Book details page.

import type { BookPreview, DetailField, DetailFieldName } from "../api/types";

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
  return {
    title: get("title") ?? "",
    authors: listOf(get("authors")),
    series: series?.trim() ? series : null,
    seriesIndex: index && Number.isFinite(Number(index)) ? Number(index) : null,
    synopsis: get("synopsis"),
    genres: listOf(get("genres")),
    narrators: listOf(get("narrators")),
  };
}

// What a book's place in its series is called (embre, 3 November 2026):
// "Book 2", "Volume II", "Part Three"... Kept in the book's export settings,
// so it syncs with the book, and used on the title page and the cover.

export const SERIES_WORDS = ["Book", "Volume", "Part", "Number", "Episode", "Tome", "Issue", "Chronicle"] as const;

export type SeriesNumbers = "digits" | "words" | "roman";

export const SERIES_NUMBERS: { value: SeriesNumbers; label: string }[] = [
  { value: "digits", label: "2" },
  { value: "words", label: "Two" },
  { value: "roman", label: "II" },
];

export interface SeriesStyle {
  /** "Book", "Volume"…, or the writer's own word; empty for the number alone. */
  word: string;
  numbers: SeriesNumbers;
}

export const DEFAULT_SERIES_STYLE: SeriesStyle = { word: "Book", numbers: "digits" };

export function readSeriesStyle(saved: unknown): SeriesStyle {
  const s = (saved && typeof saved === "object" ? saved : {}) as Record<string, unknown>;
  return {
    word: typeof s.word === "string" ? s.word.trim().slice(0, 40) : DEFAULT_SERIES_STYLE.word,
    numbers: s.numbers === "words" || s.numbers === "roman" ? s.numbers : "digits",
  };
}

const ONES = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function inWords(n: number): string {
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10].toLowerCase()}` : "");
  return String(n);
}

function roman(n: number): string {
  const marks: [number, string][] = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
  let out = "";
  for (const [v, m] of marks) while (n >= v) (out += m), (n -= v);
  return out;
}

/** The number as the writer wants it written. Half books like 2.5 stay as digits. */
export function seriesNumber(index: number, numbers: SeriesNumbers): string {
  if (!Number.isInteger(index) || index < 1 || index > 3999 || numbers === "digits") return String(index);
  return numbers === "roman" ? roman(index) : inWords(index);
}

/** "Book 2", "Volume II", or just the number when there's no word. */
export function seriesPlace(index: number, style: SeriesStyle): string {
  return [style.word.trim(), seriesNumber(index, style.numbers)].filter(Boolean).join(" ");
}

/** The title page's line: "The Ash Saga, book 2" ("The Ash Saga" when it has no number). */
export function titlePageSeries(series: string, index: number | null, style: SeriesStyle): string {
  if (index == null) return series;
  const word = style.word.trim();
  // A common word reads lower case after the comma; the writer's own word is kept as typed.
  const shown = (SERIES_WORDS as readonly string[]).includes(word) ? word.toLowerCase() : word;
  return `${series}, ${[shown, seriesNumber(index, style.numbers)].filter(Boolean).join(" ")}`;
}

/** The cover's line: "Book Two of The Ash Saga" ("The Ash Saga" when it has no number). */
export function coverSeries(series: string, index: number | null, style: SeriesStyle): string {
  if (index == null) return series;
  return style.word.trim() ? `${seriesPlace(index, style)} of ${series}` : `${series} ${seriesNumber(index, style.numbers)}`;
}

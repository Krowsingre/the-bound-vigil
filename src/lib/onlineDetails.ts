// Looks a book up online for the Book details page: Google Books and Open
// Library from here, and in the desktop app Audible's catalogue (audiobooks,
// narrators, series) and Hardcover (when it's connected), which TBV's core
// reaches. Nothing here changes a book: the person picks what to keep, and
// it's saved as fetched details.

export type Source = "google" | "openlibrary" | "audible" | "hardcover";

export const SOURCE_NAME: Record<Source, string> = {
  google: "Google Books",
  openlibrary: "Open Library",
  audible: "Audible",
  hardcover: "Hardcover",
};

export interface Found {
  /** Unique within one search. */
  id: string;
  source: Source;
  title: string;
  authors: string[];
  /** For audiobooks (Audible). */
  narrators?: string[];
  series: string | null;
  seriesIndex: string | null;
  synopsis: string | null;
  genres: string[];
  publisher: string | null;
  published: string | null;
  language: string | null;
  isbn: string | null;
  coverUrl: string | null;
  /** Open Library keeps descriptions on the work's own page, fetched when chosen. */
  workKey?: string;
}

export interface Lookup {
  title: string;
  author: string;
  isbn: string;
}

const TIMEOUT_MS = 12_000;
const LIMIT = 8;

const LANGUAGES: Record<string, string> = {
  eng: "en", fre: "fr", fra: "fr", ger: "de", deu: "de", spa: "es", ita: "it", por: "pt", dut: "nl", nld: "nl",
  swe: "sv", dan: "da", nor: "no", fin: "fi", pol: "pl", rus: "ru", jpn: "ja", chi: "zh", zho: "zh", kor: "ko",
  ara: "ar", heb: "he", gre: "el", ell: "el", tur: "tr", cze: "cs", ces: "cs", hun: "hu", lat: "la", wel: "cy", gle: "ga",
};

/** A series as catalogues write it, "Discworld ; 3" or "Discworld #3", as name and number. */
export function splitSeries(text: string | null | undefined): { series: string | null; index: string | null } {
  const t = text?.trim();
  if (!t) return { series: null, index: null };
  const m = /^(.*?)[\s,;:(#]*(?:book|vol\.?|volume|no\.?|#)?\s*(\d+(?:\.\d+)?)\)?$/i.exec(t);
  if (m && m[1].trim()) return { series: m[1].trim().replace(/[\s,;:(#-]+$/, ""), index: m[2] };
  return { series: t, index: null };
}

/** Text without HTML tags, with paragraphs kept as blank lines. */
export function plainText(html: string): string {
  return html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*p\s*>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Subjects worth showing as genres: short, and not library shelving codes. */
export function genresFrom(subjects: string[]): string[] {
  const kept: string[] = [];
  for (const raw of subjects) {
    for (const part of raw.split(/\s*\/\s*|\s+--\s+/)) {
      const s = part.trim().replace(/\.$/, "");
      if (!s || s.length > 32 || /[:(\[\d]/.test(s) || /^(general|fiction in english|accessible book|protected daisy|in library|large type books)$/i.test(s)) continue;
      if (!kept.some((k) => k.toLowerCase() === s.toLowerCase())) kept.push(s);
      if (kept.length >= 6) return kept;
    }
  }
  return kept;
}

async function getJson(url: string, signal: AbortSignal): Promise<unknown> {
  const timer = AbortSignal.timeout(TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.any ? AbortSignal.any([signal, timer]) : signal });
  } catch (e) {
    if (signal.aborted) throw e;
    throw new Error(timer.aborted ? "took too long to answer" : "couldn't be reached. Check your internet connection");
  }
  if (!response.ok) throw new Error(response.status === 429 ? "is busy right now (too many searches). Try again in a while." : `answered ${response.status}`);
  return response.json();
}

const https = (url: string | undefined | null) => (url ? url.replace(/^http:\/\//, "https://") : null);

interface GoogleVolume {
  id: string;
  volumeInfo?: {
    title?: string;
    subtitle?: string;
    authors?: string[];
    publisher?: string;
    publishedDate?: string;
    description?: string;
    industryIdentifiers?: { type: string; identifier: string }[];
    categories?: string[];
    language?: string;
    imageLinks?: { thumbnail?: string; smallThumbnail?: string };
    seriesInfo?: { bookDisplayNumber?: string };
  };
}

export async function searchGoogle(q: Lookup, signal: AbortSignal): Promise<Found[]> {
  const isbn = q.isbn.replace(/[^0-9xX]/g, "");
  const terms = isbn
    ? `isbn:${isbn}`
    : [q.title.trim() && `intitle:${q.title.trim()}`, q.author.trim() && `inauthor:${q.author.trim()}`].filter(Boolean).join("+");
  if (!terms) return [];
  const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(terms).replace(/%2B/g, "+")}&maxResults=${LIMIT}&printType=books`;
  const data = (await getJson(url, signal)) as { items?: GoogleVolume[] };
  return (data.items ?? []).map((v): Found => {
    const info = v.volumeInfo ?? {};
    const ids = info.industryIdentifiers ?? [];
    return {
      id: `google:${v.id}`,
      source: "google",
      title: info.title ?? "",
      authors: info.authors ?? [],
      series: null,
      seriesIndex: info.seriesInfo?.bookDisplayNumber ?? null,
      synopsis: info.description ? plainText(info.description) : null,
      genres: genresFrom(info.categories ?? []),
      publisher: info.publisher ?? null,
      published: info.publishedDate ?? null,
      language: info.language ?? null,
      isbn: (ids.find((i) => i.type === "ISBN_13") ?? ids.find((i) => i.type === "ISBN_10"))?.identifier ?? null,
      coverUrl: https(info.imageLinks?.thumbnail ?? info.imageLinks?.smallThumbnail),
    };
  });
}

interface OpenLibraryDoc {
  key: string;
  title?: string;
  subtitle?: string;
  author_name?: string[];
  first_publish_year?: number;
  publisher?: string[];
  isbn?: string[];
  subject?: string[];
  language?: string[];
  cover_i?: number;
  series?: string[];
}

export async function searchOpenLibrary(q: Lookup, signal: AbortSignal): Promise<Found[]> {
  const isbn = q.isbn.replace(/[^0-9xX]/g, "");
  const params = new URLSearchParams({ limit: String(LIMIT), fields: "key,title,subtitle,author_name,first_publish_year,publisher,isbn,subject,language,cover_i,series" });
  if (isbn) params.set("isbn", isbn);
  else {
    if (q.title.trim()) params.set("title", q.title.trim());
    if (q.author.trim()) params.set("author", q.author.trim());
  }
  if (!isbn && !q.title.trim()) return [];
  const data = (await getJson(`https://openlibrary.org/search.json?${params}`, signal)) as { docs?: OpenLibraryDoc[] };
  return (data.docs ?? []).map((d): Found => {
    const isbn13 = d.isbn?.find((i) => i.length === 13) ?? d.isbn?.[0] ?? null;
    const lang = d.language?.[0];
    const series = splitSeries(d.series?.[0]);
    return {
      id: `openlibrary:${d.key}`,
      source: "openlibrary",
      title: d.title ?? "",
      authors: d.author_name ?? [],
      series: series.series,
      seriesIndex: series.index,
      synopsis: null,
      genres: genresFrom(d.subject ?? []),
      publisher: d.publisher?.[0] ?? null,
      published: d.first_publish_year ? String(d.first_publish_year) : null,
      language: lang ? (LANGUAGES[lang] ?? lang) : null,
      isbn: isbn13,
      coverUrl: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : null,
      workKey: d.key,
    };
  });
}

/** An Open Library work's description, if it has one. */
export async function openLibraryDescription(workKey: string, signal: AbortSignal): Promise<string | null> {
  const data = (await getJson(`https://openlibrary.org${workKey}.json`, signal)) as { description?: string | { value?: string } };
  const d = typeof data.description === "string" ? data.description : data.description?.value;
  return d ? plainText(d) : null;
}

/** Searches the core reaches (Audible, Hardcover), in the desktop app. */
export type MoreSources = (source: "audible" | "hardcover", q: Lookup) => Promise<Found[]>;

/** Every source at once. Fails only when all do, saying why. */
export async function searchOnline(q: Lookup, signal: AbortSignal, more?: MoreSources): Promise<Found[]> {
  const tried: [string, Promise<Found[]>][] = [
    ["Google Books", searchGoogle(q, signal)],
    ["Open Library", searchOpenLibrary(q, signal)],
  ];
  // The ISBN alone means nothing to Audible's search; the title does.
  if (more && (q.title.trim() || q.author.trim())) {
    tried.push(["Audible", more("audible", q)], ["Hardcover", more("hardcover", q)]);
  }
  const settled = await Promise.allSettled(tried.map(([, p]) => p));
  const found = settled.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  if (!found.length) {
    const reasons = settled.flatMap((r, i) =>
      r.status === "rejected" ? [`${tried[i][0]} ${(r.reason instanceof Error ? r.reason.message : String(r.reason)).replace(/\.$/, "")}`] : [],
    );
    if (reasons.length === tried.length) throw new Error(signal.aborted ? "Stopped." : `Couldn't search online. ${reasons.join(". ")}.`);
  }
  // Results with the most to offer first; a series counts for a lot, as few sources have one.
  const score = (f: Found) =>
    [f.synopsis, f.publisher, f.published, f.isbn, f.coverUrl].filter(Boolean).length + f.genres.length / 3 + (f.series ? 2 : 0);
  return found.sort((a, b) => score(b) - score(a));
}

/** A found book's details as saved (lists as JSON arrays), for the fields it has. */
export function foundValues(f: Found): Record<string, string> {
  const out: Record<string, string> = {};
  const put = (field: string, value: string | null) => {
    if (value && value.trim()) out[field] = value.trim();
  };
  put("title", f.title);
  if (f.authors.length) out.authors = JSON.stringify(f.authors);
  if (f.narrators?.length) out.narrators = JSON.stringify(f.narrators);
  put("series", f.series);
  put("series_index", f.seriesIndex && /^\d+(\.\d+)?$/.test(f.seriesIndex) ? f.seriesIndex : null);
  put("synopsis", f.synopsis);
  if (f.genres.length) out.genres = JSON.stringify(f.genres);
  put("publisher", f.publisher);
  put("published", f.published);
  put("language", f.language);
  put("isbn", f.isbn);
  return out;
}

// Looks a book up online, in Google Books and Open Library, for the Book
// details page. Both are free and need no account. Nothing here changes a
// book: the person picks what to keep, and it's saved as fetched details.

export type Source = "google" | "openlibrary";

export interface Found {
  /** Unique within one search. */
  id: string;
  source: Source;
  title: string;
  authors: string[];
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
  const response = await fetch(url, { signal: AbortSignal.any ? AbortSignal.any([signal, timer]) : signal });
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
    return {
      id: `openlibrary:${d.key}`,
      source: "openlibrary",
      title: d.title ?? "",
      authors: d.author_name ?? [],
      series: d.series?.[0] ?? null,
      seriesIndex: null,
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

/** Both sources at once. Fails only when both do, saying why. */
export async function searchOnline(q: Lookup, signal: AbortSignal): Promise<Found[]> {
  const [google, openLibrary] = await Promise.allSettled([searchGoogle(q, signal), searchOpenLibrary(q, signal)]);
  const found = [google, openLibrary].flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  if (!found.length) {
    const why = (r: PromiseSettledResult<Found[]>, name: string) => (r.status === "rejected" ? `${name} ${r.reason instanceof Error ? r.reason.message : String(r.reason)}` : null);
    const reasons = [why(google, "Google Books"), why(openLibrary, "Open Library")].filter(Boolean);
    if (reasons.length === 2) throw new Error(signal.aborted ? "Stopped." : `Couldn't search online. ${reasons.join(". ")}.`);
  }
  // Results with the most to offer first, alternating sources.
  const score = (f: Found) => [f.synopsis, f.publisher, f.published, f.isbn, f.coverUrl].filter(Boolean).length + f.genres.length / 3;
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

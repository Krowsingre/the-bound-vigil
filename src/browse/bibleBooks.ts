// The Bible tab: three royalty-free English translations, each brought in
// as a normal book, and the books and chapters of the Bible for its picker.
// Opening a chapter finds it in the book's contents, its file names or, as
// a last resort, the marks inside the book's own pages.

export interface Translation {
  id: "kjv" | "web" | "asv";
  name: string;
  short: string;
  year: string;
  about: string;
  /** The EPUB from eBible.org (all three are public domain). */
  url: string;
  /** Words a title of this translation has, to tell it's in the library already. */
  titled: string[];
}

export const TRANSLATIONS: Translation[] = [
  {
    id: "kjv",
    name: "King James Version",
    short: "KJV",
    year: "1611 (1769 text)",
    about: "The Authorized Version: the English Bible of four centuries.",
    url: "https://ebible.org/epub/eng-kjv2006.epub",
    titled: ["king james", "authorized version", "authorised version"],
  },
  {
    id: "web",
    name: "World English Bible",
    short: "WEB",
    year: "2000, kept up to date",
    about: "A modern English update of the ASV, given to the public domain on purpose.",
    url: "https://ebible.org/epub/engwebp.epub",
    titled: ["world english bible"],
  },
  {
    id: "asv",
    name: "American Standard Version",
    short: "ASV",
    year: "1901",
    about: "A careful, word-for-word American revision of the King James.",
    url: "https://ebible.org/epub/eng-asv.epub",
    titled: ["american standard version"],
  },
];

export interface BibleBook {
  /** The usual three-letter code (USFM), as many Bible files name their parts. */
  code: string;
  name: string;
  chapters: number;
  /** Other names the book goes by in a contents list. */
  also?: string[];
}

const book = (code: string, name: string, chapters: number, also?: string[]): BibleBook => ({ code, name, chapters, also });

export const OLD_TESTAMENT: BibleBook[] = [
  book("GEN", "Genesis", 50),
  book("EXO", "Exodus", 40),
  book("LEV", "Leviticus", 27),
  book("NUM", "Numbers", 36),
  book("DEU", "Deuteronomy", 34),
  book("JOS", "Joshua", 24),
  book("JDG", "Judges", 21),
  book("RUT", "Ruth", 4),
  book("1SA", "1 Samuel", 31),
  book("2SA", "2 Samuel", 24),
  book("1KI", "1 Kings", 22),
  book("2KI", "2 Kings", 25),
  book("1CH", "1 Chronicles", 29),
  book("2CH", "2 Chronicles", 36),
  book("EZR", "Ezra", 10),
  book("NEH", "Nehemiah", 13),
  book("EST", "Esther", 10),
  book("JOB", "Job", 42),
  book("PSA", "Psalms", 150, ["psalm"]),
  book("PRO", "Proverbs", 31),
  book("ECC", "Ecclesiastes", 12, ["preacher"]),
  book("SNG", "Song of Solomon", 8, ["song of songs", "canticles"]),
  book("ISA", "Isaiah", 66),
  book("JER", "Jeremiah", 52),
  book("LAM", "Lamentations", 5),
  book("EZK", "Ezekiel", 48),
  book("DAN", "Daniel", 12),
  book("HOS", "Hosea", 14),
  book("JOL", "Joel", 3),
  book("AMO", "Amos", 9),
  book("OBA", "Obadiah", 1),
  book("JON", "Jonah", 4),
  book("MIC", "Micah", 7),
  book("NAM", "Nahum", 3),
  book("HAB", "Habakkuk", 3),
  book("ZEP", "Zephaniah", 3),
  book("HAG", "Haggai", 2),
  book("ZEC", "Zechariah", 14),
  book("MAL", "Malachi", 4),
];

export const NEW_TESTAMENT: BibleBook[] = [
  book("MAT", "Matthew", 28),
  book("MRK", "Mark", 16),
  book("LUK", "Luke", 24),
  book("JHN", "John", 21),
  book("ACT", "Acts", 28),
  book("ROM", "Romans", 16),
  book("1CO", "1 Corinthians", 16),
  book("2CO", "2 Corinthians", 13),
  book("GAL", "Galatians", 6),
  book("EPH", "Ephesians", 6),
  book("PHP", "Philippians", 4),
  book("COL", "Colossians", 4),
  book("1TH", "1 Thessalonians", 5),
  book("2TH", "2 Thessalonians", 3),
  book("1TI", "1 Timothy", 6),
  book("2TI", "2 Timothy", 4),
  book("TIT", "Titus", 3),
  book("PHM", "Philemon", 1),
  book("HEB", "Hebrews", 13),
  book("JAS", "James", 5),
  book("1PE", "1 Peter", 5),
  book("2PE", "2 Peter", 3),
  book("1JN", "1 John", 5),
  book("2JN", "2 John", 1),
  book("3JN", "3 John", 1),
  book("JUD", "Jude", 1),
  book("REV", "Revelation", 22, ["apocalypse"]),
];

export const BIBLE_BOOKS = [...OLD_TESTAMENT, ...NEW_TESTAMENT];

/** Where the reader opens: a chapter of a book of the Bible. */
export const bibleTarget = (code: string, chapter: number) => `bible:${code}:${chapter}`;

export function parseBibleTarget(target: string | undefined): { book: BibleBook; chapter: number } | null {
  const m = target?.match(/^bible:([0-9A-Z]{3}):(\d+)$/);
  const found = m && BIBLE_BOOKS.find((b) => b.code === m[1]);
  return found ? { book: found, chapter: Number(m[2]) } : null;
}

const ORDINALS: Record<string, string> = { first: "1", second: "2", third: "3", i: "1", ii: "2", iii: "3" };

/** A label as it compares: lower case, plain words, numbers as digits. */
export function plain(label: string): string[] {
  return label
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((w) => ORDINALS[w] ?? w);
}

/** Whether there's also a 1 John for this John. */
const hasNumbered = (b: BibleBook) => BIBLE_BOOKS.some((o) => /^\d /.test(o.name) && o.name.slice(2) === b.name);

/** Where in a label a book's name starts (as words), or -1. A numbered book also needs its number before the name. */
function nameAt(words: string[], b: BibleBook): number {
  const [number, ...rest] = plain(b.name);
  const numbered = /^\d$/.test(number);
  const names = [numbered ? rest : [number, ...rest], ...(b.also ?? []).map(plain)];
  let best = -1;
  for (const name of names) {
    for (let i = 0; i + name.length <= words.length; i++) {
      if (!name.every((w, j) => words[i + j] === w)) continue;
      const before = words.slice(0, i);
      // "John" isn't "1 John", and "1 John" needs its 1.
      if (numbered ? !before.includes(number) : hasNumbered(b) && before.some((w) => /^\d$/.test(w))) continue;
      if (best < 0 || i < best) best = i;
      break;
    }
  }
  return best;
}

export interface TocEntry {
  label: string;
  href: string;
  subitems?: TocEntry[] | null;
}

/**
 * Which contents entry is each book of the Bible. Each entry goes to the
 * book whose name comes earliest in it, so "The Lamentations of Jeremiah"
 * is Lamentations, not Jeremiah.
 */
export function booksInContents(toc: TocEntry[]): Map<string, TocEntry> {
  const found = new Map<string, { entry: TocEntry; at: number }>();
  const visit = (entries: TocEntry[], depth: number) => {
    for (const entry of entries) {
      const words = plain(entry.label);
      let pick: { code: string; at: number } | null = null;
      for (const b of BIBLE_BOOKS) {
        const at = nameAt(words, b);
        // A whole label that is the name beats any other match.
        const whole = [b.name, ...(b.also ?? [])].some((n) => plain(n).join(" ") === words.join(" "));
        const score = whole ? -0.5 : at;
        if (at >= 0 && (!pick || score < pick.at)) pick = { code: b.code, at: score };
      }
      const earlier = pick && found.get(pick.code);
      // A book's own entry is the first, highest one with its name.
      if (pick && (!earlier || (depth === 0 && earlier.at > pick.at))) found.set(pick.code, { entry, at: pick.at });
      if (entry.subitems?.length && depth < 2) visit(entry.subitems, depth + 1);
    }
  };
  visit(toc, 0);
  return new Map([...found].map(([code, { entry }]) => [code, entry]));
}

/** The entry for a chapter under a book's entry: "Genesis 3", "Chapter 3", or "3". */
export function chapterEntry(bookEntry: TocEntry, chapter: number): TocEntry | null {
  return (
    bookEntry.subitems?.find((e) => {
      const words = plain(e.label);
      return words.length > 0 && words[words.length - 1] === String(chapter) && words.length <= 4;
    }) ?? null
  );
}

/** A part of the book named for the chapter, like GEN03.xhtml or gen_3.html. */
export function chapterFile(ids: string[], code: string, chapter: number): string | null {
  const name = new RegExp(`(^|[^a-z0-9])${code.toLowerCase()}[ _.-]?0*${chapter}(?![0-9])`);
  return ids.find((id) => name.test(id.toLowerCase().split("/").pop() ?? "")) ?? null;
}

/** Parts of the book named for the book (GEN.xhtml), first one first. */
export function bookFiles(ids: string[], code: string): number[] {
  const name = new RegExp(`(^|[^a-z0-9])${code.toLowerCase()}([^a-z]|$)`);
  return ids.flatMap((id, i) => (name.test(id.toLowerCase().split("/").pop() ?? "") ? [i] : []));
}

/** The mark in a page where a chapter starts: an id like C3, GEN3, GEN.3.1 or chapter3, or a chapter number on its own. */
export function chapterMark(doc: Document, code: string, chapter: number): Element | null {
  const c = code.toLowerCase();
  const patterns = [
    new RegExp(`^(c|ch|chap|chapter|${c})[ _.-]?0*${chapter}$`, "i"),
    new RegExp(`^${c}[ _.-]?0*${chapter}[ _.:-]0*1$`, "i"),
    new RegExp(`^(v|verse)[ _.-]?0*${chapter}[ _.:-]0*1$`, "i"),
  ];
  for (const pattern of patterns) {
    for (const el of Array.from(doc.querySelectorAll("[id]"))) if (pattern.test(el.id)) return el;
  }
  for (const el of Array.from(doc.querySelectorAll("[class*=chapter], [class*=Chapter], h2, h3"))) {
    const text = el.textContent?.trim() ?? "";
    const words = plain(text);
    if (text === String(chapter) || (words.length <= 3 && words[words.length - 1] === String(chapter))) return el;
  }
  return null;
}

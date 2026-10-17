// Reading along with an audiobook: which part of the ebook the narrator is
// reading. Chapters are matched by their names where both have them; within a
// chapter, the place is estimated from how far through it the narrator is, so
// it can be a sentence or two out.

export interface TocEntry {
  label: string;
  /** The section the entry opens. */
  index: number;
}

const NUMBERS: Record<string, string> = {
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
  ten: "10",
  eleven: "11",
  twelve: "12",
  thirteen: "13",
  fourteen: "14",
  fifteen: "15",
  sixteen: "16",
  seventeen: "17",
  eighteen: "18",
  nineteen: "19",
  twenty: "20",
  i: "1",
  ii: "2",
  iii: "3",
  iv: "4",
  v: "5",
  vi: "6",
  vii: "7",
  viii: "8",
  ix: "9",
  x: "10",
  xi: "11",
  xii: "12",
  xiii: "13",
  xiv: "14",
  xv: "15",
  xvi: "16",
  xvii: "17",
  xviii: "18",
  xix: "19",
  xx: "20",
};

/** A chapter name reduced to what matters: "Chapter Three: The Problem" → "3 problem". */
export function chapterKey(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w && !["chapter", "part", "book", "the", "a", "an", "of"].includes(w))
    .map((w) => NUMBERS[w] ?? w)
    .join(" ");
}

/**
 * The ebook section for each audiobook chapter, or null where none matched.
 * Matches go forward through the book, so a repeated name can't send you back.
 */
export function matchChapters(audio: string[], toc: TocEntry[]): (number | null)[] {
  const keys = toc.map((t) => ({ key: chapterKey(t.label), index: t.index }));
  let from = 0;
  return audio.map((title) => {
    const key = chapterKey(title);
    if (!key) return null;
    for (let i = from; i < keys.length; i++) {
      if (keys[i].key === key) {
        from = i + 1;
        return keys[i].index;
      }
    }
    return null;
  });
}

/** Whether enough chapters matched to follow them; otherwise the whole book is followed as one. */
export function chaptersUsable(matched: (number | null)[]): boolean {
  const found = matched.filter((m) => m !== null).length;
  return found > 0 && found >= matched.length / 2;
}

/** The sentence around `offset` in `text`, as [start, end). */
export function sentenceAt(text: string, offset: number): [number, number] {
  const at = Math.min(Math.max(0, offset), Math.max(0, text.length - 1));
  // A new sentence starts with something other than a small letter: "“Who?” she asked" is one.
  const ends = /[.!?…]+["”’)\]]*\s+(?=[^a-z])/g;
  let start = 0;
  let end = text.length;
  for (let m = ends.exec(text); m; m = ends.exec(text)) {
    const after = m.index + m[0].length;
    if (after <= at) start = after;
    else {
      end = m.index + m[0].trimEnd().length;
      break;
    }
  }
  return [start, end];
}

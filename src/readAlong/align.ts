// Lining up one piece of the audiobook with the ebook, word by word.
//
// Speech recognition hears a piece (half a minute or so) as words with
// times. The piece is first found roughly in the book (BookIndex), then its
// words are matched one to one against the book's words there, allowing for
// words misheard, missed or added, the way a spelling checker lines up two
// spellings. Every word heard that matches the book becomes an anchor: when
// the narrator said it, and which word of the book it is.

import { BookIndex, rising, type Heard, type Word } from "./timing";

const MATCH = 3;
const MISS = -1;
const GAP = -1;

/**
 * Lines up `heard` with the book's words between `from` and `to` (the book's
 * words before and after the match are free, since the piece is somewhere in
 * the middle). Returns [heard word, book word] for each word that matches.
 */
export function matchWords(heard: Word[], words: Word[], from: number, to: number): [number, number][] {
  const book = words.slice(Math.max(0, from), Math.min(words.length, to));
  const start = Math.max(0, from);
  const n = heard.length;
  const m = book.length;
  if (!n || !m) return [];
  const width = m + 1;
  const score = new Int32Array((n + 1) * width);
  // 0 diagonal, 1 skip a heard word, 2 skip a book word.
  const step = new Uint8Array((n + 1) * width);
  for (let i = 1; i <= n; i++) {
    score[i * width] = i * GAP;
    step[i * width] = 1;
  }
  // Book words before the piece cost nothing (row 0 stays 0).
  for (let j = 1; j <= m; j++) step[j] = 2;
  for (let i = 1; i <= n; i++) {
    const row = i * width;
    const up = (i - 1) * width;
    for (let j = 1; j <= m; j++) {
      const diagonal = score[up + j - 1] + (heard[i - 1] === book[j - 1] ? MATCH : MISS);
      const skipHeard = score[up + j] + GAP;
      const skipBook = score[row + j - 1] + GAP;
      if (diagonal >= skipHeard && diagonal >= skipBook) {
        score[row + j] = diagonal;
        step[row + j] = 0;
      } else if (skipHeard >= skipBook) {
        score[row + j] = skipHeard;
        step[row + j] = 1;
      } else {
        score[row + j] = skipBook;
        step[row + j] = 2;
      }
    }
  }
  // Book words after the piece cost nothing either: end wherever scores best.
  let j = 0;
  for (let k = 1; k <= m; k++) if (score[n * width + k] > score[n * width + j]) j = k;
  const pairs: [number, number][] = [];
  let i = n;
  while (i > 0 && j > 0) {
    const s = step[i * width + j];
    if (s === 0) {
      if (heard[i - 1] === book[j - 1]) pairs.push([i - 1, start + j - 1]);
      i--;
      j--;
    } else if (s === 1) i--;
    else j--;
  }
  pairs.reverse();
  // A lone match among misses is likely chance ("the" against "the"): kept
  // only beside another match.
  return pairs.filter(([h, w], k) => {
    const near = (other: [number, number] | undefined) => !!other && Math.abs(other[0] - h) <= 2 && Math.abs(other[1] - w) <= 3;
    return near(pairs[k - 1]) || near(pairs[k + 1]);
  });
}

/**
 * Anchors for one piece: [ms into the audiobook, word of the book] for each
 * word heard that's found in the book. `after` is the last book word placed
 * before this piece (or null when none is known yet) and `expected` where the
 * narrator should be by now, judged by the pace so far.
 */
export function alignPiece(heard: Heard, index: BookIndex, after: number | null, expected: number): [number, number][] {
  if (heard.words.length < 3) return [];
  const words = index.words;
  const rough = index.find(heard, after === null ? 0 : after - 200, expected);
  let from: number;
  if (rough.length) from = rough[0][1] - 40;
  else if (after !== null) from = after - 20;
  // Not found anywhere (the publisher's credits, say): nothing to line up.
  else return [];
  const to = from + Math.ceil(heard.words.length * 1.6) + 120;
  const pairs = matchWords(heard.words, words, from, to);
  // Too few matches for what was heard: not this part of the book after all.
  if (pairs.length < Math.max(3, heard.words.length * 0.25)) return [];
  return rising(pairs.map(([h, w]) => [heard.times[h], w]));
}

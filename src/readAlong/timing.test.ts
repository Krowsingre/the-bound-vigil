import { describe, expect, it } from "vitest";
import { BookIndex, heardFrom, placeOf, readTiming, rising, wordAt, wordKey, wordsIn, type Timing } from "./timing";

const BOOK = `It was a dark and stormy night. The rain fell in torrents, except at occasional intervals,
when it was checked by a violent gust of wind which swept up the streets. Don't stop now, said Paul Clifford,
for the lamps struggled against the darkness and the night went on.`;

describe("read-along timing", () => {
  it("reads words the same way however they're written", () => {
    expect(wordKey("Don’t")).toBe("dont");
    expect(wordKey("Café")).toBe("cafe");
    expect(wordsIn("It was, a dark—night!").map((w) => w.word)).toEqual(["it", "was", "a", "dark", "night"]);
    expect(wordsIn("one two").map((w) => w.at)).toEqual([0, 4]);
  });

  it("spreads a piece's words over its time", () => {
    const heard = heardFrom([{ text: " The rain fell", timestamp: [1, 2] }], 60_000, 20_000);
    expect(heard.words).toEqual(["the", "rain", "fell"]);
    expect(heard.times[0]).toBeGreaterThanOrEqual(61_000);
    expect(heard.times[2]).toBeLessThan(62_000);
  });

  it("finds a stretch in the book even when a word is misheard", () => {
    const words = wordsIn(BOOK).map((w) => w.word);
    const index = new BookIndex(words);
    const said = "when it was checked by a violet gust of wind which swept up the streets".split(" ");
    const anchors = index.find({ words: said, times: said.map((_, i) => 1000 * i) }, -1, 0);
    expect(anchors.length).toBeGreaterThan(5);
    const at = words.indexOf("checked");
    expect(anchors).toContainEqual([3000, at]);
    // Every anchor agrees on the place.
    for (const [ms, w] of anchors) expect(w - ms / 1000).toBe(words.indexOf("when"));
  });

  it("finds nothing for speech that isn't in the book", () => {
    const index = new BookIndex(wordsIn(BOOK).map((w) => w.word));
    const said = "this audiobook was recorded by our studio in london".split(" ");
    expect(index.find({ words: said, times: said.map((_, i) => i) }, -1, 0)).toEqual([]);
  });

  it("drops anchors that go backwards", () => {
    expect(rising([[0, 0], [10, 5], [20, 6], [25, 1], [30, 9]])).toEqual([[0, 0], [10, 5], [20, 6], [30, 9]]);
    expect(rising([])).toEqual([]);
  });

  it("tells the word at any moment, between anchors and beyond", () => {
    const timing: Timing = { version: 1, sections: [100, 100], anchors: [[10_000, 20], [20_000, 40], [30_000, 70]], heard: 30_000, done: false };
    expect(wordAt(timing, 15_000, 60_000)).toBe(30);
    expect(wordAt(timing, 5_000, 60_000)).toBe(10);
    expect(wordAt(timing, 40_000, 60_000)).toBe(100);
    // Past what's been heard and more than a gap on: not known yet.
    expect(wordAt(timing, 120_000, 60_000)).toBeNull();
    expect(placeOf(timing, 130)).toEqual({ section: 1, word: 30 });
    expect(placeOf(timing, 250)).toBeNull();
  });

  it("only reads timing it understands", () => {
    expect(readTiming('{"version":1,"sections":[1],"anchors":[],"heard":0,"done":false}')?.sections).toEqual([1]);
    expect(readTiming('{"version":2}')).toBeNull();
    expect(readTiming("nope")).toBeNull();
    expect(readTiming(null)).toBeNull();
  });
});

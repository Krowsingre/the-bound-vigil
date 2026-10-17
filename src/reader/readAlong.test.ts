import { describe, expect, it } from "vitest";
import { chapterKey, chaptersUsable, matchChapters, sentenceAt } from "./readAlong";

describe("reading along", () => {
  it("reduces chapter names to what they share", () => {
    expect(chapterKey("Chapter Three: The Problem")).toBe("3 problem");
    expect(chapterKey("CHAPTER III. The Problem")).toBe("3 problem");
    expect(chapterKey("03 - Chapter 3")).toBe("03 3");
  });

  it("matches audiobook chapters to the ebook's, going forward", () => {
    const toc = [
      { label: "Contents", index: 0 },
      { label: "Chapter I", index: 1 },
      { label: "Chapter II", index: 2 },
      { label: "Chapter III", index: 4 },
    ];
    expect(matchChapters(["Opening Credits", "Chapter 1", "Chapter 2", "Chapter 3"], toc)).toEqual([null, 1, 2, 4]);
    expect(chaptersUsable([null, 1, 2, 4])).toBe(true);
    expect(chaptersUsable([null, null, 3])).toBe(false);
  });

  it("finds the sentence around a place in the text", () => {
    const text = "It was dark. The wind rose! “Who's there?” she asked. Silence.";
    const at = (o: number) => text.slice(...sentenceAt(text, o));
    expect(at(2)).toBe("It was dark.");
    expect(at(15)).toBe("The wind rose!");
    expect(at(text.indexOf("she"))).toBe("“Who's there?” she asked.");
    expect(at(text.length - 2)).toBe("Silence.");
  });
});

import { describe, expect, it } from "vitest";
import { comicDirection } from "../vendor/foliate-js/comic-book.js";
import { parseSettings, parseWidth, WIDTH_RANGE } from "./settings";

const comic = (xml: string | null) => ({
  entries: xml === null ? [{ filename: "001.jpg" }] : [{ filename: "001.jpg" }, { filename: "ComicInfo.xml" }],
  // The test DOM has no Blob.text(); the reader only needs that one call.
  loadBlob: async () => ({ text: async () => xml ?? "" }),
});

describe("comic reading direction", () => {
  it("reads manga order from ComicInfo.xml", async () => {
    expect(await comicDirection(comic("<ComicInfo><Manga>YesAndRightToLeft</Manga></ComicInfo>"))).toBe("rtl");
    expect(await comicDirection(comic("<ComicInfo><Manga>Yes</Manga></ComicInfo>"))).toBe("ltr");
    expect(await comicDirection(comic(null))).toBe("ltr");
  });
});

describe("text width", () => {
  it("carries the old Narrow/Medium/Wide choices over and keeps numbers in range", () => {
    expect(parseWidth("narrow")).toBe(560);
    expect(parseWidth("medium")).toBe(680);
    expect(parseWidth("wide")).toBe(820);
    expect(parseWidth(99999)).toBe(WIDTH_RANGE.max);
    expect(parseWidth(1)).toBe(WIDTH_RANGE.min);
    expect(parseSettings(JSON.stringify({ width: "wide" })).width).toBe(820);
  });
});

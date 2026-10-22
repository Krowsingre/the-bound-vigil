import { describe, expect, it } from "vitest";
import type { StoredFile } from "../api/types";
import { seriesIn } from "../collections/CollectionSeries";
import { removeText } from "./ContentsSection";

const file = (path: string, elsewhere: boolean, kind: StoredFile["kind"] = "ebook"): StoredFile => ({
  path,
  kind,
  bookId: null,
  title: null,
  bytes: 2 * 1024 * 1024,
  elsewhere,
});

describe("what's in Supabase", () => {
  it("warns about files with no other copy, but not covers", () => {
    const text = removeText([file("books/a.epub", true), file("books/b.epub", false), file("covers/b.jpg", false, "cover")]);
    expect(text).toContain("3 files (6 MB) are removed from Supabase.");
    expect(text).toContain("1 of them isn't on this computer or in your other sync place");
  });

  it("says nothing of lost copies when everything is kept elsewhere", () => {
    expect(removeText([file("books/a.epub", true)])).not.toContain("only one");
  });
});

describe("series in a collection", () => {
  it("names each series once, whatever its case", () => {
    const book = (series: string | null, author: string) => ({ series, authors: [author] }) as never;
    expect(seriesIn([book("Discworld", "Pratchett"), book("discworld", "Pratchett"), book(null, "X"), book("Dark City Girls", "Dalton")])).toEqual([
      { name: "Dark City Girls", author: "Dalton" },
      { name: "Discworld", author: "Pratchett" },
    ]);
  });
});

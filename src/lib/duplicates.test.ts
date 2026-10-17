import { describe, expect, it } from "vitest";
import type { BookPreview, LibraryQuery } from "../api/types";
import { matches } from "../collections/rules";
import { authorKey, duplicateGroups, titleKey } from "./duplicates";
import { cleanTag, queryBooks, tagCounts } from "./queryBooks";

let n = 0;
const book = (title: string, author: string, extra: Partial<BookPreview> = {}): BookPreview => ({
  id: `sha256:${(n++).toString(16)}`,
  title,
  authors: [author],
  coverPath: null,
  format: "epub",
  synopsis: null,
  series: null,
  seriesIndex: null,
  addedAt: new Date(2026, 0, n).toISOString(),
  lastOpenedAt: null,
  status: "unread",
  totalProgression: null,
  resumeLocator: null,
  availability: "local",
  remotePositions: [],
  favorite: false,
  wantToRead: false,
  rating: null,
  finishedAt: null,
  tags: [],
  inCloud: false,
  genres: [],
  ...extra,
});

describe("duplicates", () => {
  it("compares titles and authors the way the core does", () => {
    expect(titleKey("The Moonstone: A Romance")).toBe("moonstone");
    expect(titleKey("Dracula (Penguin Classics)")).toBe("dracula");
    expect(authorKey(["Stoker, Bram"])).toBe(authorKey(["Bram Stoker"]));
  });

  it("groups the same book in two formats, and nothing else", () => {
    const a = book("Dracula", "Bram Stoker");
    const b = book("dracula", "Stoker, Bram", { format: "pdf" });
    const groups = duplicateGroups([a, b, book("Emma", "Jane Austen")]);
    expect(groups).toHaveLength(1);
    expect(groups[0].books.map((x) => x.id)).toEqual([a.id, b.id]);
    expect(groups[0].key).toBe([a.id, b.id].sort().join("+"));
  });
});

describe("tags", () => {
  it("counts each tag once whatever its case, and filters by any of them", () => {
    const books = [book("A", "X", { tags: ["Gothic"] }), book("B", "X", { tags: ["gothic", "Horror"] }), book("C", "X")];
    expect(tagCounts(books)).toEqual([
      { name: "Gothic", count: 2 },
      { name: "Horror", count: 1 },
    ]);
    const page = queryBooks(books, { shelf: "all", sort: "title", search: null, formats: [], location: null, tags: ["GOTHIC"], page: 0, pageSize: 24 }, 0);
    expect(page.books.map((b) => b.title)).toEqual(["A", "B"]);
    expect(page.tags).toEqual(["Gothic", "Horror"]);
  });

  it("tidies typed tags", () => {
    expect(cleanTag("  book   club ")).toBe("book club");
    expect(cleanTag("   ")).toBeNull();
    expect(cleanTag("x".repeat(60))).toHaveLength(40);
  });

  it("fills a rule collection by tag", () => {
    const tagged = book("A", "X", { tags: ["Book club"] });
    const plain = book("B", "X");
    const rules = (op: "is" | "isNot" | "contains" | "isEmpty", value = "book club") => ({ any: false, rules: [{ field: "tag" as const, op, value }] });
    expect(matches(tagged, rules("is"))).toBe(true);
    expect(matches(plain, rules("is"))).toBe(false);
    expect(matches(plain, rules("isNot"))).toBe(true);
    expect(matches(tagged, rules("contains", "club"))).toBe(true);
    expect(matches(plain, rules("isEmpty", ""))).toBe(true);
  });
});

describe("language and download filters", () => {
  it("spells each language one way, and filters by it and by what can be downloaded", async () => {
    const { languageCode, languageName } = await import("./language");
    expect([languageCode("en-US"), languageCode("eng"), languageCode("French"), languageCode("und"), languageCode(null)]).toEqual(["en", "en", "fr", null, null]);
    expect(languageName("fr")).toBe("French");
    const books = [
      book("Dracula", "Bram Stoker", { language: "en", inCloud: true }),
      book("Germinal", "Émile Zola", { language: "fr" }),
      book("Nana", "Émile Zola", { language: "fr", inCloud: true }),
    ];
    const q: LibraryQuery = { shelf: "all", sort: "title", search: null, formats: [], location: null, page: 0, pageSize: 24 };
    expect(queryBooks(books, q, 0).languages).toEqual(["en", "fr"]);
    expect(queryBooks(books, { ...q, languages: ["fr"] }, 0).total).toBe(2);
    expect(queryBooks(books, { ...q, downloadable: true }, 0).books.map((b) => b.title)).toEqual(["Dracula", "Nana"]);
  });
});

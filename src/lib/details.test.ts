import { describe, expect, it } from "vitest";
import type { DetailField } from "../api/types";
import { cleanValue, effective, previewFields } from "./details";
import { foundValues, genresFrom, plainText, type Found } from "./onlineDetails";

const field = (f: Partial<DetailField> & Pick<DetailField, "field">): DetailField => ({
  own: null,
  fetched: null,
  fetchedFrom: null,
  edited: null,
  ...f,
});

describe("book details", () => {
  it("shows your edit, else what was fetched, else the book's own", () => {
    expect(effective(field({ field: "title", own: "A", fetched: "B", edited: "C" }))).toBe("C");
    expect(effective(field({ field: "title", own: "A", fetched: "B" }))).toBe("B");
    expect(effective(field({ field: "title", own: "A" }))).toBe("A");
  });

  it("cleans values the way the core does", () => {
    expect(cleanValue("title", "  The   Moonstone ")).toBe("The Moonstone");
    expect(cleanValue("authors", '["Wilkie  Collins","wilkie collins",""]')).toBe('["Wilkie Collins"]');
    expect(cleanValue("series_index", "2,5")).toBe("2.5");
    expect(cleanValue("isbn", "978-0-14-043408-2")).toBe("9780140434082");
    expect(() => cleanValue("title", " ")).toThrow();
    expect(() => cleanValue("isbn", "123")).toThrow();
    expect(() => cleanValue("authors", "[]")).toThrow();
  });

  it("gives a preview its layered details", () => {
    const p = previewFields([
      field({ field: "title", own: "Old" , edited: "New" }),
      field({ field: "authors", own: '["A"]' }),
      field({ field: "genres", fetched: '["Mystery","Gothic"]', fetchedFrom: "google" }),
      field({ field: "series", edited: "" }),
    ]);
    expect(p).toMatchObject({ title: "New", authors: ["A"], genres: ["Mystery", "Gothic"], series: null });
  });
});

describe("details found online", () => {
  it("keeps short subjects as genres and drops shelving codes", () => {
    expect(genresFrom(["Fiction / Mystery & Detective / General", "PR4494 .M6", "Fiction", "Accessible book", "fiction"])).toEqual([
      "Fiction",
      "Mystery & Detective",
    ]);
  });

  it("turns HTML descriptions into plain paragraphs", () => {
    expect(plainText("<p>One &amp; two.</p><p>Three<br>four</p>")).toBe("One & two.\n\nThree\nfour");
  });

  it("saves only the details a result has", () => {
    const found: Found = {
      id: "google:x",
      source: "google",
      title: "The Moonstone",
      authors: ["Wilkie Collins"],
      series: null,
      seriesIndex: "first",
      synopsis: " ",
      genres: ["Mystery"],
      publisher: "Penguin",
      published: "1868",
      language: "en",
      isbn: null,
      coverUrl: null,
    };
    expect(foundValues(found)).toEqual({
      title: "The Moonstone",
      authors: '["Wilkie Collins"]',
      genres: '["Mystery"]',
      publisher: "Penguin",
      published: "1868",
      language: "en",
    });
  });
});

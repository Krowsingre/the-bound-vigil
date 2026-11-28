import { describe, expect, it } from "vitest";
import type { BookPreview, DetailField } from "../api/types";
import { bulkPlaces, placeChanges, placesFromRows, rowsOf } from "../details/SeriesEditor";
import { bestMatches, cleanValue, placeLine, placesFromFields, placesWords, placeWords } from "./details";
import { stackAuthor } from "./queryBooks";

const field = (name: string, own: string | null, edited: string | null = null): DetailField =>
  ({ field: name, own, fetched: null, fetchedFrom: null, edited }) as DetailField;

const book = (over: Partial<BookPreview>) => ({ id: "b", title: "T", authors: ["A"], series: null, seriesIndex: null, ...over }) as BookPreview;

describe("series places", () => {
  it("reads a book's series from its details, main first", () => {
    const fields = [
      field("series", "Turncoat's Truth"),
      field("series_index", "1"),
      field("series_list", null, '[{"name":"Turncoat\'s Truth","number":1},{"name":"Sovereign-Verse","after":3}]'),
    ];
    const places = placesFromFields(fields);
    expect(places.map((p) => p.name)).toEqual(["Turncoat's Truth", "Sovereign-Verse"]);
    expect(placeWords(places[1])).toBe("Side story, after book 3");
    expect(placeLine(places[1])).toBe("Sovereign-Verse, side story");
  });

  it("turns rows into places and details changes", () => {
    const rows = [...rowsOf([{ name: "Saga", number: 1, end: 3 }, { name: "Verse", after: 2 }]), { ...rowsOf([{ name: "x", number: 4 }])[0], name: "  " }];
    expect(rows.map((r) => r.number)).toEqual(["1–3", "", "4"]);
    const places = placesFromRows(rows);
    expect(places).toEqual([{ name: "Saga", number: 1, end: 3 }, { name: "Verse", after: 2 }]);
    expect(placeWords(places[0])).toBe("Books 1–3");
    const changes = placeChanges(places);
    expect(changes.find((c) => c.field === "series")?.value).toBe("Saga");
    expect(changes.find((c) => c.field === "series_index")?.value).toBe("1");
    expect(JSON.parse(cleanValue("series_list", changes.find((c) => c.field === "series_list")!.value!))).toEqual(places);
    // One plain series needs no list.
    expect(placeChanges([{ name: "Saga", number: 2 }]).find((c) => c.field === "series_list")?.value).toBeNull();
    expect(() => placesFromRows([{ ...rowsOf([{ name: "Saga", number: 3 }])[0], number: "3-2" }])).toThrow();
  });

  it("keeps a book that's in one series several times", () => {
    // Wild Wastes Omnibus: Wild Wastes 1–3, and Sovereign-Verse 10, 12 and 14.
    const omnibus = [{ name: "Wild Wastes", number: 1, end: 3 }, ...[10, 12, 14].map((number) => ({ name: "Sovereign-Verse", number }))];
    const rows = rowsOf(omnibus);
    expect(rows.map((r) => [r.name, r.number])).toEqual([["Wild Wastes", "1–3"], ["Sovereign-Verse", "10, 12, 14"]]);
    expect(placesFromRows(rows)).toEqual(omnibus);
    // Typed as separate rows, or with a range and a dash, it's the same.
    const typed = rowsOf([{ name: "Sovereign-Verse", number: 1 }])[0];
    expect(placesFromRows([{ ...typed, number: "1-3; 5" }, { ...typed, key: -1, number: "5" }])).toEqual([
      { name: "Sovereign-Verse", number: 1, end: 3 },
      { name: "Sovereign-Verse", number: 5 },
    ]);
    const saved = JSON.parse(cleanValue("series_list", JSON.stringify(omnibus))!);
    expect(saved).toEqual(omnibus);
    const fields = [field("series", "Wild Wastes"), field("series_index", "1"), field("series_list", null, JSON.stringify(omnibus))];
    expect(placesFromFields(fields)).toEqual(omnibus);
    expect(placesWords(omnibus.slice(1))).toBe("Books 10, 12, 14");
  });

  it("adds books to a series with numbers, keeping the series they're in", () => {
    const inOne = book({ series: "Old", seriesIndex: 2 });
    expect(bulkPlaces(inOne, "New", 5, true)).toEqual([{ name: "Old", number: 2 }, { name: "New", number: 5 }]);
    expect(bulkPlaces(inOne, "New", null, false)).toEqual([{ name: "New", number: null }]);
    expect(bulkPlaces(inOne, "old", 7, true)).toEqual([{ name: "Old", number: 7 }]);
  });

  it("suggests what starts with the typed letters first", () => {
    expect(bestMatches(["Dune", "The Dune Saga", "Discworld"], "du")).toEqual(["Dune", "The Dune Saga"]);
    expect(bestMatches(["Dune"], "dune")).toEqual([]);
    expect(bestMatches(["Dune", "Dust"], "d", ["dune"])).toEqual(["Dust"]);
  });

  it("names a stack's main author: most books, then the earliest", () => {
    const b = (author: string, n: number) => book({ authors: [author], seriesIndex: n });
    expect(stackAuthor([b("Ann", 2), b("Bo", 1), b("Ann", 3)])).toBe("Ann");
    expect(stackAuthor([b("Ann", 2), b("Bo", 1)])).toBe("Bo");
  });
});

describe("omnibus numbers", () => {
  it("keeps an omnibus's own number beside the books it holds", () => {
    const rows = [{ key: 1, name: "Barbarian Chef", kind: "omnibus" as const, number: "4–6", after: "", omnibus: "2" }];
    const places = placesFromRows(rows);
    expect(places).toEqual([{ name: "Barbarian Chef", number: 4, end: 6, omnibus: 2 }]);
    expect(placeWords(places[0])).toBe("Omnibus 2 · Books 4–6");
    expect(placeLine(places[0])).toBe("Barbarian Chef Omnibus 2 · #4–6");
    const changes = placeChanges(places);
    expect(changes.find((c) => c.field === "series_list")?.value).toContain('"omnibus":2');
    const back = rowsOf(places);
    expect(back[0]).toMatchObject({ kind: "omnibus", number: "4–6", omnibus: "2" });
    const fields = [
      field("series", "Barbarian Chef"),
      field("series_index", "4"),
      field("series_list", null, changes.find((c) => c.field === "series_list")!.value),
    ];
    expect(placesFromFields(fields)[0]).toEqual({ name: "Barbarian Chef", number: 4, end: 6, omnibus: 2 });
  });
});

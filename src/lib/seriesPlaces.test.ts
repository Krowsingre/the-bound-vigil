import { describe, expect, it } from "vitest";
import type { BookPreview, DetailField } from "../api/types";
import { bulkPlaces, placeChanges, placesFromRows, rowOf } from "../details/SeriesEditor";
import { bestMatches, cleanValue, placeLine, placesFromFields, placeWords } from "./details";
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
    const rows = [rowOf({ name: "Saga", number: 1, end: 3 }), rowOf({ name: "Verse", after: 2 }), rowOf({ name: "  ", number: 4 })];
    const places = placesFromRows(rows);
    expect(places).toEqual([{ name: "Saga", number: 1, end: 3 }, { name: "Verse", after: 2 }]);
    expect(placeWords(places[0])).toBe("Books 1–3");
    const changes = placeChanges(places);
    expect(changes.find((c) => c.field === "series")?.value).toBe("Saga");
    expect(changes.find((c) => c.field === "series_index")?.value).toBe("1");
    expect(JSON.parse(cleanValue("series_list", changes.find((c) => c.field === "series_list")!.value!))).toEqual(places);
    // One plain series needs no list.
    expect(placeChanges([{ name: "Saga", number: 2 }]).find((c) => c.field === "series_list")?.value).toBeNull();
    expect(() => placesFromRows([{ ...rowOf({ name: "Saga", number: 3 }), kind: "range", end: "2" }])).toThrow();
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

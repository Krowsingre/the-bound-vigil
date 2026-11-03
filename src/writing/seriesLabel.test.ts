import { describe, expect, it } from "vitest";
import { coverSeries, readSeriesStyle, seriesNumber, titlePageSeries } from "./seriesLabel";

describe("what a book's place in its series is called", () => {
  it("writes the number three ways", () => {
    expect(seriesNumber(2, "digits")).toBe("2");
    expect(seriesNumber(2, "words")).toBe("Two");
    expect(seriesNumber(24, "words")).toBe("Twenty-four");
    expect(seriesNumber(14, "roman")).toBe("XIV");
    expect(seriesNumber(2.5, "roman")).toBe("2.5");
  });

  it("names it on the title page and the cover", () => {
    expect(titlePageSeries("The Ash Saga", 2, { word: "Book", numbers: "digits" })).toBe("The Ash Saga, book 2");
    expect(titlePageSeries("The Ash Saga", 3, { word: "Volume", numbers: "roman" })).toBe("The Ash Saga, volume III");
    expect(titlePageSeries("The Ash Saga", 1, { word: "Cycle", numbers: "words" })).toBe("The Ash Saga, Cycle One");
    expect(titlePageSeries("The Ash Saga", null, { word: "Book", numbers: "digits" })).toBe("The Ash Saga");
    expect(coverSeries("The Ash Saga", 2, { word: "Book", numbers: "words" })).toBe("Book Two of The Ash Saga");
    expect(coverSeries("The Ash Saga", 2, { word: "", numbers: "digits" })).toBe("The Ash Saga 2");
  });

  it("starts as Book 2 for older books", () => {
    expect(readSeriesStyle(undefined)).toEqual({ word: "Book", numbers: "digits" });
    expect(readSeriesStyle({ word: " Volume ", numbers: "roman" })).toEqual({ word: "Volume", numbers: "roman" });
  });
});

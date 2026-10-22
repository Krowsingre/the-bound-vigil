import { describe, expect, it } from "vitest";
import type { BookPlaces } from "../api/types";
import { matches, nowhere } from "./BookPlaces";

const book = (change: Partial<BookPlaces>): BookPlaces => ({
  bookId: "sha256:1",
  title: "Dracula",
  authors: ["Bram Stoker"],
  format: "epub",
  here: true,
  main: true,
  also: false,
  ...change,
});

describe("where your books are", () => {
  it("filters by place", () => {
    expect(matches(book({}), "noAlso", "")).toBe(true);
    expect(matches(book({}), "noMain", "")).toBe(false);
    expect(matches(book({ also: null }), "noAlso", "")).toBe(false);
    expect(matches(book({ here: false }), "notHere", "")).toBe(true);
  });

  it("finds by title or author", () => {
    expect(matches(book({}), "all", "stoker")).toBe(true);
    expect(matches(book({}), "all", "drac")).toBe(true);
    expect(matches(book({}), "all", "carmilla")).toBe(false);
  });

  it("counts a book as nowhere only when no place has it", () => {
    expect(nowhere(book({ here: false, main: false, also: null }))).toBe(true);
    expect(nowhere(book({ here: false, main: true }))).toBe(false);
  });
});

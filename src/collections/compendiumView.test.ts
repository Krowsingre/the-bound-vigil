import { describe, expect, it } from "vitest";
import type { BookPreview } from "../api/types";
import { viewCompendium } from "./compendiumView";

const book = (id: string, extra: Partial<BookPreview>): BookPreview =>
  ({
    id,
    title: id,
    authors: [],
    format: "epub",
    status: "unread",
    addedAt: "2026-01-01T00:00:00Z",
    lastOpenedAt: null,
    totalProgression: null,
    rating: null,
    series: null,
    tags: [],
    ...extra,
  }) as BookPreview;

const books = [
  book("Persuasion", { authors: ["Jane Austen"], status: "in_progress", totalProgression: 0.4, addedAt: "2026-03-01T00:00:00Z", rating: 4 }),
  book("Émile", { authors: ["Jean-Jacques Rousseau"], status: "read", lastOpenedAt: "2026-05-01T00:00:00Z" }),
  book("Dracula", { authors: ["Bram Stoker"], format: "m4b", status: "in_progress", totalProgression: 0.8, lastOpenedAt: "2026-06-01T00:00:00Z" }),
];
const ids = (list: BookPreview[]) => list.map((b) => b.id);

describe("filtering and sorting a compendium", () => {
  it("keeps the compendium's own order unless asked", () => {
    expect(ids(viewCompendium(books, "", "all", "own"))).toEqual(["Persuasion", "Émile", "Dracula"]);
  });

  it("finds words in any order, without accents", () => {
    expect(ids(viewCompendium(books, "emile", "all", "own"))).toEqual(["Émile"]);
    expect(ids(viewCompendium(books, "austen jane", "all", "own"))).toEqual(["Persuasion"]);
  });

  it("shows one kind of book", () => {
    expect(ids(viewCompendium(books, "", "audiobooks", "own"))).toEqual(["Dracula"]);
    expect(ids(viewCompendium(books, "", "ebooks", "own"))).toEqual(["Persuasion", "Émile"]);
    expect(ids(viewCompendium(books, "", "in_progress", "own"))).toEqual(["Persuasion", "Dracula"]);
    expect(ids(viewCompendium(books, "", "read", "own"))).toEqual(["Émile"]);
  });

  it("sorts", () => {
    expect(ids(viewCompendium(books, "", "all", "title"))).toEqual(["Dracula", "Émile", "Persuasion"]);
    expect(ids(viewCompendium(books, "", "all", "author"))).toEqual(["Persuasion", "Émile", "Dracula"]);
    expect(ids(viewCompendium(books, "", "all", "added"))).toEqual(["Persuasion", "Dracula", "Émile"]);
    expect(ids(viewCompendium(books, "", "all", "opened"))).toEqual(["Dracula", "Émile", "Persuasion"]);
    expect(ids(viewCompendium(books, "", "all", "progress"))).toEqual(["Dracula", "Persuasion", "Émile"]);
    expect(ids(viewCompendium(books, "", "all", "rating"))).toEqual(["Persuasion", "Dracula", "Émile"]);
  });
});

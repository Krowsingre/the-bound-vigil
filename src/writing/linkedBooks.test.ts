import { describe, expect, it } from "vitest";
import type { WritingProject } from "../api/types";
import { latestOf, shelve } from "./LinkedBooks";

const book = (id: string, edition?: { group: string; number: number }, title = id) =>
  ({
    id,
    title,
    author: "A. Writer",
    export: edition ? JSON.stringify({ edition: { year: "2025", note: "", isbns: {}, earlier: [], name: "", ...edition } }) : null,
  }) as unknown as WritingProject;

describe("linked books in Scribe", () => {
  it("puts editions of one book on one card, where the first of them was", () => {
    const shelves = shelve([book("x"), book("b2", { group: "g", number: 2 }), book("y"), book("b1", { group: "g", number: 1 })]);
    expect(shelves.map((s) => (s.kind === "book" ? s.book.id : s.editions.map((e) => e.book.id).join("+")))).toEqual(["x", "b1+b2", "y"]);
    const linked = shelves[1];
    expect(linked.kind === "linked" && latestOf(linked).id).toBe("b2");
  });

  it("leaves a book alone when it's the only edition", () => {
    expect(shelve([book("a", { group: "g", number: 1 })])[0].kind).toBe("book");
  });

  it("never links the sample book", () => {
    const shelves = shelve([book("p", { group: "g", number: 1 }, "Paradise Lost"), book("q", { group: "g", number: 2 }, "Paradise Lost")].map((b) => ({ ...b, author: "John Milton" })));
    expect(shelves.every((s) => s.kind === "book")).toBe(true);
  });
});

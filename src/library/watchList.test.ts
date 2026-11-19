import { describe, expect, it } from "vitest";
import type { WatchedBook } from "../api/types";
import { authorUpdate, bookUpdate, isOut, whenLine, type WatchedAuthor, type WatchedTitle } from "./watchList";

const now = Date.UTC(2026, 10, 19);
const book = (key: string, date: string | null): WatchedBook => ({ key, title: key, authors: ["A. Writer"], date, coverUrl: null, link: null });
const author: WatchedAuthor = { kind: "author", name: "A. Writer", addedAt: "", known: [], primed: false };

describe("watching", () => {
  it("knows when a book is out, by the start of its date", () => {
    expect(isOut("2026-11-19", now)).toBe(true);
    expect(isOut("2026-11-20", now)).toBe(false);
    expect(isOut("2026-11", now)).toBe(true);
    expect(isOut("2027", now)).toBe(false);
    expect(isOut(null, now)).toBe(false);
  });

  it("first look: only books still to come are news, and they're followed", () => {
    const first = authorUpdate(author, [book("old", "2001"), book("soon", "2027-03-04")], now);
    expect(first.news.map((n) => [n.kind, n.key])).toEqual([["announced", "soon"]]);
    expect(first.follow.map((b) => b.key)).toEqual(["soon"]);
    expect(first.author).toMatchObject({ primed: true, known: ["old", "soon"] });
  });

  it("after that, a book not seen before is news, out or announced", () => {
    const primed = { ...author, primed: true, known: ["old"] };
    const next = authorUpdate(primed, [book("old", "2001"), book("surprise", "2026-11-01"), book("later", null)], now);
    expect(next.news.map((n) => [n.kind, n.key])).toEqual([["released", "surprise"], ["announced", "later"]]);
    expect(next.follow.map((b) => b.key)).toEqual(["later"]);
  });

  it("a watched book: its date announced, then out once", () => {
    const watched: WatchedTitle = { kind: "book", key: "w", title: "W", author: "A. Writer", date: null, coverUrl: null, link: null, addedAt: "", released: false };
    const dated = bookUpdate(watched, book("w", "2026-12-01"), now);
    expect(dated.news.map((n) => n.kind)).toEqual(["announced"]);
    expect(bookUpdate(dated.book, null, now).news).toEqual([]);
    const out = bookUpdate(dated.book, null, Date.UTC(2026, 11, 1));
    expect(out.news.map((n) => n.kind)).toEqual(["released"]);
    expect(bookUpdate(out.book, null, Date.UTC(2026, 11, 2)).news).toEqual([]);
  });

  it("says when", () => {
    expect(whenLine({ kind: "released", date: "2020" })).toBe("Out now");
    expect(whenLine({ kind: "announced", date: null })).toBe("Announced");
    expect(whenLine({ kind: "announced", date: "2027" })).toBe("Coming 2027");
  });
});

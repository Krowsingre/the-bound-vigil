import { describe, expect, it } from "vitest";
import { readWidgetLink } from "./widgets";

describe("widget links", () => {
  it("reads each kind", () => {
    expect(readWidgetLink("theboundvigil://book/sha256%3Aab")).toEqual({ kind: "book", id: "sha256:ab" });
    expect(readWidgetLink("theboundvigil://audio/back?book=abs~1~2")).toEqual({ kind: "audio", action: "back", bookId: "abs~1~2" });
    expect(readWidgetLink("theboundvigil://audio/toggle")).toEqual({ kind: "audio", action: "toggle", bookId: null });
    expect(readWidgetLink("theboundvigil://sigil/sl%3Adiscover")).toEqual({ kind: "sigil", id: "sl:discover" });
    expect(readWidgetLink("theboundvigil://home")).toEqual({ kind: "home" });
    expect(readWidgetLink("theboundvigil://audio/play?book=b1")).toEqual({ kind: "audio", action: "play", bookId: "b1" });
    expect(readWidgetLink("theboundvigil://page/writing")).toEqual({ kind: "page", route: "writing" });
    expect(readWidgetLink("theboundvigil://scribe/new")).toEqual({ kind: "scribe", open: "new", id: null });
    expect(readWidgetLink("theboundvigil://scribe/note/n%3A1")).toEqual({ kind: "scribe", open: "note", id: "n:1" });
    expect(readWidgetLink("theboundvigil://scribe/book/p1")).toEqual({ kind: "scribe", open: "book", id: "p1" });
  });
  it("ignores anything else", () => {
    expect(readWidgetLink("https://example.com/book/1")).toBeNull();
    expect(readWidgetLink("theboundvigil://audio/delete")).toBeNull();
    expect(readWidgetLink("not a link")).toBeNull();
    expect(readWidgetLink("theboundvigil://page/nowhere")).toBeNull();
  });
});

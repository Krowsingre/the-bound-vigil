import { describe, expect, it } from "vitest";
import { readWidgetLink } from "./widgets";

describe("widget links", () => {
  it("reads each kind", () => {
    expect(readWidgetLink("theboundvigil://book/sha256%3Aab")).toEqual({ kind: "book", id: "sha256:ab" });
    expect(readWidgetLink("theboundvigil://audio/back?book=abs~1~2")).toEqual({ kind: "audio", action: "back", bookId: "abs~1~2" });
    expect(readWidgetLink("theboundvigil://audio/toggle")).toEqual({ kind: "audio", action: "toggle", bookId: null });
    expect(readWidgetLink("theboundvigil://sigil/sl%3Adiscover")).toEqual({ kind: "sigil", id: "sl:discover" });
    expect(readWidgetLink("theboundvigil://home")).toEqual({ kind: "home" });
  });
  it("ignores anything else", () => {
    expect(readWidgetLink("https://example.com/book/1")).toBeNull();
    expect(readWidgetLink("theboundvigil://audio/delete")).toBeNull();
    expect(readWidgetLink("not a link")).toBeNull();
  });
});

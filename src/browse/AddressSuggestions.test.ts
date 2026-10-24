import { describe, expect, it } from "vitest";
import { suggestionsFor, type Suggestion } from "./AddressSuggestions";
import { bookIdOf } from "./readingList";

const from: Suggestion[] = [
  { kind: "history", url: "https://www.gutenberg.org/ebooks/1342", title: "Pride and Prejudice" },
  { kind: "bookmark", url: "https://standardebooks.org/", title: "Standard Ebooks" },
  { kind: "tab", url: "https://www.gutenberg.org/ebooks/1342", title: "Pride and Prejudice", tab: "t1" },
  { kind: "quick", url: "https://www.wikipedia.org/", title: "Wikipedia" },
];

describe("address suggestions", () => {
  it("puts the site starting with what's typed first, one line per address, an open tab winning", () => {
    const found = suggestionsFor("gut", from);
    expect(found.map((s) => s.kind)).toEqual(["tab"]);
    expect(suggestionsFor("pride", from)[0].tab).toBe("t1");
    expect(suggestionsFor("standard", from)[0].url).toBe("https://standardebooks.org/");
    expect(suggestionsFor("  ", from)).toEqual([]);
  });
});

describe("reading list", () => {
  it("names a saved page's book as the library does", async () => {
    expect(await bookIdOf(new TextEncoder().encode("abc"))).toBe("sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

import { describe, expect, it } from "vitest";
import type { WritingChapter } from "../api/types";
import { citationLabel, citedIds, emptySource, makeCiter, readSources, type Source } from "./sources";

const morrison: Source = { ...emptySource("s1"), title: "Beloved", authors: "Morrison, Toni", publisher: "Knopf", place: "New York", date: "1987" };
const article: Source = {
  ...emptySource("s2", "article-journal"),
  title: "The poetics of space",
  authors: "Lee, Ana\nOkafor, Chidi",
  container: "Journal of Verse",
  volume: "12",
  issue: "3",
  pages: "45-67",
  date: "2021-05",
};
const chapter = (body: string) => ({ id: "c1", body }) as WritingChapter;
const cites = chapter('<p>One <cite data-source="s2" data-locator="50">x</cite> and <cite data-source="s1" data-locator="">y</cite>.</p>');

describe("sources and citations", () => {
  it("finds what's cited, in order, and labels it in the editor", () => {
    expect(citedIds([cites])).toEqual(["s2", "s1"]);
    expect(citationLabel(morrison, "12")).toBe("(Morrison 1987, p. 12)");
    expect(readSources([{ id: "a", type: "nope", title: 5 }, null])).toEqual([{ ...emptySource("a"), title: "" }]);
  });

  it("writes APA in the text and in the list", async () => {
    const citer = (await makeCiter("apa", [morrison, article], [cites]))!;
    expect(citer.cite("s1", "12").text).toBe("(Morrison, 1987, p. 12)");
    expect(citer.cite("s2", "").text).toBe("(Lee &#38; Okafor, 2021)");
    const list = citer.bibliography();
    expect(list[0]).toContain("Lee, A., &#38; Okafor, C. (2021). The poetics of space. <i>Journal of Verse</i>, <i>12</i>(3), 45–67.");
    expect(list[1]).toContain("Morrison, T. (1987). <i>Beloved</i>. Knopf.");
  });

  it("numbers IEEE by first citation, and puts Chicago notes in footnotes", async () => {
    const ieee = (await makeCiter("ieee", [morrison, article], [cites]))!;
    expect(ieee.cite("s2", "").text).toBe("[1]");
    expect(ieee.cite("s1", "").text).toBe("[2]");
    const chicago = (await makeCiter("chicago-notes", [morrison, article], [cites]))!;
    // With a bibliography at the back, Chicago's notes are the short form.
    expect(chicago.cite("s2", "50").note).toBe("Lee and Okafor, “The Poetics of Space,” 50.");
    expect(chicago.cite("s1", "").note).toBe("Morrison, <i>Beloved</i>.");
    chicago.restart();
    expect(chicago.cite("s2", "50").note).toBe("Lee and Okafor, “The Poetics of Space,” 50.");
    expect(chicago.bibliography()[1]).toContain("Morrison, Toni. <i>Beloved</i>. New York: Knopf, 1987.");
  });

  it("has nothing to do when nothing is cited", async () => {
    expect(await makeCiter("mla", [morrison], [chapter("<p>none</p>")])).toBeNull();
  });
});

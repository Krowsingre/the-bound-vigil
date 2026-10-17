import { decodeText, isHeading, paragraphsOf, textToChapters } from "./plainText";

describe("plain text books", () => {
  it("knows chapter headings from sentences", () => {
    for (const h of ["Chapter 1", "CHAPTER IV. THE RIVER", "Book II", "XIV", "12.", "Prologue"]) expect(isHeading(h)).toBe(true);
    for (const s of ["Chapter and verse, he said.", "It was night.", "Part of the problem was the fog.", ""]) expect(isHeading(s)).toBe(false);
  });

  it("joins wrapped lines and keeps verse", () => {
    const text = "It was the best of times, it was the worst of times, it was the age\nof wisdom, it was the age of foolishness.\n\nRoses are red\nViolets are blue\n\n";
    expect(paragraphsOf(text)).toHaveLength(2);
    const [chapter] = textToChapters(text);
    expect(chapter.html).toContain("age of wisdom");
    expect(chapter.html).toContain('<div class="verse"><p>Roses are red</p><p>Violets are blue</p></div>');
  });

  it("splits at chapters and escapes text", () => {
    const chapters = textToChapters("Title page\n\nChapter 1\n\nA < B & C.\n\nChapter 2\n\nEnd.");
    expect(chapters.map((c) => c.title)).toEqual([null, "Chapter 1", "Chapter 2"]);
    expect(chapters[1].html).toContain("A &lt; B &amp; C.");
  });

  it("reads one paragraph per line when told to", () => {
    expect(paragraphsOf("One.\nTwo.\nThree.", true)).toEqual([["One."], ["Two."], ["Three."]]);
  });

  it("decodes older text files", () => {
    expect(decodeText(new Uint8Array([0x63, 0x61, 0x66, 0xe9]).buffer)).toBe("café");
    expect(decodeText(new TextEncoder().encode("café").buffer as ArrayBuffer)).toBe("café");
  });
});

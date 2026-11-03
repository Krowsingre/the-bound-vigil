import { describe, expect, it } from "vitest";
import { blurbHtml, blurbPlain, hasFormatting, inlineRuns, parseBlurb } from "./blurb";

describe("book description formatting", () => {
  it("splits bold and italic into runs", () => {
    expect(inlineRuns("A **bold** and *quiet* tale")).toEqual([
      { text: "A ", bold: false, italic: false },
      { text: "bold", bold: true, italic: false },
      { text: " and ", bold: false, italic: false },
      { text: "quiet", bold: false, italic: true },
      { text: " tale", bold: false, italic: false },
    ]);
  });

  it("leaves lone stars and snake_case alone", () => {
    expect(inlineRuns("5 * 3 and file_name")).toEqual([{ text: "5 * 3 and file_name", bold: false, italic: false }]);
  });

  it("reads headings, bullets, numbers and quotes", () => {
    const blocks = parseBlurb("# Praise\nA story.\n- one\n- two\n\n3. three\n4. four\n\n> Loved it");
    expect(blocks.map((b) => [b.kind, b.number])).toEqual([
      ["h", null],
      ["p", null],
      ["li", null],
      ["li", null],
      ["li", 3],
      ["li", 4],
      ["quote", null],
    ]);
  });

  it("gives plain text and HTML", () => {
    const md = "**Gripping.**\n- fast\n- dark";
    expect(blurbPlain(md)).toBe("Gripping.\n• fast\n• dark");
    expect(blurbHtml(md)).toBe("<p><strong>Gripping.</strong></p><ul><li><p>fast</p></li><li><p>dark</p></li></ul>");
    expect(hasFormatting(md)).toBe(true);
    expect(hasFormatting("Just words.\nMore words.")).toBe(false);
  });

  it("escapes anything that looks like HTML", () => {
    expect(blurbHtml("<script>x</script> **hi**")).not.toContain("<script>");
  });
});

// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { parseSettings, readerCss, PAGE_COLORS, DEFAULT_SETTINGS } from "./settings";
import { absoluteSize, keepPicturesInShape } from "./useReaderEngine";

describe("the reader's own choices win over the book's", () => {
  it("reads a book's fixed sizes in pixels", () => {
    expect(absoluteSize("18px")).toBe(18);
    expect(absoluteSize(" 12pt ")).toBe(16);
    expect(absoluteSize("1.2em")).toBeNull();
    expect(absoluteSize("medium")).toBeNull();
  });

  it("shows a stretched SVG cover in its own shape", () => {
    document.body.innerHTML = `<svg viewBox="0 0 1200 1800" preserveAspectRatio="none"><image width="1200" height="1800" href="c.jpg" preserveAspectRatio="none"/></svg><svg preserveAspectRatio="none"><rect/></svg>`;
    keepPicturesInShape(document);
    const [cover, drawing] = Array.from(document.querySelectorAll("svg"));
    expect(cover.getAttribute("preserveAspectRatio")).toBe("xMidYMid meet");
    expect(cover.querySelector("image")!.getAttribute("preserveAspectRatio")).toBe("xMidYMid meet");
    // A drawing with no picture in it is left alone.
    expect(drawing.getAttribute("preserveAspectRatio")).toBe("none");
  });

  it("keeps line spacing between 1 and 2.5, in tenths", () => {
    expect(parseSettings(JSON.stringify({ lineHeight: 2.47 })).lineHeight).toBe(2.5);
    expect(parseSettings(JSON.stringify({ lineHeight: 0.4 })).lineHeight).toBe(1);
    expect(parseSettings(JSON.stringify({ lineHeight: 1.33 })).lineHeight).toBe(1.3);
  });

  it("sets line spacing on every part of the text, not headings", () => {
    const css = readerCss({ ...DEFAULT_SETTINGS, lineHeight: 2.1 }, PAGE_COLORS.light);
    expect(css).toMatch(/body, body :not\(h1, h2, h3, h4, h5, h6, :is\(h1, h2, h3, h4, h5, h6\) \*\) \{ line-height: 2.1 !important; \}/);
  });
});

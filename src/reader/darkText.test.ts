import { describe, expect, it } from "vitest";
import { contrast, darkPageColor, fitTextToPage, hexToRgb, parseRgb } from "./darkText";
import { PAGE_COLORS } from "./settings";

const dark = PAGE_COLORS.dark;
const page = hexToRgb(dark.background);
const pageText = hexToRgb(dark.text);

describe("text on dark pages", () => {
  it("gives black and grey text the page's own text colour", () => {
    expect(darkPageColor([0, 0, 0], page, pageText)).toEqual(pageText);
    expect(darkPageColor([85, 85, 85], page, pageText)).toEqual(pageText);
  });

  it("keeps real colours, lightened only until they read", () => {
    const red = darkPageColor([139, 0, 0], page, pageText)!;
    expect(red[0]).toBeGreaterThan(red[1]);
    expect(contrast(red, page)).toBeGreaterThanOrEqual(4.5);
    expect(red).not.toEqual(pageText);
  });

  it("leaves text that already reads alone", () => {
    expect(darkPageColor([255, 200, 120], page, pageText)).toBeNull();
    expect(darkPageColor(pageText, page, pageText)).toBeNull();
  });

  it("reads the colours browsers report", () => {
    expect(parseRgb("rgb(10, 20, 30)")).toEqual({ rgb: [10, 20, 30], alpha: 1 });
    expect(parseRgb("rgba(10, 20, 30, 0)")?.alpha).toBe(0);
    expect(parseRgb("transparent")).toBeNull();
  });

  it("recolours a book's dark paragraphs, and puts them back on a light page", () => {
    const doc = document.implementation.createHTMLDocument("book");
    doc.body.innerHTML = '<p style="color: #111">Dark words</p><p style="color: rgb(220, 30, 30)">Red words</p>';
    // jsdom has no page frame; borrow the window's getComputedStyle.
    Object.defineProperty(doc, "defaultView", { value: window });
    const [plain, red] = [...doc.querySelectorAll("p")];
    fitTextToPage(doc, dark, true);
    expect(plain.style.color).toBe("rgb(217, 213, 206)");
    expect(plain.style.getPropertyPriority("color")).toBe("important");
    expect(red.style.color).not.toBe("rgb(217, 213, 206)");
    fitTextToPage(doc, PAGE_COLORS.light, false);
    expect(plain.style.color).toBe("rgb(17, 17, 17)");
    expect(plain.hasAttribute("data-tbv-color")).toBe(false);
  });

  it("leaves dark text alone on a light box of the book's own", () => {
    const doc = document.implementation.createHTMLDocument("book");
    doc.body.innerHTML =
      '<aside style="background-color: #f4f0e0"><p style="color: #111">Boxed words</p></aside><p style="color: #111">Page words</p>';
    Object.defineProperty(doc, "defaultView", { value: window });
    const [boxed, open] = [...doc.querySelectorAll("p")];
    fitTextToPage(doc, dark, true);
    expect(boxed.style.color).toBe("rgb(17, 17, 17)");
    expect(open.style.color).toBe("rgb(217, 213, 206)");
  });
});

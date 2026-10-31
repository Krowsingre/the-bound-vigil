import { describe, expect, it } from "vitest";
import { buildManuscript } from "./manuscript";
import { layoutToHtml, unspace, type PdfItem, type PdfPage } from "./pdfImport";

/** A page of lines, top down: [text, x, size]. Lines sit `gap` points apart; null leaves a blank line. */
function page(lines: ([string, number, number] | null)[], extra: Partial<PdfPage> = {}, gap = 18, foot?: string): PdfPage {
  const items: PdfItem[] = foot ? [{ str: foot, x: 180, y: 30, width: 6, size: 9 }] : [];
  let y = 500;
  for (const line of lines) {
    if (line) {
      const [str, x, size] = line;
      items.push({ str, x, y, width: str.length * size * 0.5, size });
    }
    y -= line && line[2] > 20 ? line[2] * 1.1 : gap;
  }
  return { width: 364, height: 562, items, pictures: 0, ...extra };
}

const prose = (n: number) => `Line ${n} of a long paragraph of prose that runs right across the page`;

describe("Reading a PDF's pages", () => {
  it("finds headings, paragraphs and poems, and leaves out page numbers", () => {
    const pages = [
      page([["Night", 120, 52], ["Road", 120, 52], null, null, ["A. Pen", 140, 11]]),
      page([["Copyright © 2026 A. Pen", 36, 11], ["All rights reserved.", 36, 11]]),
      page([["Chapter One", 90, 28], null, null, [prose(1), 51, 11], [prose(2), 36, 11], ["the end.", 36, 11], [prose(3), 51, 11], ["over the page", 36, 11]], {}, 18, "2"),
      page([["and on into the night.", 36, 11]], {}, 18, "3"),
      page([["The Heron", 110, 28], null, null, ["The heron waits", 130, 11], ["beside the reeds", 112, 11], null, ["and then the rain", 118, 11], ["and then the seeds", 96, 11]], {}, 18, "4"),
    ];
    const { html, title, warnings } = layoutToHtml(pages);
    expect(title).toBe("Night Road");
    expect(html).toContain("<h1>Title page</h1>");
    expect(html).toContain("<h1>Copyright</h1>");
    expect(html).toContain("<h1>Chapter One</h1>");
    expect(html).toContain("the end.</p><p>Line 3");
    // The paragraph cut by the page turn is whole again.
    expect(html).toContain("over the page and on into the night.</p>");
    expect(html).toContain("<p>The heron waits<br>beside the reeds</p><p>and then the rain<br>and then the seeds</p>");
    expect(html).not.toMatch(/<p>[234]<\/p>/);
    expect(warnings.some((w) => w.kind === "text" && /page numbers/.test(w.message))).toBe(true);

    const m = buildManuscript({ title: title ?? "", author: null, description: null, html, warnings }, "headings");
    expect(m.sections.map((s) => [s.title, s.kind, s.include])).toEqual([
      ["Title page", "title_page", false],
      ["Copyright", "copyright", true],
      ["Chapter One", "chapter", true],
      ["The Heron", "poem", true],
    ]);
  });

  it("puts letter-spaced titles back together", () => {
    expect(unspace("D e d i c a t i o n")).toBe("Dedication");
    expect(unspace("G a r y M e u l e m a n s")).toBe("Gary Meulemans");
    expect(unspace("K E N N")).toBe("K E N N");
    expect(unspace("A normal line")).toBe("A normal line");
  });

  it("says when a PDF is only pictures of pages", () => {
    expect(() => layoutToHtml([page([], { pictures: 1 }), page([], { pictures: 1 })])).toThrow(/pictures of its pages/);
  });
});

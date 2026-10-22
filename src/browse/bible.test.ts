import { describe, expect, it } from "vitest";
import { bibleTarget, booksInContents, chapterEntry, chapterFile, chapterMark, parseBibleTarget, TRANSLATIONS, BIBLE_BOOKS } from "./bible";

describe("the Bible tab", () => {
  it("knows all 66 books and 1,189 chapters", () => {
    expect(BIBLE_BOOKS).toHaveLength(66);
    expect(BIBLE_BOOKS.reduce((n, b) => n + b.chapters, 0)).toBe(1189);
    expect(TRANSLATIONS.map((t) => t.short)).toEqual(["KJV", "WEB", "ASV"]);
  });

  it("reads a chapter to open back", () => {
    expect(parseBibleTarget(bibleTarget("1JN", 4))).toMatchObject({ book: { name: "1 John" }, chapter: 4 });
    expect(parseBibleTarget("epubcfi(/6/4)")).toBeNull();
  });

  it("finds books by their short names and their long ones", () => {
    const toc = [
      { label: "The First Book of Moses, called Genesis", href: "gen.xhtml", subitems: [{ label: "Genesis 1", href: "gen.xhtml#c1" }, { label: "Genesis 2", href: "gen.xhtml#c2" }] },
      { label: "The First Book of Samuel, otherwise called the First Book of the Kings", href: "1sa.xhtml" },
      { label: "The First Book of the Kings, commonly called the Third Book of the Kings", href: "1ki.xhtml" },
      { label: "The Book of the Prophet Jeremiah", href: "jer.xhtml" },
      { label: "The Lamentations of Jeremiah", href: "lam.xhtml" },
      { label: "John", href: "jhn.xhtml" },
      { label: "1 John", href: "1jn.xhtml" },
      { label: "Song of Songs", href: "sng.xhtml" },
      { label: "Psalms", href: "psa.xhtml" },
    ];
    const books = booksInContents(toc);
    expect(books.get("GEN")?.href).toBe("gen.xhtml");
    expect(books.get("1SA")?.href).toBe("1sa.xhtml");
    expect(books.get("1KI")?.href).toBe("1ki.xhtml");
    expect(books.get("JER")?.href).toBe("jer.xhtml");
    expect(books.get("LAM")?.href).toBe("lam.xhtml");
    expect(books.get("JHN")?.href).toBe("jhn.xhtml");
    expect(books.get("1JN")?.href).toBe("1jn.xhtml");
    expect(books.get("SNG")?.href).toBe("sng.xhtml");
    expect(books.get("PSA")?.href).toBe("psa.xhtml");
    expect(chapterEntry(books.get("GEN")!, 2)?.href).toBe("gen.xhtml#c2");
    expect(chapterEntry(books.get("GEN")!, 12)).toBeNull();
  });

  it("finds a chapter by its file or by the mark on its page", () => {
    const ids = ["OEBPS/GEN01.xhtml", "OEBPS/GEN02.xhtml", "OEBPS/GEN10.xhtml", "OEBPS/EXO01.xhtml"];
    expect(chapterFile(ids, "GEN", 1)).toBe("OEBPS/GEN01.xhtml");
    expect(chapterFile(ids, "GEN", 10)).toBe("OEBPS/GEN10.xhtml");
    expect(chapterFile(ids, "GEN", 3)).toBeNull();
    const doc = new DOMParser().parseFromString('<body><span id="GEN.2.1">1</span><div class="chapterlabel">3</div></body>', "text/html");
    expect(chapterMark(doc, "GEN", 2)?.id).toBe("GEN.2.1");
    expect(chapterMark(doc, "GEN", 3)?.className).toBe("chapterlabel");
    expect(chapterMark(doc, "GEN", 4)).toBeNull();
  });
});

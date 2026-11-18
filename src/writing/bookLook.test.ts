import { describe, expect, it } from "vitest";
import { chapterLabels, editorLookCss, styleForEditor } from "./bookLook";
import { chooseStyle } from "./bookStyles";
import { DEFAULT_EXPORT } from "./epub";
import type { WritingChapter } from "../api/types";

const page = (id: string, position: number, role: WritingChapter["role"] = "chapter", part: string | null = null) =>
  ({ id, position, role, part, title: id, body: "", page: role === "part" ? "{}" : JSON.stringify({ kind: "chapter" }) }) as unknown as WritingChapter;

describe("the book's look in the editor", () => {
  it("moves a book style's headings onto the editor's page", () => {
    const css = styleForEditor('section.chapter > h1 { font-style: italic; }\nsection.chapter > h1::after { content: "❦"; }\n.chapter-label::before, .chapter-label::after { content: " — "; }');
    expect(css).toContain(".writing-sheet.book-look.is-chapter .writing-chapter-title { font-style: italic; }");
    expect(css).toContain('.writing-sheet.book-look.is-chapter .writing-chapter-head::after { content: "❦"; }');
    expect(css).toContain(".writing-sheet.book-look.is-chapter .writing-chapter-label::before, .writing-sheet.book-look.is-chapter .writing-chapter-label::after");
    expect(css).not.toContain("section.chapter");
  });

  it("follows the book's settings: titles, paragraphs, first letter", () => {
    const css = editorLookCss({ ...DEFAULT_EXPORT, titles: "left", paragraphs: "space", dropCap: true });
    expect(css).toContain(".writing-chapter-title { margin: 0; font-size: 1.6em; font-weight: normal; text-align: left; }");
    expect(css).toContain("text-indent: 0; text-align: justify;");
    expect(css).toContain("p:first-child::first-letter");
    expect(editorLookCss(chooseStyle(DEFAULT_EXPORT, "classic"))).toContain('"Lora", serif');
  });

  it("numbers chapters as the book does, again in each body section", () => {
    const chapters = [page("a", 0), page("p", 1, "part"), page("b", 2, "chapter", "p"), page("c", 3, "chapter", "p")];
    const words = chapterLabels(chapters, { ...DEFAULT_EXPORT, chapterHeading: "words" });
    expect([...words.values()]).toEqual(["Chapter One", "Chapter One", "Chapter Two"]);
    expect(chapterLabels(chapters, { ...DEFAULT_EXPORT, chapterHeading: "numeral", numbering: "continuous" }).get("c")).toBe("3");
    expect(chapterLabels(chapters, DEFAULT_EXPORT).get("a")).toBe("");
  });
});

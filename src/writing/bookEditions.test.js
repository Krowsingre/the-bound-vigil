import { describe, expect, it } from "vitest";
import { editionName, editionsOf, firstEdition, isbnLines, nextEdition, readEdition } from "./bookEditions";
import { copyrightHtml, epubFiles, readExport } from "./epub";
import { DEFAULT_COPYRIGHT } from "./pages";
const project = { id: "0192f0a4-7e3b-7c1d-9a52-1f3e5b7d9c01", title: "The Ash Road", author: "Ada Embre", createdAt: "2025-01-01T00:00:00Z" };
describe("Editions of a book", () => {
    it("names editions and moves on to the next with no ISBNs", () => {
        expect(editionName(1)).toBe("First edition");
        expect(editionName(2)).toBe("Second edition");
        expect(editionName(12)).toBe("12th edition");
        expect(editionName(23)).toBe("23rd edition");
        const first = { ...firstEdition("2025"), isbns: { paperback: "978-1-23456-789-7", ebook: "978-1-23456-790-3" } };
        const second = nextEdition(first, "2027");
        expect(second).toMatchObject({ group: first.group, number: 2, name: "Second edition", year: "2027", isbns: {}, earlier: [{ name: "First edition", year: "2025" }] });
    });
    it("puts each format's ISBN and the earlier editions on the copyright page", () => {
        const edition = { ...nextEdition(firstEdition("2025"), "2027"), note: "Revised and expanded", isbns: { paperback: "ISBN 978-1-23456-789-7", hardcover: "978-1-23456-791-0" } };
        const html = copyrightHtml(project, DEFAULT_COPYRIGHT, new Date("2027-03-01"), edition);
        expect(html).toContain("First edition, 2025");
        expect(html).toContain("Second edition, 2027. Revised and expanded.");
        expect(html).toContain("ISBN 978-1-23456-789-7 (paperback)");
        expect(html).toContain("ISBN 978-1-23456-791-0 (hardcover)");
        expect(isbnLines(edition)).toHaveLength(2);
    });
    it("leaves ISBNs out when none are given, and keeps an old single ISBN", () => {
        const empty = copyrightHtml(project, DEFAULT_COPYRIGHT, new Date(), firstEdition("2026"));
        expect(empty).not.toContain("ISBN");
        expect(copyrightHtml(project, { ...DEFAULT_COPYRIGHT, isbn: "978-0-00000-000-2" }, new Date(), null)).toContain("ISBN 978-0-00000-000-2");
    });
    it("keeps the edition with the book's settings and names the ebook ISBN in the EPUB", () => {
        const edition = { ...firstEdition("2026"), isbns: { ebook: "978-1-23456-790-3" } };
        const settings = readExport(JSON.stringify({ edition }));
        expect(settings.edition).toEqual(edition);
        expect(readExport("{}").edition).toBeNull();
        expect(readEdition({ number: 2 })).toBeNull();
        const opf = String(epubFiles({ project: { ...project, language: "en", export: "{}" }, chapters: [], settings }).files.find(([n]) => n === "OEBPS/content.opf")?.[1]);
        expect(opf).toContain("urn:isbn:9781234567903");
    });
    it("finds a book's editions in order", () => {
        const first = firstEdition("2025");
        const second = nextEdition(first, "2027");
        const books = [
            { id: "b", edition: second },
            { id: "x", edition: firstEdition("2024") },
            { id: "a", edition: first },
        ];
        expect(editionsOf(first.group, books, (b) => b.edition).map((b) => b.id)).toEqual(["a", "b"]);
    });
});

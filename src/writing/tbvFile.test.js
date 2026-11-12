import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { isTbv, readTbv, safeHtml, TBV_MIME, tbvFileName, writeTbv } from "./tbvFile";
const PIXEL = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const project = {
    id: "p1",
    title: "Night: Poems / Songs",
    author: "A. Pen",
    series: "The Ash Road",
    seriesIndex: 2,
    language: "en",
    description: "Poems.",
    cover: "picture:c.jpg",
    coverPath: null,
    coverPage: "title",
    export: JSON.stringify({ font: "lora", storeBooks: [{ store: "apple" }], futureSetting: { kept: true } }),
    chapters: 4,
    words: 30,
    createdAt: "2026-11-01T00:00:00Z",
    updatedAt: "2026-11-01T00:00:00Z",
};
const chapter = (id, position, role, page, body, part = null, title = id) => ({
    id,
    projectId: "p1",
    title,
    body,
    position,
    words: 3,
    updatedAt: "2026-11-01T00:00:00Z",
    role,
    part,
    page,
});
const chapters = [
    chapter("poem", 3, "chapter", '{"kind":"poem","centred":true}', `<p>Ash on<br>the road</p><img src="data:image/png;base64,${PIXEL}" alt="a dot">`, "partA", ""),
    chapter("copyright", 0, "front", '{"kind":"copyright"}', ""),
    chapter("partA", 1, "part", "{}", "", null, "Book One"),
    chapter("ch1", 2, "chapter", '{"kind":"chapter"}', `<p>It <em>began</em>.</p><img src="data:image/png;base64,${PIXEL}">`, "partA", "Arrival"),
    chapter("about", 4, "back", '{"kind":"about_author"}', "<p>Lives by the sea.</p>"),
];
const note = { id: "n1", kind: "personal", book: null, excerpt: "", note: "<p>Check stanza 2.</p>", title: "To do", color: null, locator: null, createdAt: "", updatedAt: "", pinnedAt: "2026-11-01T00:00:00Z", tags: ["edits"] };
const made = () => writeTbv({
    project,
    chapters,
    cover: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]),
    notes: [note],
    records: [{ id: "r1", projectId: "p1", event: "import", createdAt: "2026-11-01T00:00:00Z", record: { source: { name: "Night.docx" } }, signature: "valid", keyId: "k", appleStamp: false, appleCheck: null, device: "PC" }],
    app: "0.69.0",
});
describe("The Scribe book file", () => {
    it("is a zip anyone can open, its type first and plain, then book.json", () => {
        const bytes = made();
        expect(isTbv(bytes)).toBe(true);
        const files = unzipSync(bytes);
        expect(Object.keys(files).slice(0, 2)).toEqual(["mimetype", "book.json"]);
        expect(strFromU8(files.mimetype)).toBe(TBV_MIME);
        const book = JSON.parse(strFromU8(files["book.json"]));
        expect(book.formatVersion).toBe(1);
        expect(book.book.settings.futureSetting).toEqual({ kept: true });
        expect(book.pages.map((p) => p.role)).toEqual(["front", "part", "chapter", "chapter", "back"]);
        // The picture both pages show is kept once, outside them.
        expect(Object.keys(files).filter((n) => n.startsWith("images/"))).toEqual(["images/0001.png"]);
        expect(strFromU8(files["pages/0004.html"])).toContain('src="images/0001.png"');
        expect(files["cover.jpg"]).toBeDefined();
    });
    it("opens again as the same book: pages, kinds, parts, pictures, settings, notes and history", () => {
        const book = readTbv(made());
        expect(book.title).toBe("Night: Poems / Songs");
        expect(book.series).toBe("The Ash Road");
        expect(book.seriesIndex).toBe(2);
        expect(book.coverPage).toBe("title");
        expect(book.cover?.extension).toBe("jpg");
        expect(book.settings.storeBooks).toEqual([{ store: "apple" }]);
        expect(book.pages.map((p) => [p.title, p.role, p.part, p.page.kind ?? null])).toEqual([
            ["copyright", "front", null, "copyright"],
            ["Book One", "part", null, null],
            ["Arrival", "chapter", 1, "chapter"],
            ["", "chapter", 1, "poem"],
            ["about", "back", null, "about_author"],
        ]);
        expect(book.pages[3].page.centred).toBe(true);
        expect(book.pages[3].body).toContain(`src="data:image/png;base64,${PIXEL}"`);
        expect(book.pages[3].body).toContain("Ash on<br>the road");
        expect(book.notes).toEqual([{ title: "To do", body: "<p>Check stanza 2.</p>", tags: ["edits"], pinned: true }]);
        expect(book.history).toHaveLength(1);
        expect(book.newer).toBe(false);
    });
    it("lets nothing that runs into a page", () => {
        const html = safeHtml(`<p onclick="x()">Hi <a href="javascript:alert(1)">there</a> <a href="https://a.b">site</a></p><script>bad()</script><img src="x" onerror="bad()"><iframe src="https://evil"></iframe>`, () => null);
        expect(html).toBe('<p>Hi <a>there</a> <a href="https://a.b">site</a></p>');
    });
    it("says plainly when a file isn't one, and opens a newer one as far as it can", () => {
        expect(() => readTbv(new Uint8Array([1, 2, 3]))).toThrow(/couldn't be opened/);
        expect(() => readTbv(zipSync({ "book.json": strToU8("{}") }))).toThrow(/isn't a Scribe book file/);
        const newer = zipSync({ mimetype: [strToU8(TBV_MIME), { level: 0 }], "book.json": strToU8(JSON.stringify({ format: "The Bound Vigil book", formatVersion: 7, book: { title: "Later" }, pages: [{ file: "p.html", role: "spaceship" }] })), "p.html": strToU8("<p>Hi</p>") });
        const book = readTbv(newer);
        expect(book.newer).toBe(true);
        expect(book.pages).toEqual([{ title: "", role: "chapter", part: null, page: {}, body: "<p>Hi</p>" }]);
    });
    it("names the file after the book", () => {
        expect(tbvFileName("Night: Poems / Songs")).toBe("Night Poems Songs.tbv");
        expect(tbvFileName("  ")).toBe("Book.tbv");
    });
});
describe("The sample book", () => {
    it("is Paradise Lost by John Milton, in twelve books, with its cover", async () => {
        const { readFileSync } = await import("node:fs");
        const book = readTbv(new Uint8Array(readFileSync("public/samples/paradise-lost.tbv")));
        expect(book.title).toBe("Paradise Lost");
        expect(book.author).toBe("John Milton");
        expect(book.cover?.extension).toBe("jpg");
        const body = book.pages.filter((p) => p.role === "chapter");
        expect(body.map((p) => p.title)).toEqual(["Book I", "Book II", "Book III", "Book IV", "Book V", "Book VI", "Book VII", "Book VIII", "Book IX", "Book X", "Book XI", "Book XII"]);
        expect(body[0].body).toContain("Of Man’s first disobedience");
        expect(body[11].body).toContain("Through Eden took their solitary way.</p>");
        expect(book.pages.map((p) => p.body).join("")).not.toMatch(/Gutenberg/i);
    });
});

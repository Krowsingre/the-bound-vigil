import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { readDocumentBytes } from "./importDoc";
import { asPoem, buildManuscript, inspect, looksLikePoem } from "./manuscript";

const doc = (html: string, title = "Night Road") => ({ title, author: "A. Pen", description: null, html });

describe("Rebuilding a manuscript", () => {
  it("sorts sections into front, body and back by their headings", () => {
    const m = buildManuscript(
      doc("<h1>Dedication</h1><p>For Mara.</p><h1>Prologue</h1><p>It began in rain.</p><h1>Chapter 1</h1><p>Rain fell.</p><h1>Epilogue</h1><p>It ended.</p><h1>Acknowledgments</h1><p>Thanks.</p><h1>About the Author</h1><p>Lives by the sea.</p>"),
      "headings",
    );
    expect(m.sections.map((s) => [s.title, s.area, s.kind])).toEqual([
      ["Dedication", "front", "dedication"],
      ["Prologue", "chapter", "prologue"],
      ["Chapter 1", "chapter", "chapter"],
      ["Epilogue", "chapter", "epilogue"],
      ["Acknowledgments", "back", "acknowledgments"],
      ["About the Author", "back", "about_author"],
    ]);
    expect(m.sections.every((s) => s.sure)).toBe(true);
    expect(m.issues).toEqual([]);
  });

  it("never moves a section out of order, and flags it instead", () => {
    const m = buildManuscript(doc("<h1>Chapter 1</h1><p>Rain.</p><h1>Dedication</h1><p>For Mara.</p><h1>Chapter 2</h1><p>Sun.</p>"), "headings");
    expect(m.sections.map((s) => [s.title, s.area])).toEqual([
      ["Chapter 1", "chapter"],
      ["Dedication", "chapter"],
      ["Chapter 2", "chapter"],
    ]);
    expect(m.sections[1].sure).toBe(false);
    expect(m.issues.some((i) => i.kind === "classification" && i.section === 1)).toBe(true);
  });

  it("uses an EPUB's own labels", () => {
    const m = buildManuscript(doc('<h1 data-kind="dedication"></h1><p>For Mara, always.</p><h1 data-kind="bodymatter chapter">The Road</h1><p>Rain.</p>'), "headings");
    expect(m.sections.map((s) => s.kind)).toEqual(["dedication", "chapter"]);
    expect(m.sections[0].area).toBe("front");
    expect(m.sections[0].body).not.toContain("data-kind");
  });

  it("keeps a poem's lines and stanzas", () => {
    const body = "<p>The heron waits</p><p>beside the reeds</p><p data-blank></p><p>and then the rain</p><p>and then the seeds</p>";
    expect(looksLikePoem(body)).toBe(true);
    expect(asPoem(body)).toBe("<p>The heron waits<br>beside the reeds</p><p>and then the rain<br>and then the seeds</p>");
    expect(looksLikePoem("<p>It was a long day. We walked home.</p><p>Then we slept for hours and hours.</p><p>Morning came.</p><p>We ate.</p>")).toBe(false);
    const m = buildManuscript(doc(`<h1>Chapter 1</h1><p>Prose here.</p><h1>Heron</h1>${body}`), "headings");
    expect(m.sections[1].kind).toBe("poem");
    expect(m.sections[1].area).toBe("chapter");
    expect(m.issues.some((i) => i.kind === "poetry")).toBe(true);
  });

  it("keeps an occasional blank line as a break, but drops blank lines used as spacing", () => {
    const occasional = buildManuscript(doc("<h1>One</h1><p>A.</p><p>B.</p><p>C.</p><p></p><p>D.</p><p>E.</p><p>F.</p>"), "headings");
    expect(occasional.sections[0].body).toBe("<p>A.</p><p>B.</p><p>C.</p><hr><p>D.</p><p>E.</p><p>F.</p>");
    expect(occasional.issues.some((i) => i.kind === "breaks")).toBe(true);
    const spacing = buildManuscript(doc("<h1>One</h1><p>A.</p><p></p><p>B.</p><p></p><p>C.</p>"), "headings");
    expect(spacing.sections[0].body).toBe("<p>A.</p><p>B.</p><p>C.</p>");
  });

  it("leaves out a title page Scribe makes itself, and keeps a copyright page as written", () => {
    const m = buildManuscript(doc("<p>Night Road</p><p>A. Pen</p><h1>Copyright</h1><p>© 2026 A. Pen. All rights reserved.</p><h1>Chapter 1</h1><p>Rain.</p>"), "headings");
    expect(m.sections[0]).toMatchObject({ kind: "title_page", include: false });
    expect(m.sections[1]).toMatchObject({ kind: "copyright", area: "front" });
  });

  it("reports untitled sections and lost pictures", () => {
    const m = buildManuscript(doc('<h1>One</h1><p>Rain.</p><img src="pic.png"><h1></h1><p>Sun.</p>'), "headings");
    expect(m.issues.some((i) => i.kind === "boundary" && i.section === 1)).toBe(true);
    expect(m.issues.some((i) => i.kind === "images")).toBe(true);
  });
});

describe("Looking at a file first", () => {
  it("knows the files it can rebuild from", () => {
    expect(inspect("My Book.docx", new Uint8Array())).toMatchObject({ format: "docx", supported: true });
    expect(inspect("My Book.epub", new Uint8Array())).toMatchObject({ format: "epub", supported: true });
    expect(inspect("My Book.pdf", new Uint8Array())).toMatchObject({ format: "pdf", supported: false });
  });

  it("recognises a Kindle Create project, and one made from a PDF", () => {
    const fromPdf = zipSync({
      "book.kcb": strToU8('{"book_state":{"book_input_type":1}}'),
      "resources/book.kdf": strToU8("SQLite format 3"),
      "resources/res/rsrc8": strToU8("%PDF-1.3 …"),
    });
    const made = inspect("Through the Night.zip", fromPdf);
    expect(made).toMatchObject({ format: "kindle_create", supported: false });
    expect(made.reason).toContain("made from a PDF");
    const reflowable = zipSync({ "book.kcb": strToU8('{"book_state":{"book_input_type":0}}'), "resources/book.kdf": strToU8("SQLite format 3") });
    expect(inspect("Novel.zip", reflowable).reason).toContain("Word file");
    expect(inspect("project.kcb", new Uint8Array()).reason).toContain("Zip the whole project folder");
    expect(inspect("photos.zip", zipSync({ "a.jpg": new Uint8Array([1]) }))).toMatchObject({ format: "zip", supported: false });
  });

  it("refuses a copy-protected EPUB", async () => {
    const epub = zipSync({
      mimetype: strToU8("application/epub+zip"),
      "META-INF/container.xml": strToU8('<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>'),
      "META-INF/encryption.xml": strToU8('<encryption><EncryptedData><EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes128-cbc"/></EncryptedData></encryption>'),
      "book.opf": strToU8("<package><metadata/><manifest/><spine/></package>"),
    });
    await expect(readDocumentBytes("Locked.epub", epub)).rejects.toThrow(/copy-protected/);
  });
});

describe("Markdown poems", () => {
  it("keeps short lines apart, and finds the poem", async () => {
    const md = "# Chapter 1\n\nRain fell on the road the night she came home, and the river rose to the mill.\n\n# The Heron\n\nThe heron waits\nbeside the reeds\n\nand then the rain\nand then the seeds\n";
    const d = await readDocumentBytes("Book.md", new TextEncoder().encode(md));
    const m = buildManuscript(d, "headings");
    expect(m.sections[1]).toMatchObject({ title: "The Heron", kind: "poem" });
    expect(m.sections[1].body).toBe("<p>The heron waits<br>beside the reeds</p><p>and then the rain<br>and then the seeds</p>");
  });
});

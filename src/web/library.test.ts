import { WebDb } from "./db";
import { stampAfter, WebLibrary } from "./library";

const book = (id: string, title: string) => ({
  kind: "book",
  key: JSON.stringify([id]),
  data: { id, title, authors: '["Someone"]', format: "epub", file_size: 10, added_at: "2026-10-01T00:00:00.000Z", deleted_at: null },
  changed_at: "2026-10-01T00:00:00.000Z",
});

describe("the web version's library", () => {
  it("builds books from the desktop app's records and sends its own changes as records", async () => {
    const library = new WebLibrary(await WebDb.open());
    await library.merge([
      book("sha256:a", "Dracula"),
      {
        kind: "book_progress",
        key: '["sha256:a"]',
        data: { id: "sha256:a", status: "in_progress", total_progression: 0.4, resume_locator: null, last_opened_at: null, finished_at: null },
        changed_at: "2026-10-02T00:00:00.000Z",
      },
      // Progress for a book that isn't here is ignored, not turned into a book.
      { kind: "book_progress", key: '["sha256:x"]', data: { id: "sha256:x", status: "read" }, changed_at: "2026-10-02T00:00:00.000Z" },
    ]);
    expect(library.books().map((b) => [b.title, b.status, b.total_progression, b.favorite])).toEqual([["Dracula", "in_progress", 0.4, 0]]);
    expect(library.waiting()).toBe(0);

    await library.write("book_shelves", { ...library.book("sha256:a"), favorite: 1 });
    const [sent] = library.outbox(10);
    expect(sent.kind).toBe("book_shelves");
    expect(sent.data).toEqual({ id: "sha256:a", favorite: 1, want_to_read: 0, rating: null });
    expect(library.book("sha256:a")?.favorite).toBe(1);

    // The change coming back from the cloud marks it sent.
    await library.merge([{ ...sent }]);
    expect(library.waiting()).toBe(0);
  });

  it("keeps the newest change, and always offers the Up next shelf", async () => {
    const library = new WebLibrary(await WebDb.open());
    await library.merge([book("sha256:a", "Old title")]);
    await library.merge([{ ...book("sha256:a", "Older title"), changed_at: "2026-09-01T00:00:00.000Z" }]);
    expect(library.book("sha256:a")?.title).toBe("Old title");
    await library.merge([{ ...book("sha256:a", "New title"), changed_at: "2026-10-05T00:00:00.000Z" }]);
    expect(library.book("sha256:a")?.title).toBe("New title");
    await library.merge([{ kind: "book", key: '["sha256:a"]', data: null, changed_at: "2026-10-06T00:00:00.000Z" }]);
    expect(library.books()).toEqual([]);
    expect(library.row("collections", ["shelf:want_to_read"])?.name).toBe("Up next");
  });

  it("never stamps a change earlier than the one before it", () => {
    const future = "2999-01-01T00:00:00.000Z";
    expect(stampAfter(future)).toBe("2999-01-01T00:00:00.001Z");
    expect(stampAfter(undefined) <= new Date().toISOString()).toBe(true);
  });

  it("says whether the phone has a book, as its own record", async () => {
    const library = new WebLibrary(await WebDb.open());
    await library.merge([book("sha256:p", "Carmilla")]);
    expect(library.book("sha256:p")?.phone_has).toBe(0);
    await library.write("book_phone", { ...library.book("sha256:p"), phone_has: 1 });
    const [sent] = library.outbox(10);
    expect(sent.kind).toBe("book_phone");
    expect(sent.data).toEqual({ id: "sha256:p", phone_wanted: 0, phone_has: 1, from_phone: 0 });
    expect(library.book("sha256:p")?.title).toBe("Carmilla");
  });
});

describe("files kept in pieces", () => {
  it("lists a folder of pieces as its file", async () => {
    const { listedName, piecePath } = await import("./supabase");
    expect(listedName("ab.m4b.pieces", true)).toBe("ab.m4b");
    expect(listedName("someone", true)).toBeNull();
    expect(listedName("ab.epub", false)).toBe("ab.epub");
    expect(piecePath("books/ab.m4b", 3)).toBe("books/ab.m4b.pieces/0003");
  });
});

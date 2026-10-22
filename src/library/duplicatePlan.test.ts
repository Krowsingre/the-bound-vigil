import { describe, expect, it } from "vitest";
import type { DuplicateGroup } from "../api/types";
import { copiesOfFormat, DEFAULT_FORMAT_ORDER, formatOrder, matchesFilter, planCleanup, type DuplicateBook } from "./duplicatePlan";

let n = 0;
const book = (format: string, fileSize: number, extra: Partial<DuplicateBook> = {}): DuplicateBook =>
  ({
    id: `b${++n}`,
    title: "Carmilla",
    authors: ["Le Fanu"],
    format,
    fileSize,
    notes: 0,
    coverSize: null,
    status: "unread",
    totalProgression: null,
    addedAt: `2026-01-${String(n).padStart(2, "0")}T00:00:00Z`,
    ...extra,
  }) as DuplicateBook;
const set = (...books: DuplicateBook[]): DuplicateGroup => ({ key: books.map((b) => b.id).join("+"), reason: "The same title and author", books });

describe("cleaning up duplicates", () => {
  it("keeps the best-ranked format, then the largest file", () => {
    const epub = book("epub", 100);
    const mobi = book("mobi", 900);
    const small = book("mobi", 10);
    const big = book("mobi", 20);
    const plan = planCleanup([set(mobi, epub), set(small, big)], DEFAULT_FORMAT_ORDER);
    expect(plan.steps.map((s) => [s.keep.id, s.remove.map((b) => b.id), s.why])).toEqual([
      [epub.id, [mobi.id], "EPUB comes first in your order."],
      [big.id, [small.id], "The largest file."],
    ]);
  });

  it("keeps the copy with your reading, and leaves sets with two of them to you", () => {
    const read = book("pdf", 5, { notes: 2 });
    const plain = book("epub", 50);
    const both = set(book("epub", 1, { status: "in_progress" }), book("mobi", 1, { notes: 1 }));
    const plan = planCleanup([set(plain, read), both], DEFAULT_FORMAT_ORDER);
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0].keep.id).toBe(read.id);
    expect(plan.yours).toEqual([both]);
  });

  it("filters by the exact mix of formats, or one format only", () => {
    const mobiEpub = set(book("mobi", 1), book("epub", 1));
    const epubPdf = set(book("epub", 1), book("pdf", 1));
    const twoMobi = set(book("mobi", 1), book("MOBI", 2));
    const all = [mobiEpub, epubPdf, twoMobi];
    expect(all.filter((g) => matchesFilter(g, { kind: "exactly", formats: ["epub", "mobi"] }))).toEqual([mobiEpub]);
    expect(all.filter((g) => matchesFilter(g, { kind: "same" }))).toEqual([twoMobi]);
    expect(all.filter((g) => matchesFilter(g, { kind: "exactly", formats: ["mobi"] }))).toEqual([twoMobi]);
  });

  it("deletes every copy of a format but never a set's last copy or your reading", () => {
    const keepEpub = book("epub", 1);
    const goMobi = book("mobi", 1);
    const noted = book("mobi", 1, { notes: 1 });
    const onlyMobiSmall = book("mobi", 1);
    const onlyMobiBig = book("mobi", 9);
    const { remove, keptForReading } = copiesOfFormat(
      [set(keepEpub, goMobi, noted), set(onlyMobiSmall, onlyMobiBig)],
      "MOBI",
      DEFAULT_FORMAT_ORDER,
    );
    expect(remove.map((b) => b.id)).toEqual([goMobi.id, onlyMobiSmall.id]);
    expect(keptForReading).toBe(1);
  });

  it("orders formats as saved, then the rest A to Z", () => {
    const groups = [set(book("pdf", 1), book("fb2", 1), book("epub", 1))];
    expect(formatOrder(["pdf", "epub"], groups)).toEqual(["pdf", "epub", "fb2"]);
  });
});

import { authorLine, percent, relativeTime } from "./format";
import { importSummary } from "./importSummary";
import { importsViewOf } from "../imports/view";
import type { ImportItem } from "../api/types";

test("percent is clamped and rounded", () => {
  expect(percent(null)).toBe("0%");
  expect(percent(0.426)).toBe("43%");
  expect(percent(1.4)).toBe("100%");
});

test("author line handles none, two and many", () => {
  expect(authorLine([])).toBe("Unknown author");
  expect(authorLine(["A", "B"])).toBe("A & B");
  expect(authorLine(["A", "B", "C"])).toBe("A and 2 others");
});

test("relative time reads naturally", () => {
  const now = Date.parse("2026-10-16T12:00:00Z");
  expect(relativeTime("2026-10-16T11:59:30Z", now)).toBe("just now");
  expect(relativeTime("2026-10-16T10:00:00Z", now)).toBe("2 h ago");
  expect(relativeTime("2026-10-15T12:00:00Z", now)).toBe("yesterday");
});

test("import summary is one plain sentence per outcome", () => {
  const id = "sha256:00" as const;
  const done = (outcome: "imported" | "alreadyInLibrary", path: string, title: string): ImportItem => ({
    id: 0,
    path,
    name: path,
    bytes: 1,
    bytesRead: 1,
    stage: "done",
    result: { outcome, path, bookId: id, title },
  });
  expect(importSummary(importsViewOf([]))).toBe("No book files were found there.");
  expect(importSummary(importsViewOf([done("imported", "a", "Dracula")]))).toBe("Added “Dracula”.");
  expect(
    importSummary(
      importsViewOf([
        done("imported", "a", "A"),
        done("imported", "b", "B"),
        done("alreadyInLibrary", "c", "C"),
        { id: 0, path: "d.txt", name: "d.txt", bytes: 1, bytesRead: 1, stage: "done", result: { outcome: "unsupported", path: "d.txt" } },
      ]),
    ),
  ).toBe("Added 2 books. 1 book was already in your library. 1 file isn't a supported book format.");
});

test("a huge import is summed up but only partly listed", () => {
  const items: ImportItem[] = Array.from({ length: 17_000 }, (_, i) => ({
    id: i,
    path: `b${i}.epub`,
    name: `b${i}.epub`,
    bytes: 10,
    bytesRead: i < 9_000 ? 10 : 0,
    stage: i < 9_000 ? "done" : "waiting",
    result: i < 9_000 ? { outcome: "imported", path: `b${i}.epub`, bookId: "sha256:00", title: `B${i}` } : null,
  }));
  const view = importsViewOf(items);
  expect([view.total, view.done, view.added, view.waitingCount]).toEqual([17_000, 9_000, 9_000, 8_000]);
  expect([view.waiting.length, view.finished.length]).toEqual([100, 100]);
  expect(view.finished[0].name).toBe("b8999.epub");
  expect(importSummary(view)).toBe("Added 9000 books.");
});

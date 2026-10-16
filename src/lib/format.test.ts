import { authorLine, percent, relativeTime } from "./format";
import { importSummary } from "./importSummary";

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
  expect(importSummary([])).toBe("No book files were found there.");
  expect(importSummary([{ outcome: "imported", path: "a", bookId: id, title: "Dracula" }])).toBe("Added “Dracula”.");
  expect(
    importSummary([
      { outcome: "imported", path: "a", bookId: id, title: "A" },
      { outcome: "imported", path: "b", bookId: id, title: "B" },
      { outcome: "alreadyInLibrary", path: "c", bookId: id, title: "C" },
      { outcome: "unsupported", path: "d.txt" },
    ]),
  ).toBe("Added 2 books. 1 book was already in your library. 1 file isn't a supported book format.");
});

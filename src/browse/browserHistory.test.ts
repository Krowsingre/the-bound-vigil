import { addToHistory, clearHistory, dayLabel, readHistory, removeFromHistory, trimmed } from "./browserHistory";

beforeEach(() => localStorage.clear());

const DAY = 86_400_000;

describe("Discover's history", () => {
  it("keeps visits newest first, and the same page again updates it", () => {
    addToHistory({ kind: "page", url: "https://a.org/", title: null }, "forever", 1000);
    addToHistory({ kind: "page", url: "https://a.org/", title: "A" }, "forever", 2000);
    addToHistory({ kind: "search", url: "https://duckduckgo.com/?q=b", title: "b" }, "forever", 3000);
    const list = readHistory();
    expect(list.map((e) => [e.kind, e.title, e.at])).toEqual([
      ["search", "b", 3000],
      ["page", "A", 2000],
    ]);
    removeFromHistory([list[0].id]);
    expect(readHistory().map((e) => e.title)).toEqual(["A"]);
  });

  it("lets go of what's older than it keeps, and clears by time", () => {
    const now = 100 * DAY;
    addToHistory({ kind: "page", url: "https://old.org/", title: null }, "forever", now - 10 * DAY);
    addToHistory({ kind: "page", url: "https://new.org/", title: null }, "forever", now - 1000);
    expect(trimmed(readHistory(), "week", now).map((e) => e.url)).toEqual(["https://new.org/"]);
    clearHistory(3_600_000, now);
    expect(readHistory().map((e) => e.url)).toEqual(["https://old.org/"]);
    clearHistory();
    expect(readHistory()).toEqual([]);
  });

  it("names days", () => {
    const now = new Date(2026, 9, 23, 15).getTime();
    expect(dayLabel(now - 3_600_000, now)).toBe("Today");
    expect(dayLabel(now - DAY, now)).toBe("Yesterday");
  });
});

import { describe, expect, it } from "vitest";
import type { MissingBook } from "../api/types";
import { checkDue, checkEveryDays, newlyListed } from "./seriesCheck";

const DAY = 24 * 60 * 60_000;
const book = (key: string, hidden = false): MissingBook => ({ key, title: key, position: Number(key), authors: [], coverUrl: null, source: "audible", hidden, read: false });

describe("the series check", () => {
  it("runs on the schedule chosen, monthly unless changed", () => {
    expect(checkEveryDays({ seriesCheck: "month", seriesCheckDays: 14 })).toBe(30);
    expect(checkEveryDays({ seriesCheck: "custom", seriesCheckDays: 10 })).toBe(10);
    expect(checkEveryDays({ seriesCheck: "never", seriesCheckDays: 10 })).toBeNull();
    const now = Date.parse("2026-11-18T12:00:00Z");
    expect(checkDue({ seriesCheck: "week", seriesCheckDays: 1 }, null, now)).toBe(true);
    expect(checkDue({ seriesCheck: "week", seriesCheckDays: 1 }, new Date(now - 6 * DAY).toISOString(), now)).toBe(false);
    expect(checkDue({ seriesCheck: "week", seriesCheckDays: 1 }, new Date(now - 7 * DAY).toISOString(), now)).toBe(true);
    expect(checkDue({ seriesCheck: "never", seriesCheckDays: 1 }, null, now)).toBe(false);
  });

  it("counts only books that weren't on the list before, and not hidden ones", () => {
    expect(newlyListed([book("1"), book("2")], [book("1"), book("2"), book("3"), book("4", true)]).map((b) => b.key)).toEqual(["3"]);
  });
});

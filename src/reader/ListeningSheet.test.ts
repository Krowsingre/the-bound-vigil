import { describe, expect, it } from "vitest";
import { MS_PER_PAGE, timeLeft } from "./ListeningSheet";

describe("listening times", () => {
  it("words what's left in hours and minutes", () => {
    expect(timeLeft((29 * 60 + 37) * 60_000)).toBe("29h 37m left");
    expect(timeLeft(12 * 60_000 + 20_000)).toBe("12 min left");
    expect(timeLeft(-5)).toBe("0 min left");
  });

  it("reads a page in about a minute", () => {
    expect(Math.round(MS_PER_PAGE / 1000)).toBe(65);
  });
});

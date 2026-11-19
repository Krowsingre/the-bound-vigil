import { describe, expect, it } from "vitest";
import { bookTypeLabel, currentBookType, readBookType } from "./bookType";

describe("book type", () => {
  it("keeps what a book started as until one is chosen", () => {
    expect(bookTypeLabel(null, "collection")).toBe("Short stories");
    expect(bookTypeLabel(null, "novel")).toBe("Novel");
    expect(bookTypeLabel(null, "blank")).toBeNull();
    expect(bookTypeLabel(null, null)).toBeNull();
    expect(currentBookType(undefined, "nonfiction")).toEqual({ type: "nonfiction" });
  });

  it("shows the chosen type, or the writer's own words", () => {
    expect(bookTypeLabel({ type: "poetry" }, "collection")).toBe("Poetry");
    expect(bookTypeLabel({ type: "custom", custom: "Verse novel" }, "novel")).toBe("Verse novel");
    expect(bookTypeLabel({ type: "custom", custom: "  " }, "novel")).toBeNull();
    expect(bookTypeLabel({ type: "none" }, "novel")).toBeNull();
  });

  it("reads only types it knows", () => {
    expect(readBookType({ type: "poetry" })).toEqual({ type: "poetry" });
    expect(readBookType({ type: "custom", custom: " Epic " })).toEqual({ type: "custom", custom: "Epic" });
    expect(readBookType({ type: "saga" })).toBeNull();
    expect(readBookType("poetry")).toBeNull();
    expect(readBookType(null)).toBeNull();
  });
});

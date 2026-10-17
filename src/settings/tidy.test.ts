import { describe, expect, it } from "vitest";
import { tidyText } from "./TidySection";

const plan = {
  keep: 1,
  remove: ["books/a.epub"],
  copyFirst: ["books/b.epub", "books/c.epub"],
  lose: [],
  bytes: 3 * 1024 * 1024 * 1024,
};

describe("tidying up Supabase", () => {
  it("says what goes, what's copied first, and that the books stay", () => {
    const text = tidyText(plan, "iCloud Drive");
    expect(text).toContain("Supabase has 3 books that aren't on this computer (3.0 GB)");
    expect(text).toContain("2 books aren't in iCloud Drive yet, so they're copied there first.");
    expect(text).toContain("Every book stays in your library");
    expect(text).not.toContain("no other cloud copy");
  });

  it("warns when a copy has nowhere else to go", () => {
    const text = tidyText({ ...plan, remove: [], copyFirst: [], lose: ["books/a.epub"], bytes: 0 }, null);
    expect(text).toContain("Supabase has 1 book that isn't on this computer.");
    expect(text).toContain("1 book has no other cloud copy. Once removed, it can only");
  });
});

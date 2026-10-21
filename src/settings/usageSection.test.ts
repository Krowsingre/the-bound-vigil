import { describe, expect, it } from "vitest";
import { FREE_DATABASE, FREE_FILES, filesBreakdown, usageLine } from "./UsageSection";

describe("Supabase space", () => {
  it("says how full each part is", () => {
    expect(usageLine(512 * 1024 ** 2, FREE_FILES)).toBe("512 MB of 1 GB (50%).");
    expect(usageLine(450 * 1024 ** 2, FREE_DATABASE)).toBe("450 MB of 500 MB (90%). That's nearly full.");
    expect(usageLine(1.2 * 1024 ** 3, FREE_FILES)).toContain("over the free plan");
  });

  it("names what the files are, leaving out audiobooks when there are none", () => {
    const usage = {
      fileBytes: 0,
      files: 1200,
      bookBytes: 300 * 1024 ** 2,
      audioBytes: 0,
      pictureBytes: 20 * 1024 ** 2,
      databaseBytes: 1,
    };
    expect(filesBreakdown(usage)).toBe("1,200 files: books 300 MB, covers and pictures 20 MB.");
    expect(filesBreakdown({ ...usage, audioBytes: 2 * 1024 ** 3 })).toContain("audiobooks 2 GB");
  });
});

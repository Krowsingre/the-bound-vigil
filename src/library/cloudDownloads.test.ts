import { describe, expect, it } from "vitest";
import { isDownloading, tracked, wasStopped } from "./cloudDownloads";

describe("cloud downloads", () => {
  it("counts a book as coming down until it ends, however it ends", async () => {
    let finish!: () => void;
    const work = tracked("a", new Promise<void>((done) => (finish = done)));
    expect(isDownloading("a")).toBe(true);
    finish();
    await work;
    expect(isDownloading("a")).toBe(false);
    await tracked("b", Promise.reject(new Error("Stopped."))).catch(() => undefined);
    expect(isDownloading("b")).toBe(false);
  });

  it("tells a stopped download from a failed one", () => {
    expect(wasStopped("Stopped.")).toBe(true);
    expect(wasStopped(new Error("Stopped."))).toBe(true);
    expect(wasStopped("TBV can't reach the cloud right now (timeout)")).toBe(false);
  });
});

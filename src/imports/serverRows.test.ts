import { describe, expect, it } from "vitest";
import type { QueuedServerFile } from "../api/types";
import { rowText, took } from "./ServerRows";

const file = (over: Partial<QueuedServerFile>): QueuedServerFile => ({
  id: 1,
  serverName: "Seedbox",
  remote: "/books/Dracula.epub",
  name: "Dracula.epub",
  size: 2_000_000,
  bytesDone: 0,
  state: "waiting",
  error: null,
  startedAt: null,
  finishedAt: null,
  ...over,
});

describe("server rows", () => {
  it("say how long a download took", () => {
    expect(took("2026-10-21T10:00:00Z", "2026-10-21T10:00:45Z")).toBe("45 s");
    expect(took("2026-10-21T10:00:00Z", "2026-10-21T10:03:20Z")).toBe("3 min 20 s");
    expect(took("2026-10-21T10:00:00Z", "2026-10-21T11:05:00Z")).toBe("1 h 5 min");
    expect(took(null, "2026-10-21T11:05:00Z")).toBeNull();
  });

  it("say where each file is", () => {
    expect(rowText(file({})).tone).toBe("wait");
    expect(rowText(file({ state: "downloading", bytesDone: 1_000_000 })).text).toMatch(/^Downloading/);
    const done = rowText(file({ state: "done", startedAt: "2026-10-21T10:00:00Z", finishedAt: "2026-10-21T10:01:00Z" }));
    expect(done.text).toMatch(/Downloaded in 1 min/);
    expect(rowText(file({ state: "failed", error: "The connection was lost." }))).toEqual({ text: "The connection was lost.", tone: "bad" });
  });
});

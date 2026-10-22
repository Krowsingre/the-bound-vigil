import { describe, expect, it } from "vitest";
import type { SentFile } from "../api/types";
import { sentText } from "./LocalSendRows";

const file = (change: Partial<SentFile>): SentFile => ({
  session: "s",
  id: "a",
  from: "Wren's iPhone",
  name: "Dracula.epub",
  size: 2 * 1024 * 1024,
  bytes: 0,
  state: "waiting",
  reason: null,
  ...change,
});

describe("LocalSend rows", () => {
  it("say where each file has got to, and why one failed or wasn't taken", () => {
    expect(sentText(file({})).tone).toBe("wait");
    expect(sentText(file({ state: "arriving", bytes: 1024 * 1024 })).text).toMatch(/^Arriving 1(\.0)? MB of 2(\.0)? MB$/);
    expect(sentText(file({ state: "arrived", bytes: 2 * 1024 * 1024 })).text).toContain("added to the import queue");
    const failed = sentText(file({ state: "failed", reason: "The connection dropped after 1.0 MB of 2.0 MB" }));
    expect(failed).toEqual({ text: "The connection dropped after 1.0 MB of 2.0 MB. Send it again from Wren's iPhone.", tone: "bad" });
    expect(sentText(file({ state: "skipped", reason: "TBV doesn't take .cbr files" })).text).toBe("Not taken: TBV doesn't take .cbr files");
  });
});

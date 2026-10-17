import { describe, expect, it } from "vitest";
import { MOVE_DESKTOP_ONLY, moveStub } from "../api/moveStub";
import { placeName } from "./MoveSection";

describe("moving a library", () => {
  it("names each service the way a sentence needs", () => {
    const view = (kind: "supabase" | "folder" | "webdav" | "off", service: string | null = null) => ({
      kind,
      service,
      location: null,
      username: null,
    });
    expect(placeName(view("supabase"))).toBe("Supabase");
    expect(placeName(view("folder", "gdrive"))).toBe("Google Drive");
    expect(placeName(view("folder", "custom"))).toBe("that folder");
    expect(placeName(view("webdav"))).toBe("your WebDAV server");
    expect(placeName(null)).toBe("nowhere yet");
  });

  it("says it needs the desktop app outside it", async () => {
    const stub = moveStub();
    expect((await stub.moveStatus()).running).toBe(false);
    await expect(stub.startMove("migrate", "all", { kind: "supabase" })).rejects.toThrow(MOVE_DESKTOP_ONLY);
  });
});

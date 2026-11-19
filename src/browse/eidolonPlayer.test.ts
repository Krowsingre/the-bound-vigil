import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { PageVideo } from "../api/types";
import { eidolonMedia, eidolonNow, endEidolon, go, leave, setLoop, showIn, startEidolon } from "./eidolonPlayer";

const video = (n: number): PageVideo => ({ src: `tbvvideo://v${n}.mp4`, kind: "file", title: `Video ${n}`, page: "https://example.com/", time: 0 });

describe("Eidolon's player", () => {
  beforeAll(() => {
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
  });
  afterEach(() => endEidolon());

  it("starts at the page's chosen video and steps through the rest", () => {
    startEidolon({ ...video(2), queue: [video(1), video(2), video(3)], at: 1 }, "video");
    expect(eidolonNow()?.at).toBe(1);
    expect(eidolonMedia().getAttribute("src")).toBe("tbvvideo://v2.mp4");
    go(2);
    expect(eidolonMedia().getAttribute("src")).toBe("tbvvideo://v3.mp4");
  });

  it("Loop All goes back to the first after the last; Loop One plays it again", () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    startEidolon({ ...video(1), queue: [video(1), video(2)], at: 1 }, "audio");
    setLoop("all");
    eidolonMedia().dispatchEvent(new Event("ended"));
    expect(eidolonNow()?.at).toBe(0);
    setLoop("one");
    eidolonMedia().dispatchEvent(new Event("ended"));
    expect(eidolonNow()?.at).toBe(0);
  });

  it("goes on playing out of sight when Eidolon closes, and stops when ended", () => {
    const place = document.createElement("div");
    document.body.append(place);
    startEidolon(video(1), "audio");
    showIn(place);
    Object.defineProperty(eidolonMedia(), "paused", { configurable: true, get: () => false });
    leave(true);
    expect(eidolonMedia().parentElement?.id).toBe("eidolon-waiting");
    expect(eidolonNow()).not.toBeNull();
    endEidolon();
    expect(eidolonNow()).toBeNull();
  });
});

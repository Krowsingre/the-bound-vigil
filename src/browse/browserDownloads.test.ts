// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import type { BrowserEvent } from "../api/types";

const native = vi.hoisted(() => ({
  browserDownloadStatus: vi.fn(),
  onBrowserEvent: vi.fn((_receive: (event: BrowserEvent) => void) => () => undefined),
  browserDownloadKind: vi.fn(async () => "ebook"),
}));
vi.mock("../api", () => ({ api: native }));

afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
  localStorage.clear();
});

it("keeps a restored native transfer active and recovers a missed completion", async () => {
  vi.useFakeTimers();
  vi.resetModules();
  const saved = { id: "active", name: "Fixture.epub", state: "coming", at: 1 };
  localStorage.setItem("tbv.browser.downloads", JSON.stringify([saved]));
  native.browserDownloadStatus.mockResolvedValueOnce({ active: [saved.id], finished: [] }).mockResolvedValueOnce({
    active: [],
    finished: [{ kind: "download", id: saved.id, name: saved.name, tab: "a", ok: true, path: "/test/Fixture.epub" }],
  });
  const { listenForDownloads, setDownloads, isActiveDownload } = await import("./browserDownloads");
  const stop = listenForDownloads(vi.fn());
  try {
    await vi.advanceTimersByTimeAsync(0);
    setDownloads((rows) => {
      expect(rows[0].state).toBe("coming");
      expect(isActiveDownload(rows[0])).toBe(true);
      return rows;
    });
    await vi.advanceTimersByTimeAsync(2_000);
    setDownloads((rows) => {
      expect(rows[0]).toMatchObject({ state: "done", media: "ebook", asking: true });
      return rows;
    });
    expect(native.browserDownloadKind).toHaveBeenCalledTimes(1);
  } finally {
    stop();
  }
});

it("requires two successful absent checks before offering Retry", async () => {
  vi.useFakeTimers();
  vi.resetModules();
  localStorage.setItem("tbv.browser.downloads", JSON.stringify([{ id: "lost", name: "Fixture.epub", state: "coming", at: 1 }]));
  native.browserDownloadStatus.mockResolvedValue({ active: [], finished: [] });
  const { listenForDownloads, setDownloads } = await import("./browserDownloads");
  const stop = listenForDownloads(vi.fn());
  try {
    await vi.advanceTimersByTimeAsync(0);
    setDownloads((rows) => {
      expect(rows[0].state).toBe("coming");
      return rows;
    });
    await vi.advanceTimersByTimeAsync(2_000);
    setDownloads((rows) => {
      expect(rows[0]).toMatchObject({ state: "failed", error: "The transfer is no longer running." });
      return rows;
    });
  } finally {
    stop();
  }
});

it("keeps the initiating page and the import action after the tab navigates", async () => {
  vi.resetModules();
  native.browserDownloadKind.mockResolvedValue("ebook");
  native.browserDownloadStatus.mockResolvedValue({ active: [], finished: [] });
  const { listenForDownloads, rememberDownloadSource, setDownloads } = await import("./browserDownloads");
  const stop = listenForDownloads(vi.fn());
  try {
    const receive = native.onBrowserEvent.mock.calls[0][0];
    rememberDownloadSource("a", "https://example.org/title");
    receive({ kind: "downloadStart", tab: "a", id: "one", name: "Book.epub", url: "https://files.example.org/temporary-token" });
    rememberDownloadSource("a", "https://example.org/other");
    receive({ kind: "download", tab: "a", id: "one", name: "Book.epub", ok: true, path: "/test/Book.epub" });
    await vi.waitFor(() => {
      setDownloads((rows) => {
        expect(rows[0]).toMatchObject({ sourceUrl: "https://example.org/title", state: "done", media: "ebook", asking: true });
        return rows;
      });
    });
  } finally {
    stop();
  }
});

it("resumes checking a completed file after restart and keeps it available to import", async () => {
  vi.resetModules();
  native.browserDownloadKind.mockResolvedValue("audio");
  localStorage.setItem("tbv.browser.downloads", JSON.stringify([
    { id: "one", name: "Book.m4b", state: "checking", path: "/test/Book.m4b", at: 1 },
  ]));
  const { listenForDownloads, setDownloads } = await import("./browserDownloads");
  const stop = listenForDownloads(vi.fn());
  try {
    await vi.waitFor(() => {
      setDownloads((rows) => {
        expect(rows[0]).toMatchObject({ state: "done", media: "audio", asking: true });
        return rows;
      });
    });
  } finally {
    stop();
  }
});

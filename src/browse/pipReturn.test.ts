// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ browserRead: vi.fn() }));
vi.mock("../api", () => ({ api: native }));

afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
  localStorage.clear();
});

async function watching(states: { out: boolean; playing: boolean }[]) {
  vi.useFakeTimers();
  vi.resetModules();
  for (const state of states) native.browserRead.mockResolvedValueOnce(state);
  const pip = await import("./pipReturn");
  const asked = vi.fn();
  window.addEventListener(pip.PIP_RETURN, (e) => asked((e as CustomEvent<string>).detail));
  return { pip, asked };
}

it("goes back to the tab when a popped-out video is brought back to full size", async () => {
  const { pip, asked } = await watching([{ out: true, playing: true }, { out: false, playing: true }, { out: false, playing: true }]);
  await pip.checkForPip("tab-1");
  expect(pip.watchedTabs()).toEqual(["tab-1"]);
  await vi.advanceTimersByTimeAsync(1000);
  await vi.advanceTimersByTimeAsync(600);
  expect(asked).toHaveBeenCalledWith("tab-1");
  expect(pip.watchedTabs()).toEqual([]);
});

it("stays put when the floating video is closed instead", async () => {
  const { pip, asked } = await watching([{ out: false, playing: true }, { out: false, playing: false }]);
  pip.notePopped("tab-1");
  await vi.advanceTimersByTimeAsync(1600);
  expect(asked).not.toHaveBeenCalled();
  expect(pip.watchedTabs()).toEqual([]);
});

it("stays put when Attune says so, or the tab was closed", async () => {
  localStorage.setItem("tbv.browser.prefs", JSON.stringify({ pipReturn: false }));
  const { pip, asked } = await watching([{ out: false, playing: true }, { out: false, playing: true }]);
  pip.notePopped("tab-1");
  await vi.advanceTimersByTimeAsync(1600);
  expect(asked).not.toHaveBeenCalled();

  localStorage.clear();
  native.browserRead.mockResolvedValueOnce({ out: false, playing: true }).mockResolvedValueOnce({ out: false, playing: true });
  pip.whenStillOpen(() => false);
  pip.notePopped("tab-2");
  await vi.advanceTimersByTimeAsync(1600);
  expect(asked).not.toHaveBeenCalled();
});

it("leaves a tab with nothing popped out alone", async () => {
  const { pip } = await watching([{ out: false, playing: true }]);
  await pip.checkForPip("tab-1");
  expect(pip.watchedTabs()).toEqual([]);
});

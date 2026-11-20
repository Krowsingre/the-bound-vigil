import { SETTLE, settle } from "./settle";

test("the splash settles away, then is gone", async () => {
  vi.useFakeTimers();
  const splash = document.createElement("div");
  splash.className = "splash";
  document.body.appendChild(splash);
  const gone = settle(splash);
  expect(splash.classList.contains("is-settling")).toBe(true);
  expect(document.body.contains(splash)).toBe(true);
  vi.advanceTimersByTime(SETTLE + 60);
  await gone;
  expect(document.body.contains(splash)).toBe(false);
  vi.useRealTimers();
});

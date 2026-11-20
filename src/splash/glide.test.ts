import { afterEach, expect, test, vi } from "vitest";
import { flip, glide, GLIDE } from "./glide";

afterEach(() => vi.useRealTimers());

test("the glide moves from one middle to the other", () => {
  const move = flip({ left: 100, top: 200, width: 64, height: 64 }, { left: 20, top: 30, width: 40, height: 40 }, 0.625);
  expect(move).toEqual({ dx: -92, dy: -182, scale: 0.625 });
});

test("the copy takes over from the card, then is gone", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "requestAnimationFrame"] });
  const handOver = vi.fn(async () => undefined);
  const done = glide({ left: 10, top: 20, width: 420, height: 630, painting: null }, "Loading…", handOver);
  await vi.advanceTimersByTimeAsync(400);
  expect(handOver).toHaveBeenCalledOnce();
  const copy = document.querySelector<HTMLElement>(".splash.is-copy")!;
  expect(copy.style.left).toBe("10px");
  expect(document.querySelector(".splash-glide .splash-title")?.textContent).toBe("The Bound Vigil");
  await vi.advanceTimersByTimeAsync(GLIDE + 100);
  await done;
  expect(document.querySelector(".splash")).toBeNull();
  expect(document.querySelector(".splash-glide")).toBeNull();
});

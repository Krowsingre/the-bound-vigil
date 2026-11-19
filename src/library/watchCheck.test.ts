// @vitest-environment jsdom
import { expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ watchAuthorBooks: vi.fn(async () => []), watchFindBook: vi.fn(async () => null) }));
vi.mock("../api", () => ({ api: native }));

it("an empty check doesn't stop later ones", async () => {
  localStorage.clear();
  const { checkWatched, watchAuthor } = await import("./watchList");
  await checkWatched();
  watchAuthor("A. Writer");
  await checkWatched();
  expect(native.watchAuthorBooks).toHaveBeenCalledWith("A. Writer");
});

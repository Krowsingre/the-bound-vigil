import { expect, test } from "vitest";
import { gapsIn, titleKey } from "./FindAlike";

test("titles compare with an online list without subtitle, case or leading article", () => {
  expect(titleKey("The Hound of the Baskervilles: A Sherlock Holmes Novel")).toBe(titleKey("Hound of the Baskervilles"));
  expect(titleKey("Épopée (Book 1)")).toBe("épopée");
});

test("gaps are the whole numbers missing below the highest", () => {
  expect(gapsIn([1, 2, 5])).toEqual([3, 4]);
  expect(gapsIn([2.5, 3])).toEqual([1]);
  expect(gapsIn([NaN])).toEqual([]);
});

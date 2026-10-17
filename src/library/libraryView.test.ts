import { pageItems } from "./libraryView";

test("short page lists show every page", () => {
  expect(pageItems(0, 1)).toEqual([0]);
  expect(pageItems(3, 7)).toEqual([0, 1, 2, 3, 4, 5, 6]);
});

test("long page lists keep the ends and the neighbours, with gaps", () => {
  expect(pageItems(0, 12)).toEqual([0, 1, 2, 3, null, 11]);
  expect(pageItems(5, 12)).toEqual([0, null, 4, 5, 6, null, 11]);
  expect(pageItems(11, 12)).toEqual([0, null, 8, 9, 10, 11]);
});

import { renderHook } from "@testing-library/react";
import { expect, test } from "vitest";
import { rowPick, useRangePick } from "./rangePick";

test("shift-click picks everything between the last click and this one", () => {
  const { result } = renderHook(() => useRangePick());
  const order = ["a", "b", "c", "d", "e"];
  let chosen = result.current(new Set(), order, "b", false);
  expect([...chosen]).toEqual(["b"]);
  chosen = result.current(chosen, order, "e", true);
  expect([...chosen].sort()).toEqual(["b", "c", "d", "e"]);
  // Backwards works too, and a plain click still flips one.
  chosen = result.current(chosen, order, "a", true);
  expect([...chosen].sort()).toEqual(["a", "b", "c", "d", "e"]);
  chosen = result.current(chosen, order, "c", false);
  expect([...chosen].sort()).toEqual(["a", "b", "d", "e"]);
});

test("a row picks on a click anywhere but its controls", () => {
  const picks: boolean[] = [];
  const row = rowPick((shift) => picks.push(shift));
  const li = document.createElement("li");
  li.innerHTML = "<span>Title</span><button>More</button>";
  row.onClick({ target: li.querySelector("span"), shiftKey: true });
  row.onClick({ target: li.querySelector("button"), shiftKey: false });
  expect(picks).toEqual([true]);
});

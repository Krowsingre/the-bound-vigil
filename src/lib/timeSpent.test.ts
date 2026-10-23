import { expect, test } from "vitest";
import { finishedSince, periodStart, spentSince, spentText, totals } from "./timeSpent";

test("time reads in the largest unit that fits", () => {
  expect(spentText(35 * 60)).toBe("35 min");
  expect(spentText(4.5 * 3600)).toBe("4.5 hours");
  expect(spentText(3600)).toBe("1 hour");
  expect(spentText(50 * 3600)).toBe("2.1 days");
  expect(spentText(21 * 86400)).toBe("3 weeks");
  expect(spentText(400 * 86400)).toBe("1.1 years");
});

test("totals add every day, and the week runs Monday to Sunday", () => {
  // Wednesday 21 October 2026.
  const t = totals(
    [
      { day: "2026-10-12", read: 100, listen: 0 },
      { day: "2026-10-19", read: 60, listen: 30 },
      { day: "2026-10-21", read: 0, listen: 90 },
    ],
    new Date(2026, 9, 21, 15),
  );
  expect(t.read).toBe(160);
  expect(t.listen).toBe(120);
  expect(t.week[0]).toEqual({ read: 60, listen: 30 });
  expect(t.week[2]).toEqual({ read: 0, listen: 90 });
  expect(t.week[6]).toEqual({ read: 0, listen: 0 });
});

test("activity counts from the start of the chosen period", () => {
  // Wednesday 21 October 2026.
  const today = new Date(2026, 9, 21, 15);
  expect(periodStart("week", today)).toBe("2026-10-19");
  expect(periodStart("month", today)).toBe("2026-10-01");
  expect(periodStart("year", today)).toBe("2026-01-01");
  expect(periodStart("all", today)).toBeNull();
  const days = [
    { day: "2026-09-30", read: 100, listen: 0 },
    { day: "2026-10-02", read: 50, listen: 10 },
    { day: "2026-10-20", read: 20, listen: 5 },
  ];
  expect(spentSince(days, "2026-10-19")).toEqual({ read: 20, listen: 5 });
  expect(spentSince(days, null)).toEqual({ read: 170, listen: 15 });
  const finished = [new Date(2026, 9, 20, 9).toISOString(), new Date(2026, 9, 2, 9).toISOString(), "not a date"];
  expect(finishedSince(finished, "2026-10-19")).toBe(1);
  expect(finishedSince(finished, "2026-10-01")).toBe(2);
});

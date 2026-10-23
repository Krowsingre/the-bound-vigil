// Time spent reading and listening: recorded while it happens, added up per
// day (the device's own date) and shown in the largest unit that reads well.

import type { TimeSpent } from "../api/types";

/** This device's date, `YYYY-MM-DD`. */
export function dayOf(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const YEAR = 365.25 * DAY;

/** The amount and its unit: [35, "min"], [4.5, "hours"], [2.1, "days"], [3, "weeks"], [1.2, "years"]. */
export function spentParts(seconds: number): [number, string] {
  if (seconds < HOUR) return [Math.round(seconds / MINUTE), "min"];
  const [amount, unit] =
    seconds < DAY ? [seconds / HOUR, "hour"] : seconds < WEEK ? [seconds / DAY, "day"] : seconds < YEAR ? [seconds / WEEK, "week"] : [seconds / YEAR, "year"];
  const shown = amount < 10 ? Math.round(amount * 10) / 10 : Math.round(amount);
  return [shown, `${unit}${shown === 1 ? "" : "s"}`];
}

/** "35 min", "4.5 hours", "2.1 days", "3 weeks", "1.2 years". */
export function spentText(seconds: number): string {
  const [amount, unit] = spentParts(seconds);
  return `${amount.toLocaleString()} ${unit}`;
}

export interface TimeTotals {
  read: number;
  listen: number;
  /** Monday first, this week, seconds read and listened together. */
  week: { read: number; listen: number }[];
  /** Every day with time on it, oldest first. */
  days: TimeSpent[];
}

export type Period = "week" | "month" | "year" | "all";

export const PERIODS: { value: Period; label: string }[] = [
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
  { value: "year", label: "This year" },
  { value: "all", label: "All time" },
];

/** The first day of the period (`YYYY-MM-DD`, weeks starting Monday), or null for all time. */
export function periodStart(period: Period, today = new Date()): string | null {
  const [y, m, d] = [today.getFullYear(), today.getMonth(), today.getDate()];
  if (period === "week") return dayOf(new Date(y, m, d - ((today.getDay() + 6) % 7)));
  if (period === "month") return dayOf(new Date(y, m, 1));
  if (period === "year") return dayOf(new Date(y, 0, 1));
  return null;
}

/** Seconds read and listened from `start` (a day) on; everything when it's null. */
export function spentSince(days: TimeSpent[], start: string | null): { read: number; listen: number } {
  const counted = start ? days.filter((d) => d.day >= start) : days;
  return { read: counted.reduce((sum, d) => sum + d.read, 0), listen: counted.reduce((sum, d) => sum + d.listen, 0) };
}

/** How many of these finishing times (UTC) fall on or after `start`, by this device's date. */
export function finishedSince(times: string[], start: string): number {
  return times.filter((t) => {
    const date = new Date(t);
    return !Number.isNaN(date.getTime()) && dayOf(date) >= start;
  }).length;
}

export function totals(days: TimeSpent[], today = new Date()): TimeTotals {
  const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - ((today.getDay() + 6) % 7));
  const weekDays = Array.from({ length: 7 }, (_, i) => dayOf(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i)));
  const byDay = new Map(days.map((d) => [d.day, d]));
  return {
    read: days.reduce((sum, d) => sum + d.read, 0),
    listen: days.reduce((sum, d) => sum + d.listen, 0),
    week: weekDays.map((day) => ({ read: byDay.get(day)?.read ?? 0, listen: byDay.get(day)?.listen ?? 0 })),
    days,
  };
}

/** Sample time for the preview: a few weeks of evenings. */
export function sampleTime(today = new Date()): TimeSpent[] {
  return Array.from({ length: 40 }, (_, i) => {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    return { day: dayOf(date), read: ((i * 7919) % 50) * 60 + 600, listen: i % 3 === 0 ? 0 : ((i * 104729) % 70) * 60 };
  });
}

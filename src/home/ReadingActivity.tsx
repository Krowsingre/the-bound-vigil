import type { ReactNode } from "react";
import { spentParts, spentText } from "../lib/timeSpent";
import { Section } from "./Section";
import { useTimeSpent } from "./useTimeSpent";

const DAYS = ["M", "T", "W", "T", "F", "S", "S"];

/** Books finished, and time spent reading and listening in TBV on every device, with this week by day. */
export function ReadingActivity({ finished, refreshKey }: { finished: number; refreshKey?: number }) {
  const spent = useTimeSpent(refreshKey);
  const week = spent?.week ?? DAYS.map(() => ({ read: 0, listen: 0 }));
  const max = Math.max(1, ...week.map((d) => d.read + d.listen));
  const any = !!spent && spent.read + spent.listen > 0;
  return (
    <Section title="Reading activity" className="activity">
      <div className="stats stats-3">
        <Stat value={finished} label="Books finished" />
        <Stat value={spent ? <Spent seconds={spent.read} /> : "—"} label="Time read" />
        <Stat value={spent ? <Spent seconds={spent.listen} /> : "—"} label="Time listened" />
      </div>
      {spent && !any && <p className="empty-note">Time spent reading and listening adds up here as you use TBV.</p>}
      <div className="week" role="img" aria-label={weekLabel(week)}>
        {week.map((d, i) => (
          <div key={i} className="week-day">
            <span className="week-bar" style={{ height: `${Math.max(6, ((d.read + d.listen) / max) * 100)}%` }} data-active={d.read + d.listen > 0 || undefined}>
              {d.listen > 0 && <span className="week-listen" style={{ height: `${(d.listen / (d.read + d.listen)) * 100}%` }} />}
            </span>
            <span className="week-label">{DAYS[i]}</span>
          </div>
        ))}
      </div>
    </Section>
  );
}

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function weekLabel(week: { read: number; listen: number }[]): string {
  const days = week
    .map((d, i) => (d.read + d.listen > 0 ? `${DAY_NAMES[i]}: ${spentText(d.read)} read, ${spentText(d.listen)} listened` : null))
    .filter(Boolean);
  return days.length ? `This week. ${days.join("; ")}.` : "No reading or listening this week yet";
}

/** "23 hours", with the unit smaller so it fits beside the number. */
export function Spent({ seconds }: { seconds: number }) {
  const [amount, unit] = spentParts(seconds);
  return (
    <>
      {amount.toLocaleString()}
      <span className="stat-unit"> {unit}</span>
    </>
  );
}

export function Stat({ value, label }: { value: ReactNode; label: string }) {
  return (
    <div className="stat">
      <span className="stat-value">{typeof value === "number" ? value.toLocaleString() : value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

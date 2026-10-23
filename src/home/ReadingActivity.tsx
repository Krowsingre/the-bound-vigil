import { useState, type ReactNode } from "react";
import { Icon, type IconName } from "../components/Icon";
import { finishedSince, periodStart, PERIODS, spentParts, spentSince, type Period } from "../lib/timeSpent";
import { Section } from "./Section";
import { useTimeSpent } from "./useTimeSpent";

const PERIOD_KEY = "tbv.home.activityPeriod";

function readPeriod(): Period {
  try {
    const saved = localStorage.getItem(PERIOD_KEY);
    return PERIODS.some((p) => p.value === saved) ? (saved as Period) : "week";
  } catch {
    return "week";
  }
}

/** Books finished, and time spent reading and listening in TBV on every device, over a chosen period. */
export function ReadingActivity({ finished, finishedDates, refreshKey }: { finished: number; finishedDates?: string[]; refreshKey?: number }) {
  const spent = useTimeSpent(refreshKey);
  const [period, setPeriod] = useState(readPeriod);
  const start = periodStart(period);
  const inPeriod = spent ? spentSince(spent.days, start) : null;
  const finishedInPeriod = start && finishedDates ? finishedSince(finishedDates, start) : finished;
  const any = !!spent && spent.read + spent.listen > 0;
  const choose = (next: Period) => {
    setPeriod(next);
    try {
      localStorage.setItem(PERIOD_KEY, next);
    } catch {
      // Remembered until TBV closes.
    }
  };
  return (
    <Section
      title="Reading activity"
      className="activity"
      action={
        <select className="activity-period" aria-label="Period" value={period} onChange={(e) => choose(e.target.value as Period)}>
          {PERIODS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      }
    >
      <div className="stats stats-3">
        <Stat value={finishedInPeriod} label="Books finished" />
        <Stat value={inPeriod ? <Spent seconds={inPeriod.read} /> : "—"} label="Time read" />
        <Stat value={inPeriod ? <Spent seconds={inPeriod.listen} /> : "—"} label="Time listened" />
      </div>
      {spent && !any && <p className="empty-note">Time spent reading and listening adds up here as you use TBV.</p>}
    </Section>
  );
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

export function Stat({ value, label, icon }: { value: ReactNode; label: string; icon?: IconName }) {
  return (
    <div className={`stat${icon ? " has-icon" : ""}`}>
      {icon && <Icon name={icon} size={18} className="stat-icon" />}
      <span className="stat-value">{typeof value === "number" ? value.toLocaleString() : value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

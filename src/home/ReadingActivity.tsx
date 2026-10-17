import type { ReadingActivity as Activity } from "../api/types";
import { Section } from "./Section";

const DAYS = ["M", "T", "W", "T", "F", "S", "S"];

/** Shows only measured reading. Until the reader records sessions, it says so plainly. */
export function ReadingActivity({ activity }: { activity: Activity | null }) {
  const weekly = activity?.weeklySeconds ?? [0, 0, 0, 0, 0, 0, 0];
  const max = Math.max(1, ...weekly);
  return (
    <Section title="Reading activity" className="activity">
      {activity ? (
        <div className="stats stats-3">
          <Stat value={activity.completedBooks} label="Books finished" />
          <Stat value={activity.pagesRead ?? "—"} label="Pages read" />
          <Stat value={Math.round(activity.secondsRead / 3600)} label="Hours read" />
        </div>
      ) : (
        <p className="empty-note">Time spent reading will appear here once you read a book in TBV.</p>
      )}
      <div className="week" role="img" aria-label={activity ? "Reading time this week, Monday to Sunday" : "No reading recorded this week"}>
        {weekly.map((s, i) => (
          <div key={i} className="week-day">
            <span className="week-bar" style={{ height: `${Math.max(6, (s / max) * 100)}%` }} data-active={s > 0 || undefined} />
            <span className="week-label">{DAYS[i]}</span>
          </div>
        ))}
      </div>
    </Section>
  );
}

export function Stat({ value, label }: { value: number | string; label: string }) {
  return (
    <div className="stat">
      <span className="stat-value">{typeof value === "number" ? value.toLocaleString() : value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

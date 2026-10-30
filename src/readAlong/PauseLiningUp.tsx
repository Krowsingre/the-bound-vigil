// Pausing lining up: until carried on, or for a while (an hour, five, ten, a
// day, or a time of your own). The pause outlasts closing or updating TBV.

import { useEffect, useState } from "react";
import { Icon } from "../components/Icon";
import { Menu } from "../components/Menu";
import { liningUpPaused, liningUpPausedUntil, onPauseChange, pauseLiningUp, resumeLiningUp } from "./lineUp";

/** "until 6:30 pm", or with the day when it's not today. */
export function pausedUntilText(until: number | null): string {
  if (!until) return "until you carry on";
  const end = new Date(until);
  const time = end.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const sameDay = end.toDateString() === new Date().toDateString();
  return sameDay ? `until ${time}` : `until ${end.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}, ${time}`;
}

/** The pause as it stands, kept up to date. */
export function usePause(): { paused: boolean; until: number | null } {
  const [state, setState] = useState(() => ({ paused: liningUpPaused(), until: liningUpPausedUntil() }));
  useEffect(() => onPauseChange(() => setState({ paused: liningUpPaused(), until: liningUpPausedUntil() })), []);
  return state;
}

/** Pause, with how long, or Carry on when paused. */
export function PauseLiningUpButton({ className = "btn btn-quiet", pauseLabel = "Pause", resumeLabel = "Carry on" }: { className?: string; pauseLabel?: string; resumeLabel?: string }) {
  const { paused } = usePause();
  const [asking, setAsking] = useState(false);
  const [hours, setHours] = useState("2");
  const [unit, setUnit] = useState<"hours" | "days">("hours");
  if (paused)
    return (
      <button type="button" className={className} onClick={resumeLiningUp}>
        <Icon name="play" size={16} /> {resumeLabel}
      </button>
    );
  return (
    <>
      <Menu
        label={pauseLabel}
        className={className}
        align="start"
        trigger={
          <>
            <Icon name="pause" size={16} /> {pauseLabel} <Icon name="chevronDown" size={14} />
          </>
        }
        items={[
          { label: "Until I carry on", onSelect: () => pauseLiningUp(null) },
          "divider",
          { label: "For 1 hour", onSelect: () => pauseLiningUp(1) },
          { label: "For 5 hours", onSelect: () => pauseLiningUp(5) },
          { label: "For 10 hours", onSelect: () => pauseLiningUp(10) },
          { label: "For 24 hours", onSelect: () => pauseLiningUp(24) },
          { label: "For a time of my own…", onSelect: () => setAsking(true) },
        ]}
      />
      {asking && (
        <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && setAsking(false)}>
          <form
            className="dialog pause-for"
            role="dialog"
            aria-label="Pause Confluence for"
            onSubmit={(e) => {
              e.preventDefault();
              const n = Number(hours);
              if (!(n > 0)) return;
              pauseLiningUp(unit === "days" ? n * 24 : n);
              setAsking(false);
            }}
            onKeyDown={(e) => e.key === "Escape" && setAsking(false)}
          >
            <h2>Pause Confluence for</h2>
            <div className="pause-for-row">
              <input type="number" min={0.25} step={0.25} max={unit === "days" ? 365 : 8760} value={hours} onChange={(e) => setHours(e.target.value)} autoFocus aria-label="How long" />
              <select value={unit} onChange={(e) => setUnit(e.target.value as "hours" | "days")} aria-label="Hours or days">
                <option value="hours">hours</option>
                <option value="days">days</option>
              </select>
            </div>
            <p className="muted">It carries on by itself after that, even if TBV was closed in between.</p>
            <div className="dialog-actions">
              <button type="button" className="btn btn-quiet" onClick={() => setAsking(false)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={!(Number(hours) > 0)}>
                Pause
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

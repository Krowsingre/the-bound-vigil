import { percent } from "../lib/format";

export function ProgressBar({ value, label }: { value: number | null; label?: string }) {
  const p = Math.min(1, Math.max(0, value ?? 0));
  return (
    <div
      className="progress"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(p * 100)}
      aria-label={label ?? `${percent(p)} read`}
    >
      <div className="progress-fill" style={{ width: `${p * 100}%` }} />
    </div>
  );
}

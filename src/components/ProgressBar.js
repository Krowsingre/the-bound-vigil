import { jsx as _jsx } from "react/jsx-runtime";
import { percent } from "../lib/format";
export function ProgressBar({ value, label }) {
    const p = Math.min(1, Math.max(0, value ?? 0));
    return (_jsx("div", { className: "progress", role: "progressbar", "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": Math.round(p * 100), "aria-label": label ?? `${percent(p)} read`, children: _jsx("div", { className: "progress-fill", style: { width: `${p * 100}%` } }) }));
}

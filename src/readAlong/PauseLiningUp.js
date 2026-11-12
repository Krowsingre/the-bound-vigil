import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
// Pausing lining up: until carried on, or for a while (an hour, five, ten, a
// day, or a time of your own). The pause outlasts closing or updating TBV.
import { useEffect, useState } from "react";
import { Icon } from "../components/Icon";
import { Menu } from "../components/Menu";
import { liningUpPaused, liningUpPausedUntil, onPauseChange, pauseLiningUp, resumeLiningUp } from "./lineUp";
/** "until 6:30 pm", or with the day when it's not today. */
export function pausedUntilText(until) {
    if (!until)
        return "until you carry on";
    const end = new Date(until);
    const time = end.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    const sameDay = end.toDateString() === new Date().toDateString();
    return sameDay ? `until ${time}` : `until ${end.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}, ${time}`;
}
/** The pause as it stands, kept up to date. */
export function usePause() {
    const [state, setState] = useState(() => ({ paused: liningUpPaused(), until: liningUpPausedUntil() }));
    useEffect(() => onPauseChange(() => setState({ paused: liningUpPaused(), until: liningUpPausedUntil() })), []);
    return state;
}
/** Pause, with how long, or Carry on when paused. */
export function PauseLiningUpButton({ className = "btn btn-quiet", pauseLabel = "Pause", resumeLabel = "Carry on" }) {
    const { paused } = usePause();
    const [asking, setAsking] = useState(false);
    const [hours, setHours] = useState("2");
    const [unit, setUnit] = useState("hours");
    if (paused)
        return (_jsxs("button", { type: "button", className: className, onClick: resumeLiningUp, children: [_jsx(Icon, { name: "play", size: 16 }), " ", resumeLabel] }));
    return (_jsxs(_Fragment, { children: [_jsx(Menu, { label: pauseLabel, className: className, align: "start", trigger: _jsxs(_Fragment, { children: [_jsx(Icon, { name: "pause", size: 16 }), " ", pauseLabel, " ", _jsx(Icon, { name: "chevronDown", size: 14 })] }), items: [
                    { label: "Until I carry on", onSelect: () => pauseLiningUp(null) },
                    "divider",
                    { label: "For 1 hour", onSelect: () => pauseLiningUp(1) },
                    { label: "For 5 hours", onSelect: () => pauseLiningUp(5) },
                    { label: "For 10 hours", onSelect: () => pauseLiningUp(10) },
                    { label: "For 24 hours", onSelect: () => pauseLiningUp(24) },
                    { label: "For a time of my own…", onSelect: () => setAsking(true) },
                ] }), asking && (_jsx("div", { className: "dialog-backdrop", onPointerDown: (e) => e.target === e.currentTarget && setAsking(false), children: _jsxs("form", { className: "dialog pause-for", role: "dialog", "aria-label": "Pause Confluence for", onSubmit: (e) => {
                        e.preventDefault();
                        const n = Number(hours);
                        if (!(n > 0))
                            return;
                        pauseLiningUp(unit === "days" ? n * 24 : n);
                        setAsking(false);
                    }, onKeyDown: (e) => e.key === "Escape" && setAsking(false), children: [_jsx("h2", { children: "Pause Confluence for" }), _jsxs("div", { className: "pause-for-row", children: [_jsx("input", { type: "number", min: 0.25, step: 0.25, max: unit === "days" ? 365 : 8760, value: hours, onChange: (e) => setHours(e.target.value), autoFocus: true, "aria-label": "How long" }), _jsxs("select", { value: unit, onChange: (e) => setUnit(e.target.value), "aria-label": "Hours or days", children: [_jsx("option", { value: "hours", children: "hours" }), _jsx("option", { value: "days", children: "days" })] })] }), _jsx("p", { className: "muted", children: "It carries on by itself after that, even if TBV was closed in between." }), _jsxs("div", { className: "dialog-actions", children: [_jsx("button", { type: "button", className: "btn btn-quiet", onClick: () => setAsking(false), children: "Cancel" }), _jsx("button", { type: "submit", className: "btn btn-primary", disabled: !(Number(hours) > 0), children: "Pause" })] })] }) }))] }));
}

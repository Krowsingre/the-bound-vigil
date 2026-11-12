import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState } from "react";
import { Icon } from "../components/Icon";
import { finishedSince, periodStart, PERIODS, spentParts, spentSince, spentText } from "../lib/timeSpent";
import { Section } from "./Section";
import { useTimeSpent } from "./useTimeSpent";
const PERIOD_KEY = "tbv.home.activityPeriod";
function readPeriod() {
    try {
        const saved = localStorage.getItem(PERIOD_KEY);
        return PERIODS.some((p) => p.value === saved) ? saved : "week";
    }
    catch {
        return "week";
    }
}
/** Books finished, and time spent reading and listening in TBV on every device, over a chosen period. */
export function ReadingActivity({ finished, finishedDates, refreshKey, wide = false, }) {
    const spent = useTimeSpent(refreshKey);
    const [period, setPeriod] = useState(readPeriod);
    const start = periodStart(period);
    const inPeriod = spent ? spentSince(spent.days, start) : null;
    const finishedInPeriod = start && finishedDates ? finishedSince(finishedDates, start) : finished;
    const any = !!spent && spent.read + spent.listen > 0;
    const choose = (next) => {
        setPeriod(next);
        try {
            localStorage.setItem(PERIOD_KEY, next);
        }
        catch {
            // Remembered until TBV closes.
        }
    };
    return (_jsxs(Section, { title: "Reading activity", className: "activity", action: _jsx("select", { className: "activity-period", "aria-label": "Period", value: period, onChange: (e) => choose(e.target.value), children: PERIODS.map((p) => (_jsx("option", { value: p.value, children: p.label }, p.value))) }), children: [_jsxs("div", { className: "stats stats-3", children: [_jsx(Stat, { value: finishedInPeriod, label: "Read", icon: wide ? "bookOpen" : undefined }), _jsx(Stat, { value: inPeriod ? _jsx(Spent, { seconds: inPeriod.read }) : "—", label: "Time read", icon: wide ? "clock" : undefined }), _jsx(Stat, { value: inPeriod ? _jsx(Spent, { seconds: inPeriod.listen }) : "—", label: "Time listened", icon: wide ? "headphones" : undefined })] }), wide && spent && period === "week" && _jsx(WeekBars, { week: spent.week }), spent && !any && _jsx("p", { className: "empty-note", children: "Time spent reading and listening adds up here as you use TBV." })] }));
}
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
/** Each day of this week as a bar: time read, with time listened on top in a lighter tone. */
function WeekBars({ week }) {
    const most = Math.max(1, ...week.map((d) => d.read + d.listen));
    const today = (new Date().getDay() + 6) % 7;
    return (_jsx("ol", { className: "week-bars", "aria-label": "This week, day by day", children: week.map((d, i) => {
            const said = `${DAYS[i]}: ${d.read ? `${spentText(d.read)} read` : "nothing read"}${d.listen ? `, ${spentText(d.listen)} listened` : ""}`;
            return (_jsxs("li", { className: [i === today && "is-today", d.read + d.listen === 0 && "is-empty"].filter(Boolean).join(" ") || undefined, title: said, "aria-label": said, children: [_jsxs("span", { className: "week-bar", "aria-hidden": true, children: [_jsx("span", { className: "week-listen", style: { height: `${(d.listen / most) * 100}%` } }), _jsx("span", { className: "week-read", style: { height: `${(d.read / most) * 100}%` } })] }), _jsx("span", { className: "week-day", "aria-hidden": true, children: DAYS[i] })] }, DAYS[i]));
        }) }));
}
/** "23 hours", with the unit smaller so it fits beside the number. */
export function Spent({ seconds }) {
    const [amount, unit] = spentParts(seconds);
    return (_jsxs(_Fragment, { children: [amount.toLocaleString(), _jsxs("span", { className: "stat-unit", children: [" ", unit] })] }));
}
export function Stat({ value, label, icon }) {
    return (_jsxs("div", { className: `stat${icon ? " has-icon" : ""}`, children: [icon && _jsx(Icon, { name: icon, size: 18, className: "stat-icon" }), _jsx("span", { className: "stat-value", children: typeof value === "number" ? value.toLocaleString() : value }), _jsx("span", { className: "stat-label", children: label })] }));
}

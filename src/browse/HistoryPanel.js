import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
// Discover's History, from its ••• menu: the pages visited and the words
// searched for, newest first by day, to look through, search, open again,
// and delete one at a time or by time.
import { useEffect, useMemo, useState } from "react";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Icon } from "../components/Icon";
import { Menu } from "../components/Menu";
import { clearHistory, dayLabel, onHistory, readHistory, removeFromHistory, trimHistory, trimmed } from "./browserHistory";
import { readBrowserPrefs, siteOf } from "./browserPrefs";
import { clearClosedTabs } from "./browserTabs";
/** How many rows show before "Show more". */
const AT_ONCE = 200;
const HOUR = 3_600_000;
/** Since local midnight, for "Today". */
function sinceMidnight(now = Date.now()) {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return now - start.getTime();
}
const CLEARS = [
    { label: "The last hour", since: () => HOUR },
    { label: "Today", since: () => sinceMidnight() },
    { label: "The last week", since: () => 7 * 24 * HOUR },
    { label: "Everything", since: () => null },
];
/** What's kept, never older than Preferences › Discover allows. */
const kept = () => trimmed(readHistory(), readBrowserPrefs().historyKeep);
export function HistoryPanel({ onGo, onClose }) {
    const [list, setList] = useState(kept);
    const [find, setFind] = useState("");
    const [showing, setShowing] = useState("all");
    const [where, setWhere] = useState("here");
    const [shown, setShown] = useState(AT_ONCE);
    const [clearing, setClearing] = useState(null);
    const [clearKind, setClearKind] = useState("all");
    useEffect(() => {
        trimHistory(readBrowserPrefs().historyKeep);
        return onHistory(() => setList(kept()));
    }, []);
    useEffect(() => setShown(AT_ONCE), [find, showing, where]);
    const elsewhere = list.some((e) => e.device);
    const matching = useMemo(() => {
        const q = find.trim().toLocaleLowerCase();
        const wanted = elsewhere ? where : "here";
        return list.filter((e) => (wanted === "here" ? !e.device : !!e.device)
            && (showing === "all" || e.kind === showing) && (!q || e.url.toLocaleLowerCase().includes(q) || (e.title ?? "").toLocaleLowerCase().includes(q)));
    }, [list, find, showing, where, elsewhere]);
    // Grouped by day, in order.
    const days = [];
    for (const e of matching.slice(0, shown)) {
        const label = dayLabel(e.at);
        if (days[days.length - 1]?.label !== label)
            days.push({ label, entries: [] });
        days[days.length - 1].entries.push(e);
    }
    const off = !readBrowserPrefs().historyOn;
    return (_jsxs("div", { className: "dialog-backdrop", onPointerDown: (e) => e.target === e.currentTarget && onClose(), children: [_jsxs("div", { className: "dialog browser-history", role: "dialog", "aria-label": "History", onKeyDown: (e) => e.key === "Escape" && onClose(), children: [_jsxs("header", { className: "catalogues-head", children: [_jsx("h2", { children: "History" }), _jsx(Menu, { label: "Clear history", className: "btn btn-quiet btn-small", align: "end", trigger: _jsxs(_Fragment, { children: ["Clear ", _jsx(Icon, { name: "chevronDown", size: 12 })] }), items: CLEARS.map((c) => ({ label: c.label, onSelect: () => { setClearKind(showing); setClearing(c); } })) }), _jsx("button", { type: "button", className: "icon-btn", "aria-label": "Close", onClick: onClose, children: _jsx(Icon, { name: "close", size: 18 }) })] }), _jsxs("label", { className: "search browser-history-find", children: [_jsx(Icon, { name: "search", size: 16 }), _jsx("input", { type: "search", placeholder: "Search history\u2026", "aria-label": "Search history", value: find, onChange: (e) => setFind(e.target.value) })] }), elsewhere && (_jsx("div", { className: "scribe-chips browser-history-kinds", role: "tablist", "aria-label": "Which devices", children: [
                            ["here", "This device"],
                            ["elsewhere", "Other devices"],
                        ].map(([value, label]) => (_jsxs("button", { type: "button", role: "tab", "aria-selected": where === value, className: `chip${where === value ? " is-active" : ""}`, onClick: () => setWhere(value), children: [_jsx(Icon, { name: value === "here" ? "computer" : "phone", size: 14 }), " ", label] }, value))) })), _jsx("div", { className: "scribe-chips browser-history-kinds", role: "tablist", "aria-label": "What to show", children: [
                            ["all", "All"],
                            ["page", "Pages"],
                            ["search", "Searches"],
                        ].map(([value, label]) => (_jsx("button", { type: "button", role: "tab", "aria-selected": showing === value, className: `chip${showing === value ? " is-active" : ""}`, onClick: () => setShowing(value), children: label }, value))) }), off && _jsx("p", { className: "muted", children: "History is off in Preferences \u203A Discover, so new pages aren't being kept." }), matching.length === 0 ? (_jsx("p", { className: "muted", children: list.length ? "Nothing in your history matches." : "Pages you visit in Discover show here." })) : (_jsxs("div", { className: "browser-history-list", children: [days.map((d) => (_jsxs("section", { children: [_jsx("h3", { children: d.label }), _jsx("ul", { className: "browser-download-list", children: d.entries.map((e) => (_jsxs("li", { children: [_jsxs("button", { type: "button", className: "browser-history-open", onClick: () => onGo(e.url), title: e.url, children: [_jsx(Icon, { name: e.kind === "search" ? "search" : "globe", size: 16 }), _jsxs("span", { className: "browser-download-name", children: [_jsx("b", { children: e.kind === "search" ? `“${e.title}”` : e.title?.trim() || siteOf(e.url) || e.url }), _jsxs("span", { className: "muted", children: [new Date(e.at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }), " \u00B7 ", e.kind === "search" ? "Searched" : siteOf(e.url) ?? e.url, e.device ? ` · on ${e.device}` : ""] })] })] }), _jsx("button", { type: "button", className: "icon-btn", "aria-label": `Delete ${e.title ?? e.url} from history`, onClick: () => removeFromHistory([e.id]), children: _jsx(Icon, { name: "close", size: 14 }) })] }, e.id))) })] }, d.label))), matching.length > shown && (_jsx("button", { type: "button", className: "btn btn-quiet", onClick: () => setShown((n) => n + AT_ONCE), children: "Show more" }))] }))] }), clearing && (_jsx(ConfirmDialog, { title: clearing.label === "Everything" ? "Clear all history?" : `Clear ${clearing.label.toLocaleLowerCase()}?`, body: _jsxs("label", { className: "field", children: [_jsx("span", { children: "Remove from Discover history" }), _jsxs("select", { value: clearKind, onChange: (e) => setClearKind(e.target.value), children: [_jsx("option", { value: "all", children: "Pages and searches" }), _jsx("option", { value: "page", children: "Visited pages" }), _jsx("option", { value: "search", children: "Searches" })] })] }), confirm: "Clear", danger: true, onCancel: () => setClearing(null), onConfirm: () => {
                    clearHistory(clearing.since(), Date.now(), clearKind === "all" ? undefined : clearKind);
                    // Recently closed tabs are history too.
                    if (clearKind !== "search")
                        clearClosedTabs(clearing.since());
                    setClearing(null);
                } }))] }));
}

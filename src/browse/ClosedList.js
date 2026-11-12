import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// Tabs closed lately, for the tab grid and the start page.
import { Icon } from "../components/Icon";
import { siteOf } from "./browserPrefs";
/** Newest first; each opens again where it was in the row. */
export function ClosedList({ closed, onReopen }) {
    return (_jsx("ul", { className: "browser-download-list browser-history-list", children: closed.map((c, i) => (_jsx("li", { children: _jsxs("button", { type: "button", className: "browser-history-open", onClick: () => onReopen(i), title: c.url, children: [_jsx(Icon, { name: "undo", size: 16 }), _jsxs("span", { className: "browser-download-name", children: [_jsx("b", { children: c.title?.trim() || siteOf(c.url) || c.url }), _jsx("span", { className: "muted", children: siteOf(c.url) ?? c.url })] })] }) }, `${c.closed}-${i}`))) }));
}

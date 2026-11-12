import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
import { Icon } from "../components/Icon";
import { pageItems } from "./libraryView";
export function Pagination({ page, pageSize, total, noun = ["book", "books"], top = false, onPage, }) {
    const count = Math.max(1, Math.ceil(total / pageSize));
    const first = total === 0 ? 0 : page * pageSize + 1;
    const last = Math.min(total, (page + 1) * pageSize);
    if (top && count <= 1)
        return null;
    return (_jsxs("div", { className: `pagination${top ? " pagination-top" : ""}`, children: [!top && (_jsxs("p", { className: "muted num", children: ["Showing ", first, "\u2013", last, " of ", total, " ", total === 1 ? noun[0] : noun[1]] })), count > 1 && (_jsxs("nav", { "aria-label": top ? "Pages (top)" : "Pages", className: "pages", children: [_jsx("button", { type: "button", className: "icon-btn", "aria-label": "Previous page", disabled: page === 0, onClick: () => onPage(page - 1), children: _jsx(Icon, { name: "chevronLeft" }) }), pageItems(page, count).map((p, i) => p === null ? (_jsx("span", { className: "page-gap", "aria-hidden": true, children: "\u2026" }, `gap-${i}`)) : (_jsx("button", { type: "button", className: `page${p === page ? " is-active" : ""}`, "aria-current": p === page ? "page" : undefined, "aria-label": `Page ${p + 1}`, onClick: () => onPage(p), children: p + 1 }, p))), _jsx("button", { type: "button", className: "icon-btn", "aria-label": "Next page", disabled: page >= count - 1, onClick: () => onPage(page + 1), children: _jsx(Icon, { name: "chevronRight" }) })] }))] }));
}

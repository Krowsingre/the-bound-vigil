import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export function Section({ title, onViewAll, action, className = "", children, }) {
    const id = `section-${title.toLowerCase().replace(/\W+/g, "-")}`;
    return (_jsxs("section", { className: `section ${className}`, "aria-labelledby": id, children: [_jsxs("div", { className: "section-head", children: [_jsx("h2", { id: id, className: "section-title", children: title }), action, onViewAll && (_jsxs("button", { type: "button", className: "view-all", onClick: onViewAll, children: ["View all ", _jsx("span", { "aria-hidden": true, children: "\u2192" })] }))] }), children] }));
}
export function EmptyNote({ children }) {
    return _jsx("p", { className: "empty-note", children: children });
}

import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef } from "react";
/** Asks before something that can't be taken back. */
export function ConfirmDialog({ title, body, confirm, cancel: cancelLabel = "Cancel", danger = false, confirmDisabled = false, onConfirm, onCancel, }) {
    const cancel = useRef(null);
    useEffect(() => cancel.current?.focus(), []);
    return (_jsx("div", { className: "dialog-backdrop", onPointerDown: (e) => e.target === e.currentTarget && onCancel(), children: _jsxs("div", { className: "dialog confirm-dialog", role: "alertdialog", "aria-label": title, onKeyDown: (e) => e.key === "Escape" && onCancel(), children: [_jsx("h2", { children: title }), typeof body === "string" ? _jsx("p", { className: "muted", children: body }) : body, _jsxs("div", { className: "dialog-actions", children: [_jsx("button", { ref: cancel, type: "button", className: "btn btn-quiet", onClick: onCancel, children: cancelLabel }), _jsx("button", { type: "button", className: `btn ${danger ? "btn-danger" : "btn-primary"}`, disabled: confirmDisabled, onClick: onConfirm, children: confirm })] })] }) }));
}

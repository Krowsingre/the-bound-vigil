import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// A small round ⓘ beside a field's label that shows a note: on hover with a
// mouse, on a tap or click anywhere, and from the keyboard (Enter or Space,
// Escape closes). It never blocks the field or asks for anything.
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
export function InfoTip({ label, title, children }) {
    const [open, setOpen] = useState(null);
    const [place, setPlace] = useState(null);
    const button = useRef(null);
    const panel = useRef(null);
    const leaving = useRef(null);
    const id = useId();
    useLayoutEffect(() => {
        if (!open || !button.current)
            return;
        const at = button.current.getBoundingClientRect();
        const width = Math.min(340, window.innerWidth - 32);
        const left = Math.max(16, Math.min(at.left - 12, window.innerWidth - width - 16));
        const below = at.bottom + 8;
        const height = panel.current?.offsetHeight ?? 260;
        const top = below + height > window.innerHeight - 16 ? Math.max(16, at.top - 8 - height) : below;
        setPlace({ top, left, width });
    }, [open]);
    useEffect(() => {
        if (open !== "pinned")
            return;
        const away = (e) => {
            if (!panel.current?.contains(e.target) && !button.current?.contains(e.target))
                setOpen(null);
        };
        const key = (e) => {
            if (e.key === "Escape") {
                e.stopPropagation();
                setOpen(null);
                button.current?.focus();
            }
        };
        document.addEventListener("pointerdown", away, true);
        document.addEventListener("keydown", key, true);
        return () => {
            document.removeEventListener("pointerdown", away, true);
            document.removeEventListener("keydown", key, true);
        };
    }, [open]);
    const stay = () => {
        if (leaving.current)
            window.clearTimeout(leaving.current);
        leaving.current = null;
    };
    const leave = () => {
        stay();
        leaving.current = window.setTimeout(() => setOpen((o) => (o === "hover" ? null : o)), 180);
    };
    return (_jsxs("span", { className: "info-tip", children: [_jsx("button", { ref: button, type: "button", className: "info-tip-button", "aria-label": label, "aria-expanded": !!open, "aria-controls": open ? id : undefined, onClick: (e) => {
                    e.preventDefault();
                    setOpen((o) => (o === "pinned" ? null : "pinned"));
                }, onPointerEnter: (e) => {
                    if (e.pointerType !== "mouse")
                        return;
                    stay();
                    setOpen((o) => o ?? "hover");
                }, onPointerLeave: (e) => e.pointerType === "mouse" && leave(), children: _jsx(Icon, { name: "info", size: 15 }) }), open && (_jsxs("div", { ref: panel, id: id, role: "dialog", "aria-label": title, className: "info-tip-panel", style: place ? { top: place.top, left: place.left, width: place.width } : { visibility: "hidden" }, onPointerEnter: stay, onPointerLeave: (e) => e.pointerType === "mouse" && leave(), onClick: (e) => e.stopPropagation(), children: [_jsx("strong", { className: "info-tip-title", children: title }), children] }))] }));
}

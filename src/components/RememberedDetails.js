import { jsx as _jsx } from "react/jsx-runtime";
import { useState } from "react";
export function useRememberedDisclosure(id, initiallyOpen = false) {
    const key = `tbv.disclosure.${id}`;
    const [open, setOpen] = useState(() => {
        try {
            const saved = localStorage.getItem(key);
            return saved === null ? initiallyOpen : saved === "1";
        }
        catch {
            return initiallyOpen;
        }
    });
    return [open, (next) => {
            setOpen(next);
            try {
                localStorage.setItem(key, next ? "1" : "0");
            }
            catch { /* Keep the current view. */ }
        }];
}
export function RememberedDetails({ disclosure, initiallyOpen, ...props }) {
    const [open, setOpen] = useRememberedDisclosure(disclosure, initiallyOpen);
    return _jsx("details", { ...props, open: open, onToggle: (event) => {
            if (event.currentTarget.open !== open)
                setOpen(event.currentTarget.open);
        } });
}

import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { createContext, useCallback, useContext, useRef, useState } from "react";
const ToastContext = createContext(() => { });
export function useToast() {
    return useContext(ToastContext);
}
export function ToastProvider({ children }) {
    const [toasts, setToasts] = useState([]);
    const next = useRef(1);
    const show = useCallback((text, action) => {
        const id = next.current++;
        setToasts((t) => [...t.slice(-2), { id, text, action }]);
        setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), action ? 12000 : 4500);
    }, []);
    return (_jsxs(ToastContext.Provider, { value: show, children: [children, _jsx("div", { className: "toasts", role: "status", "aria-live": "polite", children: toasts.map((t) => (_jsxs("div", { className: "toast", children: [t.text, t.action && _jsx("button", { type: "button", className: "toast-action", onClick: () => {
                                setToasts((items) => items.filter(({ id }) => id !== t.id));
                                t.action?.run();
                            }, children: t.action.label })] }, t.id))) })] }));
}

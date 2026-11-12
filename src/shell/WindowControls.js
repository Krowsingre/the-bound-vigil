import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { isAndroid, isApp, isHome, isIOS, isMac, isWeb } from "../api";
import { Icon } from "../components/Icon";
/** Real minimize / maximize / close buttons, since the window has no system title bar. */
export function WindowControls() {
    const [win, setWin] = useState(null);
    const [maximized, setMaximized] = useState(false);
    useEffect(() => {
        if (!isApp)
            return;
        let unlisten;
        void import("@tauri-apps/api/window").then(async ({ getCurrentWindow }) => {
            const w = getCurrentWindow();
            setWin(w);
            setMaximized(await w.isMaximized());
            unlisten = await w.onResized(async () => setMaximized(await w.isMaximized()));
        });
        return () => unlisten?.();
    }, []);
    // The native close handler hides the window and lets the page save before exit.
    const quit = () => {
        void import("@tauri-apps/api/window").then(({ getCurrentWindow }) => (win ?? getCurrentWindow()).close());
    };
    // A browser tab and the Mac have their own, and an iPhone app has no window to manage.
    if (isWeb || isHome || isIOS || isAndroid || isMac)
        return null;
    return (_jsxs("div", { className: "window-controls", children: [_jsx("button", { type: "button", "aria-label": "Minimize", title: "Minimize", onClick: () => void win?.minimize(), children: _jsx(Icon, { name: "minimize", size: 16 }) }), _jsx("button", { type: "button", "aria-label": maximized ? "Restore" : "Maximize", title: maximized ? "Restore" : "Maximize", onClick: () => void win?.toggleMaximize(), children: _jsx(Icon, { name: maximized ? "restore" : "maximize", size: 16 }) }), _jsx("button", { type: "button", className: "window-close", "aria-label": "Close", title: "Close", onClick: quit, children: _jsx(Icon, { name: "close", size: 16 }) })] }));
}

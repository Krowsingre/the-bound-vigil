import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { homeKey, pairHome } from "../api/homeCore";
/**
 * The phone version served by the computer at home: pairs the phone once
 * with the code TBV shows on the computer, then shows the app. A QR code
 * from the computer carries the code, so scanning it pairs at once.
 */
export function HomePair({ children }) {
    const fromLink = /[#&]pair=(\d{6})/.exec(location.hash)?.[1] ?? "";
    const [paired, setPaired] = useState(() => !!homeKey());
    const [code, setCode] = useState(fromLink);
    const [problem, setProblem] = useState(null);
    const [busy, setBusy] = useState(false);
    const pair = async (value) => {
        setBusy(true);
        setProblem(null);
        try {
            await pairHome(value);
            history.replaceState(null, "", location.pathname);
            // The app loads afresh with the key.
            location.reload();
            setPaired(true);
        }
        catch (e) {
            setProblem(e instanceof Error ? e.message : String(e));
        }
        finally {
            setBusy(false);
        }
    };
    useEffect(() => {
        if (!paired && fromLink)
            void pair(fromLink);
        // Only for the code the link brought.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    if (paired)
        return _jsx(_Fragment, { children: children });
    return (_jsx("div", { className: "web-connect", children: _jsxs("form", { className: "web-connect-card", onSubmit: (e) => {
                e.preventDefault();
                void pair(code);
            }, children: [_jsx("h1", { children: "The Bound Vigil" }), _jsx("p", { className: "muted", children: "Enter the code TBV shows on your computer, in Preferences \u203A Sync \u203A Stream to your phone at home. This phone only needs it once." }), _jsxs("label", { className: "field", children: [_jsx("span", { children: "Pairing code" }), _jsx("input", { inputMode: "numeric", autoComplete: "one-time-code", maxLength: 6, value: code, onChange: (e) => setCode(e.target.value.replace(/\D/g, "")), autoFocus: true })] }), problem && (_jsx("p", { className: "form-error", role: "alert", children: problem })), _jsx("button", { type: "submit", className: "btn btn-primary", disabled: busy || code.length !== 6, children: busy ? "Pairing…" : "Pair this phone" })] }) }));
}

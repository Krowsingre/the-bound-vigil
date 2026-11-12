import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// Preferences › Servers › LocalSend: TBV shows up in the LocalSend app on phones
// and computers on the same Wi-Fi, and asks before taking anything.
import { useEffect, useState } from "react";
import { api, isApp } from "../api";
import { Section, Toggle } from "./controls";
export function LocalSendSection() {
    const [status, setStatus] = useState(null);
    const [error, setError] = useState(null);
    useEffect(() => {
        api.localSendStatus().then(setStatus, () => undefined);
    }, []);
    const set = (on) => {
        setError(null);
        api.setLocalSend(on).then(setStatus, (e) => setError(String(e).replace(/^Error: /, "")));
    };
    return (_jsxs(Section, { id: "localsend", title: "Grimoire", lede: "Grimoire passes books, documents and audiobooks between your devices on the same Wi-Fi: TBV on another phone, iPad or computer, or the free LocalSend app on a device without TBV.", children: [_jsx(Toggle, { label: "Receive with Grimoire", hint: status?.running
                    ? `Other devices see this one as “${status.alias}”. You're asked before anything is taken, and only books, documents and audiobooks are.`
                    : "While this is on, other devices nearby can find this one and send to it.", checked: Boolean(status?.enabled), disabled: !isApp && status === null, onChange: set }), status?.enabled && !status.running && status.problem && _jsx("p", { className: "form-error", children: status.problem }), error && _jsx("p", { className: "form-error", children: error }), status?.running && (_jsx("p", { className: "settings-row-hint", children: "The first time, Windows may ask whether TBV can use your network. Allow it on private networks, or other devices won't find this one." }))] }));
}

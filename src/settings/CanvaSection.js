import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
// Preferences › Scribe › Canva: connect a Canva account to design covers,
// pictures and whole pages there (a Scribe Publisher feature, on computers). In Preferences › Scribe.
import { api, isApp, isIOS, openExternal } from "../api";
import { useState } from "react";
import { useCanvaStatus } from "../writing/CanvaLink";
import { useToast } from "../components/Toast";
import { usePublisher } from "../license/Publisher";
import { Row, Section } from "./controls";
/** Canva works on computers only for now. */
export const canvaHere = !isIOS && !(typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent));
export function CanvaSection() {
    const toast = useToast();
    const publisher = usePublisher();
    // Shared with the book's Canva buttons, so connecting here shows them there straight away.
    const [status, setStatus] = useCanvaStatus();
    const [busy, setBusy] = useState(false);
    if (!canvaHere)
        return null;
    const connect = async () => {
        if (!isApp && !import.meta.env.DEV)
            return toast("Connecting Canva works in the desktop app.");
        setBusy(true);
        try {
            const next = await api.canvaSignIn();
            setStatus(next);
            toast(`Canva is connected${next.name ? ` as ${next.name}` : ""}.`);
        }
        catch (e) {
            toast(String(e).replace(/^Error: /, ""));
        }
        finally {
            setBusy(false);
        }
    };
    return (_jsx(Section, { id: "canva", title: "Canva", lede: "Design covers, pictures and whole pages of your books in Canva, then bring them back into Scribe. Part of Scribe Publisher.", children: !status?.available ? (_jsx("p", { className: "settings-row-hint", children: "Canva isn't set up in this copy of TBV." })) : status.name ? (_jsx(Row, { label: "Account", hint: "Connected on this device only.", children: _jsxs("div", { className: "connection-actions", children: [_jsx("span", { className: "settings-value", children: status.name }), _jsx("button", { type: "button", className: "btn btn-quiet btn-danger-text", onClick: () => void api.canvaSignOut().then(setStatus, (e) => toast(String(e))), children: "Disconnect" })] }) })) : (_jsxs(_Fragment, { children: [_jsxs("div", { className: "connection-actions", children: [_jsx("button", { type: "button", className: "btn btn-primary", disabled: busy, onClick: () => publisher.check("Canva", () => void connect()), children: busy ? "Waiting for Canva in your browser…" : "Connect Canva" }), _jsx("button", { type: "button", className: "btn btn-quiet", onClick: () => void openExternal("https://www.canva.com/signup"), children: "Make a Canva account" })] }), _jsx("p", { className: "settings-row-hint", children: "Your browser opens Canva to allow TBV. TBV never sees your Canva password, and only sees designs it made or you send it." })] })) }));
}

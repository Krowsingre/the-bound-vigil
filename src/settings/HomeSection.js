import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
// Preferences › Sync › Stream to your phone at home: TBV on this computer serves
// itself to a phone on the same Wi-Fi, so books and audiobooks here (and in
// a cloud app's folder, like iCloud) open on the phone without Supabase.
import { useEffect, useState } from "react";
import { api, isApp } from "../api";
import { Section, Toggle } from "./controls";
export function HomeSection() {
    const [status, setStatus] = useState(null);
    const [error, setError] = useState(null);
    const run = (work) => {
        setError(null);
        work().then(setStatus, (e) => setError(String(e).replace(/^Error: /, "")));
    };
    useEffect(() => {
        run(() => api.homeStatus());
        return api.onHomeChanged(() => run(() => api.homeStatus()));
    }, []);
    const address = status?.addresses[0];
    return (_jsxs(Section, { id: "home", title: "Stream to your phone at home", lede: "Stream your books and audiobooks from this computer to your phone while both are on the same Wi-Fi. Open the address below in the phone's browser: books here, and in your iCloud or other cloud folder, open and play there without being copied to the phone.", children: [_jsx(Toggle, { label: "Serve TBV to my phone", hint: "Works while TBV is open on this computer and the phone is on the same Wi-Fi.", checked: Boolean(status?.on), disabled: !isApp && status === null, onChange: (on) => run(() => api.setHome(on)) }), status?.problem && _jsx("p", { className: "form-error", children: status.problem }), error && _jsx("p", { className: "form-error", children: error }), status?.on && !address && (_jsx("p", { className: "form-error", children: "This computer doesn't seem to be on a network. Connect it to your Wi-Fi, then turn this off and on." })), status?.on && address && (_jsxs("div", { className: "home-pair", children: [status.qr ? (_jsx("span", { className: "home-qr", "aria-label": "QR code to open TBV on your phone", dangerouslySetInnerHTML: { __html: status.qr } })) : (_jsx("div", { className: "home-qr home-qr-used", children: _jsx("span", { className: "muted", children: "Code used" }) })), _jsxs("div", { className: "home-steps", children: [_jsx("ol", { children: _jsx("li", { children: "Scan the code with your phone's camera, or open this address in Safari:" }) }), _jsx("p", { className: "home-address mono", children: address }), _jsx("ol", { start: 2, children: _jsx("li", { children: status.code ? (_jsxs(_Fragment, { children: ["If it asks, enter ", _jsx("strong", { className: "home-code mono", children: status.code.replace(/(\d{3})(\d{3})/, "$1 $2") }), ". Each code pairs one phone."] })) : ("That code has been used. Ask for a new one to pair another phone.") }) }), _jsxs("div", { className: "home-actions", children: [_jsx("button", { type: "button", className: "btn btn-quiet btn-small", onClick: () => run(() => api.newHomeCode()), children: "New code" }), status.phones > 0 && (_jsxs("button", { type: "button", className: "btn btn-quiet btn-small", onClick: () => run(() => api.forgetHomePhones()), children: ["Forget ", status.phones === 1 ? "the paired phone" : `all ${status.phones} paired phones`] }))] }), _jsx("p", { className: "settings-row-hint", children: "Windows may ask whether TBV can use your network. Allow it on private networks. The phone can read, listen and keep notes; changes to the library are made here." })] })] }))] }));
}

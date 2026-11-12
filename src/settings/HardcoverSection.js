import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
// Preferences › Sync & Accounts › Hardcover: sign in, and send ratings there.
import { useEffect, useState } from "react";
import { api, isApp, openExternal } from "../api";
import { Icon } from "../components/Icon";
import { useToast } from "../components/Toast";
import { Row, Section, Toggle } from "./controls";
export function HardcoverSection() {
    const toast = useToast();
    const [status, setStatus] = useState(null);
    const [busy, setBusy] = useState(null);
    useEffect(() => {
        api.hardcoverStatus().then(setStatus, () => setStatus(null));
    }, []);
    const signIn = async () => {
        if (!isApp)
            return toast("Signing in to Hardcover works in the desktop app.");
        setBusy("signIn");
        try {
            const next = await api.hardcoverSignIn();
            setStatus(next);
            toast(`Signed in to Hardcover as ${next.username}.`);
        }
        catch (e) {
            toast(String(e));
        }
        finally {
            setBusy(null);
        }
    };
    const sendAll = async () => {
        setBusy("sendAll");
        try {
            const { sent, notFound } = await api.hardcoverSendAll();
            const missing = notFound.length ? ` Hardcover doesn't seem to have ${notFound.length === 1 ? notFound[0] : `${notFound.length} of them`}.` : "";
            toast(`Sent ${sent} ${sent === 1 ? "rating" : "ratings"} to Hardcover.${missing}`);
        }
        catch (e) {
            toast(`That didn't work: ${String(e)}`);
        }
        finally {
            setBusy(null);
        }
    };
    const change = (work) => work.then(setStatus, (e) => toast(String(e)));
    return (_jsx(Section, { id: "hardcover", title: "Hardcover", lede: "Hardcover is a site for keeping track of your reading. Rate a book here and it can be rated on Hardcover too.", children: !status?.available ? (_jsx("p", { className: "settings-row-hint", children: "Signing in to Hardcover arrives in the next version of TBV." })) : status.username ? (_jsxs(_Fragment, { children: [_jsx(Row, { label: "Account", hint: "Signed in on this device only.", children: _jsxs("div", { className: "connection-actions", children: [_jsxs("span", { className: "settings-value", children: ["@", status.username] }), _jsx("button", { type: "button", className: "btn btn-quiet btn-danger-text", onClick: () => void change(api.hardcoverSignOut()), children: "Sign out" })] }) }), _jsx("div", { className: "toggle-list", children: _jsx(Toggle, { label: "Rate books on Hardcover when you rate them here", hint: "Books are found on Hardcover by ISBN, or by title and author. A book that isn't on your Hardcover shelves yet is added.", checked: status.sendRatings, onChange: (on) => void change(api.hardcoverSetSending(on)) }) }), _jsx("div", { className: "connection-actions", children: _jsxs("button", { type: "button", className: "btn btn-quiet", disabled: !status.sendRatings || busy !== null, onClick: () => void sendAll(), children: [_jsx(Icon, { name: "upload", size: 16 }), " ", busy === "sendAll" ? "Sending… (a few seconds a book)" : "Send all my ratings now"] }) })] })) : (_jsxs(_Fragment, { children: [_jsxs("div", { className: "connection-actions", children: [_jsx("button", { type: "button", className: "btn btn-primary", disabled: busy !== null, onClick: () => void signIn(), children: busy === "signIn" ? "Waiting for Hardcover in your browser…" : "Sign in with Hardcover" }), _jsx("button", { type: "button", className: "btn btn-quiet", onClick: () => void openExternal("https://hardcover.app/join"), children: "Make a Hardcover account" })] }), _jsx("p", { className: "settings-row-hint", children: "Your browser opens Hardcover to approve TBV. TBV never sees your Hardcover password." })] })) }));
}

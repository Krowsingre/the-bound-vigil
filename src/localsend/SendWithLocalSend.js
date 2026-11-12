import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
// "Send with LocalSend": any book menu, or the Library's Actions menu, asks
// for this dialog; the one host in App shows it, for books, documents and
// audiobooks alike. It finds devices nearby with LocalSend open, sends to the
// one chosen once its person accepts, and shows how it's going.
import { useCallback, useEffect, useRef, useState } from "react";
import { api, isHome, isWeb } from "../api";
import { Icon } from "../components/Icon";
import { ProgressBar } from "../components/ProgressBar";
import { useToast } from "../components/Toast";
import { kindOf } from "../lib/queryBooks";
let listener = null;
/** The web version and the at-home phone page can't reach devices nearby. */
export const canSendWithLocalSend = !isWeb && !isHome;
export function askSendWithLocalSend(books) {
    if (books.length)
        listener?.(books);
}
export function SendWithLocalSendHost() {
    const [books, setBooks] = useState(null);
    const [shown, setShown] = useState(false);
    const [stage, setStage] = useState({ at: "choosing" });
    const toast = useToast();
    useEffect(() => {
        listener = (asked) => {
            // One send at a time: while one is going, asking again shows it.
            setStage((now) => {
                if (now.at === "choosing")
                    setBooks(asked);
                return now;
            });
            setShown(true);
        };
        return () => {
            listener = null;
        };
    }, []);
    useEffect(() => api.onLocalSendSending((progress) => setStage((now) => (now.at === "sending" ? { ...now, progress } : now))), []);
    const send = (to) => {
        if (!books)
            return;
        setStage({ at: "sending", to, progress: null });
        api.sendWithLocalSend(to, books.map((b) => b.id)).then(({ sent, skipped }) => {
            const word = wordFor(books);
            const what = sent === 1 ? `1 ${word.replace(/s$/, "")}` : `${sent} ${word}`;
            const left = skipped.length ? ` ${skipped.length === 1 ? `“${skipped[0][0]}” couldn't go: ${skipped[0][1]}` : `${skipped.length} couldn't go.`}` : "";
            toast(sent ? `Sent ${what} to ${to.alias}.${left}` : skipped.length ? `Nothing was sent.${left}` : `${to.alias} already has them.`);
            finish();
        }, (e) => {
            toast(String(e).replace(/^Error: /, ""));
            finish();
        });
    };
    const finish = () => {
        setStage({ at: "choosing" });
        setBooks(null);
        setShown(false);
    };
    if (!books || !shown)
        return null;
    const what = books.length === 1 ? books[0].title : `${books.length} ${wordFor(books)}`;
    const close = () => (stage.at === "sending" ? setShown(false) : finish());
    return (_jsx("div", { className: "dialog-backdrop", onPointerDown: (e) => e.target === e.currentTarget && close(), children: _jsxs("div", { className: "dialog send-dialog", role: "dialog", "aria-label": "Send with Grimoire", onKeyDown: (e) => e.key === "Escape" && close(), children: [_jsx("h2", { children: "Send with Grimoire" }), _jsx("p", { className: "muted add-dialog-book", children: what }), stage.at === "choosing" ? (_jsx(Devices, { onSend: send, onClose: close })) : (_jsxs(_Fragment, { children: [stage.progress ? (_jsxs("div", { className: "localsend-progress", children: [_jsxs("p", { children: [stage.progress.books > 1 && `${stage.progress.book} of ${stage.progress.books}: `, stage.progress.title] }), _jsx(ProgressBar, { value: stage.progress.size ? stage.progress.bytes / stage.progress.size : null, label: `Sending to ${stage.to.alias}` })] })) : (_jsxs("p", { className: "localsend-waiting", children: ["Waiting for ", stage.to.alias, " to accept. Tap ", _jsx("strong", { children: "Accept" }), " on that device."] })), _jsxs("div", { className: "dialog-actions", children: [_jsxs("button", { type: "button", className: "btn btn-quiet", onClick: () => void api.stopSendingWithLocalSend(), children: [_jsx(Icon, { name: "stop", size: 16 }), " Stop"] }), _jsx("button", { type: "button", className: "btn btn-primary", onClick: close, children: "Hide" })] })] }))] }) }));
}
/** "documents" when they're all documents, and so on; "books" when mixed. */
function wordFor(books) {
    const kinds = new Set(books.map((b) => kindOf(b.format)));
    return kinds.size === 1 ? [...kinds][0] : "books";
}
/** The devices found nearby, and a way to type one's address in. */
function Devices({ onSend, onClose }) {
    const [devices, setDevices] = useState(null);
    const [looking, setLooking] = useState(false);
    const [address, setAddress] = useState("");
    const [problem, setProblem] = useState(null);
    const alive = useRef(true);
    useEffect(() => {
        alive.current = true;
        return () => {
            alive.current = false;
        };
    }, []);
    const look = useCallback(() => {
        setLooking(true);
        api.localSendNearby().then((found) => {
            if (!alive.current)
                return;
            setDevices(found);
            setLooking(false);
        }, (e) => {
            if (!alive.current)
                return;
            setDevices([]);
            setProblem(String(e).replace(/^Error: /, ""));
            setLooking(false);
        });
    }, []);
    useEffect(look, [look]);
    const typed = (e) => {
        e.preventDefault();
        setProblem(null);
        api.localSendDeviceAt(address).then(onSend, (err) => setProblem(String(err).replace(/^Error: /, "")));
    };
    return (_jsxs(_Fragment, { children: [devices === null ? (_jsx("p", { className: "muted send-empty", "aria-busy": "true", children: "Looking for devices nearby\u2026" })) : (_jsxs(_Fragment, { children: [_jsx("ul", { className: "send-list", children: devices.map((d) => (_jsx("li", { children: _jsxs("button", { type: "button", className: "send-choice", onClick: () => onSend(d), children: [_jsx(Icon, { name: d.deviceType === "mobile" ? "phone" : "computer", size: 20 }), _jsxs("span", { className: "send-choice-text", children: [_jsx("span", { className: "send-choice-name", children: d.alias }), _jsx("span", { className: "send-choice-note", children: d.address })] })] }) }, d.fingerprint))) }), !devices.length && (_jsx("p", { className: "muted send-empty", children: "No devices found. On the other device, open TBV and turn on Receive with Grimoire (or open the LocalSend app), keep it on the same Wi-Fi, then look again." }))] })), _jsxs("form", { className: "localsend-address", onSubmit: typed, children: [_jsx("label", { htmlFor: "localsend-address", children: "Not listed? Type the address the other device shows for receiving." }), _jsxs("span", { className: "localsend-address-row", children: [_jsx("input", { id: "localsend-address", className: "input", value: address, placeholder: "192.168.1.20", inputMode: "decimal", onChange: (e) => setAddress(e.target.value) }), _jsx("button", { type: "submit", className: "btn btn-quiet", disabled: !address.trim(), children: "Send" })] })] }), problem && _jsx("p", { className: "send-desktop-only", children: problem }), _jsxs("div", { className: "dialog-actions", children: [_jsxs("button", { type: "button", className: "btn btn-quiet", disabled: looking, onClick: look, children: [_jsx(Icon, { name: "sync", size: 16 }), " ", looking ? "Looking…" : "Look again"] }), _jsx("button", { type: "button", className: "btn btn-primary", onClick: onClose, children: "Close" })] })] }));
}

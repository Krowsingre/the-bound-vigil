import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
// Preferences › E-readers: the readers plugged in now, and Kindle by email.
import { useCallback, useEffect, useState } from "react";
import { api, isApp, openExternal } from "../api";
import { Icon } from "../components/Icon";
import { useToast } from "../components/Toast";
import { DESKTOP_ONLY, EMAIL_SERVICES, missingField, serviceOf, usualPort } from "../ereaders/ereaders";
import { Columns, Section, Segmented, Select } from "./controls";
export function EreadersTab() {
    return (_jsx(Columns, { side: _jsx(KindleEmailSection, {}), children: _jsx(ConnectedSection, {}) }));
}
function ConnectedSection() {
    const [readers, setReaders] = useState(null);
    const look = useCallback(() => {
        setReaders(null);
        api.listEreaders().then(setReaders, () => setReaders([]));
    }, []);
    useEffect(look, [look]);
    return (_jsxs(Section, { id: "connected", title: "Connected e-readers", lede: "Plug in your Kindle, Kobo or other e-reader with its cable, and send books to it from any book's menu.", children: [!isApp && _jsx("p", { className: "settings-row-hint", children: DESKTOP_ONLY }), readers === null ? (_jsx("p", { className: "settings-row-hint", children: "Looking\u2026" })) : readers.length === 0 ? (_jsx("p", { className: "settings-row-hint", children: "No e-readers are plugged in right now. If yours asks, choose to connect it to the computer." })) : (_jsx("ul", { className: "ereader-list", children: readers.map((r) => (_jsxs("li", { className: "ereader-item", children: [_jsx(Icon, { name: r.kind === "other" ? "folder" : "ereader", size: 20 }), _jsxs("span", { children: [_jsx("span", { className: "settings-row-label", children: r.kind === "other" ? `${r.name} (a drive with a books folder)` : r.name }), _jsxs("span", { className: "settings-row-hint", children: ["Books go to ", r.booksFolder, r.formats.length > 0 && `. Opens ${r.formats.map((f) => f.toUpperCase()).join(", ")}`, r.kind === "kindle" && ". EPUB books go to Kindles by email instead", "."] })] })] }, r.root))) })), _jsx("div", { className: "connection-actions", children: _jsxs("button", { type: "button", className: "btn btn-quiet", disabled: readers === null, onClick: look, children: [_jsx(Icon, { name: "sync", size: 16 }), " Look again"] }) })] }));
}
const EMPTY = {
    server: "smtp.gmail.com",
    port: 587,
    security: "starttls",
    username: "",
    password: null,
    from: "",
    kindle: "",
};
function KindleEmailSection() {
    const toast = useToast();
    const [saved, setSaved] = useState(undefined);
    const [draft, setDraft] = useState(EMPTY);
    const [service, setService] = useState("gmail");
    const [busy, setBusy] = useState(null);
    const [error, setError] = useState(null);
    useEffect(() => {
        api.kindleEmailSettings().then((s) => {
            setSaved(s);
            if (s) {
                setDraft({ ...s, password: null });
                setService(serviceOf(s.server));
            }
        }, () => setSaved(null));
    }, []);
    const change = (patch) => {
        setError(null);
        setDraft((d) => {
            const next = { ...d, ...patch };
            // The username is usually the address itself.
            if (patch.from !== undefined && (!d.username || d.username === d.from))
                next.username = patch.from;
            return next;
        });
    };
    const pickService = (id) => {
        setService(id);
        const s = EMAIL_SERVICES.find((x) => x.id === id);
        if (s)
            change({ server: s.server, port: s.port, security: s.security });
    };
    const missing = missingField(draft, Boolean(saved?.hasPassword));
    const save = async () => {
        if (missing) {
            setError(missing);
            return false;
        }
        setBusy("save");
        try {
            const next = await api.saveKindleEmail({ ...draft, password: draft.password || null });
            setSaved(next);
            setDraft({ ...next, password: null });
            return true;
        }
        catch (e) {
            setError(String(e).replace(/^Error: /, ""));
            return false;
        }
        finally {
            setBusy(null);
        }
    };
    const test = async () => {
        if (!(await save()))
            return;
        setBusy("test");
        try {
            await api.sendKindleTest();
            toast("Test sent. It should show up on your Kindle in a few minutes, once it's on Wi-Fi.");
        }
        catch (e) {
            setError(String(e).replace(/^Error: /, ""));
        }
        finally {
            setBusy(null);
        }
    };
    const forget = async () => {
        await api.forgetKindleEmail();
        setSaved(null);
        setDraft(EMPTY);
        setService("gmail");
        toast("Forgot the Kindle email settings on this device.");
    };
    const note = EMAIL_SERVICES.find((s) => s.id === service)?.note;
    return (_jsx(Section, { id: "kindle", title: "Kindle by email", lede: "Amazon's Send to Kindle takes EPUB, PDF, Word and text books by email, and turns them into Kindle books. TBV sends them from your own email account.", children: saved === undefined ? null : (_jsxs("form", { className: "kindle-form", onSubmit: (e) => {
                e.preventDefault();
                void save().then((ok) => ok && toast("Saved. Books can now go to your Kindle by email."));
            }, children: [_jsxs("label", { className: "field", children: [_jsx("span", { children: "Your Kindle's email address" }), _jsx("input", { value: draft.kindle, onChange: (e) => change({ kindle: e.target.value }), placeholder: "yourname@kindle.com", spellCheck: false, autoComplete: "off" })] }), _jsx("p", { className: "settings-row-hint", children: "Find it on Amazon under Manage Your Content and Devices \u203A Preferences \u203A Personal Document Settings." }), _jsxs("label", { className: "field", children: [_jsx("span", { children: "Your email address" }), _jsx("input", { value: draft.from, onChange: (e) => change({ from: e.target.value }), placeholder: "you@example.com", spellCheck: false, autoComplete: "email" })] }), _jsxs("p", { className: "kindle-approve", children: ["Add ", draft.from.trim() || "this address", " to Amazon's Approved Personal Document E-mail List (amazon.com \u203A Manage Your Content and Devices \u203A Preferences \u203A Personal Document Settings), or Amazon won't accept the books.", " ", _jsx("button", { type: "button", className: "link-button", onClick: () => void openExternal("https://www.amazon.com/mycd"), children: "Open Amazon" })] }), _jsxs("label", { className: "field", children: [_jsx("span", { children: "Your email service" }), _jsx(Select, { label: "Your email service", value: service, options: [
                                ...EMAIL_SERVICES.map((s) => ({ value: s.id, label: s.label })),
                                { value: "other", label: "Another service" },
                            ], onChange: pickService })] }), service === "other" && (_jsxs(_Fragment, { children: [_jsxs("div", { className: "kindle-form-pair", children: [_jsxs("label", { className: "field", children: [_jsx("span", { children: "Outgoing (SMTP) server" }), _jsx("input", { value: draft.server, onChange: (e) => change({ server: e.target.value }), placeholder: "smtp.example.com", spellCheck: false })] }), _jsxs("label", { className: "field", children: [_jsx("span", { children: "Port" }), _jsx("input", { inputMode: "numeric", value: draft.port || "", onChange: (e) => change({ port: Number(e.target.value.replace(/\D/g, "").slice(0, 5)) }) })] })] }), _jsxs("div", { className: "field", children: [_jsx("span", { children: "Security" }), _jsx(Segmented, { label: "Security", value: draft.security, options: [
                                        { value: "starttls", label: "STARTTLS" },
                                        { value: "ssl", label: "SSL" },
                                    ], onChange: (security) => change({ security, port: draft.port === usualPort(draft.security) ? usualPort(security) : draft.port }) })] })] })), _jsxs("label", { className: "field", children: [_jsx("span", { children: "Username" }), _jsx("input", { value: draft.username, onChange: (e) => change({ username: e.target.value }), spellCheck: false, autoComplete: "username" })] }), _jsxs("label", { className: "field", children: [_jsx("span", { children: "Password" }), _jsx("input", { type: "password", value: draft.password ?? "", onChange: (e) => change({ password: e.target.value }), placeholder: saved?.hasPassword ? "Saved (type a new one to change it)" : "An app password", autoComplete: "current-password" })] }), _jsxs("p", { className: "settings-row-hint", children: [note ?? "Many email services need an app password for this, made in your account's security settings.", " It stays on this device and is never synced or put in backups."] }), error && _jsx("p", { className: "form-error", children: error }), _jsxs("div", { className: "dialog-actions", children: [saved && (_jsx("button", { type: "button", className: "btn btn-quiet btn-danger-text", onClick: () => void forget(), children: "Forget" })), _jsxs("button", { type: "button", className: "btn btn-quiet", disabled: busy !== null, onClick: () => void test(), children: [_jsx(Icon, { name: "email", size: 16 }), " ", busy === "test" ? "Sending a test…" : "Send a test"] }), _jsx("button", { type: "submit", className: "btn btn-primary", disabled: busy !== null, children: busy === "save" ? "Saving…" : "Save" })] })] })) }));
}

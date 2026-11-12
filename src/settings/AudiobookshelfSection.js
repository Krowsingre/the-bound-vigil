import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// Preferences › Servers › Audiobookshelf: signing in to and out of your
// Audiobookshelf servers (embre, 29 October). Browsing and listening stay in
// Discover's catalogues, where each signed-in server shows.
import { useCallback, useEffect, useState } from "react";
import { api, isApp } from "../api";
import { Icon } from "../components/Icon";
import { useToast } from "../components/Toast";
import { Section } from "./controls";
const plain = (e) => String(e).replace(/^Error: /, "");
export function AudiobookshelfSection() {
    const toast = useToast();
    const [servers, setServers] = useState(null);
    const [form, setForm] = useState(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const load = useCallback(() => {
        if (!isApp)
            return setServers([]);
        api.catalogs().then((all) => setServers(all.filter((c) => c.kind === "audiobookshelf")), () => setServers([]));
    }, []);
    useEffect(load, [load]);
    const run = async (work, done) => {
        setBusy(true);
        try {
            await work();
            if (done)
                toast(done);
            load();
            return true;
        }
        catch (e) {
            setError(plain(e));
            return false;
        }
        finally {
            setBusy(false);
        }
    };
    const signIn = async () => {
        if (!form)
            return;
        setError(null);
        const ok = await run(() => api.saveAbsServer({ id: form.id, name: form.name, url: form.url, username: form.username.trim(), password: form.password || null }), "Signed in to Audiobookshelf.");
        if (ok)
            setForm(null);
    };
    return (_jsxs(Section, { id: "audiobookshelf", title: "Audiobookshelf", lede: "Sign in to your Audiobookshelf server here. Its libraries then show in Discover's catalogues, where you can listen straight from the server or bring books into TBV.", children: [!isApp && _jsx("p", { className: "settings-row-hint", children: "Audiobookshelf works in the TBV app." }), servers && servers.length > 0 && (_jsx("ul", { className: "ereader-list server-list", children: servers.map((s) => (_jsxs("li", { className: "ereader-item server-item", children: [_jsx(Icon, { name: "headphones", size: 20 }), _jsxs("span", { children: [_jsx("span", { className: "settings-row-label", children: s.name }), _jsxs("span", { className: "settings-row-hint", children: [s.hasPassword ? `Signed in as ${s.username ?? "you"}` : "Signed out", " \u00B7 ", s.url] })] }), _jsxs("span", { className: "server-actions", children: [s.hasPassword ? (_jsx("button", { type: "button", className: "btn btn-quiet", disabled: busy, onClick: () => void run(() => api.signOutAbsServer(s.id), `Signed out of ${s.name}.`), children: "Sign out" })) : (_jsx("button", { type: "button", className: "btn btn-primary", disabled: busy, onClick: () => (setError(null), setForm({ id: s.id, name: s.name, url: s.url, username: s.username ?? "", password: "" })), children: "Sign in" })), _jsx("button", { type: "button", className: "icon-btn", "aria-label": `Remove ${s.name}`, title: "Remove", disabled: busy, onClick: () => void run(() => api.removeCatalog(s.id), `${s.name} was removed.`), children: _jsx(Icon, { name: "trash", size: 16 }) })] })] }, s.id))) })), form ? (_jsxs("form", { className: "kindle-form server-form", onSubmit: (e) => {
                    e.preventDefault();
                    void signIn();
                }, children: [_jsxs("label", { className: "field", children: [_jsx("span", { children: "Address" }), _jsx("input", { value: form.url, onChange: (e) => setForm({ ...form, url: e.target.value }), placeholder: "http://192.168.1.20:13378", inputMode: "url", autoFocus: !form.id })] }), _jsxs("label", { className: "field", children: [_jsx("span", { children: "Name" }), _jsx("input", { value: form.name, onChange: (e) => setForm({ ...form, name: e.target.value }), placeholder: "Optional" })] }), _jsxs("label", { className: "field", children: [_jsx("span", { children: "User name" }), _jsx("input", { value: form.username, onChange: (e) => setForm({ ...form, username: e.target.value }), autoComplete: "off" })] }), _jsxs("label", { className: "field", children: [_jsx("span", { children: "Password" }), _jsx("input", { type: "password", value: form.password, onChange: (e) => setForm({ ...form, password: e.target.value }), autoComplete: "new-password", autoFocus: !!form.id })] }), _jsx("p", { className: "settings-row-hint", children: "TBV keeps only the server's sign-in, never the password, on this device." }), error && (_jsx("p", { className: "form-error", role: "alert", children: error })), _jsxs("div", { className: "connection-actions", children: [_jsx("button", { type: "button", className: "btn btn-quiet", disabled: busy, onClick: () => setForm(null), children: "Cancel" }), _jsx("button", { type: "submit", className: "btn btn-primary", disabled: busy || !form.url.trim() || !form.username.trim() || !form.password, children: busy ? "Signing in…" : "Sign in" })] })] })) : (_jsx("div", { className: "connection-actions", children: _jsxs("button", { type: "button", className: "btn btn-quiet", disabled: !isApp, onClick: () => (setError(null), setForm({ id: null, name: "", url: "", username: "", password: "" })), children: [_jsx(Icon, { name: "plus", size: 16 }), " Add an Audiobookshelf server"] }) })), error && !form && (_jsx("p", { className: "form-error", role: "alert", children: error }))] }));
}

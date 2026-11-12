import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
// The web version's first screen and its Sync settings: which Supabase
// project holds the library, and signing in to it. The web version has no
// library of its own, so nothing else shows until it's signed in.
import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import emblem from "../assets/emblem.svg?raw";
import { Icon } from "../components/Icon";
import { useToast } from "../components/Toast";
import { relativeTime } from "../lib/format";
import { AccountPanel } from "../settings/AccountPanel";
import { MOVE_DESKTOP_ONLY } from "../api/moveStub";
import { Section } from "../settings/controls";
import { urlOk } from "./link";
const STATE_TEXT = {
    disabled: "Not signed in",
    idle: "Up to date",
    syncing: "Syncing…",
    offline: "Offline. Changes wait here",
    attention: "Needs you to choose",
    error: "Sync failed",
};
function ProjectForm({ project, onSaved, onCancel }) {
    const toast = useToast();
    const [draft, setDraft] = useState(project ?? { url: "", anonKey: "" });
    const ok = urlOk(draft.url) && !!draft.anonKey.trim();
    return (_jsxs("form", { className: "settings-subpanel supabase-form", onSubmit: (e) => {
            e.preventDefault();
            if (!ok)
                return;
            api.setSupabaseProject({ url: draft.url.trim().replace(/\/$/, ""), anonKey: draft.anonKey.trim() }).then(onSaved, (e) => toast(String(e)));
        }, children: [_jsx("h3", { children: "Your Supabase project" }), _jsxs("p", { className: "settings-row-hint", children: ["The easy way: on your computer, open TBV's Preferences \u203A Sync & Backup and use ", _jsx("strong", { children: "Copy phone link" }), ", then open that link here. Or copy the project URL and publishable key from the desktop app's Sync settings into these boxes."] }), _jsxs("label", { className: "field", children: [_jsx("span", { children: "Project URL" }), _jsx("input", { value: draft.url, onChange: (e) => setDraft({ ...draft, url: e.target.value }), placeholder: "https://yourproject.supabase.co", spellCheck: false, autoCapitalize: "none", inputMode: "url" })] }), draft.url.trim() && !urlOk(draft.url) && _jsx("p", { className: "form-error", children: "That doesn't look like a Supabase project address." }), _jsxs("label", { className: "field", children: [_jsx("span", { children: "Publishable key" }), _jsx("input", { value: draft.anonKey, onChange: (e) => setDraft({ ...draft, anonKey: e.target.value }), placeholder: "sb_publishable_\u2026 (or the older anon key, eyJ\u2026)", spellCheck: false, autoCapitalize: "none" })] }), _jsxs("div", { className: "dialog-actions", children: [onCancel && (_jsx("button", { type: "button", className: "btn btn-quiet", onClick: onCancel, children: "Cancel" })), _jsx("button", { type: "submit", className: "btn btn-primary", disabled: !ok, children: "Save" })] })] }));
}
/** Shows the app once signed in, and the way to connect until then. */
export function WebGate({ children }) {
    const [overview, setOverview] = useState(null);
    const reload = useCallback(() => void api.syncOverview().then(setOverview), []);
    useEffect(() => {
        reload();
        return api.onSync({ status: reload });
    }, [reload]);
    if (!overview)
        return null;
    if (overview.signedInAs)
        return _jsx(_Fragment, { children: children });
    return (_jsx("div", { className: "web-connect", children: _jsxs("div", { className: "web-connect-card", children: [_jsx("span", { className: "web-connect-emblem", "aria-hidden": true, dangerouslySetInnerHTML: { __html: emblem } }), _jsx("h1", { children: "The Bound Vigil" }), _jsx("p", { className: "muted", children: "Read your library on this phone. Connect to the Supabase project your desktop app syncs with, then sign in with the same account." }), overview.lastError && _jsx("p", { className: "form-error", children: overview.lastError }), overview.project ? (_jsxs(_Fragment, { children: [_jsxs("p", { className: "web-connect-project", children: [_jsx(Icon, { name: "cloud", size: 16 }), " ", overview.project.url.replace(/^https:\/\//, ""), _jsx("button", { type: "button", className: "btn btn-quiet btn-small", onClick: () => void api.setSupabaseProject(null).then(reload), children: "Change" })] }), _jsx(AccountPanel, { signedIn: null, onChanged: reload })] })) : (_jsx(ProjectForm, { project: null, onSaved: reload }))] }) }));
}
/** Preferences › Sync in the web version. */
export function WebSyncTab() {
    const toast = useToast();
    const [overview, setOverview] = useState(null);
    const [editing, setEditing] = useState(false);
    const reload = useCallback(() => void api.syncOverview().then(setOverview), []);
    useEffect(() => {
        reload();
        return api.onSync({ status: reload });
    }, [reload]);
    if (!overview)
        return null;
    const state = overview.status.state;
    return (_jsxs(Section, { id: "provider", title: "Sync", lede: "The web version keeps your library in step through your Supabase project.", children: [_jsxs("div", { className: "connection-details web-connection", children: [_jsxs("dl", { children: [_jsx("dt", { children: "Status" }), _jsxs("dd", { children: [_jsx("span", { className: `status-dot is-${state}`, "aria-hidden": true }), STATE_TEXT[state]] }), overview.project && (_jsxs(_Fragment, { children: [_jsx("dt", { children: "Project" }), _jsx("dd", { className: "mono", children: overview.project.url.replace(/^https:\/\//, "") })] })), _jsx("dt", { children: "Last synced" }), _jsx("dd", { children: overview.status.lastSuccessAt ? relativeTime(overview.status.lastSuccessAt) : "Never" }), overview.waitingToSend > 0 && (_jsxs(_Fragment, { children: [_jsx("dt", { children: "Waiting" }), _jsxs("dd", { children: [overview.waitingToSend, " ", overview.waitingToSend === 1 ? "change" : "changes", " to send"] })] }))] }), overview.lastError && _jsx("p", { className: "form-error", children: overview.lastError }), _jsxs("div", { className: "connection-actions", children: [_jsxs("button", { type: "button", className: "btn btn-primary", disabled: state === "syncing", onClick: () => void api.syncNow(), children: [_jsx(Icon, { name: "sync", size: 16 }), " ", state === "syncing" ? "Syncing…" : "Sync now"] }), _jsxs("button", { type: "button", className: "btn btn-quiet", onClick: () => setEditing(true), children: [_jsx(Icon, { name: "settings", size: 16 }), " Change project"] })] })] }), editing && (_jsx(ProjectForm, { project: overview.project, onCancel: () => setEditing(false), onSaved: () => {
                    setEditing(false);
                    toast("Saved. Sign in to that project to read its library.");
                    reload();
                } })), _jsx(AccountPanel, { signedIn: overview.signedInAs, onChanged: reload }), _jsx("p", { className: "settings-row-hint", children: "Books open from the cloud, so turn on Sync book files in the desktop app for the books you want here. Once opened, a book stays in this browser for reading offline." }), _jsx("p", { className: "settings-row-hint", children: MOVE_DESKTOP_ONLY })] }));
}

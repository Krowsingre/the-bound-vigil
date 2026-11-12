import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { Icon } from "../components/Icon";
import { useToast } from "../components/Toast";
import { newTabId } from "./browserTabs";
import { Panel } from "./StartPanels";
/** Where sessions were kept before the library kept (and synced) them. */
const key = "tbv.browser.sessions";
function validUrl(url) {
    if (url === "tbv:start")
        return true;
    if (typeof url !== "string" || !/^https?:\/\//i.test(url))
        return false;
    try {
        const parsed = new URL(url);
        return !parsed.username && !parsed.password;
    }
    catch {
        return false;
    }
}
export function snapshotSession(state) {
    const open = state.tabs.filter((tab) => !tab.private && validUrl(tab.url));
    return {
        tabs: open.map(({ url, title, pinned }) => ({ url, title, pinned: !!pinned })),
        active: Math.max(0, open.findIndex((tab) => tab.id === state.active)),
    };
}
export function restoreSession(session) {
    const tabs = session.tabs.map((tab) => ({ ...tab, id: newTabId() }));
    return { tabs: [...tabs.filter((tab) => tab.pinned), ...tabs.filter((tab) => !tab.pinned)], active: tabs[session.active]?.id ?? tabs[0].id };
}
/** Sessions kept on this device before 0.92, to move into the library once. */
function readOldSessions() {
    try {
        const saved = JSON.parse(localStorage.getItem(key) ?? "[]");
        return saved.filter((session) => session && typeof session.id === "string" && typeof session.name === "string" &&
            Array.isArray(session.tabs) && session.tabs.length > 0 && session.tabs.every((tab) => validUrl(tab?.url)));
    }
    catch {
        return [];
    }
}
let moving = null;
/** Moves the sessions kept here before into the library, so they sync too. */
function moveOldSessions() {
    moving ??= (async () => {
        const old = readOldSessions();
        for (const session of old)
            await api.putBrowserSession(session);
        try {
            localStorage.removeItem(key);
        }
        catch {
            // Moved again next time; the same sessions just update.
        }
    })().catch(() => {
        moving = null;
    });
    return moving;
}
/** This device's sessions first, then each other device's, by the device they were saved on. */
function byDevice(sessions) {
    const groups = new Map();
    groups.set("here", { key: "here", label: "This device", sessions: [] });
    for (const session of sessions) {
        const id = session.device ? session.deviceId ?? session.device : "here";
        const group = groups.get(id) ?? { key: id, label: session.device ?? "Another device", sessions: [] };
        group.sessions.push(session);
        groups.set(id, group);
    }
    return [...groups.values()].filter((group) => group.sessions.length);
}
const tabCount = (n) => `${n} ${n === 1 ? "tab" : "tabs"}`;
export function SessionsPanel({ current, onLoad, onNew, onClose }) {
    const [sessions, setSessions] = useState([]);
    const [draft, setDraft] = useState(null);
    /** Starting a new session once the draft is saved. */
    const [thenNew, setThenNew] = useState(false);
    const [pending, setPending] = useState(null);
    const toast = useToast();
    const snapshot = snapshotSession(current);
    const reload = useCallback(() => {
        void moveOldSessions().then(() => api.browserSessions()).then(setSessions, () => undefined);
    }, []);
    // Sessions saved on other devices arrive with sync.
    useEffect(() => {
        reload();
        return api.onSync({ libraryChanged: reload });
    }, [reload]);
    const store = async (change, after) => {
        try {
            await change();
            setSessions(await api.browserSessions());
            setDraft(null);
            setPending(null);
            after?.();
        }
        catch (e) {
            toast(`Could not save the session: ${String(e)}`);
        }
    };
    const changeTab = (index, change) => {
        if (!draft)
            return;
        setDraft({ ...draft, tabs: draft.tabs.map((tab, i) => i === index ? { ...tab, ...change } : tab) });
    };
    const move = (index, delta) => {
        if (!draft)
            return;
        const target = index + delta;
        const tabs = [...draft.tabs];
        [tabs[index], tabs[target]] = [tabs[target], tabs[index]];
        setDraft({ ...draft, tabs, active: draft.active === index ? target : draft.active === target ? index : draft.active });
    };
    const remove = (index) => {
        if (!draft)
            return;
        const tabs = draft.tabs.filter((_, i) => i !== index);
        const active = draft.active > index ? draft.active - 1 : Math.min(draft.active, tabs.length - 1);
        setDraft({ ...draft, tabs, active });
    };
    const confirmation = (p) => {
        switch (p.action) {
            case "load":
                return { text: `Open “${p.session.name}”? Your open tabs will close.`, buttons: [{ label: "Open", primary: true, act: () => onLoad(p.session) }] };
            case "delete":
                return { text: `Delete “${p.session.name}”?`, buttons: [{ label: "Delete", primary: true, act: () => void store(() => api.removeBrowserSession(p.session.id)) }] };
            case "overwrite":
                return {
                    text: `Replace “${p.session.name}” with your ${tabCount(snapshot.tabs.length)} open now?`,
                    buttons: [{ label: "Replace", primary: true, act: () => void store(() => api.putBrowserSession({ ...p.session, ...snapshot }), () => toast(`Saved over “${p.session.name}”.`)) }],
                };
            case "same-name":
                return {
                    text: `“${p.session.name}” already exists. Replace it?`,
                    buttons: [{ label: "Replace", primary: true, act: () => void store(() => api.putBrowserSession({ ...p.saving, id: p.session.id }), thenNew ? onNew : undefined) }],
                };
            case "new":
                return snapshot.tabs.length
                    ? {
                        text: "Save your open tabs first?",
                        buttons: [
                            { label: "Save", primary: true, act: () => (setPending(null), setThenNew(true), setDraft({ id: newTabId(), name: "", ...snapshot })) },
                            { label: "Don't save", act: onNew },
                        ],
                    }
                    : { text: "Close all tabs and start a new session?", buttons: [{ label: "New session", primary: true, act: onNew }] };
        }
    };
    return (_jsx(Panel, { title: "Sessions", onClose: onClose, children: pending ? (() => {
            const ask = confirmation(pending);
            return (_jsxs("div", { className: "bookmark-editor", children: [_jsx("p", { children: ask.text }), _jsxs("div", { className: "bookmark-editor-actions", children: [ask.buttons.map((b) => (_jsx("button", { type: "button", className: `btn btn-small ${b.primary ? "btn-primary" : "btn-quiet"}`, onClick: b.act, children: b.label }, b.label))), _jsx("button", { type: "button", className: "btn btn-quiet btn-small", onClick: () => setPending(null), children: "Cancel" })] })] }));
        })() : draft ? (_jsxs("form", { className: "bookmark-editor", onSubmit: (event) => {
                event.preventDefault();
                const updated = { ...draft, name: draft.name.trim(), tabs: draft.tabs.map((tab) => ({ ...tab, url: tab.url.trim() })) };
                if (!updated.name || !updated.tabs.length || !updated.tabs.every((tab) => validUrl(tab.url))) {
                    toast("Enter a session name and use web addresses or tbv:start for its tabs.");
                    return;
                }
                // Saving under a name that's taken saves over that session, once agreed.
                const same = sessions.find((session) => session.id !== draft.id && session.name.trim().toLocaleLowerCase() === updated.name.toLocaleLowerCase());
                if (same)
                    setPending({ action: "same-name", session: same, saving: updated });
                else
                    void store(() => api.putBrowserSession(updated), thenNew ? onNew : undefined);
            }, children: [_jsxs("label", { children: ["Session name ", _jsx("input", { autoFocus: true, required: true, maxLength: 120, value: draft.name, onChange: (event) => setDraft({ ...draft, name: event.target.value }) })] }), _jsx("ol", { className: "browser-session-tabs", children: draft.tabs.map((tab, index) => (_jsxs("li", { children: [_jsxs("label", { children: ["Tab ", index + 1, " address ", _jsx("input", { required: true, value: tab.url, onChange: (event) => changeTab(index, { url: event.target.value, title: null }) })] }), _jsxs("div", { className: "bookmark-editor-actions", children: [_jsxs("label", { children: [_jsx("input", { type: "checkbox", checked: !!tab.pinned, onChange: (event) => changeTab(index, { pinned: event.target.checked }) }), " Pinned"] }), _jsx("button", { type: "button", className: "icon-btn", disabled: index === 0, "aria-label": `Move tab ${index + 1} up`, onClick: () => move(index, -1), children: "\u2191" }), _jsx("button", { type: "button", className: "icon-btn", disabled: index === draft.tabs.length - 1, "aria-label": `Move tab ${index + 1} down`, onClick: () => move(index, 1), children: "\u2193" }), _jsx("button", { type: "button", className: "icon-btn", disabled: draft.tabs.length === 1, "aria-label": `Remove tab ${index + 1}`, onClick: () => remove(index), children: _jsx(Icon, { name: "close", size: 14 }) })] })] }, index))) }), _jsxs("div", { className: "bookmark-editor-actions", children: [_jsx("button", { type: "button", className: "btn btn-quiet btn-small", onClick: () => setDraft({ ...draft, tabs: [...draft.tabs, { url: "", title: null }] }), children: "Add tab" }), _jsx("button", { type: "submit", className: "btn btn-primary btn-small", children: "Save session" }), _jsx("button", { type: "button", className: "btn btn-quiet btn-small", onClick: () => (setDraft(null), setThenNew(false)), children: "Cancel" })] })] })) : (_jsxs(_Fragment, { children: [_jsx("p", { className: "muted", children: "Sessions sync to all your devices. Addresses may contain site-specific tokens." }), _jsxs("div", { className: "bookmark-editor-actions", children: [_jsx("button", { type: "button", className: "btn btn-quiet btn-small", disabled: !snapshot.tabs.length, onClick: () => (setThenNew(false), setDraft({ id: newTabId(), name: "", ...snapshot })), children: "Save open tabs" }), _jsx("button", { type: "button", className: "btn btn-quiet btn-small", onClick: () => setPending({ action: "new" }), children: "New session" })] }), _jsxs("div", { className: "browser-history-list", children: [!sessions.length && _jsx("p", { className: "muted", children: "No sessions saved yet." }), byDevice(sessions).map((group) => (_jsxs("section", { children: [_jsx("h3", { children: group.label }), _jsx("ul", { className: "browser-download-list", children: group.sessions.map((session) => (_jsxs("li", { children: [_jsx("button", { type: "button", className: "browser-history-open", onClick: () => setPending({ session, action: "load" }), children: _jsxs("span", { className: "browser-download-name", children: [_jsx("b", { children: session.name }), _jsx("span", { className: "muted", children: tabCount(session.tabs.length) })] }) }), _jsx("button", { type: "button", className: "btn btn-quiet btn-small", disabled: !snapshot.tabs.length, title: "Replace this session with the tabs open now", onClick: () => setPending({ session, action: "overwrite" }), children: "Save over" }), _jsx("button", { type: "button", className: "icon-btn", "aria-label": `Edit ${session.name}`, onClick: () => (setThenNew(false), setDraft(session)), children: _jsx(Icon, { name: "edit", size: 15 }) }), _jsx("button", { type: "button", className: "icon-btn", "aria-label": `Delete ${session.name}`, onClick: () => setPending({ session, action: "delete" }), children: _jsx(Icon, { name: "close", size: 15 }) })] }, session.id))) })] }, group.key)))] })] })) }));
}

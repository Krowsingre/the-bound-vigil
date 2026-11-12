import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useCallback, useEffect, useState } from "react";
import { api, isAndroid, isApp, isIOS, isMac, isWeb, isWindows } from "../api";
import { relativeTime } from "../lib/format";
import { behindText } from "../shell/SyncMenu";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Icon } from "../components/Icon";
import { useToast } from "../components/Toast";
import { useAppSettings } from "./appSettings";
import { AccountPanel } from "./AccountPanel";
import { SupabaseProjectForm } from "./SupabaseSetup";
import { MoveSection } from "./MoveSection";
import { AlsoSection } from "./AlsoSection";
import { PhoneSection } from "./PhoneSection";
import { TidySection } from "./TidySection";
import { HomeSection } from "./HomeSection";
import { UsageSection } from "./UsageSection";
import { ContentsSection } from "./ContentsSection";
import { serviceName, SyncFolderPanel } from "./SyncFolderPanel";
import { PROVIDERS, ProviderPicker } from "./providers";
import { Columns, ActionTile, RadioList, Row, Section, SectionGroup, Select, Toggle } from "./controls";
/** Sync's state in a few words, for the connection details. */
const STATE_TEXT = {
    disabled: "Not connected",
    idle: "Up to date",
    syncing: "Syncing…",
    offline: "Offline. Changes wait here",
    attention: "Needs you to choose",
    error: "Sync failed",
};
/** The card picked before anything is set up: the cloud this device already has. */
const FIRST_CARD = isIOS || isMac ? "icloud" : isWindows ? "onedrive" : "supabase";
/** The card for the service in use. */
function cardFor(view) {
    if (view.kind === "off")
        return FIRST_CARD;
    if (view.kind === "webdav")
        return "custom";
    if (view.kind === "cloud")
        return view.service === "google" ? "gdrive" : view.service;
    if (view.kind === "folder")
        return PROVIDERS.some((p) => p.id === view.service) ? view.service : "custom";
    return "supabase";
}
export function SyncTab({ onRestored }) {
    const { settings, changeSync } = useAppSettings();
    const sync = settings.sync;
    const toast = useToast();
    const [provider, setProvider] = useState(FIRST_CARD);
    const [overview, setOverview] = useState(null);
    const [editing, setEditing] = useState(false);
    const [restoring, setRestoring] = useState(false);
    const [busy, setBusy] = useState(false);
    const reload = useCallback(() => api.syncOverview().then((o) => {
        setOverview(o);
        return o;
    }, () => null), []);
    useEffect(() => {
        void reload().then((o) => {
            // Supabase not signed in to is nothing set up yet.
            if (o)
                setProvider(o.provider.kind === "supabase" && !o.signedInAs ? FIRST_CARD : cardFor(o.provider));
        });
        return api.onSync({ status: () => void reload() });
    }, [reload]);
    const project = overview?.project ?? null;
    const signedIn = overview?.signedInAs ?? null;
    const state = overview?.status.state ?? "disabled";
    const current = overview?.provider ?? { kind: "supabase", service: null, location: null, username: null };
    // Supabase counts as in use once signed in; a folder or server as soon as it's chosen.
    const inUse = current.kind === "off" ? null : current.kind === "supabase" ? (signedIn ? "supabase" : null) : cardFor(current);
    const showing = provider === inUse;
    const saveProject = (next) => api.setSupabaseProject(next).then(() => {
        setEditing(false);
        void reload();
        toast(next ? "Saved. Now sign in below." : "TBV no longer uses that project.");
    }, (e) => toast(String(e)));
    const run = async (work, done) => {
        if (!isApp)
            return toast("This works in the desktop app. The browser preview has sample books only.");
        setBusy(true);
        try {
            if (await work())
                toast(done);
        }
        catch (e) {
            toast(`That didn't work: ${String(e)}`);
        }
        finally {
            setBusy(false);
        }
    };
    const statusOf = (id) => {
        if (id === inUse)
            return current.kind === "webdav" ? "Connected by WebDAV" : current.kind === "cloud" ? "Signed in" : "Connected";
        if (id === "supabase")
            return signedIn ? "Signed in, not in use" : project ? "Sign in to start" : "Not connected";
        return id === "custom" ? "A folder or WebDAV" : id === "dropbox" || id === "gdrive" || id === "onedrive" ? "Sign in, or its app's folder" : "Uses its app's folder";
    };
    const where = current.kind === "folder"
        ? `Folder (${serviceName(current.service)})`
        : current.kind === "webdav"
            ? "WebDAV server"
            : current.kind === "cloud"
                ? serviceName(current.service)
                : "Supabase";
    const chosen = PROVIDERS.find((p) => p.id === provider);
    // Supabase's own parts (its space, tidying, contents) show only when it's in use.
    const supabaseOn = !!overview && ((overview.provider.kind === "supabase" && !!overview.signedInAs) || overview.also?.provider.kind === "supabase");
    const side = (_jsxs(_Fragment, { children: [overview && supabaseOn && !isWeb && (_jsxs(SectionGroup, { id: "storage", title: "Supabase storage", lede: "The room TBV uses in your Supabase project, tidying it up, and what it holds.", holds: ["usage", "tidy", "contents"], children: [_jsx(UsageSection, { overview: overview }), _jsx(TidySection, { overview: overview }), _jsx(ContentsSection, { overview: overview })] })), !isWeb && !isIOS && !isAndroid && (_jsxs(SectionGroup, { id: "yourphone", title: "Your phone", lede: "The books your phone keeps, and streaming to it at home.", holds: ["phone", "home"], children: [overview && _jsx(PhoneSection, { overview: overview }), _jsx(HomeSection, {})] }))] }));
    // Nothing for the side: Supabase isn't in use, and there's no phone part here.
    const sideEmpty = !(overview && supabaseOn && !isWeb) && (isWeb || isIOS || isAndroid);
    return (_jsxs(Columns, { side: sideEmpty ? undefined : side, children: [overview && overview.conflicts.length > 0 && (_jsx(Section, { id: "conflicts", title: "Changes to choose between", lede: "This device and another changed the same things. Pick which version to keep.", children: _jsx("ul", { className: "conflict-list", children: overview.conflicts.map((c) => (_jsxs("li", { className: "conflict", children: [_jsx("strong", { children: c.what }), _jsxs("dl", { children: [_jsx("dt", { children: "On this device" }), _jsx("dd", { children: c.here }), _jsxs("dt", { children: ["In the cloud (", relativeTime(c.cloudChangedAt), ")"] }), _jsx("dd", { children: c.cloud })] }), _jsxs("div", { className: "conflict-actions", children: [_jsx("button", { type: "button", className: "btn btn-quiet", onClick: () => void api.resolveSyncConflict(c.kind, c.key, false).then(reload), children: "Keep this device's" }), _jsx("button", { type: "button", className: "btn btn-quiet", onClick: () => void api.resolveSyncConflict(c.kind, c.key, true).then(reload), children: "Keep the cloud's" })] })] }, `${c.kind}${c.key}`))) }) })), _jsxs(SectionGroup, { id: "syncwhere", title: "Where your library syncs", lede: "The cloud service that carries your library, and a second place if you like.", holds: ["provider", "also"], children: [_jsxs(Section, { id: "provider", title: "Sync provider", lede: "Choose the cloud service that carries your library between devices.", aside: _jsxs("div", { className: "connection-details", children: [_jsx("h3", { children: "Connection details" }), _jsxs("dl", { children: [_jsx("dt", { children: "Service" }), _jsx("dd", { children: showing ? where : chosen.name }), _jsx("dt", { children: "Status" }), _jsxs("dd", { children: [_jsx("span", { className: `status-dot${showing ? ` is-${state}` : ""}`, "aria-hidden": true }), showing ? STATE_TEXT[state] : provider === "supabase" && project ? "Not signed in" : "Not connected"] }), showing && current.location && (_jsxs(_Fragment, { children: [_jsx("dt", { children: current.kind === "webdav" ? "Server" : "Folder" }), _jsx("dd", { className: "mono", children: current.location })] })), provider === "supabase" && project && (_jsxs(_Fragment, { children: [_jsx("dt", { children: "Project" }), _jsx("dd", { className: "mono", children: project.url.replace(/^https:\/\//, "") })] })), provider === "supabase" && signedIn && (_jsxs(_Fragment, { children: [_jsx("dt", { children: "Account" }), _jsx("dd", { children: signedIn })] })), showing && current.kind === "cloud" && current.username && (_jsxs(_Fragment, { children: [_jsx("dt", { children: "Account" }), _jsx("dd", { children: current.username })] })), _jsx("dt", { children: "Last synced" }), _jsx("dd", { children: showing && overview?.status.lastSuccessAt ? relativeTime(overview.status.lastSuccessAt) : "Never" }), showing && overview && overview.waitingToSend > 0 && (_jsxs(_Fragment, { children: [_jsx("dt", { children: "Waiting" }), _jsxs("dd", { children: [overview.waitingToSend, " ", overview.waitingToSend === 1 ? "change" : "changes", " to send"] })] }))] }), showing && overview?.lastError && _jsx("p", { className: "form-error", children: overview.lastError }), showing && !!overview?.status.behind?.length && _jsx("p", { className: "muted", children: behindText(overview.status.behind) }), _jsxs("div", { className: "connection-actions", children: [showing && (_jsxs("button", { type: "button", className: "btn btn-primary", disabled: state === "syncing", onClick: () => void api.syncNow(), children: [_jsx(Icon, { name: "sync", size: 16 }), " ", state === "syncing" ? "Syncing…" : "Sync now"] })), provider === "supabase" && signedIn && !showing && (_jsx("button", { type: "button", className: "btn btn-primary", onClick: () => void api.setSyncProvider({ kind: "supabase" }).then(() => (toast("Your library now syncs through Supabase."), void reload()), (e) => toast(String(e))), children: "Sync through Supabase" })), provider === "supabase" && (_jsxs("button", { type: "button", className: "btn btn-quiet", onClick: () => setEditing(true), children: [_jsx(Icon, { name: "settings", size: 16 }), " ", project ? "Manage connection" : "Set up Supabase"] })), showing && current.kind !== "supabase" && (_jsx("button", { type: "button", className: "btn btn-quiet btn-danger-text", onClick: () => void api.setSyncProvider({ kind: "off" }).then(() => (toast(current.kind === "cloud"
                                                ? `TBV no longer syncs with ${serviceName(current.service)} and has signed out. Nothing there was deleted.`
                                                : "TBV no longer syncs through that folder. Nothing in it was deleted."),
                                                void reload()), (e) => toast(String(e))), children: "Stop syncing here" }))] })] }), children: [_jsx(ProviderPicker, { picked: provider, onPick: setProvider, label: "Sync provider", status: statusOf, inUse: inUse }), provider === "supabase" && (editing || !project) && (_jsx(SupabaseProjectForm, { initial: project, onSave: (next) => void saveProject(next), onForget: project ? () => void saveProject(null) : undefined, onCancel: project ? () => setEditing(false) : undefined }, project?.url ?? "")), provider === "supabase" && project && !editing && (_jsx(AccountPanel, { signedIn: signedIn, project: project, onChanged: () => void reload() })), provider !== "supabase" && (_jsx(SyncFolderPanel, { service: provider, current: current, onChanged: () => void reload() }, provider))] }), overview && inUse && !isWeb && _jsx(AlsoSection, { overview: overview, onChanged: () => void reload() })] }), _jsxs(SectionGroup, { id: "whatwhen", title: "What and when", lede: "What goes between your devices, and when.", holds: ["options", "behaviour"], children: [_jsxs(Section, { id: "options", title: "Sync options", lede: "Choose what goes between your devices.", aside: _jsxs("div", { className: "settings-aside-note", children: [_jsxs("h3", { children: [_jsx(Icon, { name: "info", size: 18 }), " About book file syncing"] }), _jsx("p", { children: "Book files are not synced unless you turn it on. Without it, other devices list your books and their covers, and a book opens where its file is." }), _jsx("p", { children: "With it on, any of your devices can open any book, and downloads it the first time. TBV never changes the files themselves. Supabase's free plan holds 1 GB and takes files up to 50 MB. Turn on Split big files to send bigger ones in pieces." })] }), children: [_jsxs("div", { className: "toggle-list", children: [_jsx(Toggle, { label: "Sync reading progress", hint: "Where you are in each book, and what you've finished.", checked: sync.progress, onChange: (progress) => changeSync({ progress }) }), _jsx(Toggle, { label: "Sync notes and highlights", hint: "Highlights, notes, book notes, personal notes and bookmarks.", checked: sync.notes, onChange: (notes) => changeSync({ notes }) }), _jsx(Toggle, { label: "Sync collections and reading lists", hint: "Your collections, their pictures and badges, and favourites.", checked: sync.collections, onChange: (collections) => changeSync({ collections }) }), _jsx(Toggle, { label: "Sync Discover history", hint: "Pages visited and searches in Discover, so every device has the same history. Off: each device keeps its own.", checked: sync.browserHistory, onChange: (browserHistory) => changeSync({ browserHistory }) }), _jsx(Toggle, { label: "Sync library details", hint: "Titles, authors, series and other details you've corrected.", checked: sync.metadata, onChange: (metadata) => changeSync({ metadata }) }), _jsx(Toggle, { label: "Sync book files", hint: isIOS || isAndroid ? "Always on here: books added on this device go to the cloud, so your other devices can open them." : "Keep a copy of your books in the cloud.", checked: isIOS || isAndroid || sync.bookFiles, disabled: isIOS || isAndroid, onChange: (bookFiles) => changeSync({ bookFiles }) }), _jsx(Toggle, { label: "Sync audiobook files", hint: "Audiobooks are large, so this is separate. Their chapters and your place sync either way.", checked: sync.audioFiles, onChange: (audioFiles) => changeSync({ audioFiles }) }), supabaseOn && (_jsx(Toggle, { label: "Split big files for Supabase's free plan", hint: "Files over 50 MB, like most audiobooks, go up in pieces, which the free plan needs. Leave it off on a paid plan: it takes big files whole.", checked: sync.splitBigFiles, onChange: (splitBigFiles) => changeSync({ splitBigFiles }) }))] }), (isIOS || isAndroid) && (_jsx(Row, { label: "Books opened on this phone", hint: "A book that came down just so you could open it is removed again after this long unopened. Its file stays in the cloud. Books you download on purpose, or keep from their details page, stay.", children: _jsx(Select, { label: "Books opened on this phone", value: String(sync.phoneKeepDays), options: [
                                        { value: "7", label: "Remove after a week" },
                                        { value: "14", label: "Remove after 2 weeks" },
                                        { value: "30", label: "Remove after a month" },
                                        { value: "0", label: "Keep them all" },
                                    ], onChange: (v) => changeSync({ phoneKeepDays: Number(v) }) }) }))] }), _jsx(Section, { id: "behaviour", title: "Sync behaviour", lede: "When TBV syncs, and what happens when two devices disagree.", children: _jsxs("div", { className: "settings-columns", children: [_jsxs("div", { children: [_jsx(Row, { label: "How often", children: _jsx(Select, { label: "How often to sync", value: sync.frequency, options: [
                                                    { value: "automatic", label: "Automatically (Recommended)" },
                                                    { value: "15min", label: "Every 15 minutes" },
                                                    { value: "hourly", label: "Every hour" },
                                                    { value: "manual", label: "Only when I ask" },
                                                ], onChange: (frequency) => changeSync({ frequency }) }) }), _jsxs("div", { className: "toggle-list", children: [_jsx(Toggle, { label: "Sync when TBV opens", checked: sync.onStartup, onChange: (onStartup) => changeSync({ onStartup }) }), _jsx(Toggle, { label: "Sync when TBV closes", checked: sync.onClose, onChange: (onClose) => changeSync({ onClose }) })] })] }), _jsxs("div", { children: [_jsx("h3", { className: "settings-subhead", children: "When devices disagree, use" }), _jsx(RadioList, { label: "When devices disagree", value: sync.conflicts, options: [
                                                {
                                                    value: "recent",
                                                    label: "The most recent change (Recommended)",
                                                    hint: "Keeps the newest version automatically.",
                                                },
                                                {
                                                    value: "ask",
                                                    label: "Ask me",
                                                    hint: "Lets you choose which version to keep.",
                                                },
                                                {
                                                    value: "local",
                                                    label: "This device's version",
                                                    hint: "Always keeps what is on this computer.",
                                                },
                                                {
                                                    value: "cloud",
                                                    label: "The cloud's version",
                                                    hint: "Always keeps what is in the cloud.",
                                                },
                                            ], onChange: (conflicts) => changeSync({ conflicts }) })] })] }) })] }), _jsxs(SectionGroup, { id: "moveback", title: "Move and back up", lede: "Move your library to another place, or keep a copy of it.", holds: ["move", "backup"], children: [_jsx(MoveSection, { overview: overview, inUse: inUse, onChanged: reload }), _jsxs(Section, { id: "backup", title: "Backup & restore", lede: "Keep a copy of everything on this computer, or bring one back.", children: [_jsxs("div", { className: "action-tiles", children: [_jsx(ActionTile, { icon: _jsx(Icon, { name: "download", size: 22 }), title: "Export library data", hint: "Books' details, progress, notes and collections, as a readable file.", disabled: busy, onClick: () => void run(() => api.exportLibrary(), "Exported your library data.") }), _jsx(ActionTile, { icon: _jsx(Icon, { name: "folder", size: 22 }), title: "Create a backup", hint: "A complete copy of TBV's data, to restore later.", disabled: busy, onClick: () => void run(() => api.createBackup(), "Backup saved.") }), _jsx(ActionTile, { icon: _jsx(Icon, { name: "upload", size: 22 }), title: "Restore from a backup", hint: "Replaces this computer's library data with a backup.", disabled: busy, onClick: () => (isApp ? setRestoring(true) : toast("Restoring works in the desktop app.")) })] }), _jsx("p", { className: "settings-row-hint", children: "Backups hold your library's data, not the book files. Your books stay in the library folder." })] })] }), restoring && (_jsx(ConfirmDialog, { title: "Restore from a backup?", body: "Your library data on this computer is replaced by the backup's: progress, notes, collections and settings. Make a backup first if you might want today's data back.", confirm: "Choose a backup\u2026", danger: true, onCancel: () => setRestoring(false), onConfirm: () => {
                    setRestoring(false);
                    void run(async () => {
                        const done = await api.restoreBackup();
                        if (done)
                            onRestored();
                        return done;
                    }, "Restored from the backup.");
                } }))] }));
}

import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
// Preferences › Sync › Second sync: a second place kept in step at the same
// time as the first. For example, iCloud Drive holds every file (audiobooks
// too) while Supabase carries the library to a phone.
import { useState } from "react";
import { api, isApp } from "../api";
import { relativeTime } from "../lib/format";
import { Icon } from "../components/Icon";
import { useToast } from "../components/Toast";
import { useAppSettings } from "./appSettings";
import { placeWords, serviceName, SyncFolderPanel, viewOfChoice } from "./SyncFolderPanel";
import { PROVIDERS, ProviderPicker } from "./providers";
import { Section, Toggle } from "./controls";
export function AlsoSection({ overview, onChanged }) {
    const { settings, changeSync } = useAppSettings();
    const sync = settings.sync;
    const toast = useToast();
    const [picked, setPicked] = useState(null);
    const also = overview.also;
    const main = overview.provider;
    const choose = async (choice, where) => {
        if (!isApp)
            toast("This is the browser preview: nothing is synced here.");
        try {
            const joined = await api.setAlsoSync(choice);
            toast(!choice
                ? "TBV no longer syncs with the second place. Nothing there was deleted."
                : joined
                    ? `Joined the library already in ${where}. Syncing now.`
                    : `Your library now also syncs with ${where}.`);
            setPicked(null);
            onChanged();
        }
        catch (e) {
            toast(`That didn't work: ${String(e)}`);
        }
    };
    // The place syncing now, as its card.
    const alsoId = !also
        ? null
        : also.provider.kind === "supabase"
            ? "supabase"
            : also.provider.kind === "cloud"
                ? (also.provider.service === "google" ? "gdrive" : also.provider.service)
                : also.provider.kind === "folder" && PROVIDERS.some((p) => p.id === also.provider.service)
                    ? also.provider.service
                    : "custom";
    const pick = (p) => setPicked(p === alsoId ? null : p);
    const where = (kind, service) => kind === "folder" || kind === "cloud" ? serviceName(service) : kind === "webdav" ? "your WebDAV server" : "Supabase";
    return (_jsx(Section, { id: "also", title: "Second sync", lede: "Keep a second place in step at the same time. For example, iCloud Drive can hold every file while Supabase carries your library to your phone.", children: also && !picked ? (_jsxs(_Fragment, { children: [_jsx(ProviderPicker, { picked: alsoId, onPick: pick, label: "Second place to sync with", status: (p) => (p === alsoId ? "Syncing" : ""), inUse: alsoId }), _jsxs("div", { className: "settings-subpanel", children: [_jsxs("h3", { children: ["Also syncing with ", where(also.provider.kind, also.provider.service)] }), _jsxs("dl", { className: "also-details", children: [also.provider.location && (_jsxs(_Fragment, { children: [_jsx("dt", { children: also.provider.kind === "webdav" ? "Server" : "Folder" }), _jsx("dd", { className: "mono", children: also.provider.location })] })), _jsx("dt", { children: "Last synced" }), _jsx("dd", { children: also.lastSuccessAt ? relativeTime(also.lastSuccessAt) : "Never" }), also.waitingToSend > 0 && (_jsxs(_Fragment, { children: [_jsx("dt", { children: "Waiting" }), _jsxs("dd", { children: [also.waitingToSend, " ", also.waitingToSend === 1 ? "change" : "changes", " to send"] })] }))] }), also.lastError && _jsx("p", { className: "form-error", children: also.lastError }), _jsx("p", { className: "settings-row-hint", children: "Your progress, notes, collections and covers go to both places. Choose which files go to this one here; the Sync options below apply to both." }), _jsxs("div", { className: "toggle-list", children: [_jsx(Toggle, { label: "Send book files here", hint: "Ebooks and documents, so other devices on this place can open them.", checked: sync.alsoBookFiles, onChange: (alsoBookFiles) => changeSync({ alsoBookFiles }) }), _jsx(Toggle, { label: "Send audiobook files here", hint: "Audiobooks are large. Leave this off if this place has little room, such as Supabase's free plan.", checked: sync.alsoAudioFiles, onChange: (alsoAudioFiles) => changeSync({ alsoAudioFiles }) })] }), _jsx("div", { className: "dialog-actions", children: _jsx("button", { type: "button", className: "btn btn-quiet btn-danger-text", onClick: () => void choose(null, ""), children: "Stop the second sync" }) })] })] })) : (_jsxs(_Fragment, { children: [_jsx(ProviderPicker, { picked: picked, onPick: pick, label: "Second place to sync with" }), picked === "supabase" &&
                    (main.kind === "supabase" ? (_jsx("p", { className: "settings-row-hint", children: "Supabase is already your main sync. Pick another place for the second one." })) : overview.signedInAs ? (_jsx("div", { className: "dialog-actions", children: _jsxs("button", { type: "button", className: "btn btn-primary", onClick: () => void choose({ kind: "supabase" }, "Supabase"), children: [_jsx(Icon, { name: "sync", size: 16 }), " Also sync through Supabase"] }) })) : (_jsx("p", { className: "settings-row-hint", children: "First set up Supabase and sign in on its card under Sync provider above. Signing in there won't move your main sync." }))), picked && picked !== "supabase" && (_jsx(SyncFolderPanel, { service: picked, current: { kind: "off", service: null, location: null, username: null }, onChanged: onChanged, onUse: (choice) => void choose(choice, placeWords(viewOfChoice(choice))), useLabel: "Also sync here" }, picked))] })) }));
}

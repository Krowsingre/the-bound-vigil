import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
// Sync activity: what sync is doing right now in each place, file by file,
// and the files it moved lately. Kept only while TBV is open.
import { useEffect, useState } from "react";
import { api } from "../api";
import { Icon } from "../components/Icon";
import { ProgressBar } from "../components/ProgressBar";
import { relativeTime } from "../lib/format";
import { placeWords } from "../settings/SyncFolderPanel";
const NOTHING = { running: false, startedAt: null, finishedAt: null, places: [], recent: [], changes: [] };
function size(bytes) {
    if (bytes >= 1024 * 1024 * 1024)
        return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
    if (bytes >= 1024 * 1024)
        return `${(bytes / 1024 / 1024).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
function placeName(place) {
    const p = place.provider;
    return placeWords(p, true);
}
function plural(n, one, many = `${one}s`) {
    return `${n} ${n === 1 ? one : many}`;
}
function stepText(place) {
    if (place.finished)
        return place.problem ? "Couldn't finish" : "Done";
    switch (place.step) {
        case "receiving":
            return "Getting changes from other devices…";
        case "sending":
            return "Sending this device's changes…";
        case "files":
            return place.filesTotal ? `Moving files: ${place.filesDone} of ${place.filesTotal}` : "Checking files…";
        default:
            return "Connecting…";
    }
}
function fileText(f, now = false) {
    if (f.problem)
        return f.problem;
    const verb = f.direction === "up" ? (now ? "Uploading" : "Uploaded") : f.direction === "down" ? (now ? "Downloading" : "Downloaded") : now ? "Removing" : "Removed";
    return f.bytes && f.direction !== "erase" ? `${verb} · ${size(f.bytes)}` : verb;
}
function fileIcon(f) {
    return f.problem ? "warning" : f.direction === "up" ? "upload" : f.direction === "down" ? "download" : "trash";
}
function Place({ place }) {
    // Counted by files: download sizes aren't known until they arrive.
    const fraction = place.filesTotal ? place.filesDone / place.filesTotal : 0;
    const moving = !place.finished && place.step === "files" && place.filesTotal > 0;
    return (_jsxs("section", { className: `imports-summary sync-place${place.problem ? " is-bad" : ""}`, "aria-live": "polite", children: [_jsxs("div", { className: "imports-summary-text", children: [_jsx("p", { className: "eyebrow", children: place.lane === "main" ? "Main sync" : "Second sync" }), _jsx("h2", { children: placeName(place) }), place.provider.location && _jsx("p", { className: "settings-row-hint mono", children: place.provider.location }), _jsxs("p", { className: "settings-row-hint", children: [stepText(place), (place.received > 0 || place.sent > 0) &&
                                ` · ${plural(place.received, "change")} received, ${plural(place.sent, "change")} sent`] })] }), moving && (_jsx(ProgressBar, { value: fraction, label: `${Math.round(fraction * 100)}% of files moved to or from ${placeName(place)}` })), moving && place.bytesTotal > 0 && (_jsxs("p", { className: "settings-row-hint", children: [size(place.bytesDone), " of ", size(place.bytesTotal), " uploaded"] })), place.current && (_jsxs("div", { className: "import-row is-current", children: [_jsx(Icon, { name: fileIcon(place.current), size: 18 }), _jsxs("div", { className: "import-text", children: [_jsx("span", { className: "import-name", children: place.current.what }), _jsxs("span", { className: "import-detail", children: [fileText(place.current, true), "\u2026"] })] })] })), place.problem && _jsx("p", { className: "form-error", children: place.problem })] }));
}
export function SyncActivity({ sync, onOpenSyncSettings, embedded = false, }) {
    const [activity, setActivity] = useState(NOTHING);
    useEffect(() => api.onSyncActivity(setActivity), []);
    const off = (sync?.state ?? "disabled") === "disabled";
    const running = activity.running || sync?.state === "syncing";
    const problems = activity.recent.filter((f) => f.problem).length;
    return (_jsxs("div", { className: `imports-page sync-activity-page${embedded ? " activity-pane" : " library"}`, children: [_jsxs("header", { className: embedded ? "activity-head" : "library-head", children: [_jsxs("div", { children: [!embedded && _jsx("h1", { className: "library-title", children: "Sync activity" }), _jsx("p", { className: embedded ? "settings-row-hint" : "eyebrow", children: running
                                    ? "Syncing now"
                                    : activity.finishedAt
                                        ? `Last sync finished ${relativeTime(activity.finishedAt)}`
                                        : sync?.lastSuccessAt
                                            ? `Last synced ${relativeTime(sync.lastSuccessAt)}`
                                            : "What sync is doing, file by file" })] }), _jsxs("div", { className: "imports-actions", children: [_jsxs("button", { type: "button", className: "btn btn-quiet", onClick: onOpenSyncSettings, children: [_jsx(Icon, { name: "settings", size: 16 }), " Sync settings"] }), _jsxs("button", { type: "button", className: "btn btn-primary", disabled: off || running, onClick: () => void api.syncNow(), children: [_jsx(Icon, { name: "sync", size: 16 }), " Sync now"] })] })] }), off && activity.places.length === 0 ? (_jsxs("div", { className: "imports-empty", children: [_jsx(Icon, { name: "cloudOff", size: 28 }), _jsx("p", { children: "Sync is off, so nothing is being sent anywhere. Choose a cloud service in Sync settings to keep your devices in step." })] })) : activity.places.length === 0 && activity.recent.length === 0 ? (_jsxs("div", { className: "imports-empty", children: [_jsx(Icon, { name: "cloud", size: 28 }), _jsx("p", { children: "Nothing has synced since TBV opened. When it does, each place and every file it sends or fetches shows up here." })] })) : (_jsxs(_Fragment, { children: [_jsx("div", { className: "sync-places", children: activity.places.map((p) => (_jsx(Place, { place: p }, p.lane))) }), (activity.changes?.length ?? 0) > 0 && (_jsxs("section", { className: "imports-group", children: [_jsxs("div", { className: "section-head", children: [_jsxs("h3", { className: "section-label", children: ["Recent changes \u00B7 ", activity.changes.length] }), _jsx("button", { type: "button", className: "btn btn-quiet btn-small", onClick: () => void api.clearSyncChanges(), children: "Clear" })] }), _jsx("ul", { className: "imports-list", children: activity.changes.map((c, i) => (_jsxs("li", { className: "import-row", children: [_jsx(Icon, { name: c.direction === "up" ? "upload" : "download", size: 18 }), _jsxs("div", { className: "import-text", children: [_jsx("span", { className: "import-name", children: c.what }), _jsxs("span", { className: "import-detail", children: [c.direction === "up" ? "Sent from this device" : "From another device", activity.places.length > 1 ? ` · ${c.lane === "main" ? "main sync" : "second sync"}` : ""] })] }), _jsx("span", { className: "import-detail sync-when", children: relativeTime(c.at) })] }, `${c.at}-${i}`))) })] })), activity.recent.length > 0 && (_jsxs("section", { className: "imports-group", children: [_jsxs("h3", { className: "section-label", children: ["Recent files \u00B7 ", activity.recent.length, problems > 0 && ` · ${plural(problems, "problem")}`] }), _jsx("ul", { className: "imports-list", children: activity.recent.map((f, i) => (_jsxs("li", { className: `import-row${f.problem ? " is-bad" : ""}`, children: [_jsx(Icon, { name: fileIcon(f), size: 18 }), _jsxs("div", { className: "import-text", children: [_jsx("span", { className: "import-name", children: f.what }), _jsxs("span", { className: "import-detail", children: [fileText(f), f.lane === null ? " when you opened it" : activity.places.length > 1 ? ` · ${f.lane === "main" ? "main sync" : "second sync"}` : ""] })] }), _jsx("span", { className: "import-detail sync-when", children: relativeTime(f.at) })] }, `${f.at}-${i}`))) })] }))] }))] }));
}

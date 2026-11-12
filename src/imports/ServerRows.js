import { jsxs as _jsxs, jsx as _jsx, Fragment as _Fragment } from "react/jsx-runtime";
import { api } from "../api";
import { Icon } from "../components/Icon";
import { ProgressBar } from "../components/ProgressBar";
import { formatBytes } from "../settings/controls";
/** How long something took, in words: "45 s", "3 min 20 s", "1 h 5 min". */
export function took(from, to) {
    if (!from || !to)
        return null;
    const s = Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 1000));
    if (s < 60)
        return `${Math.max(1, s)} s`;
    if (s < 3600)
        return `${Math.floor(s / 60)} min${s % 60 ? ` ${s % 60} s` : ""}`;
    return `${Math.floor(s / 3600)} h${Math.floor((s % 3600) / 60) ? ` ${Math.floor((s % 3600) / 60)} min` : ""}`;
}
export function rowText(f) {
    const time = took(f.startedAt, f.finishedAt);
    switch (f.state) {
        case "waiting":
            return { text: `Waiting · ${formatBytes(f.size)}`, tone: "wait" };
        case "downloading":
            return { text: `Downloading ${formatBytes(f.bytesDone)} of ${formatBytes(f.size)}`, tone: "now" };
        case "downloaded":
            return { text: `Downloaded${time ? ` in ${time}` : ""} · waiting for the rest of its audiobook`, tone: "now" };
        case "importing":
            return { text: `Downloaded${time ? ` in ${time}` : ""} · being added to your library`, tone: "now" };
        case "done":
            return { text: `Downloaded${time ? ` in ${time}` : ""} · ${formatBytes(f.size)}`, tone: "ok" };
        case "failed":
            return { text: f.error ?? "Couldn't be downloaded.", tone: "bad" };
    }
}
export function ServerRows({ queue }) {
    const { view, rows, showMore } = queue;
    const c = view.counts;
    if (c.total === 0 && view.looking.length === 0 && !view.problem)
        return null;
    const notDown = c.waiting + c.downloading;
    return (_jsxs("section", { className: "imports-group server-rows", "aria-label": "From servers", children: [_jsxs("div", { className: "server-rows-head", children: [_jsxs("h3", { className: "section-label", children: ["From servers \u00B7 ", c.total, " ", c.total === 1 ? "file" : "files", c.downloading > 0 && ` · ${c.downloading} downloading`, c.waiting > 0 && ` · ${c.waiting} waiting`, c.failed > 0 && ` · ${c.failed} failed`] }), _jsxs("div", { className: "imports-summary-actions", children: [notDown > 0 && (_jsx("button", { type: "button", className: "btn btn-quiet btn-danger-text", onClick: () => void api.cancelServerQueue(), children: "Stop the rest" })), c.done + c.failed > 0 && (_jsx("button", { type: "button", className: "btn btn-quiet", onClick: () => void api.clearServerFinished(), children: "Clear finished" }))] })] }), c.total > 0 && (_jsxs(_Fragment, { children: [_jsx(ProgressBar, { value: c.bytesTotal ? c.bytesDone / c.bytesTotal : 0, label: "Downloaded from servers" }), _jsxs("p", { className: "settings-row-hint", children: [formatBytes(c.bytesDone), " of ", formatBytes(c.bytesTotal), " \u00B7 up to ", view.connections, " at once (Preferences \u203A Servers)"] })] })), view.looking.map((name, i) => (_jsxs("p", { className: "settings-row-hint", role: "status", children: ["Looking through ", name, " for what you chose\u2026"] }, `${name}-${i}`))), view.problem && _jsx("p", { className: "form-error", children: view.problem.startsWith("new-host-key:") ? "The server's key wasn't trusted, so nothing came down." : view.problem }), _jsx("ul", { className: "imports-list", children: rows.map((f) => {
                    const t = rowText(f);
                    return (_jsxs("li", { className: `import-row is-${t.tone === "now" ? "current" : t.tone}`, children: [_jsx(Icon, { name: t.tone === "bad" ? "warning" : t.tone === "ok" ? "check" : t.tone === "wait" ? "clock" : "download", size: 18 }), _jsxs("div", { className: "import-text", children: [_jsx("span", { className: "import-name", title: f.remote, children: f.name }), _jsxs("span", { className: "import-detail", children: [f.serverName, " \u00B7 ", t.text] }), f.state === "downloading" && _jsx(ProgressBar, { value: f.size ? f.bytesDone / f.size : 0, label: `${f.name} progress` })] }), f.state === "failed" && (_jsx("button", { type: "button", className: "btn btn-quiet", onClick: () => void api.retryServerFile(f.id), children: "Try again" })), (f.state === "waiting" || f.state === "downloading" || f.state === "failed") && (_jsx("button", { type: "button", className: "icon-btn", "aria-label": `Remove ${f.name}`, title: "Remove", onClick: () => void api.removeServerFile(f.id), children: _jsx(Icon, { name: "close", size: 16 }) }))] }, f.id));
                }) }), c.total > rows.length && (_jsxs("button", { type: "button", className: "btn btn-quiet server-rows-more", onClick: showMore, children: ["Show ", Math.min(200, c.total - rows.length), " more of ", c.total - rows.length] }))] }));
}
